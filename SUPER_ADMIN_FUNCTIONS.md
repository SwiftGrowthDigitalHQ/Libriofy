# Super Admin Functions — Complete System Documentation

> Generated: May 2026 | Project: Libriofy Control Plane
> Covers: All Super Admin pages, APIs, services, RBAC, security, and infrastructure modules.

---

## Table of Contents

1. [Authentication & Security System](#1-authentication--security-system)
2. [Control Plane Dashboard](#2-control-plane-dashboard)
3. [Library Fleet Management](#3-library-fleet-management)
4. [Revenue Operations](#4-revenue-operations)
5. [Billing Operations](#5-billing-operations)
6. [Incident Management](#6-incident-management)
7. [Analytics & Intelligence](#7-analytics--intelligence)
8. [Broadcast & Communication](#8-broadcast--communication)
9. [Automation & Queue Management](#9-automation--queue-management)
10. [Feature Flags](#10-feature-flags)
11. [Observability & Monitoring](#11-observability--monitoring)
12. [Platform Settings & Configuration](#12-platform-settings--configuration)
13. [RBAC & Operator Governance](#13-rbac--operator-governance)
14. [Impersonation System](#14-impersonation-system)
15. [Maintenance Mode](#15-maintenance-mode)
16. [Additional Admin Pages](#16-additional-admin-pages)
17. [Database Tables](#17-database-tables)
18. [API Route Map](#18-api-route-map)
19. [Risks & Issues](#19-risks--issues)
20. [Production Readiness](#20-production-readiness)

---

## 1. Authentication & Security System

### 1.1 Super Admin Login (OTP-based)

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminLoginPage.tsx` |
| Route | `/super-admin-login` |
| API (Step 1) | `POST /api/auth/super-admin/login` |
| API (Step 2) | `POST /api/auth/super-admin/verify` or `/verify-otp` |
| Backend | `src/lib/otpAuth.server.ts` → `resolveSuperAdminLoginRequest`, `resolveSuperAdminVerifyOtpRequest` |
| DB Tables | `auth.users`, `public.user_roles`, `public.auth_trusted_devices` |
| Redis Keys | `super_admin_otp:{email}`, `auth:rate:super-admin-*`, `auth:super-admin:fail:*`, `auth:super-admin:block:*` |

**Flow:**
1. User enters email → backend validates against `SUPER_ADMIN_ALLOWED_EMAILS` env var
2. Backend queries `user_roles` table for `super_admin` role
3. 6-digit OTP generated, hashed with bcrypt, stored in Redis (5min TTL)
4. OTP sent via Resend email (or logged to console in dev)
5. User submits OTP → backend verifies via bcrypt compare
6. On success: session inserted into `auth_trusted_devices`, JWT minted (HS256, 15min), refresh token cookie set (`libriofy_refresh`, HttpOnly, SameSite=Lax)
7. Frontend stores `ClientAuthSession` in sessionStorage, sets up auto-refresh timer

**Security Controls:**
- Rate limiting: 1 OTP request per 60s per email/IP
- Max 5 failed OTP attempts → 15min block
- Device fingerprint validation (optional)
- IP-based rate limiting on verify (10 attempts per 10min)
- Origin validation (only libriofy.com or localhost in dev)

### 1.2 Session Management

| Attribute | Detail |
|-----------|--------|
| JWT TTL | 15 minutes (access token) |
| Refresh Token | Stored as SHA-256 hash in `auth_trusted_devices` |
| Cookie | `libriofy_refresh`, HttpOnly, SameSite=Lax, Path=/ |
| Idle Timeout | 30 minutes for super admin sessions |
| Auto-refresh | 60 seconds before expiry |
| Refresh API | `POST /api/auth/refresh` |

**Refresh Flow:**
1. Frontend timer fires 60s before JWT expiry
2. Calls `/api/auth/refresh` with cookie
3. Backend validates refresh token hash, checks device fingerprint
4. Rotates refresh token, mints new JWT
5. Returns new session + updated cookie

### 1.3 Logout

| Attribute | Detail |
|-----------|--------|
| Single device | `POST /api/auth/logout` — revokes current refresh token |
| All devices | `POST /api/auth/logout-all` — revokes all user sessions |
| Frontend | Clears sessionStorage, Supabase session, activity timestamp |

### 1.4 Protected Route Logic

| Component | `src/components/auth/ProtectedRoute.tsx` |
|-----------|------------------------------------------|
| Verification | `isVerifiedSuperAdminSession()` checks: `authLevel >= 2`, `sessionScope === "super_admin"`, user has `super_admin` role |
| Redirect | Unauthenticated → `/super-admin-login` |
| Role check | `allowRoles={["super_admin"]}` on all admin routes |

### 1.5 Auth Persistence

- Session stored in `sessionStorage` (key: `libriofy.auth.session`)
- On page load: attempts Supabase session restore, then custom refresh
- Cross-tab activity sync via `localStorage` (`libriofy.auth.last-activity`)
- Idle timeout tracked per-tab with activity listeners (keydown, mousedown, mousemove, touchstart, focus)

---

## 2. Control Plane Dashboard

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminDashboard.tsx` |
| Route | `/super-admin-dashboard` |
| API | `GET /api/admin/platform` |
| Hook | `useControlPlane()`, `useAnalytics()` |

### Functions:

| Function | Description |
|----------|-------------|
| Platform Stats | Active libraries, students today, revenue this month, queued jobs |
| Revenue Chart | Monthly + daily revenue with previous-month comparison |
| Health Center | System status signals (DB, Redis, queues, API latency) |
| Release Operations | Release health score, schema readiness, rollout progress, rollback status |
| Release Evolution | Active releases, tenant rollout, canary lifecycle, guardrails |
| Compatibility Matrix | Contract compatibility checks across services |
| Incident Groups | Recent grouped incidents with severity badges |
| Flag Rollouts | Feature flag status and rollout percentages |
| Top Libraries | Ranked by monthly revenue and active students |
| Attention Queue | Critical incidents, suspicious IPs, inactive libraries |

**Permissions Required:** `dashboard.read`

---

## 3. Library Fleet Management

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminLibraries.tsx` |
| Route | `/admin/libraries` |
| API | `GET /api/admin/libraries`, `POST /api/admin/libraries` |
| Hook | `useLibraries()` |
| DB Tables | `libraries`, `user_roles`, `auth_trusted_devices`, `profiles` |

### Functions:

| Function | Action | Description |
|----------|--------|-------------|
| View Libraries | GET | Paginated list with search, status badges |
| Enable Library | `enable` | Activates a disabled library |
| Disable Library | `disable` | Temporarily disables library access |
| Suspend Library | `suspend` | Suspends with optional time limit |
| Ban Library | `ban` | Permanently bans library |
| Clear Control | `clear_control` | Removes suspend/ban status |
| Force Logout All | `force_logout_all` | Revokes all sessions for library users |
| Reset Account | `reset_account` | Full account reset |
| Impersonate Admin | `impersonate_admin` | Start impersonation session as library owner |
| View Users | GET | List users with roles and status |
| Force Logout User | `force_logout` | Revoke specific user sessions |
| Suspend User | `suspend` | Suspend user account |
| Ban User | `ban` | Ban user account |
| Reset Password | `reset_password` | Force password reset |
| Clear Sessions | `clear_sessions` | Clear all user sessions |

**Permissions Required:** `libraries.read`, `libraries.manage`, `users.manage`, `impersonation.manage`

---

## 4. Revenue Operations

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminRevenue.tsx` |
| Route | `/admin/revenue` |
| API | `GET /api/admin/revenue`, `POST /api/admin/revenue` |
| Hook | `useRevenue()`, `useRevenueMutations()` |
| DB Tables | `subscription_payments`, `payout_requests`, `revenue_adjustments`, `subscription_plans`, `library_commissions` |

### Functions:

| Function | Action | Description |
|----------|--------|-------------|
| Revenue Overview | GET | Total revenue, MRR, ARR, growth metrics |
| Payout Management | GET | List pending/approved/paid payouts |
| Approve Payout | `approve_payout` | Approve a library payout request |
| Reject Payout | `reject_payout` | Reject with reason |
| Mark Payout Paid | `mark_payout_paid` | Confirm payout disbursement |
| Revenue Adjustments | `revenue_adjustment` | Manual credit/debit with reason |
| Commission Management | `commission_update` | Set per-library or default commission % |
| Payment History | GET | All subscription payments with filters |
| Subscription Plans | GET | View all plans |
| Revenue Chart | — | Daily/monthly revenue visualization |

**Permissions Required:** `revenue.read`, `revenue.manage`, `payouts.manage`

---

## 5. Billing Operations

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminBilling.tsx` |
| Route | `/admin/billing` |
| API | `GET /api/admin/billing`, `POST /api/admin/billing` |
| Hook | `useBilling()`, `useBillingMutations()`, `useBillingDownload()` |
| DB Tables | `invoices`, `subscription_payments`, `subscription_plans`, `refunds` |

### Functions:

| Function | Action | Description |
|----------|--------|-------------|
| Billing Overview | GET | Revenue summary, outstanding invoices, plan distribution |
| Payment List | GET | Paginated payments with search, status filter |
| Create Invoice | `create_invoice` | Generate invoice for a library |
| Process Refund | `process_refund` | Issue refund with amount and reason |
| Plan CRUD | `upsert_plan` / `delete_plan` | Create/update/delete subscription plans |
| Invoice PDF | GET (format=pdf) | Generate and download invoice PDF |
| CSV Export | GET (format=csv) | Export billing data as CSV |
| Duplicate Detection | — | Identifies potential duplicate payments |
| Payment Reconciliation | — | Cross-references payment records |

**Permissions Required:** `billing.read`, `billing.manage`

---

## 6. Incident Management

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminIncidents.tsx` |
| Route | `/admin/incidents` |
| API | `GET /api/admin/incidents`, `POST /api/admin/incidents` |
| Hook | `useIncidents()`, `useResolveIncident()` |
| DB Tables | `platform_events` (incident source), in-memory grouping |

### Functions:

| Function | Action | Description |
|----------|--------|-------------|
| Incident List | GET | Grouped incidents with severity, count, SLA tracking |
| Acknowledge | `incident_acknowledge` | Mark incident as seen |
| Assign | `incident_assign` | Assign to operator |
| Escalate | `incident_escalate` | Increase severity/escalation level |
| Add Note | `incident_note` | Attach investigation notes |
| Resolve | `incident_resolve` | Close incident with resolution |
| Retry | `incident_retry` | Retry failed operation that caused incident |
| Severity Approve | `incident_severity_approve` | Approve severity change (governance) |
| Auto-resolve Stale | — | Resolve incidents older than 24h threshold |
| SLA Tracking | — | Time-to-acknowledge, time-to-resolve metrics |

**Workflow States:** new → acknowledged → escalated → resolved

**Permissions Required:** `incidents.read`, `incidents.manage`, `incidents.severity_approve`

---

## 7. Analytics & Intelligence

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminAnalytics.tsx` |
| Route | `/admin/analytics` |
| API | `GET /api/admin/analytics` |
| Hook | `useAnalytics()` |
| Service | `src/lib/superAdmin/operationalIntelligence.ts` |

### Functions:

| Function | Description |
|----------|-------------|
| Platform Metrics | Active libraries, students, revenue, conversion rates |
| Health Center | System component health signals |
| Operational Intelligence | AI-driven predictions and recommendations |
| Remediation Plans | Automated fix suggestions for detected issues |
| Trend Analysis | Revenue growth, churn, engagement trends |
| Incident Analytics | Critical/warning/info incident counts |

**Permissions Required:** `analytics.read`

---

## 8. Broadcast & Communication

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminBroadcasts.tsx` |
| Route | `/admin/broadcasts` |
| API | `GET /api/admin/broadcasts`, `POST /api/admin/broadcasts` |
| Hook | `useBroadcasts()`, `useBroadcastMutations()` |
| DB Tables | `broadcasts`, `broadcast_templates` |

### Functions:

| Function | Action | Description |
|----------|--------|-------------|
| Broadcast List | GET | All sent broadcasts with delivery stats |
| Create Broadcast | `create_broadcast` | Send to audience via channel |
| Template List | GET | Reusable message templates |
| Create/Update Template | `upsert_template` | CRUD for templates |
| Delete Template | `delete_template` | Remove template |
| Delivery Health | — | Open rates, delivery success metrics |

**Channels:** `email`, `in_app`, `whatsapp`, `telegram`

**Audiences:** `all_libraries`, custom segments

**Permissions Required:** `broadcasts.read`, `broadcasts.manage`

---

## 9. Automation & Queue Management

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminAutomation.tsx` |
| Route | `/admin/automation` |
| API | `GET /api/admin/jobs`, `POST /api/admin/jobs` |
| Hook | `useAutomationJobs()`, `useAutomationJobMutation()` |
| Backend | BullMQ queues via Redis |
| DB Tables | Queue state in Redis, job logs in `platform_events` |

### Functions:

| Function | Action | Description |
|----------|--------|-------------|
| Job Queue View | GET | Active, waiting, completed, failed jobs |
| Enqueue Job | `job_enqueue` | Manually add job to queue |
| Retry Job | `job_retry` | Retry a failed job |
| Cancel Job | `queue_cancel` | Cancel a queued job |
| Run Due Jobs | `run_due_jobs` | Trigger all due scheduled jobs |
| Dead Letter Queue | GET | Failed jobs that exceeded retries |
| Dead Letter Replay | `dead_letter_replay` | Replay dead-lettered jobs |
| Remediation Planner | — | AI-suggested fixes for failed jobs |
| Recommendation Engine | — | Optimization suggestions |
| Related Incidents | — | Link jobs to incident groups |

**Permissions Required:** `automation.read`, `automation.manage`

---

## 10. Feature Flags

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminFeatureFlags.tsx` |
| Route | `/admin/feature-flags` |
| API | `GET /api/admin/feature-flags`, `POST /api/admin/feature-flags` |
| Hook | `useFeatureFlags()` |
| DB Tables | `feature_flags` |

### Functions:

| Function | Action | Description |
|----------|--------|-------------|
| Flag Registry | GET | All flags with status, rollout %, config |
| Toggle Flag | `feature_flag_update` | Enable/disable a flag |
| Set Rollout % | `feature_flag_update` | Gradual rollout percentage |
| Update Config | `feature_flag_update` | JSON configuration per flag |
| Emergency Kill Switch | — | Instant disable for critical flags |
| Rollout Governance | — | Stage-based rollout (canary → staged → full) |
| Variant Support | — | A/B test variants per flag |

**Permissions Required:** `feature_flags.read`, `feature_flags.manage`

---

## 11. Observability & Monitoring

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminObservability.tsx` |
| Route | `/admin/observability` |
| API | `GET /api/admin/analytics`, `GET /api/admin/jobs`, `GET /api/admin/platform` |
| Hook | `useAnalytics()`, `useAutomationJobs()`, `useControlPlane()`, `useSecurity()` |
| Backend | `src/lib/observability/` (33 files) |

### Functions:

| Function | Description |
|----------|-------------|
| Queue Lag Monitor | Real-time queue depth and processing lag |
| API Latency | Request latency percentiles |
| Payment Retry Rate | Failed payment retry success metrics |
| Redis Health | Connection status, memory, command latency |
| Trace Console | Live event stream with filtering |
| Trace Detail | Full event metadata, correlation IDs |
| Alert Feed | Active alerts with severity |
| Slow Requests | Requests exceeding latency thresholds |
| Operator Timeline | Audit trail of operator actions |
| Release Health | Current release stability metrics |
| Auto-refresh | 15-second polling interval |

**Permissions Required:** `observability.read`

---

## 12. Platform Settings & Configuration

| Attribute | Detail |
|-----------|--------|
| Page | `src/pages/SuperAdminSettings.tsx` |
| Route | `/admin/settings` |
| API | `GET /api/admin/security`, `POST /api/admin/security` |
| Hook | `useControlPlane()`, `useSecurity()`, `useSecurityMutation()`, `useAdminMutation()` |
| DB Tables | `platform_settings`, `operator_role_grants` |

### Functions:

| Function | Action | Description |
|----------|--------|-------------|
| Maintenance Mode | `update_platform_settings` | Toggle platform-wide maintenance |
| Queue Processing | `update_platform_settings` | Enable/disable background job processing |
| Billing Mutations | `update_platform_settings` | Enable/disable billing write operations |
| Automation Toggles | `update_platform_settings` | Control automation subsystems |
| IP Whitelist | `update_ip_whitelist` | Manage allowed IPs for admin access |
| Operator Role Grants | `assign_operator_role` | Grant roles to operators |
| Role Revocation | `revoke_operator_role` | Remove operator access |
| Governance Approvals | `governance_approval` | Approve/reject governance requests |
| Emergency Controls | `emergency_control` | Emergency override toggles |
| Governance Toggle | `governance_toggle` | Enable/disable governance enforcement |

**Permissions Required:** `settings.read`, `settings.manage`, `access.read`, `access.manage`, `governance.approve`, `governance.override`, `emergency.manage`

---

## 13. RBAC & Operator Governance

| Source | `src/lib/superAdmin/governance.ts`, `governanceRuntime.ts` |
|--------|-------------------------------------------------------------|

### Operator Roles (7 levels):

| Role | Description | Access Level |
|------|-------------|--------------|
| `super_admin` | Full platform access | All permissions |
| `platform_admin` | Platform management without emergency | Most permissions |
| `emergency_ops` | Emergency response only | Emergency + incidents |
| `incident_ops` | Incident management | Incidents + observability |
| `billing_ops` | Billing and revenue | Billing + revenue |
| `support_ops` | Customer support | Libraries + users |
| `read_only_ops` | View-only access | All *.read permissions |

### Permissions (28 total):

| Category | Permissions |
|----------|-------------|
| Dashboard | `dashboard.read` |
| Libraries | `libraries.read`, `libraries.manage` |
| Users | `users.manage` |
| Revenue | `revenue.read`, `revenue.manage`, `payouts.manage` |
| Billing | `billing.read`, `billing.manage` |
| Incidents | `incidents.read`, `incidents.manage`, `incidents.severity_approve` |
| Analytics | `analytics.read` |
| Broadcasts | `broadcasts.read`, `broadcasts.manage` |
| Automation | `automation.read`, `automation.manage` |
| Feature Flags | `feature_flags.read`, `feature_flags.manage` |
| Observability | `observability.read` |
| Settings | `settings.read`, `settings.manage` |
| Access | `access.read`, `access.manage` |
| Governance | `governance.approve`, `governance.override` |
| Emergency | `emergency.manage` |
| Impersonation | `impersonation.manage` |

### Governed Actions (31 total):

Actions require confirmation, cooldowns, and optionally governance approval:
- `governance_toggle`, `emergency_control`, `feature_flag_update`
- `library_control`, `user_control`, `session_clear`, `password_reset`
- `revenue_adjustment`, `commission_override`, `payout_override`
- `invoice_create`, `refund_process`
- `incident_acknowledge/assign/escalate/note/resolve/retry/severity_approve`
- `job_enqueue`, `job_retry`, `dead_letter_replay`, `queue_cancel`, `run_due_jobs`
- `broadcast_manage`, `impersonation_start`
- `role_assignment`, `role_revocation`, `temporary_access_grant`
- `governance_approval`, `governance_override`

### Grant Modes:

| Mode | Description |
|------|-------------|
| `direct` | Permanent role assignment |
| `temporary` | Time-limited access with expiry |
| `elevated` | Temporarily elevated permissions |
| `emergency_override` | Emergency bypass of normal governance |
| `legacy_migrated` | Migrated from old system |

### Scope Boundaries:

Roles can be scoped to: `global`, `platform`, `tenant`, `organization`, `department`, `team`, `operational_group`, `region`, `governance_domain`, `library`, `user`, `billing`, `incident`, `queue`, `job`, `feature_flag`, `approval_request`

### Approval Policies:

| Mode | Description |
|------|-------------|
| `single` | One approver required |
| `quorum` | Multiple approvers (majority) |
| `chained` | Sequential approval chain |
| `emergency_bypass` | Skip approval in emergencies |

---

## 14. Impersonation System

| Attribute | Detail |
|-----------|--------|
| API Start | `POST /api/auth/impersonation/start` |
| API Stop | `POST /api/auth/impersonation/stop` |
| API Audit | `POST /api/auth/impersonation/audit` |
| Backend | `resolveStartImpersonationRequest`, `resolveStopImpersonationRequest` |
| UI | `ImpersonationBanner` component shown during active impersonation |

### Functions:

| Function | Description |
|----------|-------------|
| Start Impersonation | Assume identity of library owner/user |
| Stop Impersonation | Return to super admin session |
| Audit Trail | Log all actions during impersonation |
| Session Scope | `impersonation` scope with 2min access token, 30min session |
| Banner | Visual indicator showing impersonation is active |
| Restrictions | Cannot logout-all while impersonating |

**Permissions Required:** `impersonation.manage`

---

## 15. Maintenance Mode

| Attribute | Detail |
|-----------|--------|
| Files | `src/lib/maintenance.ts`, `maintenance.server.ts`, `maintenanceGuard.server.ts` |
| UI Gate | `src/components/maintenance/MaintenanceGate.tsx` |
| API | `GET /api/settings` |
| Toggle | Via platform settings in admin panel |

### Functions:

| Function | Description |
|----------|-------------|
| Enable/Disable | Toggle via admin settings |
| Bypass Rules | Super admins always bypass maintenance |
| Request Guard | Server middleware blocks non-admin requests |
| Client Gate | Frontend shows maintenance page to regular users |
| Status API | `/api/settings` returns current maintenance state |

---

## 16. Additional Admin Pages

### 16.1 Subscriptions (`/admin/subscriptions`)
- Page: `src/pages/SuperAdminSubscriptions.tsx`
- Subscription plan management and subscriber overview

### 16.2 Partners (`/admin/partners`)
- Page: `src/pages/SuperAdminPartners.tsx`
- Partner program management, affiliate tracking

### 16.3 Leads (`/admin/leads`)
- Page: `src/pages/SuperAdminLeads.tsx`
- Lead pipeline management

### 16.4 Payouts (`/admin/payouts`)
- Page: `src/pages/SuperAdminPayouts.tsx`
- Dedicated payout management interface

### 16.5 Notifications (`/admin/notifications`)
- Page: `src/pages/SuperAdminNotifications.tsx`
- System notification management

### 16.6 Domains (`/admin/domains`)
- Page: `src/pages/SuperAdminDomains.tsx`
- Custom domain management for libraries

### 16.7 Settings (`/admin/settings`)
- Page: `src/pages/SuperAdminSettings.tsx`
- Full platform configuration (see Section 12)

---

## 17. Database Tables

| Table | Purpose |
|-------|---------|
| `auth.users` | Supabase auth users |
| `public.user_roles` | Role assignments (user_id, role) |
| `public.auth_trusted_devices` | Session storage (refresh tokens, device info) |
| `public.libraries` | Library records |
| `public.profiles` | User profiles |
| `public.subscription_payments` | Payment records |
| `public.subscription_plans` | Plan definitions |
| `public.payout_requests` | Library payout requests |
| `public.revenue_adjustments` | Manual revenue adjustments |
| `public.library_commissions` | Per-library commission rates |
| `public.invoices` | Generated invoices |
| `public.refunds` | Refund records |
| `public.feature_flags` | Feature flag definitions |
| `public.broadcasts` | Sent broadcasts |
| `public.broadcast_templates` | Message templates |
| `public.platform_events` | Event log (incidents, audit) |
| `public.platform_settings` | Platform configuration |
| `public.operator_role_grants` | RBAC role grants |
| `public.impersonation_sessions` | Impersonation audit trail |

**Redis Keys:**
- `super_admin_otp:{email}` — OTP challenge storage
- `auth:rate:*` — Rate limiting counters
- `auth:super-admin:fail:*` — Failed attempt tracking
- `auth:super-admin:block:*` — Block status
- BullMQ queues — Background job processing

---

## 18. API Route Map

### Auth Routes (`/api/auth/`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/super-admin/login` | Send OTP to super admin email |
| POST | `/api/auth/super-admin/verify` | Verify OTP and create session |
| POST | `/api/auth/super-admin/verify-otp` | Alias for verify |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/logout` | Logout current device |
| POST | `/api/auth/logout-all` | Logout all devices |
| POST | `/api/auth/impersonation/start` | Start impersonation |
| POST | `/api/auth/impersonation/stop` | Stop impersonation |
| POST | `/api/auth/impersonation/audit` | Log impersonation action |

### Admin Routes (`/api/admin/`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/platform` | Control plane overview data |
| GET/POST | `/api/admin/feature-flags` | Feature flag CRUD |
| GET/POST | `/api/admin/libraries` | Library fleet management |
| GET/POST | `/api/admin/users` | User management |
| GET/POST | `/api/admin/revenue` | Revenue operations |
| GET/POST | `/api/admin/broadcasts` | Broadcast management |
| GET/POST | `/api/admin/security` | Security & RBAC |
| GET/POST | `/api/admin/incidents` | Incident management |
| GET | `/api/admin/analytics` | Platform analytics |
| GET/POST | `/api/admin/billing` | Billing operations |
| GET/POST | `/api/admin/jobs` | Queue/job management |

### Admin API Security:
- All admin routes require valid super admin session (cookie-based)
- IP whitelist enforcement via `isSuperAdminIpAllowed()`
- Rate limiting: 180 GET/min, 90 mutations/min per IP
- Request tracing with correlation IDs
- Maintenance mode guard (blocks non-admin requests)

---

## 19. Risks & Issues

### Critical Issues

| Issue | Impact | Status |
|-------|--------|--------|
| `normalizeText` undefined | OTP verify fails with 503 | **Fixed** — replaced with `trimText` |
| Missing env vars | Login fails without JWT secret, Redis, Resend | **Fixed** — dev fallbacks added |
| Redis dependency | No Redis = complete auth failure | **Fixed** — in-memory fallback for dev |
| Secure cookie on localhost | Cookie not sent on http:// | **Fixed** — disabled in dev |

### Potential Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Single JWT secret | High | If compromised, all sessions invalid. Rotate via env. |
| No MFA on role grants | Medium | Governance approval workflow exists but optional |
| Impersonation abuse | High | Audit trail + time-limited sessions (2min token) |
| Rate limit bypass via IP rotation | Medium | Email-based rate limiting as secondary |
| Redis single point of failure | High | In-memory fallback for dev only; production needs HA Redis |
| No session revocation push | Low | Clients discover revocation on next refresh |

### Missing Features

| Feature | Priority | Notes |
|---------|----------|-------|
| WebAuthn/FIDO2 for super admin | High | Currently OTP-only |
| Audit log export | Medium | Events logged but no export UI |
| Role grant expiry notifications | Low | Temporary grants expire silently |
| Multi-region Redis | Low | Single Redis instance currently |
| Rate limit dashboard | Low | Metrics collected but no dedicated view |

---

## 20. Production Readiness

### ✅ Production-Ready Components

- [x] OTP-based passwordless login with email delivery
- [x] JWT + refresh token session management
- [x] RBAC with 7 roles and 28 permissions
- [x] Governed actions with confirmation and cooldowns
- [x] IP whitelist enforcement
- [x] Rate limiting (Redis-based)
- [x] Device fingerprint validation
- [x] Impersonation with audit trail
- [x] Maintenance mode with admin bypass
- [x] Observability and event logging
- [x] Incident grouping and SLA tracking
- [x] Feature flag rollout governance
- [x] Release health monitoring
- [x] Queue management with dead-letter handling

### ⚠️ Requires Configuration

- [ ] `SUPABASE_JWT_SECRET` must match Supabase project secret
- [ ] `REDIS_URL` must point to production Redis (HA recommended)
- [ ] `RESEND_API_KEY` must be valid for email OTP delivery
- [ ] `SUPER_ADMIN_ALLOWED_EMAILS` must list authorized emails
- [ ] IP whitelist should be configured for production
- [ ] Governance approval policies should be reviewed

### 📁 File Map Summary

```
src/pages/SuperAdmin*.tsx          — 17 admin pages
src/components/dashboard/          — SuperAdminLayout (sidebar + header)
src/components/superAdmin/         — Shared admin UI components
src/hooks/superAdmin/              — 12 React Query hooks
src/lib/superAdmin/                — 12 service/utility files
src/lib/otpAuth.server.ts          — Core auth logic (4000+ lines)
src/lib/authRuntimeConfig.ts       — Runtime configuration checks
src/lib/auth.shared.ts             — Shared auth types and utilities
src/lib/authSession.ts             — Client session storage
src/lib/authApi.ts                 — Frontend API client
src/lib/superAdminPaths.ts         — Route constants
src/lib/maintenance*.ts            — Maintenance mode (5 files)
src/lib/observability/             — 33 observability files
api/admin/[...route].ts            — Admin API catch-all
api/auth/super-admin/              — Auth API routes (3 files)
```

---

*End of document.*
