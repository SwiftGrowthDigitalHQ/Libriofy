-- Compatibility views for requested schema naming
CREATE OR REPLACE VIEW public.users AS
SELECT
  p.id,
  p.user_id,
  p.full_name AS name,
  p.email,
  p.phone_number AS phone,
  p.is_phone_verified,
  p.created_at,
  p.updated_at
FROM public.profiles p;

CREATE OR REPLACE VIEW public.subscriptions AS
SELECT
  s.id,
  s.library_id,
  s.plan_name AS plan,
  s.price,
  s.seats_limit AS seat_limit,
  s.status,
  s.started_at,
  s.expires_at,
  s.created_at,
  s.updated_at
FROM public.library_subscriptions s;

CREATE OR REPLACE VIEW public.attendance AS
SELECT
  a.id,
  a.library_id,
  a.student_id,
  a.check_in,
  a.check_out,
  a.date,
  a.created_at
FROM public.attendance_logs a;

-- Subscription payment ledger for Razorpay transactions
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.library_subscriptions(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  razorpay_order_id TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'captured', 'failed')),
  months_purchased INTEGER NOT NULL DEFAULT 1,
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all subscription payments"
ON public.subscription_payments
FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Owners can view own subscription payments"
ON public.subscription_payments
FOR SELECT
USING (
  library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid())
);

DROP TRIGGER IF EXISTS update_subscription_payments_updated_at ON public.subscription_payments;
CREATE TRIGGER update_subscription_payments_updated_at
BEFORE UPDATE ON public.subscription_payments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_subscription_payments_library_id ON public.subscription_payments(library_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_status ON public.subscription_payments(status);

-- Daily renewal and account locking for library SaaS subscriptions
CREATE OR REPLACE FUNCTION public.process_library_subscription_renewals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
  v_expired_count INT := 0;
  v_remind_7_count INT := 0;
  v_remind_1_count INT := 0;
BEGIN
  -- Lock expired subscriptions
  FOR v_sub IN
    SELECT ls.id, ls.library_id, ls.plan_name, ls.expires_at
    FROM public.library_subscriptions ls
    WHERE ls.status IN ('active', 'trial')
      AND ls.expires_at IS NOT NULL
      AND ls.expires_at < now()
  LOOP
    UPDATE public.library_subscriptions
    SET status = 'expired'
    WHERE id = v_sub.id;

    INSERT INTO public.notifications (library_id, type, title, message)
    VALUES (
      v_sub.library_id,
      'subscription_expired',
      'Subscription expired',
      'Your ' || v_sub.plan_name || ' plan expired on ' || to_char(v_sub.expires_at, 'DD Mon YYYY HH24:MI')
    );

    v_expired_count := v_expired_count + 1;
  END LOOP;

  -- 7-day reminder
  FOR v_sub IN
    SELECT ls.id, ls.library_id, ls.plan_name, ls.expires_at
    FROM public.library_subscriptions ls
    WHERE ls.status IN ('active', 'trial')
      AND ls.expires_at IS NOT NULL
      AND ls.expires_at::date = (CURRENT_DATE + 7)
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.library_id = ls.library_id
          AND n.type = 'subscription_reminder_7day'
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    INSERT INTO public.notifications (library_id, type, title, message)
    VALUES (
      v_sub.library_id,
      'subscription_reminder_7day',
      'Subscription renewal reminder',
      'Your ' || v_sub.plan_name || ' plan expires in 7 days on ' || to_char(v_sub.expires_at, 'DD Mon YYYY')
    );
    v_remind_7_count := v_remind_7_count + 1;
  END LOOP;

  -- 1-day reminder
  FOR v_sub IN
    SELECT ls.id, ls.library_id, ls.plan_name, ls.expires_at
    FROM public.library_subscriptions ls
    WHERE ls.status IN ('active', 'trial')
      AND ls.expires_at IS NOT NULL
      AND ls.expires_at::date = (CURRENT_DATE + 1)
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.library_id = ls.library_id
          AND n.type = 'subscription_reminder_1day'
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    INSERT INTO public.notifications (library_id, type, title, message)
    VALUES (
      v_sub.library_id,
      'subscription_reminder_1day',
      'Subscription expires tomorrow',
      'Your ' || v_sub.plan_name || ' plan expires tomorrow (' || to_char(v_sub.expires_at, 'DD Mon YYYY') || ').'
    );
    v_remind_1_count := v_remind_1_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'expired', v_expired_count,
    'reminder_7day', v_remind_7_count,
    'reminder_1day', v_remind_1_count
  );
END;
$$;
