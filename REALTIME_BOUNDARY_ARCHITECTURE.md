# Realtime Boundary Architecture

## Realtime stays on

These flows remain realtime and were not degraded in this pass:

- attendance scanning
- QR check-in and check-out
- student presence updates
- auth and login session flows
- core library dashboard operations tied to active library usage

## Realtime is paused for super admin

These surfaces now operate in snapshot mode:

- super-admin observability
- super-admin automation
- super-admin incidents guidance
- super-admin billing analytics
- super-admin analytics dashboard
- super-admin dashboard control-plane telemetry
- super-admin revenue dashboards
- super-admin settings governance refresh
- super-admin library-center realtime invalidation

## Boundary implementation

The temporary boundary is enforced in code, not by deleting architecture.

- Global switch: [lightweightMode.ts](/c:/Users/Administrator/Desktop/Libriofy/src/lib/superAdmin/lightweightMode.ts:1)
- Control-plane realtime gate: [useControlPlaneRealtime.ts](/c:/Users/Administrator/Desktop/Libriofy/src/hooks/superAdmin/useControlPlaneRealtime.ts:1)
- Library-center realtime gate: [useLibraries.ts](/c:/Users/Administrator/Desktop/Libriofy/src/hooks/superAdmin/useLibraries.ts:1)
- Lightweight UI states: [SuperAdminSnapshotNotice.tsx](/c:/Users/Administrator/Desktop/Libriofy/src/components/superAdmin/SuperAdminSnapshotNotice.tsx:1)

## Mode behavior

- Default mode for super-admin pages: manual refresh
- Optional periodic mode for selected pages: 180-second snapshots
- Admin queries: 3-minute cache stale time
- Mutation flows: still invalidate and refresh relevant admin data after operator actions

## Why this boundary is safe

- Attendance realtime code paths were not modified
- Auth code paths were not modified
- No components or routes were deleted
- The admin architecture is still present and can be re-enabled later by flipping the lightweight-mode constants

## Re-enable path

When Supabase capacity improves or paid compute is justified:

1. Turn off `SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED`
2. Restore default auto-refresh only on pages that truly need it
3. Re-enable one admin subsystem at a time
4. Monitor Supabase compute after each re-enable before restoring the next layer
