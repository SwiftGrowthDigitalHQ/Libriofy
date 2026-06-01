ALTER TABLE public.platform_job_queue
  ADD COLUMN IF NOT EXISTS deduplication_key TEXT,
  ADD COLUMN IF NOT EXISTS concurrency_key TEXT,
  ADD COLUMN IF NOT EXISTS max_concurrency INTEGER,
  ADD COLUMN IF NOT EXISTS claim_token TEXT,
  ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility_timeout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_request_id TEXT,
  ADD COLUMN IF NOT EXISTS source_correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS source_trace_id TEXT;

UPDATE public.platform_job_queue
SET
  deduplication_key = COALESCE(
    deduplication_key,
    NULLIF(payload #>> '{_queue,deduplicationKey}', ''),
    NULLIF(payload #>> '{_queue,idempotencyKey}', ''),
    lower(trim(job_type))
  ),
  concurrency_key = COALESCE(
    concurrency_key,
    NULLIF(payload #>> '{_queue,concurrencyKey}', ''),
    NULLIF(payload ->> 'libraryId', ''),
    NULLIF(payload ->> 'library_id', ''),
    lower(trim(job_type))
  ),
  max_concurrency = COALESCE(
    max_concurrency,
    GREATEST(
      1,
      COALESCE(
        NULLIF(payload #>> '{_queue,maxConcurrency}', '')::INTEGER,
        NULLIF(payload ->> 'maxConcurrency', '')::INTEGER,
        NULLIF(payload ->> 'max_concurrency', '')::INTEGER,
        1
      )
    )
  ),
  visibility_timeout_at = COALESCE(visibility_timeout_at, NULLIF(payload #>> '{_queue,visibilityTimeoutAt}', '')::TIMESTAMPTZ),
  last_heartbeat_at = COALESCE(last_heartbeat_at, NULLIF(payload #>> '{_queue,lastHeartbeatAt}', '')::TIMESTAMPTZ),
  cancel_requested_at = COALESCE(cancel_requested_at, NULLIF(payload #>> '{_queue,cancelRequestedAt}', '')::TIMESTAMPTZ),
  cancelled_at = COALESCE(cancelled_at, NULLIF(payload #>> '{_queue,cancelledAt}', '')::TIMESTAMPTZ),
  cancellation_reason = COALESCE(cancellation_reason, NULLIF(payload #>> '{_queue,cancellationReason}', '')),
  recovered_at = COALESCE(recovered_at, NULLIF(payload #>> '{_queue,recoveredAt}', '')::TIMESTAMPTZ),
  dead_lettered_at = COALESCE(dead_lettered_at, NULLIF(payload #>> '{_queue,deadLetteredAt}', '')::TIMESTAMPTZ),
  source_request_id = COALESCE(source_request_id, NULLIF(payload #>> '{_queue,trace,originRequestId}', '')),
  source_correlation_id = COALESCE(source_correlation_id, NULLIF(payload #>> '{_queue,trace,correlationId}', '')),
  source_trace_id = COALESCE(source_trace_id, NULLIF(payload #>> '{_queue,trace,traceId}', ''));

UPDATE public.platform_job_queue
SET max_concurrency = 1
WHERE max_concurrency IS NULL OR max_concurrency < 1;

ALTER TABLE public.platform_job_queue
  ALTER COLUMN max_concurrency SET DEFAULT 1;

ALTER TABLE public.platform_job_queue
  ALTER COLUMN max_concurrency SET NOT NULL;

CREATE INDEX IF NOT EXISTS platform_job_queue_deduplication_idx
  ON public.platform_job_queue (deduplication_key, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_job_queue_concurrency_running_idx
  ON public.platform_job_queue (concurrency_key, visibility_timeout_at DESC)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS platform_job_queue_visibility_idx
  ON public.platform_job_queue (status, visibility_timeout_at ASC);

CREATE INDEX IF NOT EXISTS platform_job_queue_claim_token_idx
  ON public.platform_job_queue (claim_token)
  WHERE claim_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.platform_job_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.platform_job_queue(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  job_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  dead_lettered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_request_id TEXT,
  source_correlation_id TEXT,
  source_trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_job_dead_letters_job_dead_lettered_idx
  ON public.platform_job_dead_letters (job_id, dead_lettered_at);

ALTER TABLE public.platform_job_dead_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage platform job dead letters" ON public.platform_job_dead_letters;
CREATE POLICY "Super admins manage platform job dead letters"
  ON public.platform_job_dead_letters
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Service role manages platform job dead letters" ON public.platform_job_dead_letters;
CREATE POLICY "Service role manages platform job dead letters"
  ON public.platform_job_dead_letters
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.platform_job_dead_letters FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_job_dead_letters TO service_role;

INSERT INTO public.platform_job_dead_letters (
  job_id,
  job_type,
  job_payload,
  error_message,
  attempts,
  max_attempts,
  dead_lettered_at,
  source_request_id,
  source_correlation_id,
  source_trace_id
)
SELECT
  id,
  job_type,
  payload,
  last_error,
  attempts,
  max_attempts,
  dead_lettered_at,
  source_request_id,
  source_correlation_id,
  source_trace_id
FROM public.platform_job_queue
WHERE dead_lettered_at IS NOT NULL
ON CONFLICT (job_id, dead_lettered_at) DO NOTHING;

ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS capture_source TEXT,
  ADD COLUMN IF NOT EXISTS capture_request_id TEXT,
  ADD COLUMN IF NOT EXISTS capture_correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS capture_trace_id TEXT,
  ADD COLUMN IF NOT EXISTS capture_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_processing_error TEXT;

CREATE INDEX IF NOT EXISTS subscription_payments_idempotency_idx
  ON public.subscription_payments (library_id, idempotency_key, created_at DESC)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.process_subscription_payment_capture(
  p_razorpay_order_id TEXT,
  p_razorpay_payment_id TEXT,
  p_razorpay_signature TEXT DEFAULT NULL,
  p_capture_source TEXT DEFAULT 'payment_verification',
  p_request_id TEXT DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL,
  p_trace_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.subscription_payments%ROWTYPE;
  v_subscription public.library_subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_acquisition public.library_acquisition%ROWTYPE;
  v_affiliate public.affiliates%ROWTYPE;
  v_metadata JSONB;
  v_plan_id_text TEXT;
  v_plan_found BOOLEAN := false;
  v_plan_code TEXT;
  v_plan_name TEXT;
  v_plan_description TEXT;
  v_plan_price NUMERIC;
  v_plan_seats_limit INTEGER;
  v_plan_lockers_limit INTEGER;
  v_plan_features JSONB;
  v_current_expiry TIMESTAMPTZ;
  v_base_expiry TIMESTAMPTZ;
  v_next_expiry TIMESTAMPTZ;
  v_activated_at TIMESTAMPTZ := now();
  v_captured_at TIMESTAMPTZ := now();
  v_prior_captured_count INTEGER := 0;
  v_months INTEGER := 1;
  v_reward_amount NUMERIC(12, 2);
  v_commission_rate NUMERIC(5, 2);
  v_commission_earned NUMERIC(12, 2);
BEGIN
  SELECT *
  INTO v_payment
  FROM public.subscription_payments
  WHERE razorpay_order_id = p_razorpay_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription payment not found for order %', p_razorpay_order_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_subscription
  FROM public.library_subscriptions
  WHERE id = v_payment.subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subscription record not found for payment %', v_payment.id
      USING ERRCODE = 'P0002';
  END IF;

  v_metadata := COALESCE(v_payment.metadata, '{}'::jsonb);
  v_plan_id_text := NULLIF(trim(COALESCE(v_metadata->>'plan_id', '')), '');
  v_plan_code := lower(trim(COALESCE(v_metadata->>'plan_code', v_metadata->>'plan_name', v_metadata->>'plan', v_subscription.plan_name, '')));
  v_plan_found := false;

  IF v_plan_id_text IS NOT NULL AND v_plan_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    SELECT *
    INTO v_plan
    FROM public.subscription_plans
    WHERE id = v_plan_id_text::uuid;
    v_plan_found := FOUND;
  END IF;

  IF NOT v_plan_found THEN
    IF v_plan_code = '' THEN
      RAISE EXCEPTION 'Payment metadata is missing plan_code for order %', p_razorpay_order_id
        USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_plan
    FROM public.subscription_plans
    WHERE code = v_plan_code;
    v_plan_found := FOUND;
  END IF;

  IF NOT v_plan_found THEN
    RAISE EXCEPTION 'Payment metadata plan reference is invalid for order %', p_razorpay_order_id
      USING ERRCODE = 'P0002';
  END IF;

  v_plan_id_text := v_plan.id::text;
  v_plan_code := COALESCE(lower(NULLIF(v_plan.code, '')), v_plan_code, 'starter');
  v_plan_price := COALESCE(NULLIF(v_metadata->>'plan_price', '')::NUMERIC, v_plan.price, COALESCE(v_subscription.plan_price, v_subscription.price, 0));
  v_plan_name := COALESCE(NULLIF(trim(v_metadata->>'plan_name'), ''), v_plan.name, v_plan_code);
  v_plan_description := COALESCE(NULLIF(trim(v_metadata->>'plan_description'), ''), v_plan.description);
  v_plan_seats_limit := COALESCE(
    NULLIF(v_metadata->>'plan_seats_limit', '')::INTEGER,
    v_plan.seats_limit,
    v_subscription.seats_limit,
    0
  );
  v_plan_lockers_limit := COALESCE(
    NULLIF(v_metadata->>'plan_lockers_limit', '')::INTEGER,
    v_plan.lockers_limit,
    v_subscription.lockers_limit,
    0
  );
  v_plan_features := COALESCE(
    CASE
      WHEN jsonb_typeof(v_metadata->'plan_features') = 'array' THEN v_metadata->'plan_features'
      ELSE NULL
    END,
    v_plan.features,
    COALESCE(v_subscription.features, '[]'::jsonb)
  );
  v_months := GREATEST(COALESCE(v_payment.months_purchased, 1), 1);

  IF v_payment.status = 'paid' THEN
    UPDATE public.subscription_payments
    SET
      razorpay_payment_id = COALESCE(NULLIF(p_razorpay_payment_id, ''), razorpay_payment_id),
      razorpay_signature = COALESCE(NULLIF(p_razorpay_signature, ''), razorpay_signature),
      capture_source = COALESCE(NULLIF(p_capture_source, ''), capture_source),
      capture_request_id = COALESCE(NULLIF(p_request_id, ''), capture_request_id),
      capture_correlation_id = COALESCE(NULLIF(p_correlation_id, ''), capture_correlation_id),
      capture_trace_id = COALESCE(NULLIF(p_trace_id, ''), capture_trace_id),
      capture_processed_at = COALESCE(capture_processed_at, now()),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'capture_source', COALESCE(NULLIF(p_capture_source, ''), capture_source),
        'capture_request_id', COALESCE(NULLIF(p_request_id, ''), capture_request_id),
        'capture_correlation_id', COALESCE(NULLIF(p_correlation_id, ''), capture_correlation_id),
        'capture_trace_id', COALESCE(NULLIF(p_trace_id, ''), capture_trace_id),
        'plan_id', v_plan_id_text,
        'plan_code', v_plan_code
      )
    WHERE id = v_payment.id;

    RETURN jsonb_build_object(
      'already_captured', true,
      'amount', v_payment.amount,
      'expires_at', COALESCE(v_subscription.plan_expiry_date, v_subscription.expires_at),
      'library_id', v_payment.library_id,
      'payment_id', COALESCE(NULLIF(p_razorpay_payment_id, ''), v_payment.razorpay_payment_id),
      'plan', jsonb_build_object(
        'id', v_plan_id_text,
        'code', v_plan_code,
        'description', v_plan_description,
        'name', v_plan_name
      ),
      'status', 'paid',
      'subscription_payment_id', v_payment.id
    );
  END IF;

  SELECT COUNT(*)
  INTO v_prior_captured_count
  FROM public.subscription_payments
  WHERE library_id = v_payment.library_id
    AND status = 'paid'
    AND id <> v_payment.id;

  v_current_expiry := COALESCE(v_subscription.plan_expiry_date, v_subscription.expires_at);
  v_base_expiry := CASE
    WHEN v_current_expiry IS NOT NULL AND v_current_expiry > v_activated_at THEN v_current_expiry
    ELSE v_activated_at
  END;
  v_next_expiry := v_base_expiry + make_interval(days => 30 * v_months);

  UPDATE public.subscription_payments
  SET
    capture_correlation_id = NULLIF(p_correlation_id, ''),
    capture_processed_at = v_captured_at,
    capture_request_id = NULLIF(p_request_id, ''),
    capture_source = NULLIF(p_capture_source, ''),
    capture_trace_id = NULLIF(p_trace_id, ''),
    idempotency_key = COALESCE(idempotency_key, md5(v_payment.library_id::text || ':' || p_razorpay_order_id)),
    last_processing_error = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'capture_correlation_id', NULLIF(p_correlation_id, ''),
      'capture_processed_at', v_captured_at,
      'capture_request_id', NULLIF(p_request_id, ''),
      'capture_source', NULLIF(p_capture_source, ''),
      'capture_trace_id', NULLIF(p_trace_id, ''),
      'plan_id', v_plan_id_text,
      'plan_code', v_plan_code
    ),
    paid_at = v_captured_at,
    razorpay_payment_id = NULLIF(p_razorpay_payment_id, ''),
    razorpay_signature = COALESCE(NULLIF(p_razorpay_signature, ''), razorpay_signature),
    status = 'paid'
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  UPDATE public.library_subscriptions
  SET
    expires_at = v_next_expiry,
    features = v_plan_features,
    lockers_limit = COALESCE(v_plan_lockers_limit, 0),
    payment_status = 'paid',
    plan_expiry_date = v_next_expiry,
    plan_name = v_plan_code,
    plan_price = v_plan_price,
    plan_start_date = v_activated_at,
    price = v_plan_price,
    seats_limit = COALESCE(v_plan_seats_limit, 0),
    started_at = v_activated_at,
    status = 'active'
  WHERE id = v_subscription.id
  RETURNING * INTO v_subscription;

  UPDATE public.coupon_redemptions
  SET
    captured_at = v_captured_at,
    status = 'captured',
    subscription_payment_id = v_payment.id
  WHERE razorpay_order_id = p_razorpay_order_id
    AND status = 'reserved';

  INSERT INTO public.notifications (
    library_id,
    type,
    title,
    message,
    metadata
  )
  VALUES (
    v_payment.library_id,
    'subscription_payment_success',
    'Subscription renewed successfully',
    'Payment captured (Razorpay: ' || COALESCE(NULLIF(p_razorpay_payment_id, ''), p_razorpay_order_id) || '). ' ||
      v_plan_name || ' plan extended to ' || to_char(v_next_expiry, 'DD Mon YYYY'),
    jsonb_build_object(
      'capture_source', NULLIF(p_capture_source, ''),
      'expires_at', v_next_expiry,
      'order_id', p_razorpay_order_id,
      'payment_id', NULLIF(p_razorpay_payment_id, ''),
      'plan_code', v_plan_code,
      'subscription_payment_id', v_payment.id
    )
  );

  IF v_prior_captured_count = 0 THEN
    SELECT owner_id, referred_by, affiliate_id
    INTO v_acquisition
    FROM public.library_acquisition
    WHERE library_id = v_payment.library_id;

    IF v_acquisition.owner_id IS NOT NULL
      AND v_acquisition.referred_by IS NOT NULL
      AND v_acquisition.referred_by <> v_acquisition.owner_id
    THEN
      v_reward_amount := LEAST(1000, floor(COALESCE(v_payment.amount, 0)::NUMERIC * 0.10));
      IF v_reward_amount > 0 THEN
        INSERT INTO public.referral_rewards (
          referrer_user_id,
          referred_user_id,
          library_id,
          subscription_payment_id,
          amount,
          status
        )
        VALUES (
          v_acquisition.referred_by,
          v_acquisition.owner_id,
          v_payment.library_id,
          v_payment.id,
          v_reward_amount,
          'pending'
        )
        ON CONFLICT (subscription_payment_id) DO UPDATE
        SET
          amount = EXCLUDED.amount,
          library_id = EXCLUDED.library_id,
          referred_user_id = EXCLUDED.referred_user_id,
          referrer_user_id = EXCLUDED.referrer_user_id,
          status = 'pending';
      END IF;
    END IF;

    IF v_acquisition.owner_id IS NOT NULL
      AND v_acquisition.affiliate_id IS NOT NULL
    THEN
      SELECT id, commission_rate, is_active
      INTO v_affiliate
      FROM public.affiliates
      WHERE id = v_acquisition.affiliate_id;

      IF v_affiliate.id IS NOT NULL AND COALESCE(v_affiliate.is_active, false) THEN
        v_commission_rate := COALESCE(v_affiliate.commission_rate, 0);
        v_commission_earned := round((COALESCE(v_payment.amount, 0)::NUMERIC * v_commission_rate) / 100, 2);
        IF v_commission_earned > 0 THEN
          INSERT INTO public.affiliate_commissions (
            affiliate_id,
            library_id,
            user_id,
            subscription_payment_id,
            commission_rate,
            commission_earned,
            status
          )
          VALUES (
            v_acquisition.affiliate_id,
            v_payment.library_id,
            v_acquisition.owner_id,
            v_payment.id,
            v_commission_rate,
            v_commission_earned,
            'pending'
          )
          ON CONFLICT (subscription_payment_id) DO UPDATE
          SET
            affiliate_id = EXCLUDED.affiliate_id,
            commission_earned = EXCLUDED.commission_earned,
            commission_rate = EXCLUDED.commission_rate,
            library_id = EXCLUDED.library_id,
            status = 'pending',
            user_id = EXCLUDED.user_id;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'already_captured', false,
    'amount', v_payment.amount,
    'expires_at', v_next_expiry,
    'library_id', v_payment.library_id,
    'payment_id', COALESCE(NULLIF(p_razorpay_payment_id, ''), v_payment.razorpay_payment_id),
    'plan', jsonb_build_object(
      'id', v_plan_id_text,
      'code', v_plan_code,
      'description', v_plan_description,
      'name', v_plan_name
    ),
    'prior_captured_count', v_prior_captured_count,
    'status', 'paid',
    'subscription_payment_id', v_payment.id
  );
EXCEPTION
  WHEN OTHERS THEN
    UPDATE public.subscription_payments
    SET
      capture_processed_at = now(),
      capture_request_id = COALESCE(NULLIF(p_request_id, ''), capture_request_id),
      capture_correlation_id = COALESCE(NULLIF(p_correlation_id, ''), capture_correlation_id),
      capture_trace_id = COALESCE(NULLIF(p_trace_id, ''), capture_trace_id),
      capture_source = COALESCE(NULLIF(p_capture_source, ''), capture_source),
      last_processing_error = SQLERRM
    WHERE razorpay_order_id = p_razorpay_order_id;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_subscription_payment_capture(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_subscription_payment_capture(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
