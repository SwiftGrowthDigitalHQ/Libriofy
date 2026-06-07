# Attendance V3 Forensic Report

Scope: reverse-engineering and migration planning only. No code was changed while producing this report.

This report documents the current attendance architecture, the scan-only v3 target, the RPC overlap that causes PGRST203-style drift, and the migration path to a single canonical attendance write route.

## 1. Current Architecture

### Current write surfaces

The checked-in repository still exposes more than one attendance write path:

- `/scan`
- `/dashboard/attendance`
- `/api/attendance/scan`
- `/api/scan-attendance`
- `process_attendance_scan`
- `scan_attendance_entry`
- `qr_check_in`

### Current data path

```mermaid
flowchart TD
  A[Student QR]
  B[/scan\nScanKioskPageV2]
  C[/dashboard/attendance\nAttendancePage]
  D[/api/attendance/scan\n/api/scan-attendance]
  E[RPC layer\nprocess_attendance_scan\nscan_attendance_entry\nqr_check_in]
  F[(attendance_logs)]
  G[Dashboard / Analytics]

  A --> B --> D --> E --> F --> G
  A --> C --> E --> F --> G
```

### Current hot path inventory

Observed from the checked-in code:

- Kiosk scan prechecks:
  - `library_access_keys`
  - `entry_devices`
  - `library_subscriptions`
  - `students`
- RPC internal work:
  - `entry_devices` validation
  - `students` validation
  - `attendance_logs` duplicate / open-row checks
  - `attendance_logs` insert or update
  - `students` attendance state update
- Browser attendance page:
  - direct `qr_check_in` usage
  - a separate `students` lookup for legacy/non-UUID input

### Why the current system is too complex

- Multiple pages can still write attendance.
- Multiple RPC names can satisfy the same business action.
- The browser and server both perform overlapping identity checks.
- The kiosk path contains fallback RPC attempts.
- The heartbeat path keeps writing every 30 seconds.

## 2. New Architecture

### v3 target

Attendance should be scan-only:

- attendance is created only through QR scan
- `/scan` is the only attendance write surface
- `/dashboard/attendance` is read-only
- `process_attendance_scan` is the only canonical attendance RPC

### v3 write flow

```mermaid
flowchart TD
  A[Student QR]
  B[/scan\nOnly write surface]
  C[Scan device]
  D[process_attendance_scan\nCanonical RPC]
  E[(attendance_logs)]
  F[/dashboard/attendance\nRead only]
  G[Monthly attendance dashboard]

  A --> B --> C --> D --> E
  E --> F
  E --> G
```

### v3 rules

1. Attendance can only be created through QR scanning.
2. Manual student ID entry is removed from attendance creation.
3. `attendance_logs` cannot be written directly from browser pages.
4. `qr_check_in` and `scan_attendance_entry` remain compatibility wrappers only.
5. Browser attendance pages become read-only.

## 3. PGRST203 Root Cause

### What the repo shows

The repository contains a family of overloaded attendance RPCs:

- `qr_check_in`
- `scan_attendance_entry`
- `process_attendance_scan`

The deployment can drift if:

- the client calls an overload signature that is not present in the deployed schema
- PostgREST schema cache has not refreshed
- the client retries multiple RPC names to compensate for missing overloads

### Root cause summary

PGRST203-style failures are most likely caused by:

- multiple `qr_check_in` overloads across migrations
- multiple `scan_attendance_entry` overloads across migrations
- clients probing several RPC shapes in the hot path
- deployed schema and checked-in schema being out of sync

### Elimination strategy

1. Make `process_attendance_scan` the single canonical write RPC.
2. Convert `qr_check_in` and `scan_attendance_entry` into thin wrappers.
3. Remove fallback RPC attempts from the hot path.
4. Stop browser pages from calling attendance RPCs directly.

## 4. Query Count Before vs After

### Before

Warm kiosk scan:

- API calls: `1`
- RPC calls: `1` nominal, `3` worst-case with fallback attempts
- DB reads: about `6` warm, about `9` cold
- DB writes: `1` to `2`

Browser attendance page:

- API calls: `0`
- RPC calls: `1`
- DB reads: about `5` to `6`
- DB writes: `1` to `2`

Heartbeat:

- API calls: `1` every 30 seconds
- DB reads: `2`
- DB writes: `1`

### After

v3 scan-only path:

- API calls: `1`
- RPC calls: `1`
- DB reads: reduced by removing duplicate prechecks and fallback probing
- DB writes: `1` attendance write, with optional trigger-maintained student state update

### Expected reduction

- fewer scan-time reads
- fewer RPC names to resolve
- fewer fallback calls
- lower heartbeat pressure
- lower tail latency

## 5. Latency Before vs After

### Before

Estimated warm kiosk scan:

- `220-650ms`

Estimated cold kiosk scan:

- `300-840ms`

Tail latency can exceed `1s` if fallback RPC attempts or schema drift occur.

### After

Expected scan-only target:

- `90-300ms` typical
- lower tail latency because fallback probing is removed

### Bottlenecks removed in v3

- browser write path
- duplicate student lookup before RPC
- multiple RPC resolution attempts
- repeated access-key validation on every scan

## 6. Supabase Load Reduction Estimate

### Main load sources today

1. scan-time prechecks
2. RPC internal duplicate validation
3. 30-second heartbeat writes
4. browser direct write path
5. fallback RPC attempts

### v3 load strategy

- one writer only: `/scan`
- one canonical RPC only: `process_attendance_scan`
- device, library, and subscription state cached or session-token backed
- heartbeat reduced to 5 minutes or replaced with session refresh

### Approximate effect

For a kiosk with 1,000 scans/day:

- current load is dominated by repeated reads and heartbeat writes
- v3 should reduce read load materially by removing duplicate checks and removing browser writes

## 7. Migration Plan

### Phase A. Freeze writes from browser pages

- remove manual attendance input from `/dashboard/attendance`
- remove direct `qr_check_in` usage from browser pages
- make attendance dashboard read-only

### Phase B. Canonicalize attendance writes

- route all scan writes through `process_attendance_scan`
- convert old RPCs into wrappers only
- remove fallback RPC attempts from the hot path

### Phase C. Reduce recurring load

- cache device state
- cache library state
- cache subscription state
- lower heartbeat frequency or move to session refresh

### Phase D. Add monthly analytics

- add monthly attendance aggregation
- index for library/date/student lookups
- render read-only monthly attendance dashboard

## 8. Files Involved

- `src/pages/ScanKioskPageV2.tsx`
- `src/pages/AttendancePage.tsx`
- `src/lib/scanAttendance.server.ts`
- `src/lib/attendanceSync.ts`
- `src/lib/deviceHeartbeat.server.ts`
- `src/lib/deviceSetup.server.ts`
- `supabase/migrations/20260404113000_phonepe_qr_attendance_toggle.sql`
- `supabase/migrations/20260514120000_production_performance_indexes.sql`

## 9. PASS Criteria

This v3 design only passes if all of the following are true:

- attendance is created only via QR scan
- `/dashboard/attendance` is read-only
- one canonical attendance RPC remains
- PGRST203-style function resolution errors are eliminated
- Supabase load is reduced
- monthly attendance analytics work
- no manual attendance path exists

The current repository snapshot does not yet meet those criteria.
