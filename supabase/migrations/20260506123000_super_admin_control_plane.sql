CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  rollout_percentage INTEGER NOT NULL DEFAULT 100 CHECK (rollout_percentage BETWEEN 0 AND 100),
  variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  cache_ttl_seconds INTEGER NOT NULL DEFAULT 60 CHECK (cache_ttl_seconds > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.platform_account_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  library_id UUID REFERENCES public.libraries(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  reason TEXT,
  until_at TIMESTAMPTZ,
  password_reset_required BOOLEAN NOT NULL DEFAULT false,
  clear_sessions_after TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.library_control_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL UNIQUE REFERENCES public.libraries(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  reason TEXT,
  until_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.super_admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  target_display TEXT,
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID REFERENCES public.libraries(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.library_commission_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL UNIQUE REFERENCES public.libraries(id) ON DELETE CASCADE,
  commission_percent NUMERIC(5,2) NOT NULL CHECK (commission_percent >= 0 AND commission_percent <= 100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.revenue_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  subscription_payment_id UUID REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  amount_delta NUMERIC(12,2) NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.library_payout_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'approved', 'rejected', 'paid')),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.communication_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'in_app', 'whatsapp', 'telegram')),
  subject TEXT,
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.platform_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.communication_templates(id) ON DELETE SET NULL,
  audience TEXT NOT NULL DEFAULT 'all_libraries',
  channel TEXT NOT NULL CHECK (channel IN ('email', 'in_app', 'whatsapp', 'telegram')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sent', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.platform_job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.platform_metric_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key TEXT NOT NULL,
  metric_window TEXT NOT NULL CHECK (metric_window IN ('live', 'hourly', 'daily', 'weekly', 'monthly')),
  metric_value NUMERIC(14,4) NOT NULL,
  metric_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_type TEXT NOT NULL DEFAULT 'subscription' CHECK (invoice_type IN ('subscription', 'refund', 'manual_adjustment')),
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'paid', 'refunded', 'void')),
  currency TEXT NOT NULL DEFAULT 'INR',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  period_start DATE,
  period_end DATE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pdf_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.billing_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  subscription_payment_id UUID REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.platform_invoices(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.super_admin_impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trusted_session_id UUID NOT NULL REFERENCES public.auth_trusted_devices(id) ON DELETE CASCADE,
  super_admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_library_id UUID REFERENCES public.libraries(id) ON DELETE SET NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_event_logs
  ADD COLUMN IF NOT EXISTS classification TEXT,
  ADD COLUMN IF NOT EXISTS metric_key TEXT,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'INFO'
    CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  ADD COLUMN IF NOT EXISTS group_key TEXT,
  ADD COLUMN IF NOT EXISTS fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1);

CREATE INDEX IF NOT EXISTS feature_flags_key_idx
  ON public.feature_flags (key);

CREATE INDEX IF NOT EXISTS platform_account_controls_status_idx
  ON public.platform_account_controls (status, until_at);

CREATE INDEX IF NOT EXISTS library_control_overrides_status_idx
  ON public.library_control_overrides (status, until_at);

