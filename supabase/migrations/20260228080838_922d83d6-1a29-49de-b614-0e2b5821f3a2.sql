
-- Add phone fields to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS phone_number text UNIQUE,
ADD COLUMN IF NOT EXISTS is_phone_verified boolean NOT NULL DEFAULT false;

-- Update handle_new_user to store phone if provided
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_library_id UUID;
  v_slug TEXT;
  v_full_name TEXT;
  v_phone TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_phone := COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone_number');

  INSERT INTO public.profiles (user_id, email, full_name, phone_number, is_phone_verified)
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    v_phone,
    CASE WHEN NEW.phone IS NOT NULL THEN true ELSE false END
  );

  v_slug := lower(regexp_replace(split_part(COALESCE(NEW.email, NEW.phone, NEW.id::text), '@', 1), '[^a-z0-9]', '-', 'g'));
  IF EXISTS (SELECT 1 FROM public.libraries WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  INSERT INTO public.libraries (owner_id, name, slug, total_seats)
  VALUES (NEW.id, COALESCE(NULLIF(v_full_name, ''), 'My') || '''s Library', v_slug, 30)
  RETURNING id INTO v_library_id;

  INSERT INTO public.user_roles (user_id, role, library_id)
  VALUES (NEW.id, 'library_owner', v_library_id);

  INSERT INTO public.library_subscriptions (library_id, plan_name, price, seats_limit, status, expires_at)
  VALUES (v_library_id, 'starter', 0, 50, 'trial', now() + interval '14 days');

  RETURN NEW;
END;
$function$;
