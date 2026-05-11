-- =============================================================================
-- Migration: Auth runtime integrity hardening
-- Purpose:
--   * complete the trusted-device schema contract idempotently
--   * scope trusted-device RLS explicitly to authenticated users and service_role
--   * preserve user-ownership checks without allowing direct client session minting
--   * harden auth RPC/grant verification for startup and readiness probes
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.auth_trusted_devices ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.auth_trusted_devices
  ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS device_fingerprint_hash TEXT,
  ADD COLUMN IF NOT EXISTS session_scope TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS auth_level SMALLINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS idle_timeout_seconds INTEGER;

UPDATE public.auth_trusted_devices
SET
  refresh_token_hash = COALESCE(
    NULLIF(BTRIM(refresh_token_hash), ''),
    encode(extensions.digest(COALESCE(id::TEXT, gen_random_uuid()::TEXT), 'sha256'::TEXT), 'hex')
  ),
  session_scope = COALESCE(NULLIF(BTRIM(session_scope), ''), 'general'),
  auth_level = COALESCE(auth_level, 1),
  idle_timeout_seconds = CASE
    WHEN idle_timeout_seconds IS NULL
      AND COALESCE(NULLIF(BTRIM(session_scope), ''), 'general') = 'super_admin'
      THEN 1800
    ELSE idle_timeout_seconds
  END
WHERE
  refresh_token_hash IS NULL
  OR BTRIM(refresh_token_hash) = ''
  OR session_scope IS NULL
  OR BTRIM(session_scope) = ''
  OR auth_level IS NULL
  OR (
    idle_timeout_seconds IS NULL
    AND COALESCE(NULLIF(BTRIM(session_scope), ''), 'general') = 'super_admin'
  );

