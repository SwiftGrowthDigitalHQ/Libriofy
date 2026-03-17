ALTER TABLE public.lockers
  ADD COLUMN IF NOT EXISTS row_position INTEGER,
  ADD COLUMN IF NOT EXISTS col_position INTEGER;

UPDATE public.lockers
SET row_position = COALESCE(row_position, GREATEST("row" - 1, 0)),
    col_position = COALESCE(col_position, GREATEST("column" - 1, 0))
WHERE row_position IS NULL
   OR col_position IS NULL;

CREATE OR REPLACE FUNCTION public.prepare_locker_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_library_id UUID;
BEGIN
  NEW.locker_number := upper(trim(COALESCE(NEW.locker_number, '')));

  IF NEW.locker_number = '' THEN
    RAISE EXCEPTION 'Locker number is required.';
  END IF;

  IF NEW.library_id IS NULL THEN
    RAISE EXCEPTION 'Library is required.';
  END IF;

  IF NEW."row" IS NULL AND NEW.row_position IS NULL THEN
    RAISE EXCEPTION 'Locker row position is required.';
  END IF;

  IF NEW."column" IS NULL AND NEW.col_position IS NULL THEN
    RAISE EXCEPTION 'Locker column position is required.';
  END IF;

  NEW.row_position := COALESCE(NEW.row_position, GREATEST(NEW."row" - 1, 0));
  NEW.col_position := COALESCE(NEW.col_position, GREATEST(NEW."column" - 1, 0));
  NEW."row" := COALESCE(NEW."row", NEW.row_position + 1);
  NEW."column" := COALESCE(NEW."column", NEW.col_position + 1);

  IF NEW."row" <= 0 OR NEW."column" <= 0 THEN
    RAISE EXCEPTION 'Locker positions must be positive.';
  END IF;

  NEW.row_position := GREATEST(NEW."row" - 1, 0);
  NEW.col_position := GREATEST(NEW."column" - 1, 0);

  IF NEW.student_id IS NOT NULL THEN
    SELECT library_id
    INTO v_student_library_id
    FROM public.students
    WHERE id = NEW.student_id;

    IF NOT FOUND OR v_student_library_id <> NEW.library_id THEN
      RAISE EXCEPTION 'Selected student does not belong to this library.';
    END IF;
  END IF;

  IF NEW.status = 'maintenance' AND NEW.student_id IS NOT NULL THEN
    RAISE EXCEPTION 'Release the locker before marking it under maintenance.';
  END IF;

  IF NEW.status = 'occupied' AND NEW.student_id IS NULL THEN
    RAISE EXCEPTION 'An occupied locker must have an assigned student.';
  END IF;

  IF NEW.student_id IS NULL THEN
    NEW.payment_due_date := NULL;
    IF NEW.status = 'occupied' THEN
      NEW.status := 'available';
    END IF;
  ELSIF NEW.status <> 'maintenance' THEN
    NEW.status := 'occupied';
    NEW.payment_due_date := COALESCE(NEW.payment_due_date, (CURRENT_DATE + INTERVAL '1 month')::DATE);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_library_lockers(
  p_library_id UUID,
  p_total_lockers INTEGER,
  p_columns INTEGER DEFAULT 5
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col_position INTEGER;
  v_columns INTEGER := GREATEST(COALESCE(p_columns, 5), 1);
  v_index INTEGER;
  v_row_position INTEGER;
  v_target INTEGER := GREATEST(COALESCE(p_total_lockers, 0), 0);
BEGIN
  IF p_library_id IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role')
    AND NOT public.user_can_access_library(auth.uid(), p_library_id) THEN
    RAISE EXCEPTION 'You are not allowed to manage lockers in this library.';
  END IF;

  FOR v_index IN 1..v_target LOOP
    v_row_position := (v_index - 1) / v_columns;
    v_col_position := (v_index - 1) % v_columns;

    INSERT INTO public.lockers (
      library_id,
      locker_number,
      "row",
      "column",
      row_position,
      col_position,
      status,
      monthly_price
    )
    VALUES (
      p_library_id,
      public.locker_label_from_index(v_index),
      v_row_position + 1,
      v_col_position + 1,
      v_row_position,
      v_col_position,
      'available',
      0
    )
    ON CONFLICT (library_id, locker_number) DO UPDATE
      SET "row" = EXCLUDED."row",
          "column" = EXCLUDED."column",
          row_position = EXCLUDED.row_position,
          col_position = EXCLUDED.col_position,
          updated_at = now();
  END LOOP;

  DELETE FROM public.lockers locker
  WHERE locker.library_id = p_library_id
    AND COALESCE(NULLIF(regexp_replace(locker.locker_number, '\D', '', 'g'), ''), '0')::INTEGER > v_target
    AND locker.student_id IS NULL;
END;
$$;
