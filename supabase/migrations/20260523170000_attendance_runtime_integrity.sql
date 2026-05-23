CREATE OR REPLACE FUNCTION public.get_attendance_runtime_diagnostics(
  p_student_id UUID DEFAULT NULL,
  p_qr_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tables JSONB;
  v_columns JSONB;
  v_rpcs JSONB;
  v_rls JSONB;
  v_policy_counts JSONB;
  v_indexes JSONB;
  v_constraints JSONB;
  v_grants JSONB;
  v_requested_student JSONB := NULL;
  v_runtime_missing TEXT[] := ARRAY[]::TEXT[];
  v_compatibility_gaps TEXT[] := ARRAY[]::TEXT[];
  v_students_exists BOOLEAN := false;
  v_migration_count INTEGER := 0;
  v_latest_migration TEXT := NULL;
  v_lookup_qr TEXT := NULLIF(trim(COALESCE(p_qr_code, '')), '');
  v_suspected_issue TEXT := NULL;
BEGIN
  v_tables := jsonb_build_object(
    'attendance', to_regclass('public.attendance') IS NOT NULL,
    'attendance_logs', to_regclass('public.attendance_logs') IS NOT NULL,
    'entry_devices', to_regclass('public.entry_devices') IS NOT NULL,
    'libraries', to_regclass('public.libraries') IS NOT NULL,
    'payments', to_regclass('public.payments') IS NOT NULL,
    'profiles', to_regclass('public.profiles') IS NOT NULL,
    'renewals', to_regclass('public.renewals') IS NOT NULL,
    'students', to_regclass('public.students') IS NOT NULL
  );

  v_students_exists := COALESCE((v_tables->>'students')::BOOLEAN, false);

  v_columns := jsonb_build_object(
    'students', jsonb_build_object(
      'archived_at', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'students'
          AND column_name = 'archived_at'
      ),
      'full_name', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'students'
          AND column_name = 'full_name'
      ),
      'id', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'students'
          AND column_name = 'id'
      ),
      'library_id', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'students'
          AND column_name = 'library_id'
      ),
      'qr_code', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'students'
          AND column_name = 'qr_code'
      ),
      'status', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'students'
          AND column_name = 'status'
      )
    ),
    'attendance', jsonb_build_object(
      'library_id', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance'
          AND column_name = 'library_id'
      ),
      'scanned_at', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance'
          AND column_name = 'scanned_at'
      ),
      'student_id', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance'
          AND column_name = 'student_id'
      )
    ),
    'attendance_logs', jsonb_build_object(
      'check_in', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance_logs'
          AND column_name = 'check_in'
      ),
      'date', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance_logs'
          AND column_name = 'date'
      ),
      'device_id', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance_logs'
          AND column_name = 'device_id'
      ),
      'entry_id', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance_logs'
          AND column_name = 'entry_id'
      ),
      'library_id', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance_logs'
          AND column_name = 'library_id'
      ),
      'student_id', EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance_logs'
          AND column_name = 'student_id'
      )
    )
  );

  v_rpcs := jsonb_build_object(
    'mark_attendance', EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'mark_attendance'
    ),
    'qr_check_in', EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'qr_check_in'
    ),
    'scan_attendance', EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'scan_attendance'
    ),
    'scan_attendance_entry', EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'scan_attendance_entry'
    ),
    'verify_student', EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'verify_student'
    )
  );

  v_rls := jsonb_build_object(
    'attendance', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.attendance')), false),
    'attendance_logs', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.attendance_logs')), false),
    'profiles', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.profiles')), false),
    'students', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.students')), false)
  );

  v_policy_counts := jsonb_build_object(
    'attendance', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attendance'),
    'attendance_logs', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attendance_logs'),
    'profiles', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'),
    'students', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'students')
  );

  v_indexes := jsonb_build_object(
    'attendance_logs_library_date', EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'attendance_logs'
        AND indexdef ILIKE '%(library_id, date%'
    ),
    'attendance_logs_student_date', EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'attendance_logs'
        AND indexdef ILIKE '%(student_id, date%'
    ),
    'students_library_qr_code', EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'students'
        AND (
          indexdef ILIKE '%(library_id, qr_code%'
          OR indexdef ILIKE '%(qr_code, library_id%'
        )
    ),
    'students_qr_code', EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'students'
        AND indexdef ILIKE '%(qr_code%'
    )
  );

  v_constraints := jsonb_build_object(
    'attendance_library_fk', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass('public.attendance')
        AND c.contype = 'f'
        AND c.confrelid = to_regclass('public.libraries')
    ),
    'attendance_logs_library_fk', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass('public.attendance_logs')
        AND c.contype = 'f'
        AND c.confrelid = to_regclass('public.libraries')
    ),
    'attendance_logs_student_fk', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass('public.attendance_logs')
        AND c.contype = 'f'
        AND c.confrelid = to_regclass('public.students')
    ),
    'attendance_student_fk', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass('public.attendance')
        AND c.contype = 'f'
        AND c.confrelid = to_regclass('public.students')
    ),
    'students_library_fk', EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass('public.students')
        AND c.contype = 'f'
        AND c.confrelid = to_regclass('public.libraries')
    )
  );

  v_grants := jsonb_build_object(
    'authenticated', jsonb_build_object(
      'attendance_logs_select', CASE
        WHEN to_regclass('public.attendance_logs') IS NOT NULL THEN has_table_privilege('authenticated', 'public.attendance_logs', 'SELECT')
        ELSE false
      END,
      'students_select', CASE
        WHEN to_regclass('public.students') IS NOT NULL THEN has_table_privilege('authenticated', 'public.students', 'SELECT')
        ELSE false
      END
    ),
    'service_role', jsonb_build_object(
      'attendance_logs_insert', CASE
        WHEN to_regclass('public.attendance_logs') IS NOT NULL THEN has_table_privilege('service_role', 'public.attendance_logs', 'INSERT')
        ELSE false
      END,
      'attendance_logs_select', CASE
        WHEN to_regclass('public.attendance_logs') IS NOT NULL THEN has_table_privilege('service_role', 'public.attendance_logs', 'SELECT')
        ELSE false
      END,
      'qr_check_in_execute', COALESCE((
        SELECT bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'qr_check_in'
      ), false),
      'scan_attendance_entry_execute', COALESCE((
        SELECT bool_or(has_function_privilege('service_role', p.oid, 'EXECUTE'))
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'scan_attendance_entry'
      ), false),
      'students_select', CASE
        WHEN to_regclass('public.students') IS NOT NULL THEN has_table_privilege('service_role', 'public.students', 'SELECT')
        ELSE false
      END
    )
  );

  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*), MAX(version)::TEXT FROM supabase_migrations.schema_migrations'
    INTO v_migration_count, v_latest_migration;
  END IF;

  IF v_students_exists THEN
    IF p_student_id IS NOT NULL THEN
      SELECT jsonb_build_object(
        'exists', EXISTS (
          SELECT 1
          FROM public.students s
          WHERE s.id = p_student_id
        ),
        'lookup', 'student_id',
        'requested_value', p_student_id,
        'student', (
          SELECT jsonb_strip_nulls(jsonb_build_object(
            'full_name', s.full_name,
            'id', s.id,
            'library_id', s.library_id,
            'qr_code', s.qr_code,
            'status', s.status
          ))
          FROM public.students s
          WHERE s.id = p_student_id
          LIMIT 1
        )
      )
      INTO v_requested_student;
    ELSIF v_lookup_qr IS NOT NULL THEN
      SELECT jsonb_build_object(
        'exists', EXISTS (
          SELECT 1
          FROM public.students s
          WHERE s.qr_code = v_lookup_qr
        ),
        'lookup', 'qr_code',
        'requested_value', v_lookup_qr,
        'student', (
          SELECT jsonb_strip_nulls(jsonb_build_object(
            'full_name', s.full_name,
            'id', s.id,
            'library_id', s.library_id,
            'qr_code', s.qr_code,
            'status', s.status
          ))
          FROM public.students s
          WHERE s.qr_code = v_lookup_qr
          LIMIT 1
        )
      )
      INTO v_requested_student;
    END IF;
  ELSIF p_student_id IS NOT NULL OR v_lookup_qr IS NOT NULL THEN
    v_requested_student := jsonb_build_object(
      'exists', false,
      'lookup', CASE WHEN p_student_id IS NOT NULL THEN 'student_id' ELSE 'qr_code' END,
      'reason', 'students_table_missing',
      'requested_value', COALESCE(p_student_id::TEXT, v_lookup_qr)
    );
  END IF;

  v_runtime_missing := array_remove(ARRAY[
    CASE WHEN NOT COALESCE((v_tables->>'students')::BOOLEAN, false) THEN 'table:students' END,
    CASE WHEN NOT COALESCE((v_tables->>'attendance_logs')::BOOLEAN, false) THEN 'table:attendance_logs' END,
    CASE WHEN NOT COALESCE((v_tables->>'libraries')::BOOLEAN, false) THEN 'table:libraries' END,
    CASE WHEN NOT COALESCE((v_tables->>'entry_devices')::BOOLEAN, false) THEN 'table:entry_devices' END,
    CASE WHEN NOT COALESCE((v_columns->'students'->>'id')::BOOLEAN, false) THEN 'column:students.id' END,
    CASE WHEN NOT COALESCE((v_columns->'students'->>'library_id')::BOOLEAN, false) THEN 'column:students.library_id' END,
    CASE WHEN NOT COALESCE((v_columns->'students'->>'qr_code')::BOOLEAN, false) THEN 'column:students.qr_code' END,
    CASE WHEN NOT COALESCE((v_columns->'students'->>'full_name')::BOOLEAN, false) THEN 'column:students.full_name' END,
    CASE WHEN NOT COALESCE((v_columns->'students'->>'status')::BOOLEAN, false) THEN 'column:students.status' END,
    CASE WHEN NOT COALESCE((v_columns->'attendance_logs'->>'student_id')::BOOLEAN, false) THEN 'column:attendance_logs.student_id' END,
    CASE WHEN NOT COALESCE((v_columns->'attendance_logs'->>'library_id')::BOOLEAN, false) THEN 'column:attendance_logs.library_id' END,
    CASE WHEN NOT COALESCE((v_columns->'attendance_logs'->>'check_in')::BOOLEAN, false) THEN 'column:attendance_logs.check_in' END,
    CASE WHEN NOT COALESCE((v_columns->'attendance_logs'->>'date')::BOOLEAN, false) THEN 'column:attendance_logs.date' END,
    CASE WHEN NOT COALESCE((v_rpcs->>'scan_attendance_entry')::BOOLEAN, false)
      AND NOT COALESCE((v_rpcs->>'qr_check_in')::BOOLEAN, false)
      THEN 'rpc:scan_attendance_entry|qr_check_in' END
  ], NULL);

  v_compatibility_gaps := array_remove(ARRAY[
    CASE WHEN NOT COALESCE((v_tables->>'attendance')::BOOLEAN, false) THEN 'table:attendance' END,
    CASE WHEN NOT COALESCE((v_tables->>'profiles')::BOOLEAN, false) THEN 'table:profiles' END,
    CASE WHEN NOT COALESCE((v_tables->>'payments')::BOOLEAN, false) THEN 'table:payments' END,
    CASE WHEN NOT COALESCE((v_tables->>'renewals')::BOOLEAN, false) THEN 'table:renewals' END,
    CASE WHEN NOT COALESCE((v_columns->'students'->>'archived_at')::BOOLEAN, false) THEN 'column:students.archived_at' END,
    CASE WHEN NOT COALESCE((v_columns->'attendance'->>'student_id')::BOOLEAN, false) THEN 'column:attendance.student_id' END,
    CASE WHEN NOT COALESCE((v_columns->'attendance'->>'library_id')::BOOLEAN, false) THEN 'column:attendance.library_id' END,
    CASE WHEN NOT COALESCE((v_columns->'attendance'->>'scanned_at')::BOOLEAN, false) THEN 'column:attendance.scanned_at' END,
    CASE WHEN NOT COALESCE((v_rpcs->>'mark_attendance')::BOOLEAN, false) THEN 'rpc:mark_attendance' END,
    CASE WHEN NOT COALESCE((v_rpcs->>'verify_student')::BOOLEAN, false) THEN 'rpc:verify_student' END,
    CASE WHEN NOT COALESCE((v_rpcs->>'scan_attendance')::BOOLEAN, false) THEN 'rpc:scan_attendance' END,
    CASE WHEN NOT COALESCE((v_indexes->>'students_library_qr_code')::BOOLEAN, false) THEN 'index:students(library_id,qr_code)' END,
    CASE WHEN NOT COALESCE((v_indexes->>'attendance_logs_library_date')::BOOLEAN, false) THEN 'index:attendance_logs(library_id,date)' END,
    CASE WHEN NOT COALESCE((v_indexes->>'attendance_logs_student_date')::BOOLEAN, false) THEN 'index:attendance_logs(student_id,date)' END,
    CASE WHEN NOT COALESCE((v_constraints->>'students_library_fk')::BOOLEAN, false) THEN 'constraint:students.library_id->libraries.id' END,
    CASE WHEN NOT COALESCE((v_constraints->>'attendance_logs_library_fk')::BOOLEAN, false) THEN 'constraint:attendance_logs.library_id->libraries.id' END,
    CASE WHEN NOT COALESCE((v_constraints->>'attendance_logs_student_fk')::BOOLEAN, false) THEN 'constraint:attendance_logs.student_id->students.id' END
  ], NULL);

  v_suspected_issue := CASE
    WHEN array_length(v_runtime_missing, 1) IS NOT NULL THEN
      CASE
        WHEN EXISTS (SELECT 1 FROM unnest(v_runtime_missing) AS item WHERE item LIKE 'rpc:%') THEN 'rpc_missing'
        ELSE 'schema_missing'
      END
    WHEN v_requested_student IS NOT NULL AND NOT COALESCE((v_requested_student->>'exists')::BOOLEAN, false) THEN 'student_not_found'
    WHEN array_length(v_compatibility_gaps, 1) IS NOT NULL THEN 'legacy_compatibility_gap'
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'checked_at', now(),
    'columns', v_columns,
    'compatibility_gaps', v_compatibility_gaps,
    'constraints', v_constraints,
    'grants', v_grants,
    'indexes', v_indexes,
    'migrations', jsonb_build_object(
      'count', v_migration_count,
      'latest_version', v_latest_migration,
      'schema_migrations_present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
    ),
    'policies', v_policy_counts,
    'requested_student', v_requested_student,
    'rls', v_rls,
    'rpcs', v_rpcs,
    'runtime_missing', v_runtime_missing,
    'suspected_issue', v_suspected_issue,
    'tables', v_tables
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_attendance_runtime_diagnostics(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_attendance_runtime_diagnostics(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_runtime_diagnostics(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
