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
