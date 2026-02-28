
-- Library subscriptions table for SaaS monetization
CREATE TABLE public.library_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL DEFAULT 'starter',
  price NUMERIC NOT NULL DEFAULT 999,
  seats_limit INTEGER NOT NULL DEFAULT 50,
  features JSONB NOT NULL DEFAULT '["seat_management","analytics"]'::jsonb,
  status TEXT NOT NULL DEFAULT 'trial',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(library_id)
);

-- Enable RLS
ALTER TABLE public.library_subscriptions ENABLE ROW LEVEL SECURITY;

-- Super admins can do everything
CREATE POLICY "Super admins can manage all subscriptions"
ON public.library_subscriptions FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'));

-- Library owners can view their own subscription
CREATE POLICY "Owners can view own subscription"
ON public.library_subscriptions FOR SELECT
USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_library_subscriptions_updated_at
BEFORE UPDATE ON public.library_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Support tickets table
CREATE TABLE public.support_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage all tickets"
ON public.support_tickets FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Library owners can manage own tickets"
ON public.support_tickets FOR ALL
USING (library_id IN (SELECT id FROM public.libraries WHERE owner_id = auth.uid()));

CREATE TRIGGER update_support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create trial subscription for new libraries
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_library_id UUID;
  v_slug TEXT;
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, v_full_name);

  v_slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]', '-', 'g'));
  IF EXISTS (SELECT 1 FROM public.libraries WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  INSERT INTO public.libraries (owner_id, name, slug, total_seats)
  VALUES (NEW.id, COALESCE(NULLIF(v_full_name, ''), 'My') || '''s Library', v_slug, 30)
  RETURNING id INTO v_library_id;

  INSERT INTO public.user_roles (user_id, role, library_id)
  VALUES (NEW.id, 'library_owner', v_library_id);

  -- Auto-create trial subscription (14 days)
  INSERT INTO public.library_subscriptions (library_id, plan_name, price, seats_limit, status, expires_at)
  VALUES (v_library_id, 'starter', 0, 50, 'trial', now() + interval '14 days');

  RETURN NEW;
END;
$$;
