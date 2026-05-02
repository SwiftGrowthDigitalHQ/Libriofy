CREATE OR REPLACE FUNCTION public.log_attendance_failure(
  p_route TEXT,
  p_code TEXT,
  p_message TEXT,
  p_source TEXT DEFAULT 'database',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_error_logs (
    route,
    error_message,
    error_type,
    source,
    metadata
  )
  VALUES (
    COALESCE(NULLIF(trim(p_route), ''), '/rpc/scan_attendance_entry'),
    LEFT(COALESCE(NULLIF(trim(p_message), ''), 'Attendance scan failure'), 1200),
    'server',
    COALESCE(NULLIF(trim(p_source), ''), 'database'),
    COALESCE(
      p_metadata,
      '{}'::jsonb
    ) || jsonb_build_object(
      'code',
      COALESCE(NULLIF(trim(p_code), ''), 'UNKNOWN'),
      'timestamp',
      now()
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;

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
DECLARE
  v_student RECORD;
  v_device RECORD;
  v_existing_entry RECORD;
  v_open_log RECORD;
  v_recent_log RECORD;
  v_slot_label TEXT;
  v_entry_id TEXT;
  v_entry_timestamp TIMESTAMPTZ;
  v_failure_route TEXT := '/rpc/qr_check_in';
BEGIN
  v_entry_id := COALESCE(NULLIF(trim(p_entry_id), ''), gen_random_uuid()::text);
  v_entry_timestamp := COALESCE(p_entry_timestamp, now());

  IF COALESCE(NULLIF(trim(p_device_id), ''), '') = '' THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'DEVICE_BLOCKED',
      'Device not allowed',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'device_missing'
      )
    );

    RETURN jsonb_build_object('success', false, 'code', 'DEVICE_BLOCKED', 'error', 'Device not allowed');
  END IF;

  SELECT
    id,
    library_id,
    is_active
  INTO v_device
  FROM public.entry_devices
  WHERE device_id = p_device_id
  LIMIT 1;

  IF NOT FOUND OR NOT COALESCE(v_device.is_active, false) THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'DEVICE_BLOCKED',
      'Device not allowed',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'device_blocked'
      )
    );

    RETURN jsonb_build_object('success', false, 'code', 'DEVICE_BLOCKED', 'error', 'Device not allowed');
  END IF;

  IF v_device.library_id <> p_library_id THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'WRONG_LIBRARY',
      'Wrong Library',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'expected_library_id', v_device.library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'library_mismatch'
      )
    );

    RETURN jsonb_build_object('success', false, 'code', 'WRONG_LIBRARY', 'error', 'Wrong Library');
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
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'student_lookup'
      )
    );

    RETURN jsonb_build_object('success', false, 'code', 'INVALID_QR', 'error', 'Invalid QR');
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
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'expiry_check'
      )
    );

    RETURN jsonb_build_object('success', false, 'code', 'EXPIRED', 'error', 'Plan expired');
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
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'status_check',
        'student_status', v_student.status
      )
    );

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
    IF v_existing_entry.student_id = v_student.id
      AND v_existing_entry.library_id = p_library_id
      AND COALESCE(v_existing_entry.device_id, '') = COALESCE(p_device_id, '') THEN
      RETURN jsonb_build_object(
        'success', true,
        'action', 'check_in',
        'duplicate', true,
        'message', 'Entry already processed',
        'student_name', v_student.full_name,
        'seat', v_student.seat_number,
        'time', to_char(v_entry_timestamp, 'HH12:MI AM'),
        'entry_id', v_entry_id,
        'device_id', p_device_id
      );
    END IF;

    PERFORM public.log_attendance_failure(
      v_failure_route,
      'ENTRY_CONFLICT',
      'Entry ID conflict detected',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'existing_student_id', v_existing_entry.student_id,
        'existing_device_id', v_existing_entry.device_id,
        'stage', 'entry_conflict'
      )
    );

    RETURN jsonb_build_object(
      'success',
      false,
      'code',
      'ENTRY_CONFLICT',
      'error',
      'Entry ID conflict detected'
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
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'ALREADY_INSIDE',
      'Student is already inside',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'open_log_check'
      )
    );

    RETURN jsonb_build_object(
      'success',
      false,
      'code',
      'ALREADY_INSIDE',
      'error',
      'Student is already inside'
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
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'TOO_FREQUENT',
      'Please wait 15 minutes before scanning again',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'cooldown_check'
      )
    );

    RETURN jsonb_build_object(
      'success',
      false,
      'code',
      'TOO_FREQUENT',
      'error',
      'Please wait 15 minutes before scanning again'
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
      p_device_id,
      v_entry_timestamp,
      v_entry_timestamp::date
    );

    UPDATE public.students
    SET last_check_in = v_entry_timestamp,
        no_show_days = 0
    WHERE id = v_student.id;
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
        AND COALESCE(v_existing_entry.device_id, '') = COALESCE(p_device_id, '') THEN
        RETURN jsonb_build_object(
          'success', true,
          'action', 'check_in',
          'duplicate', true,
          'message', 'Entry already processed',
          'student_name', v_student.full_name,
          'seat', v_student.seat_number,
          'time', to_char(v_entry_timestamp, 'HH12:MI AM'),
          'slot_label', v_slot_label,
          'entry_id', v_entry_id,
          'device_id', p_device_id
        );
      END IF;

      PERFORM public.log_attendance_failure(
        v_failure_route,
        'ENTRY_CONFLICT',
        'Entry ID conflict detected',
        'database',
        jsonb_build_object(
          'device_id', p_device_id,
          'library_id', p_library_id,
          'entry_id', v_entry_id,
          'student_id', v_student.id,
          'stage', 'insert_conflict'
        )
      );

      RETURN jsonb_build_object(
        'success',
        false,
        'code',
        'ENTRY_CONFLICT',
        'error',
        'Entry ID conflict detected'
      );
  END;

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
DECLARE
  v_student RECORD;
  v_device RECORD;
  v_existing_entry RECORD;
  v_open_log RECORD;
  v_recent_log RECORD;
  v_slot_label TEXT;
  v_entry_id TEXT;
  v_entry_timestamp TIMESTAMPTZ;
  v_failure_route TEXT := '/rpc/scan_attendance_entry';
