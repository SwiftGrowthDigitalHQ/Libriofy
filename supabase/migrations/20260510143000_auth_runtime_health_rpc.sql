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
        ('auth_trusted_devices', 'id'),
        ('auth_trusted_devices', 'user_id'),
        ('auth_trusted_devices', 'refresh_token_hash'),
        ('auth_trusted_devices', 'device_fingerprint_hash'),
        ('auth_trusted_devices', 'session_scope'),
        ('auth_trusted_devices', 'auth_level'),
        ('auth_trusted_devices', 'idle_timeout_seconds'),
        ('auth_trusted_devices', 'expires_at'),
        ('auth_trusted_devices', 'revoked_at'),
        ('auth_trusted_devices', 'revocation_reason'),
        ('auth_trusted_devices', 'login_method'),
        ('auth_trusted_devices', 'delivery_channel'),
        ('auth_trusted_devices', 'device_label'),
        ('auth_trusted_devices', 'last_ip'),
        ('auth_trusted_devices', 'last_used_at'),
        ('auth_trusted_devices', 'phone_number'),
        ('auth_trusted_devices', 'user_agent'),
        ('login_logs', 'id'),
        ('login_logs', 'user_id'),
        ('login_logs', 'email'),
        ('login_logs', 'ip_address'),
        ('login_logs', 'device'),
        ('login_logs', 'login_time'),
        ('login_logs', 'status'),
        ('login_logs', 'login_step'),
        ('login_logs', 'reason'),
        ('login_logs', 'channel')
    ) AS required(table_name, column_name)
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
  column_checks AS (
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
  function_checks AS (
    SELECT
      'function:find_super_admin_by_email(text)'::TEXT AS check_name,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc AS proc
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = proc.pronamespace
        WHERE namespace.nspname = 'public'
          AND proc.proname = 'find_super_admin_by_email'
          AND pg_catalog.oidvectortypes(proc.proargtypes) = 'text'
      ) AS ok,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS proc
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = proc.pronamespace
          WHERE namespace.nspname = 'public'
            AND proc.proname = 'find_super_admin_by_email'
            AND pg_catalog.oidvectortypes(proc.proargtypes) = 'text'
        )
          THEN 'public.find_super_admin_by_email(text) is present.'
        ELSE 'public.find_super_admin_by_email(text) is missing.'
      END AS detail
  ),
  grant_checks AS (
    SELECT
      'grant:service_role.auth_trusted_devices_rw'::TEXT AS check_name,
      COALESCE(pg_catalog.has_table_privilege('service_role', 'public.auth_trusted_devices', 'SELECT'), FALSE)
      AND COALESCE(pg_catalog.has_table_privilege('service_role', 'public.auth_trusted_devices', 'INSERT'), FALSE)
      AND COALESCE(pg_catalog.has_table_privilege('service_role', 'public.auth_trusted_devices', 'UPDATE'), FALSE)
      AND COALESCE(pg_catalog.has_table_privilege('service_role', 'public.auth_trusted_devices', 'DELETE'), FALSE) AS ok,
      CASE
        WHEN COALESCE(pg_catalog.has_table_privilege('service_role', 'public.auth_trusted_devices', 'SELECT'), FALSE)
          AND COALESCE(pg_catalog.has_table_privilege('service_role', 'public.auth_trusted_devices', 'INSERT'), FALSE)
          AND COALESCE(pg_catalog.has_table_privilege('service_role', 'public.auth_trusted_devices', 'UPDATE'), FALSE)
          AND COALESCE(pg_catalog.has_table_privilege('service_role', 'public.auth_trusted_devices', 'DELETE'), FALSE)
          THEN 'service_role has SELECT/INSERT/UPDATE/DELETE on public.auth_trusted_devices.'
        ELSE 'service_role is missing SELECT/INSERT/UPDATE/DELETE on public.auth_trusted_devices.'
      END AS detail

    UNION ALL

    SELECT
      'grant:service_role.login_logs_select_insert'::TEXT AS check_name,
      COALESCE(pg_catalog.has_table_privilege('service_role', 'public.login_logs', 'SELECT'), FALSE)
      AND COALESCE(pg_catalog.has_table_privilege('service_role', 'public.login_logs', 'INSERT'), FALSE) AS ok,
      CASE
        WHEN COALESCE(pg_catalog.has_table_privilege('service_role', 'public.login_logs', 'SELECT'), FALSE)
          AND COALESCE(pg_catalog.has_table_privilege('service_role', 'public.login_logs', 'INSERT'), FALSE)
          THEN 'service_role has SELECT/INSERT on public.login_logs.'
        ELSE 'service_role is missing SELECT/INSERT on public.login_logs.'
      END AS detail

    UNION ALL

    SELECT
      'grant:service_role.find_super_admin_by_email_execute'::TEXT AS check_name,
      COALESCE(
        pg_catalog.has_function_privilege('service_role', 'public.find_super_admin_by_email(text)', 'EXECUTE'),
        FALSE
      ) AS ok,
      CASE
        WHEN COALESCE(
          pg_catalog.has_function_privilege('service_role', 'public.find_super_admin_by_email(text)', 'EXECUTE'),
          FALSE
        )
          THEN 'service_role can execute public.find_super_admin_by_email(text).'
        ELSE 'service_role cannot execute public.find_super_admin_by_email(text).'
      END AS detail
  )
  SELECT *
  FROM (
    SELECT * FROM table_checks
    UNION ALL
    SELECT * FROM column_checks
    UNION ALL
    SELECT * FROM function_checks
    UNION ALL
    SELECT * FROM grant_checks
  ) AS checks
  ORDER BY check_name;
$$;

REVOKE ALL ON FUNCTION public.get_auth_runtime_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_auth_runtime_status() TO service_role;

NOTIFY pgrst, 'reload schema';
