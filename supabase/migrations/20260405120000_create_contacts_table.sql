CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can submit contacts" ON public.contacts;
CREATE POLICY "Public can submit contacts"
ON public.contacts
FOR INSERT
TO anon, authenticated
WITH CHECK (
  length(trim(name)) > 0
  AND length(trim(email)) > 0
  AND length(trim(phone)) > 0
  AND length(trim(message)) > 0
);

DROP POLICY IF EXISTS "Super admins can view contacts" ON public.contacts;
CREATE POLICY "Super admins can view contacts"
ON public.contacts
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_contacts_created_at
  ON public.contacts(created_at DESC);
