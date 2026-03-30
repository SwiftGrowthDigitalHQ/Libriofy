CREATE OR REPLACE FUNCTION public.get_student_id_profile(p_qr_code TEXT)
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
  SELECT *
  INTO v_student
  FROM public.students
  WHERE qr_code = p_qr_code
  LIMIT 1;

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
      'library_name', COALESCE(v_library.library_name, v_library.name),
      'library_logo_url', v_library.logo_url,
      'library_primary_color', v_library.primary_color
    )
  );
END;
$$;
