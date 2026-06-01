CREATE OR REPLACE FUNCTION public.ensure_library_subscription(
  p_library_id UUID,
  p_actor_user_id UUID DEFAULT auth.uid()
)
RETURNS public.library_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.library_subscriptions%ROWTYPE;
  v_library public.libraries%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_plan_code TEXT := 'starter';
  v_plan_price NUMERIC := 0;
  v_trial_start TIMESTAMPTZ;
  v_trial_end TIMESTAMPTZ;
  v_started_at TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_status TEXT;
  v_payment_status TEXT;
  v_months INTEGER := 1;
  v_latest_payment RECORD;
  v_plan_id_text TEXT;
  v_plan_found BOOLEAN := false;
  v_effective_actor UUID := COALESCE(p_actor_user_id, auth.uid());
  v_is_privileged_context BOOLEAN :=
    COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin');
  v_can_access BOOLEAN := false;
BEGIN
  IF p_library_id IS NULL THEN
    RAISE EXCEPTION 'library_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.library_subscriptions
  WHERE library_id = p_library_id
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT *
  INTO v_library
  FROM public.libraries
  WHERE id = p_library_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Library % was not found', p_library_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_privileged_context THEN
    IF v_effective_actor IS NULL THEN
      RAISE EXCEPTION 'An authenticated actor is required to ensure a library subscription row'
        USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = v_effective_actor
        AND (
          ur.role = 'super_admin'
          OR (
            ur.library_id = p_library_id
            AND ur.role IN ('library_owner', 'staff')
          )
        )
    ) OR v_library.owner_id = v_effective_actor
    INTO v_can_access;

    IF NOT v_can_access THEN
      RAISE EXCEPTION 'User % cannot ensure billing records for library %', v_effective_actor, p_library_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT *
  INTO v_plan
  FROM public.subscription_plans
  WHERE lower(code) = 'starter'
  ORDER BY is_active DESC, sort_order ASC NULLS LAST, created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT *
    INTO v_plan
    FROM public.subscription_plans
    ORDER BY is_active DESC, sort_order ASC NULLS LAST, created_at ASC
    LIMIT 1;
  END IF;

  v_plan_code := COALESCE(lower(NULLIF(v_plan.code, '')), 'starter');
  v_plan_price := COALESCE(v_plan.price, 0);
  v_trial_start := COALESCE(v_library.created_at, now());
  v_trial_end := v_trial_start + INTERVAL '30 days';

  SELECT
    COALESCE(sp.paid_at, sp.capture_processed_at, sp.created_at) AS effective_paid_at,
    GREATEST(COALESCE(sp.months_purchased, 1), 1) AS months_purchased,
    NULLIF(trim(COALESCE(sp.metadata->>'plan_id', '')), '') AS plan_id,
    NULLIF(trim(COALESCE(sp.metadata->>'plan_code', sp.metadata->>'plan_name', sp.metadata->>'plan', '')), '') AS plan_code,
    COALESCE(NULLIF(sp.metadata->>'plan_price', '')::NUMERIC, sp.amount) AS plan_price
  INTO v_latest_payment
  FROM public.subscription_payments sp
  WHERE sp.library_id = p_library_id
    AND sp.status = 'paid'
  ORDER BY COALESCE(sp.paid_at, sp.capture_processed_at, sp.created_at) DESC NULLS LAST, sp.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_started_at := COALESCE(v_latest_payment.effective_paid_at, now());
    v_months := GREATEST(COALESCE(v_latest_payment.months_purchased, 1), 1);
    v_expires_at := v_started_at + make_interval(days => 30 * v_months);
    v_plan_id_text := NULLIF(trim(v_latest_payment.plan_id), '');
    v_plan_code := COALESCE(lower(NULLIF(v_latest_payment.plan_code, '')), v_plan_code, 'starter');
    v_plan_found := false;

    IF v_plan_id_text IS NOT NULL AND v_plan_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      SELECT *
      INTO v_plan
      FROM public.subscription_plans
      WHERE id = v_plan_id_text::uuid
      LIMIT 1;
      v_plan_found := FOUND;
    END IF;

    IF NOT v_plan_found THEN
      SELECT *
      INTO v_plan
      FROM public.subscription_plans
      WHERE lower(code) = v_plan_code
      LIMIT 1;
      v_plan_found := FOUND;
    END IF;

    IF NOT v_plan_found THEN
      SELECT *
      INTO v_plan
      FROM public.subscription_plans
      WHERE lower(code) = 'starter'
      LIMIT 1;
      v_plan_found := FOUND;
    END IF;

    v_plan_code := COALESCE(lower(NULLIF(v_plan.code, '')), v_plan_code, 'starter');
    v_plan_price := COALESCE(v_latest_payment.plan_price, v_plan.price, v_plan_price, 0);
    v_status := CASE
      WHEN v_expires_at > now() THEN 'active'
      ELSE 'expired'
    END;
    v_payment_status := CASE
      WHEN v_expires_at > now() THEN 'paid'
      ELSE 'expired'
    END;

    INSERT INTO public.library_subscriptions (
      library_id,
      plan_name,
      price,
      plan_price,
      seats_limit,
      lockers_limit,
      features,
      status,
      started_at,
      expires_at,
      payment_status,
      plan_start_date,
      plan_expiry_date
    )
    VALUES (
      p_library_id,
      v_plan_code,
      v_plan_price,
      v_plan_price,
      COALESCE(v_plan.seats_limit, 50),
      COALESCE(v_plan.lockers_limit, 10),
      COALESCE(v_plan.features, '[]'::jsonb),
      v_status,
      v_started_at,
      v_expires_at,
      v_payment_status,
      v_started_at,
      v_expires_at
    )
    RETURNING * INTO v_existing;

    RETURN v_existing;
  END IF;

  v_status := CASE
    WHEN v_trial_end > now() THEN 'trial'
    ELSE 'expired'
  END;
  v_payment_status := CASE
    WHEN v_status = 'trial' THEN 'trial'
    ELSE 'expired'
  END;

  INSERT INTO public.library_subscriptions (
    library_id,
    plan_name,
    price,
    plan_price,
    seats_limit,
    lockers_limit,
    features,
    status,
    started_at,
    expires_at,
    trial_start_date,
    trial_end_date,
    payment_status
  )
  VALUES (
    p_library_id,
    v_plan_code,
    0,
    0,
    COALESCE(v_plan.seats_limit, 50),
    COALESCE(v_plan.lockers_limit, 10),
    COALESCE(v_plan.features, '[]'::jsonb),
    v_status,
    v_trial_start,
    v_trial_end,
    v_trial_start,
    v_trial_end,
    v_payment_status
  )
  RETURNING * INTO v_existing;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_library_subscription(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_library_subscription(UUID, UUID) TO service_role;

DO $$
DECLARE
  v_library RECORD;
BEGIN
  FOR v_library IN
    SELECT l.id
    FROM public.libraries l
    LEFT JOIN public.library_subscriptions ls
      ON ls.library_id = l.id
    WHERE ls.id IS NULL
  LOOP
    PERFORM public.ensure_library_subscription(v_library.id, NULL);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.get_billing_runtime_diagnostics(
  p_library_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_count INTEGER := 0;
  v_active_plan_count INTEGER := 0;
  v_missing_subscription_count INTEGER := 0;
  v_tables JSONB;
  v_rpcs JSONB;
  v_rls JSONB;
  v_policy_counts JSONB;
  v_grants JSONB;
  v_foreign_keys JSONB;
  v_requested_library JSONB := NULL;
  v_suspected_issue TEXT := NULL;
BEGIN
  SELECT COUNT(*)
  INTO v_plan_count
  FROM public.subscription_plans;

  SELECT COUNT(*)
  INTO v_active_plan_count
  FROM public.subscription_plans
  WHERE COALESCE(is_active, true);

  SELECT COUNT(*)
  INTO v_missing_subscription_count
  FROM public.libraries l
  LEFT JOIN public.library_subscriptions ls
    ON ls.library_id = l.id
  WHERE ls.id IS NULL;

  v_tables := jsonb_build_object(
    'billing_refunds', to_regclass('public.billing_refunds') IS NOT NULL,
    'coupons', to_regclass('public.coupons') IS NOT NULL,
    'coupon_redemptions', to_regclass('public.coupon_redemptions') IS NOT NULL,
    'libraries', to_regclass('public.libraries') IS NOT NULL,
    'library_subscriptions', to_regclass('public.library_subscriptions') IS NOT NULL,
    'payments', to_regclass('public.payments') IS NOT NULL,
    'subscription_payments', to_regclass('public.subscription_payments') IS NOT NULL,
    'subscription_plans', to_regclass('public.subscription_plans') IS NOT NULL
  );

  v_rpcs := jsonb_build_object(
    'ensure_library_subscription', to_regprocedure('public.ensure_library_subscription(uuid,uuid)') IS NOT NULL,
    'get_billing_runtime_diagnostics', to_regprocedure('public.get_billing_runtime_diagnostics(uuid)') IS NOT NULL,
    'process_subscription_payment_capture', to_regprocedure('public.process_subscription_payment_capture(text,text,text,text,text,text,text)') IS NOT NULL
  );

  v_rls := jsonb_build_object(
    'billing_refunds', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.billing_refunds'::regclass), false),
    'coupon_redemptions', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.coupon_redemptions'::regclass), false),
    'library_subscriptions', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.library_subscriptions'::regclass), false),
    'subscription_payments', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscription_payments'::regclass), false),
    'subscription_plans', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscription_plans'::regclass), false)
  );

  v_policy_counts := jsonb_build_object(
    'billing_refunds', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'billing_refunds'),
    'coupon_redemptions', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coupon_redemptions'),
    'library_subscriptions', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'library_subscriptions'),
    'subscription_payments', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_payments'),
    'subscription_plans', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_plans')
  );

  v_grants := jsonb_build_object(
    'authenticated', jsonb_build_object(
      'ensure_library_subscription_execute', has_function_privilege('authenticated', 'public.ensure_library_subscription(uuid,uuid)', 'EXECUTE'),
      'library_subscriptions_select', has_table_privilege('authenticated', 'public.library_subscriptions', 'SELECT'),
      'process_subscription_payment_capture_execute', has_function_privilege('authenticated', 'public.process_subscription_payment_capture(text,text,text,text,text,text,text)', 'EXECUTE'),
      'subscription_payments_select', has_table_privilege('authenticated', 'public.subscription_payments', 'SELECT'),
      'subscription_plans_select', has_table_privilege('authenticated', 'public.subscription_plans', 'SELECT')
    ),
    'service_role', jsonb_build_object(
      'ensure_library_subscription_execute', has_function_privilege('service_role', 'public.ensure_library_subscription(uuid,uuid)', 'EXECUTE'),
      'library_subscriptions_insert', has_table_privilege('service_role', 'public.library_subscriptions', 'INSERT'),
      'library_subscriptions_select', has_table_privilege('service_role', 'public.library_subscriptions', 'SELECT'),
      'process_subscription_payment_capture_execute', has_function_privilege('service_role', 'public.process_subscription_payment_capture(text,text,text,text,text,text,text)', 'EXECUTE'),
      'subscription_payments_insert', has_table_privilege('service_role', 'public.subscription_payments', 'INSERT'),
      'subscription_payments_select', has_table_privilege('service_role', 'public.subscription_payments', 'SELECT'),
      'subscription_plans_select', has_table_privilege('service_role', 'public.subscription_plans', 'SELECT')
    )
  );

  v_foreign_keys := jsonb_build_object(
    'library_subscriptions_library_id', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.library_subscriptions'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'public.libraries'::regclass
    ),
    'subscription_payments_library_id', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.subscription_payments'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'public.libraries'::regclass
    ),
    'subscription_payments_subscription_id', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.subscription_payments'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'public.library_subscriptions'::regclass
    )
  );

  IF p_library_id IS NOT NULL THEN
    v_requested_library := jsonb_build_object(
      'exists', EXISTS (
        SELECT 1
        FROM public.libraries
        WHERE id = p_library_id
      ),
      'library_id', p_library_id,
      'subscription_exists', EXISTS (
        SELECT 1
        FROM public.library_subscriptions
        WHERE library_id = p_library_id
      ),
      'subscription_status', (
        SELECT status
        FROM public.library_subscriptions
        WHERE library_id = p_library_id
        LIMIT 1
      )
    );
  END IF;

  v_suspected_issue := CASE
    WHEN NOT COALESCE((v_rpcs->>'ensure_library_subscription')::BOOLEAN, false) THEN 'ensure_library_subscription_missing'
    WHEN NOT COALESCE((v_rpcs->>'process_subscription_payment_capture')::BOOLEAN, false) THEN 'process_subscription_payment_capture_missing'
    WHEN v_plan_count = 0 THEN 'no_subscription_plans'
    WHEN v_missing_subscription_count > 0 THEN 'libraries_missing_subscription_rows'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'active_plan_count', v_active_plan_count,
    'foreign_keys', v_foreign_keys,
    'grants', v_grants,
    'missing_library_subscription_count', v_missing_subscription_count,
    'plan_count', v_plan_count,
    'policies', v_policy_counts,
    'requested_library', v_requested_library,
    'rls', v_rls,
    'rpcs', v_rpcs,
    'suspected_issue', v_suspected_issue,
    'tables', v_tables
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_billing_runtime_diagnostics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_billing_runtime_diagnostics(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