ALTER TABLE public.auth_trusted_devices
  ALTER COLUMN refresh_token_hash SET NOT NULL,
  ALTER COLUMN session_scope SET DEFAULT 'general',
  ALTER COLUMN session_scope SET NOT NULL,
  ALTER COLUMN auth_level SET DEFAULT 1,
  ALTER COLUMN auth_level SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_trusted_devices_login_method_check'
  ) THEN
    ALTER TABLE public.auth_trusted_devices
      ADD CONSTRAINT auth_trusted_devices_login_method_check
      CHECK (login_method IN ('otp', 'email'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_trusted_devices_session_scope_check'
  ) THEN
    ALTER TABLE public.auth_trusted_devices
      ADD CONSTRAINT auth_trusted_devices_session_scope_check
      CHECK (session_scope IN ('general', 'super_admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_trusted_devices_auth_level_check'
  ) THEN
    ALTER TABLE public.auth_trusted_devices
      ADD CONSTRAINT auth_trusted_devices_auth_level_check
      CHECK (auth_level BETWEEN 1 AND 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_trusted_devices_idle_timeout_seconds_check'
  ) THEN
    ALTER TABLE public.auth_trusted_devices
      ADD CONSTRAINT auth_trusted_devices_idle_timeout_seconds_check
      CHECK (idle_timeout_seconds IS NULL OR idle_timeout_seconds > 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS auth_trusted_devices_user_id_idx
  ON public.auth_trusted_devices (user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS auth_trusted_devices_fingerprint_idx
  ON public.auth_trusted_devices (user_id, device_fingerprint_hash);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'auth_trusted_devices'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND indexdef ILIKE '%(refresh_token_hash)%'
  ) THEN
    CREATE UNIQUE INDEX auth_trusted_devices_refresh_token_hash_uidx
      ON public.auth_trusted_devices (refresh_token_hash);
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Users can view own trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "Users can update own trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "Users can insert own trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "Service role full access to trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "service_role insert trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "service_role select trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "service_role update trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "service_role delete trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "Service role can manage trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "Service role insert trusted devices" ON public.auth_trusted_devices;
DROP POLICY IF EXISTS "Service role can insert trusted devices" ON public.auth_trusted_devices;

CREATE POLICY "Users can view own trusted devices"
  ON public.auth_trusted_devices
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own trusted devices"
  ON public.auth_trusted_devices
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- This policy stays grant-gated: we intentionally do not grant INSERT to authenticated.
-- If a future runtime needs it, the policy already constrains inserts to non-elevated sessions.
CREATE POLICY "Users can insert own trusted devices"
  ON public.auth_trusted_devices
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(NULLIF(BTRIM(session_scope), ''), 'general') = 'general'
    AND auth_level = 1
    AND idle_timeout_seconds IS NULL
    AND revoked_at IS NULL
    AND revocation_reason IS NULL
    AND expires_at <= now() + INTERVAL '90 days'
  );

CREATE POLICY "Service role full access to trusted devices"
  ON public.auth_trusted_devices
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.auth_trusted_devices FROM anon, public;
REVOKE INSERT, DELETE ON public.auth_trusted_devices FROM authenticated;
GRANT SELECT, UPDATE ON public.auth_trusted_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auth_trusted_devices TO service_role;

REVOKE ALL ON FUNCTION public.find_super_admin_by_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_super_admin_by_email(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_auth_runtime_status()
RETURNS TABLE (
  check_name TEXT,
  ok BOOLEAN,
  detail TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH required_columns AS (
    SELECT *
    FROM (
      VALUES
        ('auth_trusted_devices', 'id', 'uuid', 'NO', '%gen_random_uuid%'),
        ('auth_trusted_devices', 'user_id', 'uuid', 'NO', NULL),
        ('auth_trusted_devices', 'refresh_token_hash', 'text', 'NO', NULL),
        ('auth_trusted_devices', 'device_fingerprint_hash', 'text', 'YES', NULL),
        ('auth_trusted_devices', 'session_scope', 'text', 'NO', '%general%'),
        ('auth_trusted_devices', 'auth_level', 'smallint', 'NO', '%1%'),
        ('auth_trusted_devices', 'idle_timeout_seconds', 'integer', 'YES', NULL),
        ('auth_trusted_devices', 'expires_at', 'timestamp with time zone', 'NO', NULL),
        ('auth_trusted_devices', 'revoked_at', 'timestamp with time zone', 'YES', NULL),
        ('auth_trusted_devices', 'revocation_reason', 'text', 'YES', NULL),
        ('auth_trusted_devices', 'login_method', 'text', 'NO', NULL),
        ('auth_trusted_devices', 'delivery_channel', 'text', 'YES', NULL),
        ('auth_trusted_devices', 'device_label', 'text', 'YES', NULL),
        ('auth_trusted_devices', 'last_ip', 'text', 'YES', NULL),
        ('auth_trusted_devices', 'last_used_at', 'timestamp with time zone', 'NO', '%now%'),
        ('auth_trusted_devices', 'phone_number', 'text', 'YES', NULL),
        ('auth_trusted_devices', 'user_agent', 'text', 'YES', NULL),
        ('login_logs', 'id', 'uuid', 'NO', '%gen_random_uuid%'),
        ('login_logs', 'user_id', 'uuid', 'YES', NULL),
        ('login_logs', 'email', 'text', 'YES', NULL),
        ('login_logs', 'ip_address', 'text', 'YES', NULL),
        ('login_logs', 'device', 'text', 'YES', NULL),
        ('login_logs', 'login_time', 'timestamp with time zone', 'NO', '%now%'),
        ('login_logs', 'status', 'text', 'NO', NULL),
        ('login_logs', 'login_step', 'text', 'NO', NULL),
        ('login_logs', 'reason', 'text', 'YES', NULL),
        ('login_logs', 'channel', 'text', 'YES', NULL)
    ) AS required(table_name, column_name, data_type, is_nullable, default_pattern)
  ),
  table_checks AS (
    SELECT
      'table:auth_trusted_devices'::TEXT AS check_name,
      pg_catalog.to_regclass('public.auth_trusted_devices') IS NOT NULL AS ok,
      CASE
        WHEN pg_catalog.to_regclass('public.auth_trusted_devices') IS NOT NULL
          THEN 'public.auth_trusted_devices is present.'
        ELSE 'public.auth_trusted_devices is missing.'
      END AS detail

    UNION ALL

    SELECT
      'table:login_logs'::TEXT AS check_name,
      pg_catalog.to_regclass('public.login_logs') IS NOT NULL AS ok,
      CASE
        WHEN pg_catalog.to_regclass('public.login_logs') IS NOT NULL
          THEN 'public.login_logs is present.'
        ELSE 'public.login_logs is missing.'
      END AS detail
  ),
  column_presence_checks AS (
    SELECT
      format('column:%s.%s', required.table_name, required.column_name) AS check_name,
      EXISTS (
        SELECT 1
        FROM information_schema.columns AS columns
        WHERE columns.table_schema = 'public'
          AND columns.table_name = required.table_name
          AND columns.column_name = required.column_name
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM information_schema.columns AS columns
          WHERE columns.table_schema = 'public'
            AND columns.table_name = required.table_name
            AND columns.column_name = required.column_name
        )
          THEN format('public.%s.%s is present.', required.table_name, required.column_name)
        ELSE format('public.%s.%s is missing.', required.table_name, required.column_name)
      END AS detail
    FROM required_columns AS required
  ),
  column_definition_checks AS (
    SELECT
      format('column_definition:%s.%s', required.table_name, required.column_name) AS check_name,
      EXISTS (
        SELECT 1
        FROM information_schema.columns AS columns
        WHERE columns.table_schema = 'public'
          AND columns.table_name = required.table_name
          AND columns.column_name = required.column_name
          AND columns.data_type = required.data_type
          AND columns.is_nullable = required.is_nullable
          AND (
            required.default_pattern IS NULL OR
            COALESCE(columns.column_default, '') ILIKE required.default_pattern
          )
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM information_schema.columns AS columns
          WHERE columns.table_schema = 'public'
            AND columns.table_name = required.table_name
            AND columns.column_name = required.column_name
            AND columns.data_type = required.data_type
            AND columns.is_nullable = required.is_nullable
            AND (
              required.default_pattern IS NULL OR
              COALESCE(columns.column_default, '') ILIKE required.default_pattern
            )
        )
          THEN format(
            'public.%s.%s matches the expected type/nullability/default contract.',
            required.table_name,
            required.column_name
          )
        ELSE format(
          'public.%s.%s does not match the expected type/nullability/default contract.',
          required.table_name,
          required.column_name
        )
      END AS detail
    FROM required_columns AS required
    WHERE required.table_name = 'auth_trusted_devices'
      AND required.column_name IN (
        'refresh_token_hash',
        'device_fingerprint_hash',
        'session_scope',
        'auth_level',
        'idle_timeout_seconds'
      )
  ),
  index_checks AS (
    SELECT
      'index:auth_trusted_devices_user_id_idx'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'auth_trusted_devices'
          AND indexname = 'auth_trusted_devices_user_id_idx'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'auth_trusted_devices'
            AND indexname = 'auth_trusted_devices_user_id_idx'
        )
          THEN 'auth_trusted_devices_user_id_idx is present.'
        ELSE 'auth_trusted_devices_user_id_idx is missing.'
      END AS detail

    UNION ALL

    SELECT
      'index:auth_trusted_devices_fingerprint_idx'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'auth_trusted_devices'
          AND indexname = 'auth_trusted_devices_fingerprint_idx'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'auth_trusted_devices'
            AND indexname = 'auth_trusted_devices_fingerprint_idx'
        )
          THEN 'auth_trusted_devices_fingerprint_idx is present.'
        ELSE 'auth_trusted_devices_fingerprint_idx is missing.'
      END AS detail

    UNION ALL

    SELECT
      'index:auth_trusted_devices_refresh_token_hash_unique'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'auth_trusted_devices'
          AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
          AND indexdef ILIKE '%(refresh_token_hash)%'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'auth_trusted_devices'
            AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
            AND indexdef ILIKE '%(refresh_token_hash)%'
        )
          THEN 'A unique refresh_token_hash index is present on public.auth_trusted_devices.'
        ELSE 'A unique refresh_token_hash index is missing on public.auth_trusted_devices.'
      END AS detail
  ),
  rls_checks AS (
    SELECT
      'rls:auth_trusted_devices'::TEXT AS check_name,
      COALESCE((
        SELECT class.relrowsecurity
        FROM pg_class AS class
        JOIN pg_namespace AS namespace
          ON namespace.oid = class.relnamespace
        WHERE namespace.nspname = 'public'
          AND class.relname = 'auth_trusted_devices'
      ), FALSE) AS ok,
      CASE
        WHEN COALESCE((
          SELECT class.relrowsecurity
          FROM pg_class AS class
          JOIN pg_namespace AS namespace
            ON namespace.oid = class.relnamespace
          WHERE namespace.nspname = 'public'
            AND class.relname = 'auth_trusted_devices'
        ), FALSE)
          THEN 'RLS is enabled on public.auth_trusted_devices.'
        ELSE 'RLS is disabled on public.auth_trusted_devices.'
      END AS detail
  ),
  policy_checks AS (
    SELECT
      'policy:auth_trusted_devices.authenticated_select_own'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'auth_trusted_devices'
          AND policyname = 'Users can view own trusted devices'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'auth_trusted_devices'
            AND policyname = 'Users can view own trusted devices'
        )
          THEN 'Policy "Users can view own trusted devices" is present.'
        ELSE 'Policy "Users can view own trusted devices" is missing.'
      END AS detail

    UNION ALL

    SELECT
      'policy:auth_trusted_devices.authenticated_update_own'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'auth_trusted_devices'
          AND policyname = 'Users can update own trusted devices'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'auth_trusted_devices'
            AND policyname = 'Users can update own trusted devices'
        )
          THEN 'Policy "Users can update own trusted devices" is present.'
        ELSE 'Policy "Users can update own trusted devices" is missing.'
      END AS detail

    UNION ALL

    SELECT
      'policy:auth_trusted_devices.authenticated_insert_own'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'auth_trusted_devices'
          AND policyname = 'Users can insert own trusted devices'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'auth_trusted_devices'
            AND policyname = 'Users can insert own trusted devices'
        )
          THEN 'Policy "Users can insert own trusted devices" is present.'
        ELSE 'Policy "Users can insert own trusted devices" is missing.'
      END AS detail

    UNION ALL

    SELECT
      'policy:auth_trusted_devices.service_role_all'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'auth_trusted_devices'
          AND policyname = 'Service role full access to trusted devices'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'auth_trusted_devices'
            AND policyname = 'Service role full access to trusted devices'
        )
          THEN 'Policy "Service role full access to trusted devices" is present.'
        ELSE 'Policy "Service role full access to trusted devices" is missing.'
      END AS detail

    UNION ALL

    SELECT
      'policy:login_logs.super_admin_select'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'login_logs'
          AND policyname = 'Super admins can view login logs'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'login_logs'
            AND policyname = 'Super admins can view login logs'
        )
          THEN 'Policy "Super admins can view login logs" is present.'
        ELSE 'Policy "Super admins can view login logs" is missing.'
      END AS detail
  ),
  function_checks AS (
    SELECT
      'function:find_super_admin_by_email(text)'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_proc AS proc
        JOIN pg_namespace AS namespace
          ON namespace.oid = proc.pronamespace
        WHERE namespace.nspname = 'public'
          AND proc.proname = 'find_super_admin_by_email'
          AND oidvectortypes(proc.proargtypes) = 'text'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_proc AS proc
          JOIN pg_namespace AS namespace
            ON namespace.oid = proc.pronamespace
          WHERE namespace.nspname = 'public'
            AND proc.proname = 'find_super_admin_by_email'
            AND oidvectortypes(proc.proargtypes) = 'text'
        )
          THEN 'public.find_super_admin_by_email(text) is present.'
        ELSE 'public.find_super_admin_by_email(text) is missing.'
      END AS detail
  ),
  grant_checks AS (
    SELECT
      'grant:service_role.auth_trusted_devices_rw'::TEXT AS check_name,
      COALESCE(has_table_privilege('service_role', 'public.auth_trusted_devices', 'SELECT'), FALSE)
      AND COALESCE(has_table_privilege('service_role', 'public.auth_trusted_devices', 'INSERT'), FALSE)
      AND COALESCE(has_table_privilege('service_role', 'public.auth_trusted_devices', 'UPDATE'), FALSE)
      AND COALESCE(has_table_privilege('service_role', 'public.auth_trusted_devices', 'DELETE'), FALSE) AS ok,
      CASE
        WHEN COALESCE(has_table_privilege('service_role', 'public.auth_trusted_devices', 'SELECT'), FALSE)
          AND COALESCE(has_table_privilege('service_role', 'public.auth_trusted_devices', 'INSERT'), FALSE)
          AND COALESCE(has_table_privilege('service_role', 'public.auth_trusted_devices', 'UPDATE'), FALSE)
          AND COALESCE(has_table_privilege('service_role', 'public.auth_trusted_devices', 'DELETE'), FALSE)
          THEN 'service_role has SELECT/INSERT/UPDATE/DELETE on public.auth_trusted_devices.'
        ELSE 'service_role is missing SELECT/INSERT/UPDATE/DELETE on public.auth_trusted_devices.'
      END AS detail

    UNION ALL

    SELECT
      'grant:authenticated.auth_trusted_devices_read_update'::TEXT AS check_name,
      COALESCE(has_table_privilege('authenticated', 'public.auth_trusted_devices', 'SELECT'), FALSE)
      AND COALESCE(has_table_privilege('authenticated', 'public.auth_trusted_devices', 'UPDATE'), FALSE) AS ok,
      CASE
        WHEN COALESCE(has_table_privilege('authenticated', 'public.auth_trusted_devices', 'SELECT'), FALSE)
          AND COALESCE(has_table_privilege('authenticated', 'public.auth_trusted_devices', 'UPDATE'), FALSE)
          THEN 'authenticated has SELECT/UPDATE on public.auth_trusted_devices.'
        ELSE 'authenticated is missing SELECT/UPDATE on public.auth_trusted_devices.'
      END AS detail

    UNION ALL

    SELECT
      'grant:service_role.login_logs_select_insert'::TEXT AS check_name,
      COALESCE(has_table_privilege('service_role', 'public.login_logs', 'SELECT'), FALSE)
      AND COALESCE(has_table_privilege('service_role', 'public.login_logs', 'INSERT'), FALSE) AS ok,
      CASE
        WHEN COALESCE(has_table_privilege('service_role', 'public.login_logs', 'SELECT'), FALSE)
          AND COALESCE(has_table_privilege('service_role', 'public.login_logs', 'INSERT'), FALSE)
          THEN 'service_role has SELECT/INSERT on public.login_logs.'
        ELSE 'service_role is missing SELECT/INSERT on public.login_logs.'
      END AS detail

    UNION ALL

    SELECT
      'grant:service_role.find_super_admin_by_email_execute'::TEXT AS check_name,
      COALESCE(
        has_function_privilege('service_role', 'public.find_super_admin_by_email(text)', 'EXECUTE'),
        FALSE
      ) AS ok,
      CASE
        WHEN COALESCE(
          has_function_privilege('service_role', 'public.find_super_admin_by_email(text)', 'EXECUTE'),
          FALSE
        )
          THEN 'service_role can execute public.find_super_admin_by_email(text).'
        ELSE 'service_role cannot execute public.find_super_admin_by_email(text).'
      END AS detail

    UNION ALL

    SELECT
      'grant:service_role.get_auth_runtime_status_execute'::TEXT AS check_name,
      COALESCE(
        has_function_privilege('service_role', 'public.get_auth_runtime_status()', 'EXECUTE'),
        FALSE
      ) AS ok,
      CASE
        WHEN COALESCE(
          has_function_privilege('service_role', 'public.get_auth_runtime_status()', 'EXECUTE'),
          FALSE
        )
          THEN 'service_role can execute public.get_auth_runtime_status().'
        ELSE 'service_role cannot execute public.get_auth_runtime_status().'
      END AS detail
  )
  SELECT *
  FROM (
    SELECT * FROM table_checks
    UNION ALL
    SELECT * FROM column_presence_checks
    UNION ALL
    SELECT * FROM column_definition_checks
    UNION ALL
    SELECT * FROM index_checks
    UNION ALL
    SELECT * FROM rls_checks
    UNION ALL
    SELECT * FROM policy_checks
    UNION ALL
    SELECT * FROM function_checks
    UNION ALL
    SELECT * FROM grant_checks
  ) AS checks
  ORDER BY check_name;
$$;

REVOKE ALL ON FUNCTION public.get_auth_runtime_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_runtime_status() TO service_role;

NOTIFY pgrst, 'reload schema';
