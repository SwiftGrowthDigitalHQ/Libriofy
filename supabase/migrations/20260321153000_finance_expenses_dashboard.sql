CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category TEXT NOT NULL CHECK (category IN ('rent', 'electricity', 'internet', 'salary', 'other')),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND policyname = 'Super admins can manage all expenses'
  ) THEN
    CREATE POLICY "Super admins can manage all expenses"
      ON public.expenses
      FOR ALL
      USING (public.has_role(auth.uid(), 'super_admin'))
      WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'expenses'
      AND policyname = 'Library teams can manage own expenses'
  ) THEN
    CREATE POLICY "Library teams can manage own expenses"
      ON public.expenses
      FOR ALL
      USING (public.can_access_library(auth.uid(), library_id))
      WITH CHECK (public.can_access_library(auth.uid(), library_id));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_expenses_library_date
  ON public.expenses(library_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_library_category
  ON public.expenses(library_id, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
