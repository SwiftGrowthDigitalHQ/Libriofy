-- Website customization fields for libraries
ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS hero_title TEXT,
  ADD COLUMN IF NOT EXISTS hero_subtitle TEXT,
  ADD COLUMN IF NOT EXISTS about_text TEXT,
  ADD COLUMN IF NOT EXISTS cta_title TEXT,
  ADD COLUMN IF NOT EXISTS cta_subtitle TEXT;

-- Gallery images managed by each library owner
CREATE TABLE IF NOT EXISTS public.library_gallery_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.library_gallery_images ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_library_gallery_images_library_sort
  ON public.library_gallery_images(library_id, sort_order, created_at);

DROP TRIGGER IF EXISTS update_library_gallery_images_updated_at ON public.library_gallery_images;
CREATE TRIGGER update_library_gallery_images_updated_at
  BEFORE UPDATE ON public.library_gallery_images
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'library_gallery_images'
      AND policyname = 'Public can view gallery images'
  ) THEN
    CREATE POLICY "Public can view gallery images"
      ON public.library_gallery_images
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'library_gallery_images'
      AND policyname = 'Owners can manage own gallery images'
  ) THEN
    CREATE POLICY "Owners can manage own gallery images"
      ON public.library_gallery_images
      FOR ALL
      USING (
        library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid())
      )
      WITH CHECK (
        library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'library_gallery_images'
      AND policyname = 'Super admins can manage all gallery images'
  ) THEN
    CREATE POLICY "Super admins can manage all gallery images"
      ON public.library_gallery_images
      FOR ALL
      USING (public.has_role(auth.uid(), 'super_admin'))
      WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
  END IF;
END
$$;

-- Reviews shown on public page
CREATE TABLE IF NOT EXISTS public.library_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  review_text TEXT NOT NULL,
  rating INT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  is_published BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.library_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_library_reviews_library_sort
  ON public.library_reviews(library_id, sort_order, created_at);

DROP TRIGGER IF EXISTS update_library_reviews_updated_at ON public.library_reviews;
CREATE TRIGGER update_library_reviews_updated_at
  BEFORE UPDATE ON public.library_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'library_reviews'
      AND policyname = 'Public can view published reviews'
  ) THEN
    CREATE POLICY "Public can view published reviews"
      ON public.library_reviews
      FOR SELECT
      USING (is_published = true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'library_reviews'
      AND policyname = 'Owners can manage own reviews'
  ) THEN
    CREATE POLICY "Owners can manage own reviews"
      ON public.library_reviews
      FOR ALL
      USING (
        library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid())
      )
      WITH CHECK (
        library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'library_reviews'
      AND policyname = 'Super admins can manage all reviews'
  ) THEN
    CREATE POLICY "Super admins can manage all reviews"
      ON public.library_reviews
      FOR ALL
      USING (public.has_role(auth.uid(), 'super_admin'))
      WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
  END IF;
END
$$;

-- Public bucket for library media (logo + gallery)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'library-media',
  'library-media',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public can read library media'
  ) THEN
    CREATE POLICY "Public can read library media"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'library-media');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload own library media'
  ) THEN
    CREATE POLICY "Authenticated users can upload own library media"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'library-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can update own library media'
  ) THEN
    CREATE POLICY "Authenticated users can update own library media"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'library-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'library-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can delete own library media'
  ) THEN
    CREATE POLICY "Authenticated users can delete own library media"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'library-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END
$$;
