ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS header_background_type TEXT NOT NULL DEFAULT 'color',
  ADD COLUMN IF NOT EXISTS header_background_url TEXT,
  ADD COLUMN IF NOT EXISTS header_background_color TEXT,
  ADD COLUMN IF NOT EXISTS header_overlay_opacity INTEGER NOT NULL DEFAULT 72,
  ADD COLUMN IF NOT EXISTS header_text_color TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'libraries_header_background_type_check'
  ) THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_header_background_type_check
      CHECK (header_background_type IN ('color', 'image'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'libraries_header_overlay_opacity_check'
  ) THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_header_overlay_opacity_check
      CHECK (header_overlay_opacity BETWEEN 0 AND 100);
  END IF;
END
$$;
