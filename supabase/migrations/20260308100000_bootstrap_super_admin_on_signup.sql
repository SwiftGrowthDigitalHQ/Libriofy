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
  v_super_admin_email CONSTANT TEXT := 'shop43851@gmail.com';
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, v_full_name)
  ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email;

  IF lower(COALESCE(NEW.email, '')) = v_super_admin_email THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = NEW.id
        AND role = 'super_admin'
    ) THEN
      INSERT INTO public.user_roles (user_id, role, library_id)
      VALUES (NEW.id, 'super_admin', NULL);
    END IF;

    RETURN NEW;
  END IF;

  v_slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9]', '-', 'g'));

  IF EXISTS (SELECT 1 FROM public.libraries WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  END IF;

  INSERT INTO public.libraries (owner_id, name, slug, total_seats)
  VALUES (NEW.id, COALESCE(NULLIF(v_full_name, ''), 'My') || '''s Library', v_slug, 30)
  RETURNING id INTO v_library_id;

  INSERT INTO public.user_roles (user_id, role, library_id)
  VALUES (NEW.id, 'library_owner', v_library_id);

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_super_admin_id UUID;
  v_super_admin_email CONSTANT TEXT := 'shop43851@gmail.com';
BEGIN
  SELECT id
  INTO v_super_admin_id
  FROM auth.users
  WHERE lower(email) = v_super_admin_email
  ORDER BY created_at
  LIMIT 1;

  IF v_super_admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (user_id, email, full_name)
    SELECT
      id,
      email,
      COALESCE(raw_user_meta_data->>'full_name', '')
    FROM auth.users
    WHERE id = v_super_admin_id
    ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email;

    IF NOT EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_id = v_super_admin_id
        AND role = 'super_admin'
    ) THEN
      INSERT INTO public.user_roles (user_id, role, library_id)
      VALUES (v_super_admin_id, 'super_admin', NULL);
    END IF;
  END IF;
END;
$$;
