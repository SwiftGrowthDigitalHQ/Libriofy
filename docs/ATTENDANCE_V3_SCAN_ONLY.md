# Attendance V3: Scan-Only Architecture

Scope: design document and migration plan. No code was changed while producing this file.

This version turns Libriofy attendance into a scan-only system:

- Attendance can only be created by QR scan.
- `/dashboard/attendance` becomes read-only.
- `/scan` becomes the only attendance write surface.
- `process_attendance_scan` becomes the only canonical attendance RPC.
- Monthly attendance analytics replace the current manual "verify and log" workflow.

## 1. Old Architecture

### Current behavior in the checked-in system

The current implementation still has multiple attendance write surfaces:

- `/scan`
- `/dashboard/attendance`
- `/api/attendance/scan`
- `/api/scan-attendance`
- `qr_check_in`
- `scan_attendance_entry`

The attendance page currently allows:

- manual student ID entry
- QR parsing from the browser
- direct RPC writes through `qr_check_in`

The kiosk path currently allows:

- camera scan
- QR parsing
- device heartbeat
- offline queue sync
- attendance submission through the scan API

### Current architecture

```mermaid
flowchart TD
  A[Student QR]
  B[/scan\nScanner kiosk]
  C[/dashboard/attendance\nManual verify + log]
  D[/api/attendance/scan\n/api/scan-attendance]
  E[RPC layer\nprocess_attendance_scan\nscan_attendance_entry\nqr_check_in]
  F[(attendance_logs)]
  G[Dashboard / Analytics]

  A --> B --> D --> E --> F --> G
  A --> C --> E --> F --> G
```

### Why the old architecture is too complex

- It allows attendance writes from more than one page.
- It uses more than one attendance RPC name.
- It supports manual attendance entry, which violates the scan-only rule for v3.
- It duplicates QR parsing and student lookup logic on both the browser and server sides.
- It keeps a heavier heartbeat and fallback path than a high-volume scan system should carry.

## 2. New Architecture

### Target behavior

Only the scan kiosk may create attendance rows.

New write flow:

`Student QR` -> `Scan Device` -> `process_attendance_scan` -> `attendance_logs`

Everything else becomes read-only or compatibility-only.

### New architecture

```mermaid
flowchart TD
  A[Student QR]
  B[/scan\nOnly write surface]
  C[Scan device\ncamera + decode]
  D[process_attendance_scan\nsingle canonical RPC]
  E[(attendance_logs)]
  F[/dashboard/attendance\nRead only]
  G[Monthly Attendance Dashboard]
  H[/dashboard/analytics\nMonthly attendance analytics]

  A --> B --> C --> D --> E
  E --> F
  E --> G
  E --> H
```

### New rules

1. Student attendance can only be marked through QR scan.
2. `/dashboard/attendance` becomes read-only.
3. Manual student ID entry is removed from attendance write paths.
4. Browser pages cannot directly insert or update `attendance_logs`.
5. `process_attendance_scan` is the only canonical attendance RPC.
6. `qr_check_in` and `scan_attendance_entry` remain only as wrappers during migration, then can be retired.

## 3. Scan-Only Rules

### Pages that can create attendance

- `/scan`

### Pages that cannot create attendance

- `/dashboard/attendance`
- `/dashboard/analytics`
- any other browser route

### Forbidden browser behavior

- no `qr_check_in` direct invocation from browser pages
- no direct `attendance_logs` insert from browser pages
- no direct `attendance_logs` update from browser pages
- no manual student ID entry for attendance creation

### Required browser behavior

- browser pages may read attendance
- browser pages may show analytics
- browser pages may show student summaries
- browser pages may show attendance history

## 4. Attendance Dashboard Redesign

### Replace the current screen

The current "Today's Attendance" screen should be replaced with a monthly summary dashboard.

### New dashboard goals

Show each student:

- Student Name
- Present Days
- Absent Days
- Attendance %
- Last Check-In
- Last Check-Out
- Membership Status

### Example row

| Student | Present Days | Absent Days | Attendance % | Last Check-In | Last Check-Out | Membership Status |
|---|---:|---:|---:|---|---|---|
| Rahul Kumar | 24 | 6 | 80% | 2026-06-06 05:10 PM | 2026-06-06 08:00 PM | Active |

### Attendance page responsibilities after redesign

`/dashboard/attendance` becomes a read-only operational dashboard and should show:

- monthly attendance summaries
- attendance history
- attendance trends
- student attendance health
- membership state

It should not show:

- manual student ID input
- manual "Verify & Log" controls
- direct attendance write actions

## 5. One Attendance RPC

### Canonical RPC

Only one attendance RPC should remain as the canonical write path:

- `process_attendance_scan`

### Compatibility wrappers

During migration, the old RPCs can remain as thin wrappers only:

- `qr_check_in` -> forwards to `process_attendance_scan`
- `scan_attendance_entry` -> forwards to `process_attendance_scan`

