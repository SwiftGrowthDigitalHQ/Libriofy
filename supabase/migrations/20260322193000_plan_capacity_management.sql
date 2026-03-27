ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS max_seats INTEGER,
  ADD COLUMN IF NOT EXISTS max_lockers INTEGER;

UPDATE public.subscription_plans
SET
  price = CASE lower(code)
    WHEN 'starter' THEN 2999
    WHEN 'growth' THEN 4999
    WHEN 'pro' THEN 9999
    ELSE price
  END,
  seats_limit = CASE lower(code)
    WHEN 'starter' THEN 50
    WHEN 'growth' THEN 150
    WHEN 'pro' THEN 500
    ELSE seats_limit
  END,
  lockers_limit = CASE lower(code)
    WHEN 'starter' THEN 30
    WHEN 'growth' THEN 80
    WHEN 'pro' THEN 200
    ELSE lockers_limit
  END,
  features = CASE lower(code)
    WHEN 'starter' THEN '["Up to 50 seats","Up to 30 lockers","Seat management","Notifications"]'::jsonb
    WHEN 'growth' THEN '["Up to 150 seats","Up to 80 lockers","Seat management","Advanced analytics","Notifications","Export"]'::jsonb
    WHEN 'pro' THEN '["Up to 500 seats","Up to 200 lockers","All features","Custom domain","Priority support"]'::jsonb
    ELSE features
  END
WHERE lower(code) IN ('starter', 'growth', 'pro');

UPDATE public.library_subscriptions ls
SET
  price = COALESCE(sp.price, ls.price),
  plan_price = COALESCE(sp.price, ls.plan_price, ls.price),
  seats_limit = COALESCE(sp.seats_limit, ls.seats_limit),
  lockers_limit = COALESCE(sp.lockers_limit, ls.lockers_limit),
  features = COALESCE(sp.features, ls.features)
FROM public.subscription_plans sp
WHERE lower(sp.code) = lower(COALESCE(ls.plan_name, ''));

UPDATE public.libraries l
SET
  max_seats = COALESCE(sp.seats_limit, ls.seats_limit, l.max_seats, l.total_seats, 50),
  max_lockers = COALESCE(sp.lockers_limit, ls.lockers_limit, l.max_lockers, l.total_lockers, 30)
FROM public.library_subscriptions ls
LEFT JOIN public.subscription_plans sp
  ON lower(sp.code) = lower(COALESCE(ls.plan_name, ''))
WHERE ls.library_id = l.id;

UPDATE public.libraries
SET
  max_seats = COALESCE(max_seats, GREATEST(total_seats, 50)),
  max_lockers = COALESCE(max_lockers, GREATEST(total_lockers, 30))
WHERE max_seats IS NULL
   OR max_lockers IS NULL;

ALTER TABLE public.libraries
  ALTER COLUMN max_seats SET DEFAULT 50,
  ALTER COLUMN max_lockers SET DEFAULT 30;

UPDATE public.libraries
SET
  max_seats = GREATEST(COALESCE(max_seats, 50), 0),
  max_lockers = GREATEST(COALESCE(max_lockers, 30), 0);

