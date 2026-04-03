CREATE TABLE IF NOT EXISTS public.entry_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL UNIQUE,
  device_name TEXT,
  secret_token_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entry_devices_library ON public.entry_devices(library_id);
CREATE INDEX IF NOT EXISTS idx_entry_devices_active ON public.entry_devices(is_active);

ALTER TABLE public.entry_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage entry devices" ON public.entry_devices;
CREATE POLICY "Super admins can manage entry devices"
  ON public.entry_devices
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Library teams can manage own entry devices" ON public.entry_devices;
CREATE POLICY "Library teams can manage own entry devices"
  ON public.entry_devices
  FOR ALL
  USING (public.can_access_library(library_id, auth.uid()))
  WITH CHECK (public.can_access_library(library_id, auth.uid()));

DROP TRIGGER IF EXISTS update_entry_devices_updated_at ON public.entry_devices;
CREATE TRIGGER update_entry_devices_updated_at
  BEFORE UPDATE ON public.entry_devices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.scan_attendance_entry(p_library_id UUID, p_qr_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_existing_log_id UUID;
  v_slot_label TEXT;
BEGIN
  SELECT
    s.id,
    s.full_name,
    s.seat_number,
    s.slot,
    s.slot_id,
    s.status,
    s.expiry_date
  INTO v_student
  FROM public.students s
  WHERE s.library_id = p_library_id
    AND s.qr_code = p_qr_code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Invalid QR');
  END IF;

  IF v_student.expiry_date IS NOT NULL AND v_student.expiry_date < CURRENT_DATE THEN
    UPDATE public.students
    SET status = 'expired'
    WHERE id = v_student.id;

    RETURN jsonb_build_object('status', 'error', 'message', 'Plan expired');
  END IF;

  IF COALESCE(v_student.status, 'expired') <> 'active' THEN
    RETURN jsonb_build_object(
      'status',
      'error',
      'message',
      CASE
        WHEN v_student.status = 'expired' THEN 'Plan expired'
        WHEN v_student.status = 'inactive' THEN 'Plan inactive'
        ELSE 'Plan expired or not active'
      END
    );
  END IF;

  v_slot_label := COALESCE(NULLIF(v_student.slot, ''), 'General Access');

  IF v_student.slot_id IS NOT NULL THEN
    SELECT
      trim(
        concat(
          ts.name,
          CASE
            WHEN ts.start_time IS NOT NULL AND ts.end_time IS NOT NULL
              THEN ' • ' || to_char(ts.start_time::time, 'HH12:MI AM') || ' - ' || to_char(ts.end_time::time, 'HH12:MI AM')
            ELSE ''
          END
        )
      )
    INTO v_slot_label
    FROM public.time_slots ts
    WHERE ts.id = v_student.slot_id;
  END IF;

  v_slot_label := COALESCE(NULLIF(v_slot_label, ''), 'General Access');

  SELECT id
  INTO v_existing_log_id
  FROM public.attendance_logs
  WHERE student_id = v_student.id
    AND library_id = p_library_id
    AND date = CURRENT_DATE
  ORDER BY check_in DESC
  LIMIT 1;

  IF v_existing_log_id IS NULL THEN
    INSERT INTO public.attendance_logs (student_id, library_id)
    VALUES (v_student.id, p_library_id);
  END IF;

  UPDATE public.students
  SET last_check_in = now(),
      no_show_days = 0
  WHERE id = v_student.id;

  RETURN jsonb_build_object(
    'status', 'success',
    'name', v_student.full_name,
    'seat', COALESCE(NULLIF(v_student.seat_number, ''), 'Unassigned'),
    'time', v_slot_label,
    'message', CASE
      WHEN v_existing_log_id IS NULL THEN 'Entry logged successfully'
      ELSE 'Entry already logged for today'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.scan_attendance_entry(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_attendance_entry(UUID, TEXT) TO service_role;
