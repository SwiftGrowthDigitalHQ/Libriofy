# Analytics Data Flow

Date validated: May 19, 2026

## Dashboard

| Surface | Live source | Fallback behavior | Realtime trigger |
| --- | --- | --- | --- |
| Active Libraries | `libraries` + `library_subscriptions` + `library_control_overrides` via `getControlCenterData()` | falls back to last loaded control-plane payload; loading state says `Syncing` | `libraries`, `library_subscriptions`, `library_control_overrides` |
| Students Today | `attendance_logs` aggregated into the trailing live series | quiet-day message uses `activeStudentsYesterday` and `lastAttendanceAt` | `attendance_logs`, `platform_activity_logs` |
| Revenue This Month | approved `payments` + approved `subscription_payments` + `revenue_adjustments` | if no approved revenue exists, card explains that revenue appears after first approved transaction | `payments`, `subscription_payments` |
| Queued Jobs | `platform_job_queue` via control-plane automation summary | if empty, UI says automation queues are clear | `platform_job_queue`, `platform_job_dead_letters` |
| Health Center | `buildStatusSignals()` plus derived `Attendance` signal | degraded health still renders partial signals instead of blanking | `app_event_logs`, `login_logs`, `platform_metric_snapshots`, `attendance_logs` |
| Top Libraries | `libraries` joined to owner profiles, subscriptions, controls, and last attendance activity | if no libraries exist, page copy stays operational instead of blank | `libraries`, `profiles`, `library_subscriptions`, `attendance_logs` |
| Attention Queue | `incidents`, `security.suspiciousIps`, `automation.inactiveLibraries` from the control center | zero-state still renders as healthy/quiet operations | `app_event_logs`, `login_logs`, `attendance_logs` |

## Analytics Page

| Surface | Live source | Fallback behavior | Realtime trigger |
| --- | --- | --- | --- |
| Daily active libraries | `attendance_logs` aggregated into control-plane overview | if zero today, UI shows yesterday's activity or last scan timestamp | `attendance_logs` |
| Students today | `attendance_logs` distinct student counts | if zero today, UI shows a quiet-operations message | `attendance_logs` |
| Conversion rate | active/trial subscriptions divided by total libraries | if zero, UI says no onboarding conversions recorded yet | `library_subscriptions`, `libraries` |
| System status | control-plane `systemStatus`, driven by health signals | if analytics aggregation fails, page falls back to platform payload | `app_event_logs`, `platform_metric_snapshots`, `login_logs` |
| Revenue by city | `super_admin_revenue_by_city` from control payload | no default city filter; empty filter returns all rows; partial filter matches city or state | `payments`, `subscription_payments`, `revenue_adjustments`, `libraries` |
| Health center | merged control-plane status signals plus deployment/auth/queue overlays | deduped by label so queue/auth do not appear twice | `platform_job_queue`, `app_event_logs`, `login_logs`, release env |
| Communication | delivery health from `getCommunicationCenterData()` | falls back to derived signal data if communication center fails | `platform_broadcasts`, `communication_templates`, `app_event_logs` |
| Billing pulse | billing summary from `getBillingCenterData()` | falls back to control-plane-derived billing summary if billing center fails | `platform_invoices`, `billing_refunds`, `payments`, `subscription_payments` |
| Security pulse | control security summary plus security center details when available | quiet state says no suspicious IPs are elevated right now | `login_logs`, `platform_activity_logs`, `super_admin_audit_logs` |
| Governance flow | operator governance analytics from the security center | if governance tables are unavailable, analytics still loads without blanking the page | `super_admin_role_grants`, `super_admin_approval_requests`, `super_admin_audit_logs` |
| Operational coordination | incident analytics from `getIncidentCenterData()` | falls back to derived incident summary if incident center fails | `super_admin_event_groups`, `platform_metric_snapshots`, `app_event_logs` |
| Operational intelligence | `buildOperationalIntelligenceSnapshot()` over incidents, jobs, governance, runtime visibility, billing ops | if secondary centers fail, intelligence still builds from the control payload where possible | control center + incident/security/automation/billing centers |

## Route orchestration

### `/api/admin/platform`

- primary builder: `getControlCenterData()`
- failure model:
  - hard failure only if the control center itself fails
  - optional table failures degrade through `readOptionalRows()`

### `/api/admin/analytics`

- primary builder: `buildAnalyticsResponse()`
- execution pattern:
  - `Promise.allSettled()` over control, communication, incident, security, automation, and billing centers
  - control center is mandatory
  - all other centers degrade into derived payloads

## Realtime invalidation

Dashboard and analytics now subscribe to a shared scoped invalidation set:

- `attendance_logs`
- `libraries`
- `library_subscriptions`
- `library_control_overrides`
- `platform_account_controls`
- `platform_activity_logs`
- `platform_job_queue`
- `platform_job_dead_letters`
- `platform_metric_snapshots`
- `payments`
- `subscription_payments`
- `login_logs`
- `app_event_logs`

The invalidation is debounced by `600ms` to avoid refetch storms.