CREATE INDEX IF NOT EXISTS super_admin_audit_logs_actor_created_idx
  ON public.super_admin_audit_logs (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_audit_logs_action_created_idx
  ON public.super_admin_audit_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_activity_logs_library_created_idx
  ON public.platform_activity_logs (library_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_activity_logs_user_created_idx
  ON public.platform_activity_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS revenue_adjustments_library_created_idx
  ON public.revenue_adjustments (library_id, created_at DESC);

CREATE INDEX IF NOT EXISTS library_payout_queue_status_requested_idx
  ON public.library_payout_queue (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS communication_templates_channel_active_idx
  ON public.communication_templates (channel, is_active);

CREATE INDEX IF NOT EXISTS platform_broadcasts_status_created_idx
  ON public.platform_broadcasts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_job_queue_status_scheduled_idx
  ON public.platform_job_queue (status, scheduled_for ASC);

CREATE INDEX IF NOT EXISTS platform_metric_snapshots_metric_window_idx
  ON public.platform_metric_snapshots (metric_key, metric_window, captured_at DESC);

CREATE INDEX IF NOT EXISTS platform_invoices_library_issued_idx
  ON public.platform_invoices (library_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS billing_refunds_library_created_idx
  ON public.billing_refunds (library_id, created_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_impersonation_sessions_started_idx
  ON public.super_admin_impersonation_sessions (super_admin_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_impersonation_sessions_trusted_session_idx
  ON public.super_admin_impersonation_sessions (trusted_session_id, started_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_impersonation_sessions_target_active_idx
  ON public.super_admin_impersonation_sessions (target_user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS app_event_logs_severity_created_at_idx
  ON public.app_event_logs (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS app_event_logs_group_key_created_at_idx
  ON public.app_event_logs (group_key, created_at DESC);

CREATE INDEX IF NOT EXISTS app_event_logs_metric_key_created_at_idx
  ON public.app_event_logs (metric_key, created_at DESC);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_account_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_control_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_commission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_payout_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_metric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_impersonation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage feature flags" ON public.feature_flags;
CREATE POLICY "Super admins manage feature flags"
  ON public.feature_flags
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Service role manages feature flags" ON public.feature_flags;
CREATE POLICY "Service role manages feature flags"
  ON public.feature_flags
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can view own account controls" ON public.platform_account_controls;
CREATE POLICY "Users can view own account controls"
  ON public.platform_account_controls
  FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage account controls" ON public.platform_account_controls;
CREATE POLICY "Super admins manage account controls"
  ON public.platform_account_controls
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage library controls" ON public.library_control_overrides;
CREATE POLICY "Super admins manage library controls"
  ON public.library_control_overrides
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins view audit logs" ON public.super_admin_audit_logs;
CREATE POLICY "Super admins view audit logs"
  ON public.super_admin_audit_logs
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Service role manages audit logs" ON public.super_admin_audit_logs;
CREATE POLICY "Service role manages audit logs"
  ON public.super_admin_audit_logs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Super admins manage platform activity logs" ON public.platform_activity_logs;
CREATE POLICY "Super admins manage platform activity logs"
  ON public.platform_activity_logs
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage library commission overrides" ON public.library_commission_overrides;
CREATE POLICY "Super admins manage library commission overrides"
  ON public.library_commission_overrides
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage revenue adjustments" ON public.revenue_adjustments;
CREATE POLICY "Super admins manage revenue adjustments"
  ON public.revenue_adjustments
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage library payout queue" ON public.library_payout_queue;
CREATE POLICY "Super admins manage library payout queue"
  ON public.library_payout_queue
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage communication templates" ON public.communication_templates;
CREATE POLICY "Super admins manage communication templates"
  ON public.communication_templates
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage platform broadcasts" ON public.platform_broadcasts;
CREATE POLICY "Super admins manage platform broadcasts"
  ON public.platform_broadcasts
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage platform job queue" ON public.platform_job_queue;
CREATE POLICY "Super admins manage platform job queue"
  ON public.platform_job_queue
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins view metric snapshots" ON public.platform_metric_snapshots;
CREATE POLICY "Super admins view metric snapshots"
  ON public.platform_metric_snapshots
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Service role manages metric snapshots" ON public.platform_metric_snapshots;
CREATE POLICY "Service role manages metric snapshots"
  ON public.platform_metric_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Super admins manage platform invoices" ON public.platform_invoices;
CREATE POLICY "Super admins manage platform invoices"
  ON public.platform_invoices
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage billing refunds" ON public.billing_refunds;
CREATE POLICY "Super admins manage billing refunds"
  ON public.billing_refunds
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Super admins manage impersonation sessions" ON public.super_admin_impersonation_sessions;
CREATE POLICY "Super admins manage impersonation sessions"
  ON public.super_admin_impersonation_sessions
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

REVOKE ALL ON public.feature_flags FROM anon, authenticated;
REVOKE ALL ON public.platform_account_controls FROM anon;
REVOKE ALL ON public.library_control_overrides FROM anon, authenticated;
REVOKE ALL ON public.super_admin_audit_logs FROM anon, authenticated;
REVOKE ALL ON public.platform_activity_logs FROM anon, authenticated;
REVOKE ALL ON public.library_commission_overrides FROM anon, authenticated;
REVOKE ALL ON public.revenue_adjustments FROM anon, authenticated;
REVOKE ALL ON public.library_payout_queue FROM anon, authenticated;
REVOKE ALL ON public.communication_templates FROM anon, authenticated;
REVOKE ALL ON public.platform_broadcasts FROM anon, authenticated;
REVOKE ALL ON public.platform_job_queue FROM anon, authenticated;
REVOKE ALL ON public.platform_metric_snapshots FROM anon, authenticated;
REVOKE ALL ON public.platform_invoices FROM anon, authenticated;
REVOKE ALL ON public.billing_refunds FROM anon, authenticated;
REVOKE ALL ON public.super_admin_impersonation_sessions FROM anon, authenticated;

GRANT SELECT ON public.platform_account_controls TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_flags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_account_controls TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_control_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_admin_audit_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_activity_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_commission_overrides TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_adjustments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_payout_queue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_broadcasts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_job_queue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_metric_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_invoices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_refunds TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_admin_impersonation_sessions TO service_role;

DROP TRIGGER IF EXISTS feature_flags_updated_at ON public.feature_flags;
CREATE TRIGGER feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS platform_account_controls_updated_at ON public.platform_account_controls;
CREATE TRIGGER platform_account_controls_updated_at
  BEFORE UPDATE ON public.platform_account_controls
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS library_control_overrides_updated_at ON public.library_control_overrides;
CREATE TRIGGER library_control_overrides_updated_at
  BEFORE UPDATE ON public.library_control_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS library_commission_overrides_updated_at ON public.library_commission_overrides;
CREATE TRIGGER library_commission_overrides_updated_at
  BEFORE UPDATE ON public.library_commission_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS communication_templates_updated_at ON public.communication_templates;
CREATE TRIGGER communication_templates_updated_at
  BEFORE UPDATE ON public.communication_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS platform_broadcasts_updated_at ON public.platform_broadcasts;
CREATE TRIGGER platform_broadcasts_updated_at
  BEFORE UPDATE ON public.platform_broadcasts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS platform_job_queue_updated_at ON public.platform_job_queue;
CREATE TRIGGER platform_job_queue_updated_at
  BEFORE UPDATE ON public.platform_job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.platform_settings (key, value)
VALUES
  ('default_commission_percent', '12.5'::jsonb),
  ('qr_scan_feature_default', 'true'::jsonb),
  ('payments_feature_default', 'true'::jsonb),
  ('notifications_feature_default', 'true'::jsonb),
  ('super_admin_ip_whitelist_enabled', 'false'::jsonb),
  ('super_admin_ip_whitelist', '[]'::jsonb),
  ('inactive_library_days', '14'::jsonb),
  ('automation_subscription_renewal_enabled', 'true'::jsonb),
  ('automation_payment_reminder_enabled', 'true'::jsonb),
  ('automation_inactive_library_alert_enabled', 'true'::jsonb),
  ('gst_rate_percent', '18'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.feature_flags (key, name, description, is_enabled, rollout_percentage, config)
VALUES
  ('qr_scan', 'QR Scan', 'Controls QR attendance and scan workflows across the platform.', true, 100, '{}'::jsonb),
  ('payments', 'Payments', 'Controls payment collection, renewals, invoices, and refunds.', true, 100, '{}'::jsonb),
  ('notifications', 'Notifications', 'Controls in-app, email, and future WhatsApp notifications.', true, 100, '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.communication_templates (key, name, channel, subject, body, variables)
VALUES
  (
    'payment_reminder_email',
    'Payment Reminder Email',
    'email',
    'Payment reminder for {{libraryName}}',
    'Hi {{ownerName}}, your payment for {{libraryName}} is due on {{dueDate}}. Please renew to avoid service interruption.',
    '["libraryName","ownerName","dueDate"]'::jsonb
  ),
  (
    'inactive_library_alert',
    'Inactive Library Alert',
    'in_app',
    NULL,
    '{{libraryName}} has been inactive for {{inactiveDays}} days. Please review library health and reach out.',
    '["libraryName","inactiveDays"]'::jsonb
  ),
  (
    'broadcast_platform_notice',
    'Broadcast Platform Notice',
    'in_app',
    NULL,
    '{{message}}',
    '["message"]'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE VIEW public.super_admin_daily_metrics AS
WITH source_days AS (
  SELECT date::date AS day FROM public.attendance_logs
  UNION
  SELECT COALESCE(period_start::date, created_at::date) AS day FROM public.payments
  UNION
  SELECT COALESCE(paid_at::date, created_at::date) AS day FROM public.subscription_payments
  UNION
  SELECT created_at::date AS day FROM public.libraries
),
days AS (
  SELECT generate_series(
    COALESCE((SELECT MIN(day) FROM source_days), CURRENT_DATE - 30),
    CURRENT_DATE,
    interval '1 day'
  )::date AS day
),
attendance_daily AS (
  SELECT
    date::date AS day,
    COUNT(DISTINCT library_id) AS active_libraries,
    COUNT(DISTINCT student_id) AS active_students
  FROM public.attendance_logs
  GROUP BY 1
),
payment_daily AS (
  SELECT
    COALESCE(period_start::date, created_at::date) AS day,
    SUM(amount) AS payment_revenue
  FROM public.payments
  WHERE lower(COALESCE(status, '')) IN ('approved', 'captured', 'completed', 'paid')
  GROUP BY 1
),
subscription_payment_daily AS (
  SELECT
    COALESCE(paid_at::date, created_at::date) AS day,
    SUM(amount) AS subscription_revenue
  FROM public.subscription_payments
  WHERE lower(COALESCE(status, '')) IN ('approved', 'captured', 'completed', 'paid', 'success')
  GROUP BY 1
),
adjustment_daily AS (
  SELECT
    created_at::date AS day,
    SUM(amount_delta) AS adjustment_revenue
  FROM public.revenue_adjustments
  GROUP BY 1
),
libraries_daily AS (
  SELECT
    created_at::date AS day,
    COUNT(*) AS new_libraries
  FROM public.libraries
  GROUP BY 1
)
SELECT
  d.day,
  COALESCE(a.active_libraries, 0) AS active_libraries,
  COALESCE(a.active_students, 0) AS active_students,
  COALESCE(p.payment_revenue, 0)::NUMERIC(12,2) AS payment_revenue,
  COALESCE(sp.subscription_revenue, 0)::NUMERIC(12,2) AS subscription_revenue,
  COALESCE(ad.adjustment_revenue, 0)::NUMERIC(12,2) AS adjustment_revenue,
  (
    COALESCE(p.payment_revenue, 0)
    + COALESCE(sp.subscription_revenue, 0)
    + COALESCE(ad.adjustment_revenue, 0)
  )::NUMERIC(12,2) AS total_revenue,
  COALESCE(l.new_libraries, 0) AS new_libraries
FROM days d
LEFT JOIN attendance_daily a ON a.day = d.day
LEFT JOIN payment_daily p ON p.day = d.day
LEFT JOIN subscription_payment_daily sp ON sp.day = d.day
LEFT JOIN adjustment_daily ad ON ad.day = d.day
LEFT JOIN libraries_daily l ON l.day = d.day
ORDER BY d.day DESC;

CREATE OR REPLACE VIEW public.super_admin_revenue_by_city AS
WITH payment_events AS (
  SELECT library_id, amount::NUMERIC(12,2) AS amount
  FROM public.payments
  WHERE lower(COALESCE(status, '')) IN ('approved', 'captured', 'completed', 'paid')
  UNION ALL
  SELECT library_id, amount::NUMERIC(12,2) AS amount
  FROM public.subscription_payments
  WHERE lower(COALESCE(status, '')) IN ('approved', 'captured', 'completed', 'paid', 'success')
  UNION ALL
  SELECT library_id, amount_delta::NUMERIC(12,2) AS amount
  FROM public.revenue_adjustments
)
SELECT
  COALESCE(NULLIF(trim(l.state), ''), 'Unknown') AS state,
  COALESCE(NULLIF(trim(l.city), ''), 'Unknown') AS city,
  COUNT(DISTINCT l.id) AS libraries,
  COUNT(pe.amount) AS transaction_count,
  COALESCE(SUM(pe.amount), 0)::NUMERIC(12,2) AS total_revenue
FROM public.libraries l
LEFT JOIN payment_events pe
  ON pe.library_id = l.id
GROUP BY 1, 2
ORDER BY total_revenue DESC, state, city;

CREATE OR REPLACE VIEW public.super_admin_event_groups AS
WITH grouped AS (
  SELECT
    COALESCE(NULLIF(group_key, ''), NULLIF(fingerprint, ''), NULLIF(metric_key, ''), event_type) AS incident_key,
    MAX(event_type) AS event_type,
    CASE
      WHEN MAX(CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'ERROR' THEN 3 WHEN 'WARNING' THEN 2 ELSE 1 END) = 4 THEN 'CRITICAL'
      WHEN MAX(CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'ERROR' THEN 3 WHEN 'WARNING' THEN 2 ELSE 1 END) = 3 THEN 'ERROR'
      WHEN MAX(CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'ERROR' THEN 3 WHEN 'WARNING' THEN 2 ELSE 1 END) = 2 THEN 'WARNING'
      ELSE 'INFO'
    END AS severity,
    COUNT(*) FILTER (WHERE resolved_at IS NULL) AS unresolved_count,
    SUM(occurrence_count) AS total_occurrences,
    MIN(occurred_at) AS first_seen_at,
    MAX(occurred_at) AS last_seen_at,
    MAX(message) AS latest_message
  FROM public.app_event_logs
  GROUP BY 1
)
SELECT *
FROM grouped
ORDER BY
  CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'ERROR' THEN 3 WHEN 'WARNING' THEN 2 ELSE 1 END DESC,
  unresolved_count DESC,
  last_seen_at DESC;

GRANT SELECT ON public.super_admin_daily_metrics TO authenticated;
GRANT SELECT ON public.super_admin_revenue_by_city TO authenticated;
GRANT SELECT ON public.super_admin_event_groups TO authenticated;
GRANT SELECT ON public.super_admin_daily_metrics TO service_role;
GRANT SELECT ON public.super_admin_revenue_by_city TO service_role;
GRANT SELECT ON public.super_admin_event_groups TO service_role;

NOTIFY pgrst, 'reload schema';
