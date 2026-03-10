ALTER TABLE public.libraries
ADD COLUMN IF NOT EXISTS upi_id TEXT;

ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS seat_id TEXT,
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS payment_screenshot TEXT,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);

ALTER TABLE public.payments
DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE public.payments
ADD CONSTRAINT payments_status_check
CHECK (status IN ('pending', 'approved', 'completed', 'failed', 'refunded', 'created', 'captured'));

ALTER TABLE public.payments
DROP CONSTRAINT IF EXISTS payments_source_check;

ALTER TABLE public.payments
ADD CONSTRAINT payments_source_check
CHECK (source IN ('manual', 'student_renewal', 'subscription'));

CREATE INDEX IF NOT EXISTS idx_payments_source_status
  ON public.payments(source, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.can_access_library(_user_id UUID, _library_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin')
    OR EXISTS (
      SELECT 1
      FROM public.libraries l
      WHERE l.id = _library_id
        AND l.owner_id = _user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.library_id = _library_id
        AND ur.role IN ('library_owner', 'staff')
    );
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payments'
      AND policyname = 'Staff can manage library payments'
  ) THEN
    CREATE POLICY "Staff can manage library payments"
      ON public.payments
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.library_id = payments.library_id
            AND ur.role = 'staff'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.library_id = payments.library_id
            AND ur.role = 'staff'
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_student_renewal_context(p_student_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'student_id', s.id,
    'library_id', s.library_id,
    'student_name', s.full_name,
    'seat_id', s.seat_number,
    'seat_number', s.seat_number,
    'plan_name', s.plan,
    'expiry_date', s.expiry_date,
    'renewal_amount', COALESCE(plan_match.price, 0),
    'library_name', l.name,
    'upi_id', l.upi_id,
    'latest_payment_status', latest_payment.status,
    'latest_payment_created_at', latest_payment.created_at
  )
  INTO v_result
  FROM public.students s
  JOIN public.libraries l
    ON l.id = s.library_id
  LEFT JOIN LATERAL (
    SELECT p.price
    FROM public.plans p
    WHERE p.library_id = s.library_id
      AND p.is_active = true
      AND lower(trim(p.name)) = lower(trim(COALESCE(s.plan, '')))
    ORDER BY p.created_at DESC
    LIMIT 1
  ) plan_match ON true
  LEFT JOIN LATERAL (
    SELECT p.status, p.created_at
    FROM public.payments p
    WHERE p.student_id = s.id
      AND p.source = 'student_renewal'
    ORDER BY p.created_at DESC
    LIMIT 1
  ) latest_payment ON true
  WHERE s.qr_code = p_student_token
  LIMIT 1;

  RETURN COALESCE(
    v_result,
    jsonb_build_object(
      'student_id', NULL,
      'library_id', NULL,
      'student_name', NULL,
      'seat_id', NULL,
      'seat_number', NULL,
      'plan_name', NULL,
      'expiry_date', NULL,
      'renewal_amount', NULL,
      'library_name', NULL,
      'upi_id', NULL,
      'latest_payment_status', NULL,
      'latest_payment_created_at', NULL
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_renewal_context(TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_renewal_payment(
  p_student_token TEXT,
  p_amount NUMERIC,
  p_payment_screenshot TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_library public.libraries%ROWTYPE;
  v_existing_status TEXT;
  v_payment_id UUID;
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  IF COALESCE(trim(p_student_token), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Renewal link is invalid.');
  END IF;

  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid renewal amount.');
  END IF;

  SELECT *
  INTO v_student
  FROM public.students
  WHERE qr_code = p_student_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found.');
  END IF;

  SELECT *
  INTO v_library
  FROM public.libraries
  WHERE id = v_student.library_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Library not found.');
  END IF;

  IF COALESCE(trim(v_library.upi_id), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Library has not configured a UPI ID yet.');
  END IF;

  SELECT p.status
  INTO v_existing_status
  FROM public.payments p
  WHERE p.student_id = v_student.id
    AND p.source = 'student_renewal'
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_existing_status = 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your payment proof is already pending approval.');
  END IF;

  v_period_start := GREATEST(COALESCE(v_student.expiry_date, CURRENT_DATE), CURRENT_DATE);
  v_period_end := v_period_start + 30;

  INSERT INTO public.payments (
    library_id,
    student_id,
    amount,
    status,
    payment_method,
    plan,
    period_start,
    period_end,
    seat_id,
    source,
    payment_screenshot
  )
  VALUES (
    v_student.library_id,
    v_student.id,
    p_amount,
    'pending',
    'upi_qr',
    v_student.plan,
    v_period_start,
    v_period_end,
    v_student.seat_number,
    'student_renewal',
    p_payment_screenshot
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.notifications (
    library_id,
    student_id,
    type,
    title,
    message
  )
  VALUES (
    v_student.library_id,
    v_student.id,
    'renewal_payment_submitted',
    'Renewal payment proof submitted',
    v_student.full_name || ' submitted a renewal payment proof for seat ' || COALESCE(v_student.seat_number, 'N/A') || '.'
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'status', 'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_renewal_payment(TEXT, NUMERIC, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_student_renewal_payment_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_period_start DATE;
  v_new_expiry DATE;
BEGIN
  IF NEW.source <> 'student_renewal' OR NEW.status <> 'approved' OR COALESCE(OLD.status, '') = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_student
  FROM public.students
  WHERE id = NEW.student_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_period_start := GREATEST(COALESCE(v_student.expiry_date, CURRENT_DATE), CURRENT_DATE);
  v_new_expiry := v_period_start + 30;

  UPDATE public.students
  SET
    expiry_date = v_new_expiry,
    status = 'active',
    no_show_days = 0
  WHERE id = NEW.student_id;

  NEW.period_start := COALESCE(NEW.period_start, v_period_start);
  NEW.period_end := v_new_expiry;
  NEW.approved_at := COALESCE(NEW.approved_at, now());
  NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());

  INSERT INTO public.notifications (
    library_id,
    student_id,
    type,
    title,
    message
  )
  VALUES (
    NEW.library_id,
    NEW.student_id,
    'renewal_payment_approved',
    'Renewal approved',
    v_student.full_name || ' renewed successfully until ' || v_new_expiry || '.'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_student_renewal_payment_approval ON public.payments;

CREATE TRIGGER apply_student_renewal_payment_approval
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.handle_student_renewal_payment_approval();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-screenshots',
  'payment-screenshots',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
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
      AND policyname = 'Anyone can upload renewal screenshots'
  ) THEN
    CREATE POLICY "Anyone can upload renewal screenshots"
      ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'payment-screenshots'
        AND (storage.foldername(name))[1] IS NOT NULL
        AND (storage.foldername(name))[2] IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.students s
          WHERE s.library_id::text = (storage.foldername(name))[1]
            AND s.qr_code = (storage.foldername(name))[2]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Library team can read renewal screenshots'
  ) THEN
    CREATE POLICY "Library team can read renewal screenshots"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'payment-screenshots'
        AND (storage.foldername(name))[1] IS NOT NULL
        AND public.can_access_library(auth.uid(), ((storage.foldername(name))[1])::uuid)
      );
  END IF;
END
$$;
