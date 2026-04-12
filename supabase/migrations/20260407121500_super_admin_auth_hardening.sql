CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.auth_trusted_devices
  ADD COLUMN IF NOT EXISTS session_scope TEXT NOT NULL DEFAULT 'general'
    CHECK (session_scope IN ('general', 'super_admin')),
  ADD COLUMN IF NOT EXISTS auth_level SMALLINT NOT NULL DEFAULT 1
    CHECK (auth_level BETWEEN 1 AND 2),
  ADD COLUMN IF NOT EXISTS idle_timeout_seconds INTEGER
    CHECK (idle_timeout_seconds IS NULL OR idle_timeout_seconds > 0);

UPDATE public.auth_trusted_devices
SET revoked_at = COALESCE(revoked_at, now()),
    revocation_reason = COALESCE(revocation_reason, 'super_admin_mfa_upgrade')
WHERE revoked_at IS NULL
  AND user_id IN (
    SELECT user_id
    FROM public.user_roles
    WHERE role = 'super_admin'
  );

CREATE TABLE IF NOT EXISTS public.login_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT,
  ip_address TEXT,
  device TEXT,
  login_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  login_step TEXT NOT NULL CHECK (login_step IN ('password', 'otp')),
  reason TEXT,
  channel TEXT
);

CREATE INDEX IF NOT EXISTS login_logs_user_id_idx
  ON public.login_logs (user_id, login_time DESC);

CREATE INDEX IF NOT EXISTS login_logs_login_time_idx
  ON public.login_logs (login_time DESC);

ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can view login logs" ON public.login_logs;
CREATE POLICY "Super admins can view login logs"
  ON public.login_logs
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

REVOKE ALL ON public.login_logs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.login_logs TO service_role;

CREATE OR REPLACE FUNCTION public.super_admin_verify_password(
  candidate_email TEXT,
  candidate_password TEXT
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  full_name TEXT,
  phone_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    auth_user.id,
    COALESCE(profile.email, auth_user.email),
    profile.full_name,
    profile.phone_number
  FROM auth.users AS auth_user
  JOIN public.user_roles AS role_map
    ON role_map.user_id = auth_user.id
   AND role_map.role = 'super_admin'
  LEFT JOIN public.profiles AS profile
    ON profile.user_id = auth_user.id
  WHERE lower(COALESCE(auth_user.email, '')) = lower(COALESCE(candidate_email, ''))
    AND COALESCE(auth_user.encrypted_password, '') <> ''
    AND extensions.crypt(candidate_password, auth_user.encrypted_password) = auth_user.encrypted_password
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_verify_password(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_verify_password(TEXT, TEXT) TO service_role;
