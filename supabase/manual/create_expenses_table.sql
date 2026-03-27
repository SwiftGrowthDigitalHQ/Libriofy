CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL,
  notes TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND policyname = 'Library teams can select expenses'
  ) THEN
    CREATE POLICY "Library teams can select expenses"
      ON public.expenses
      FOR SELECT
      USING (public.can_access_library(auth.uid(), library_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND policyname = 'Library teams can insert expenses'
  ) THEN
    CREATE POLICY "Library teams can insert expenses"
      ON public.expenses
      FOR INSERT
      WITH CHECK (public.can_access_library(auth.uid(), library_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND policyname = 'Library teams can update expenses'
  ) THEN
    CREATE POLICY "Library teams can update expenses"
      ON public.expenses
      FOR UPDATE
      USING (public.can_access_library(auth.uid(), library_id))
      WITH CHECK (public.can_access_library(auth.uid(), library_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND policyname = 'Library teams can delete expenses'
  ) THEN
    CREATE POLICY "Library teams can delete expenses"
      ON public.expenses
      FOR DELETE
      USING (public.can_access_library(auth.uid(), library_id));
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
