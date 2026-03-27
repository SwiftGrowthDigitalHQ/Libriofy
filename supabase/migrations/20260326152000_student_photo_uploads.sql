ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS photo_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-photos',
  'student-photos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png']
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
      AND policyname = 'Library team can upload student photos'
  ) THEN
    CREATE POLICY "Library team can upload student photos"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'student-photos'
        AND (storage.foldername(name))[1] IS NOT NULL
        AND (storage.foldername(name))[2] = 'students'
        AND public.can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can update student photos'
  ) THEN
    CREATE POLICY "Library team can update student photos"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'student-photos'
        AND (storage.foldername(name))[1] IS NOT NULL
        AND (storage.foldername(name))[2] = 'students'
        AND public.can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
      )
      WITH CHECK (
        bucket_id = 'student-photos'
        AND (storage.foldername(name))[1] IS NOT NULL
        AND (storage.foldername(name))[2] = 'students'
        AND public.can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can delete student photos'
  ) THEN
    CREATE POLICY "Library team can delete student photos"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'student-photos'
        AND (storage.foldername(name))[1] IS NOT NULL
        AND (storage.foldername(name))[2] = 'students'
        AND public.can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;
END
$$;
