# Admin Systems Temporarily Disabled

This is a temporary Nano-compute protection pass for super-admin infrastructure only.

Attendance, QR scans, student presence, auth, and core library dashboard flows were not downgraded.

## Disabled or reduced

| System | Temporary change | Why | Expected IO reduction |
| --- | --- | --- | --- |
| Control-plane realtime invalidation | `src/hooks/superAdmin/useControlPlaneRealtime.ts` is gated by lightweight mode | Stops platform-wide Supabase channel fanout and cross-dashboard refetch storms | ~100% of control-plane admin realtime invalidation traffic |
| Super-admin library center realtime | `src/hooks/superAdmin/useLibraries.ts` realtime channel is gated by lightweight mode | Stops admin library/user tables from refetching on unrelated platform writes | ~100% of library-center realtime invalidation traffic |
| Super-admin observability live telemetry | `src/pages/SuperAdminObservability.tsx` now uses security/jobs/platform snapshots, not the aggregated analytics endpoint | Removes heavy live telemetry refresh pressure | ~75% fewer queries on page refresh path, ~100% default recurring refresh removal |
| Super-admin automation live recommendations | `src/pages/SuperAdminAutomation.tsx` no longer fetches aggregated analytics; recommendation widgets show lightweight-mode messaging | Removes repeated analytics recomputation and queue telemetry fanout | ~66% fewer queries on page refresh path, ~100% default recurring refresh removal |
| Super-admin incidents adaptive guidance | `src/pages/SuperAdminIncidents.tsx` drops aggregated analytics and lazily loads snapshots tab | Keeps incident workflow usable without predictive polling | ~50% fewer queries on page refresh path, snapshot tab load deferred |
| Super-admin billing live analytics | `src/pages/SuperAdminBilling.tsx` drops aggregated analytics and lazy-loads tab datasets | Removes duplicate counts and multi-tab query fanout | From 5 concurrent admin fetches down to 2-3 active fetches depending on tab |
| Super-admin settings auto-refresh | `src/pages/SuperAdminSettings.tsx` now defaults to manual refresh, optional 180s snapshots | Prevents governance/admin forms from continuously polling | ~100% default recurring refresh removal, ~83% reduction if periodic snapshots are enabled |
| Super-admin dashboard live platform updates | `src/pages/SuperAdminDashboard.tsx` now refreshes manually | Keeps executive view professional without live invalidation | ~100% realtime invalidation removal |
| Super-admin analytics live aggregation | `src/pages/SuperAdminAnalytics.tsx` now reads control-plane snapshots only | Removes the heaviest multi-center aggregate call from the analytics surface | ~100% of live analytics aggregation refreshes on that page |
| Super-admin revenue live platform updates | `src/pages/SuperAdminRevenue.tsx` now refreshes manually | Revenue dashboards are non-essential during Nano recovery | ~100% realtime invalidation removal |

## Query caching changes

Super-admin hooks now use a 3-minute stale window via:

- `src/lib/superAdmin/lightweightMode.ts`
- `src/hooks/superAdmin/useAdminQuery.ts`

This applies snapshot-style caching to:

- analytics
- automation jobs
- billing
- broadcasts
- control plane
- feature flags
- incidents
- libraries
- revenue
- security

## Re-enable later

When Nano compute is no longer constrained:

1. Flip `SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED` in [lightweightMode.ts](/c:/Users/Administrator/Desktop/Libriofy/src/lib/superAdmin/lightweightMode.ts:1)
2. Optionally restore default auto-refresh by changing `SUPER_ADMIN_DEFAULT_AUTO_REFRESH_ENABLED`
3. Reintroduce shorter stale times only after Supabase compute and real customer load justify it
