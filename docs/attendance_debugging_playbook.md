# Attendance Debugging Playbook

This playbook is organized by failure mode and is meant for live incident triage.

## Fast triage checklist

1. Confirm the route:
   - `/scan`
   - `/dashboard/attendance`
   - `/api/attendance/scan`
   - `/api/device-heartbeat`
   - `/api/device-setup`
   - `/api/student-qr`
2. Check browser console.
3. Check the Network tab for the exact request and response.
4. Check `attendance_logs`, `entry_devices`, `library_access_keys`, `library_subscriptions`, and `students`.
5. Check the relevant RPC signatures and migration history.

## Failure modes

### 1. Scanner camera does not open

Symptoms:
- `/scan` loads but the camera never starts.
- Preview stays blank or shows permission errors.

Root cause:
- Camera permission denied.
- Camera unavailable.
- Browser does not support required APIs.
- Another tab/app owns the camera.

Logs to inspect:
- Browser console
- `ScanController` log output

Tables to inspect:
- none

RPC to inspect:
- none

Fix approach:
- Re-test with camera permissions granted.
- Close other apps using the camera.
- Use a browser with secure-context camera support.

### 2. QR parses locally but attendance write fails

Symptoms:
- QR is recognized.
- UI shows a denial or error after parsing.

Root cause:
- `scan_attendance_entry` / `qr_check_in` RPC error.
- Device token invalid or missing.
- Device bound to wrong library.
- Subscription expired.

Logs to inspect:
- Browser console
- `/api/attendance/scan` response
- `log_attendance_failure`

Tables to inspect:
- `entry_devices`
- `library_access_keys`
- `library_subscriptions`
- `students`

RPC to inspect:
- `scan_attendance_entry`
- `qr_check_in`
- `process_attendance_scan`

Fix approach:
- Verify the kiosk is bound to the right library.
- Verify the device token and access key.
- Verify the student is active and the subscription is valid.

### 3. Invalid QR

Symptoms:
- Attendance page or kiosk shows `INVALID_QR`.

Root cause:
- Raw QR is malformed.
- Signed token signature is invalid.
- Token expired.
- Wrong library.

Logs to inspect:
- Browser console
- `scan-debug` response

Tables to inspect:
- `students`

RPC to inspect:
- `get_student_id_profile`
- `scan_attendance_entry`
- `qr_check_in`

Fix approach:
- Regenerate the QR token.
- Confirm the public key matches the signing key.
- Confirm the QR belongs to the correct library.

### 4. Expired QR verification

Symptoms:
- Signed QR fails with `EXPIRED`.

Root cause:
- Token expiration passed.
- Student membership expired and signer refused issuance.

Logs to inspect:
- `scan-debug`
- QR token inspection output

Tables to inspect:
- `students`

RPC to inspect:
- `get_student_id_profile`

Fix approach:
- Renew the student membership.
- Regenerate the token after the membership becomes active again.

### 5. Membership status drift

Symptoms:
- Student appears active in one screen and expired in another.
- Attendance is blocked unexpectedly.

Root cause:
- `students.status` drifted away from `expiry_date` and active-membership logic.

Logs to inspect:
- runtime integrity output
- student write path logs

Tables to inspect:
- `students`

RPC to inspect:
- `get_attendance_runtime_diagnostics`
- `sync_student_membership_status`
- renewal-related functions

Fix approach:
- Let the membership guard migration / sync routine align status and expiry.

### 6. Invalid API key or device token

Symptoms:
- Kiosk setup or heartbeat returns blocked/invalid.

Root cause:
- Wrong `library_access_key`.
- Wrong `device_token`.
- Device is disabled.

Logs to inspect:
- `device_setup_attempts`
- `entry_devices.metadata`
- `log_attendance_failure`

Tables to inspect:
- `library_access_keys`
- `device_setup_attempts`
- `entry_devices`

RPC to inspect:
- `validate_and_bind_scanner_device`
- `pull_device_commands`
- `record_device_command_status`

Fix approach:
- Re-enter the library access key.
- Rebind the device if necessary.
- Check whether the device was manually disabled.

### 7. Deployment failure

Symptoms:
- One environment works, another does not.
- Route exists locally but not in deployed runtime.

Root cause:
- Route parity issue.
- Environment variable mismatch.
- Serverless function not deployed.

Logs to inspect:
- Vercel deployment logs
- API logs

Tables to inspect:
- n/a unless the failure is downstream of DB access

RPC to inspect:
- `scan_attendance_entry`
- `qr_check_in`

Fix approach:
- Compare deployed env vars and route availability.
- Confirm the same host is used by the kiosk.

