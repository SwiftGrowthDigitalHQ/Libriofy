CREATE OR REPLACE FUNCTION public.process_attendance_scan(
  p_failure_route TEXT,
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
  v_device RECORD;
  v_existing_entry RECORD;
  v_open_log RECORD;
  v_recent_log RECORD;
  v_entry_id TEXT;
  v_entry_timestamp TIMESTAMPTZ;
  v_last_action_at TIMESTAMPTZ;
  v_effective_device_id TEXT := NULLIF(trim(p_device_id), '');
  v_failure_route TEXT := COALESCE(NULLIF(trim(p_failure_route), ''), '/rpc/scan_attendance_entry');
BEGIN
  v_entry_id := COALESCE(NULLIF(trim(p_entry_id), ''), gen_random_uuid()::text);
  v_entry_timestamp := COALESCE(p_entry_timestamp, now());

  IF v_effective_device_id IS NOT NULL THEN
    SELECT
      id,
      library_id,
      is_active
    INTO v_device
    FROM public.entry_devices
    WHERE device_id = v_effective_device_id
    LIMIT 1;

    IF NOT FOUND OR NOT COALESCE(v_device.is_active, false) THEN
      PERFORM public.log_attendance_failure(
        v_failure_route,
        'DEVICE_BLOCKED',
        'Device not allowed',
        'database',
        jsonb_build_object(
          'device_id', v_effective_device_id,
          'library_id', p_library_id,
          'entry_id', v_entry_id,
          'student_id', p_student_id,
          'stage', 'device_blocked'
        )
      );

      RETURN jsonb_build_object(
        'status', 'error',
        'success', false,
        'code', 'DEVICE_BLOCKED',
        'message', 'Device not allowed'
      );
    END IF;

    IF v_device.library_id <> p_library_id THEN
      PERFORM public.log_attendance_failure(
        v_failure_route,
        'WRONG_LIBRARY',
        'Wrong Library',
        'database',
        jsonb_build_object(
          'device_id', v_effective_device_id,
          'library_id', p_library_id,
          'expected_library_id', v_device.library_id,
          'entry_id', v_entry_id,
          'student_id', p_student_id,
          'stage', 'library_mismatch'
        )
      );

      RETURN jsonb_build_object(
        'status', 'error',
        'success', false,
        'code', 'WRONG_LIBRARY',
        'message', 'Wrong Library'
      );
    END IF;
  END IF;

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
    FOR UPDATE;
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
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'INVALID_QR',
      'Invalid QR',
      'database',
      jsonb_build_object(
        'device_id', v_effective_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'student_lookup'
      )
    );

    RETURN jsonb_build_object(
      'status', 'error',
      'success', false,
      'code', 'INVALID_QR',
      'message', 'Invalid QR'
    );
  END IF;

  IF v_student.expiry_date IS NOT NULL AND v_student.expiry_date < CURRENT_DATE THEN
    UPDATE public.students
    SET status = 'expired'
    WHERE id = v_student.id;

    PERFORM public.log_attendance_failure(
      v_failure_route,
      'EXPIRED',
      'Plan expired',
      'database',
      jsonb_build_object(
        'device_id', v_effective_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'expiry_check'
      )
    );

    RETURN jsonb_build_object(
      'status', 'error',
      'success', false,
      'code', 'EXPIRED',
      'message', 'Plan expired'
    );
  END IF;

  IF COALESCE(v_student.status, 'expired') <> 'active' THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'EXPIRED',
      CASE
        WHEN v_student.status = 'inactive' THEN 'Plan inactive'
        ELSE 'Plan expired or not active'
      END,
      'database',
      jsonb_build_object(
        'device_id', v_effective_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'status_check',
        'student_status', v_student.status
      )
    );

    RETURN jsonb_build_object(
      'status', 'error',
      'success', false,
      'code', 'EXPIRED',
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
    IF v_existing_entry.student_id = v_student.id
      AND v_existing_entry.library_id = p_library_id
      AND COALESCE(v_existing_entry.device_id, '') = COALESCE(v_effective_device_id, '') THEN
      v_last_action_at := COALESCE(v_existing_entry.check_out, v_existing_entry.check_in, v_entry_timestamp);

      RETURN jsonb_build_object(
        'status', 'success',
        'success', true,
        'duplicate', true,
        'action', CASE WHEN v_existing_entry.check_out IS NULL THEN 'check-in' ELSE 'check-out' END,
        'name', v_student.full_name,
        'studentName', v_student.full_name,
        'student_name', v_student.full_name,
        'seat', v_student.seat_number,
        'time', to_char(v_last_action_at, 'HH12:MI AM'),
        'message', 'Scan already processed',
        'entry_id', v_entry_id,
        'device_id', COALESCE(v_effective_device_id, v_existing_entry.device_id)
      );
    END IF;

    PERFORM public.log_attendance_failure(
      v_failure_route,
      'ENTRY_CONFLICT',
      'Entry ID conflict detected',
      'database',
      jsonb_build_object(
        'device_id', v_effective_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'existing_student_id', v_existing_entry.student_id,
        'existing_device_id', v_existing_entry.device_id,
        'stage', 'entry_conflict'
      )
    );

    RETURN jsonb_build_object(
      'status', 'error',
      'success', false,
      'code', 'ENTRY_CONFLICT',
      'message', 'Entry ID conflict detected'
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
    IF v_open_log.check_in > v_entry_timestamp - interval '5 seconds' THEN
      PERFORM public.log_attendance_failure(
        v_failure_route,
        'TOO_FREQUENT',
        'Please wait 5 seconds before scanning again',
        'database',
        jsonb_build_object(
          'device_id', v_effective_device_id,
          'library_id', p_library_id,
          'entry_id', v_entry_id,
          'student_id', v_student.id,
          'stage', 'check_out_cooldown'
        )
      );

      RETURN jsonb_build_object(
        'status', 'error',
        'success', false,
        'code', 'TOO_FREQUENT',
        'message', 'Please wait 5 seconds before scanning again'
      );
    END IF;

    UPDATE public.attendance_logs
    SET check_out = v_entry_timestamp
    WHERE id = v_open_log.id;

    RETURN jsonb_build_object(
      'status', 'success',
      'success', true,
      'action', 'check-out',
      'name', v_student.full_name,
      'studentName', v_student.full_name,
      'student_name', v_student.full_name,
      'seat', v_student.seat_number,
      'time', to_char(v_entry_timestamp, 'HH12:MI AM'),
      'message', 'Checked out successfully',
      'entry_id', COALESCE(v_open_log.entry_id, v_entry_id),
      'device_id', COALESCE(v_effective_device_id, v_open_log.device_id)
    );
  END IF;

  SELECT *
  INTO v_recent_log
  FROM public.attendance_logs
  WHERE student_id = v_student.id
    AND library_id = p_library_id
  ORDER BY COALESCE(check_out, check_in) DESC, check_in DESC
  LIMIT 1;

  IF FOUND THEN
    v_last_action_at := COALESCE(v_recent_log.check_out, v_recent_log.check_in);

    IF v_last_action_at > v_entry_timestamp - interval '5 seconds' THEN
      PERFORM public.log_attendance_failure(
        v_failure_route,
        'TOO_FREQUENT',
        'Please wait 5 seconds before scanning again',
        'database',
        jsonb_build_object(
          'device_id', v_effective_device_id,
          'library_id', p_library_id,
          'entry_id', v_entry_id,
          'student_id', v_student.id,
          'stage', 'check_in_cooldown'
        )
      );

      RETURN jsonb_build_object(
        'status', 'error',
        'success', false,
        'code', 'TOO_FREQUENT',
        'message', 'Please wait 5 seconds before scanning again'
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.attendance_logs (
      entry_id,
      student_id,
      library_id,
      device_id,
      check_in,
      date
    )
    VALUES (
      v_entry_id,
      v_student.id,
      p_library_id,
      v_effective_device_id,
      v_entry_timestamp,
      v_entry_timestamp::date
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT *
      INTO v_existing_entry
      FROM public.attendance_logs
      WHERE entry_id = v_entry_id
      LIMIT 1;

      IF FOUND
        AND v_existing_entry.student_id = v_student.id
        AND v_existing_entry.library_id = p_library_id
        AND COALESCE(v_existing_entry.device_id, '') = COALESCE(v_effective_device_id, '') THEN
        v_last_action_at := COALESCE(v_existing_entry.check_out, v_existing_entry.check_in, v_entry_timestamp);

        RETURN jsonb_build_object(
          'status', 'success',
          'success', true,
          'duplicate', true,
          'action', CASE WHEN v_existing_entry.check_out IS NULL THEN 'check-in' ELSE 'check-out' END,
          'name', v_student.full_name,
          'studentName', v_student.full_name,
          'student_name', v_student.full_name,
          'seat', v_student.seat_number,
          'time', to_char(v_last_action_at, 'HH12:MI AM'),
          'message', 'Scan already processed',
          'entry_id', v_entry_id,
          'device_id', COALESCE(v_effective_device_id, v_existing_entry.device_id)
        );
      END IF;

      PERFORM public.log_attendance_failure(
        v_failure_route,
        'ENTRY_CONFLICT',
        'Entry ID conflict detected',
        'database',
        jsonb_build_object(
          'device_id', v_effective_device_id,
          'library_id', p_library_id,
          'entry_id', v_entry_id,
          'student_id', v_student.id,
          'stage', 'insert_conflict'
        )
      );

      RETURN jsonb_build_object(
        'status', 'error',
        'success', false,
        'code', 'ENTRY_CONFLICT',
        'message', 'Entry ID conflict detected'
      );
  END;

  UPDATE public.students
  SET last_check_in = v_entry_timestamp,
      no_show_days = 0
  WHERE id = v_student.id;

  RETURN jsonb_build_object(
    'status', 'success',
    'success', true,
    'action', 'check-in',
    'name', v_student.full_name,
    'studentName', v_student.full_name,
    'student_name', v_student.full_name,
    'seat', v_student.seat_number,
    'time', to_char(v_entry_timestamp, 'HH12:MI AM'),
    'message', 'Checked in successfully',
    'entry_id', v_entry_id,
    'device_id', v_effective_device_id
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

REVOKE ALL ON FUNCTION public.process_attendance_scan(TEXT, UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
