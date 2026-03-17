ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS hero_overlay_color TEXT,
  ADD COLUMN IF NOT EXISTS hero_overlay_opacity INTEGER NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS hero_overlay_disabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cta_background_type TEXT NOT NULL DEFAULT 'color',
  ADD COLUMN IF NOT EXISTS cta_background_image_url TEXT,
  ADD COLUMN IF NOT EXISTS cta_background_color TEXT,
  ADD COLUMN IF NOT EXISTS cta_gradient_from TEXT,
  ADD COLUMN IF NOT EXISTS cta_gradient_to TEXT,
  ADD COLUMN IF NOT EXISTS hero_title_color TEXT,
  ADD COLUMN IF NOT EXISTS hero_subtitle_color TEXT,
  ADD COLUMN IF NOT EXISTS cta_text_color TEXT,
  ADD COLUMN IF NOT EXISTS cta_title_color TEXT,
  ADD COLUMN IF NOT EXISTS cta_subtitle_color TEXT,
  ADD COLUMN IF NOT EXISTS cta_button_color TEXT,
  ADD COLUMN IF NOT EXISTS cta_button_text_color TEXT,
  ADD COLUMN IF NOT EXISTS section_heading_color TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'libraries_hero_overlay_opacity_check'
  ) THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_hero_overlay_opacity_check
      CHECK (hero_overlay_opacity BETWEEN 0 AND 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'libraries_cta_background_type_check'
  ) THEN
    ALTER TABLE public.libraries
      ADD CONSTRAINT libraries_cta_background_type_check
      CHECK (cta_background_type IN ('color', 'image', 'gradient'));
  END IF;
END
$$;
