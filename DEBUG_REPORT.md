# 🐞 Full Project Debug Report

## 🔴 Critical Issues
- [File: src/pages/AttendancePage.tsx:143]
  Problem: The manual attendance page calls `supabase.rpc("qr_check_in", ...)` directly from the browser.
  Cause: The active page path sends only browser-side RPC args (`p_student_id`/`p_qr_code` + `p_library_id`) at `src/pages/AttendancePage.tsx:96-115` and `src/pages/AttendancePage.tsx:143-146`, but the hardened database policy revoked `authenticated` access to both legacy and modern `qr_check_in` signatures in `supabase/migrations/20260401170000_secure_attendance_data_lock.sql:846-856`. The secured scan flow now runs through the service-role-backed scanner path in `src/lib/scanAttendance.server.ts:303-319` and `src/lib/scanAttendance.server.ts:603-629`.
  Impact: Dashboard-based check-in/check-out can fail at runtime for signed-in staff even while kiosk scanning still works, creating a broken and inconsistent attendance experience.
  Suggested Fix (DO NOT APPLY): Route the dashboard attendance action through the same server/Edge scan handler used by the kiosk, or explicitly re-design and re-authorize a browser-safe attendance RPC contract.

- [File: supabase/functions/process-renewals/index.ts:729]
  Problem: Library-scoped renewal processing can trigger locker renewal work across all libraries.
  Cause: The request is scoped with `libraryId` at `supabase/functions/process-renewals/index.ts:710-721`, but the locker branch calls `supabase.rpc("process_locker_renewals")` with no library argument at `supabase/functions/process-renewals/index.ts:729-731`. The SQL function itself is zero-argument in `supabase/migrations/20260313120000_locker_management_system.sql:489`.
  Impact: A user running renewals for one library can unintentionally generate locker-renewal side effects, reminders, and operational churn for other libraries.
  Suggested Fix (DO NOT APPLY): Add a library-scoped locker renewal function/API contract and pass the validated `libraryId` through end-to-end before any mutation runs.

- [File: src/lib/studentQr.server.ts:214]
  Problem: The student QR signing backend accepts a private signing key from a `VITE_`-prefixed environment variable.
  Cause: `readEnv(env, "STUDENT_QR_PRIVATE_KEY", "QR_SIGNING_PRIVATE_KEY", "VITE_QR_PRIVATE_KEY")` in `src/lib/studentQr.server.ts:214` allows a server-only secret to be sourced from a client-exposed namespace. `VITE_` variables are intended for browser bundles.
  Impact: If anyone configures `VITE_QR_PRIVATE_KEY`, the private key used to sign student IDs can leak to the client bundle, allowing forged signed QR payloads and trust bypass of the ID system.
  Suggested Fix (DO NOT APPLY): Remove all `VITE_` fallbacks for private keys and require a server-only variable such as `STUDENT_QR_PRIVATE_KEY` or `QR_SIGNING_PRIVATE_KEY`.

- [File: src/lib/requestAuth.server.ts:37]
  Problem: Multiple server-side privileged flows accept the Supabase service-role key from a `VITE_`-prefixed variable.
  Cause: `src/lib/requestAuth.server.ts:38-45`, `src/lib/scanAttendance.server.ts:279-286`, `src/lib/deviceSetup.server.ts:86-96`, and `server/vercelHandler.ts:132-140` all allow `VITE_SUPABASE_SERVICE_ROLE_KEY` as a fallback.
  Impact: A misconfigured deployment can expose full-database service-role credentials to the browser build, turning a config mistake into a complete privilege-escalation incident.
  Suggested Fix (DO NOT APPLY): Remove `VITE_SUPABASE_SERVICE_ROLE_KEY` from every server helper and fail fast unless a server-only `SUPABASE_SERVICE_ROLE_KEY` is present.

## 🟠 Major Issues
- [File: src/api/students.ts:56]
  Problem: The student dashboard is wired to HTTP endpoints that are not implemented in the checked-in backend.
  Cause: The client targets `/students` and `/students/:id/mark-paid` at `src/api/students.ts:56`, `src/api/students.ts:477-485`, and `src/api/students.ts:572-574`, but the registered Express routes in `server/index.ts:285-489` cover auth, settings, attendance, device setup, device heartbeat, and student QR only. No matching students route exists in the audited backend files.
  Impact: The advertised API-backed student list and payment action 404 at runtime, then silently degrade into fallback mode instead of using a real backend contract.
  Suggested Fix (DO NOT APPLY): Either implement the missing students endpoints or delete the dead HTTP path and make the Supabase path the single explicit source of truth.

