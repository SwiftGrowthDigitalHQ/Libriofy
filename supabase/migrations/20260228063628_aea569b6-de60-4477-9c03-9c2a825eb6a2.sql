
-- Update handle_new_user to also create a library and assign library_owner role
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

  -- Create profile
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, v_full_name);

  -- Generate a unique slug from email prefix
  v_slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]', '-', 'g'));
  -- Ensure uniqueness by appending random suffix if needed
  IF EXISTS (SELECT 1 FROM public.libraries WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  -- Auto-create a library for the new user
  INSERT INTO public.libraries (owner_id, name, slug, total_seats)
  VALUES (NEW.id, COALESCE(NULLIF(v_full_name, ''), 'My') || '''s Library', v_slug, 30)
  RETURNING id INTO v_library_id;

  -- Assign library_owner role
  INSERT INTO public.user_roles (user_id, role, library_id)
  VALUES (NEW.id, 'library_owner', v_library_id);

  RETURN NEW;
END;
$$;

-- Create the trigger if it doesn't exist (drop and recreate to be safe)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
