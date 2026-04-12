# API Reference

## Important Context

Libriofy does not use a single backend style.

There are three application-facing backend layers:

1. Same-origin REST endpoints in `server/index.ts`, `api/`, and `vite.config.ts`
2. Supabase Edge Functions in `supabase/functions/`
3. Postgres RPCs used directly through the Supabase client

For future work, treat all three as official contracts.

Important production note:

- the Express runtime in `server/index.ts` is the production REST source
- `vite.config.ts` must mirror the same behavior in local development
- server-generated failures now include `requestId` for incident tracing

## 1. Custom REST Endpoints

### `GET /health`

- Purpose: health probe for the Express API runtime
- Request: no body
- Response:

```json
{
  "appEnv": "production",
  "release": "git-sha",
  "service": "libriofy-auth-attendance-api",
  "status": "ok",
  "timestamp": "2026-04-07T00:00:00.000Z",
  "uptimeSeconds": 123
}
```

### `GET /health/live`

- Purpose: liveness probe for the API container
- Request: no body
- Response:

```json
{
  "status": "ok",
  "timestamp": "2026-04-07T00:00:00.000Z",
  "uptimeSeconds": 123
}
```

### `GET /health/ready`

- Purpose: readiness probe used by the host platform
- Request: no body
- Response:

```json
{
  "status": "ok",
  "ok": true,
  "checks": [
    {
      "name": "supabase_url",
      "status": "pass",
      "detail": "configured"
    },
    {
      "name": "supabase_service_role",
      "status": "pass",
      "detail": "configured"
    }
  ],
  "service": "libriofy-auth-attendance-api",
  "appEnv": "production",
  "timestamp": "2026-04-07T00:00:00.000Z"
}
```

### `GET /health/ops`

- Purpose: operator-focused health payload for monitoring tools
- Request: no body
- Response:

```json
{
  "appEnv": "production",
  "nodeVersion": "v20.19.0",
  "readiness": {
    "status": "ok",
    "ok": true,
    "checks": []
  },
  "release": "git-sha",
  "requestId": "uuid",
  "timestamp": "2026-04-07T00:00:00.000Z",
  "uptimeSeconds": 123
}
```

### `GET /release.json`

- Purpose: frontend release manifest used by the go-live gate
- Runtime: emitted by the Vite production build and served by the CDN or Express static layer
- Request: no body
- Response:

```json
{
  "appEnv": "production",
  "generated_at_utc": "2026-04-08T00:00:00.000Z",
  "release": "git-sha"
}
```

### `GET /api/settings`

- Purpose: return global maintenance mode state
- Runtime: served by both the Express production server and the Vite dev middleware
- Request: no body
- Response:

```json
{
  "maintenanceMode": false,
  "maintenance_mode": false,
  "source": "database",
  "updatedAt": "2026-04-07T00:00:00.000Z",
  "updated_at": "2026-04-07T00:00:00.000Z"
}
```

### `POST /auth/send-otp`

Alias: `POST /api/auth/send-otp`

- Purpose: start mobile OTP login
- Headers:
  - `x-device-fingerprint`
  - `x-device-label`
- Request:

```json
{
  "phone": "+919876543210"
}
```

- Response:

```json
{
  "success": true,
  "channel": "whatsapp",
  "expiresIn": 120,
  "message": "OTP sent",
  "retryAfter": 30
}
```

### `POST /auth/verify-otp`

Alias: `POST /api/auth/verify-otp`

- Purpose: complete OTP login and create a custom auth session
- Headers:
  - `x-device-fingerprint`
  - `x-device-label`
- Request:

```json
{
  "phone": "+919876543210",
  "otp": "123456"
}
```

- Response:

```json
{
  "success": true,
  "channel": "whatsapp",
  "message": "Login successful",
  "session": {
    "accessToken": "jwt",
    "authLevel": 1,
    "expiresAt": 1712490000,
    "idleTimeoutSeconds": null,
    "loginMethod": "otp",
    "provider": "custom",
    "sessionScope": "general",
    "trustedDevice": true,
    "user": {
      "id": "uuid",
      "email": "owner@example.com",
      "phone": "+919876543210",
      "fullName": "Owner",
      "roles": ["library_owner"]
    }
  }
}
```

### `POST /auth/login-email`

Alias: `POST /api/auth/login-email`

- Purpose: email-password login for normal app users
- Headers:
  - `x-device-fingerprint`
  - `x-device-label`
- Request:

```json
{
  "email": "owner@example.com",
  "password": "secret"
}
```

- Response: same session envelope as OTP login, with `loginMethod = "email"`

### `POST /auth/super-admin/login`

Alias: `POST /api/auth/super-admin/login`

- Purpose: first step of super admin MFA
- Headers:
  - `x-device-fingerprint`
  - `x-device-label`
- Request:

```json
{
  "email": "admin@example.com",
  "password": "secret"
}
```

- Response:

```json
{
  "success": true,
  "challengeId": "uuid",
  "channel": "email",
  "expiresIn": 300,
  "maskedDestination": "ad***@example.com",
  "message": "OTP sent",
  "retryAfter": 30
}
```

