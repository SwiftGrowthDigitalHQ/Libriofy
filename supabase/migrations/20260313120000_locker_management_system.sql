ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS total_lockers INTEGER;

DO $$
BEGIN
  IF to_regclass('public.lockers') IS NOT NULL THEN
    UPDATE public.libraries library
    SET total_lockers = locker_counts.total_lockers
    FROM (
      SELECT library_id, COUNT(*)::INTEGER AS total_lockers
      FROM public.lockers
      GROUP BY library_id
    ) locker_counts
    WHERE library.id = locker_counts.library_id
      AND library.total_lockers IS NULL;
  END IF;
END
$$;

UPDATE public.libraries
SET total_lockers = 12
WHERE total_lockers IS NULL;

ALTER TABLE public.libraries
  ALTER COLUMN total_lockers SET DEFAULT 12;

ALTER TABLE public.libraries
  ALTER COLUMN total_lockers SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'libraries_total_lockers_check'
      AND conrelid = 'public.libraries'::regclass
  ) THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_total_lockers_check
      CHECK (total_lockers >= 0);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.lockers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  locker_number TEXT NOT NULL,
  "row" INTEGER NOT NULL CHECK ("row" > 0),
  "column" INTEGER NOT NULL CHECK ("column" > 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance')),
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  monthly_price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  payment_due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lockers_library_locker_number_key UNIQUE (library_id, locker_number)
);

ALTER TABLE public.lockers
  ADD COLUMN IF NOT EXISTS payment_due_date DATE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "column" INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lockers'
      AND column_name = 'col'
  ) THEN
    UPDATE public.lockers
    SET "column" = COALESCE("column", col)
    WHERE "column" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lockers'
      AND column_name = 'col_position'
  ) THEN
    UPDATE public.lockers
    SET "column" = COALESCE("column", col_position + 1)
    WHERE "column" IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lockers'
      AND column_name = 'row_position'
  ) THEN
    UPDATE public.lockers
    SET "row" = COALESCE("row", row_position + 1)
    WHERE "row" IS NULL;
  END IF;
END
$$;

UPDATE public.lockers
SET updated_at = COALESCE(updated_at, now());

WITH ranked_lockers AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY library_id, locker_number
      ORDER BY (student_id IS NOT NULL) DESC, created_at ASC NULLS LAST, id ASC
    ) AS locker_rank
  FROM public.lockers
)
DELETE FROM public.lockers locker
USING ranked_lockers ranked
WHERE locker.id = ranked.id
  AND ranked.locker_rank > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lockers_library_locker_number_key'
      AND conrelid = 'public.lockers'::regclass
  ) THEN
    ALTER TABLE public.lockers
      ADD CONSTRAINT lockers_library_locker_number_key UNIQUE (library_id, locker_number);
  END IF;
END
$$;

ALTER TABLE public.lockers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'lockers'
      AND policyname = 'Users can manage lockers in accessible libraries'
  ) THEN
    CREATE POLICY "Users can manage lockers in accessible libraries"
      ON public.lockers
      FOR ALL
      USING (public.user_can_access_library(auth.uid(), library_id))
      WITH CHECK (public.user_can_access_library(auth.uid(), library_id));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_lockers_library ON public.lockers(library_id);
