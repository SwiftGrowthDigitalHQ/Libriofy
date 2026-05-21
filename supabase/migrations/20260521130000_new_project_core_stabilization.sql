CREATE OR REPLACE FUNCTION public.resolve_supabase_edge_function_url(p_function_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_url TEXT;
  v_function_name TEXT := regexp_replace(COALESCE(p_function_name, ''), '[^a-zA-Z0-9_-]', '', 'g');
BEGIN
  IF v_function_name = '' THEN
    RAISE EXCEPTION 'Edge Function name is required';
  END IF;

  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    EXECUTE
      'SELECT NULLIF(trim(value #>> ''{}''), '''') FROM public.platform_settings WHERE key = ''supabase_url'' LIMIT 1'
      INTO v_base_url;
  END IF;

  v_base_url := COALESCE(
    NULLIF(trim(COALESCE(v_base_url, '')), ''),
    NULLIF(trim(current_setting('app.settings.supabase_url', true)), ''),
    NULLIF(trim(current_setting('app.supabase_url', true)), '')
  );

  IF v_base_url IS NULL THEN
    RAISE EXCEPTION 'Supabase URL is not configured for Edge Function scheduler';
  END IF;

  RETURN regexp_replace(v_base_url, '/+$', '') || '/functions/v1/' || v_function_name;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_supabase_edge_function_url(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_supabase_edge_function_url(TEXT) TO service_role;

INSERT INTO public.platform_settings (key, value)
VALUES ('supabase_url', to_jsonb('https://hchflmrvmfvunedjhwta.supabase.co'::text))
ON CONFLICT (key) DO UPDATE
SET
  value = EXCLUDED.value,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.trigger_daily_renewal_reminder_scan()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := public.resolve_supabase_edge_function_url('process-renewals'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('source', 'daily_scheduler')
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_student_photo_cleanup()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := public.resolve_supabase_edge_function_url('cleanup-student-photo-assets'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('source', 'daily_scheduler')
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_student_id_card_delivery_processing()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := public.resolve_supabase_edge_function_url('process-student-id-card-deliveries'),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'source', 'id_card_delivery_scheduler',
      'limit', 10
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

DO $$
DECLARE
  v_table_name TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table_name IN ARRAY ARRAY[
      'attendance_logs',
      'device_commands',
      'entry_devices',
      'libraries',
      'library_subscriptions',
      'notifications',
      'payments',
      'students'
    ]
    LOOP
      IF to_regclass(format('public.%I', v_table_name)) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = v_table_name
        )
      THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table_name);
      END IF;
    END LOOP;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
