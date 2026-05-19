# Admin Performance Report

Date validated: May 19, 2026

## Before

The Libraries page had two structural performance problems.

1. Duplicate wide control-plane reads
   - the page loaded both `/api/admin/libraries` and `/api/admin/users` immediately
   - both routes rebuilt the same full `getLibraryCenterData()` payload
   - the old loader depended on `loadCoreAdminData()`, which fans out into billing, payouts, invoices, jobs, dead letters, event logs, feature flags, platform settings, analytics snapshots, and more

2. Silent degradation to empty arrays
   - optional reads swallowed Supabase errors
   - operationally incomplete payloads still rendered as successful zero states

## After

The Libraries control plane now uses a dedicated library-center loader and lazy user loading.

### Shipped optimizations

- replaced the Libraries page backend read path with a focused loader
- stopped initial page load from fetching Users-tab data until that tab is opened
- deduplicated in-flight library-center server loads so concurrent Libraries and Users refetches can share one backend build
- added debounced realtime invalidation instead of polling
- moved summary counts to the server payload instead of deriving them from the current page slice
- deferred search input before query execution
- improved empty and failure states so degraded data does not masquerade as healthy zeroes

## Current measured behavior

Live service-role measurement from this workspace on May 19, 2026:

- first `getLibraryCenterData()` call after module load: `2265ms`
- second `getLibraryCenterData()` call: `769ms`

Live dataset at validation time:

- libraries: `6`
- operational users: `10`
- recent activity items: `20`

## Supabase IO profile

### Old Libraries page path

Used a full control-plane preload, including unrelated reads such as:

- `super_admin_daily_metrics`
- `super_admin_revenue_by_city`
- `revenue_adjustments`
- `library_payout_queue`
- `subscription_plans`
- `payments`
- `subscription_payments`
- `super_admin_event_groups`
- `platform_metric_snapshots`
- `platform_broadcasts`
- `communication_templates`
- `platform_invoices`
- `billing_refunds`
- `platform_job_queue`
- `super_admin_audit_logs`
- `platform_job_dead_letters`
- `app_event_logs`
- platform settings
- feature flags

### New Libraries page path

Reads only:

- `libraries`
- `library_subscriptions`
- `user_roles`
- `login_logs`
- `platform_account_controls`
- `library_control_overrides`
- `attendance_logs`
- `platform_activity_logs`
- `super_admin_impersonation_sessions`
- targeted `profiles` chunks

## Rerender and query hotspots addressed

- removed unconditional Users-tab query from first render
- reduced summary-card recomputation from paginated slice data
- added deferred search to avoid request bursts while typing
- debounced realtime invalidation to prevent duplicate refetch storms

## Residual risks

1. In-memory filtering remains in the centralized API route for this page.
   - Fine at the current live size.
   - Move search and pagination fully into SQL if the library fleet grows into the high hundreds or beyond.

2. `attendance_logs` last-activity derivation still scans up to `5000` recent rows.
   - Fine for current usage.
   - Future optimization: materialized latest-library-activity table or indexed `DISTINCT ON`.

3. Realtime uses invalidation rather than granular cache patching.
   - This is safer for correctness.
   - If admin traffic increases, row-level cache updates could further reduce IO.

## Recommended next step

If library count grows materially, split `getLibraryCenterData()` into fully query-aware list loaders so search, counts, and pagination are all pushed into SQL without changing the page contract.
