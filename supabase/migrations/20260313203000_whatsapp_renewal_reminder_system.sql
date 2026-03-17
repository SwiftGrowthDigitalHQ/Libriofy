CREATE TABLE IF NOT EXISTS public.reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES public.notifications(id) ON DELETE SET NULL,
  reminder_type TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  sent_at TIMESTAMPTZ,
  reminder_date DATE NOT NULL DEFAULT CURRENT_DATE,
  delivery_channel TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reminder_logs_status_check CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))
);

ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS notification_id UUID,
  ADD COLUMN IF NOT EXISTS reminder_type TEXT,
  ADD COLUMN IF NOT EXISTS reminder_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reminder_logs'
      AND column_name = 'sent_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE 'ALTER TABLE public.reminder_logs ALTER COLUMN sent_at TYPE TIMESTAMPTZ USING sent_at AT TIME ZONE ''UTC''';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reminder_logs'
      AND column_name = 'created_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE 'ALTER TABLE public.reminder_logs ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE ''UTC''';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reminder_logs'
      AND column_name = 'updated_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    EXECUTE 'ALTER TABLE public.reminder_logs ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE ''UTC''';
  END IF;
END
$$;

UPDATE public.reminder_logs
SET
  created_at = COALESCE(created_at, now()),
  delivery_channel = COALESCE(NULLIF(delivery_channel, ''), 'whatsapp'),
  message = COALESCE(message, ''),
  reminder_date = COALESCE(reminder_date, COALESCE(created_at::date, CURRENT_DATE)),
  reminder_type = COALESCE(
    NULLIF(reminder_type, ''),
    CASE
      WHEN student_id IS NULL THEN 'subscription_reminder_3day'
      ELSE 'renewal_due_today'
    END
  ),
  status = CASE
    WHEN status IN ('queued', 'sent', 'failed', 'skipped') THEN status
    ELSE 'queued'
  END,
  updated_at = COALESCE(updated_at, created_at, now());

ALTER TABLE public.reminder_logs
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN delivery_channel SET DEFAULT 'whatsapp',
  ALTER COLUMN reminder_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN status SET DEFAULT 'queued',
  ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminder_logs_library_id_fkey'
      AND conrelid = 'public.reminder_logs'::regclass
  ) THEN
    ALTER TABLE public.reminder_logs
      ADD CONSTRAINT reminder_logs_library_id_fkey
      FOREIGN KEY (library_id)
      REFERENCES public.libraries(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminder_logs_student_id_fkey'
      AND conrelid = 'public.reminder_logs'::regclass
  ) THEN
    ALTER TABLE public.reminder_logs
      ADD CONSTRAINT reminder_logs_student_id_fkey
      FOREIGN KEY (student_id)
      REFERENCES public.students(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminder_logs_notification_id_fkey'
      AND conrelid = 'public.reminder_logs'::regclass
  ) THEN
    ALTER TABLE public.reminder_logs
      ADD CONSTRAINT reminder_logs_notification_id_fkey
      FOREIGN KEY (notification_id)
      REFERENCES public.notifications(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reminder_logs_status_check'
      AND conrelid = 'public.reminder_logs'::regclass
  ) THEN
    ALTER TABLE public.reminder_logs
      ADD CONSTRAINT reminder_logs_status_check
      CHECK (status IN ('queued', 'sent', 'failed', 'skipped'));
  END IF;
END
$$;

ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reminder_logs'
      AND policyname = 'Users can view reminder logs in accessible libraries'
  ) THEN
    CREATE POLICY "Users can view reminder logs in accessible libraries"
      ON public.reminder_logs
      FOR SELECT
      USING (public.user_can_access_library(auth.uid(), library_id));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_reminder_logs_library_created_at
  ON public.reminder_logs(library_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_library_status
  ON public.reminder_logs(library_id, status, sent_at);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_student_id
  ON public.reminder_logs(student_id);

WITH ranked_student_logs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY student_id, reminder_type, reminder_date
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM public.reminder_logs
  WHERE student_id IS NOT NULL
    AND reminder_type IS NOT NULL
    AND reminder_date IS NOT NULL
)
DELETE FROM public.reminder_logs reminder_log
USING ranked_student_logs ranked_log
WHERE reminder_log.id = ranked_log.id
  AND ranked_log.row_number > 1;

WITH ranked_library_logs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY library_id, reminder_type, reminder_date
      ORDER BY created_at ASC, id ASC
    ) AS row_number
  FROM public.reminder_logs
  WHERE student_id IS NULL
    AND reminder_type IS NOT NULL
    AND reminder_date IS NOT NULL
)
DELETE FROM public.reminder_logs reminder_log
USING ranked_library_logs ranked_log
WHERE reminder_log.id = ranked_log.id
  AND ranked_log.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_logs_student_daily
  ON public.reminder_logs(student_id, reminder_type, reminder_date)
  WHERE student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_logs_library_daily
  ON public.reminder_logs(library_id, reminder_type, reminder_date)
  WHERE student_id IS NULL;

DROP TRIGGER IF EXISTS update_reminder_logs_updated_at ON public.reminder_logs;

CREATE TRIGGER update_reminder_logs_updated_at
  BEFORE UPDATE ON public.reminder_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.run_renewal_reminder_scan(p_library_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate RECORD;
  v_expired_count INTEGER := 0;
  v_owner_reminder_count INTEGER := 0;
  v_reminder_type TEXT;
  v_log_id UUID;
  v_message TEXT;
  v_notification_id UUID;
  v_notification_title TEXT;
  v_student_due_count INTEGER := 0;
  v_student_one_day_count INTEGER := 0;
  v_student_seven_day_count INTEGER := 0;
BEGIN
  UPDATE public.students student
  SET status = 'expired'
  WHERE student.status = 'active'
    AND student.expiry_date IS NOT NULL
    AND student.expiry_date < CURRENT_DATE
    AND (p_library_id IS NULL OR student.library_id = p_library_id);
  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  FOR v_candidate IN
    SELECT
      student.id,
      student.library_id,
      student.full_name,
      student.phone,
      student.plan,
      student.expiry_date
    FROM public.students student
    WHERE student.status = 'active'
      AND student.expiry_date IS NOT NULL
      AND (p_library_id IS NULL OR student.library_id = p_library_id)
      AND student.expiry_date IN (CURRENT_DATE + 7, CURRENT_DATE + 1, CURRENT_DATE)
    ORDER BY student.expiry_date ASC, student.full_name ASC
  LOOP
    v_log_id := NULL;
    v_notification_id := NULL;

    IF v_candidate.expiry_date = CURRENT_DATE + 7 THEN
      v_reminder_type := 'renewal_7day';
      v_notification_title := '7-day renewal reminder: ' || v_candidate.full_name;
    ELSIF v_candidate.expiry_date = CURRENT_DATE + 1 THEN
      v_reminder_type := 'renewal_1day';
      v_notification_title := '1-day renewal reminder: ' || v_candidate.full_name;
    ELSE
      v_reminder_type := 'renewal_due_today';
      v_notification_title := 'Renewal due today: ' || v_candidate.full_name;
    END IF;

    v_message :=
      'Hello ' || v_candidate.full_name || ',' || E'\n\n' ||
      'Your library membership will expire on ' || to_char(v_candidate.expiry_date, 'DD Mon YYYY') || '.' || E'\n\n' ||
      'Plan: ' || COALESCE(NULLIF(v_candidate.plan, ''), 'Membership') || E'\n\n' ||
      'Please renew your membership to continue using the library.' || E'\n\n' ||
      'Contact the library owner to renew.' || E'\n\n' ||
      'Thank you.';

    INSERT INTO public.reminder_logs (
      library_id,
      student_id,
      reminder_type,
      phone,
      message,
      status,
      reminder_date
    )
    VALUES (
      v_candidate.library_id,
      v_candidate.id,
      v_reminder_type,
      NULLIF(trim(COALESCE(v_candidate.phone, '')), ''),
      v_message,
      'queued',
      CURRENT_DATE
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_log_id;

    IF v_log_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (
      library_id,
      student_id,
      type,
      title,
      message,
      recipient_phone,
      delivery_status,
      category,
      metadata
    )
    VALUES (
      v_candidate.library_id,
      v_candidate.id,
      v_reminder_type,
      v_notification_title,
      v_message,
      NULLIF(trim(COALESCE(v_candidate.phone, '')), ''),
      'queued',
      'renewal',
      jsonb_build_object(
        'expiry_date', v_candidate.expiry_date::TEXT,
        'reminder_stage', v_reminder_type,
        'source', 'run_renewal_reminder_scan'
      )
    )
    RETURNING id INTO v_notification_id;

    UPDATE public.reminder_logs
    SET notification_id = v_notification_id
    WHERE id = v_log_id;

    IF v_reminder_type = 'renewal_7day' THEN
      v_student_seven_day_count := v_student_seven_day_count + 1;
    ELSIF v_reminder_type = 'renewal_1day' THEN
      v_student_one_day_count := v_student_one_day_count + 1;
    ELSE
      v_student_due_count := v_student_due_count + 1;
    END IF;
  END LOOP;

  FOR v_candidate IN
    SELECT
      subscription.library_id,
      library.name AS library_name,
      COALESCE(subscription.plan_name, 'Subscription') AS plan_name,
      COALESCE(subscription.plan_expiry_date::DATE, subscription.expires_at::DATE) AS expiry_date,
      COALESCE(
        NULLIF(trim(COALESCE(library.whatsapp_number, '')), ''),
        NULLIF(trim(COALESCE(library.phone, '')), ''),
        NULLIF(trim(COALESCE(profile.phone_number, '')), '')
      ) AS owner_phone
    FROM public.library_subscriptions subscription
    INNER JOIN public.libraries library
      ON library.id = subscription.library_id
    LEFT JOIN public.profiles profile
      ON profile.user_id = library.owner_id
    WHERE library.enabled = true
      AND (p_library_id IS NULL OR subscription.library_id = p_library_id)
      AND COALESCE(subscription.plan_expiry_date::DATE, subscription.expires_at::DATE) = CURRENT_DATE + 3
      AND subscription.status IN ('active', 'trial')
      AND COALESCE(subscription.payment_status, CASE WHEN subscription.status = 'trial' THEN 'trial' ELSE 'paid' END) IN ('paid', 'trial')
    ORDER BY library.name ASC
  LOOP
    v_log_id := NULL;
    v_notification_id := NULL;
    v_reminder_type := 'subscription_reminder_3day';
    v_notification_title := 'Subscription expiry reminder';

    v_message :=
      'Hello ' || COALESCE(NULLIF(v_candidate.library_name, ''), 'Library') || ',' || E'\n\n' ||
      'Your Libriofy software subscription will expire soon.' || E'\n\n' ||
      'Please renew your plan to keep your library system active.' || E'\n\n' ||
      'Renew now from your dashboard.';

    INSERT INTO public.reminder_logs (
      library_id,
      student_id,
      reminder_type,
      phone,
      message,
      status,
      reminder_date
    )
    VALUES (
      v_candidate.library_id,
      NULL,
      v_reminder_type,
      v_candidate.owner_phone,
      v_message,
      'queued',
      CURRENT_DATE
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_log_id;

    IF v_log_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (
      library_id,
      type,
      title,
      message,
      recipient_phone,
      delivery_status,
      category,
      metadata
    )
    VALUES (
      v_candidate.library_id,
      v_reminder_type,
      v_notification_title,
      v_message,
      v_candidate.owner_phone,
      'queued',
      'renewal',
      jsonb_build_object(
        'plan_name', v_candidate.plan_name,
        'expiry_date', v_candidate.expiry_date::TEXT,
        'reminder_stage', 'subscription_3_day',
        'source', 'run_renewal_reminder_scan'
      )
    )
    RETURNING id INTO v_notification_id;

    UPDATE public.reminder_logs
    SET notification_id = v_notification_id
    WHERE id = v_log_id;

    v_owner_reminder_count := v_owner_reminder_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'expired_students', v_expired_count,
    'student_reminders_7day', v_student_seven_day_count,
    'student_reminders_1day', v_student_one_day_count,
    'student_reminders_due_today', v_student_due_count,
    'library_owner_reminders_3day', v_owner_reminder_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_renewals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.run_renewal_reminder_scan();
END;
$$;

CREATE INDEX IF NOT EXISTS idx_notifications_renewal_unsent_v2
  ON public.notifications(delivery_status, sent_at)
  WHERE type IN ('renewal_7day', 'renewal_1day', 'renewal_due_today', 'subscription_reminder_3day');

CREATE OR REPLACE FUNCTION public.fanout_operational_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days_label TEXT;
  v_expiry_date TEXT := COALESCE(NEW.metadata->>'expiry_date', '');
  v_library_name TEXT;
  v_student_name TEXT;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.name
  INTO v_library_name
  FROM public.libraries l
  WHERE l.id = NEW.library_id;

  IF NEW.student_id IS NOT NULL THEN
    SELECT s.full_name
    INTO v_student_name
    FROM public.students s
    WHERE s.id = NEW.student_id;
  END IF;

  IF NEW.type IN ('renewal_7day', 'renewal_2day') THEN
    v_days_label := CASE WHEN NEW.type = 'renewal_7day' THEN '7 days' ELSE '2 days' END;
    PERFORM public.notify_library_users(
      NEW.library_id,
      'renewal_reminder',
      'Renewal Reminder',
      COALESCE(v_student_name, 'A student') || ' has a renewal due in ' || v_days_label ||
        CASE WHEN v_expiry_date <> '' THEN ' (' || v_expiry_date || ').' ELSE '.' END,
      'renewal',
      NEW.student_id,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  ELSIF NEW.type = 'renewal_1day' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'renewal_reminder',
      'Renewal Reminder',
      COALESCE(v_student_name, 'A student') || ' has a renewal due tomorrow' ||
        CASE WHEN v_expiry_date <> '' THEN ' (' || v_expiry_date || ').' ELSE '.' END,
      'renewal',
      NEW.student_id,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  ELSIF NEW.type = 'renewal_due_today' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'renewal_reminder',
      'Renewal Reminder',
      COALESCE(v_student_name, 'A student') || ' is due for renewal today' ||
        CASE WHEN v_expiry_date <> '' THEN ' (' || v_expiry_date || ').' ELSE '.' END,
      'renewal',
      NEW.student_id,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  ELSIF NEW.type = 'subscription_reminder_3day' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'plan_expiry_warning',
      'Plan expiry warning',
      'Your library subscription will expire in 3 days. Please renew to avoid service interruption.',
      'renewal',
      NULL,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  ELSIF NEW.type = 'subscription_expired_today' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'plan_expired',
      'Plan expired',
      'Your library subscription has expired. Renew now to restore uninterrupted access.',
      'renewal',
      NULL,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  ELSIF NEW.type = 'renewal_payment_submitted' THEN
    PERFORM public.notify_super_admins(
      NEW.library_id,
      'payment_proof_submitted',
      'Payment proof submitted',
      COALESCE(v_student_name, 'A student') || ' submitted a renewal payment proof for library "' || COALESCE(v_library_name, 'Library') || '".',
      'payment',
      NEW.student_id,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  ELSIF NEW.type = 'renewal_payment_approved' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'payment_received',
      'Payment received',
      COALESCE(v_student_name, 'A student') || ' renewal payment was approved successfully.',
      'payment',
      NEW.student_id,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  ELSIF NEW.type = 'subscription_payment_success' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'subscription_renewed',
      'Subscription renewed',
      COALESCE(NEW.message, 'Your library subscription payment was captured successfully.'),
      'renewal',
      NULL,
      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('source_notification_id', NEW.id, 'source_event', NEW.type)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_daily_renewal_reminder_scan()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id BIGINT;
BEGIN
  SELECT net.http_post(
    url := 'https://xaoitjyuuxwksofmmydh.supabase.co/functions/v1/process-renewals',
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
      WHERE jobname = 'daily-renewal-reminder-scan'
    )
  THEN
    PERFORM cron.schedule(
      'daily-renewal-reminder-scan',
      '30 2 * * *',
      $$SELECT public.trigger_daily_renewal_reminder_scan();$$
    );
  END IF;
END
$job$;