ALTER TABLE public.libraries
  ALTER COLUMN max_seats SET NOT NULL,
  ALTER COLUMN max_lockers SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'libraries_max_seats_check'
      AND conrelid = 'public.libraries'::regclass
  ) THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_max_seats_check
      CHECK (max_seats >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'libraries_max_lockers_check'
      AND conrelid = 'public.libraries'::regclass
  ) THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_max_lockers_check
      CHECK (max_lockers >= 0);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.library_seat_plan_limit(p_library_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT l.max_seats
  FROM public.libraries l
  WHERE l.id = p_library_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.library_locker_plan_limit(p_library_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT l.max_lockers
  FROM public.libraries l
  WHERE l.id = p_library_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.apply_subscription_plan_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
BEGIN
  NEW.plan_name := lower(trim(COALESCE(NEW.plan_name, 'starter')));

  SELECT *
  INTO v_plan
  FROM public.subscription_plans
  WHERE lower(code) = NEW.plan_name
  LIMIT 1;

  IF FOUND THEN
    NEW.plan_name := v_plan.code;
    NEW.price := COALESCE(v_plan.price, NEW.price, 0);
    NEW.plan_price := COALESCE(v_plan.price, NEW.plan_price, NEW.price, 0);
    NEW.seats_limit := COALESCE(v_plan.seats_limit, NEW.seats_limit, 0);
    NEW.lockers_limit := COALESCE(v_plan.lockers_limit, NEW.lockers_limit, 0);
    NEW.features := COALESCE(v_plan.features, NEW.features, '[]'::jsonb);
  ELSE
    NEW.seats_limit := COALESCE(NEW.seats_limit, 0);
    NEW.lockers_limit := COALESCE(NEW.lockers_limit, 0);
    NEW.features := COALESCE(NEW.features, '[]'::jsonb);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_library_capacity_from_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.libraries
  SET
    max_seats = GREATEST(COALESCE(NEW.seats_limit, 0), 0),
    max_lockers = GREATEST(COALESCE(NEW.lockers_limit, 0), 0),
    updated_at = now()
  WHERE id = NEW.library_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_subscription_plan_catalog_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.library_subscriptions
  SET
    price = COALESCE(NEW.price, price),
    plan_price = COALESCE(NEW.price, plan_price, price),
    seats_limit = COALESCE(NEW.seats_limit, seats_limit),
    lockers_limit = COALESCE(NEW.lockers_limit, lockers_limit),
    features = COALESCE(NEW.features, features),
    updated_at = now()
  WHERE lower(plan_name) = lower(NEW.code);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_subscription_plan_snapshot_before_write ON public.library_subscriptions;

CREATE TRIGGER apply_subscription_plan_snapshot_before_write
  BEFORE INSERT OR UPDATE OF plan_name, seats_limit, lockers_limit, price, plan_price, features
  ON public.library_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_subscription_plan_snapshot();

DROP TRIGGER IF EXISTS sync_library_capacity_from_subscription_after_write ON public.library_subscriptions;

CREATE TRIGGER sync_library_capacity_from_subscription_after_write
  AFTER INSERT OR UPDATE OF plan_name, seats_limit, lockers_limit
  ON public.library_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_library_capacity_from_subscription();

DROP TRIGGER IF EXISTS sync_subscription_plan_catalog_changes_after_write ON public.subscription_plans;

CREATE TRIGGER sync_subscription_plan_catalog_changes_after_write
  AFTER UPDATE OF price, seats_limit, lockers_limit, features
  ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_subscription_plan_catalog_changes();

CREATE OR REPLACE FUNCTION public.validate_library_seat_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested INTEGER := GREATEST(COALESCE(NEW.total_seats, 0), 0);
  v_plan_limit INTEGER := GREATEST(COALESCE(NEW.max_seats, 0), 0);
  v_blocked_count INTEGER := 0;
BEGIN
  NEW.total_seats := v_requested;
  NEW.max_seats := v_plan_limit;

  IF v_plan_limit > 0 AND v_requested > v_plan_limit THEN
    RAISE EXCEPTION 'Your current plan allows only % seats. Upgrade plan to increase seat capacity.', v_plan_limit
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND v_requested < COALESCE(OLD.total_seats, 0) THEN
    SELECT COUNT(*)
    INTO v_blocked_count
    FROM public.seats seat
    WHERE seat.library_id = NEW.id
      AND seat.seat_index > v_requested
      AND EXISTS (
        SELECT 1
        FROM public.students s
        WHERE s.library_id = NEW.id
          AND s.seat_id = seat.id
      );

    IF v_blocked_count > 0 THEN
      RAISE EXCEPTION 'Cannot reduce seat capacity because % assigned seat(s) are in the removal range. Reassign them first.', v_blocked_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_library_locker_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested INTEGER := GREATEST(COALESCE(NEW.total_lockers, 0), 0);
  v_plan_limit INTEGER := GREATEST(COALESCE(NEW.max_lockers, 0), 0);
  v_blocked_count INTEGER := 0;
BEGIN
  NEW.total_lockers := v_requested;
  NEW.max_lockers := v_plan_limit;

  IF v_plan_limit > 0 AND v_requested > v_plan_limit THEN
    RAISE EXCEPTION 'Your current plan allows only % lockers. Upgrade plan to increase locker capacity.', v_plan_limit
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

DROP TRIGGER IF EXISTS validate_library_seat_capacity_before_change ON public.libraries;

CREATE TRIGGER validate_library_seat_capacity_before_change
  BEFORE INSERT OR UPDATE OF total_seats, max_seats ON public.libraries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_library_seat_capacity();

DROP TRIGGER IF EXISTS validate_library_locker_capacity_before_change ON public.libraries;

CREATE TRIGGER validate_library_locker_capacity_before_change
  BEFORE INSERT OR UPDATE OF total_lockers, max_lockers ON public.libraries
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_library_locker_capacity();
