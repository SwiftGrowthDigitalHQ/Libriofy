
-- Plans table
CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  duration_hours INT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Time slots table
CREATE TABLE public.time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_seats INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_slots ENABLE ROW LEVEL SECURITY;

-- Plans RLS
CREATE POLICY "Super admins can manage all plans"
  ON public.plans FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can manage their plans"
  ON public.plans FOR ALL
  USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE POLICY "Anyone can view active plans"
  ON public.plans FOR SELECT
  USING (is_active = true);

-- Time slots RLS
CREATE POLICY "Super admins can manage all slots"
  ON public.time_slots FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can manage their slots"
  ON public.time_slots FOR ALL
  USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE POLICY "Anyone can view active slots"
  ON public.time_slots FOR SELECT
  USING (is_active = true);

-- Indexes
CREATE INDEX idx_plans_library ON public.plans(library_id);
CREATE INDEX idx_time_slots_library ON public.time_slots(library_id);

-- Triggers
CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_time_slots_updated_at
  BEFORE UPDATE ON public.time_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