### Long-term goal

After client migration is complete:

- keep only `process_attendance_scan` as the public attendance write contract
- freeze or remove the wrapper exposure where safe

### Why this matters

- reduces RPC count
- reduces schema-cache drift risk
- eliminates duplicate function resolution
- simplifies debugging
- removes the fallback chain from the hot path

## 6. Supabase Load Reduction

### Current load sources

1. Kiosk scan path prechecks:
   - `library_access_keys`
   - `entry_devices`
   - `library_subscriptions`
   - `students`
2. RPC internal lookups:
   - device validation
   - student lookup
   - attendance conflict detection
3. Heartbeat traffic:
   - every 30 seconds in the current implementation
4. Browser direct-RPC path:
   - attendance page writes separately from kiosk
5. Fallback RPC attempts:
   - `scan_attendance_entry` -> `qr_check_in` -> legacy fallback

### V3 load reduction strategy

1. Make `/scan` the only writer.
2. Remove browser write calls.
3. Use one RPC only.
4. Cache or session-token the device, library, and subscription state.
5. Reduce heartbeat frequency to 5 minutes or replace it with a session-token refresh architecture.
6. Stop re-reading `library_access_keys` on every scan.
7. Stop doing duplicate student lookups before the RPC.

### Estimated improvement

Compared with the current implementation, V3 should reduce:

- RPC count per scan
- DB reads per scan
- duplicate lookup overhead
- schema-cache risk
- heartbeat write pressure

## 7. Monthly Attendance Design

### Goal

Provide monthly attendance analytics without full table scans.

For each student, compute:

- Present Days
- Absent Days
- Attendance %
- Current Month
- Previous Month
- Last Attendance Date

### Recommended data shape

Use `attendance_logs` as the source of truth and derive monthly aggregates from it.

Use `students` as the dimension table for:

- student name
- membership status
- library ownership
- seat / slot metadata

### Efficient aggregation model

The monthly report should filter by:

- `library_id`
- monthly date window

and aggregate by:

- `student_id`

### Suggested SQL pattern

```sql
WITH month_bounds AS (
  SELECT
    date_trunc('month', CURRENT_DATE)::date AS month_start,
    (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date AS next_month_start
),
attendance_window AS (
  SELECT
    al.student_id,
    al.library_id,
    al.date::date AS attendance_date,
    MIN(al.check_in) AS first_check_in,
    MAX(al.check_out) AS last_check_out
  FROM public.attendance_logs al
  JOIN month_bounds mb
    ON al.date >= mb.month_start
   AND al.date < mb.next_month_start
  WHERE al.library_id = $1
  GROUP BY al.student_id, al.library_id, al.date::date
),
student_monthly AS (
  SELECT
    s.id AS student_id,
    s.full_name,
    s.status AS membership_status,
    COUNT(DISTINCT aw.attendance_date) AS present_days,
    MAX(aw.first_check_in) AS last_check_in,
    MAX(aw.last_check_out) AS last_check_out
  FROM public.students s
  LEFT JOIN attendance_window aw
    ON aw.student_id = s.id
   AND aw.library_id = s.library_id
  WHERE s.library_id = $1
  GROUP BY s.id, s.full_name, s.status
)
SELECT
  student_id,
  full_name,
  membership_status,
  present_days,
  GREATEST(
    0,
    EXTRACT(
      DAY FROM (
        date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - date_trunc('month', CURRENT_DATE)
      )
    )::int - present_days
  ) AS absent_days,
  CASE
    WHEN EXTRACT(
      DAY FROM (
        date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - date_trunc('month', CURRENT_DATE)
      )
    ) = 0 THEN 0
    ELSE ROUND(
      (present_days::numeric / EXTRACT(
        DAY FROM (
          date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - date_trunc('month', CURRENT_DATE)
        )
      )) * 100,
      2
    )
  END AS attendance_percent,
  last_check_in,
  last_check_out
FROM student_monthly
ORDER BY full_name;
```

### Monthly comparison model

To compare current month and previous month efficiently:

1. Aggregate current month from `attendance_logs`.
2. Aggregate previous month from `attendance_logs`.
3. Join both summaries by `student_id`.

This avoids scanning unrelated time ranges.

### Important note

The monthly attendance dashboard should not compute against the full attendance history every time.

Use:

- monthly window filters
- indexes on `(library_id, date)`
- optional summary materialization for large libraries

## 8. Database Optimization

### `attendance_logs`

Current useful indexes already present:

- `idx_attendance_logs_library_date`
- `idx_attendance_logs_student_date`
- `idx_attendance_logs_entry_id`
- `idx_attendance_logs_device_id`

