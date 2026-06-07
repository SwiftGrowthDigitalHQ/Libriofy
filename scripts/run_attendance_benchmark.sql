\echo '=== Attendance Benchmark Start ==='
\echo 'This script uses a transaction and rolls back all test data at the end.'

BEGIN;

SET LOCAL statement_timeout = '0';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '0';
SET LOCAL client_min_messages = warning;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL jit = off;

CREATE TEMP TABLE attendance_benchmark_context (
  scenario TEXT PRIMARY KEY,
  library_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  sample_student_id UUID NOT NULL,
  sample_student_qr TEXT NOT NULL
) ON COMMIT DROP;

\echo '=== Scenario 1: 100 students, 5000 attendance_logs ==='
WITH source_library AS (
  SELECT id, owner_id
  FROM public.libraries
  ORDER BY created_at ASC
  LIMIT 1
),
inserted_library AS (
  INSERT INTO public.libraries (
    name,
    owner_id,
    enabled,
    total_seats,
    active_students,
    monthly_revenue
  )
  SELECT
    'Attendance Benchmark - 100 Students',
    owner_id,
    true,
    0,
    0,
    0
  FROM source_library
  RETURNING id
),
inserted_device AS (
  INSERT INTO public.entry_devices (
    device_id,
    library_id,
    device_name,
    is_active,
    metadata,
    last_seen_at
  )
  SELECT
    'attendance-benchmark-device-100',
    id,
    'Attendance Benchmark Device 100',
    true,
    '{}'::jsonb,
    now()
  FROM inserted_library
  RETURNING device_id, library_id
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
    l.id,
    format('Benchmark 100 Student %s', gs),
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
  FROM inserted_library l
  CROSS JOIN generate_series(1, 100) AS gs
  RETURNING id, qr_code, library_id
),
sample_student AS (
  SELECT id, qr_code, library_id
  FROM seed_students
  ORDER BY id
  LIMIT 1
),
stored_context AS (
  INSERT INTO attendance_benchmark_context (
    scenario,
    library_id,
    device_id,
    sample_student_id,
    sample_student_qr
  )
  SELECT
    '100_students',
    l.id,
    d.device_id,
    s.id,
    s.qr_code
  FROM inserted_library l
  CROSS JOIN inserted_device d
  CROSS JOIN sample_student s
  RETURNING 1
)
SELECT
  'seeded_100_students' AS stage,
  (SELECT COUNT(*) FROM seed_students) AS students_seeded;

WITH ctx AS (
  SELECT library_id
  FROM attendance_benchmark_context
  WHERE scenario = '100_students'
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
    c.library_id,
    now() - ((rep * 5) || ' minutes')::interval,
    now() - (((rep * 5) - 2) || ' minutes')::interval,
    CURRENT_DATE - ((rep - 1) % 10)
  FROM public.students s
  CROSS JOIN ctx c
  CROSS JOIN generate_series(1, 50) AS rep
  WHERE s.library_id = c.library_id
  RETURNING 1
)
SELECT
  'seeded_100_logs' AS stage,
  (SELECT COUNT(*) FROM seed_logs) AS attendance_logs_seeded;

\echo '--- RPC timing: get_monthly_attendance_analytics (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT *
FROM public.get_monthly_attendance_analytics(
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students')
);

\echo '--- Plan probe: monthly attendance equivalent query (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
WITH monthly_attendance AS (
  SELECT
    al.student_id,
    COUNT(DISTINCT al.date)::INTEGER AS present_days,
    MAX(al.check_in) AS last_check_in,
    MAX(al.check_out) AS last_check_out
  FROM public.attendance_logs al
  WHERE al.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students')
    AND al.date BETWEEN date_trunc('month', CURRENT_DATE)::DATE AND CURRENT_DATE
  GROUP BY al.student_id
)
SELECT
  s.id AS student_id,
  COALESCE(NULLIF(TRIM(s.full_name), ''), 'Unknown Student') AS full_name,
  COALESCE(ma.present_days, 0) AS present_days,
  GREATEST(
    (
      date_part('day', (CURRENT_DATE::timestamp - date_trunc('month', CURRENT_DATE)::timestamp))::INTEGER + 1
    ) - COALESCE(ma.present_days, 0),
    0
  ) AS absent_days,
  ROUND(
    ((
      COALESCE(ma.present_days, 0)::DOUBLE PRECISION /
      GREATEST(date_part('day', (CURRENT_DATE::timestamp - date_trunc('month', CURRENT_DATE)::timestamp))::INTEGER + 1, 1)::DOUBLE PRECISION
    ) * 100.0)::NUMERIC,
    2
  ) AS attendance_percent,
  ma.last_check_in,
  ma.last_check_out,
  COALESCE(NULLIF(TRIM(s.status), ''), 'unknown') AS membership_status