### 8. Device heartbeat 404

Symptoms:
- Scanner keeps asking to reconnect.
- Heartbeat network request returns 404 or a route not found error.

Root cause:
- Missing deployment route.
- Wrong API base URL.

Logs to inspect:
- Network tab
- browser console

Tables to inspect:
- `entry_devices`
- `library_access_keys`

RPC to inspect:
- none directly

Fix approach:
- Ensure `/api/device-heartbeat` is available in the deployment.
- Reconnect the kiosk if the URL changed.

### 9. PGRST203 / RPC conflict

Symptoms:
- RPC request fails with a schema-cache or overload-related error.
- Attendance write works in one environment but not another.

Root cause:
- Duplicate attendance RPC signatures.
- PostgREST schema cache not aligned with the deployed function set.
- Client uses a signature that is no longer available.

Logs to inspect:
- Supabase logs
- deployment logs
- debug payload from `/api/attendance/scan-debug`

Tables to inspect:
- not the first stop; inspect function signatures first

RPC to inspect:
- `qr_check_in`
- `scan_attendance_entry`
- `process_attendance_scan`

Fix approach:
- Compare deployed function signatures to local migration history.
- Refresh schema cache / redeploy the matching migration set.
- Prefer one canonical scan RPC where possible.

### 10. Offline queue does not drain

Symptoms:
- Kiosk says queued offline forever.
- Attendance never appears in the database after reconnect.

Root cause:
- Sync loop cannot reach the API.
- `DEVICE_TOKEN` missing.
- IndexedDB queue entry malformed.

Logs to inspect:
- browser console
- kiosk debug log copy
- sync errors

Tables to inspect:
- `attendance_logs`
- `entry_devices`

RPC to inspect:
- `scan_attendance_entry`
- `qr_check_in`

Fix approach:
- Restore network/API access.
- Verify the kiosk has the right device token.
- Trigger `syncQueuedAttendance` after connectivity returns.

### 11. Duplicate scan

Symptoms:
- Student is marked as already scanned.
- UI shows warning or duplicate state.

Root cause:
- Same student scanned twice in the duplicate window.
- Attendance already open for the day.

Logs to inspect:
- kiosk history panel
- server debug response

Tables to inspect:
- `attendance_logs`

RPC to inspect:
- `scan_attendance_entry`
- `qr_check_in`

Fix approach:
- Confirm existing `check_in` / `check_out` state before retrying.

## Table and RPC inspection commands

Use these patterns in Supabase SQL or the database console:

```sql
select * from public.students where id = '<student-id>';
select * from public.attendance_logs where student_id = '<student-id>' order by check_in desc;
select * from public.entry_devices where device_id = '<device-id>';
select * from public.library_access_keys where access_key = '<access-key>';
select * from public.library_subscriptions where library_id = '<library-id>';
```

RPC focus checklist:

- `scan_attendance_entry`
- `qr_check_in`
- `process_attendance_scan`
- `validate_and_bind_scanner_device`
- `pull_device_commands`
- `record_device_command_status`
- `get_student_id_profile`
- `log_attendance_failure`

## Observability checklist by tool

### Browser Console

Look for:
- QR parse errors
- camera errors
- API submission failures
- sync queue errors

### Network Tab

Look for:
- request body
- response code
- response message
- route mismatch

### API Logs

Look for:
- request path
- request id
- `log_attendance_failure` metadata

### Supabase Logs

Look for:
- RPC signature mismatch
- permission errors
- missing table or missing column errors

### GitHub Actions

Look for:
- migration application errors
- type generation drift

### Vercel Deployments

Look for:
- serverless route availability
- environment variable parity
- function runtime errors

## Field guide for the main tables

### `students`

Inspect:
- `qr_code`
- `status`
- `expiry_date`
- `last_check_in`
- `seat_number`
- `slot_id`

### `attendance_logs`

Inspect:
- `check_in`
- `check_out`
- `date`
- `entry_id`
- `device_id`

### `entry_devices`

Inspect:
- `device_id`
- `library_id`
- `is_active`
- `last_seen_at`
- `metadata.device_control`
- `metadata.device_runtime`

### `library_access_keys`

Inspect:
- `library_id`
- `access_key`
- `rotated_at`

### `library_subscriptions`

Inspect:
- `status`
- `payment_status`
- `expires_at`
- `plan_expiry_date`

## Incident response order

1. Verify the route.
2. Verify the device binding.
3. Verify the student record.
4. Verify the subscription state.
5. Verify the RPC signature set.
6. Re-run the scan with debug mode enabled.
7. Check the resulting `attendance_logs` row.
