CREATE TABLE IF NOT EXISTS public.student_slot_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  slot_id UUID REFERENCES public.time_slots(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT student_slot_assignments_student_slot_key UNIQUE (student_id, slot_id)
);

ALTER TABLE public.student_slot_assignments
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS slot_id UUID REFERENCES public.time_slots(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.student_slot_assignments
ALTER COLUMN id SET DEFAULT gen_random_uuid(),
ALTER COLUMN created_at SET DEFAULT now(),
ALTER COLUMN updated_at SET DEFAULT now();

UPDATE public.student_slot_assignments
SET id = gen_random_uuid()
WHERE id IS NULL;

UPDATE public.student_slot_assignments ssa
SET library_id = s.library_id
FROM public.students s
WHERE ssa.library_id IS NULL
  AND ssa.student_id = s.id;

UPDATE public.student_slot_assignments
SET created_at = now()
WHERE created_at IS NULL;

UPDATE public.student_slot_assignments
SET updated_at = now()
WHERE updated_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.student_slot_assignments'::regclass
      AND conname = 'student_slot_assignments_pkey'
  ) THEN
    ALTER TABLE public.student_slot_assignments
      ADD CONSTRAINT student_slot_assignments_pkey PRIMARY KEY (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.student_slot_assignments'::regclass
      AND conname = 'student_slot_assignments_student_slot_key'
  ) THEN
    ALTER TABLE public.student_slot_assignments
      ADD CONSTRAINT student_slot_assignments_student_slot_key UNIQUE (student_id, slot_id);
  END IF;
END
$$;

ALTER TABLE public.student_slot_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'student_slot_assignments'
      AND policyname = 'Super admins can manage all student slot assignments'
  ) THEN
    CREATE POLICY "Super admins can manage all student slot assignments"
      ON public.student_slot_assignments
      FOR ALL
      USING (public.has_role(auth.uid(), 'super_admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'student_slot_assignments'
      AND policyname = 'Library owners can manage their student slot assignments'
  ) THEN
    CREATE POLICY "Library owners can manage their student slot assignments"
      ON public.student_slot_assignments
      FOR ALL
      USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_student_slot_assignments_library ON public.student_slot_assignments(library_id);
CREATE INDEX IF NOT EXISTS idx_student_slot_assignments_student ON public.student_slot_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_student_slot_assignments_slot ON public.student_slot_assignments(slot_id);

DROP TRIGGER IF EXISTS update_student_slot_assignments_updated_at ON public.student_slot_assignments;

CREATE TRIGGER update_student_slot_assignments_updated_at
  BEFORE UPDATE ON public.student_slot_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.student_slot_assignments (library_id, student_id, slot_id)
SELECT s.library_id, s.id, s.slot_id
FROM public.students s
WHERE s.slot_id IS NOT NULL
ON CONFLICT (student_id, slot_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.student_slot_assignments
    WHERE id IS NULL OR student_id IS NULL OR slot_id IS NULL OR library_id IS NULL
  ) THEN
    ALTER TABLE public.student_slot_assignments
      ALTER COLUMN id SET NOT NULL,
      ALTER COLUMN library_id SET NOT NULL,
      ALTER COLUMN student_id SET NOT NULL,
      ALTER COLUMN slot_id SET NOT NULL,
      ALTER COLUMN created_at SET NOT NULL,
      ALTER COLUMN updated_at SET NOT NULL;
  END IF;
END
$$;
