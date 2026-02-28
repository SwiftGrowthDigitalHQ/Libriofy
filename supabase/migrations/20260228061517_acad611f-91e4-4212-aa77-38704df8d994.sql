
-- Waiting list table
CREATE TABLE public.waiting_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  student_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  preferred_slot TEXT,
  preferred_plan TEXT,
  position INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'confirmed', 'expired', 'cancelled')),
  notified_at TIMESTAMPTZ,
  confirmation_deadline TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.waiting_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all waiting list"
  ON public.waiting_list FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can manage their waiting list"
  ON public.waiting_list FOR ALL
  USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE INDEX idx_waiting_list_library ON public.waiting_list(library_id);
CREATE INDEX idx_waiting_list_status ON public.waiting_list(status);
CREATE INDEX idx_waiting_list_position ON public.waiting_list(library_id, position);

CREATE TRIGGER update_waiting_list_updated_at
  BEFORE UPDATE ON public.waiting_list
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function: add to waiting list (auto-position FIFO)
CREATE OR REPLACE FUNCTION public.add_to_waiting_list(
  p_library_id UUID,
  p_student_name TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_preferred_slot TEXT DEFAULT NULL,
  p_preferred_plan TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_position INT;
  v_id UUID;
BEGIN
  -- Get next position
  SELECT COALESCE(MAX(position), 0) + 1 INTO v_position
  FROM public.waiting_list
  WHERE library_id = p_library_id AND status IN ('waiting', 'notified');

  INSERT INTO public.waiting_list (library_id, student_name, phone, email, preferred_slot, preferred_plan, position)
  VALUES (p_library_id, p_student_name, p_phone, p_email, p_preferred_slot, p_preferred_plan, v_position)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'position', v_position);
END;
$$;

-- Function: notify next in queue (called when seat becomes available)
CREATE OR REPLACE FUNCTION public.notify_next_in_queue(p_library_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  -- Find the next waiting person
  SELECT * INTO v_entry
  FROM public.waiting_list
  WHERE library_id = p_library_id AND status = 'waiting'
  ORDER BY position ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No one in queue');
  END IF;

  -- Set 10-minute confirmation window
  UPDATE public.waiting_list
  SET status = 'notified',
      notified_at = now(),
      confirmation_deadline = now() + INTERVAL '10 minutes'
  WHERE id = v_entry.id;

  -- Create notification
  INSERT INTO public.notifications (library_id, type, title, message)
  VALUES (
    p_library_id, 'waitlist_notify',
    'Seat available for: ' || v_entry.student_name,
    v_entry.student_name || ' has been notified. They have 10 minutes to confirm (until ' ||
    to_char(now() + INTERVAL '10 minutes', 'HH:MI AM') || ').'
  );

  RETURN jsonb_build_object(
    'success', true,
    'student_name', v_entry.student_name,
    'deadline', now() + INTERVAL '10 minutes'
  );
END;
$$;

-- Function: confirm waiting list entry
CREATE OR REPLACE FUNCTION public.confirm_waiting_list(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
BEGIN
  SELECT * INTO v_entry FROM public.waiting_list WHERE id = p_entry_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  IF v_entry.status != 'notified' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry is not in notified state');
  END IF;

  IF v_entry.confirmation_deadline < now() THEN
    UPDATE public.waiting_list SET status = 'expired' WHERE id = p_entry_id;
    RETURN jsonb_build_object('success', false, 'error', 'Confirmation window has expired');
  END IF;

  UPDATE public.waiting_list
  SET status = 'confirmed', confirmed_at = now()
  WHERE id = p_entry_id;

  INSERT INTO public.notifications (library_id, type, title, message)
  VALUES (
    v_entry.library_id, 'waitlist_confirmed',
    v_entry.student_name || ' confirmed from waiting list',
    v_entry.student_name || ' has confirmed their seat. Please proceed with admission.'
  );

  RETURN jsonb_build_object('success', true, 'student_name', v_entry.student_name);
END;
$$;

-- Function: expire timed-out entries and auto-notify next
CREATE OR REPLACE FUNCTION public.process_waiting_list_timeouts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry RECORD;
  v_expired_count INT := 0;
  v_notified_count INT := 0;
  v_next JSONB;
BEGIN
  -- Expire entries past their deadline
  FOR v_entry IN
    SELECT * FROM public.waiting_list
    WHERE status = 'notified' AND confirmation_deadline < now()
  LOOP
    UPDATE public.waiting_list SET status = 'expired' WHERE id = v_entry.id;
    
    INSERT INTO public.notifications (library_id, type, title, message)
    VALUES (
      v_entry.library_id, 'waitlist_expired',
      v_entry.student_name || ' did not confirm in time',
      v_entry.student_name || ' failed to confirm within the 10-minute window. Moving to next in queue.'
    );

    v_expired_count := v_expired_count + 1;

    -- Auto-notify next person in this library's queue
    SELECT public.notify_next_in_queue(v_entry.library_id) INTO v_next;
    IF (v_next->>'success')::boolean THEN
      v_notified_count := v_notified_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('expired', v_expired_count, 'notified_next', v_notified_count);
END;
$$;