FROM public.students s
LEFT JOIN monthly_attendance ma ON ma.student_id = s.id
WHERE s.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students')
ORDER BY full_name ASC, student_id ASC;

\echo '--- Dashboard query: attendance log read path (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT
  al.student_id,
  s.full_name,
  al.check_in,
  al.check_out,
  al.date
FROM public.attendance_logs al
JOIN public.students s
  ON s.id = al.student_id
WHERE al.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students')
  AND al.date = CURRENT_DATE
ORDER BY al.check_in DESC
LIMIT 50;

\echo '--- RPC timing: process_attendance_scan valid QR (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  NULL,
  (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '100_students'),
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students'),
  (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '100_students'),
  'attendance-benchmark-100-valid',
  now()
);

\echo '--- RPC timing: process_attendance_scan duplicate scan (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  NULL,
  (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '100_students'),
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students'),
  (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '100_students'),
  'attendance-benchmark-100-valid',
  now()
);

\echo '--- RPC timing: process_attendance_scan check-out (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  NULL,
  (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '100_students'),
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students'),
  (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '100_students'),
  'attendance-benchmark-100-checkout',
  now() + INTERVAL '1 minute'
);

\echo '--- RPC timing: process_attendance_scan check-in again (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  NULL,
  (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '100_students'),
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students'),
  (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '100_students'),
  'attendance-benchmark-100-recheckin',
  now() + INTERVAL '2 minutes'
);

\echo '--- Plan probe: student QR lookup (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT s.id
FROM public.students s
WHERE s.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students')
  AND s.qr_code = (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '100_students')
LIMIT 1;

\echo '--- Plan probe: open attendance lookup (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT al.id
FROM public.attendance_logs al
WHERE al.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '100_students')
  AND al.student_id = (SELECT sample_student_id FROM attendance_benchmark_context WHERE scenario = '100_students')
  AND al.check_out IS NULL
ORDER BY al.check_in DESC
LIMIT 1;

\echo '--- Plan probe: attendance entry_id lookup (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT al.id
FROM public.attendance_logs al
WHERE al.entry_id = 'attendance-benchmark-100-valid'
LIMIT 1;

\echo '--- Plan probe: device lookup (100 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT d.id, d.library_id, d.is_active
FROM public.entry_devices d
WHERE d.device_id = (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '100_students')
LIMIT 1;

\echo '=== Scenario 2: 1000 students, 5000 attendance_logs ==='
WITH source_library AS (
  SELECT id, owner_id
  FROM public.libraries
  ORDER BY created_at ASC
  LIMIT 1
),
inserted_library AS (
  INSERT INTO public.libraries (
    name,
    owner_id,
    enabled,
    total_seats,
    active_students,
    monthly_revenue
  )
  SELECT
    'Attendance Benchmark - 1000 Students',
    owner_id,
    true,
    0,
    0,
    0
  FROM source_library
  RETURNING id
),
inserted_device AS (
  INSERT INTO public.entry_devices (
    device_id,
    library_id,
    device_name,
    is_active,
    metadata,
    last_seen_at
  )
  SELECT
    'attendance-benchmark-device-1000',
    id,
    'Attendance Benchmark Device 1000',
    true,
    '{}'::jsonb,
    now()
  FROM inserted_library
  RETURNING device_id, library_id
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
    l.id,
    format('Benchmark 1000 Student %s', gs),
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
  FROM inserted_library l
  CROSS JOIN generate_series(1, 1000) AS gs
  RETURNING id, qr_code, library_id
),
sample_student AS (
  SELECT id, qr_code, library_id
  FROM seed_students
  ORDER BY id
  LIMIT 1
),
stored_context AS (
  INSERT INTO attendance_benchmark_context (
    scenario,
    library_id,
    device_id,
    sample_student_id,
    sample_student_qr
  )
  SELECT
    '1000_students',
    l.id,
    d.device_id,
    s.id,
    s.qr_code
  FROM inserted_library l
  CROSS JOIN inserted_device d
  CROSS JOIN sample_student s
  RETURNING 1
)
SELECT
  'seeded_1000_students' AS stage,
  (SELECT COUNT(*) FROM seed_students) AS students_seeded;

