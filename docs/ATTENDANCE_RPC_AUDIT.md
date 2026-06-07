# Attendance RPC Audit

Scope: repository-local audit of attendance-related RPCs and their overloads.

This document focuses on the attendance RPC family and the direct overlaps that create schema-cache and function-resolution risk.

## 1. RPC Inventory

### Canonical attendance family

| Function | Arguments | Return Type | Used By | Migration Source |
|---|---|---|---|---|
| `process_attendance_scan` | `p_failure_route TEXT, p_student_id UUID DEFAULT NULL, p_qr_code TEXT DEFAULT NULL, p_library_id UUID DEFAULT NULL, p_device_id TEXT DEFAULT NULL, p_entry_id TEXT DEFAULT NULL, p_entry_timestamp TIMESTAMPTZ DEFAULT now()` | `jsonb` | `scanAttendance.server.ts`, `scan-attendance` edge function | `supabase/migrations/20260404113000_phonepe_qr_attendance_toggle.sql` |
| `scan_attendance_entry` | same shape as the post-v3 wrapper signature; current code routes to `process_attendance_scan` | `jsonb` | kiosk server, edge function fallback chain | `supabase/migrations/20260331120000_kiosk_entry_devices_and_scan_api.sql`, `20260401123000_offline_first_attendance_queue.sql`, `20260401160000_signed_qr_multi_device_security.sql`, `20260401170000_secure_attendance_data_lock.sql`, `20260404113000_phonepe_qr_attendance_toggle.sql` |
| `qr_check_in` | same shape as the post-v3 wrapper signature; current code routes to `process_attendance_scan` | `jsonb` | attendance page, kiosk fallback chain | `supabase/migrations/20260228060018_300b3a78-39aa-44e1-b17d-6c96877cacbe.sql`, `20260401123000_offline_first_attendance_queue.sql`, `20260401160000_signed_qr_multi_device_security.sql`, `20260401170000_secure_attendance_data_lock.sql`, `20260404113000_phonepe_qr_attendance_toggle.sql` |

### Related QR / device RPCs

| Function | Arguments | Return Type | Used By | Migration Source |
|---|---|---|---|---|
| `get_student_id_profile` | `p_qr_code TEXT` or `p_library_id UUID, p_qr_code TEXT, p_student_id UUID` | `json` | student profile UI, QR rendering | checked-in migration history in the repository |
| `validate_and_bind_scanner_device` | `p_library_access_key TEXT, p_device_id TEXT DEFAULT NULL` | `json` | `/api/device-setup`, `SetupDevicePage` | generated types show it; local migration source not found in reviewed files |
| `log_attendance_failure` | `p_route TEXT, p_code TEXT, p_message TEXT, p_source TEXT, p_metadata JSONB DEFAULT NULL` | `void` | attendance error logging paths | attendance observability migration history |
| `pull_device_commands` | `p_device_id TEXT, p_device_token TEXT, p_library_access_key TEXT, p_library_id UUID, p_limit INT DEFAULT NULL` | setof `device_commands` | scanner fleet polling | device command migration history |
| `record_device_command_status` | `p_command_id UUID, p_device_id TEXT, p_device_token TEXT, p_library_access_key TEXT, p_library_id UUID, p_status TEXT, p_error_message TEXT DEFAULT NULL, p_metadata JSONB DEFAULT NULL` | `device_commands` row | scanner command acknowledgements | device command migration history |

## 2. Overload Cluster Analysis

### `qr_check_in`

Observed overload cluster:

- legacy public-facing QR lookup
- entry-id aware overload
- device-aware overload
- wrapper overload that delegates to `process_attendance_scan`

Why it matters:

- client code can hit a different overload than the one deployed
- PostgREST may report an ambiguous candidate error when schema cache is stale
- the browser attendance page currently uses `qr_check_in` directly

### `scan_attendance_entry`

Observed overload cluster:

- legacy QR lookup
- entry-id aware overload
- device-aware overload
- wrapper overload that delegates to `process_attendance_scan`

Why it matters:

- kiosk code still probes this RPC first
- fallback behavior introduces multiple possible resolution paths

### `process_attendance_scan`

Current role:

