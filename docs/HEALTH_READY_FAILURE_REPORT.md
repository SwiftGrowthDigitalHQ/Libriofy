# Health Ready Failure Report

Scope: investigate why `GET /api/health/ready` returns `503 Service Unavailable` while the main production routes still load.

## Verdict

- `FAIL`

## Summary

The failure is isolated to the readiness gate, not a general application crash.

Observed production behavior:

- `/` -> `200 OK`
- `/scan` -> `200 OK`
- `/dashboard/attendance` -> `200 OK`
- `/release.json` -> `200 OK`
- `/api/health/ready` -> `503 Service Unavailable`

Live `curl` output for `/api/health/ready` shows a structured readiness report, not an uncaught exception. The report returns `ok: false` and `status: "failed"` because configuration checks failed.

## Exact Root Cause

The readiness report fails because `validateRuntimeConfiguration()` marks required production env vars as missing:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `STUDENT_QR_PRIVATE_KEY`

The live payload also shows a non-failing warning:

- Supabase URL drift between `SUPABASE_URL` and `VITE_SUPABASE_URL`

But that drift is only a warning in the current code path and is not the direct reason the readiness check returned `503`.

## Failing Condition

The readiness status is derived here:

- [`src/lib/observability/runtimeGovernance.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L741)

The exact failure decision is made by:

- [`src/lib/observability/runtimeGovernance.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L844)

Because `checks.some((check) => check.status === "fail")` evaluates to true, the report status becomes `failed`, and the route returns `503`.

## File And Line Responsible

### Health route

- [`api/health/[...route].ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/api/health/[...route].ts#L55)

This route calls `buildRuntimeReadinessReport(...)` and sends `503` when `readiness.ok` is false.

### Readiness composer

- [`src/lib/observability/runtimeGovernance.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L741)
- [`src/lib/observability/runtimeGovernance.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L844)

### Missing config checks

- [`src/lib/observability/runtimeGovernance.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L366)
- [`src/lib/observability/runtimeGovernance.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/observability/runtimeGovernance.server.ts#L385)

Those lines require the Razorpay and student QR signing env vars that are missing in production.

## Stack Trace

- No stack trace is present.
- This is a handled readiness failure, not an exception crash.
- The endpoint returns a serialized diagnostic payload with `ok: false` and `status: "failed"`.

## Exact Live Evidence

The live readiness payload includes:

- `config.ok: false`
- `config.status: "failed"`
- `config.missing: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "STUDENT_QR_PRIVATE_KEY"]`
- `database.connectivity: "pass"`
- `database.status: "ok"`
- `authIntegrity.status: "ok"`

That means:

- Supabase connectivity is not the blocker.
- Auth runtime integrity is not the blocker.
- The deployment config gate is the blocker.

## Recommended Fix

1. Add valid production env vars in Vercel for:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`
   - `STUDENT_QR_PRIVATE_KEY`
2. Align `SUPABASE_URL` and `VITE_SUPABASE_URL` so they point at the same Supabase project.
3. Redeploy and recheck `GET /api/health/ready`.
4. If Razorpay is intentionally not used in this production environment, adjust `validateRuntimeConfiguration()` so the readiness gate is feature-scoped instead of always requiring Razorpay secrets.

## Application Failure Or Health-Check Failure

- Observed symptom: health-check-only failure.
- Root cause class: production config failure.
- Application routes still load, so this is not a total app outage.
- The readiness endpoint is correctly surfacing missing production dependencies before the deployment is marked healthy.

## Impact Assessment

- Scan UI: reachable
- Attendance dashboard: reachable
- Release metadata: reachable
- Readiness gate: failed

This is a deployment readiness problem, not a frontend rendering problem.

