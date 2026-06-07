-- Attendance load test
-- Rollback-safe benchmark script for:
-- - public.get_monthly_attendance_analytics
-- - dashboard attendance read query
-- - public.process_attendance_scan
--
-- Test matrix:
-- - 100 students
-- - 1000 students
-- - 5000 attendance_logs
--
-- PASS targets:
-- - Monthly analytics total execution time < 300ms
-- - Attendance scan total execution time < 200ms
--
-- Notes:
-- - Run this in a privileged SQL session.
-- - The script creates temporary benchmark data inside a transaction and rolls it back at the end.
-- - Compare the "Execution Time" line in each EXPLAIN ANALYZE result.

BEGIN;

SET LOCAL statement_timeout = '0';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '0';
SET LOCAL client_min_messages = warning;
SET LOCAL search_path = public, pg_catalog;

CREATE TEMP TABLE attendance_load_test_context (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) ON COMMIT DROP;

-- Helper comment:
-- The script uses one dedicated benchmark library per scenario so the results stay isolated.

-- Scenario 1: 100 students
WITH source_library AS (
  SELECT id, owner_id
  FROM public.libraries
  ORDER BY created_at ASC
  LIMIT 1
),
inserted_library AS (
  INSERT INTO public.libraries (name, owner_id, enabled, total_seats, active_students, monthly_revenue)
  SELECT 'Attendance Load Test - 100 Students', owner_id, true, 0, 0, 0
  FROM source_library
  RETURNING id
),
stored_library AS (
  INSERT INTO attendance_load_test_context (key, value)
  SELECT 'library_100', id::text
  FROM inserted_library
  RETURNING 1
),
seed_students AS (
  INSERT INTO public.students (
    library_id,
    full_name,
    phone,
    email,
    plan,
    seat_number,
    slot,
    status,
    qr_code,
    start_date,
    expiry_date,
    no_show_days,
    last_check_in
  )
  SELECT
    (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_100'),
    format('Load Test 100 Student %s', gs),
    NULL,
    NULL,
    'benchmark',
    format('S-%s', gs),
    NULL,
    'active',
    gen_random_uuid()::text,
    CURRENT_DATE,
    NULL,
    0,
    now() - ((gs % 7) || ' days')::interval
  FROM generate_series(1, 100) AS gs
  RETURNING id
),
stored_student AS (
  INSERT INTO attendance_load_test_context (key, value)
  SELECT 'student_100', id::text
  FROM seed_students
  ORDER BY id
  LIMIT 1
  RETURNING 1
),
seed_logs AS (
  INSERT INTO public.attendance_logs (
    student_id,
    library_id,
    check_in,
    check_out,
    date
  )
  SELECT
    s.id,
    (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_100'),
    now() - ((gs * 2) || ' hours')::interval,
    now() - (((gs * 2) - 1) || ' hours')::interval,
    CURRENT_DATE
  FROM public.students s
  CROSS JOIN generate_series(1, 10) AS gs
  WHERE s.library_id = (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_100')
  RETURNING 1
)
SELECT
  'scenario_100_students_seeded' AS benchmark_stage,
  (SELECT COUNT(*) FROM seed_students) AS students_inserted,
  (SELECT COUNT(*) FROM seed_logs) AS attendance_logs_inserted;

EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT *
FROM public.get_monthly_attendance_analytics(
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_100')
);

EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT
  al.student_id,
  s.full_name,
  al.check_in,
  al.check_out,
  al.date
FROM public.attendance_logs AS al
JOIN public.students AS s
  ON s.id = al.student_id
WHERE al.library_id = (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_100')
  AND al.date = CURRENT_DATE
ORDER BY al.check_in DESC
LIMIT 50;

-- process_attendance_scan: valid QR
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'student_100'),
  NULL,
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_100'),
  NULL,
  'attendance-load-test-100-valid',
  now()
);

-- process_attendance_scan: duplicate scan (same entry_id, same student)
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'student_100'),
  NULL,
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_100'),
  NULL,
  'attendance-load-test-100-valid',
  now()
);

-- process_attendance_scan: check-out (same student, new entry_id, open row already exists)
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'student_100'),
  NULL,
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_100'),
  NULL,
  'attendance-load-test-100-checkout',
  now() + INTERVAL '1 minute'
);

