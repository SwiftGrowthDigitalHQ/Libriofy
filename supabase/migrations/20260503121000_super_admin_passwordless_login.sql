ALTER TABLE public.login_logs
  DROP CONSTRAINT IF EXISTS login_logs_login_step_check;

UPDATE public.login_logs
SET login_step = 'email'
WHERE login_step = 'password';

ALTER TABLE public.login_logs
  ADD CONSTRAINT login_logs_login_step_check
    CHECK (login_step IN ('email', 'otp'));

DROP FUNCTION IF EXISTS public.super_admin_verify_password(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.find_super_admin_by_email(candidate_email TEXT)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  full_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    auth_user.id,
    COALESCE(profile.email, auth_user.email) AS email,
    profile.full_name
  FROM auth.users AS auth_user
  JOIN public.user_roles AS role_map
    ON role_map.user_id = auth_user.id
   AND role_map.role = 'super_admin'
  LEFT JOIN public.profiles AS profile
    ON profile.user_id = auth_user.id
  WHERE lower(COALESCE(auth_user.email, '')) = lower(COALESCE(candidate_email, ''))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_super_admin_by_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_super_admin_by_email(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
