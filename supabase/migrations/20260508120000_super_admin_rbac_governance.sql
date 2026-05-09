CREATE TABLE IF NOT EXISTS public.super_admin_role_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  role TEXT NOT NULL CHECK (
    role IN (
      'super_admin',
      'platform_admin',
      'billing_ops',
      'incident_ops',
      'support_ops',
      'read_only_ops',
      'emergency_ops',
      'emergency_admin'
    )
  ),
  grant_mode TEXT NOT NULL DEFAULT 'direct' CHECK (
    grant_mode IN ('direct', 'temporary', 'elevated', 'emergency_override', 'legacy_migrated')
  ),
  scope_type TEXT NOT NULL DEFAULT 'global' CHECK (
    scope_type IN ('global', 'platform', 'library', 'user', 'billing', 'incident', 'job', 'queue', 'feature_flag', 'approval_request')
  ),
  scope_id TEXT,
  scope_label TEXT,
  reason TEXT,
  restrictions JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT super_admin_role_grants_principal_required CHECK (
    user_id IS NOT NULL OR NULLIF(BTRIM(COALESCE(email, '')), '') IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.super_admin_action_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id TEXT NOT NULL,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT,
  fingerprint TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.super_admin_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled')
  ),
  requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_email TEXT,
  fingerprint TEXT NOT NULL,
  token_hash TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT,
  target_display TEXT,
  reason TEXT,
  preview JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_approvals INTEGER NOT NULL DEFAULT 1 CHECK (required_approvals >= 1 AND required_approvals <= 3),
  optional_second_approver BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  escalation_after TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  last_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.super_admin_approval_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.super_admin_approval_requests(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'commented')),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS super_admin_role_grants_user_idx
  ON public.super_admin_role_grants (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_role_grants_email_idx
  ON public.super_admin_role_grants (LOWER(email), created_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_role_grants_role_scope_idx
  ON public.super_admin_role_grants (role, scope_type, scope_id, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS super_admin_role_grants_active_unique_idx
  ON public.super_admin_role_grants (
    COALESCE(user_id::TEXT, LOWER(email), ''),
    role,
    scope_type,
    COALESCE(scope_id, ''),
    grant_mode
  )
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS super_admin_action_tokens_actor_expiry_idx
  ON public.super_admin_action_tokens (actor_user_id, action_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_approval_requests_status_expiry_idx
  ON public.super_admin_approval_requests (status, expires_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_approval_requests_requester_idx
  ON public.super_admin_approval_requests (requester_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_approval_requests_target_idx
  ON public.super_admin_approval_requests (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS super_admin_approval_decisions_request_idx
  ON public.super_admin_approval_decisions (request_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS super_admin_approval_decisions_unique_reviewer_idx
  ON public.super_admin_approval_decisions (request_id, actor_user_id, decision)
  WHERE actor_user_id IS NOT NULL AND decision IN ('approved', 'rejected');

ALTER TABLE public.super_admin_role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_action_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_approval_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins view role grants" ON public.super_admin_role_grants;
CREATE POLICY "Super admins view role grants"
  ON public.super_admin_role_grants
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Service role manages role grants" ON public.super_admin_role_grants;
CREATE POLICY "Service role manages role grants"
  ON public.super_admin_role_grants
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages action tokens" ON public.super_admin_action_tokens;
CREATE POLICY "Service role manages action tokens"
  ON public.super_admin_action_tokens
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Super admins view approval requests" ON public.super_admin_approval_requests;
CREATE POLICY "Super admins view approval requests"
  ON public.super_admin_approval_requests
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Service role manages approval requests" ON public.super_admin_approval_requests;
CREATE POLICY "Service role manages approval requests"
  ON public.super_admin_approval_requests
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Super admins view approval decisions" ON public.super_admin_approval_decisions;
CREATE POLICY "Super admins view approval decisions"
  ON public.super_admin_approval_decisions
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Service role manages approval decisions" ON public.super_admin_approval_decisions;
CREATE POLICY "Service role manages approval decisions"
  ON public.super_admin_approval_decisions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.super_admin_role_grants FROM anon, authenticated;
REVOKE ALL ON public.super_admin_action_tokens FROM anon, authenticated;
REVOKE ALL ON public.super_admin_approval_requests FROM anon, authenticated;
REVOKE ALL ON public.super_admin_approval_decisions FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_admin_role_grants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_admin_action_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_admin_approval_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_admin_approval_decisions TO service_role;

DO $$
BEGIN
  IF to_regclass('public.super_admin_operator_assignments') IS NOT NULL THEN
    INSERT INTO public.super_admin_role_grants (
      user_id,
      email,
      role,
      grant_mode,
      scope_type,
      reason,
      restrictions,
      metadata,
      created_at,
      updated_at
    )
    SELECT
      legacy.user_id,
      legacy.email,
      CASE
        WHEN legacy.role = 'emergency_admin' THEN 'emergency_ops'
        ELSE legacy.role
      END,
      'legacy_migrated',
      'global',
      'Backfilled from legacy super_admin_operator_assignments.',
      '{}'::jsonb,
      jsonb_build_object('backfilled_from_legacy_assignments', true),
      now(),
      now()
    FROM public.super_admin_operator_assignments AS legacy
    WHERE COALESCE(legacy.is_active, true) = true
      AND legacy.role IN (
        'super_admin',
        'platform_admin',
        'billing_ops',
        'incident_ops',
        'support_ops',
        'read_only_ops',
        'emergency_ops',
        'emergency_admin'
      )
    ON CONFLICT DO NOTHING;
  END IF;
END
$$;
