
-- Payments table for tracking subscription payments
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  payment_method TEXT DEFAULT 'simulated',
  plan TEXT,
  period_start DATE,
  period_end DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all payments"
  ON public.payments FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can manage their payments"
  ON public.payments FOR ALL
  USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE POLICY "Students can view own payments"
  ON public.payments FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()));

CREATE INDEX idx_payments_library ON public.payments(library_id);
CREATE INDEX idx_payments_student ON public.payments(student_id);

-- Function to process renewals: auto-expire, send reminders
CREATE OR REPLACE FUNCTION public.process_renewals()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_expired_count INT := 0;
  v_remind_3_count INT := 0;
  v_remind_1_count INT := 0;
BEGIN
  -- 1. Auto-expire: students whose expiry_date has passed
  FOR v_student IN
    SELECT s.id, s.full_name, s.library_id, s.seat_number, s.expiry_date
    FROM public.students s
    WHERE s.status = 'active'
      AND s.expiry_date IS NOT NULL
      AND s.expiry_date < CURRENT_DATE
  LOOP
    UPDATE public.students SET status = 'expired' WHERE id = v_student.id;

    -- Release seat info
    INSERT INTO public.notifications (library_id, student_id, type, title, message)
    VALUES (
      v_student.library_id, v_student.id, 'expiry',
      'Membership expired: ' || v_student.full_name,
      v_student.full_name || '''s membership expired on ' || v_student.expiry_date || '. Seat ' || COALESCE(v_student.seat_number, 'N/A') || ' has been released.'
    );
    v_expired_count := v_expired_count + 1;
  END LOOP;

  -- 2. 3-day reminder
  FOR v_student IN
    SELECT s.id, s.full_name, s.library_id, s.expiry_date
    FROM public.students s
    WHERE s.status = 'active'
      AND s.expiry_date IS NOT NULL
      AND s.expiry_date = CURRENT_DATE + INTERVAL '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.student_id = s.id AND n.type = 'renewal_3day'
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    INSERT INTO public.notifications (library_id, student_id, type, title, message)
    VALUES (
      v_student.library_id, v_student.id, 'renewal_3day',
      'Renewal reminder: ' || v_student.full_name,
      v_student.full_name || '''s membership expires in 3 days (' || v_student.expiry_date || '). Please renew to keep your seat.'
    );
    v_remind_3_count := v_remind_3_count + 1;
  END LOOP;

  -- 3. 1-day reminder
  FOR v_student IN
    SELECT s.id, s.full_name, s.library_id, s.expiry_date
    FROM public.students s
    WHERE s.status = 'active'
      AND s.expiry_date IS NOT NULL
      AND s.expiry_date = CURRENT_DATE + INTERVAL '1 day'
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.student_id = s.id AND n.type = 'renewal_1day'
          AND n.created_at::date = CURRENT_DATE
      )
  LOOP
    INSERT INTO public.notifications (library_id, student_id, type, title, message)
    VALUES (
      v_student.library_id, v_student.id, 'renewal_1day',
      'URGENT renewal: ' || v_student.full_name,
      v_student.full_name || '''s membership expires TOMORROW (' || v_student.expiry_date || '). Renew now to avoid losing your seat.'
    );
    v_remind_1_count := v_remind_1_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'expired', v_expired_count,
    'reminded_3day', v_remind_3_count,
    'reminded_1day', v_remind_1_count
  );
END;
$$;

-- Function to renew a student's membership
CREATE OR REPLACE FUNCTION public.renew_student(
  p_student_id UUID,
  p_months INT DEFAULT 1,
  p_amount NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_new_expiry DATE;
BEGIN
  SELECT * INTO v_student FROM public.students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found');
  END IF;

  -- Calculate new expiry from current expiry or today
  v_new_expiry := GREATEST(COALESCE(v_student.expiry_date, CURRENT_DATE), CURRENT_DATE) + (p_months * INTERVAL '1 month');

  -- Update student
  UPDATE public.students
  SET expiry_date = v_new_expiry,
      status = 'active',
      no_show_days = 0
  WHERE id = p_student_id;

  -- Create payment record
  INSERT INTO public.payments (library_id, student_id, amount, status, plan, period_start, period_end)
  VALUES (
    v_student.library_id, p_student_id, p_amount, 'completed',
    v_student.plan,
    GREATEST(COALESCE(v_student.expiry_date, CURRENT_DATE), CURRENT_DATE),
    v_new_expiry
  );

  -- Notification
  INSERT INTO public.notifications (library_id, student_id, type, title, message)
  VALUES (
    v_student.library_id, p_student_id, 'renewal_success',
    'Membership renewed: ' || v_student.full_name,
    v_student.full_name || ' renewed until ' || v_new_expiry || '. Amount: ₹' || p_amount
  );

  RETURN jsonb_build_object('success', true, 'new_expiry', v_new_expiry);
END;
$$;
