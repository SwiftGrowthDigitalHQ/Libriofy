# Vercel Function Reduction Plan

## At A Glance

- Current Count: `16`
- Target Count: `12`
- Estimated New Count: `12`
- Result: `PASS`

## Scope Notes

- This plan only covers Vercel serverless functions in `api/*.ts`.
- Supabase Edge Functions for billing, renewals, reminders, and AI growth are not part of the Vercel Hobby function cap.
- Attendance V3 must stay intact, especially:
  - `/api/attendance/scan`
  - `/api/scan-attendance`
  - `/api/device-setup`
  - `/api/device-heartbeat`
  - `/api/student-qr`

## Function Inventory

| Route | Purpose | Used? | Critical? | Merge Candidate? |
| --- | --- | --- | --- | --- |
| `/api/[...route]` | Public app maintenance endpoint for `/api/settings` | Yes. `src/lib/maintenanceClient.ts` calls it directly. | Yes. It gates the public app and maintenance mode. | No. Keep as-is. |
| `/api/_handler` | Legacy umbrella fallback for settings, health, and auth paths | No direct frontend consumer found; appears to be a legacy/server fallback entrypoint. | No for current production routing. | Yes, but only as a phase-2 cleanup. Not required to hit the Hobby limit. |
| `/api/students/[id]` | Student profile update endpoint | Yes. Student edit flows and student data mutations rely on it. | Yes. Core library management route. | No. |
| `/api/scan-attendance` | Attendance scan alias for kiosks and offline replay | Yes. Used by attendance sync fallback and legacy clients. | Yes. Attendance V3 depends on it. | Keep, but it is already logically merged with `/api/attendance/scan` in shared handler code. |
| `/api/observability/[...route]` | Observability ingest for events and alerts | Yes. Client/server observability helpers post here. | Yes for monitoring and incident response. | No. |
| `/api/device-setup` | Bind a scanner device to a library | Yes. Scanner setup flow uses it. | Yes. Required for kiosk onboarding. | No. |
| `/api/device-heartbeat` | Keep kiosk/device presence alive | Yes. Scan pages and device health flows use it. | Yes. Required for kiosk reliability. | No. |
| `/api/health/[...route]` | Health, readiness, ops, and database probes | Yes. `useDatabaseHealth` and ops tooling consume it. | Yes. Required for deploy health and runtime monitoring. | No. |
| `/api/ai/[...route]` | Partner AI helper | Yes. `PartnerAiAssistant` calls it. | No. Useful, but not core to Attendance V3. | No. |
| `/api/attendance/[...route]` | Main attendance scan handler plus integrity/debug routes | Yes. Core attendance flow and debug tooling use it. | Yes for `/api/attendance/scan`; debug routes are ops-only. | Yes for route-family consolidation, but the function itself should stay. |
| `/api/admin/[...route]` | Super-admin control plane for platform, billing, users, security, incidents, analytics, jobs, and broadcasts | Yes. Super-admin dashboards rely on it. | Yes for admin operations, but not Attendance V3. | No. |
| `/api/auth/[...route]` | Auth/session flow for OTP, email login, refresh, logout, impersonation, and Twilio callbacks | Yes. Auth pages and session hooks use it. | Yes. This is a core production surface. | Yes. This should become the single canonical auth deployment target. |
| `/api/auth/refresh` | Thin wrapper for session refresh | Yes, but redundant. The catch-all auth handler already serves `/api/auth/refresh`. | Yes functionally, but not as a separate deployment unit. | Yes. Remove this wrapper file. |
| `/api/auth/super-admin/login` | Thin wrapper for super-admin MFA start | Yes, but redundant. The catch-all auth handler already serves this route. | Yes functionally, but not as a separate deployment unit. | Yes. Remove this wrapper file. |
| `/api/auth/super-admin/verify` | Thin wrapper for super-admin MFA verify | Yes, but redundant. It shares the same resolver as the auth catch-all. | Yes functionally, but not as a separate deployment unit. | Yes. Remove this wrapper file. |
| `/api/auth/super-admin/verify-otp` | Thin wrapper / legacy alias for super-admin MFA verify | Yes, but redundant. It is another alias to the same resolver. | Yes functionally, but not as a separate deployment unit. | Yes. Remove this wrapper file. |

## Route Inventory Notes

### Critical production routes to preserve

- Attendance: `/api/attendance/scan`, `/api/scan-attendance`
- Auth: `/api/auth/*`
- Health: `/api/health/*`
- Public app: `/api/settings`
- Scanner lifecycle: `/api/device-setup`, `/api/device-heartbeat`

### Unused, duplicate, or legacy routes

- `/api/auth/super-admin/verify` and `/api/auth/super-admin/verify-otp` are duplicate aliases for the same super-admin verification resolver.
- `/api/auth/refresh`, `/api/auth/super-admin/login`, `/api/auth/super-admin/verify`, and `/api/auth/super-admin/verify-otp` are all redundant deployment wrappers because `api/auth/[...route].ts` already serves those paths.
- `/api/_handler` is a legacy umbrella file and should be treated as phase-2 cleanup only if more reduction is needed later.
- `/api/admin/settings` is already deprecated in the runtime handler and returns `410`, so it should not be considered a production route.

## Routes To Delete

Delete these four Vercel function files:

1. `api/auth/refresh.ts`
2. `api/auth/super-admin/login.ts`
3. `api/auth/super-admin/verify.ts`
4. `api/auth/super-admin/verify-otp.ts`

## Routes To Merge

The canonical merge should be:

- Keep `api/auth/[...route].ts` as the single deployment target for the auth surface.
- Preserve the existing shared resolver map in `src/lib/authApiRoute.server.ts`.
- Treat `/api/auth/super-admin/verify-otp` as a legacy alias that remains supported by the shared handler, not as a separate deployed function.

Recommended additional consolidation, if a future cleanup is desired:

- Evaluate whether `api/_handler.ts` can be removed after confirming no deployment tooling or local validation depends on it.

## Risk Analysis

- Low code risk: the four removal candidates are thin pass-through wrappers, not unique business logic.
- Low attendance risk: no attendance V3 endpoint is being removed or rewritten.
- Low auth compatibility risk: the canonical auth paths remain available through `api/auth/[...route].ts`.
- Moderate external-client risk: any hardcoded callers to the wrapper files should continue to work only if the shared auth handler is left intact, which this plan preserves.
- Operational risk is unchanged for payments because those routes live in Supabase Edge Functions, not Vercel functions.

## Final Recommendation

Proceed with deleting the four redundant auth wrapper functions first.

That reduces the Vercel function count from `16` to `12`, which clears the Hobby plan limit without breaking Attendance V3.