- canonical internal attendance state machine
- validates device, student, expiry, duplicate, and write path
- writes attendance and updates student state

This should be the only attendance RPC that survives as the canonical public write path.

## 3. Direct Usage Map

### Browser / client code

- `src/pages/AttendancePage.tsx`
  - calls `supabase.rpc("qr_check_in", ...)`
  - still performs a browser-side `students` lookup for legacy/non-UUID inputs
- `src/lib/attendanceSync.ts`
  - POSTs to the attendance API and may fall back to the edge function
- `src/pages/ScanKioskPageV2.tsx`
  - calls the scan API and syncs offline queue entries

### Server code

- `src/lib/scanAttendance.server.ts`
  - calls `scan_attendance_entry`
  - falls back to `qr_check_in`
  - falls back again to legacy `qr_check_in`
- `supabase/functions/scan-attendance/index.ts`
  - mirrors the server logic and the same fallback chain

## 4. Used By

| RPC | Primary caller(s) | Usage type |
|---|---|---|
| `process_attendance_scan` | server implementation, edge function implementation | canonical attendance write state machine |
| `scan_attendance_entry` | kiosk scan API, edge function fallback chain | preferred compatibility entry point |
| `qr_check_in` | attendance page, kiosk fallback chain | legacy compatibility entry point |
| `get_student_id_profile` | student profile UI and QR generation | read-only lookup |
| `validate_and_bind_scanner_device` | setup device page | setup-time device binding |
| `log_attendance_failure` | attendance/device error paths | observability |

## 5. Migration Sources

### Attendance family

- `20260228060018_300b3a78-39aa-44e1-b17d-6c96877cacbe.sql`
- `20260401123000_offline_first_attendance_queue.sql`
- `20260401160000_signed_qr_multi_device_security.sql`
- `20260401170000_secure_attendance_data_lock.sql`
- `20260404113000_phonepe_qr_attendance_toggle.sql`

### Device / scan support

- `20260331120000_kiosk_entry_devices_and_scan_api.sql`
- `20260401213000_scanner_device_control_policy_and_alerts.sql`
- `20260401190000_library_access_key_security.sql`

## 6. Duplicate Detection

### Duplicate family members discovered

- `qr_check_in`
- `scan_attendance_entry`
- `process_attendance_scan`
- `get_student_id_profile`

### Duplicate risk category

1. True legacy compatibility overloads
2. Wrapper overloads that should forward only
3. Client-side probing of multiple function names
4. Schema-cache mismatch after deployment

## 7. PGRST203 Analysis

### Most likely root cause

PGRST203-style errors are most likely caused by a combination of:

- multiple attendance RPC overloads
- multiple client entry points
- stale PostgREST schema cache
- deployed schema diverging from checked-in migrations

### Audit conclusion

The attendance RPC family is over-provisioned for the current system.

The safest end state is:

- `process_attendance_scan` as the only canonical attendance RPC
- `qr_check_in` as compatibility wrapper only
- `scan_attendance_entry` as compatibility wrapper only
- browser pages removed from the write path

## 8. Removal Candidates

The following should be considered removal candidates after clients are migrated:

- direct browser `qr_check_in` usage
- direct browser `scan_attendance_entry` usage
- fallback probing from `scanAttendance.server.ts`
- fallback probing from `supabase/functions/scan-attendance/index.ts`

The wrappers themselves can remain temporarily, but they should contain no business logic.

## 9. Canonical RPC Recommendation

### Survive

- `process_attendance_scan`

### Wrapper only

- `qr_check_in`
- `scan_attendance_entry`

### Remove from client code

- direct `qr_check_in` calls
- direct `scan_attendance_entry` calls

## 10. Implementation Notes

- Do not use the browser attendance page as a write surface.
- Do not keep multiple public attendance RPCs active in the hot path.
- Refresh schema cache after deployment changes.
- Prefer one RPC with one argument shape.

## 11. Reference Files

- `src/lib/scanAttendance.server.ts`
- `src/lib/attendanceSync.ts`
- `src/pages/AttendancePage.tsx`
- `src/pages/ScanKioskPageV2.tsx`
- `supabase/functions/scan-attendance/index.ts`
- `supabase/migrations/20260404113000_phonepe_qr_attendance_toggle.sql`
