ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_attendance_logs_device_id
  ON public.attendance_logs(device_id);

CREATE OR REPLACE FUNCTION public.get_student_id_profile(
  p_student_id UUID DEFAULT NULL,
  p_qr_code TEXT DEFAULT NULL,
  p_library_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_library RECORD;
  v_slot RECORD;
  v_status TEXT;
BEGIN
  IF p_student_id IS NOT NULL THEN
    SELECT *
    INTO v_student
    FROM public.students
    WHERE id = p_student_id
      AND (p_library_id IS NULL OR library_id = p_library_id)
    LIMIT 1;
  ELSE
    SELECT *
    INTO v_student
    FROM public.students
    WHERE qr_code = p_qr_code
      AND (p_library_id IS NULL OR library_id = p_library_id)
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid QR code');
  END IF;

  SELECT *
  INTO v_library
  FROM public.libraries
  WHERE id = v_student.library_id
  LIMIT 1;

  IF v_student.slot_id IS NOT NULL THEN
    SELECT *
    INTO v_slot
    FROM public.time_slots
    WHERE id = v_student.slot_id
    LIMIT 1;
  END IF;

  v_status := COALESCE(v_student.status, 'expired');
  IF v_student.expiry_date IS NOT NULL AND v_student.expiry_date < CURRENT_DATE THEN
    v_status := 'expired';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'id', v_student.id,
      'student_name', v_student.full_name,
      'seat_number', v_student.seat_number,
      'plan', v_student.plan,
      'slot_label', CASE
        WHEN v_slot.id IS NOT NULL THEN
          concat(
            v_slot.name,
            ' (',
            to_char(v_slot.start_time::time, 'HH12:MI AM'),
            ' - ',
            to_char(v_slot.end_time::time, 'HH12:MI AM'),
            ')'
          )
        ELSE v_student.slot
      END,
      'expiry_date', v_student.expiry_date,
      'status', v_status,
      'photo_url', v_student.photo_url,
      'photo_thumbnail_path', v_student.photo_thumbnail_path,
      'photo_version', v_student.photo_version,
      'library_id', v_student.library_id,
      'qr_code', v_student.qr_code,
      'library_name', COALESCE(v_library.library_name, v_library.name),
      'library_logo_url', v_library.logo_url,
      'library_primary_color', v_library.primary_color
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.qr_check_in(
  p_student_id UUID DEFAULT NULL,
  p_qr_code TEXT DEFAULT NULL,
  p_library_id UUID,
  p_device_id TEXT DEFAULT NULL,
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
  v_existing_entry RECORD;
  v_open_log RECORD;
  v_recent_log RECORD;
  v_slot_label TEXT;
  v_entry_id TEXT;
  v_entry_timestamp TIMESTAMPTZ;
BEGIN
  v_entry_id := COALESCE(NULLIF(trim(p_entry_id), ''), gen_random_uuid()::text);
  v_entry_timestamp := COALESCE(p_entry_timestamp, now());

  IF p_student_id IS NOT NULL THEN
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
    WHERE s.id = p_student_id
      AND s.library_id = p_library_id
    LIMIT 1;
  ELSE
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
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_QR', 'error', 'Invalid QR');
  END IF;

  IF v_student.expiry_date IS NOT NULL AND v_student.expiry_date < CURRENT_DATE THEN
    UPDATE public.students
    SET status = 'expired'
    WHERE id = v_student.id;

    RETURN jsonb_build_object('success', false, 'code', 'EXPIRED', 'error', 'Plan expired');
  END IF;

  IF COALESCE(v_student.status, 'expired') <> 'active' THEN
    RETURN jsonb_build_object(
      'success',
      false,
      'code',
      'EXPIRED',
      'error',
      CASE
        WHEN v_student.status = 'expired' THEN 'Plan expired'
        WHEN v_student.status = 'inactive' THEN 'Plan inactive'
        ELSE 'Plan expired or not active'
      END
    );
  END IF;

  SELECT *
  INTO v_existing_entry
  FROM public.attendance_logs
  WHERE entry_id = v_entry_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'check_in',
      'duplicate', true,
      'message', 'Entry already processed',
      'student_name', v_student.full_name,
      'seat', v_student.seat_number,
      'time', to_char(v_entry_timestamp, 'HH12:MI AM')
    );
  END IF;

  SELECT *
  INTO v_open_log
  FROM public.attendance_logs
  WHERE student_id = v_student.id
    AND library_id = p_library_id
    AND check_out IS NULL
  ORDER BY check_in DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ALREADY_INSIDE',
      'error', 'Student is already inside'
    );
  END IF;

  SELECT *
  INTO v_recent_log
  FROM public.attendance_logs
  WHERE student_id = v_student.id
    AND library_id = p_library_id
  ORDER BY check_in DESC
  LIMIT 1;

  IF FOUND AND v_recent_log.check_in > v_entry_timestamp - interval '15 minutes' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TOO_FREQUENT',
      'error', 'Please wait 15 minutes before scanning again'
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

  INSERT INTO public.attendance_logs (entry_id, student_id, library_id, device_id, check_in, date)
  VALUES (v_entry_id, v_student.id, p_library_id, p_device_id, v_entry_timestamp, v_entry_timestamp::date);

  UPDATE public.students
  SET last_check_in = v_entry_timestamp,
      no_show_days = 0
  WHERE id = v_student.id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'check_in',
    'student_name', v_student.full_name,
    'seat', v_student.seat_number,
    'time', to_char(v_entry_timestamp, 'HH12:MI AM'),
    'slot_label', v_slot_label,
    'entry_id', v_entry_id,
    'device_id', p_device_id,
    'duplicate', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_attendance_entry(
  p_student_id UUID DEFAULT NULL,
  p_qr_code TEXT DEFAULT NULL,
  p_library_id UUID,
  p_device_id TEXT DEFAULT NULL,
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
  v_existing_entry RECORD;
  v_open_log RECORD;
  v_recent_log RECORD;
  v_slot_label TEXT;
  v_entry_id TEXT;
  v_entry_timestamp TIMESTAMPTZ;
BEGIN
  v_entry_id := COALESCE(NULLIF(trim(p_entry_id), ''), gen_random_uuid()::text);
  v_entry_timestamp := COALESCE(p_entry_timestamp, now());

  IF p_student_id IS NOT NULL THEN
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
    WHERE s.id = p_student_id
      AND s.library_id = p_library_id
    LIMIT 1;
  ELSE
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
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'code', 'INVALID_QR', 'message', 'Invalid QR');
  END IF;

  IF v_student.expiry_date IS NOT NULL AND v_student.expiry_date < CURRENT_DATE THEN
    UPDATE public.students
    SET status = 'expired'
    WHERE id = v_student.id;

    RETURN jsonb_build_object('status', 'error', 'code', 'EXPIRED', 'message', 'Plan expired');
  END IF;

  IF COALESCE(v_student.status, 'expired') <> 'active' THEN
    RETURN jsonb_build_object(
      'status',
      'error',
      'code',
      'EXPIRED',
      'message',
      CASE
        WHEN v_student.status = 'expired' THEN 'Plan expired'
        WHEN v_student.status = 'inactive' THEN 'Plan inactive'
        ELSE 'Plan expired or not active'
      END
    );
  END IF;

  SELECT *
  INTO v_existing_entry
  FROM public.attendance_logs
  WHERE entry_id = v_entry_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'duplicate', true,
      'name', v_student.full_name,
      'seat', v_student.seat_number,
      'time', to_char(v_entry_timestamp, 'HH12:MI AM'),
      'message', 'Entry already processed',
      'entry_id', v_entry_id,
      'device_id', p_device_id
    );
  END IF;

  SELECT *
  INTO v_open_log
  FROM public.attendance_logs
  WHERE student_id = v_student.id
    AND library_id = p_library_id
    AND check_out IS NULL
  ORDER BY check_in DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'code', 'ALREADY_INSIDE',
      'message', 'Student is already inside'
    );
  END IF;

  SELECT *
  INTO v_recent_log
  FROM public.attendance_logs
  WHERE student_id = v_student.id
    AND library_id = p_library_id
  ORDER BY check_in DESC
  LIMIT 1;

  IF FOUND AND v_recent_log.check_in > v_entry_timestamp - interval '15 minutes' THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'code', 'TOO_FREQUENT',
      'message', 'Please wait 15 minutes before scanning again'
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

  INSERT INTO public.attendance_logs (entry_id, student_id, library_id, device_id, check_in, date)
  VALUES (v_entry_id, v_student.id, p_library_id, p_device_id, v_entry_timestamp, v_entry_timestamp::date);

  UPDATE public.students
  SET last_check_in = v_entry_timestamp,
      no_show_days = 0
  WHERE id = v_student.id;

  RETURN jsonb_build_object(
    'status', 'success',
    'name', v_student.full_name,
    'seat', v_student.seat_number,
    'time', to_char(v_entry_timestamp, 'HH12:MI AM'),
    'message', 'Entry logged',
    'entry_id', v_entry_id,
    'device_id', p_device_id,
    'slot_label', v_slot_label,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_id_profile(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_id_profile(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_id_profile(UUID, TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.qr_check_in(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_check_in(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.qr_check_in(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.scan_attendance_entry(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_attendance_entry(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
