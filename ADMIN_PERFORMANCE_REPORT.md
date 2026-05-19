# Admin Performance Report

Date validated: May 19, 2026

## Key findings

1. The dashboard was paying for the control plane twice.
   - `SuperAdminDashboard` loaded both `/api/admin/platform` and `/api/admin/analytics`.
   - That doubled wide admin reads without adding unique dashboard data.

2. The control center was blocking too long on secondary health work.
   - status checks had a 10s timeout budget
   - under degraded Supabase conditions the route could run past the browser timeout window

3. The analytics page could hide live data behind a default city filter.
   - not a latency problem by itself, but it caused expensive loads to end in an apparently empty table

## Shipped optimizations

- removed the redundant analytics fetch from the dashboard
- made analytics load the platform fallback only when the analytics request actually fails
- added shared scoped realtime invalidation instead of periodic full refetches
- replaced hardcoded city filtering with:
  - no default city
  - partial city/state matching
- rebuilt overview metrics from raw tables already needed by the control plane
- reduced status-signal timeout pressure from `10000ms` to `4000ms`
- increased browser control-plane timeout headroom from `20000ms` to `30000ms`
- moved attendance aggregation into the main control-center fanout instead of a later extra query

## Live measurements

Service-role control-plane probe from this workspace on May 19, 2026:

- pre-hardening degraded run observed during investigation: `22622ms`
- post-timeout hardening degraded run: `16081ms`
- post-hardening follow-up run: `11406ms`

Live post-patch metrics returned by `getControlCenterData()`:

- active libraries: `6`
- students today: `0`
- students yesterday: `11`
- approved transactions this month: `44`
- revenue this month: `17401`
- system status: `yellow`

## Current IO profile

The dashboard and analytics now rely on these high-signal sources:

- `libraries`
- `library_subscriptions`
- `attendance_logs`
- `payments`
- `subscription_payments`
- `revenue_adjustments`
- `platform_job_queue`
- `platform_job_dead_letters`
- `login_logs`
- `app_event_logs`
- `platform_metric_snapshots`
- `super_admin_revenue_by_city`

The platform still reads additional governance, billing, incident, and configuration tables, but those are now better isolated behind graceful degradation.

## Rerender and refetch hotspots addressed

- removed duplicate dashboard query fanout
- added debounced realtime invalidation at `600ms`
- stopped analytics fallback platform reads unless analytics actually errors
- used deferred city input on the analytics page to avoid firing a request on every keystroke

## Remaining risks

1. `/api/admin/platform` is still a wide aggregation route.
   - It is safer now, but it remains the main candidate for future endpoint splitting.

2. Some optional Supabase reads still hit the server fetch timeout and degrade to empty arrays.
   - The dashboard survives this now.
   - It still means deep secondary sections can be partially incomplete on a bad minute.

3. Redis is degraded in this local environment.
   - The UI now reports this as degraded instead of unavailable.
   - Connection refusal still exists outside the UI path.

## Recommended next step

Split the control-plane monolith into:

- a lightweight dashboard overview route
- a separate health route
- deeper per-center detail routes

That would reduce first-paint latency further without changing the operator-facing behavior shipped here.
