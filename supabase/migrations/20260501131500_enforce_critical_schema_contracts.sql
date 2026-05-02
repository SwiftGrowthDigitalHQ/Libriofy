CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.generate_library_access_key_value()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_key TEXT := 'LIB-';
  v_bytes BYTEA := extensions.gen_random_bytes(6);
  v_index INTEGER;
BEGIN
  FOR v_index IN 0..5 LOOP
    v_key := v_key || substr(v_alphabet, (get_byte(v_bytes, v_index) % length(v_alphabet)) + 1, 1);
  END LOOP;

  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.pull_device_commands(
  p_library_id UUID,
  p_device_id TEXT,
  p_library_access_key TEXT,
  p_device_token TEXT,
  p_limit INTEGER DEFAULT 5
)
RETURNS SETOF public.device_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved_library_id UUID;
  v_device RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 25);
  v_expected_hash TEXT;
BEGIN
  IF p_library_id IS NULL OR btrim(COALESCE(p_device_id, '')) = '' OR btrim(COALESCE(p_library_access_key, '')) = '' THEN
    RAISE EXCEPTION 'library_id, device_id, and library_access_key are required';
  END IF;

  SELECT library_id
  INTO v_resolved_library_id
  FROM public.library_access_keys
  WHERE access_key = btrim(p_library_access_key)
  LIMIT 1;

  IF NOT FOUND OR v_resolved_library_id IS NULL THEN
    RAISE EXCEPTION 'Invalid library access key';
  END IF;

  IF v_resolved_library_id <> p_library_id THEN
    RAISE EXCEPTION 'Library access key does not match this library';
  END IF;

  SELECT
    id,
    library_id,
    secret_token_hash
  INTO v_device
  FROM public.entry_devices
  WHERE device_id = btrim(p_device_id)
    AND library_id = p_library_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  IF v_device.secret_token_hash IS NOT NULL THEN
    IF btrim(COALESCE(p_device_token, '')) = '' THEN
      RAISE EXCEPTION 'Device token missing';
    END IF;

    SELECT encode(extensions.digest(btrim(p_device_token), 'sha256'), 'hex')
    INTO v_expected_hash;

    IF v_expected_hash IS NULL OR v_expected_hash <> v_device.secret_token_hash THEN
      RAISE EXCEPTION 'Device token invalid';
    END IF;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.device_commands
  WHERE library_id = p_library_id
    AND device_id = btrim(p_device_id)
    AND status = 'pending'
  ORDER BY requested_at ASC
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_device_command_status(
  p_library_id UUID,
  p_device_id TEXT,
  p_library_access_key TEXT,
  p_device_token TEXT,
  p_command_id UUID,
  p_status TEXT,
  p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.device_commands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved_library_id UUID;
  v_device RECORD;
  v_command public.device_commands;
  v_now TIMESTAMPTZ := now();
  v_expected_hash TEXT;
  v_next_status TEXT;
  v_next_control JSONB;
  v_is_terminal BOOLEAN;
BEGIN
  IF p_library_id IS NULL OR btrim(COALESCE(p_device_id, '')) = '' OR btrim(COALESCE(p_library_access_key, '')) = '' OR p_command_id IS NULL THEN
    RAISE EXCEPTION 'library_id, device_id, library_access_key, and command_id are required';
  END IF;

  IF btrim(COALESCE(p_status, '')) = '' THEN
    RAISE EXCEPTION 'status is required';
  END IF;

  IF p_status NOT IN ('acknowledged', 'completed', 'failed') THEN
    RAISE EXCEPTION 'Unsupported command status';
  END IF;

  SELECT library_id
  INTO v_resolved_library_id
  FROM public.library_access_keys
  WHERE access_key = btrim(p_library_access_key)
  LIMIT 1;

  IF NOT FOUND OR v_resolved_library_id IS NULL THEN
    RAISE EXCEPTION 'Invalid library access key';
  END IF;

  IF v_resolved_library_id <> p_library_id THEN
    RAISE EXCEPTION 'Library access key does not match this library';
  END IF;

  SELECT
    id,
    library_id,
    secret_token_hash,
    metadata
  INTO v_device
  FROM public.entry_devices
  WHERE device_id = btrim(p_device_id)
    AND library_id = p_library_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  IF v_device.secret_token_hash IS NOT NULL THEN
    IF btrim(COALESCE(p_device_token, '')) = '' THEN
      RAISE EXCEPTION 'Device token missing';
    END IF;

    SELECT encode(extensions.digest(btrim(p_device_token), 'sha256'), 'hex')
    INTO v_expected_hash;

    IF v_expected_hash IS NULL OR v_expected_hash <> v_device.secret_token_hash THEN
      RAISE EXCEPTION 'Device token invalid';
    END IF;
  END IF;

  SELECT *
  INTO v_command
  FROM public.device_commands
  WHERE id = p_command_id
    AND library_id = p_library_id
    AND device_id = btrim(p_device_id)
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Command not found';
  END IF;

  v_is_terminal := p_status IN ('completed', 'failed');
  v_next_status := CASE
    WHEN v_command.command_type = 'disable_device' THEN 'disabled'
    WHEN v_is_terminal THEN 'active'
    ELSE COALESCE((v_device.metadata->'device_control'->>'status'), 'active')
  END;

  UPDATE public.device_commands
  SET
    status = p_status,
    acknowledged_at = CASE
      WHEN p_status = 'acknowledged' THEN COALESCE(acknowledged_at, v_now)
      WHEN p_status = 'completed' THEN COALESCE(acknowledged_at, v_now)
      ELSE acknowledged_at
    END,
    completed_at = CASE
      WHEN p_status = 'completed' THEN COALESCE(completed_at, v_now)
      ELSE completed_at
    END,
    failed_at = CASE
      WHEN p_status = 'failed' THEN COALESCE(failed_at, v_now)
      ELSE failed_at
    END,
    error_message = CASE
      WHEN p_status = 'failed' THEN COALESCE(NULLIF(btrim(p_error_message), ''), error_message)
      ELSE error_message
    END,
    metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
    updated_at = v_now
  WHERE id = v_command.id
  RETURNING * INTO v_command;

  v_next_control := COALESCE(v_device.metadata->'device_control', '{}'::jsonb) || jsonb_build_object(
    'status', v_next_status,
    'current_command_id', CASE WHEN v_is_terminal THEN NULL ELSE v_command.id::text END,
    'current_command_type', CASE WHEN v_is_terminal THEN NULL ELSE v_command.command_type END,
    'current_command_status', CASE WHEN v_is_terminal THEN NULL ELSE p_status END,
    'current_command_requested_at', CASE WHEN v_is_terminal THEN NULL ELSE v_command.requested_at END,
    'current_command_error', CASE WHEN p_status = 'failed' THEN COALESCE(NULLIF(btrim(p_error_message), ''), v_command.error_message) ELSE NULL END,
    'last_command_id', v_command.id::text,
    'last_command_type', v_command.command_type,
    'last_command_status', p_status,
    'last_command_at', v_now,
    'last_command_error', CASE WHEN p_status = 'failed' THEN COALESCE(NULLIF(btrim(p_error_message), ''), v_command.error_message) ELSE NULL END
  );

  UPDATE public.entry_devices
  SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{device_control}',
    v_next_control,
    true
  )
  WHERE id = v_device.id;

  RETURN v_command;
