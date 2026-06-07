-- Remove stale attendance RPC overloads that confuse PostgREST function resolution.
-- Keep the canonical wrapper signatures only.

DROP FUNCTION IF EXISTS public.qr_check_in(TEXT, UUID);
DROP FUNCTION IF EXISTS public.qr_check_in(TEXT, UUID, TEXT, TIMESTAMPTZ);

DROP FUNCTION IF EXISTS public.scan_attendance_entry(UUID, TEXT);
DROP FUNCTION IF EXISTS public.scan_attendance_entry(TEXT, UUID, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.qr_check_in(
  p_student_id UUID DEFAULT NULL,
  p_qr_code TEXT DEFAULT NULL,
  p_library_id UUID DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_entry_id TEXT DEFAULT NULL,
  p_entry_timestamp TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.process_attendance_scan(
    '/rpc/qr_check_in',
    p_student_id,
    p_qr_code,
    p_library_id,
    p_device_id,
    p_entry_id,
    p_entry_timestamp
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_attendance_entry(
  p_student_id UUID DEFAULT NULL,
  p_qr_code TEXT DEFAULT NULL,
  p_library_id UUID DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_entry_id TEXT DEFAULT NULL,
  p_entry_timestamp TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.process_attendance_scan(
    '/rpc/scan_attendance_entry',
    p_student_id,
    p_qr_code,
    p_library_id,
    p_device_id,
    p_entry_id,
    p_entry_timestamp
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
