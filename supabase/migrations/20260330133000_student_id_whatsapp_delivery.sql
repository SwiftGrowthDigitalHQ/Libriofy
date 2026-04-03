INSERT INTO storage.buckets (id, name, public)
VALUES ('id-cards', 'id-cards', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.id_card_delivery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL UNIQUE REFERENCES public.students(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed')),
  source TEXT NOT NULL DEFAULT 'student_change',
  requested_format TEXT NOT NULL DEFAULT 'pdf',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  last_file_bucket TEXT,
  last_file_path TEXT,
  last_delivery_channel TEXT,
  last_provider_name TEXT,
  last_provider_message_id TEXT,
  triggered_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS id_card_delivery_jobs_library_status_retry_idx
  ON public.id_card_delivery_jobs (library_id, status, next_retry_at);

CREATE INDEX IF NOT EXISTS id_card_delivery_jobs_status_retry_idx
  ON public.id_card_delivery_jobs (status, next_retry_at);

CREATE TABLE IF NOT EXISTS public.id_card_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.id_card_delivery_jobs(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  delivery_channel TEXT,
  provider_name TEXT,
  provider_message_id TEXT,
  file_bucket TEXT,
  file_path TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS id_card_delivery_logs_student_created_idx
  ON public.id_card_delivery_logs (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS id_card_delivery_logs_job_created_idx
  ON public.id_card_delivery_logs (job_id, created_at DESC);

ALTER TABLE public.id_card_delivery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.id_card_delivery_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'id_card_delivery_jobs'
      AND policyname = 'Library team can view ID card delivery jobs'
  ) THEN
    DROP POLICY "Library team can view ID card delivery jobs" ON public.id_card_delivery_jobs;
  END IF;

  CREATE POLICY "Library team can view ID card delivery jobs"
    ON public.id_card_delivery_jobs
    FOR SELECT
    TO authenticated
    USING (public.user_can_access_library(auth.uid(), library_id));

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'id_card_delivery_logs'
      AND policyname = 'Library team can view ID card delivery logs'
  ) THEN
    DROP POLICY "Library team can view ID card delivery logs" ON public.id_card_delivery_logs;
  END IF;

  CREATE POLICY "Library team can view ID card delivery logs"
    ON public.id_card_delivery_logs
    FOR SELECT
    TO authenticated
    USING (public.user_can_access_library(auth.uid(), library_id));
END
$$;

CREATE OR REPLACE FUNCTION public.upsert_student_id_card_delivery_job(
  p_student_id UUID,
  p_source TEXT DEFAULT 'student_change',
  p_triggered_by UUID DEFAULT NULL,
  p_available_at TIMESTAMPTZ DEFAULT (now() + interval '2 minutes'),
  p_requested_format TEXT DEFAULT 'pdf'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
  v_library_id UUID;
BEGIN
  SELECT s.library_id
  INTO v_library_id
  FROM public.students AS s
  WHERE s.id = p_student_id;

  IF v_library_id IS NULL THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  INSERT INTO public.id_card_delivery_jobs (
    student_id,
    library_id,
    status,
    source,
    requested_format,
    attempt_count,
    max_attempts,
    queued_at,
    next_retry_at,
    processing_started_at,
    sent_at,
    last_error,
    last_file_bucket,
    last_file_path,
    last_delivery_channel,
    last_provider_name,
    last_provider_message_id,
    triggered_by,
    created_at,
    updated_at
  )
  VALUES (
    p_student_id,
    v_library_id,
    'queued',
    COALESCE(NULLIF(trim(COALESCE(p_source, '')), ''), 'student_change'),
    COALESCE(NULLIF(trim(COALESCE(p_requested_format, '')), ''), 'pdf'),
    0,
    3,
    now(),
    COALESCE(p_available_at, now()),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    p_triggered_by,
    now(),
    now()
  )
  ON CONFLICT (student_id) DO UPDATE
  SET
    library_id = EXCLUDED.library_id,
    status = 'queued',
    source = EXCLUDED.source,
    requested_format = EXCLUDED.requested_format,
    attempt_count = 0,
    max_attempts = 3,
    queued_at = now(),
    next_retry_at = COALESCE(EXCLUDED.next_retry_at, now()),
    processing_started_at = NULL,
    sent_at = NULL,
    last_error = NULL,
    last_file_bucket = NULL,
    last_file_path = NULL,
    last_delivery_channel = NULL,
    last_provider_name = NULL,
    last_provider_message_id = NULL,
    triggered_by = COALESCE(EXCLUDED.triggered_by, public.id_card_delivery_jobs.triggered_by),
    updated_at = now()
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_id_card_delivery_jobs(
  p_limit INTEGER DEFAULT 10,
  p_library_id UUID DEFAULT NULL,
  p_student_ids UUID[] DEFAULT NULL,
  p_force BOOLEAN DEFAULT false
)
RETURNS SETOF public.id_card_delivery_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.id_card_delivery_jobs AS j
    WHERE (p_library_id IS NULL OR j.library_id = p_library_id)
      AND (
        COALESCE(array_length(p_student_ids, 1), 0) = 0
        OR j.student_id = ANY (p_student_ids)
      )
      AND (
        p_force
        OR (
          j.status IN ('queued', 'failed')
          AND COALESCE(j.next_retry_at, j.queued_at, now()) <= now()
          AND j.attempt_count < j.max_attempts
        )
      )
    ORDER BY COALESCE(j.next_retry_at, j.queued_at, j.created_at) ASC
    LIMIT GREATEST(COALESCE(p_limit, 1), 1)
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.id_card_delivery_jobs AS j
    SET
      status = 'processing',
      processing_started_at = now(),
      updated_at = now()
    WHERE j.id IN (SELECT id FROM candidates)
    RETURNING j.*
  )
  SELECT *
  FROM updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_student_id_card_delivery_on_student_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.upsert_student_id_card_delivery_job(
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'student_created' ELSE 'student_updated' END,
    NULL,
    now() + interval '2 minutes'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS queue_student_id_card_delivery_after_student_change ON public.students;

CREATE TRIGGER queue_student_id_card_delivery_after_student_change
AFTER INSERT OR UPDATE OF
  full_name,
  phone,
  plan,
  plan_id,
  seat_number,
  seat_id,
  slot,
  slot_id,
  expiry_date,
  status,
  qr_code,
  photo_url,
  photo_thumbnail_path,
  photo_version
ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.queue_student_id_card_delivery_on_student_change();

CREATE OR REPLACE FUNCTION public.trigger_student_id_card_delivery_processing()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := 'https://xaoitjyuuxwksofmmydh.supabase.co/functions/v1/process-student-id-card-deliveries',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'source', 'id_card_delivery_scheduler',
      'limit', 10
    )
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
      WHERE jobname = 'process-student-id-card-deliveries-every-minute'
    )
  THEN
    PERFORM cron.schedule(
      'process-student-id-card-deliveries-every-minute',
      '* * * * *',
      $$SELECT public.trigger_student_id_card_delivery_processing();$$
    );
  END IF;
END
$job$;
