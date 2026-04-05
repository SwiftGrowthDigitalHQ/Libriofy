CREATE TABLE IF NOT EXISTS public.auth_trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_fingerprint_hash TEXT,
  device_label TEXT,
  login_method TEXT NOT NULL CHECK (login_method IN ('otp', 'email')),
  phone_number TEXT,
  delivery_channel TEXT,
  user_agent TEXT,
  last_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT
);

CREATE INDEX IF NOT EXISTS auth_trusted_devices_user_id_idx
  ON public.auth_trusted_devices (user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS auth_trusted_devices_fingerprint_idx
  ON public.auth_trusted_devices (user_id, device_fingerprint_hash);

ALTER TABLE public.auth_trusted_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own trusted devices" ON public.auth_trusted_devices;
CREATE POLICY "Users can view own trusted devices"
  ON public.auth_trusted_devices
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own trusted devices" ON public.auth_trusted_devices;
CREATE POLICY "Users can update own trusted devices"
  ON public.auth_trusted_devices
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.auth_trusted_devices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_trusted_devices TO service_role;