WITH ctx AS (
  SELECT library_id
  FROM attendance_benchmark_context
  WHERE scenario = '1000_students'
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
    c.library_id,
    now() - ((rep * 5) || ' minutes')::interval,
    now() - (((rep * 5) - 2) || ' minutes')::interval,
    CURRENT_DATE - ((rep - 1) % 10)
  FROM public.students s
  CROSS JOIN ctx c
  CROSS JOIN generate_series(1, 5) AS rep
  WHERE s.library_id = c.library_id
  RETURNING 1
)
SELECT
  'seeded_1000_logs' AS stage,
  (SELECT COUNT(*) FROM seed_logs) AS attendance_logs_seeded;

\echo '--- RPC timing: get_monthly_attendance_analytics (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT *
FROM public.get_monthly_attendance_analytics(
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students')
);

\echo '--- Plan probe: monthly attendance equivalent query (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
WITH monthly_attendance AS (
  SELECT
    al.student_id,
    COUNT(DISTINCT al.date)::INTEGER AS present_days,
    MAX(al.check_in) AS last_check_in,
    MAX(al.check_out) AS last_check_out
  FROM public.attendance_logs al
  WHERE al.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students')
    AND al.date BETWEEN date_trunc('month', CURRENT_DATE)::DATE AND CURRENT_DATE
  GROUP BY al.student_id
)
SELECT
  s.id AS student_id,
  COALESCE(NULLIF(TRIM(s.full_name), ''), 'Unknown Student') AS full_name,
  COALESCE(ma.present_days, 0) AS present_days,
  GREATEST(
    (
      date_part('day', (CURRENT_DATE::timestamp - date_trunc('month', CURRENT_DATE)::timestamp))::INTEGER + 1
    ) - COALESCE(ma.present_days, 0),
    0
  ) AS absent_days,
  ROUND(
    ((
      COALESCE(ma.present_days, 0)::DOUBLE PRECISION /
      GREATEST(date_part('day', (CURRENT_DATE::timestamp - date_trunc('month', CURRENT_DATE)::timestamp))::INTEGER + 1, 1)::DOUBLE PRECISION
    ) * 100.0)::NUMERIC,
    2
  ) AS attendance_percent,
  ma.last_check_in,
  ma.last_check_out,
  COALESCE(NULLIF(TRIM(s.status), ''), 'unknown') AS membership_status
FROM public.students s
LEFT JOIN monthly_attendance ma ON ma.student_id = s.id
WHERE s.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students')
ORDER BY full_name ASC, student_id ASC;

\echo '--- Dashboard query: attendance log read path (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT
  al.student_id,
  s.full_name,
  al.check_in,
  al.check_out,
  al.date
FROM public.attendance_logs al
JOIN public.students s
  ON s.id = al.student_id
WHERE al.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students')
  AND al.date = CURRENT_DATE
ORDER BY al.check_in DESC
LIMIT 50;

\echo '--- RPC timing: process_attendance_scan valid QR (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  NULL,
  (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  'attendance-benchmark-1000-valid',
  now()
);

\echo '--- RPC timing: process_attendance_scan duplicate scan (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  NULL,
  (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  'attendance-benchmark-1000-valid',
  now()
);

\echo '--- RPC timing: process_attendance_scan check-out (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  NULL,
  (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  'attendance-benchmark-1000-checkout',
  now() + INTERVAL '1 minute'
);

\echo '--- RPC timing: process_attendance_scan check-in again (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT public.process_attendance_scan(
  '/bench/attendance-load-test',
  NULL,
  (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '1000_students'),
  'attendance-benchmark-1000-recheckin',
  now() + INTERVAL '2 minutes'
);

\echo '--- Plan probe: student QR lookup (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT s.id
FROM public.students s
WHERE s.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students')
  AND s.qr_code = (SELECT sample_student_qr FROM attendance_benchmark_context WHERE scenario = '1000_students')
LIMIT 1;

\echo '--- Plan probe: open attendance lookup (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT al.id
FROM public.attendance_logs al
WHERE al.library_id = (SELECT library_id FROM attendance_benchmark_context WHERE scenario = '1000_students')
  AND al.student_id = (SELECT sample_student_id FROM attendance_benchmark_context WHERE scenario = '1000_students')
  AND al.check_out IS NULL
ORDER BY al.check_in DESC
LIMIT 1;

\echo '--- Plan probe: attendance entry_id lookup (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT al.id
FROM public.attendance_logs al
WHERE al.entry_id = 'attendance-benchmark-1000-valid'
LIMIT 1;

\echo '--- Plan probe: device lookup (1000 students) ---'
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE, FORMAT TEXT)
SELECT d.id, d.library_id, d.is_active
FROM public.entry_devices d
WHERE d.device_id = (SELECT device_id FROM attendance_benchmark_context WHERE scenario = '1000_students')
LIMIT 1;

ROLLBACK;

\echo '=== Attendance Benchmark End ==='