CREATE INDEX IF NOT EXISTS idx_lockers_library_status ON public.lockers(library_id, status);
CREATE INDEX IF NOT EXISTS idx_lockers_library_due_date ON public.lockers(library_id, payment_due_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lockers_one_active_locker_per_student
  ON public.lockers(library_id, student_id)
  WHERE student_id IS NOT NULL AND status = 'occupied';

DROP TRIGGER IF EXISTS update_lockers_updated_at ON public.lockers;

CREATE TRIGGER update_lockers_updated_at
  BEFORE UPDATE ON public.lockers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.locker_label_from_index(p_index INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_index, 0) <= 0 THEN NULL
    ELSE 'L' || p_index::TEXT
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_library_lockers(
  p_library_id UUID,
  p_total_lockers INTEGER,
  p_columns INTEGER DEFAULT 4
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_index INTEGER;
  v_target INTEGER := GREATEST(COALESCE(p_total_lockers, 0), 0);
  v_columns INTEGER := GREATEST(COALESCE(p_columns, 4), 1);
BEGIN
  IF p_library_id IS NULL THEN
    RETURN;
  END IF;

  FOR v_index IN 1..v_target LOOP
    INSERT INTO public.lockers (library_id, locker_number, "row", "column")
    VALUES (
      p_library_id,
      public.locker_label_from_index(v_index),
      ((v_index - 1) / v_columns) + 1,
      ((v_index - 1) % v_columns) + 1
    )
    ON CONFLICT (library_id, locker_number) DO UPDATE
      SET "row" = EXCLUDED."row",
          "column" = EXCLUDED."column",
          updated_at = now();
  END LOOP;

  DELETE FROM public.lockers locker
  WHERE locker.library_id = p_library_id
    AND substring(locker.locker_number FROM 2)::INTEGER > v_target
    AND locker.student_id IS NULL
    AND locker.status = 'available';
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_library_locker_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_library_lockers(NEW.id, NEW.total_lockers);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_library_lockers_after_change ON public.libraries;

CREATE TRIGGER sync_library_lockers_after_change
  AFTER INSERT OR UPDATE OF total_lockers ON public.libraries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_library_locker_sync();

DO $$
DECLARE
  v_library RECORD;
BEGIN
  FOR v_library IN
    SELECT id, total_lockers
    FROM public.libraries
  LOOP
    PERFORM public.sync_library_lockers(v_library.id, v_library.total_lockers);
  END LOOP;
END
$$;

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

DROP TRIGGER IF EXISTS prepare_locker_write_before_save ON public.lockers;

CREATE TRIGGER prepare_locker_write_before_save
  BEFORE INSERT OR UPDATE ON public.lockers
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_locker_write();

CREATE OR REPLACE FUNCTION public.assign_locker(
  p_locker_id UUID,
  p_student_id UUID,
  p_monthly_price NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locker public.lockers%ROWTYPE;
  v_student public.students%ROWTYPE;
  v_monthly_price NUMERIC(10,2);
BEGIN
  SELECT *
  INTO v_locker
  FROM public.lockers
  WHERE id = p_locker_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Locker not found.';
  END IF;

  IF NOT public.user_can_access_library(auth.uid(), v_locker.library_id) THEN
    RAISE EXCEPTION 'You are not allowed to manage lockers in this library.';
  END IF;

  SELECT *
  INTO v_student
  FROM public.students
  WHERE id = p_student_id
    AND library_id = v_locker.library_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found for this library.';
  END IF;

  IF v_locker.status = 'maintenance' THEN
    RAISE EXCEPTION 'Locker is under maintenance.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lockers locker
    WHERE locker.library_id = v_locker.library_id
      AND locker.student_id = p_student_id
      AND locker.status = 'occupied'
      AND locker.id <> p_locker_id
  ) THEN
    RAISE EXCEPTION 'This student already has an occupied locker.';
  END IF;

  v_monthly_price := COALESCE(p_monthly_price, v_locker.monthly_price, 0);

  UPDATE public.lockers
  SET student_id = v_student.id,
      status = 'occupied',
      monthly_price = v_monthly_price,
      payment_due_date = CASE
        WHEN v_locker.student_id = v_student.id AND v_locker.payment_due_date IS NOT NULL THEN v_locker.payment_due_date
        ELSE (CURRENT_DATE + INTERVAL '1 month')::DATE
      END,
      updated_at = now()
  WHERE id = p_locker_id
  RETURNING *
  INTO v_locker;

  INSERT INTO public.notifications (
    library_id,
    student_id,
    type,
    title,
    message,
    recipient_phone,
    delivery_status,
    category,
    metadata
  )
  VALUES (
    v_locker.library_id,
    v_student.id,
    'locker_assigned',
    'Locker assigned: ' || v_locker.locker_number,
    'Hello ' || v_student.full_name || E'\n\n' ||
      'Your locker has been assigned.' || E'\n\n' ||
      'Locker Number: ' || v_locker.locker_number || E'\n\n' ||
      'Thank you for using our library.',
    v_student.phone,
    'queued',
    'system',
    jsonb_build_object(
      'locker_id', v_locker.id,
      'locker_number', v_locker.locker_number,
      'monthly_price', v_locker.monthly_price,
      'payment_due_date', COALESCE(v_locker.payment_due_date::TEXT, '')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'locker_id', v_locker.id,
    'locker_number', v_locker.locker_number,
    'status', v_locker.status,
    'student_id', v_student.id,
    'student_name', v_student.full_name,
    'monthly_price', v_locker.monthly_price,
    'payment_due_date', v_locker.payment_due_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_locker(p_locker_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locker public.lockers%ROWTYPE;
  v_student_name TEXT;
BEGIN
  SELECT *
  INTO v_locker
  FROM public.lockers
  WHERE id = p_locker_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Locker not found.';
  END IF;

  IF v_locker.student_id IS NOT NULL THEN
    SELECT full_name
    INTO v_student_name
    FROM public.students
    WHERE id = v_locker.student_id;
  END IF;

  IF NOT public.user_can_access_library(auth.uid(), v_locker.library_id) THEN
    RAISE EXCEPTION 'You are not allowed to manage lockers in this library.';
  END IF;

  UPDATE public.lockers
  SET student_id = NULL,
      status = CASE WHEN status = 'maintenance' THEN 'maintenance' ELSE 'available' END,
      payment_due_date = NULL,
      updated_at = now()
  WHERE id = p_locker_id
  RETURNING *
  INTO v_locker;

  PERFORM public.notify_library_users(
    v_locker.library_id,
    'locker_released',
    'Locker released',
    COALESCE(v_student_name, 'Student') || ' was removed from locker ' || v_locker.locker_number || '.',
    'system',
    NULL,
    jsonb_build_object(
      'locker_id', v_locker.id,
      'locker_number', v_locker.locker_number
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'locker_id', v_locker.id,
    'locker_number', v_locker.locker_number,
    'status', v_locker.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_locker_renewals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locker RECORD;
  v_due_count INTEGER := 0;
BEGIN
  FOR v_locker IN
    SELECT
      locker.id,
      locker.library_id,
      locker.locker_number,
      locker.monthly_price,
      locker.payment_due_date,
      student.id AS student_id,
      student.full_name,
      student.phone
    FROM public.lockers locker
    JOIN public.students student
      ON student.id = locker.student_id
    WHERE locker.status = 'occupied'
      AND locker.payment_due_date = CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications notification
        WHERE notification.student_id = student.id
          AND notification.type = 'locker_payment_due'
          AND COALESCE(notification.metadata->>'locker_id', '') = locker.id::TEXT
          AND COALESCE(notification.metadata->>'payment_due_date', '') = locker.payment_due_date::TEXT
      )
  LOOP
    INSERT INTO public.notifications (
      library_id,
      student_id,
      type,
      title,
      message,
      recipient_phone,
      delivery_status,
      category,
      metadata
    )
    VALUES (
      v_locker.library_id,
      v_locker.student_id,
      'locker_payment_due',
      'Locker payment due: ' || v_locker.locker_number,
      'Hello ' || v_locker.full_name || E'\n\n' ||
        'Your locker payment is due.' || E'\n\n' ||
        'Locker: ' || v_locker.locker_number || E'\n\n' ||
        'Please renew to continue using the locker.',
      v_locker.phone,
      'queued',
      'renewal',
      jsonb_build_object(
        'locker_id', v_locker.id,
        'locker_number', v_locker.locker_number,
        'monthly_price', v_locker.monthly_price,
        'payment_due_date', v_locker.payment_due_date::TEXT
      )
    );

    v_due_count := v_due_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'locker_due_today', v_due_count
  );
END;
$$;

CREATE INDEX IF NOT EXISTS idx_notifications_locker_unsent
  ON public.notifications(delivery_status, sent_at)
  WHERE type IN ('locker_assigned', 'locker_payment_due');

CREATE OR REPLACE FUNCTION public.fanout_locker_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_name TEXT;
  v_locker_number TEXT := COALESCE(NEW.metadata->>'locker_number', 'locker');
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.student_id IS NOT NULL THEN
    SELECT full_name
    INTO v_student_name
    FROM public.students
    WHERE id = NEW.student_id;
  END IF;

  IF NEW.type = 'locker_assigned' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'locker_assigned',
      'Locker assigned',
      COALESCE(v_student_name, 'A student') || ' was assigned to ' || v_locker_number || '.',
      'system',
      NEW.student_id,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  ELSIF NEW.type = 'locker_payment_due' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'locker_payment_due',
      'Locker payment due',
      COALESCE(v_student_name, 'A student') || ' has locker payment due for ' || v_locker_number || '.',
      'renewal',
      NEW.student_id,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fanout_locker_notifications ON public.notifications;

CREATE TRIGGER fanout_locker_notifications
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.user_id IS NULL AND NEW.type IN ('locker_assigned', 'locker_payment_due'))
  EXECUTE FUNCTION public.fanout_locker_notification();