-- Scenario 2: 1000 students
WITH source_library AS (
  SELECT id, owner_id
  FROM public.libraries
  ORDER BY created_at ASC
  LIMIT 1
),
inserted_library AS (
  INSERT INTO public.libraries (name, owner_id, enabled, total_seats, active_students, monthly_revenue)
  SELECT 'Attendance Load Test - 1000 Students', owner_id, true, 0, 0, 0
  FROM source_library
  RETURNING id
),
stored_library AS (
  INSERT INTO attendance_load_test_context (key, value)
  SELECT 'library_1000', id::text
  FROM inserted_library
  RETURNING 1
),
seed_students AS (
  INSERT INTO public.students (
    library_id,
    full_name,
    phone,
    email,
    plan,
    seat_number,
    slot,
    status,
    qr_code,
    start_date,
    expiry_date,
    no_show_days,
    last_check_in
  )
  SELECT
    (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_1000'),
    format('Load Test 1000 Student %s', gs),
    NULL,
    NULL,
    'benchmark',
    format('S-%s', gs),
    NULL,
    'active',
    gen_random_uuid()::text,
    CURRENT_DATE,
    NULL,
    0,
    now() - ((gs % 14) || ' days')::interval
  FROM generate_series(1, 1000) AS gs
  RETURNING id
),
stored_student AS (
  INSERT INTO attendance_load_test_context (key, value)
  SELECT 'student_1000', id::text
  FROM seed_students
  ORDER BY id
  LIMIT 1
  RETURNING 1
),
seed_logs AS (
  INSERT INTO public.attendance_logs (
    student_id,
    library_id,
    check_in,
    check_out,
    date
  )
  SELECT
    s.id,
    (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_1000'),
    now() - ((gs * 2) || ' hours')::interval,
    now() - (((gs * 2) - 1) || ' hours')::interval,
    CURRENT_DATE
  FROM public.students s
  CROSS JOIN generate_series(1, 1) AS gs
  WHERE s.library_id = (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_1000')
  RETURNING 1
)
SELECT
  'scenario_1000_students_seeded' AS benchmark_stage,
  (SELECT COUNT(*) FROM seed_students) AS students_inserted,
  (SELECT COUNT(*) FROM seed_logs) AS attendance_logs_inserted;

EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT *
FROM public.get_monthly_attendance_analytics(
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_1000')
);

EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT
  al.student_id,
  s.full_name,
  al.check_in,
  al.check_out,
  al.date
FROM public.attendance_logs AS al
JOIN public.students AS s
  ON s.id = al.student_id
WHERE al.library_id = (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_1000')
  AND al.date = CURRENT_DATE
ORDER BY al.check_in DESC
LIMIT 50;

-- Scenario 3: 5000 attendance_logs
WITH source_library AS (
  SELECT id, owner_id
  FROM public.libraries
  ORDER BY created_at ASC
  LIMIT 1
),
inserted_library AS (
  INSERT INTO public.libraries (name, owner_id, enabled, total_seats, active_students, monthly_revenue)
  SELECT 'Attendance Load Test - 5000 Logs', owner_id, true, 0, 0, 0
  FROM source_library
  RETURNING id
),
stored_library AS (
  INSERT INTO attendance_load_test_context (key, value)
  SELECT 'library_5000', id::text
  FROM inserted_library
  RETURNING 1
),
seed_students AS (
  INSERT INTO public.students (
    library_id,
    full_name,
    phone,
    email,
    plan,
    seat_number,
    slot,
    status,
    qr_code,
    start_date,
    expiry_date,
    no_show_days,
    last_check_in
  )
  SELECT
    (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_5000'),
    format('Load Test 5000 Student %s', gs),
    NULL,
    NULL,
    'benchmark',
    format('S-%s', gs),
    NULL,
    'active',
    gen_random_uuid()::text,
    CURRENT_DATE,
    NULL,
    0,
    now() - ((gs % 30) || ' days')::interval
  FROM generate_series(1, 1000) AS gs
  RETURNING id
),
stored_student AS (
  INSERT INTO attendance_load_test_context (key, value)
  SELECT 'student_5000', id::text
  FROM seed_students
  ORDER BY id
  LIMIT 1
  RETURNING 1
),
seed_logs AS (
  INSERT INTO public.attendance_logs (
    student_id,
    library_id,
    check_in,
    check_out,
    date
  )
  SELECT
    s.id,
    (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_5000'),
    now() - ((gs * 5) || ' minutes')::interval,
    now() - (((gs * 5) - 2) || ' minutes')::interval,
    CURRENT_DATE
  FROM public.students s
  CROSS JOIN generate_series(1, 5) AS gs
  WHERE s.library_id = (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_5000')
  RETURNING 1
)
SELECT
  'scenario_5000_logs_seeded' AS benchmark_stage,
  (SELECT COUNT(*) FROM seed_students) AS students_inserted,
  (SELECT COUNT(*) FROM seed_logs) AS attendance_logs_inserted;

EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT *
FROM public.get_monthly_attendance_analytics(
  (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_5000')
);

EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT
  al.student_id,
  s.full_name,
  al.check_in,
  al.check_out,
  al.date
FROM public.attendance_logs AS al
JOIN public.students AS s
  ON s.id = al.student_id
WHERE al.library_id = (SELECT value::uuid FROM attendance_load_test_context WHERE key = 'library_5000')
  AND al.date = CURRENT_DATE
ORDER BY al.check_in DESC
LIMIT 50;

ROLLBACK;
