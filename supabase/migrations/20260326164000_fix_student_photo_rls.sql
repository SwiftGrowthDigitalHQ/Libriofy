CREATE OR REPLACE FUNCTION public.update_student_photo_url(
  p_student_id UUID,
  p_photo_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_library_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  SELECT library_id
  INTO v_library_id
  FROM public.students
  WHERE id = p_student_id;

  IF v_library_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_can_access_library(auth.uid(), v_library_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  UPDATE public.students
  SET
    photo_url = NULLIF(trim(COALESCE(p_photo_url, '')), ''),
    updated_at = now()
  WHERE id = p_student_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

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

  CREATE POLICY "Library team can upload student photos"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'student-photos'
      AND (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[2] = 'students'
      AND public.user_can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
    );

  CREATE POLICY "Library team can update student photos"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'student-photos'
      AND (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[2] = 'students'
      AND public.user_can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
    )
    WITH CHECK (
      bucket_id = 'student-photos'
      AND (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[2] = 'students'
      AND public.user_can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
    );

  CREATE POLICY "Library team can delete student photos"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'student-photos'
      AND (storage.foldername(name))[1] IS NOT NULL
      AND (storage.foldername(name))[2] = 'students'
      AND public.user_can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
    );
END
$$;
