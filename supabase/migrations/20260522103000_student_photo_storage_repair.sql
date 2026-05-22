ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS photo_storage_path TEXT,
ADD COLUMN IF NOT EXISTS photo_thumbnail_path TEXT,
ADD COLUMN IF NOT EXISTS photo_version BIGINT;

CREATE OR REPLACE FUNCTION public.extract_student_photo_path_from_url(p_photo_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_path TEXT;
BEGIN
  IF NULLIF(trim(COALESCE(p_photo_url, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  IF strpos(p_photo_url, '/object/public/student-photos/') = 0 THEN
    RETURN NULL;
  END IF;

  v_path := split_part(p_photo_url, '/object/public/student-photos/', 2);
  v_path := split_part(v_path, '?', 1);
  v_path := NULLIF(trim(COALESCE(v_path, '')), '');

  RETURN v_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.derive_student_original_photo_path(p_thumbnail_path TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_path TEXT;
BEGIN
  v_path := NULLIF(trim(COALESCE(p_thumbnail_path, '')), '');

  IF v_path IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_path ~ '(_thumb|-thumb)\.jpg$' THEN
    RETURN regexp_replace(v_path, '(_thumb|-thumb)\.jpg$', '.jpg');
  END IF;

  RETURN v_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.extract_student_photo_version_from_url(p_photo_url TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_match TEXT[];
BEGIN
  IF NULLIF(trim(COALESCE(p_photo_url, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  v_match := regexp_match(p_photo_url, '[?&]v=([0-9]+)');

  IF v_match IS NULL OR array_length(v_match, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_match[1]::BIGINT;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_photo_storage_library_id(p_storage_path TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_match TEXT[];
BEGIN
  v_match := regexp_match(COALESCE(p_storage_path, ''), '^([0-9a-fA-F-]{36})/students(?:/|$)');

  IF v_match IS NULL OR array_length(v_match, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v_match[1]::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_student_photo_final_storage_path(p_storage_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_storage_path, '') ~ '^[0-9a-fA-F-]{36}/students(?:/|$)';
$$;

CREATE OR REPLACE FUNCTION public.is_student_photo_temp_storage_path(p_storage_path TEXT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND left(COALESCE(p_storage_path, ''), length(format('temp/%s/', p_user_id))) = format('temp/%s/', p_user_id);
$$;

GRANT EXECUTE ON FUNCTION public.extract_student_photo_path_from_url(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.derive_student_original_photo_path(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extract_student_photo_version_from_url(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_photo_storage_library_id(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_student_photo_final_storage_path(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_student_photo_temp_storage_path(TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_access_library(UUID, UUID) TO authenticated, service_role;

UPDATE public.students
SET photo_thumbnail_path = public.extract_student_photo_path_from_url(photo_url)
WHERE photo_thumbnail_path IS NULL
  AND photo_url IS NOT NULL;

UPDATE public.students
SET photo_storage_path = public.derive_student_original_photo_path(photo_thumbnail_path)
WHERE photo_storage_path IS NULL
  AND photo_thumbnail_path IS NOT NULL;

UPDATE public.students
SET photo_version = public.extract_student_photo_version_from_url(photo_url)
WHERE photo_version IS NULL
  AND photo_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.photo_upload_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  temp_original_path TEXT,
  temp_thumbnail_path TEXT,
  final_original_path TEXT,
  final_thumbnail_path TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photo_upload_logs_student_id_uploaded_at_idx
  ON public.photo_upload_logs (student_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS photo_upload_logs_library_id_uploaded_at_idx
  ON public.photo_upload_logs (library_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS photo_upload_logs_uploaded_by_uploaded_at_idx
  ON public.photo_upload_logs (uploaded_by, uploaded_at DESC);

ALTER TABLE public.photo_upload_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'photo_upload_logs'
      AND policyname = 'Library team can view photo upload logs'
  ) THEN
    DROP POLICY "Library team can view photo upload logs" ON public.photo_upload_logs;
  END IF;

  CREATE POLICY "Library team can view photo upload logs"
    ON public.photo_upload_logs
    FOR SELECT
    TO authenticated
    USING (public.user_can_access_library(auth.uid(), library_id));
END
$$;

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

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON TABLE storage.buckets TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA storage TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('storage.s3_multipart_uploads') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.s3_multipart_uploads TO authenticated, service_role';
  END IF;

  IF to_regclass('storage.s3_multipart_uploads_parts') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.s3_multipart_uploads_parts TO authenticated, service_role';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can read student photos'
  ) THEN
    DROP POLICY "Library team can read student photos" ON storage.objects;
  END IF;

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

  CREATE POLICY "Library team can read student photos"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'student-photos'
      AND (
        public.is_student_photo_temp_storage_path(name, auth.uid())
        OR (
          public.is_student_photo_final_storage_path(name)
          AND public.student_photo_storage_library_id(name) IS NOT NULL
          AND public.user_can_access_library(auth.uid(), public.student_photo_storage_library_id(name))
        )
      )
    );

  CREATE POLICY "Library team can upload student photos"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'student-photos'
      AND public.is_student_photo_final_storage_path(name)
      AND public.student_photo_storage_library_id(name) IS NOT NULL
      AND public.user_can_access_library(auth.uid(), public.student_photo_storage_library_id(name))
    );

  CREATE POLICY "Library team can update student photos"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'student-photos'
      AND public.is_student_photo_final_storage_path(name)
      AND public.student_photo_storage_library_id(name) IS NOT NULL
      AND public.user_can_access_library(auth.uid(), public.student_photo_storage_library_id(name))
    )
    WITH CHECK (
      bucket_id = 'student-photos'
      AND public.is_student_photo_final_storage_path(name)
      AND public.student_photo_storage_library_id(name) IS NOT NULL
      AND public.user_can_access_library(auth.uid(), public.student_photo_storage_library_id(name))
    );

  CREATE POLICY "Library team can delete student photos"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'student-photos'
      AND public.is_student_photo_final_storage_path(name)
      AND public.student_photo_storage_library_id(name) IS NOT NULL
      AND public.user_can_access_library(auth.uid(), public.student_photo_storage_library_id(name))
    );

  CREATE POLICY "Library team can upload their temp student photos"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'student-photos'
      AND public.is_student_photo_temp_storage_path(name, auth.uid())
    );

  CREATE POLICY "Library team can delete their temp student photos"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'student-photos'
      AND public.is_student_photo_temp_storage_path(name, auth.uid())
    );
END
$$;

DROP FUNCTION IF EXISTS public.prepare_student_photo_upload(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_student_photo_url(UUID, TEXT);
DROP FUNCTION IF EXISTS public.update_student_photo_url(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.prepare_student_photo_upload(
  p_student_id UUID,
  p_temp_original_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_photo_storage_path TEXT;
  v_current_photo_thumbnail_path TEXT;
  v_library_id UUID;
  v_temp_prefix TEXT;
  v_uploads_last_minute INTEGER;
  v_version BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF NULLIF(trim(COALESCE(p_temp_original_path, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Temporary photo path is required');
  END IF;

  SELECT COUNT(*)
  INTO v_uploads_last_minute
  FROM public.photo_upload_logs
  WHERE uploaded_by = auth.uid()
    AND uploaded_at >= now() - interval '1 minute';

  IF v_uploads_last_minute >= 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many uploads, please wait');
  END IF;

  v_temp_prefix := format('temp/%s/', auth.uid());

  IF left(p_temp_original_path, length(v_temp_prefix)) <> v_temp_prefix THEN
    RETURN jsonb_build_object('success', false, 'error', 'Temporary files must belong to the signed-in user');
  END IF;

  SELECT
    s.library_id,
    COALESCE(s.photo_storage_path, public.derive_student_original_photo_path(COALESCE(s.photo_thumbnail_path, public.extract_student_photo_path_from_url(s.photo_url)))),
    COALESCE(s.photo_thumbnail_path, public.extract_student_photo_path_from_url(s.photo_url))
  INTO
    v_library_id,
    v_current_photo_storage_path,
    v_current_photo_thumbnail_path
  FROM public.students AS s
  WHERE s.id = p_student_id;

  IF v_library_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_can_access_library(auth.uid(), v_library_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  v_version := floor(extract(epoch FROM clock_timestamp()) * 1000);

  RETURN jsonb_build_object(
    'success', true,
    'libraryId', v_library_id,
    'currentPhotoStoragePath', v_current_photo_storage_path,
    'currentPhotoThumbnailPath', v_current_photo_thumbnail_path,
    'finalOriginalPath', format('%s/students/%s_%s.jpg', v_library_id, p_student_id, v_version),
    'finalThumbnailPath', format('%s/students/thumbnails/%s_%s.jpg', v_library_id, p_student_id, v_version),
    'version', v_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.log_student_photo_upload_failure(
  p_student_id UUID,
  p_error_message TEXT DEFAULT NULL,
  p_temp_original_path TEXT DEFAULT NULL,
  p_temp_thumbnail_path TEXT DEFAULT NULL,
  p_final_photo_storage_path TEXT DEFAULT NULL,
  p_final_photo_thumbnail_path TEXT DEFAULT NULL
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

  SELECT s.library_id
  INTO v_library_id
  FROM public.students AS s
  WHERE s.id = p_student_id;

  IF v_library_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_can_access_library(auth.uid(), v_library_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  INSERT INTO public.photo_upload_logs (
    student_id,
    library_id,
    uploaded_by,
    status,
    error_message,
    temp_original_path,
    temp_thumbnail_path,
    final_original_path,
    final_thumbnail_path
  )
  VALUES (
    p_student_id,
    v_library_id,
    auth.uid(),
    'failed',
    NULLIF(trim(COALESCE(p_error_message, '')), ''),
    NULLIF(trim(COALESCE(p_temp_original_path, '')), ''),
    NULLIF(trim(COALESCE(p_temp_thumbnail_path, '')), ''),
    NULLIF(trim(COALESCE(p_final_photo_storage_path, '')), ''),
    NULLIF(trim(COALESCE(p_final_photo_thumbnail_path, '')), '')
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_student_photo_url(
  p_student_id UUID,
  p_photo_url TEXT,
  p_final_photo_storage_path TEXT,
  p_final_photo_thumbnail_path TEXT,
  p_photo_version BIGINT DEFAULT NULL,
  p_expected_photo_storage_path TEXT DEFAULT NULL,
  p_expected_photo_thumbnail_path TEXT DEFAULT NULL,
  p_temp_original_path TEXT DEFAULT NULL,
  p_temp_thumbnail_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_library_id UUID;
  v_previous_photo_storage_path TEXT;
  v_previous_photo_thumbnail_path TEXT;
  v_updated_student_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF NULLIF(trim(COALESCE(p_photo_url, '')), '') IS NULL
    OR NULLIF(trim(COALESCE(p_final_photo_storage_path, '')), '') IS NULL
    OR NULLIF(trim(COALESCE(p_final_photo_thumbnail_path, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Final photo metadata is incomplete');
  END IF;

  SELECT s.library_id
  INTO v_library_id
  FROM public.students AS s
  WHERE s.id = p_student_id;

  IF v_library_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  IF NOT public.user_can_access_library(auth.uid(), v_library_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Forbidden');
  END IF;

  WITH locked_student AS (
    SELECT
      s.id,
      COALESCE(s.photo_storage_path, public.derive_student_original_photo_path(COALESCE(s.photo_thumbnail_path, public.extract_student_photo_path_from_url(s.photo_url)))) AS current_photo_storage_path,
      COALESCE(s.photo_thumbnail_path, public.extract_student_photo_path_from_url(s.photo_url)) AS current_photo_thumbnail_path
    FROM public.students AS s
    WHERE s.id = p_student_id
    FOR UPDATE
  ),
  updated_student AS (
    UPDATE public.students AS s
    SET
      photo_url = NULLIF(trim(COALESCE(p_photo_url, '')), ''),
      photo_storage_path = NULLIF(trim(COALESCE(p_final_photo_storage_path, '')), ''),
      photo_thumbnail_path = NULLIF(trim(COALESCE(p_final_photo_thumbnail_path, '')), ''),
      photo_version = COALESCE(p_photo_version, photo_version, floor(extract(epoch FROM clock_timestamp()) * 1000)),
      updated_at = now()
    FROM locked_student
    WHERE s.id = locked_student.id
      AND locked_student.current_photo_storage_path IS NOT DISTINCT FROM NULLIF(trim(COALESCE(p_expected_photo_storage_path, '')), '')
      AND locked_student.current_photo_thumbnail_path IS NOT DISTINCT FROM NULLIF(trim(COALESCE(p_expected_photo_thumbnail_path, '')), '')
    RETURNING
      s.id,
      locked_student.current_photo_storage_path,
      locked_student.current_photo_thumbnail_path
  )
  SELECT
    u.id,
    u.current_photo_storage_path,
    u.current_photo_thumbnail_path
  INTO
    v_updated_student_id,
    v_previous_photo_storage_path,
    v_previous_photo_thumbnail_path
  FROM updated_student AS u;

  IF v_updated_student_id IS NULL THEN
    INSERT INTO public.photo_upload_logs (
      student_id,
      library_id,
      uploaded_by,
      status,
      error_message,
      temp_original_path,
      temp_thumbnail_path,
      final_original_path,
      final_thumbnail_path
    )
    VALUES (
      p_student_id,
      v_library_id,
      auth.uid(),
      'failed',
      'A newer photo upload already completed for this student.',
      NULLIF(trim(COALESCE(p_temp_original_path, '')), ''),
      NULLIF(trim(COALESCE(p_temp_thumbnail_path, '')), ''),
      NULLIF(trim(COALESCE(p_final_photo_storage_path, '')), ''),
      NULLIF(trim(COALESCE(p_final_photo_thumbnail_path, '')), '')
    );

    RETURN jsonb_build_object('success', false, 'error', 'A newer photo upload already completed for this student.');
  END IF;

  INSERT INTO public.photo_upload_logs (
    student_id,
    library_id,
    uploaded_by,
    status,
    temp_original_path,
    temp_thumbnail_path,
    final_original_path,
    final_thumbnail_path
  )
  VALUES (
    p_student_id,
    v_library_id,
    auth.uid(),
    'success',
    NULLIF(trim(COALESCE(p_temp_original_path, '')), ''),
    NULLIF(trim(COALESCE(p_temp_thumbnail_path, '')), ''),
    NULLIF(trim(COALESCE(p_final_photo_storage_path, '')), ''),
    NULLIF(trim(COALESCE(p_final_photo_thumbnail_path, '')), '')
  );

  RETURN jsonb_build_object(
    'success', true,
    'photoUrl', p_photo_url,
    'photoVersion', COALESCE(p_photo_version, floor(extract(epoch FROM clock_timestamp()) * 1000)),
    'previousPhotoStoragePath', v_previous_photo_storage_path,
    'previousPhotoThumbnailPath', v_previous_photo_thumbnail_path
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_student_photo_upload_diagnostics(
  p_student_id UUID DEFAULT NULL,
  p_library_id UUID DEFAULT NULL,
  p_storage_path TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_bucket_allowed_mime_types TEXT[];
  v_bucket_file_size_limit BIGINT;
  v_bucket_id TEXT;
  v_bucket_name TEXT;
  v_bucket_public BOOLEAN;
  v_storage_path TEXT := NULLIF(trim(COALESCE(p_storage_path, '')), '');
  v_resolved_library_id UUID := p_library_id;
  v_path_library_id UUID;
  v_read_policy BOOLEAN;
  v_insert_policy BOOLEAN;
  v_update_policy BOOLEAN;
  v_delete_policy BOOLEAN;
  v_temp_insert_policy BOOLEAN;
  v_temp_delete_policy BOOLEAN;
BEGIN
  IF v_resolved_library_id IS NULL AND p_student_id IS NOT NULL THEN
    SELECT s.library_id
    INTO v_resolved_library_id
    FROM public.students AS s
    WHERE s.id = p_student_id;
  END IF;

  SELECT
    b.id,
    b.name,
    b.public,
    b.file_size_limit,
    b.allowed_mime_types
  INTO
    v_bucket_id,
    v_bucket_name,
    v_bucket_public,
    v_bucket_file_size_limit,
    v_bucket_allowed_mime_types
  FROM storage.buckets AS b
  WHERE b.id = 'student-photos';

  v_path_library_id := public.student_photo_storage_library_id(v_storage_path);

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can read student photos'
  ) INTO v_read_policy;

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can upload student photos'
  ) INTO v_insert_policy;

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can update student photos'
  ) INTO v_update_policy;

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can delete student photos'
  ) INTO v_delete_policy;

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can upload their temp student photos'
  ) INTO v_temp_insert_policy;

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can delete their temp student photos'
  ) INTO v_temp_delete_policy;

  RETURN jsonb_build_object(
    'authRole', auth.role(),
    'bucket', jsonb_build_object(
      'exists', v_bucket_id IS NOT NULL,
      'id', v_bucket_id,
      'name', v_bucket_name,
      'public', v_bucket_public,
      'fileSizeLimit', v_bucket_file_size_limit,
      'allowedMimeTypes', COALESCE(to_jsonb(v_bucket_allowed_mime_types), '[]'::jsonb)
    ),
    'grants', jsonb_build_object(
      'storageSchemaUsageAuthenticated', has_schema_privilege('authenticated', 'storage', 'USAGE'),
      'storageBucketsSelectAuthenticated', has_table_privilege('authenticated', 'storage.buckets', 'SELECT'),
      'storageObjectsSelectAuthenticated', has_table_privilege('authenticated', 'storage.objects', 'SELECT'),
      'storageObjectsInsertAuthenticated', has_table_privilege('authenticated', 'storage.objects', 'INSERT'),
      'storageObjectsUpdateAuthenticated', has_table_privilege('authenticated', 'storage.objects', 'UPDATE'),
      'storageObjectsDeleteAuthenticated', has_table_privilege('authenticated', 'storage.objects', 'DELETE')
    ),
    'libraryAccess', CASE
      WHEN auth.uid() IS NULL OR v_resolved_library_id IS NULL THEN NULL
      ELSE public.user_can_access_library(auth.uid(), v_resolved_library_id)
    END,
    'libraryId', v_resolved_library_id,
    'pathCategory', CASE
      WHEN v_storage_path IS NULL THEN NULL
      WHEN public.is_student_photo_temp_storage_path(v_storage_path, auth.uid()) THEN 'temp'
      WHEN public.is_student_photo_final_storage_path(v_storage_path) THEN 'final'
      ELSE 'unknown'
    END,
    'policies', jsonb_build_object(
      'read', v_read_policy,
      'insertFinal', v_insert_policy,
      'updateFinal', v_update_policy,
      'deleteFinal', v_delete_policy,
      'insertTemp', v_temp_insert_policy,
      'deleteTemp', v_temp_delete_policy
    ),
    'rpcs', jsonb_build_object(
      'prepareStudentPhotoUpload', to_regprocedure('public.prepare_student_photo_upload(uuid,text)') IS NOT NULL,
      'updateStudentPhotoUrl', to_regprocedure('public.update_student_photo_url(uuid,text,text,text,bigint,text,text,text,text)') IS NOT NULL,
      'logStudentPhotoUploadFailure', to_regprocedure('public.log_student_photo_upload_failure(uuid,text,text,text,text,text)') IS NOT NULL
    ),
    'storagePath', v_storage_path,
    'studentId', p_student_id,
    'suspectedFailingPolicy', CASE
      WHEN v_storage_path IS NULL THEN NULL
      WHEN public.is_student_photo_temp_storage_path(v_storage_path, auth.uid()) AND NOT v_temp_insert_policy THEN 'Library team can upload their temp student photos'
      WHEN public.is_student_photo_final_storage_path(v_storage_path) AND NOT v_insert_policy THEN 'Library team can upload student photos'
      WHEN public.is_student_photo_final_storage_path(v_storage_path)
        AND v_path_library_id IS NOT NULL
        AND auth.uid() IS NOT NULL
        AND NOT public.user_can_access_library(auth.uid(), v_path_library_id) THEN 'public.user_can_access_library(auth.uid(), library_id)'
      ELSE NULL
    END,
    'userId', auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.prepare_student_photo_upload(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_student_photo_upload_failure(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_student_photo_url(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_photo_upload_diagnostics(UUID, UUID, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
