-- Allow anyone to view a specific library by ID (public page)
CREATE POLICY "Anyone can view library by id"
ON public.libraries
FOR SELECT
USING (true);

-- Allow anyone to view active student counts for availability (only slot column exposed via query)
-- We don't need a new policy since we can compute availability differently.
-- Instead, let's create a function that returns slot availability without exposing student data.
CREATE OR REPLACE FUNCTION public.get_slot_availability(p_library_id uuid)
RETURNS TABLE(slot_name text, available_seats integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    ts.name AS slot_name,
    GREATEST(0, COALESCE(ts.max_seats, l.total_seats) - COUNT(s.id)::int) AS available_seats
  FROM public.time_slots ts
  JOIN public.libraries l ON l.id = ts.library_id
  LEFT JOIN public.students s ON s.library_id = ts.library_id 
    AND s.slot = ts.name 
    AND s.status = 'active'
  WHERE ts.library_id = p_library_id AND ts.is_active = true
  GROUP BY ts.id, ts.name, ts.max_seats, l.total_seats
  ORDER BY ts.start_time;
$$;
