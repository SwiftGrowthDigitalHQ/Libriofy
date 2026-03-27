-- FILE: supabase/migrations/20260326152000_student_photo_uploads.sql
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

-- FILE: supabase/migrations/20260326164000_fix_student_photo_rls.sql
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

-- FILE: supabase/migrations/20260326173000_student_photo_atomic_finalization.sql
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS photo_storage_path TEXT,
ADD COLUMN IF NOT EXISTS photo_thumbnail_path TEXT;

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

UPDATE public.students
SET photo_thumbnail_path = public.extract_student_photo_path_from_url(photo_url)
WHERE photo_thumbnail_path IS NULL
  AND photo_url IS NOT NULL;

UPDATE public.students
SET photo_storage_path = public.derive_student_original_photo_path(photo_thumbnail_path)
WHERE photo_storage_path IS NULL
  AND photo_thumbnail_path IS NOT NULL;

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
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_student_photo_upload(
  p_student_id UUID,
  p_temp_original_path TEXT,
  p_temp_thumbnail_path TEXT
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
  v_version BIGINT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required');
  END IF;

  IF NULLIF(trim(COALESCE(p_temp_original_path, '')), '') IS NULL
    OR NULLIF(trim(COALESCE(p_temp_thumbnail_path, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Temporary photo paths are required');
  END IF;

  v_temp_prefix := format('temp/%s/', auth.uid());

  IF left(p_temp_original_path, length(v_temp_prefix)) <> v_temp_prefix
    OR left(p_temp_thumbnail_path, length(v_temp_prefix)) <> v_temp_prefix THEN
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
    'finalThumbnailPath', format('%s/students/%s_%s_thumb.jpg', v_library_id, p_student_id, v_version),
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
    'previousPhotoStoragePath', v_previous_photo_storage_path,
    'previousPhotoThumbnailPath', v_previous_photo_thumbnail_path
  );
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

  CREATE POLICY "Library team can upload their temp student photos"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'student-photos'
      AND (storage.foldername(name))[1] = 'temp'
      AND (storage.foldername(name))[2] = auth.uid()::text
    );

  CREATE POLICY "Library team can delete their temp student photos"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'student-photos'
      AND (storage.foldername(name))[1] = 'temp'
      AND (storage.foldername(name))[2] = auth.uid()::text
    );
END
$$;

CREATE OR REPLACE FUNCTION public.trigger_student_photo_cleanup()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := 'https://xaoitjyuuxwksofmmydh.supabase.co/functions/v1/cleanup-student-photo-assets',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('source', 'daily_scheduler')
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

DO $job$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'daily-student-photo-cleanup'
    )
  THEN
    PERFORM cron.schedule(
      'daily-student-photo-cleanup',
      '15 3 * * *',
      $$SELECT public.trigger_student_photo_cleanup();$$
    );
  END IF;
END
$job$;

-- FILE: supabase/migrations/20260326174500_drop_legacy_student_photo_rpc.sql
DROP FUNCTION IF EXISTS public.update_student_photo_url(UUID, TEXT);

-- FILE: supabase/migrations/20260326193000_student_photo_thumbnail_rate_limit.sql
ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS photo_version BIGINT;

CREATE INDEX IF NOT EXISTS photo_upload_logs_uploaded_by_uploaded_at_idx
  ON public.photo_upload_logs (uploaded_by, uploaded_at DESC);

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

UPDATE public.students
SET photo_version = public.extract_student_photo_version_from_url(photo_url)
WHERE photo_version IS NULL
  AND photo_url IS NOT NULL;

DROP FUNCTION IF EXISTS public.prepare_student_photo_upload(UUID, TEXT, TEXT);

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

DROP FUNCTION IF EXISTS public.update_student_photo_url(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

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

