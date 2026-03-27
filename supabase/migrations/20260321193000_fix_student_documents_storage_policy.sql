DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Anyone can upload student documents'
  ) THEN
    DROP POLICY "Anyone can upload student documents" ON storage.objects;
  END IF;

  CREATE POLICY "Anyone can upload student documents"
    ON storage.objects
    FOR INSERT
    WITH CHECK (
      bucket_id = 'student-documents'
      AND (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[2] = 'aadhaar'
      AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    );
END
$$;
