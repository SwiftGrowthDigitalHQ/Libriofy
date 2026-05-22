-- Bootstrap the primary super admin user (hello@libriofy.com) in the new Supabase project.
-- This migration is idempotent: it only inserts if the user does not already exist.

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Check if the user already exists in auth.users
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = 'hello@libriofy.com'
  LIMIT 1;

  -- If user does not exist, create them
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'hello@libriofy.com',
      -- No password needed; auth is OTP-based
      crypt(gen_random_uuid()::text, gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
      jsonb_build_object('full_name', 'Libriofy Admin'),
      now(),
      now(),
      '',
      ''
    );

    -- Create identity record required by Supabase Auth (if table exists)
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'auth' AND table_name = 'identities'
    ) THEN
      INSERT INTO auth.identities (
        id,
        user_id,
        provider_id,
        provider,
        identity_data,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        'email',
        jsonb_build_object('sub', v_user_id::text, 'email', 'hello@libriofy.com'),
        now(),
        now(),
        now()
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Ensure profile exists
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (v_user_id, 'hello@libriofy.com', 'Libriofy Admin')
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  -- Ensure super_admin role exists in user_roles
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user_id
      AND role = 'super_admin'
  ) THEN
    INSERT INTO public.user_roles (user_id, role, library_id)
    VALUES (v_user_id, 'super_admin', NULL);
  END IF;

  -- Ensure active role grant exists in super_admin_role_grants
  IF NOT EXISTS (
    SELECT 1 FROM public.super_admin_role_grants
    WHERE user_id = v_user_id
      AND role = 'super_admin'
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    INSERT INTO public.super_admin_role_grants (
      user_id,
      email,
      role,
      grant_mode,
      scope_type,
      scope_label,
      reason,
      restrictions,
      metadata
    ) VALUES (
      v_user_id,
      'hello@libriofy.com',
      'super_admin',
      'direct',
      'global',
      'Bootstrap Admin',
      'Initial platform bootstrap - primary super admin account.',
      '{}'::jsonb,
      jsonb_build_object(
        'bootstrap', true,
        'source', 'seed_migration',
        'created_by', 'migration:20260522120000'
      )
    );
  END IF;

  RAISE NOTICE 'Super admin bootstrap complete. user_id=%', v_user_id;
END $$;
