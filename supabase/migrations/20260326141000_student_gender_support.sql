DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'student_gender'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.student_gender AS ENUM ('male', 'female');
  END IF;
END
$$;

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS gender public.student_gender;

ALTER TABLE public.waiting_list
ADD COLUMN IF NOT EXISTS gender public.student_gender;

CREATE OR REPLACE FUNCTION public.add_to_waiting_list(
  p_library_id UUID,
  p_student_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_preferred_slot TEXT DEFAULT NULL,
  p_preferred_plan TEXT DEFAULT NULL,
  p_aadhaar_photo_path TEXT DEFAULT NULL,
  p_gender public.student_gender DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position INT;
  v_id UUID;
BEGIN
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_position
  FROM public.waiting_list
  WHERE library_id = p_library_id AND status IN ('waiting', 'notified');

  INSERT INTO public.waiting_list (
    aadhaar_photo_path,
    gender,
    library_id,
    student_name,
    phone,
    email,
    preferred_slot,
    preferred_plan,
    position
  )
  VALUES (
    NULLIF(trim(COALESCE(p_aadhaar_photo_path, '')), ''),
    p_gender,
    p_library_id,
    p_student_name,
    p_phone,
    p_email,
    p_preferred_slot,
    p_preferred_plan,
    v_position
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'position', v_position);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_waiting_list(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.waiting_list%ROWTYPE;
  v_user_id UUID := auth.uid();
  v_is_super_admin BOOLEAN := false;
  v_plan public.plans%ROWTYPE;
  v_plan_lookup TEXT := '';
  v_slot_lookup TEXT := '';
  v_active_slot_count INT := 0;
  v_required_slot_count INT := 0;
  v_preferred_slot_id UUID := NULL;
  v_selected_slot_ids UUID[] := ARRAY[]::UUID[];
  v_selected_slot_names TEXT[] := ARRAY[]::TEXT[];
  v_selected_slot_id UUID;
  v_primary_slot_name TEXT := NULL;
  v_slot_capacity INT := NULL;
  v_occupied_count INT := 0;
  v_student_id UUID := NULL;
  v_selected_seat_id UUID := NULL;
  v_selected_seat_number TEXT := NULL;
  v_use_assignments BOOLEAN := false;
  v_slot_record RECORD;
  v_seat_record RECORD;
BEGIN
  SELECT *
  INTO v_entry
  FROM public.waiting_list
  WHERE id = p_entry_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  v_is_super_admin := public.has_role(v_user_id, 'super_admin');
  IF NOT v_is_super_admin
     AND NOT EXISTS (
       SELECT 1
       FROM public.libraries
       WHERE id = v_entry.library_id
         AND owner_id = v_user_id
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  IF v_entry.status != 'notified' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry is not in notified state');
  END IF;

  IF v_entry.confirmation_deadline IS NULL OR v_entry.confirmation_deadline < now() THEN
    UPDATE public.waiting_list
    SET status = 'expired'
    WHERE id = p_entry_id;

    RETURN jsonb_build_object('success', false, 'error', 'Confirmation window has expired');
  END IF;

  v_plan_lookup := regexp_replace(lower(COALESCE(v_entry.preferred_plan, '')), '[^a-z0-9]', '', 'g');

  SELECT *
  INTO v_plan
  FROM public.plans
  WHERE library_id = v_entry.library_id
    AND is_active = true
    AND (
      v_plan_lookup = ''
      OR regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = v_plan_lookup
      OR regexp_replace(lower(name), '[^a-z0-9]', '', 'g') LIKE '%' || v_plan_lookup || '%'
      OR v_plan_lookup LIKE '%' || regexp_replace(lower(name), '[^a-z0-9]', '', 'g') || '%'
    )
  ORDER BY
    CASE
      WHEN v_plan_lookup = '' THEN 0
      WHEN regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = v_plan_lookup THEN 0
      WHEN regexp_replace(lower(name), '[^a-z0-9]', '', 'g') LIKE '%' || v_plan_lookup || '%' THEN 1
      ELSE 2
    END,
    price ASC,
    created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active plan matched this waiting list entry');
  END IF;

  SELECT COUNT(*)
  INTO v_active_slot_count
  FROM public.time_slots
  WHERE library_id = v_entry.library_id
    AND is_active = true;

  IF v_active_slot_count = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active slots are available for this library');
  END IF;

  IF regexp_replace(lower(COALESCE(v_plan.name, '')), '[^a-z0-9]', '', 'g') LIKE '%fullday%'
     OR regexp_replace(lower(COALESCE(v_plan.name, '')), '[^a-z0-9]', '', 'g') LIKE '%allday%'
     OR v_plan.duration_hours >= v_active_slot_count * 4 THEN
    v_required_slot_count := v_active_slot_count;
  ELSIF v_plan.duration_hours >= 8 THEN
    v_required_slot_count := LEAST(2, v_active_slot_count);
  ELSE
    v_required_slot_count := LEAST(1, v_active_slot_count);
  END IF;

  v_slot_lookup := regexp_replace(lower(COALESCE(v_entry.preferred_slot, '')), '[^a-z0-9]', '', 'g');

  IF v_slot_lookup <> '' THEN
    SELECT id
    INTO v_preferred_slot_id
    FROM public.time_slots
    WHERE library_id = v_entry.library_id
      AND is_active = true
      AND (
        regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = v_slot_lookup
        OR regexp_replace(lower(name), '[^a-z0-9]', '', 'g') LIKE '%' || v_slot_lookup || '%'
        OR v_slot_lookup LIKE '%' || regexp_replace(lower(name), '[^a-z0-9]', '', 'g') || '%'
      )
    ORDER BY
      CASE
        WHEN regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = v_slot_lookup THEN 0
        WHEN regexp_replace(lower(name), '[^a-z0-9]', '', 'g') LIKE '%' || v_slot_lookup || '%' THEN 1
        ELSE 2
      END,
      start_time ASC
    LIMIT 1;
  END IF;

  IF v_required_slot_count = v_active_slot_count THEN
    SELECT COALESCE(array_agg(id ORDER BY start_time ASC), ARRAY[]::UUID[])
    INTO v_selected_slot_ids
    FROM public.time_slots
    WHERE library_id = v_entry.library_id
      AND is_active = true;
  ELSE
    IF v_preferred_slot_id IS NOT NULL THEN
      v_selected_slot_ids := array_append(v_selected_slot_ids, v_preferred_slot_id);
    END IF;

    FOR v_slot_record IN
      SELECT id
      FROM public.time_slots
      WHERE library_id = v_entry.library_id
        AND is_active = true
        AND (v_preferred_slot_id IS NULL OR id <> v_preferred_slot_id)
      ORDER BY start_time ASC
      LIMIT GREATEST(v_required_slot_count - COALESCE(array_length(v_selected_slot_ids, 1), 0), 0)
    LOOP
      v_selected_slot_ids := array_append(v_selected_slot_ids, v_slot_record.id);
    END LOOP;
  END IF;

  IF COALESCE(array_length(v_selected_slot_ids, 1), 0) < v_required_slot_count THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not enough active slots are available for this plan');
  END IF;

  v_use_assignments := to_regclass('public.student_slot_assignments') IS NOT NULL;

  IF NOT v_use_assignments AND COALESCE(array_length(v_selected_slot_ids, 1), 0) > 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apply the latest student slot assignment migration before confirming this plan');
  END IF;

  FOREACH v_selected_slot_id IN ARRAY v_selected_slot_ids
  LOOP
    SELECT max_seats, name
    INTO v_slot_capacity, v_primary_slot_name
    FROM public.time_slots
    WHERE id = v_selected_slot_id;

    IF v_use_assignments THEN
      SELECT COUNT(DISTINCT occupied.seat_id)
      INTO v_occupied_count
      FROM (
        SELECT s.seat_id
        FROM public.students s
        JOIN public.student_slot_assignments ssa
          ON ssa.student_id = s.id
         AND ssa.library_id = s.library_id
        WHERE s.library_id = v_entry.library_id
          AND s.seat_id IS NOT NULL
          AND s.status NOT IN ('inactive', 'expired')
          AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE)
          AND ssa.slot_id = v_selected_slot_id

        UNION

        SELECT s.seat_id
        FROM public.students s
        WHERE s.library_id = v_entry.library_id
          AND s.seat_id IS NOT NULL
          AND s.status NOT IN ('inactive', 'expired')
          AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE)
          AND s.slot_id = v_selected_slot_id
      ) AS occupied;
    ELSE
      SELECT COUNT(DISTINCT s.seat_id)
      INTO v_occupied_count
      FROM public.students s
      WHERE s.library_id = v_entry.library_id
        AND s.seat_id IS NOT NULL
        AND s.status NOT IN ('inactive', 'expired')
        AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE)
        AND s.slot_id = v_selected_slot_id;
    END IF;

    IF v_slot_capacity IS NOT NULL AND v_slot_capacity > 0 AND v_occupied_count >= v_slot_capacity THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_primary_slot_name, 'Selected') || ' slot is already full');
    END IF;
  END LOOP;

  FOR v_seat_record IN
    SELECT id, seat_number
    FROM public.seats
    WHERE library_id = v_entry.library_id
    ORDER BY seat_index ASC, seat_number ASC
  LOOP
    IF v_use_assignments THEN
      IF NOT EXISTS (
        SELECT 1
        FROM (
          SELECT s.seat_id, ssa.slot_id
          FROM public.students s
          JOIN public.student_slot_assignments ssa
            ON ssa.student_id = s.id
           AND ssa.library_id = s.library_id
          WHERE s.library_id = v_entry.library_id
            AND s.seat_id IS NOT NULL
            AND s.status NOT IN ('inactive', 'expired')
            AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE)

          UNION

          SELECT s.seat_id, s.slot_id
          FROM public.students s
          WHERE s.library_id = v_entry.library_id
            AND s.seat_id IS NOT NULL
            AND s.slot_id IS NOT NULL
            AND s.status NOT IN ('inactive', 'expired')
            AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE)
        ) AS occupied_slots
        WHERE occupied_slots.seat_id = v_seat_record.id
          AND occupied_slots.slot_id = ANY(v_selected_slot_ids)
      ) THEN
        v_selected_seat_id := v_seat_record.id;
        v_selected_seat_number := v_seat_record.seat_number;
        EXIT;
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1
        FROM public.students s
        WHERE s.library_id = v_entry.library_id
          AND s.seat_id = v_seat_record.id
          AND s.slot_id = ANY(v_selected_slot_ids)
          AND s.status NOT IN ('inactive', 'expired')
          AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE)
      ) THEN
        v_selected_seat_id := v_seat_record.id;
        v_selected_seat_number := v_seat_record.seat_number;
        EXIT;
      END IF;
    END IF;
  END LOOP;

  IF v_selected_seat_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No seat is available for the selected slot preference');
  END IF;

  SELECT COALESCE(array_agg(name ORDER BY start_time ASC), ARRAY[]::TEXT[])
  INTO v_selected_slot_names
  FROM public.time_slots
  WHERE id = ANY(v_selected_slot_ids);

  IF COALESCE(array_length(v_selected_slot_names, 1), 0) > 0 THEN
    v_primary_slot_name := v_selected_slot_names[1];
  END IF;

  INSERT INTO public.students (
    aadhaar_photo_path,
    email,
    expiry_date,
    full_name,
    gender,
    library_id,
    phone,
    plan,
    plan_id,
    seat_id,
    seat_number,
    slot,
    slot_id,
    start_date,
    status
  )
  VALUES (
    NULLIF(trim(COALESCE(v_entry.aadhaar_photo_path, '')), ''),
    NULLIF(trim(COALESCE(v_entry.email, '')), ''),
    NULL,
    v_entry.student_name,
    v_entry.gender,
    v_entry.library_id,
    NULLIF(trim(COALESCE(v_entry.phone, '')), ''),
    v_plan.name,
    v_plan.id,
    v_selected_seat_id,
    v_selected_seat_number,
    v_primary_slot_name,
    v_selected_slot_ids[1],
    CURRENT_DATE,
    'active'
  )
  RETURNING id INTO v_student_id;

  IF v_use_assignments THEN
    INSERT INTO public.student_slot_assignments (library_id, student_id, slot_id)
    SELECT v_entry.library_id, v_student_id, assigned_slots.slot_id
    FROM unnest(v_selected_slot_ids) AS assigned_slots(slot_id)
    ON CONFLICT (student_id, slot_id) DO NOTHING;
  END IF;

  UPDATE public.waiting_list
  SET status = 'confirmed',
      confirmed_at = now(),
      notes = concat_ws(
        E'\n',
        NULLIF(notes, ''),
        'Admitted as student ' || v_student_id::TEXT,
        'Assigned seat ' || COALESCE(v_selected_seat_number, '-')
      )
  WHERE id = p_entry_id;

  INSERT INTO public.notifications (library_id, type, title, message)
  VALUES (
    v_entry.library_id,
    'waitlist_confirmed',
    v_entry.student_name || ' admitted from waiting list',
    v_entry.student_name || ' was admitted successfully and assigned seat ' || COALESCE(v_selected_seat_number, 'N/A') || '.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'student_name', v_entry.student_name,
    'student_id', v_student_id,
    'seat_number', v_selected_seat_number,
    'plan_name', v_plan.name,
    'slot_names', v_selected_slot_names
  );
END;
$$;