### `POST /auth/super-admin/verify-otp`

Alias: `POST /api/auth/super-admin/verify-otp`

- Purpose: complete super admin MFA and create a level-2 admin session
- Request:

```json
{
  "challengeId": "uuid",
  "otp": "123456"
}
```

- Response: same session envelope as normal login, but `sessionScope = "super_admin"` and `authLevel = 2`

### `POST /auth/refresh`

Alias: `POST /api/auth/refresh`

- Purpose: refresh custom auth session using the refresh cookie
- Request: empty body allowed
- Response: fresh `session` envelope

### `POST /auth/logout`

Alias: `POST /api/auth/logout`

- Purpose: revoke current session
- Request: empty body allowed
- Response:

```json
{
  "success": true,
  "message": "Logged out"
}
```

### `POST /auth/logout-all`

Alias: `POST /api/auth/logout-all`

- Purpose: revoke all active trusted sessions for the current user
- Optional header:
  - `Authorization: Bearer <accessToken>`
- Request: empty body allowed
- Response:

```json
{
  "success": true,
  "message": "Logged out from all devices"
}
```

### `POST /auth/twilio-status`

Alias: `POST /api/auth/twilio-status`

- Purpose: Twilio delivery status callback for OTP messages
- Request: provider-defined webhook payload
- Response: internal acknowledgement JSON from the auth resolver

### `POST /api/device-setup`

- Purpose: bind a scanner device to a library
- Request:

```json
{
  "libraryId": "LIB-8X29KQ",
  "deviceId": "LIB_GATE_01"
}
```

- Response on success:

```json
{
  "valid": true,
  "bound": true,
  "deviceId": "LIB_GATE_01",
  "libraryAccessKey": "LIB-8X29KQ",
  "library": {
    "id": "uuid",
    "name": "Libriofy Demo",
    "library_name": "Libriofy Demo",
    "logo_url": null,
    "primary_color": "#14b8a6"
  }
}
```

- Response on failure: `valid: false` with codes such as `INVALID_LIBRARY_ID`, `DEVICE_SETUP_LOCKED`, `DEVICE_BLOCKED`

### `POST /api/device-heartbeat`

- Purpose: keep kiosk presence updated and validate device/library linkage
- Request:

```json
{
  "deviceId": "LIB_GATE_01",
  "libraryId": "uuid",
  "libraryAccessKey": "LIB-8X29KQ",
  "deviceName": "Front Desk Scanner",
  "pendingCount": 0,
  "lastSyncAt": "2026-04-07T00:00:00.000Z",
  "isOnline": true,
  "cameraReady": true,
  "phase": "scanning",
  "userAgent": "Mozilla/5.0",
  "appVersion": "2026.04.07"
}
```

- Response:

```json
{
  "valid": true,
  "deviceId": "LIB_GATE_01",
  "libraryId": "uuid",
  "deviceName": "Front Desk Scanner",
  "heartbeatAt": "2026-04-07T00:00:00.000Z",
  "lastSeenAt": "2026-04-07T00:00:00.000Z"
}
```

### `POST /api/student-qr`

- Purpose: sign QR tokens for one or more students
- Header:
  - `Authorization: Bearer <accessToken>`
- Request:

```json
{
  "libraryId": "uuid",
  "studentIds": ["student-uuid-1", "student-uuid-2"]
}
```

- Response:

```json
{
  "status": "success",
  "data": [
    {
      "student_id": "student-uuid-1",
      "library_id": "uuid",
      "token": "signed-jwt",
      "exp": 1712490000,
      "nonce": "random",
      "expires_at": "2026-04-07T00:00:00.000Z"
    }
  ]
}
```

### `POST /api/attendance/scan`

Alias: `POST /api/scan-attendance`

- Purpose: hardened attendance entry point for kiosks and offline queue replay
- Header:
  - `x-device-token` or `Authorization: Bearer <deviceToken>`
- Request:

```json
{
  "qr_code": "signed-or-legacy-qr",
  "student_id": "optional-student-id",
  "device_id": "LIB_GATE_01",
  "library_id": "uuid",
  "library_access_key": "LIB-8X29KQ",
  "entry_id": "LIB_GATE_01-20260407T101000",
  "timestamp": "2026-04-07T10:10:00.000Z"
}
```

- Success response:

```json
{
  "status": "success",
  "success": true,
  "action": "check-in",
  "studentName": "Aman Kumar",
  "seat": "A-12",
  "time": "10:10 AM",
  "message": "Checked in successfully"
}
```

- Failure response:

```json
{
  "status": "error",
  "success": false,
  "code": "WRONG_LIBRARY",
  "message": "Wrong Library"
}
```

### `POST /api/ai/partner`

- Purpose: short AI-generated partner sales copy and objection handling
- Request:

```json
{
  "task": "message",
  "customerType": "library_owner",
  "objection": "price",
  "goal": "schedule_demo",
  "context": "New lead from Varanasi"
}
```

- Response:

```json
{
  "success": true,
  "output": "Ready-to-send response text",
  "model": "gpt-4o-mini"
}
```

## 2. Supabase Edge Functions

