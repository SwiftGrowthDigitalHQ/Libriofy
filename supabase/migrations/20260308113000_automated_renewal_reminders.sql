ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'logged',
  ADD COLUMN IF NOT EXISTS provider_name TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_error TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_delivery_status_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_delivery_status_check
  CHECK (delivery_status IN ('logged', 'queued', 'sent', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS idx_notifications_library_type_created
  ON public.notifications(library_id, type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_renewal_unsent
  ON public.notifications(delivery_status, sent_at)
  WHERE type IN ('renewal_2day', 'renewal_1day', 'renewal_due_today');

CREATE OR REPLACE FUNCTION public.process_renewals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_expired_count INT := 0;
  v_remind_2_count INT := 0;
  v_remind_1_count INT := 0;
  v_remind_today_count INT := 0;
BEGIN
  -- 1. Auto-expire students whose membership already passed
  FOR v_student IN
    SELECT s.id, s.full_name, s.library_id, s.seat_number, s.expiry_date
    FROM public.students s
    WHERE s.status = 'active'
      AND s.expiry_date IS NOT NULL
      AND s.expiry_date < CURRENT_DATE
  LOOP
    UPDATE public.students
    SET status = 'expired'
    WHERE id = v_student.id;

    INSERT INTO public.notifications (
      library_id,
      student_id,
      type,
      title,
      message,
      delivery_status,
      metadata
    )
    VALUES (
      v_student.library_id,
      v_student.id,
      'expiry',
      'Membership expired: ' || v_student.full_name,
      v_student.full_name || '''s membership expired on ' || v_student.expiry_date || '. Seat ' || COALESCE(v_student.seat_number, 'N/A') || ' has been released.',
      'logged',
      jsonb_build_object(
        'expiry_date', v_student.expiry_date::text
      )
    );

    v_expired_count := v_expired_count + 1;
  END LOOP;

  -- 2. 2-day reminder
  FOR v_student IN
    SELECT s.id, s.full_name, s.library_id, s.seat_number, s.expiry_date, s.phone
    FROM public.students s
    WHERE s.status = 'active'
      AND s.expiry_date = CURRENT_DATE + 2
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.student_id = s.id
          AND n.type = 'renewal_2day'
          AND COALESCE(n.metadata->>'expiry_date', '') = s.expiry_date::text
      )
  LOOP
    INSERT INTO public.notifications (
      library_id,
      student_id,
      type,
      title,
      message,
      recipient_phone,
      delivery_status,
      metadata
    )
    VALUES (
      v_student.library_id,
      v_student.id,
      'renewal_2day',
      '2-day renewal reminder: ' || v_student.full_name,
      'Hello ' || v_student.full_name || ',' || E'\n' ||
      'Aapki library' || COALESCE(' seat ' || NULLIF(v_student.seat_number, ''), ' membership') || ' ki validity 2 din baad ' || to_char(v_student.expiry_date, 'DD Mon YYYY') || ' ko khatam ho rahi hai.' || E'\n' ||
      'Please apni seat renew kar lein taki aapki seat kisi aur ko allot na ho jaye.',
      v_student.phone,
      'queued',
      jsonb_build_object(
        'expiry_date', v_student.expiry_date::text,
        'send_on_date', CURRENT_DATE::text,
        'reminder_stage', '2_day'
      )
    );

    v_remind_2_count := v_remind_2_count + 1;
  END LOOP;

  -- 3. 1-day reminder
  FOR v_student IN
    SELECT s.id, s.full_name, s.library_id, s.seat_number, s.expiry_date, s.phone
    FROM public.students s
    WHERE s.status = 'active'
      AND s.expiry_date = CURRENT_DATE + 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.student_id = s.id
          AND n.type = 'renewal_1day'
          AND COALESCE(n.metadata->>'expiry_date', '') = s.expiry_date::text
      )
  LOOP
    INSERT INTO public.notifications (
      library_id,
      student_id,
      type,
      title,
      message,
      recipient_phone,
      delivery_status,
      metadata
    )
    VALUES (
      v_student.library_id,
      v_student.id,
      'renewal_1day',
      '1-day renewal reminder: ' || v_student.full_name,
      'Hello ' || v_student.full_name || ',' || E'\n' ||
      'Aapki library' || COALESCE(' seat ' || NULLIF(v_student.seat_number, ''), ' membership') || ' ki validity kal khatam ho rahi hai (' || to_char(v_student.expiry_date, 'DD Mon YYYY') || ').' || E'\n' ||
      'Please aaj hi renew kar lein taki aapki seat kisi aur ko allot na ho jaye.',
      v_student.phone,
      'queued',
      jsonb_build_object(
        'expiry_date', v_student.expiry_date::text,
        'send_on_date', CURRENT_DATE::text,
        'reminder_stage', '1_day'
      )
    );

    v_remind_1_count := v_remind_1_count + 1;
  END LOOP;

  -- 4. Final reminder on the expiry day
  FOR v_student IN
    SELECT s.id, s.full_name, s.library_id, s.seat_number, s.expiry_date, s.phone
    FROM public.students s
    WHERE s.status = 'active'
      AND s.expiry_date = CURRENT_DATE
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.student_id = s.id
          AND n.type = 'renewal_due_today'
          AND COALESCE(n.metadata->>'expiry_date', '') = s.expiry_date::text
      )
  LOOP
    INSERT INTO public.notifications (
      library_id,
      student_id,
      type,
      title,
      message,
      recipient_phone,
      delivery_status,
      metadata
    )
    VALUES (
      v_student.library_id,
      v_student.id,
      'renewal_due_today',
      'Final renewal reminder: ' || v_student.full_name,
      'Hello ' || v_student.full_name || ',' || E'\n' ||
      'Aaj aapki library' || COALESCE(' seat ' || NULLIF(v_student.seat_number, ''), ' membership') || ' ki validity khatam ho rahi hai (' || to_char(v_student.expiry_date, 'DD Mon YYYY') || ').' || E'\n' ||
      'Final reminder: please turant renew kar lein, warna aapki seat kisi aur ko allot ki ja sakti hai.',
      v_student.phone,
      'queued',
      jsonb_build_object(
        'expiry_date', v_student.expiry_date::text,
        'send_on_date', CURRENT_DATE::text,
        'reminder_stage', 'expiry_day'
      )
    );

    v_remind_today_count := v_remind_today_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'expired', v_expired_count,
    'reminded_2day', v_remind_2_count,
    'reminded_1day', v_remind_1_count,
    'reminded_due_today', v_remind_today_count
  );
END;
$$;
