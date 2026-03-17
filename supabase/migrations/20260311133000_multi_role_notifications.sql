DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'notification_role'
  ) THEN
    CREATE TYPE public.notification_role AS ENUM ('admin', 'library');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'notification_category'
  ) THEN
    CREATE TYPE public.notification_category AS ENUM ('payment', 'renewal', 'support', 'system', 'affiliate');
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'read'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'is_read'
  ) THEN
    ALTER TABLE public.notifications RENAME COLUMN read TO is_read;
  END IF;
END
$$;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS role public.notification_role,
  ADD COLUMN IF NOT EXISTS category public.notification_category,
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.notifications
  ALTER COLUMN category SET DEFAULT 'system';

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS admin_reply TEXT,
  ADD COLUMN IF NOT EXISTS admin_replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_replied_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.user_can_access_library(_user_id UUID, _library_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.library_id = _library_id
        AND ur.role IN ('library_owner', 'staff')
    )
    OR EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = _library_id
        AND l.owner_id = _user_id
    )
    OR public.has_role(_user_id, 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.notification_category_for_event(p_type TEXT)
RETURNS public.notification_category
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_type TEXT := lower(COALESCE(trim(p_type), ''));
BEGIN
  IF v_type = '' THEN
    RETURN 'system';
  END IF;

  IF v_type LIKE '%affiliate%' OR v_type LIKE '%referral%' THEN
    RETURN 'affiliate';
  END IF;

  IF v_type LIKE '%support%' THEN
    RETURN 'support';
  END IF;

  IF v_type IN ('renewal_2day', 'renewal_1day', 'renewal_due_today', 'expiry', 'subscription_reminder_3day', 'subscription_expired_today', 'subscription_renewed', 'plan_expiry_warning')
    OR v_type LIKE '%renewal%'
    OR v_type LIKE '%expiry%'
  THEN
    RETURN 'renewal';
  END IF;

  IF v_type IN ('coupon_used', 'payment_received', 'payment_proof_submitted', 'subscription_payment_success')
    OR v_type LIKE '%payment%'
    OR v_type LIKE '%coupon%'
  THEN
    RETURN 'payment';
  END IF;

  RETURN 'system';
END;
$$;

CREATE OR REPLACE FUNCTION public.notifications_apply_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category IS NULL THEN
    NEW.category := public.notification_category_for_event(NEW.type);
  END IF;

  NEW.is_read := COALESCE(NEW.is_read, false);
  NEW.delivery_status := COALESCE(NULLIF(NEW.delivery_status, ''), 'logged');

  IF NEW.user_id IS NOT NULL THEN
    NEW.channel := COALESCE(NEW.channel, 'in_app');
    IF NEW.role IS NULL THEN
      NEW.role := 'library';
    END IF;
    IF NEW.channel = 'in_app' AND NEW.sent_at IS NULL THEN
      NEW.sent_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_notifications_defaults ON public.notifications;
CREATE TRIGGER apply_notifications_defaults
BEFORE INSERT OR UPDATE ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.notifications_apply_defaults();

CREATE OR REPLACE FUNCTION public.notify_library_users(
  p_library_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_category public.notification_category DEFAULT NULL,
  p_student_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count INTEGER := 0;
BEGIN
  WITH recipients AS (
    SELECT DISTINCT recipient_id
    FROM (
      SELECT l.owner_id AS recipient_id
      FROM public.libraries l
      WHERE l.id = p_library_id

      UNION ALL

      SELECT ur.user_id AS recipient_id
      FROM public.user_roles ur
      WHERE ur.library_id = p_library_id
        AND ur.role IN ('library_owner', 'staff')
    ) recipient_rows
    WHERE recipient_id IS NOT NULL
  ),
  inserted AS (
    INSERT INTO public.notifications (
      user_id,
      library_id,
      role,
      category,
      type,
      title,
      message,
      is_read,
      student_id,
      metadata,
      channel,
      delivery_status,
      sent_at
    )
    SELECT
      recipient_id,
      p_library_id,
      'library',
      COALESCE(p_category, public.notification_category_for_event(p_type)),
      p_type,
      p_title,
      p_message,
      false,
      p_student_id,
      COALESCE(p_metadata, '{}'::jsonb),
      'in_app',
      'logged',
      now()
    FROM recipients
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted_count FROM inserted;

  RETURN v_inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_super_admins(
  p_library_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_category public.notification_category DEFAULT NULL,
  p_student_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted_count INTEGER := 0;
BEGIN
  WITH recipients AS (
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'super_admin'
  ),
  inserted AS (
    INSERT INTO public.notifications (
      user_id,
      library_id,
      role,
      category,
      type,
      title,
      message,
      is_read,
      student_id,
      metadata,
      channel,
      delivery_status,
      sent_at
    )
    SELECT
      user_id,
      p_library_id,
      'admin',
      COALESCE(p_category, public.notification_category_for_event(p_type)),
      p_type,
      p_title,
      p_message,
      false,
      p_student_id,
      COALESCE(p_metadata, '{}'::jsonb),
      'in_app',
      'logged',
      now()
    FROM recipients
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted_count FROM inserted;

  RETURN v_inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fanout_operational_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_library_name TEXT;
  v_student_name TEXT;
  v_expiry_date TEXT := COALESCE(NEW.metadata->>'expiry_date', '');
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

  IF NEW.type = 'renewal_2day' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'renewal_reminder',
      'Renewal Reminder',
      COALESCE(v_student_name, 'A student') || ' has a renewal due in 2 days' ||
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

DROP TRIGGER IF EXISTS fanout_operational_notifications ON public.notifications;
CREATE TRIGGER fanout_operational_notifications
AFTER INSERT ON public.notifications
FOR EACH ROW
WHEN (NEW.user_id IS NULL)
EXECUTE FUNCTION public.fanout_operational_notification();

CREATE OR REPLACE FUNCTION public.handle_student_notification_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_name TEXT := COALESCE(NEW.full_name, 'Student');
  v_seat_number TEXT;
  v_old_seat_number TEXT;
BEGIN
  SELECT COALESCE(seat.seat_number, NEW.seat_number)
  INTO v_seat_number
  FROM (SELECT 1) seed
  LEFT JOIN public.seats seat ON seat.id = NEW.seat_id;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'student_added',
      'New student added',
      v_student_name || ' was added to your library.',
      'system',
      NEW.id,
      jsonb_build_object('student_id', NEW.id, 'seat_number', v_seat_number)
    );

    IF COALESCE(NULLIF(v_seat_number, ''), NULL) IS NOT NULL THEN
      PERFORM public.notify_library_users(
        NEW.library_id,
        'seat_booked',
        'Seat booked',
        'Seat ' || v_seat_number || ' was assigned to ' || v_student_name || '.',
        'system',
        NEW.id,
        jsonb_build_object('student_id', NEW.id, 'seat_number', v_seat_number)
      );
    END IF;

    RETURN NEW;
  END IF;

  SELECT COALESCE(seat.seat_number, OLD.seat_number)
  INTO v_old_seat_number
  FROM (SELECT 1) seed
  LEFT JOIN public.seats seat ON seat.id = OLD.seat_id;

  IF COALESCE(NULLIF(v_seat_number, ''), '') <> ''
    AND COALESCE(v_seat_number, '') IS DISTINCT FROM COALESCE(v_old_seat_number, '')
  THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'seat_booked',
      'Seat booked',
      'Seat ' || v_seat_number || ' was assigned to ' || v_student_name || '.',
      'system',
      NEW.id,
      jsonb_build_object('student_id', NEW.id, 'seat_number', v_seat_number, 'previous_seat_number', v_old_seat_number)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_student_insert ON public.students;
CREATE TRIGGER notify_on_student_insert
AFTER INSERT ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.handle_student_notification_events();

DROP TRIGGER IF EXISTS notify_on_student_seat_update ON public.students;
CREATE TRIGGER notify_on_student_seat_update
AFTER UPDATE OF seat_id, seat_number ON public.students
FOR EACH ROW
EXECUTE FUNCTION public.handle_student_notification_events();

CREATE OR REPLACE FUNCTION public.handle_payment_notification_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_name TEXT;
  v_seat_number TEXT;
  v_is_success BOOLEAN;
  v_was_success BOOLEAN := false;
BEGIN
  v_is_success := lower(COALESCE(NEW.status, '')) IN ('approved', 'completed', 'captured');

  IF TG_OP = 'UPDATE' THEN
    v_was_success := lower(COALESCE(OLD.status, '')) IN ('approved', 'completed', 'captured');
  END IF;

  IF NOT v_is_success OR v_was_success THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.source, 'manual') IN ('student_renewal', 'subscription') THEN
    RETURN NEW;
  END IF;

  SELECT
    s.full_name,
    COALESCE(seat.seat_number, s.seat_number)
  INTO
    v_student_name,
    v_seat_number
  FROM public.students s
  LEFT JOIN public.seats seat ON seat.id = s.seat_id
  WHERE s.id = NEW.student_id;

  PERFORM public.notify_library_users(
    NEW.library_id,
    'payment_received',
    'Payment received',
    'Payment of Rs ' || COALESCE(NEW.amount, 0)::text || ' received from ' || COALESCE(v_student_name, 'a student') ||
      CASE WHEN COALESCE(v_seat_number, '') <> '' THEN ' for seat ' || v_seat_number || '.' ELSE '.' END,
    'payment',
    NEW.student_id,
    jsonb_build_object('payment_id', NEW.id, 'amount', NEW.amount, 'source', NEW.source, 'status', NEW.status)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_payment_change ON public.payments;
CREATE TRIGGER notify_on_payment_change
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.handle_payment_notification_events();

CREATE OR REPLACE FUNCTION public.handle_support_ticket_notification_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_library_name TEXT;
BEGIN
  SELECT l.name
  INTO v_library_name
  FROM public.libraries l
  WHERE l.id = NEW.library_id;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_super_admins(
      NEW.library_id,
      'support_ticket_created',
      'Support ticket created',
      'Library "' || COALESCE(v_library_name, 'Library') || '" created a support ticket: ' || NEW.title || '.',
      'support',
      NULL,
      jsonb_build_object('ticket_id', NEW.id, 'ticket_title', NEW.title, 'library_name', v_library_name, 'created_by', NEW.user_id)
    );
    RETURN NEW;
  END IF;

  IF NEW.admin_reply IS DISTINCT FROM OLD.admin_reply
    AND COALESCE(trim(NEW.admin_reply), '') <> ''
  THEN
    PERFORM public.notify_library_users(
      NEW.library_id,
      'support_reply',
      'Support reply',
      NEW.admin_reply,
      'support',
      NULL,
      jsonb_build_object(
        'ticket_id', NEW.id,
        'ticket_title', NEW.title,
        'status', NEW.status,
        'library_name', v_library_name,
        'admin_replied_at', NEW.admin_replied_at
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_support_ticket_insert ON public.support_tickets;
CREATE TRIGGER notify_on_support_ticket_insert
AFTER INSERT ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.handle_support_ticket_notification_events();

DROP TRIGGER IF EXISTS notify_on_support_ticket_reply ON public.support_tickets;
CREATE TRIGGER notify_on_support_ticket_reply
AFTER UPDATE OF admin_reply ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.handle_support_ticket_notification_events();

CREATE OR REPLACE FUNCTION public.handle_library_signup_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_super_admins(
    NEW.id,
    'library_registered',
    'New library registered',
    'A new library "' || COALESCE(NEW.name, 'Library') || '" has registered on the platform.',
    'system',
    NULL,
    jsonb_build_object('library_id', NEW.id, 'library_name', NEW.name, 'owner_id', NEW.owner_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_library_signup ON public.libraries;
CREATE TRIGGER notify_on_library_signup
AFTER INSERT ON public.libraries
FOR EACH ROW
EXECUTE FUNCTION public.handle_library_signup_notification();

CREATE OR REPLACE FUNCTION public.handle_coupon_redemption_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_library_name TEXT;
BEGIN
  IF NEW.status <> 'captured' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'captured' THEN
    RETURN NEW;
  END IF;

  SELECT l.name
  INTO v_library_name
  FROM public.libraries l
  WHERE l.id = NEW.library_id;

  PERFORM public.notify_super_admins(
    NEW.library_id,
    'coupon_used',
    'Coupon used',
    'Coupon ' || COALESCE(NEW.code, 'N/A') || ' was used by library "' || COALESCE(v_library_name, 'Library') || '".',
    'payment',
    NULL,
    jsonb_build_object(
      'coupon_id', NEW.coupon_id,
      'coupon_code', NEW.code,
      'discount_amount', NEW.discount_amount,
      'library_name', v_library_name,
      'subscription_payment_id', NEW.subscription_payment_id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_coupon_redemption ON public.coupon_redemptions;
CREATE TRIGGER notify_on_coupon_redemption
AFTER INSERT OR UPDATE OF status ON public.coupon_redemptions
FOR EACH ROW
EXECUTE FUNCTION public.handle_coupon_redemption_notification();

CREATE OR REPLACE FUNCTION public.handle_library_acquisition_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_library_name TEXT;
  v_affiliate_name TEXT;
  v_affiliate_code TEXT;
BEGIN
  IF NEW.affiliate_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.affiliate_id IS NOT DISTINCT FROM OLD.affiliate_id THEN
    RETURN NEW;
  END IF;

  SELECT l.name
  INTO v_library_name
  FROM public.libraries l
  WHERE l.id = NEW.library_id;

  SELECT a.name, a.code
  INTO v_affiliate_name, v_affiliate_code
  FROM public.affiliates a
  WHERE a.id = NEW.affiliate_id;

  PERFORM public.notify_super_admins(
    NEW.library_id,
    'affiliate_referral_signup',
    'Affiliate referral signup',
    'Library "' || COALESCE(v_library_name, 'Library') || '" signed up via affiliate ' ||
      COALESCE(v_affiliate_name, v_affiliate_code, 'partner') || '.',
    'affiliate',
    NULL,
    jsonb_build_object(
      'affiliate_id', NEW.affiliate_id,
      'affiliate_name', v_affiliate_name,
      'affiliate_code', v_affiliate_code,
      'library_id', NEW.library_id,
      'library_name', v_library_name,
      'owner_id', NEW.owner_id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_on_library_acquisition ON public.library_acquisition;
CREATE TRIGGER notify_on_library_acquisition
AFTER INSERT OR UPDATE OF affiliate_id ON public.library_acquisition
FOR EACH ROW
EXECUTE FUNCTION public.handle_library_acquisition_notification();

UPDATE public.notifications
SET
  category = public.notification_category_for_event(type),
  is_read = COALESCE(is_read, false)
WHERE category IS NULL
   OR is_read IS DISTINCT FROM COALESCE(is_read, false);

DROP POLICY IF EXISTS "Super admins can view all notifications" ON public.notifications;
DROP POLICY IF EXISTS "Library owners can manage notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own notifications or library logs" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;

CREATE POLICY "Users can view own notifications or library logs"
ON public.notifications
FOR SELECT
USING (
  auth.uid() = user_id
  OR (user_id IS NULL AND public.user_can_access_library(auth.uid(), library_id))
);

CREATE POLICY "Users can update own notifications"
ON public.notifications
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Library owners can manage own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Library teams can manage own tickets" ON public.support_tickets;

CREATE POLICY "Library teams can manage own tickets"
ON public.support_tickets
FOR ALL
USING (public.user_can_access_library(auth.uid(), library_id));

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_category_created
  ON public.notifications(user_id, category, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_library_log_created
  ON public.notifications(library_id, created_at DESC)
  WHERE user_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;