BEGIN
  v_entry_id := COALESCE(NULLIF(trim(p_entry_id), ''), gen_random_uuid()::text);
  v_entry_timestamp := COALESCE(p_entry_timestamp, now());

  IF COALESCE(NULLIF(trim(p_device_id), ''), '') = '' THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'DEVICE_BLOCKED',
      'Device not allowed',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'device_missing'
      )
    );

    RETURN jsonb_build_object('status', 'error', 'code', 'DEVICE_BLOCKED', 'message', 'Device not allowed');
  END IF;

  SELECT
    id,
    library_id,
    is_active
  INTO v_device
  FROM public.entry_devices
  WHERE device_id = p_device_id
  LIMIT 1;

  IF NOT FOUND OR NOT COALESCE(v_device.is_active, false) THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'DEVICE_BLOCKED',
      'Device not allowed',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'device_blocked'
      )
    );

    RETURN jsonb_build_object('status', 'error', 'code', 'DEVICE_BLOCKED', 'message', 'Device not allowed');
  END IF;

  IF v_device.library_id <> p_library_id THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'WRONG_LIBRARY',
      'Wrong Library',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'expected_library_id', v_device.library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'library_mismatch'
      )
    );

    RETURN jsonb_build_object('status', 'error', 'code', 'WRONG_LIBRARY', 'message', 'Wrong Library');
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
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', p_student_id,
        'stage', 'student_lookup'
      )
    );

    RETURN jsonb_build_object('status', 'error', 'code', 'INVALID_QR', 'message', 'Invalid QR');
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
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'expiry_check'
      )
    );

    RETURN jsonb_build_object('status', 'error', 'code', 'EXPIRED', 'message', 'Plan expired');
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
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'status_check',
        'student_status', v_student.status
      )
    );

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
    IF v_existing_entry.student_id = v_student.id
      AND v_existing_entry.library_id = p_library_id
      AND COALESCE(v_existing_entry.device_id, '') = COALESCE(p_device_id, '') THEN
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

    PERFORM public.log_attendance_failure(
      v_failure_route,
      'ENTRY_CONFLICT',
      'Entry ID conflict detected',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'existing_student_id', v_existing_entry.student_id,
        'existing_device_id', v_existing_entry.device_id,
        'stage', 'entry_conflict'
      )
    );

    RETURN jsonb_build_object('status', 'error', 'code', 'ENTRY_CONFLICT', 'message', 'Entry ID conflict detected');
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
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'ALREADY_INSIDE',
      'Student is already inside',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'open_log_check'
      )
    );

    RETURN jsonb_build_object('status', 'error', 'code', 'ALREADY_INSIDE', 'message', 'Student is already inside');
  END IF;

  SELECT *
  INTO v_recent_log
  FROM public.attendance_logs
  WHERE student_id = v_student.id
    AND library_id = p_library_id
  ORDER BY check_in DESC
  LIMIT 1;

  IF FOUND AND v_recent_log.check_in > v_entry_timestamp - interval '15 minutes' THEN
    PERFORM public.log_attendance_failure(
      v_failure_route,
      'TOO_FREQUENT',
      'Please wait 15 minutes before scanning again',
      'database',
      jsonb_build_object(
        'device_id', p_device_id,
        'library_id', p_library_id,
        'entry_id', v_entry_id,
        'student_id', v_student.id,
        'stage', 'cooldown_check'
      )
    );

    RETURN jsonb_build_object('status', 'error', 'code', 'TOO_FREQUENT', 'message', 'Please wait 15 minutes before scanning again');
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
      p_device_id,
      v_entry_timestamp,
      v_entry_timestamp::date
    );

    UPDATE public.students
    SET last_check_in = v_entry_timestamp,
        no_show_days = 0
    WHERE id = v_student.id;
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
        AND COALESCE(v_existing_entry.device_id, '') = COALESCE(p_device_id, '') THEN
        RETURN jsonb_build_object(
          'status', 'success',
          'duplicate', true,
          'name', v_student.full_name,
          'seat', v_student.seat_number,
          'time', to_char(v_entry_timestamp, 'HH12:MI AM'),
          'slot_label', v_slot_label,
          'entry_id', v_entry_id,
          'device_id', p_device_id,
          'message', 'Entry already processed'
        );
      END IF;

      PERFORM public.log_attendance_failure(
        v_failure_route,
        'ENTRY_CONFLICT',
        'Entry ID conflict detected',
        'database',
        jsonb_build_object(
          'device_id', p_device_id,
          'library_id', p_library_id,
          'entry_id', v_entry_id,
          'student_id', v_student.id,
          'stage', 'insert_conflict'
        )
      );

      RETURN jsonb_build_object('status', 'error', 'code', 'ENTRY_CONFLICT', 'message', 'Entry ID conflict detected');
  END;

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

REVOKE ALL ON FUNCTION public.qr_check_in(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qr_check_in(TEXT, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.qr_check_in(TEXT, UUID) FROM service_role;

REVOKE ALL ON FUNCTION public.qr_check_in(TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qr_check_in(TEXT, UUID, TEXT, TIMESTAMPTZ) FROM authenticated;
REVOKE ALL ON FUNCTION public.qr_check_in(TEXT, UUID, TEXT, TIMESTAMPTZ) FROM service_role;

REVOKE ALL ON FUNCTION public.qr_check_in(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qr_check_in(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.qr_check_in(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.scan_attendance_entry(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scan_attendance_entry(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.scan_attendance_entry(UUID, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.log_attendance_failure(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
