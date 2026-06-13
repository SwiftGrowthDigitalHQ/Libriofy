# Health Readiness Root Cause Report

## Verdict

- Decision: `B) Production is genuinely misconfigured`
- Final readiness verdict: `FAIL`
- Reason: `readiness.ok` is `false` because `validateRuntimeConfiguration()` emits four failed config checks in production.

## Live Payload

Captured from the live production deployment at:

- `https://libriofy-a1e07in4q-swiftgrowthdigitals-projects.vercel.app/api/health/ready`

Raw response snapshot:

- [health-ready.json](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/health-ready.json)

Key payload fields:

```json
{
  "ok": false,
  "status": "failed",
  "checks": [
    {
      "name": "razorpay_key_id",
      "status": "fail",
      "category": "config",
      "requirement": "RAZORPAY_KEY_ID",
      "detail": "RAZORPAY_KEY_ID is missing, placeholder, or not a live Razorpay key."
    },
    {
      "name": "razorpay_key_secret",
      "status": "fail",
      "category": "config",
      "requirement": "RAZORPAY_KEY_SECRET",
      "detail": "RAZORPAY_KEY_SECRET is missing or placeholder."
    },
    {
      "name": "razorpay_webhook_secret",
      "status": "fail",
      "category": "config",
      "requirement": "RAZORPAY_WEBHOOK_SECRET",
      "detail": "RAZORPAY_WEBHOOK_SECRET is missing or placeholder."
    },
    {
      "name": "student_qr_signing",
      "status": "fail",
      "category": "config",
      "requirement": "STUDENT_QR_PRIVATE_KEY",
      "detail": "STUDENT_QR_PRIVATE_KEY is missing or placeholder."
    },
    {
      "name": "config_drift",
      "status": "warn",
      "category": "deployment",
      "detail": "Supabase URL drift detected across SUPABASE_URL/VITE_SUPABASE_URL (https://xaoitjyuuxwksofmmydh.supabase.co/, https://hchflmrvmfvunedjhwta.supabase.co.)."
    }
  ],
  "database": {
    "status": "ok",
    "connectivity": "pass",
    "detail": "Critical database entities and auth runtime contracts are present."
  },
  "degraded": {
    "active": true
  }
}
```

## Failing Checks

| Check | Category | Source | Env var | External dependency | Notes |
| --- | --- | --- | --- | --- | --- |
| `razorpay_key_id` | A, E | [`src/lib/observability/runtimeGovernance.server.ts:367-370`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L367) | `RAZORPAY_KEY_ID` | Razorpay billing | Missing or placeholder key fails readiness. |
| `razorpay_key_secret` | A, E | [`src/lib/observability/runtimeGovernance.server.ts:374-376`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L374) | `RAZORPAY_KEY_SECRET` | Razorpay billing | Missing or placeholder secret fails readiness. |
| `razorpay_webhook_secret` | A, E | [`src/lib/observability/runtimeGovernance.server.ts:380-382`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L380) | `RAZORPAY_WEBHOOK_SECRET` | Razorpay billing | Missing or placeholder webhook secret fails readiness. |
| `student_qr_signing` | A, F | [`src/lib/observability/runtimeGovernance.server.ts:387-389`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L387) | `STUDENT_QR_PRIVATE_KEY` | Student QR signing | Missing or placeholder private key fails readiness. |

## Exact Root Cause

The readiness gate is not failing because of Attendance V3, scanner routes, or database/schema connectivity. Those checks are currently passing.

The failure is caused by production runtime configuration missing four required secrets/keys:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `STUDENT_QR_PRIVATE_KEY`

`validateRuntimeConfiguration()` marks each as `fail`, and `buildRuntimeReadinessReport()` sets `ok` with `checks.every((check) => check.status !== "fail")`, so any one of these failures forces `readiness.ok = false`.

## Traceback

### Readiness gate

- [`src/lib/observability/runtimeGovernance.server.ts:298-389`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L298)
- Function: `validateRuntimeConfiguration(env, options)`
- Role: builds the config checks that directly drive `readiness.ok`

### Readiness decision

- [`src/lib/observability/runtimeGovernance.server.ts:741-883`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L741)
- Function: `buildRuntimeReadinessReport(env, options)`
- Role: merges config, database, auth integrity, and contract signals; marks readiness failed when any check fails

### Razorpay consumers

- [`src/lib/superAdmin/service.server.ts:996-1012`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/superAdmin/service.server.ts#L996)
- Function: `buildBillingProviderDiagnostics(env)`
- Role: reads `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`

### Student QR consumer

- [`src/lib/studentQr.server.ts:215-223`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/studentQr.server.ts#L215)
- Function: `resolveStudentQrSigningRequest(env, requestBody, headers)`
- Role: requires `STUDENT_QR_PRIVATE_KEY` before signing QR tokens

### Configuration drift warning

- [`src/lib/observability/runtimeGovernance.server.ts:216-221`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L216)
- Function: `buildDriftWarnings(env)`
- Role: detects the `SUPABASE_URL` and `VITE_SUPABASE_URL` mismatch

### Supabase admin selection

- [`src/lib/observability/supabaseAdminConfig.server.ts:269-359`](C:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/supabaseAdminConfig.server.ts#L269)
- Function: `resolveSupabaseAdminConfig(env)`
- Role: chooses the linked Supabase project and confirms server-side alignment

## Classification

- Category A, missing environment variables:
  - `RAZORPAY_KEY_ID`
  - `RAZORPAY_KEY_SECRET`
  - `RAZORPAY_WEBHOOK_SECRET`
  - `STUDENT_QR_PRIVATE_KEY`
- Category B, configuration drift:
  - `SUPABASE_URL` and `VITE_SUPABASE_URL` point to different Supabase project refs
- Category C, database connectivity:
  - No failure. `supabase_connectivity` passed.
- Category D, Supabase configuration mismatch:
  - No failure. `supabase_admin_project_alignment` passed, but there is a drift warning.
- Category E, Razorpay configuration:
  - Direct cause of three failed checks
- Category F, Student QR configuration:
  - Direct cause of one failed check
- Category G, runtime governance logic bug:
  - Not indicated. The logic is behaving as written.

## Health Interpretation

- Application health for Attendance V3: operational
- Readiness health for full production: not healthy
- Readiness logic overly strict: no evidence of that
- Production genuinely misconfigured: yes

## Exact Fix

Smallest fix that should make `readiness.ok = true`:

1. Restore the four missing production env vars in Vercel:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`
   - `STUDENT_QR_PRIVATE_KEY`
2. Optional but recommended cleanup:
   - Align `SUPABASE_URL` with `VITE_SUPABASE_URL` so the drift warning disappears too

## Risk Level

- Risk: `high`
- Why: billing and QR-signing features will remain degraded or return config errors until the secrets are restored, even though the core attendance routes are currently working.

## Notes

- No Attendance V3 code was modified.
- No scanner routes were modified.
- No `process_attendance_scan` logic was modified.
- The live readiness payload shows the database layer is healthy, so the outage is configuration-related rather than a database incident.
