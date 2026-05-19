# Libraries Data Flow

Date validated: May 19, 2026

## API surface

- `GET /api/admin/libraries`
  - returns `generatedAt`
  - returns paginated `libraries`
  - returns `recentActivity`
  - returns `summary`

- `GET /api/admin/users`
  - returns `generatedAt`
  - returns paginated `users`
  - returns `summary`

Both routes are served by the centralized admin API layer in [src/lib/superAdmin/apiRoute.server.ts](src/lib/superAdmin/apiRoute.server.ts).

## Library-center loader

The Libraries control plane now uses a dedicated loader in [src/lib/superAdmin/service.server.ts](src/lib/superAdmin/service.server.ts):

- `libraries`
- `library_subscriptions`
- `user_roles`
- `login_logs`
- `platform_account_controls`
- `library_control_overrides`
- `attendance_logs`
- `platform_activity_logs`
- `super_admin_impersonation_sessions`
- targeted `profiles` lookup for only relevant user ids

## Widget sources

### Enabled Libraries card

Computed from:

- `libraries.enabled`
- `library_control_overrides`

Logic:

- counts enabled libraries without an active suspend/ban control window

### Controlled Libraries card

Computed from:

- `libraries.enabled`
- `library_control_overrides`
- `library_subscriptions`

Logic:

- counts disabled libraries
- counts libraries with active suspend/ban control windows
- exposes pending and trial library sub-counts from subscription state

### Controlled Users card

Computed from:

- `platform_account_controls`
- `super_admin_impersonation_sessions`

Logic:

- unions active user controls
- session-reset states
- password-reset-required states
- live impersonation sessions

## Table sources

### Libraries table

Row fields come from:

- `libraries`
- `library_subscriptions`
- `profiles` via `libraries.owner_id -> profiles.user_id`
- `attendance_logs` for `lastActivityAt`
- `library_control_overrides`

Rendered columns:

- `Library`: name, city/state, owner
- `Status`: operational status plus payment/control badges
- `Seats`: active students, total seats, utilization
- `Revenue`: `monthly_revenue` with graceful zero-revenue fallback
- `Last Activity`: latest attendance or fallback timestamp
- `Actions`: enable/disable, moderate/clear, impersonate

### Users table

Row fields come from:

- `user_roles`
- `profiles`
- `login_logs`
- `platform_account_controls`
- `super_admin_impersonation_sessions`
- `libraries` for owner-to-library resolution

Rendered columns:

- `User`: name/email/role
- `Status`: control badge, session reset, password reset, impersonation state
- `Library`: resolved owner library or control-bound library
- `Last Login`
- `Failures`
- `Actions`: moderate, reset session, impersonate

### Recent Activity tab

Feed is merged from:

- `platform_activity_logs`
- `attendance_logs`
- `login_logs`

The merged feed is sorted newest-first and limited to 20 items.

## Search and pagination

### Libraries

Search keys:

- library name
- city
- state
- owner email
- owner name

Pagination:

- server response is paginated after filtering
- page reset happens on search change
- search input is deferred in the client before query execution

### Users

Search keys:

- email
- full name
- phone
- library name
- primary role

Optimization:

- the Users query is disabled until the Users tab is active

## Realtime dependency

Scoped realtime invalidation is managed in [src/hooks/superAdmin/useLibraries.ts](src/hooks/superAdmin/useLibraries.ts).

Subscribed tables:

- `libraries`
- `library_subscriptions`
- `library_control_overrides`
- `platform_account_controls`
- `platform_activity_logs`
- `attendance_logs`
- `login_logs`

Behavior:

- changes are debounced for `600ms`
- invalidates `admin-libraries`
- invalidates `admin-users` only when the Users tab query is active

## Action flow

Mutations still use the existing guarded control-plane paths:

- library actions -> `performLibraryActionData()`
- user actions -> `performUserActionData()`
- impersonation -> existing auth runtime flow via `startImpersonation()`

These remain protected by the existing super-admin session, IP allowlist, and operator-action guard layers.
