# Nano Compute Recovery Plan

## Immediate reductions applied

1. Paused super-admin realtime at the hook boundary.
   Files: [useControlPlaneRealtime.ts](/c:/Users/Administrator/Desktop/Libriofy/src/hooks/superAdmin/useControlPlaneRealtime.ts:1), [useLibraries.ts](/c:/Users/Administrator/Desktop/Libriofy/src/hooks/superAdmin/useLibraries.ts:1)

2. Moved super-admin polling from 15-30 second behavior to manual-by-default with optional 180 second snapshots.
   Files: [lightweightMode.ts](/c:/Users/Administrator/Desktop/Libriofy/src/lib/superAdmin/lightweightMode.ts:1), [SuperAdminObservability.tsx](/c:/Users/Administrator/Desktop/Libriofy/src/pages/SuperAdminObservability.tsx:1), [SuperAdminAutomation.tsx](/c:/Users/Administrator/Desktop/Libriofy/src/pages/SuperAdminAutomation.tsx:1), [SuperAdminBilling.tsx](/c:/Users/Administrator/Desktop/Libriofy/src/pages/SuperAdminBilling.tsx:1), [SuperAdminIncidents.tsx](/c:/Users/Administrator/Desktop/Libriofy/src/pages/SuperAdminIncidents.tsx:1), [SuperAdminSettings.tsx](/c:/Users/Administrator/Desktop/Libriofy/src/pages/SuperAdminSettings.tsx:1)

3. Removed the heavy aggregated analytics endpoint from multiple super-admin pages.
   Removed from: analytics dashboard variants in observability, automation, incidents, billing, analytics page

4. Added lazy loading for heavy tabbed admin data.
   Billing now loads only the active tab plus one lightweight overview query.
   Incidents now loads snapshot data only when the snapshots tab is opened.

5. Extended super-admin query cache freshness to 3 minutes.
   This reduces repeated re-fetches from remounts and tab switching.

## Estimated impact

These are engineering estimates based on request patterns changed in code, not Supabase dashboard measurements yet.

| Change | Estimated impact |
| --- | --- |
| Disable control-plane realtime invalidation | Eliminates recurring admin refetch chains triggered by writes to `attendance_logs`, `libraries`, `payments`, `login_logs`, `platform_metric_snapshots`, and related tables |
| Disable library-center realtime | Eliminates recurring admin refetch chains on `libraries`, `library_subscriptions`, `platform_activity_logs`, `attendance_logs`, and `login_logs` |
| 15s -> manual default | ~100% removal of recurring admin refresh load on idle tabs |
| 15s -> 180s optional snapshots | ~91.7% reduction versus previous 15-second loops |
| 30s -> 180s optional snapshots | ~83.3% reduction versus previous 30-second loops |
| Remove aggregated analytics from 4 operational pages | Cuts repeated multi-endpoint recomputation and duplicate dashboard counts |
| Lazy-load billing tabs | Avoids fetching invoices, refunds, payments, and plans together on every page load |
| Lazy-load incident snapshots | Avoids loading snapshot datasets until explicitly requested |

## Query optimization strategy applied

- Replaced live admin fanout with cached snapshots
- Removed duplicate control-plane subscriptions
- Removed duplicate analytics aggregation calls on multiple super-admin pages
- Reduced concurrent dashboard queries by loading only active tabs
- Increased client cache stale windows to cut repeated fetch churn
- Kept mutation invalidation intact so operator actions still refresh relevant admin data on demand

## Not changed in this emergency pass

- Attendance subscriptions
- QR scan pages
- Student presence updates
- Auth session flows
- Core library dashboard flows
- Database schema
- Supabase environment configuration

## Recommended post-deploy checks

1. Watch Supabase compute, API, and PostgREST metrics for 15-30 minutes after deploy
2. Confirm attendance scan latency remains unchanged
3. Confirm super-admin pages show lightweight-mode notices and refresh manually
4. Confirm auth/login failures decrease during load
5. If Nano is still pressured, next step should be server-side aggregation caching, not more attendance cuts
