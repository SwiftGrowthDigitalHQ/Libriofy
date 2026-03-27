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
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can upload student photos'
  ) THEN
    DROP POLICY "Library team can upload student photos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can update student photos'
  ) THEN
    DROP POLICY "Library team can update student photos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can delete student photos'
  ) THEN
    DROP POLICY "Library team can delete student photos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can upload their temp student photos'
  ) THEN
    DROP POLICY "Library team can upload their temp student photos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can delete their temp student photos'
  ) THEN
    DROP POLICY "Library team can delete their temp student photos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload student photos'
  ) THEN
    DROP POLICY "Authenticated users can upload student photos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can update student photos'
  ) THEN
    DROP POLICY "Authenticated users can update student photos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can delete student photos'
  ) THEN
    DROP POLICY "Authenticated users can delete student photos" ON storage.objects;
  END IF;

  CREATE POLICY "Authenticated users can upload student photos"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'student-photos');

  CREATE POLICY "Authenticated users can update student photos"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'student-photos')
    WITH CHECK (bucket_id = 'student-photos');

  CREATE POLICY "Authenticated users can delete student photos"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'student-photos');
END
$$;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN (
    'Authenticated users can upload student photos',
    'Authenticated users can update student photos',
    'Authenticated users can delete student photos'
  )
ORDER BY policyname;
