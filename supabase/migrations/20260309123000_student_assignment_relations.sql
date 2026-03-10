CREATE TABLE IF NOT EXISTS public.seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  seat_number TEXT NOT NULL,
  seat_index INT NOT NULL CHECK (seat_index > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT seats_library_seat_number_key UNIQUE (library_id, seat_number)
);

ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'seats'
      AND policyname = 'Super admins can manage all seats'
  ) THEN
    CREATE POLICY "Super admins can manage all seats"
      ON public.seats
      FOR ALL
      USING (public.has_role(auth.uid(), 'super_admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'seats'
      AND policyname = 'Library owners can manage their seats'
  ) THEN
    CREATE POLICY "Library owners can manage their seats"
      ON public.seats
      FOR ALL
      USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_seats_library ON public.seats(library_id);

DROP TRIGGER IF EXISTS update_seats_updated_at ON public.seats;

CREATE TRIGGER update_seats_updated_at
  BEFORE UPDATE ON public.seats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS slot_id UUID REFERENCES public.time_slots(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS seat_id UUID REFERENCES public.seats(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_plan_id ON public.students(plan_id);
CREATE INDEX IF NOT EXISTS idx_students_slot_id ON public.students(slot_id);
CREATE INDEX IF NOT EXISTS idx_students_seat_id ON public.students(seat_id);

CREATE OR REPLACE FUNCTION public.normalize_lookup_text(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(COALESCE(p_text, '')), '[^a-z0-9]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.normalize_seat_number(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_text, ''), '\s+', '', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION public.format_compact_time(p_time TIME)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_time IS NULL THEN ''
    WHEN EXTRACT(minute FROM p_time) = 0 THEN lower(to_char(p_time, 'FMHH12am'))
    ELSE lower(to_char(p_time, 'FMHH12MIam'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.slot_lookup_matches(
  p_input TEXT,
  p_name TEXT,
  p_start TIME,
  p_end TIME
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.normalize_lookup_text(p_input) <> ''
    AND (
      public.normalize_lookup_text(p_input) = public.normalize_lookup_text(p_name)
      OR public.normalize_lookup_text(p_input) = public.normalize_lookup_text(public.format_compact_time(p_start) || '-' || public.format_compact_time(p_end))
      OR public.normalize_lookup_text(p_input) = public.normalize_lookup_text(lower(to_char(p_start, 'FMHH12:MIam')) || '-' || lower(to_char(p_end, 'FMHH12:MIam')))
      OR public.normalize_lookup_text(p_input) = public.normalize_lookup_text(p_name || ' ' || public.format_compact_time(p_start) || '-' || public.format_compact_time(p_end))
    );
$$;

CREATE OR REPLACE FUNCTION public.seat_label_from_index(p_index INT, p_columns INT DEFAULT 8)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_value INT;
  v_row_index INT;
  v_col INT;
  v_label TEXT := '';
BEGIN
  IF COALESCE(p_index, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_row_index := (p_index - 1) / GREATEST(COALESCE(p_columns, 8), 1);
  v_col := ((p_index - 1) % GREATEST(COALESCE(p_columns, 8), 1)) + 1;
  v_value := v_row_index + 1;

  WHILE v_value > 0 LOOP
    v_value := v_value - 1;
    v_label := chr(65 + (v_value % 26)) || v_label;
    v_value := v_value / 26;
  END LOOP;

  RETURN v_label || v_col::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_library_seats(
  p_library_id UUID,
  p_total_seats INT,
  p_columns INT DEFAULT 8
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_index INT;
  v_target INT := GREATEST(COALESCE(p_total_seats, 0), 0);
BEGIN
  IF p_library_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_index IN 1..v_target LOOP
    INSERT INTO public.seats (library_id, seat_number, seat_index)
    VALUES (p_library_id, public.seat_label_from_index(v_index, p_columns), v_index)
    ON CONFLICT (library_id, seat_number) DO UPDATE
      SET seat_index = EXCLUDED.seat_index,
          updated_at = now();
  END LOOP;

  DELETE FROM public.seats seat
  WHERE seat.library_id = p_library_id
    AND seat.seat_index > v_target
    AND NOT EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.library_id = p_library_id
        AND s.seat_id = seat.id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_library_seat_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_library_seats(NEW.id, NEW.total_seats);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_library_seats_after_change ON public.libraries;

CREATE TRIGGER sync_library_seats_after_change
  AFTER INSERT OR UPDATE OF total_seats ON public.libraries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_library_seat_sync();

DO $$
DECLARE
  v_library RECORD;
BEGIN
  FOR v_library IN
    SELECT id, total_seats
    FROM public.libraries
  LOOP
    PERFORM public.sync_library_seats(v_library.id, v_library.total_seats);
  END LOOP;
END
$$;

WITH extra_seats AS (
  SELECT DISTINCT
    s.library_id,
    public.normalize_seat_number(s.seat_number) AS seat_number
  FROM public.students s
  WHERE public.normalize_seat_number(s.seat_number) IS NOT NULL
), missing_seats AS (
  SELECT
    e.library_id,
    e.seat_number,
    row_number() OVER (PARTITION BY e.library_id ORDER BY e.seat_number) AS row_num
  FROM extra_seats e
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.seats seat
    WHERE seat.library_id = e.library_id
      AND public.normalize_seat_number(seat.seat_number) = e.seat_number
  )
)
INSERT INTO public.seats (library_id, seat_number, seat_index)
SELECT
  m.library_id,
  m.seat_number,
  COALESCE(existing.max_index, 0) + m.row_num
FROM missing_seats m
LEFT JOIN LATERAL (
  SELECT MAX(seat_index) AS max_index
  FROM public.seats seat
  WHERE seat.library_id = m.library_id
) existing ON true
ON CONFLICT (library_id, seat_number) DO NOTHING;

UPDATE public.students s
SET plan_id = (
  SELECT p.id
  FROM public.plans p
  WHERE p.library_id = s.library_id
    AND public.normalize_lookup_text(p.name) = public.normalize_lookup_text(s.plan)
  ORDER BY p.is_active DESC, p.created_at DESC
  LIMIT 1
)
WHERE s.plan_id IS NULL
  AND COALESCE(trim(s.plan), '') <> '';

UPDATE public.students s
SET slot_id = (
  SELECT ts.id
  FROM public.time_slots ts
  WHERE ts.library_id = s.library_id
    AND public.slot_lookup_matches(s.slot, ts.name, ts.start_time, ts.end_time)
  ORDER BY ts.is_active DESC, ts.start_time ASC
  LIMIT 1
)
WHERE s.slot_id IS NULL
  AND COALESCE(trim(s.slot), '') <> '';

UPDATE public.students s
SET seat_id = matched_seat.id
FROM public.seats matched_seat
WHERE s.seat_id IS NULL
  AND s.library_id = matched_seat.library_id
  AND public.normalize_seat_number(s.seat_number) = public.normalize_seat_number(matched_seat.seat_number);

CREATE OR REPLACE FUNCTION public.prepare_student_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_slot public.time_slots%ROWTYPE;
  v_seat public.seats%ROWTYPE;
BEGIN
  IF NEW.library_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_id IS NOT NULL THEN
    SELECT *
    INTO v_plan
    FROM public.plans
    WHERE id = NEW.plan_id
      AND library_id = NEW.library_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid plan for this library.';
    END IF;

    NEW.plan := v_plan.name;
  ELSIF COALESCE(trim(NEW.plan), '') <> '' THEN
    SELECT *
    INTO v_plan
    FROM public.plans
    WHERE library_id = NEW.library_id
      AND public.normalize_lookup_text(name) = public.normalize_lookup_text(NEW.plan)
    ORDER BY is_active DESC, created_at DESC
    LIMIT 1;

    IF FOUND THEN
      NEW.plan_id := v_plan.id;
      NEW.plan := v_plan.name;
    END IF;
  END IF;

  IF NEW.slot_id IS NOT NULL THEN
    SELECT *
    INTO v_slot
    FROM public.time_slots
    WHERE id = NEW.slot_id
      AND library_id = NEW.library_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid slot for this library.';
    END IF;

    NEW.slot := v_slot.name;
  ELSIF COALESCE(trim(NEW.slot), '') <> '' THEN
    SELECT *
    INTO v_slot
    FROM public.time_slots
    WHERE library_id = NEW.library_id
      AND public.slot_lookup_matches(NEW.slot, name, start_time, end_time)
    ORDER BY is_active DESC, start_time ASC
    LIMIT 1;

    IF FOUND THEN
      NEW.slot_id := v_slot.id;
      NEW.slot := v_slot.name;
    END IF;
  END IF;

  IF NEW.seat_id IS NOT NULL THEN
    SELECT *
    INTO v_seat
    FROM public.seats
    WHERE id = NEW.seat_id
      AND library_id = NEW.library_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid seat for this library.';
    END IF;

    NEW.seat_number := v_seat.seat_number;
  ELSIF public.normalize_seat_number(NEW.seat_number) IS NOT NULL THEN
    SELECT *
    INTO v_seat
    FROM public.seats
    WHERE library_id = NEW.library_id
      AND public.normalize_seat_number(seat_number) = public.normalize_seat_number(NEW.seat_number)
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.seats (library_id, seat_number, seat_index)
      VALUES (
        NEW.library_id,
        public.normalize_seat_number(NEW.seat_number),
        COALESCE((SELECT MAX(seat_index) FROM public.seats WHERE library_id = NEW.library_id), 0) + 1
      )
      RETURNING * INTO v_seat;
    END IF;

    NEW.seat_id := v_seat.id;
    NEW.seat_number := v_seat.seat_number;
  END IF;

  IF NEW.plan_id IS NULL THEN
    NEW.plan := NULL;
  END IF;

  IF NEW.slot_id IS NULL THEN
    NEW.slot := NULL;
  END IF;

  IF NEW.seat_id IS NULL THEN
    NEW.seat_number := NULL;
  END IF;

  IF NEW.seat_id IS NOT NULL
    AND NEW.slot_id IS NOT NULL
    AND NEW.status = 'active'
    AND (NEW.expiry_date IS NULL OR NEW.expiry_date >= CURRENT_DATE) THEN
    IF EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.library_id = NEW.library_id
        AND s.seat_id = NEW.seat_id
        AND s.slot_id = NEW.slot_id
        AND s.status = 'active'
        AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE)
        AND (NEW.id IS NULL OR s.id <> NEW.id)
    ) THEN
      RAISE EXCEPTION 'Seat is already assigned for the selected slot.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_student_assignments_before_write ON public.students;

CREATE TRIGGER prepare_student_assignments_before_write
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_student_assignments();

CREATE OR REPLACE FUNCTION public.get_slot_availability(p_library_id UUID)
RETURNS TABLE(slot_name TEXT, available_seats INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ts.name AS slot_name,
    GREATEST(
      0,
      COALESCE(ts.max_seats, l.total_seats) - COUNT(DISTINCT s.seat_id)::INT
    ) AS available_seats
  FROM public.time_slots ts
  JOIN public.libraries l
    ON l.id = ts.library_id
  LEFT JOIN public.students s
    ON s.library_id = ts.library_id
    AND s.slot_id = ts.id
    AND s.seat_id IS NOT NULL
    AND s.status = 'active'
    AND (s.expiry_date IS NULL OR s.expiry_date >= CURRENT_DATE)
  WHERE ts.library_id = p_library_id
    AND ts.is_active = true
  GROUP BY ts.id, ts.name, ts.max_seats, l.total_seats
  ORDER BY ts.start_time;
$$;

CREATE OR REPLACE FUNCTION public.get_student_renewal_context(p_student_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'student_id', s.id,
    'library_id', s.library_id,
    'student_name', s.full_name,
    'seat_id', s.seat_id,
    'seat_number', COALESCE(seat.seat_number, s.seat_number),
    'plan_name', COALESCE(plan_ref.name, s.plan),
    'expiry_date', s.expiry_date,
    'renewal_amount', COALESCE(plan_ref.price, plan_match.price, 0),
    'library_name', l.name,
    'upi_id', l.upi_id,
    'latest_payment_status', latest_payment.status,
    'latest_payment_created_at', latest_payment.created_at
  )
  INTO v_result
  FROM public.students s
  JOIN public.libraries l
    ON l.id = s.library_id
  LEFT JOIN public.seats seat
    ON seat.id = s.seat_id
  LEFT JOIN public.plans plan_ref
    ON plan_ref.id = s.plan_id
  LEFT JOIN LATERAL (
    SELECT p.price
    FROM public.plans p
    WHERE p.library_id = s.library_id
      AND public.normalize_lookup_text(p.name) = public.normalize_lookup_text(s.plan)
    ORDER BY p.created_at DESC
    LIMIT 1
  ) plan_match ON true
  LEFT JOIN LATERAL (
    SELECT p.status, p.created_at
    FROM public.payments p
    WHERE p.student_id = s.id
      AND p.source = 'student_renewal'
    ORDER BY p.created_at DESC
    LIMIT 1
  ) latest_payment ON true
  WHERE s.qr_code = p_student_token
  LIMIT 1;

  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'student_id', NULL,
      'library_id', NULL,
      'student_name', NULL,
      'seat_id', NULL,
      'seat_number', NULL,
      'plan_name', NULL,
      'expiry_date', NULL,
      'renewal_amount', NULL,
      'library_name', NULL,
      'upi_id', NULL,
      'latest_payment_status', NULL,
      'latest_payment_created_at', NULL
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_renewal_payment(
  p_student_token TEXT,
  p_amount NUMERIC,
  p_payment_screenshot TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_library public.libraries%ROWTYPE;
  v_existing_status TEXT;
  v_payment_id UUID;
  v_period_start DATE;
  v_period_end DATE;
  v_seat_number TEXT;
  v_plan_name TEXT;
BEGIN
  IF COALESCE(trim(p_student_token), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Renewal link is invalid.');
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid renewal amount.');
  END IF;

  SELECT *
  INTO v_student
  FROM public.students
  WHERE qr_code = p_student_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found.');
  END IF;

  SELECT *
  INTO v_library
  FROM public.libraries
  WHERE id = v_student.library_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Library not found.');
  END IF;

  IF COALESCE(trim(v_library.upi_id), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Library has not configured a UPI ID yet.');
  END IF;

  SELECT
    COALESCE(seat.seat_number, v_student.seat_number),
    COALESCE(plan_ref.name, v_student.plan)
  INTO
    v_seat_number,
    v_plan_name
  FROM (SELECT 1) seed
  LEFT JOIN public.seats seat
    ON seat.id = v_student.seat_id
  LEFT JOIN public.plans plan_ref
    ON plan_ref.id = v_student.plan_id;

  SELECT p.status
  INTO v_existing_status
  FROM public.payments p
  WHERE p.student_id = v_student.id
    AND p.source = 'student_renewal'
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_existing_status = 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your payment proof is already pending approval.');
  END IF;

  v_period_start := GREATEST(COALESCE(v_student.expiry_date, CURRENT_DATE), CURRENT_DATE);
  v_period_end := v_period_start + 30;

  INSERT INTO public.payments (
    library_id,
    student_id,
    amount,
    status,
    payment_method,
    plan,
    period_start,
    period_end,
    seat_id,
    source,
    payment_screenshot
  )
  VALUES (
    v_student.library_id,
    v_student.id,
    p_amount,
    'pending',
    'upi_qr',
    v_plan_name,
    v_period_start,
    v_period_end,
    v_seat_number,
    'student_renewal',
    p_payment_screenshot
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.notifications (
    library_id,
    student_id,
    type,
    title,
    message
  )
  VALUES (
    v_student.library_id,
    v_student.id,
    'renewal_payment_submitted',
    'Renewal payment proof submitted',
    v_student.full_name || ' submitted a renewal payment proof for seat ' || COALESCE(v_seat_number, 'N/A') || '.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'status', 'pending'
  );
END;
$$;
