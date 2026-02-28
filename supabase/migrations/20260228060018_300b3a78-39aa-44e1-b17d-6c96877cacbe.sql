
-- Students table (library-scoped memberships)
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  plan TEXT,
  seat_number TEXT,
  slot TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired', 'waiting')),
  qr_code TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  no_show_days INT NOT NULL DEFAULT 0,
  last_check_in TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attendance logs
CREATE TABLE public.attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE NOT NULL,
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  check_in TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_out TIMESTAMPTZ,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notifications log
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Students RLS
CREATE POLICY "Super admins can manage all students"
  ON public.students FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can manage their students"
  ON public.students FOR ALL
  USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE POLICY "Students can view own record"
  ON public.students FOR SELECT
  USING (user_id = auth.uid());

-- Attendance RLS
CREATE POLICY "Super admins can view all attendance"
  ON public.attendance_logs FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can manage attendance"
  ON public.attendance_logs FOR ALL
  USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE POLICY "Students can view own attendance"
  ON public.attendance_logs FOR SELECT
  USING (student_id IN (SELECT id FROM public.students WHERE user_id = auth.uid()));

-- Notifications RLS
CREATE POLICY "Super admins can view all notifications"
  ON public.notifications FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can manage notifications"
  ON public.notifications FOR ALL
  USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

-- Indexes
CREATE INDEX idx_attendance_student ON public.attendance_logs(student_id);
CREATE INDEX idx_attendance_date ON public.attendance_logs(date);
CREATE INDEX idx_students_library ON public.students(library_id);
CREATE INDEX idx_students_qr ON public.students(qr_code);
CREATE INDEX idx_students_status ON public.students(status);

-- Triggers
CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function for QR check-in (public facing, validates membership)
CREATE OR REPLACE FUNCTION public.qr_check_in(p_qr_code TEXT, p_library_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_existing RECORD;
  v_log_id UUID;
BEGIN
  -- Find student by QR code
  SELECT * INTO v_student FROM public.students
  WHERE qr_code = p_qr_code AND library_id = p_library_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid QR code');
  END IF;
  
  IF v_student.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membership is ' || v_student.status);
  END IF;
  
  IF v_student.expiry_date IS NOT NULL AND v_student.expiry_date < CURRENT_DATE THEN
    UPDATE public.students SET status = 'expired' WHERE id = v_student.id;
    RETURN jsonb_build_object('success', false, 'error', 'Membership has expired');
  END IF;
  
  -- Check if already checked in today without checkout
  SELECT * INTO v_existing FROM public.attendance_logs
  WHERE student_id = v_student.id AND date = CURRENT_DATE AND check_out IS NULL;
  
  IF FOUND THEN
    -- This is a check-out
    UPDATE public.attendance_logs SET check_out = now() WHERE id = v_existing.id;
    RETURN jsonb_build_object(
      'success', true, 'action', 'check_out',
      'student_name', v_student.full_name, 'seat', v_student.seat_number
    );
  ELSE
    -- This is a check-in
    INSERT INTO public.attendance_logs (student_id, library_id)
    VALUES (v_student.id, p_library_id) RETURNING id INTO v_log_id;
    
    UPDATE public.students SET last_check_in = now(), no_show_days = 0 WHERE id = v_student.id;
    
    RETURN jsonb_build_object(
      'success', true, 'action', 'check_in',
      'student_name', v_student.full_name, 'seat', v_student.seat_number
    );
  END IF;
END;
$$;

-- Function to detect no-shows (called by cron)
CREATE OR REPLACE FUNCTION public.detect_no_shows()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
BEGIN
  FOR v_student IN
    SELECT s.id, s.full_name, s.library_id, s.no_show_days,
           COALESCE(s.last_check_in::date, s.start_date) as last_present
    FROM public.students s
    WHERE s.status = 'active'
      AND (s.last_check_in IS NULL OR s.last_check_in < now() - interval '1 day')
  LOOP
    -- Increment no-show counter
    UPDATE public.students
    SET no_show_days = CURRENT_DATE - v_student.last_present
    WHERE id = v_student.id;
    
    -- If 3+ days absent, mark inactive and create notification
    IF (CURRENT_DATE - v_student.last_present) >= 3 THEN
      UPDATE public.students SET status = 'inactive' WHERE id = v_student.id;
      
      INSERT INTO public.notifications (library_id, student_id, type, title, message)
      VALUES (
        v_student.library_id, v_student.id, 'no_show',
        'No-show detected: ' || v_student.full_name,
        v_student.full_name || ' has not checked in for ' || (CURRENT_DATE - v_student.last_present) || ' days. Marked as inactive.'
      );
    END IF;
  END LOOP;
END;
$$;