- [File: src/pages/SetupDevicePage.tsx:94]
  Problem: Device setup depends on a browser RPC path that is not reproducible from the repository migrations.
  Cause: The page calls `supabase.rpc("validate_and_bind_scanner_device", ...)` at `src/pages/SetupDevicePage.tsx:94-97`. The generated client types assume that function exists at `src/integrations/supabase/types.ts:3312-3317`, but no `CREATE FUNCTION validate_and_bind_scanner_device` statement exists in the audited `supabase/migrations` or `supabase/manual` SQL. At the same time, a separate server route already exists at `server/index.ts:454-461`.
  Impact: Fresh environments rebuilt from repo migrations can break kiosk/device setup even though the app appears to have a supported `/api/device-setup` backend path.
  Suggested Fix (DO NOT APPLY): Pick one supported setup path, check it into migrations/tests, and remove the duplicate path that is not source-controlled.

- [File: src/lib/maintenanceClient.ts:49]
  Problem: Maintenance-mode detection is hardcoded to same-origin `/api/settings` and suppresses database fallback on several failure modes.
  Cause: The client always fetches `new URL("/api/settings", window.location.origin)` at `src/lib/maintenanceClient.ts:49-56`, ignores any separate API host, and returns `allowDatabaseFallback: false` for HTML responses (`src/lib/maintenanceClient.ts:65-70`) and caught network errors (`src/lib/maintenanceClient.ts:78-82`).
  Impact: In split-origin deployments or partial outages, the app can incorrectly report maintenance as off and continue rendering screens that should be blocked.
  Suggested Fix (DO NOT APPLY): Resolve the settings endpoint from the actual API base configuration and allow a safe fallback path when the HTTP check fails or lands on an HTML shell.

- [File: src/api/students.ts:359]
  Problem: The student-list fallback is not truly paginated and will degrade badly on large libraries.
  Cause: `fetchStudentsPageFromSupabase()` loads all matching students plus all plans and all payments for the library at `src/api/students.ts:359-367`, derives summaries in memory, and only slices the requested page at `src/api/students.ts:417-422`.
  Impact: Larger libraries pay the full network and compute cost for every page/filter change, which will surface as slow dashboards, high memory usage, and unnecessary Supabase load.
  Suggested Fix (DO NOT APPLY): Move filtering, aggregation, and pagination into database-side queries/RPCs so only one page of data is transferred to the client.

## 🟡 Minor Issues
- [File: .env.example:5]
  Problem: The example environment file contradicts its own same-origin auth guidance.
  Cause: The comment says to leave `VITE_AUTH_API_BASE` empty for same-origin auth at `.env.example:5-6`, but the example immediately sets `VITE_AUTH_API_BASE` and other remote API URLs at `.env.example:9-13`.
  Impact: New environments are easy to misconfigure into cross-origin auth/session behavior that does not match local assumptions.
  Suggested Fix (DO NOT APPLY): Provide one true same-origin example and a clearly separated cross-origin example instead of mixing both in the default sample.

- [File: src/api/students.ts:111]
  Problem: A single transient HTTP failure permanently downgrades the student dashboard into fallback mode for the life of the browser tab.
  Cause: `shouldBypassStudentsHttpRoute` is a module-level mutable flag at `src/api/students.ts:111`; once a fetch fails, both `fetchStudentsPage()` and `markStudentPaid()` set it to `true` at `src/api/students.ts:550-557` and `src/api/students.ts:570-579` with no retry-reset path.
  Impact: Brief outages or one malformed response can leave a user stuck in degraded behavior until they reload the app.
  Suggested Fix (DO NOT APPLY): Replace the permanent latch with bounded retries, timed re-probing, or explicit health-state management.

## 🔍 Suspicious Areas (Need Review)
- [File: src/hooks/useAuth.tsx:356]
  Problem: The active email/password login path no longer matches the custom auth API flow documented elsewhere in the repo.
  Cause: `signIn()` now calls `supabaseAuth.auth.signInWithPassword(...)` directly at `src/hooks/useAuth.tsx:356-389`, while the custom API client still exposes `loginWithEmail()` in `src/lib/authApi.ts:99-115` and the server still serves `/api/auth/login-email` in `server/index.ts:386-392`. The checked-in diagnosis document still claims `signIn()` uses `loginWithEmail()` at `PASSWORD_LOGIN_FAILURE_DIAGNOSIS.md:17-20`.
  Impact: Debugging, incident response, and future fixes can target the wrong execution path because the code, API surface, and internal documentation have drifted apart.
  Suggested Fix (DO NOT APPLY): Decide which login architecture is authoritative, remove dead paths, and rewrite the docs/tests around the real flow.

- [File: src/lib/scanAttendance.server.ts:271]
  Problem: The secured attendance logic exists in two separate implementations that are easy to drift apart.
  Cause: The server implementation in `src/lib/scanAttendance.server.ts:271-640` and the Edge Function implementation in `supabase/functions/scan-attendance/index.ts:251-664` both parse the same payload, enforce similar device/library checks, and run similar RPC fallback logic.
  Impact: Future fixes can land in one scan path while the other silently diverges, causing environment-specific bugs that are difficult to reproduce.
  Suggested Fix (DO NOT APPLY): Consolidate shared scan validation/decision logic into one source of truth or add parity tests that exercise both paths with the same fixtures.

## 📊 Summary
- Total Bugs: 10
- Critical: 4
- Major: 4
- Minor: 2
