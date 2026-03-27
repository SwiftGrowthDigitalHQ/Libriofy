CREATE TABLE IF NOT EXISTS public.automated_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  student_name_snapshot TEXT NOT NULL,
  library_name_snapshot TEXT NOT NULL,
  pending_amount_snapshot NUMERIC NOT NULL DEFAULT 0 CHECK (pending_amount_snapshot >= 0),
  estimated_recovery_impact NUMERIC NOT NULL DEFAULT 0 CHECK (estimated_recovery_impact >= 0),
  payment_status_snapshot TEXT NOT NULL DEFAULT 'unpaid',
  overdue_days_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (overdue_days_snapshot >= 0),
  called_phone TEXT,
  script_text TEXT NOT NULL,
  call_provider TEXT NOT NULL DEFAULT 'twilio',
  tts_provider TEXT NOT NULL DEFAULT 'twilio_say',
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  recovery_stage_label TEXT,
  call_status TEXT NOT NULL DEFAULT 'queued',
  pickup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (pickup_status IN ('pending', 'picked', 'not_picked')),
  ivr_choice TEXT,
  ivr_action TEXT,
  provider_call_sid TEXT,
  audio_bucket TEXT,
  audio_path TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_callback_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  twiml_requested_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automated_calls_library_created
  ON public.automated_calls(library_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automated_calls_library_status
  ON public.automated_calls(library_id, call_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automated_calls_student_created
  ON public.automated_calls(student_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automated_calls_provider_sid
  ON public.automated_calls(provider_call_sid)
  WHERE provider_call_sid IS NOT NULL;

ALTER TABLE public.automated_calls ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_automated_calls_updated_at ON public.automated_calls;

CREATE TRIGGER update_automated_calls_updated_at
BEFORE UPDATE ON public.automated_calls
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'automated_calls'
      AND policyname = 'Library teams can view automated calls'
  ) THEN
    CREATE POLICY "Library teams can view automated calls"
      ON public.automated_calls
      FOR SELECT
      USING (public.user_can_access_library(auth.uid(), library_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'automated_calls'
      AND policyname = 'Library teams can insert automated calls'
  ) THEN
    CREATE POLICY "Library teams can insert automated calls"
      ON public.automated_calls
      FOR INSERT
      WITH CHECK (public.user_can_access_library(auth.uid(), library_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'automated_calls'
      AND policyname = 'Library teams can update automated calls'
  ) THEN
    CREATE POLICY "Library teams can update automated calls"
      ON public.automated_calls
      FOR UPDATE
      USING (public.user_can_access_library(auth.uid(), library_id))
      WITH CHECK (public.user_can_access_library(auth.uid(), library_id));
  END IF;
END
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recovery-call-audio',
  'recovery-call-audio',
  false,
  10485760,
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']
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
      AND policyname = 'Library team can read recovery call audio'
  ) THEN
    CREATE POLICY "Library team can read recovery call audio"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'recovery-call-audio'
        AND (storage.foldername(name))[1] IS NOT NULL
        AND public.user_can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can delete recovery call audio'
  ) THEN
    CREATE POLICY "Library team can delete recovery call audio"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'recovery-call-audio'
        AND (storage.foldername(name))[1] IS NOT NULL
        AND public.user_can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;
END
$$;
