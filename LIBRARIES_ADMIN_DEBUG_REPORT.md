# Libraries Admin Debug Report

Date validated: May 19, 2026

## Root causes

1. `/api/admin/libraries` and `/api/admin/users` both called `getLibraryCenterData()`, and that path used `loadCoreAdminData()`.
   - `loadCoreAdminData()` fans out across billing, analytics, jobs, incidents, templates, payouts, dead letters, event logs, platform settings, and feature flags.
   - The Libraries page was paying for control-plane data it never rendered.
   - The page also did this twice on first load because the Users tab query ran immediately.

2. `readOptionalRows()` converted any Supabase error into `[]`.
   - Slow, blocked, or invalid reads were degraded into empty arrays instead of visible failures.
   - The UI then rendered those empty arrays as legitimate operational zeroes.

3. The page summary cards were derived from the current paginated slice.
   - `Enabled libraries`, `Controlled libraries`, and `Controlled users` were counting only the rows on the current page.
   - That made partial data look like platform-wide truth.

4. The Libraries page had no scoped realtime refresh path.
   - New libraries, attendance scans, moderation changes, and subscription updates did not invalidate the page automatically.

5. The page had dead-table behavior.
   - Empty result sets rendered as blank-looking operational tables instead of human guidance.
   - Query failures were not surfaced inline, so timeout/abort states could collapse into trust-destroying zero states.

6. The user-control builder assumed every tracked user had a profile row.
   - During live validation this threw for controlled/login-tracked users with missing profile metadata.
   - The builder now handles missing profiles safely.

## What was not the root cause

- Real data does exist in Supabase.
- Service-role reads are working.
- RLS was not the blocker on this admin path because the control-plane loader uses the service role.
- Admin auth/session enforcement was not the blocker for this Libraries incident.

## Live Supabase validation

Validated against the configured service-role environment on May 19, 2026.

Focused raw queries returned real data:

- `libraries`: rows present
- `library_subscriptions`: rows present
- `profiles`: rows present
- `user_roles`: rows present
- `login_logs`: rows present
- `attendance_logs`: rows present
- `platform_activity_logs`: rows present

Library-center result after the fix:

- `libraries`: 6
- `users`: 10
- `activityLogs`: 20
- `summary.activeLibraryCount`: 6
- `summary.trialLibraryCount`: 4
- `summary.verificationRequiredCount`: 1

Warm-path timing from the same workspace:

- first call to `getLibraryCenterData()`: `2265ms`
- second call to `getLibraryCenterData()`: `769ms`

## Fixes shipped

- Replaced the Libraries page data path with a library-focused loader in [src/lib/superAdmin/service.server.ts](src/lib/superAdmin/service.server.ts).
- Added server summary payloads for platform-level counts in [src/lib/superAdmin/types.ts](src/lib/superAdmin/types.ts) and [src/lib/superAdmin/client/types.ts](src/lib/superAdmin/client/types.ts).
- Returned summary data from the centralized API route in [src/lib/superAdmin/apiRoute.server.ts](src/lib/superAdmin/apiRoute.server.ts).
- Added scoped realtime invalidation and lazy Users-tab loading in [src/hooks/superAdmin/useLibraries.ts](src/hooks/superAdmin/useLibraries.ts).
- Added in-flight request deduplication for library-center server loads in [src/lib/superAdmin/service.server.ts](src/lib/superAdmin/service.server.ts).
- Reworked the Libraries UI to show operational statuses, human empty states, clear failures, and relative activity in [src/pages/SuperAdminLibraries.tsx](src/pages/SuperAdminLibraries.tsx).

## Remaining risks

- Search and pagination still filter over the in-memory library-center payload after it is loaded. This is acceptable for the current live size, but should move into SQL if the fleet grows materially.
- `attendance_logs` is still read up to `5000` rows to derive per-library last activity. If scan volume grows sharply, replace this with an indexed latest-activity view or `DISTINCT ON` query.
- Realtime uses debounced query invalidation, not row-level cache patching. This is deliberate for safety, but still refetches active admin queries.
