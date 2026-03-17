ALTER TABLE public.lockers
  ADD COLUMN IF NOT EXISTS "column" INTEGER;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lockers'
      AND column_name = 'col_position'
  ) THEN
    UPDATE public.lockers
    SET "column" = col_position + 1
    WHERE "column" IS NULL;
  END IF;
END
$$;
