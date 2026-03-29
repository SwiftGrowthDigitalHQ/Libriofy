ALTER TABLE public.library_subscriptions
  ADD COLUMN IF NOT EXISTS plan_type TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS ai_call_enabled BOOLEAN;

UPDATE public.library_subscriptions
SET plan_type = CASE lower(COALESCE(plan_name, 'starter'))
  WHEN 'growth' THEN 'growth'
  WHEN 'pro' THEN 'pro'
  ELSE 'starter'
END
WHERE plan_type IS NULL
   OR lower(plan_type) NOT IN ('starter', 'growth', 'pro');

UPDATE public.library_subscriptions
SET whatsapp_enabled = CASE lower(COALESCE(plan_type, plan_name, 'starter'))
  WHEN 'growth' THEN true
  WHEN 'pro' THEN true
  ELSE false
END
WHERE whatsapp_enabled IS NULL;

UPDATE public.library_subscriptions
SET ai_call_enabled = CASE lower(COALESCE(plan_type, plan_name, 'starter'))
  WHEN 'pro' THEN true
  ELSE false
END
WHERE ai_call_enabled IS NULL;

ALTER TABLE public.library_subscriptions
  ALTER COLUMN plan_type SET DEFAULT 'starter',
  ALTER COLUMN whatsapp_enabled SET DEFAULT false,
  ALTER COLUMN ai_call_enabled SET DEFAULT false;

ALTER TABLE public.library_subscriptions
  ALTER COLUMN plan_type SET NOT NULL,
  ALTER COLUMN whatsapp_enabled SET NOT NULL,
  ALTER COLUMN ai_call_enabled SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'library_subscriptions_plan_type_check'
      AND conrelid = 'public.library_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.library_subscriptions
      ADD CONSTRAINT library_subscriptions_plan_type_check
      CHECK (plan_type IN ('starter', 'growth', 'pro'));
  END IF;
END
$$;

UPDATE public.subscription_plans
SET features = CASE lower(code)
  WHEN 'starter' THEN '["Up to 50 seats","Up to 30 lockers","Seat management","Notifications"]'::jsonb
  WHEN 'growth' THEN '["Up to 150 seats","Up to 80 lockers","Seat management","Advanced analytics","Notifications","Export","WhatsApp Payment Reminders (Automated)"]'::jsonb
  WHEN 'pro' THEN '["Up to 500 seats","Up to 200 lockers","AI Calling Reminders (Auto voice calls)","WhatsApp Reminders (Advanced automation)","All features","Custom domain","Priority support"]'::jsonb
  ELSE features
END
WHERE lower(code) IN ('starter', 'growth', 'pro');

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

  NEW.plan_type := CASE lower(COALESCE(NEW.plan_name, NEW.plan_type, 'starter'))
    WHEN 'growth' THEN 'growth'
    WHEN 'pro' THEN 'pro'
    ELSE 'starter'
  END;
  NEW.whatsapp_enabled := CASE NEW.plan_type
    WHEN 'growth' THEN true
    WHEN 'pro' THEN true
    ELSE false
  END;
  NEW.ai_call_enabled := NEW.plan_type = 'pro';

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
    plan_type = CASE lower(COALESCE(NEW.code, 'starter'))
      WHEN 'growth' THEN 'growth'
      WHEN 'pro' THEN 'pro'
      ELSE 'starter'
    END,
    whatsapp_enabled = CASE lower(COALESCE(NEW.code, 'starter'))
      WHEN 'growth' THEN true
      WHEN 'pro' THEN true
      ELSE false
    END,
    ai_call_enabled = lower(COALESCE(NEW.code, 'starter')) = 'pro',
    updated_at = now()
  WHERE lower(plan_name) = lower(NEW.code);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW public.subscriptions AS
SELECT
  s.id,
  s.library_id,
  s.plan_name AS plan,
  s.plan_type,
  COALESCE(s.plan_price, s.price) AS price,
  COALESCE(s.plan_price, s.price) AS plan_price,
  s.seats_limit AS seat_limit,
  s.status,
  s.started_at,
  s.expires_at,
  s.created_at,
  s.updated_at,
  s.payment_status,
  s.trial_start_date,
  s.trial_end_date,
  s.plan_start_date,
  s.plan_expiry_date,
  s.whatsapp_enabled,
  s.ai_call_enabled
FROM public.library_subscriptions s;
