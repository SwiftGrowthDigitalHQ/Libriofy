CREATE INDEX IF NOT EXISTS idx_entry_devices_library_last_seen
  ON public.entry_devices(library_id, last_seen_at DESC);

DROP POLICY IF EXISTS "Library teams can manage own entry devices" ON public.entry_devices;
CREATE POLICY "Library teams can manage own entry devices"
  ON public.entry_devices
  FOR ALL
  TO authenticated
  USING (public.can_access_library(auth.uid(), library_id))
  WITH CHECK (public.can_access_library(auth.uid(), library_id));

CREATE OR REPLACE FUNCTION public.resolve_app_error_library_id(p_metadata JSONB)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    CASE
      WHEN jsonb_typeof(p_metadata->'library_id') = 'string'
        AND (p_metadata->>'library_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (p_metadata->>'library_id')::uuid
      ELSE NULL
    END,
    CASE
      WHEN jsonb_typeof(p_metadata->'expected_library_id') = 'string'
        AND (p_metadata->>'expected_library_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (p_metadata->>'expected_library_id')::uuid
      ELSE NULL
    END
  );
$$;

DROP POLICY IF EXISTS "Library teams can view own scanner error logs" ON public.app_error_logs;
CREATE POLICY "Library teams can view own scanner error logs"
  ON public.app_error_logs
  FOR SELECT
  TO authenticated
  USING (
    (
      route IN (
        '/api/scan-attendance',
        '/rpc/scan_attendance_entry',
        '/api/device-setup',
        '/api/device-heartbeat'
      )
      OR source IN (
        'scan-attendance-api',
        'scan-attendance-server',
        'device-setup-api',
        'device-setup-server',
        'device-heartbeat-api',
        'device-heartbeat-server'
      )
    )
    AND public.resolve_app_error_library_id(metadata) IS NOT NULL
    AND public.can_access_library(auth.uid(), public.resolve_app_error_library_id(metadata))
  );

CREATE INDEX IF NOT EXISTS idx_app_error_logs_source_created_at
  ON public.app_error_logs(source, created_at DESC);

REVOKE ALL ON FUNCTION public.resolve_app_error_library_id(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_app_error_library_id(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_app_error_library_id(JSONB) TO service_role;