Recommended additions:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_logs_library_student_date
  ON public.attendance_logs (library_id, student_id, date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_logs_library_month_student
  ON public.attendance_logs (library_id, date DESC, student_id)
  INCLUDE (check_in, check_out, device_id, entry_id);
```

Expected improvement:

- faster monthly aggregation
- better per-student attendance summaries
- less work for dashboard queries

### `students`

Current useful indexes already present:

- `idx_students_library_qrcode`
- `idx_students_library_id`
- `idx_students_library_status_expiry_date`
- `idx_students_qr`

Recommended additions only if query plans justify them:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_library_status_name
  ON public.students (library_id, status, full_name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_library_last_check_in
  ON public.students (library_id, last_check_in DESC);
```

Expected improvement:

- faster monthly dashboard sorting
- faster student attendance summary rendering

### `entry_devices`

Current useful indexes already present:

- `idx_entry_devices_device_id`
- `idx_entry_devices_library`
- `idx_entry_devices_library_last_seen`
- `idx_entry_devices_active`

Recommendation:

- keep them
- reduce query frequency instead of adding more indexes

### Covering strategy

The biggest gains come from:

- eliminating duplicate scans
- replacing repeated lookups with cached/session-derived state
- making monthly dashboards read pre-aggregated or tightly indexed rows

## 9. Migration Plan

### Phase 1. Freeze new manual writes

1. Remove manual student ID entry from the attendance page.
2. Remove `Verify & Log` from the attendance page UI.
3. Make `/dashboard/attendance` read-only.
4. Block any browser-side direct writes to `attendance_logs`.

### Phase 2. Canonicalize attendance writes

1. Make `/scan` the only attendance writer.
2. Route all attendance writes through `process_attendance_scan`.
3. Convert `qr_check_in` into a wrapper only.
4. Convert `scan_attendance_entry` into a wrapper only.

### Phase 3. Reduce Supabase load

1. Cache device state.
2. Cache library state.
3. Cache subscription state.
4. Reduce heartbeat frequency to 5 minutes or switch to session-token refresh.
5. Remove fallback RPC attempts from the hot path.

### Phase 4. Add monthly analytics

1. Add monthly attendance aggregation query or RPC.
2. Add the supporting attendance indexes.
3. Render the monthly attendance dashboard.
4. Expose attendance percentages and per-student trends.

### Phase 5. Retire legacy paths

1. Remove remaining browser write hooks.
2. Retire direct `qr_check_in` usage from clients.
3. Retire direct `scan_attendance_entry` usage from clients.
4. Keep compatibility wrappers only as long as needed for deployed clients.

## 10. Verification Results

### Current implementation status

Current checked-in code does **not** yet satisfy V3:

- `/dashboard/attendance` still contains manual attendance input.
- Browser pages still can call `qr_check_in`.
- Multiple attendance RPC names still exist.
- The attendance page is not read-only yet.

### V3 verification checklist

#### Valid QR

- expected: scan creates attendance
- expected path: `/scan` -> `process_attendance_scan` -> `attendance_logs`

#### Invalid QR

- expected: reject without write
- expected result: no `attendance_logs` mutation

#### Duplicate scan

- expected: duplicate or check-out handled by the canonical RPC
- expected result: idempotent behavior, no duplicate row explosion

#### Check-in

- expected: recorded only through scan

#### Check-out

- expected: recorded only through scan

#### Monthly report

- expected: returns present days, absent days, attendance %, last check-in, last check-out, membership status

#### Attendance percentage

- expected: derived from the monthly aggregation query

#### Large dataset

- expected: indexed monthly aggregation remains performant at 1,000 students and 5,000 attendance records

### Static PASS status

The planned V3 architecture passes only if:

- attendance is created only via scan
- the dashboard is read-only
- one attendance RPC remains
- Supabase load is reduced
- monthly attendance reporting works
- no manual attendance path exists

The current repository snapshot does not yet meet those conditions.

## 11. Expected Outcomes

### Before V3

- multiple write paths
- multiple RPC names
- manual attendance entry still present
- higher query count
- higher schema-cache risk

### After V3

- scan-only attendance creation
- one canonical RPC
- read-only attendance dashboard
- monthly attendance analytics
- lower Supabase read load
- lower RPC complexity
- simpler debugging

## 12. Implementation Notes

- Keep legacy wrappers only long enough to preserve compatibility.
- Prefer cache/session tokens over repeated validation queries.
- Make monthly analytics a first-class read model rather than ad hoc dashboard logic.
- Use indexes to support monthly windows and per-student summaries.
- Keep the write path narrow and the read path broad.

## 13. Reference Files

- `src/pages/ScanKioskPageV2.tsx`
- `src/pages/AttendancePage.tsx`
- `src/lib/scanAttendance.server.ts`
- `src/lib/attendanceSync.ts`
- `src/lib/deviceHeartbeat.server.ts`
- `src/lib/deviceSetup.server.ts`
- `supabase/migrations/20260404113000_phonepe_qr_attendance_toggle.sql`
- `supabase/migrations/20260514120000_production_performance_indexes.sql`
