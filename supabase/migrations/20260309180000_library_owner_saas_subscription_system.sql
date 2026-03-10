ALTER TABLE public.library_subscriptions
  ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_price NUMERIC,
  ADD COLUMN IF NOT EXISTS plan_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_expiry_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_status TEXT;

ALTER TABLE public.library_subscriptions
  DROP CONSTRAINT IF EXISTS library_subscriptions_payment_status_check;

UPDATE public.library_subscriptions
SET
  trial_start_date = COALESCE(
    trial_start_date,
    CASE
      WHEN status = 'trial' THEN COALESCE(started_at, created_at)
      ELSE created_at
    END
  ),
  trial_end_date = COALESCE(
    trial_end_date,
    CASE
      WHEN status = 'trial' THEN COALESCE(started_at, created_at) + interval '7 days'
      ELSE created_at + interval '7 days'
    END
  ),
  plan_price = COALESCE(
    plan_price,
    CASE
      WHEN price > 0 THEN price
      ELSE NULL
    END
  ),
  plan_start_date = COALESCE(
    plan_start_date,
    CASE
      WHEN status IN ('active', 'expired', 'blocked') AND price > 0 THEN started_at
      ELSE NULL
    END
  ),
  plan_expiry_date = COALESCE(
    plan_expiry_date,
    CASE
      WHEN status IN ('active', 'expired', 'blocked') AND price > 0 THEN expires_at
      ELSE NULL
    END
  ),
  payment_status = COALESCE(
    NULLIF(payment_status, ''),
    CASE
      WHEN status = 'trial' THEN 'trial'
      WHEN status = 'active' THEN 'paid'
      WHEN status = 'blocked' THEN 'overdue'
      ELSE 'expired'
    END
  ),
  started_at = COALESCE(
    plan_start_date,
    trial_start_date,
    started_at,
    created_at
  ),
  expires_at = COALESCE(
    plan_expiry_date,
    trial_end_date,
    expires_at
  );

ALTER TABLE public.library_subscriptions
  ALTER COLUMN payment_status SET DEFAULT 'trial';

ALTER TABLE public.library_subscriptions
  ALTER COLUMN payment_status SET NOT NULL;

ALTER TABLE public.library_subscriptions
  ADD CONSTRAINT library_subscriptions_payment_status_check
  CHECK (payment_status IN ('trial', 'pending', 'paid', 'expired', 'overdue', 'failed'));

CREATE INDEX IF NOT EXISTS idx_library_subscriptions_trial_end_date
  ON public.library_subscriptions(trial_end_date);

CREATE INDEX IF NOT EXISTS idx_library_subscriptions_plan_expiry_date
  ON public.library_subscriptions(plan_expiry_date);

CREATE INDEX IF NOT EXISTS idx_notifications_subscription_unsent
  ON public.notifications(delivery_status, sent_at)
  WHERE type IN ('subscription_reminder_3day', 'subscription_expired_today');

CREATE OR REPLACE VIEW public.subscriptions AS
SELECT
  s.id,
  s.library_id,
  s.plan_name AS plan,
  COALESCE(s.plan_price, s.price) AS price,
  s.seats_limit AS seat_limit,
  s.status,
  s.started_at,
  s.expires_at,
  s.created_at,
  s.updated_at,
  COALESCE(s.plan_price, s.price) AS plan_price,
  s.payment_status,
  s.trial_start_date,
  s.trial_end_date,
  s.plan_start_date,
  s.plan_expiry_date