END;
$$;

REVOKE ALL ON FUNCTION public.pull_device_commands(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_device_command_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.pull_device_commands(UUID, TEXT, TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.pull_device_commands(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pull_device_commands(UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;

GRANT EXECUTE ON FUNCTION public.record_device_command_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.record_device_command_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_device_command_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;

DROP VIEW IF EXISTS public.subscriptions;

CREATE VIEW public.subscriptions AS
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

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT ON public.subscriptions TO service_role;

DROP VIEW IF EXISTS public.recovery_queue;

CREATE VIEW public.recovery_queue
WITH (security_invoker = true) AS
WITH plan_price_stats AS (
  SELECT
    library_id,
    avg(price)::numeric AS average_price
  FROM public.plans
  WHERE is_active = true
  GROUP BY library_id
),
latest_period_end AS (
  SELECT DISTINCT ON (student_id)
    student_id,
    period_end
  FROM public.payments
  WHERE period_end IS NOT NULL
  ORDER BY student_id, created_at DESC, id DESC
),
payment_agg AS (
  SELECT
    student_id,
    coalesce(
      sum(
        CASE
          WHEN lower(coalesce(status, '')) IN ('approved', 'captured', 'completed', 'paid', 'success')
            THEN amount
          ELSE 0
        END
      ),
      0
    )::numeric AS amount_paid,
    count(*) FILTER (
      WHERE lower(coalesce(status, '')) IN ('approved', 'captured', 'completed', 'paid', 'success')
    )::integer AS successful_payment_count,
    max(created_at) FILTER (
      WHERE lower(coalesce(status, '')) IN ('approved', 'captured', 'completed', 'paid', 'success')
    ) AS last_payment_date
  FROM public.payments
  GROUP BY student_id
),
student_financials AS (
  SELECT
    s.library_id,
    s.id AS student_id,
    s.full_name AS student_name,
    s.phone,
    s.seat_number,
    coalesce(p.name, s.plan, 'Plan') AS plan_name,
    s.slot AS slot_label,
    coalesce(p.price, plan_price_stats.average_price, 0)::numeric AS total_fees,
    coalesce(payment_agg.amount_paid, 0)::numeric AS amount_paid,
    greatest(
      coalesce(p.price, plan_price_stats.average_price, 0)::numeric - coalesce(payment_agg.amount_paid, 0)::numeric,
      0
    )::numeric AS amount_due,
    coalesce(latest_period_end.period_end, s.expiry_date, s.start_date) AS due_date,
    coalesce(payment_agg.successful_payment_count, 0)::integer AS successful_payment_count,
    payment_agg.last_payment_date
  FROM public.students s
  LEFT JOIN public.plans p
    ON p.id = s.plan_id
  LEFT JOIN plan_price_stats
    ON plan_price_stats.library_id = s.library_id
  LEFT JOIN payment_agg
    ON payment_agg.student_id = s.id
  LEFT JOIN latest_period_end
    ON latest_period_end.student_id = s.id
)
SELECT
  student_financials.library_id,
  student_financials.student_id,
  student_financials.student_name,
  student_financials.phone,
  student_financials.seat_number,
  student_financials.plan_name,
  student_financials.slot_label,
  student_financials.total_fees,
  student_financials.amount_paid,
  student_financials.amount_due,
  student_financials.due_date,
  CASE
    WHEN student_financials.amount_due > 0 AND student_financials.due_date IS NOT NULL
      THEN greatest((current_date - student_financials.due_date::date), 0)
    ELSE 0
  END::integer AS overdue_days,
  CASE
    WHEN student_financials.amount_due <= 0 THEN 'paid'
    WHEN student_financials.due_date IS NOT NULL AND student_financials.due_date::date < current_date THEN 'overdue'
    ELSE 'pending'
  END AS queue_status,
  CASE
    WHEN student_financials.amount_due <= 0 THEN 'Paid'
    WHEN student_financials.due_date IS NOT NULL AND student_financials.due_date::date < current_date THEN
      CASE
        WHEN greatest((current_date - student_financials.due_date::date), 0) >= 7 THEN 'Seat cancellation warning'
        WHEN greatest((current_date - student_financials.due_date::date), 0) >= 5 THEN 'Call alert'
        WHEN greatest((current_date - student_financials.due_date::date), 0) >= 2 THEN 'Follow-up reminder'
        ELSE 'WhatsApp reminder'
      END
    ELSE 'Upcoming follow-up'
  END AS recovery_urgency_label,
  student_financials.successful_payment_count,
  student_financials.last_payment_date
FROM student_financials;

GRANT SELECT ON public.recovery_queue TO authenticated;
GRANT SELECT ON public.recovery_queue TO service_role;

CREATE OR REPLACE FUNCTION public.get_schema_entity_status(p_entities TEXT[])
RETURNS TABLE (
  entity_name TEXT,
  exists_in_schema BOOLEAN,
  relation_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH requested_entities AS (
    SELECT trim(entity_name) AS entity_name
    FROM unnest(COALESCE(p_entities, ARRAY[]::TEXT[])) AS entity_name
    WHERE trim(entity_name) <> ''
  )
  SELECT
    requested_entities.entity_name,
    to_regclass(format('public.%I', requested_entities.entity_name)) IS NOT NULL AS exists_in_schema,
    to_regclass(format('public.%I', requested_entities.entity_name))::TEXT AS relation_name
  FROM requested_entities;
$$;

REVOKE ALL ON FUNCTION public.get_schema_entity_status(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_schema_entity_status(TEXT[]) TO service_role;
