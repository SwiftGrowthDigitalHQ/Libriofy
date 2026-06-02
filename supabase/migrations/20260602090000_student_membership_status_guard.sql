-- Keep active/expired membership state aligned with expiry_date and repair the current drift.

UPDATE public.students
SET status = 'expired'
WHERE status = 'active'
  AND expiry_date IS NOT NULL
  AND expiry_date < CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_students_library_status_expiry_date
  ON public.students(library_id, status, expiry_date);

CREATE OR REPLACE FUNCTION public.sync_student_membership_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.expiry_date IS NOT NULL AND NEW.expiry_date < CURRENT_DATE THEN
    NEW.status := 'expired';
  ELSIF NEW.expiry_date IS NOT NULL
    AND NEW.expiry_date >= CURRENT_DATE
    AND COALESCE(lower(trim(NEW.status)), '') = 'expired' THEN
    NEW.status := 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_student_membership_status_before_write ON public.students;
DROP TRIGGER IF EXISTS a_sync_student_membership_status_before_write ON public.students;

CREATE TRIGGER a_sync_student_membership_status_before_write
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_student_membership_status();