FROM public.library_subscriptions s;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_library_id UUID;
  v_slug TEXT;
  v_full_name TEXT;
  v_phone TEXT;
  v_trial_start TIMESTAMPTZ := now();
  v_trial_end TIMESTAMPTZ := now() + interval '7 days';
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_phone := COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone_number');

  INSERT INTO public.profiles (user_id, email, full_name, phone_number, is_phone_verified)
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_phone,
    CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END
  );

  v_slug := lower(regexp_replace(split_part(COALESCE(NEW.email, NEW.phone, NEW.id::text), '@', 1), '[^a-z0-9]', '-', 'g'));
  IF EXISTS (SELECT 1 FROM public.libraries WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  INSERT INTO public.libraries (owner_id, name, slug, total_seats)
  VALUES (NEW.id, COALESCE(NULLIF(v_full_name, ''), 'My') || '''s Library', v_slug, 30)
  RETURNING id INTO v_library_id;

  INSERT INTO public.user_roles (user_id, role, library_id)
  VALUES (NEW.id, 'library_owner', v_library_id);

  INSERT INTO public.library_subscriptions (
    library_id,
    plan_name,
    price,
    seats_limit,
    features,
    status,
    started_at,
    expires_at,
    trial_start_date,
    trial_end_date,
    payment_status
  )
  VALUES (
    v_library_id,
    'starter',
    0,
    50,
    '["seat_management","analytics","notifications"]'::jsonb,
    'trial',
    v_trial_start,
    v_trial_end,
    v_trial_start,
    v_trial_end,
    'trial'
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_library_subscription_renewals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
  v_trial_expired_count INT := 0;
  v_plan_expired_count INT := 0;
  v_remind_3_count INT := 0;
  v_expiry_day_count INT := 0;
  v_overdue_count INT := 0;
BEGIN
  UPDATE public.library_subscriptions ls
  SET
    status = 'expired',
    payment_status = 'expired',
    expires_at = COALESCE(ls.plan_expiry_date, ls.trial_end_date, ls.expires_at)
  WHERE ls.status = 'trial'
    AND ls.trial_end_date IS NOT NULL
    AND ls.trial_end_date < now()
    AND (
      ls.plan_expiry_date IS NULL
      OR ls.plan_expiry_date < now()
      OR COALESCE(ls.payment_status, 'trial') <> 'paid'
    );
  GET DIAGNOSTICS v_trial_expired_count = ROW_COUNT;

  UPDATE public.library_subscriptions ls
  SET
    status = 'expired',
    payment_status = CASE
      WHEN COALESCE(ls.payment_status, 'paid') = 'paid' THEN 'expired'
      ELSE ls.payment_status
    END,
    expires_at = COALESCE(ls.plan_expiry_date, ls.expires_at)
  WHERE ls.status = 'active'
    AND ls.plan_expiry_date IS NOT NULL
    AND ls.plan_expiry_date < now();
  GET DIAGNOSTICS v_plan_expired_count = ROW_COUNT;

  FOR v_sub IN
    SELECT
      ls.library_id,
      ls.plan_name,
      ls.plan_expiry_date,
      p.phone_number AS owner_phone
    FROM public.library_subscriptions ls
    INNER JOIN public.libraries l ON l.id = ls.library_id
    LEFT JOIN public.profiles p ON p.user_id = l.owner_id
    WHERE l.enabled = true
      AND ls.status = 'active'
      AND COALESCE(ls.payment_status, 'paid') = 'paid'
      AND ls.plan_expiry_date IS NOT NULL
      AND ls.plan_expiry_date::date = CURRENT_DATE + 3
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.library_id = ls.library_id
          AND n.type = 'subscription_reminder_3day'
          AND COALESCE(n.metadata->>'expiry_date', '') = ls.plan_expiry_date::date::text
      )
  LOOP
    INSERT INTO public.notifications (
      library_id,
      type,
      title,
      message,
      recipient_phone,
      delivery_status,
      metadata
    )
    VALUES (
      v_sub.library_id,
      'subscription_reminder_3day',
      'Subscription renewal reminder',
      'Your Libriofy subscription will expire soon. Please renew.',
      v_sub.owner_phone,
      'queued',
      jsonb_build_object(
        'plan_name', v_sub.plan_name,
        'expiry_date', v_sub.plan_expiry_date::date::text,
        'reminder_stage', '3_day'
      )
    );

    v_remind_3_count := v_remind_3_count + 1;
  END LOOP;

  FOR v_sub IN
    SELECT
      ls.library_id,
      ls.plan_name,
      ls.plan_expiry_date,
      p.phone_number AS owner_phone
    FROM public.library_subscriptions ls
    INNER JOIN public.libraries l ON l.id = ls.library_id
    LEFT JOIN public.profiles p ON p.user_id = l.owner_id
    WHERE l.enabled = true
      AND ls.plan_expiry_date IS NOT NULL
      AND ls.plan_expiry_date::date = CURRENT_DATE
      AND COALESCE(ls.payment_status, 'paid') IN ('paid', 'expired')
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.library_id = ls.library_id
          AND n.type = 'subscription_expired_today'
          AND COALESCE(n.metadata->>'expiry_date', '') = ls.plan_expiry_date::date::text
      )
  LOOP
    INSERT INTO public.notifications (
      library_id,
      type,
      title,
      message,
      recipient_phone,
      delivery_status,
      metadata
    )
    VALUES (
      v_sub.library_id,
      'subscription_expired_today',
      'Subscription expired',
      'Your Libriofy subscription has expired.',
      v_sub.owner_phone,
      'queued',
      jsonb_build_object(
        'plan_name', v_sub.plan_name,
        'expiry_date', v_sub.plan_expiry_date::date::text,
        'reminder_stage', 'expiry_day'
      )
    );

    v_expiry_day_count := v_expiry_day_count + 1;
  END LOOP;

  UPDATE public.library_subscriptions ls
  SET payment_status = 'overdue'
  WHERE ls.plan_expiry_date IS NOT NULL
    AND ls.plan_expiry_date::date <= CURRENT_DATE - 5
    AND ls.status = 'expired'
    AND COALESCE(ls.payment_status, 'expired') <> 'overdue';
  GET DIAGNOSTICS v_overdue_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'trial_expired', v_trial_expired_count,
    'plan_expired', v_plan_expired_count,
    'reminder_3day', v_remind_3_count,
    'reminder_expiry_day', v_expiry_day_count,
    'marked_overdue', v_overdue_count
  );
END;
$$;
