# Super Admin Telemetry Report

Date validated: May 19, 2026

## Root causes

1. The dashboard was double-loading the control plane.
   - `SuperAdminDashboard` called both `useControlPlane()` and `useAnalytics()`.
   - That duplicated wide Supabase reads and made timeout spikes much more likely on Nano compute.

2. The analytics page hardcoded the city filter to `Patna`.
   - `useAnalytics("Patna")` and `filters.city || "Patna"` meant the revenue-by-city table could start empty even when live cities existed.
   - Live data on May 19, 2026 included `Lucknow` and `Unknown`, so the default filter hid real rows.

3. The dashboard mislabeled a daily metric as a platform metric.
   - `Active Libraries` used `latestPoint.activeLibraries`, which is "libraries with attendance today".
   - On quiet days this showed `0`, even though the platform had `6` active libraries.

4. Monthly revenue was derived from the summary series instead of live approved payment events.
   - The old card showed `10401`.
   - Live approved payment data on May 19, 2026 summed to `17401`.

5. Health checks could outrun the browser timeout window.
   - `buildStatusSignals()` used a 10s timeout budget.
   - Under partial Supabase degradation the control-plane route could exceed 20s end-to-end.

6. Health wording degraded into dead admin-template states.
   - Signals used `Unknown`, `Unavailable`, or raw degraded abort text.
   - Quiet operational periods were rendered like broken telemetry.

7. Dashboard and analytics lacked scoped realtime invalidation.
   - Live admin pages did not subscribe to the same operational tables already used by the Libraries page.

## Failed or misleading paths

- `/api/admin/platform`
  - slow end-to-end under partial Supabase timeouts
  - top-card semantics mixed daily attendance with platform totals

- `/api/admin/analytics`
  - exact-match default city filtering could hide all real city rows
  - health-center values duplicated queue/auth labels without deduping

- `src/pages/SuperAdminDashboard.tsx`
  - redundant control-plane query fanout
  - `Unavailable` fallbacks for recoverable loading/degraded states

- `src/pages/SuperAdminAnalytics.tsx`
  - dead default city filter
  - empty-state copy treated quiet operations like missing data

## Shipped fixes

- removed the redundant dashboard analytics query and now drive the page from the control-plane payload
- added shared scoped realtime invalidation for dashboard and analytics queries
- changed analytics city filtering to:
  - no default city
  - partial city/state matching
  - all live city rows when no filter is supplied
- rebuilt core overview metrics from live tables:
  - `attendance_logs`
  - `payments`
  - `subscription_payments`
  - `revenue_adjustments`
  - `libraries`
- added operational overview fields:
  - `activeLibraryCount`
  - `activeSubscriptionCount`
  - `trialLibraryCount`
  - `activeStudentsYesterday`
  - `attendanceLibrariesYesterday`
  - `approvedTransactionsThisMonth`
  - `lastAttendanceAt`
  - `lastPaymentAt`
- added an `Attendance` health signal and replaced dead `Unknown` wording with operational copy
- downgraded Redis read failures from blanket red outage signaling to honest degraded mode
- shortened health-check timeout pressure and increased browser control-plane timeout headroom

## Live validation

Direct service-role probe on May 19, 2026 after the patch:

- `getControlCenterData()` cold degraded run: `16081ms`
- `getControlCenterData()` follow-up run: `11406ms`
- active libraries: `6`
- students today: `0`
- students yesterday: `11`
- approved transactions this month: `44`
- revenue this month: `17401`
- revenue previous month: `9999`
- last attendance scan: `2026-05-18T05:41:27.245+00:00`
- system status after downgrade handling: `yellow`

## Supabase impact

- the control plane now survives partial table/view timeouts without blanking the dashboard
- analytics no longer starts with a filter that hides live city rows
- control-plane pages now invalidate from operational table changes instead of waiting on manual refresh

## Remaining issues

1. The control-plane route is still a heavy monolith.
   - It is safer now, but a future split into lighter overview and deep-dive endpoints would further reduce latency.

2. Redis connection errors are still present in the local environment.
   - The dashboard now reports this as degraded instead of broken.

3. Admin alert transports are not configured in this workspace.
   - Alert sends fail safely and do not block the dashboard.
