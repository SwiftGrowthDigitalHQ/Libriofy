DO $$
DECLARE
  v_super_admin_id UUID;
  v_super_admin_email CONSTANT TEXT := 'hello@libriofy.com';
BEGIN
  SELECT id
  INTO v_super_admin_id
  FROM auth.users
  WHERE lower(COALESCE(email, '')) = v_super_admin_email
  ORDER BY created_at
  LIMIT 1;

  IF v_super_admin_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name)
  SELECT
    auth_user.id,
    auth_user.email,
    COALESCE(auth_user.raw_user_meta_data->>'full_name', '')
  FROM auth.users AS auth_user
  WHERE auth_user.id = v_super_admin_id
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = EXCLUDED.email;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_super_admin_id
      AND role = 'super_admin'
  ) THEN
    INSERT INTO public.user_roles (user_id, role, library_id)
    VALUES (v_super_admin_id, 'super_admin', NULL);
  END IF;

  IF to_regclass('public.super_admin_role_grants') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.super_admin_role_grants
      WHERE role = 'super_admin'
        AND user_id = v_super_admin_id
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
    )
  THEN
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
    )
    VALUES (
      v_super_admin_id,
      v_super_admin_email,
      'super_admin',
      'legacy_migrated',
      'global',
      'Bootstrap',
      'Recovered bootstrap super admin access for the canonical Libriofy account.',
      '{}'::jsonb,
      jsonb_build_object(
        'bootstrap_seed', true,
        'source', '20260521193000_super_admin_bootstrap_recovery'
      )
    )
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
