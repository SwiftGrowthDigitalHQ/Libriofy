ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS lockers_limit INTEGER;

ALTER TABLE public.library_subscriptions
  ADD COLUMN IF NOT EXISTS lockers_limit INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscription_plans_lockers_limit_check'
      AND conrelid = 'public.subscription_plans'::regclass
  ) THEN
    ALTER TABLE public.subscription_plans
      ADD CONSTRAINT subscription_plans_lockers_limit_check
      CHECK (lockers_limit IS NULL OR lockers_limit >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'library_subscriptions_lockers_limit_check'
      AND conrelid = 'public.library_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.library_subscriptions
      ADD CONSTRAINT library_subscriptions_lockers_limit_check
      CHECK (lockers_limit IS NULL OR lockers_limit >= 0);
  END IF;
END
$$;

UPDATE public.subscription_plans
SET lockers_limit = CASE lower(code)
  WHEN 'starter' THEN 10
  WHEN 'growth' THEN 40
  WHEN 'pro' THEN 150
  WHEN 'premium' THEN 150
  ELSE lockers_limit
END
WHERE lower(code) IN ('starter', 'growth', 'pro', 'premium');

UPDATE public.library_subscriptions ls
SET lockers_limit = COALESCE(
  sp.lockers_limit,
  CASE lower(COALESCE(ls.plan_name, ''))
    WHEN 'starter' THEN 10
    WHEN 'growth' THEN 40
    WHEN 'pro' THEN 150
    WHEN 'premium' THEN 150
    ELSE ls.lockers_limit
  END
)
FROM public.subscription_plans sp
WHERE sp.code = lower(COALESCE(ls.plan_name, ''));

UPDATE public.library_subscriptions
SET lockers_limit = CASE lower(COALESCE(plan_name, ''))
  WHEN 'starter' THEN 10
  WHEN 'growth' THEN 40
  WHEN 'pro' THEN 150
  WHEN 'premium' THEN 150
  ELSE lockers_limit
END
WHERE lockers_limit IS NULL;

ALTER TABLE public.libraries
  ALTER COLUMN total_lockers SET DEFAULT 10;

CREATE OR REPLACE FUNCTION public.library_locker_plan_limit(p_library_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    sp.lockers_limit,
    CASE lower(COALESCE(ls.plan_name, ''))
      WHEN 'starter' THEN 10
      WHEN 'growth' THEN 40
      WHEN 'pro' THEN 150
      WHEN 'premium' THEN 150
      ELSE ls.lockers_limit
    END
  )
  FROM public.library_subscriptions ls
  LEFT JOIN public.subscription_plans sp
    ON sp.code = lower(COALESCE(ls.plan_name, ''))
  WHERE ls.library_id = p_library_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.validate_library_locker_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested INTEGER := GREATEST(COALESCE(NEW.total_lockers, 0), 0);
  v_plan_limit INTEGER;
  v_blocked_count INTEGER := 0;
BEGIN
  NEW.total_lockers := v_requested;
  v_plan_limit := public.library_locker_plan_limit(NEW.id);

  IF v_plan_limit IS NOT NULL AND v_requested > v_plan_limit THEN
    RAISE EXCEPTION 'Your current plan allows only % lockers. Upgrade your plan to add more.', v_plan_limit
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND v_requested < COALESCE(OLD.total_lockers, 0) THEN
    SELECT COUNT(*)
    INTO v_blocked_count
    FROM public.lockers locker
    WHERE locker.library_id = NEW.id
      AND locker.student_id IS NOT NULL
      AND COALESCE(NULLIF(regexp_replace(locker.locker_number, '\D', '', 'g'), ''), '0')::INTEGER > v_requested;

    IF v_blocked_count > 0 THEN
      RAISE EXCEPTION 'Cannot reduce locker capacity because % assigned locker(s) are in the removal range. Release or reassign them first.', v_blocked_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_library_locker_capacity_before_change ON public.libraries;

CREATE TRIGGER validate_library_locker_capacity_before_change
  BEFORE INSERT OR UPDATE OF total_lockers ON public.libraries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_library_locker_capacity();

CREATE OR REPLACE FUNCTION public.sync_library_lockers(
  p_library_id UUID,
  p_total_lockers INTEGER,
  p_columns INTEGER DEFAULT 4
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_index INTEGER;
  v_target INTEGER := GREATEST(COALESCE(p_total_lockers, 0), 0);
  v_columns INTEGER := GREATEST(COALESCE(p_columns, 4), 1);
BEGIN
  IF p_library_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_index IN 1..v_target LOOP
    INSERT INTO public.lockers (library_id, locker_number, "row", "column")
    VALUES (
      p_library_id,
      public.locker_label_from_index(v_index),
      ((v_index - 1) / v_columns) + 1,
      ((v_index - 1) % v_columns) + 1
    )
    ON CONFLICT (library_id, locker_number) DO UPDATE
      SET "row" = EXCLUDED."row",
          "column" = EXCLUDED."column",
          updated_at = now();
  END LOOP;

  DELETE FROM public.lockers locker
  WHERE locker.library_id = p_library_id
    AND substring(locker.locker_number FROM 2)::INTEGER > v_target
    AND locker.student_id IS NULL;
END;
$$;
