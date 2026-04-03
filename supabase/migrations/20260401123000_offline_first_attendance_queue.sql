ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS entry_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_entry_id
  ON public.attendance_logs(entry_id);

CREATE OR REPLACE FUNCTION public.qr_check_in(
  p_qr_code TEXT,
  p_library_id UUID,
  p_entry_id TEXT DEFAULT NULL,
  p_entry_timestamp TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_existing RECORD;
  v_log_id UUID;
  v_slot_label TEXT;
  v_entry_id TEXT;
  v_entry_timestamp TIMESTAMPTZ;
BEGIN
  v_entry_id := COALESCE(NULLIF(trim(p_entry_id), ''), gen_random_uuid()::text);
  v_entry_timestamp := COALESCE(p_entry_timestamp, now());

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
              THEN ' - ' || to_char(ts.start_time::time, 'HH12:MI AM') || ' - ' || to_char(ts.end_time::time, 'HH12:MI AM')
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
  INTO v_existing
  FROM public.attendance_logs
  WHERE entry_id = v_entry_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'name', v_student.full_name,
      'seat', COALESCE(NULLIF(v_student.seat_number, ''), 'Unassigned'),
      'time', v_slot_label,
      'message', 'Entry already recorded',
      'duplicate', true
    );
  END IF;

  SELECT * INTO v_existing FROM public.attendance_logs
  WHERE student_id = v_student.id AND date = CURRENT_DATE AND check_out IS NULL;

  IF FOUND THEN
    UPDATE public.attendance_logs SET check_out = v_entry_timestamp WHERE id = v_existing.id;
    RETURN jsonb_build_object(
      'status', 'success',
      'name', v_student.full_name,
      'seat', COALESCE(NULLIF(v_student.seat_number, ''), 'Unassigned'),
      'time', v_slot_label,
      'message', 'Entry already logged for today',
      'duplicate', true
    );
  ELSE
    INSERT INTO public.attendance_logs (entry_id, student_id, library_id, check_in, date)
    VALUES (v_entry_id, v_student.id, p_library_id, v_entry_timestamp, v_entry_timestamp::date)
    RETURNING id INTO v_log_id;
    
    UPDATE public.students SET last_check_in = v_entry_timestamp, no_show_days = 0 WHERE id = v_student.id;
    
    RETURN jsonb_build_object(
      'status', 'success',
      'name', v_student.full_name,
      'seat', COALESCE(NULLIF(v_student.seat_number, ''), 'Unassigned'),
      'time', v_slot_label,
      'message', 'Entry logged successfully'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.qr_check_in(TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_check_in(TEXT, UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qr_check_in(TEXT, UUID, TEXT, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.scan_attendance_entry(
  p_library_id UUID,
  p_qr_code TEXT,
  p_entry_id TEXT DEFAULT NULL,
  p_entry_timestamp TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_existing_log_id UUID;
  v_duplicate_entry_id UUID;
  v_slot_label TEXT;
  v_entry_id TEXT;
  v_entry_timestamp TIMESTAMPTZ;
BEGIN
  v_entry_id := COALESCE(NULLIF(trim(p_entry_id), ''), gen_random_uuid()::text);
  v_entry_timestamp := COALESCE(p_entry_timestamp, now());

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
              THEN ' - ' || to_char(ts.start_time::time, 'HH12:MI AM') || ' - ' || to_char(ts.end_time::time, 'HH12:MI AM')
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
  INTO v_duplicate_entry_id
  FROM public.attendance_logs
  WHERE entry_id = v_entry_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'name', v_student.full_name,
      'seat', COALESCE(NULLIF(v_student.seat_number, ''), 'Unassigned'),
      'time', v_slot_label,
      'message', 'Entry already recorded',
      'duplicate', true
    );
  END IF;

  SELECT id
  INTO v_existing_log_id
  FROM public.attendance_logs
  WHERE student_id = v_student.id
    AND library_id = p_library_id
    AND date = v_entry_timestamp::date
  ORDER BY check_in DESC
  LIMIT 1;

  IF v_existing_log_id IS NULL THEN
    INSERT INTO public.attendance_logs (entry_id, student_id, library_id, check_in, date)
    VALUES (v_entry_id, v_student.id, p_library_id, v_entry_timestamp, v_entry_timestamp::date);
  END IF;

  UPDATE public.students
  SET last_check_in = v_entry_timestamp,
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
    END,
    'duplicate', v_existing_log_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.scan_attendance_entry(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_attendance_entry(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