These are HTTP endpoints exposed through Supabase Functions and usually invoked with `supabase.functions.invoke(...)`.

| Function | Method | Request body | Response shape | Main consumers |
| --- | --- | --- | --- | --- |
| `subscription-quote` | `POST` | `{ libraryId, planName or plan, months, couponCode? }` | `{ success, plan, pricing }` | `BillingPage` |
| `create-payment` | `POST` | `{ libraryId, plan, months, couponCode? }` | `{ orderId, amount, currency, keyId }` | `BillingPage`, `SubscriptionGate` |
| `verify-razorpay-payment` | `POST` | `{ libraryId, razorpay_order_id, razorpay_payment_id, razorpay_signature }` | success or error payload | `BillingPage`, `SubscriptionGate` |
| `razorpay-webhook` | `POST` | Razorpay webhook payload plus signature header | webhook acknowledgement | Razorpay server callback |
| `scan-attendance` | `POST` | same shape as `/api/attendance/scan` | success or error attendance result | offline sync fallback |
| `process-renewals` | `POST` | `{ libraryId, source, includeRenewalScan, includeLockerRenewalScan }` | `{ success, timestamp, results }` | `RenewalsPage`, `LockerMapPage` |
| `start-payment-recovery-calls` | `POST` | `{ libraryId, limit?, source, studentIds? }` | `{ message, queuedCalls, started, skipped, failed }` | `PaymentsPage` |
| `send-payment-recovery-reminders` | `POST` | `{ libraryId, limit?, source, studentIds? }` | `{ message, sentCount, sent, failed }` | `PaymentsPage` |
| `payment-recovery-call-status` | `POST` | Twilio status callback payload | acknowledgement / updated status | Twilio callback |
| `admin-libraries` | `POST` | `{ library_id, library?, subscription? }` | success or updated admin mutation result | `SuperAdminSubscriptions` |
| `ai-growth-insights` | `POST` | `{ context }` | `{ insight, generated_at, model }` | `AiMarketInsightCard` |
| `ai-lead-finder` | `POST` | `{ city }` | `{ city, query, places_found, phones_found, leads }` | `AiLeadFinderCard` |
| `process-waitlist` | `POST` | internal waitlist automation payload | processing summary | automation / cron |
| `detect-no-shows` | `POST` | internal no-show scan payload | processing summary | automation / cron |
| `finalize-student-photo-upload` | `POST` | temp upload metadata and student identifiers | `{ success, photoUrl, thumbnailUrl, version }` | student photo pipeline |
| `cleanup-student-photo-assets` | `POST` | stale asset identifiers / batch payload | cleanup result | photo maintenance |
| `create-razorpay-order` | `POST` | Razorpay order creation payload | order payload | kept in repo, not the main current UI path |

## 3. Critical Postgres RPC Contracts

These are not REST endpoints, but they are part of the application contract and should be documented like APIs.

| RPC | Input | Output | Used for |
| --- | --- | --- | --- |
| `get_library_public` | `p_identifier` | public library payload | slug/custom-domain public page |
| `get_slot_availability` | `p_library_id` | per-slot occupancy counts | public library page |
| `add_to_waiting_list` | library and prospect fields | `{ success, position }` | admission lead capture |
| `confirm_waiting_list` | waitlist row and admission context | confirmed student result | waitlist conversion |
| `get_student_renewal_context` | `p_student_token` | student renewal context | public renewal page |
| `submit_renewal_payment` | token, amount, screenshot path | success or error | screenshot-based renewal proof |
| `renew_student` | `p_student_id`, amount, months | updated renewal status | owner-side renewal |
| `qr_check_in` | library and student / QR args | success or error attendance result | dashboard/manual attendance |
| `scan_attendance_entry` | device and attendance args | success or error attendance result | kiosk scan persistence |
| `validate_and_bind_scanner_device` | access key and device id | bound device payload | kiosk setup |
| `regenerate_library_access_key` | library id | new access key | device security rotation |
| `issue_device_command` | device id, library id, command, payload | created command row | remote device control |
| `pull_device_commands` | device auth payload | pending commands | kiosk command polling |
| `record_device_command_status` | command id, status, metadata | updated command row | kiosk command acknowledgement |
| `assign_locker` | locker and student ids | locker assignment result | locker operations |
| `release_locker` | locker id | locker release result | locker operations |
| `sync_library_lockers` | library and target capacity | inventory sync result | settings / capacity management |
| `sync_library_seats` | library and target capacity | inventory sync result | settings / capacity management |
| `request_partner_payout` | amount and method | payout result | partner payouts |
| `get_partner_leaderboard` | limit | ranked partner list | partner and admin dashboards |

## 4. Contract Notes For Future Developers

- Auth endpoints exist in both `/auth/*` and `/api/auth/*` forms. They resolve to the same server logic.
- Attendance exists as both custom REST and Edge Function entry points.
- Several dashboard features read tables directly instead of going through custom REST.
- When adding a new privileged mutation, prefer either:
  - a Postgres RPC when the logic is DB-centric and library-scoped, or
  - an Edge Function when external providers or server secrets are involved.
