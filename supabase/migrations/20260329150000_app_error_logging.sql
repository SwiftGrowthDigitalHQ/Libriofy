CREATE TABLE IF NOT EXISTS public.app_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  route TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_type TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL DEFAULT 'client',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT app_error_logs_error_type_check CHECK (error_type IN ('network', 'server', 'unknown'))
);

ALTER TABLE public.app_error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated and anonymous can insert app error logs" ON public.app_error_logs;
CREATE POLICY "Authenticated and anonymous can insert app error logs"
ON public.app_error_logs
FOR INSERT
TO anon, authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "Super admins can view app error logs" ON public.app_error_logs;
CREATE POLICY "Super admins can view app error logs"
ON public.app_error_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_app_error_logs_created_at
  ON public.app_error_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_error_logs_user_created_at
  ON public.app_error_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_error_logs_route_created_at
  ON public.app_error_logs(route, created_at DESC);
