DROP FUNCTION IF EXISTS public.get_slot_availability(UUID);

CREATE FUNCTION public.get_slot_availability(p_library_id UUID)
RETURNS TABLE(
  slot_id UUID,
  slot_name TEXT,
  total_seats INTEGER,
  occupied_seats INTEGER,
  available_seats INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH seat_totals AS (
    SELECT
      seats.library_id,
      COUNT(*)::INT AS total_seats
    FROM public.seats
    WHERE seats.library_id = p_library_id
    GROUP BY seats.library_id
  ),
  active_slot_bookings AS (
    SELECT
      students.library_id,
      assignments.slot_id,
      students.seat_id
    FROM public.students
    JOIN public.student_slot_assignments assignments
      ON assignments.student_id = students.id
     AND assignments.library_id = students.library_id
    WHERE students.library_id = p_library_id
      AND students.seat_id IS NOT NULL
      AND students.status = 'active'
      AND (students.expiry_date IS NULL OR students.expiry_date >= CURRENT_DATE)

    UNION ALL

    SELECT
      students.library_id,
      students.slot_id,
      students.seat_id
    FROM public.students
    WHERE students.library_id = p_library_id
      AND students.seat_id IS NOT NULL
      AND students.slot_id IS NOT NULL
      AND students.status = 'active'
      AND (students.expiry_date IS NULL OR students.expiry_date >= CURRENT_DATE)
      AND NOT EXISTS (
        SELECT 1
        FROM public.student_slot_assignments assignments
        WHERE assignments.student_id = students.id
          AND assignments.library_id = students.library_id
      )
  )
  SELECT
    slots.id AS slot_id,
    slots.name AS slot_name,
    COALESCE(seat_totals.total_seats, slots.max_seats, libraries.total_seats, 0)::INT AS total_seats,
    COUNT(DISTINCT active_slot_bookings.seat_id)::INT AS occupied_seats,
    GREATEST(
      0,
      COALESCE(seat_totals.total_seats, slots.max_seats, libraries.total_seats, 0)::INT
        - COUNT(DISTINCT active_slot_bookings.seat_id)::INT
    ) AS available_seats
  FROM public.time_slots slots
  JOIN public.libraries
    ON libraries.id = slots.library_id
  LEFT JOIN seat_totals
    ON seat_totals.library_id = slots.library_id
  LEFT JOIN active_slot_bookings
    ON active_slot_bookings.library_id = slots.library_id
   AND active_slot_bookings.slot_id = slots.id
  WHERE slots.library_id = p_library_id
    AND slots.is_active = true
  GROUP BY
    slots.id,
    slots.name,
    slots.start_time,
    slots.max_seats,
    libraries.total_seats,
    seat_totals.total_seats
  ORDER BY slots.start_time;
$$;
