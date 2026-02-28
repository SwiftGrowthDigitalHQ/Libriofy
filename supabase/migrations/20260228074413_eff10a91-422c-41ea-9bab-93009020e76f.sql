
-- Domain approval requests table
CREATE TABLE public.domain_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  review_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.domain_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all domain requests"
ON public.domain_requests FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can view own domain requests"
ON public.domain_requests FOR SELECT
USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE POLICY "Library owners can insert domain requests"
ON public.domain_requests FOR INSERT
WITH CHECK (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE TRIGGER update_domain_requests_updated_at
BEFORE UPDATE ON public.domain_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
