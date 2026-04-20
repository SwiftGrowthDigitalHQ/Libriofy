# Graphify Project Brain

## Setup Summary

- Project root verified at `C:\Users\Administrator\Desktop\Libriofy`.
- Required repo markers are present: `package.json`, `.git`, `src/`, backend folders (`api/`, `server/`, `supabase/`), and config files such as `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, and `vercel.json`.
- Python is available: `Python 3.11.8`.
- `pip` is not exposed as a standalone command on `PATH`, but `python -m pip` works.
- `graphifyy` is installed.
- `graphify.exe` exists at `C:\Users\Administrator\AppData\Local\Programs\Python\Python311\Scripts\graphify.exe`, but that Scripts directory is not on `PATH`, so Graphify commands should use the absolute path unless `PATH` is updated.
- Graphify workspace guidance is installed for:
  - `AGENTS.md` / Codex
  - `.github/copilot-instructions.md` / VS Code Copilot Chat
  - `.codex/hooks.json` / pre-tool reminder to use graph memory first

## Command Notes

- This `graphifyy` release exposes `install`, `query`, `explain`, `path`, `update`, `benchmark`, and related utility commands from the shell.
- The shorthand `graphify <path>` build syntax shown in the skill docs is not exposed as a direct shell subcommand in this package version.
- For this repo, the canonical graphs already existed and were freshly generated on `2026-04-20`, so they were used as the persistent shared memory instead of being replaced by a lower-fidelity AST-only rebuild.
- Use `graphify update .` after code changes.
- Use `graphify query`, `graphify explain`, and `graphify path` for navigation.
- Use the Graphify skill/agent workflow for full semantic rebuilds when docs or non-code memory needs to be refreshed.

## Canonical Graph Outputs

The shared project memory lives in `graphify-out/` at the repository root.

Primary outputs:

- `graphify-out/graph.json`: machine-readable knowledge graph
- `graphify-out/GRAPH_REPORT.md`: human-readable graph report
- `graphify-out/graph.html`: interactive graph viewer
- `graphify-out/detect.json`: filtered corpus detection summary
- `graphify-out/extract.json`: extracted nodes and edges
- `graphify-out/analysis.json`: communities, cohesion, god nodes, and suggested questions
- `graphify-out/labels.json`: community labels
- `graphify-out/cache/`: extraction cache
- `graphify-out/memory/`: saved query results that can be folded back into future graph refreshes
- `graphify-out/src-test/`: smaller validation graph built from `src/`

Note: the shared memory intentionally excludes noisy generated folders such as `dist/`, `dist-server/`, `node_modules/`, `backups/`, and most static output. Including them makes the graph much less useful because transpiled bundles dominate the topology.

## Graph Build Results

Validation graph for `src/`:

- 1366 nodes
- 2192 edges
- 177 communities

Filtered full project graph:

- 1632 nodes
- 2680 edges
- 197 communities
- 88% extracted edges
- 12% inferred edges

Freshness check:

- `graphify-out/src-test/GRAPH_REPORT.md` and `graphify-out/src-test/graph.json` were last written on `2026-04-20 12:11`.
- `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json` were last written on `2026-04-20 12:14`.

## Architecture Summary

### 1. Authentication flow

Primary auth layers:

- Client auth transport: `src/lib/authApi.ts`
- Client auth/session state: `src/hooks/useAuth.tsx`
- Stored custom session cache: `src/lib/authSession.ts`
- Role lookup and routing: `src/hooks/useUserRole.ts`, `src/components/auth/AuthRoute.tsx`, `src/components/auth/ProtectedRoute.tsx`
- Server auth resolvers: `src/lib/otpAuth.server.ts`
- Token-to-user resolution: `src/lib/requestAuth.server.ts`
- HTTP entrypoints: `server/index.ts`, `server/vercelHandler.ts`, `api/auth/[...route].ts`

Flow:

1. The client sends auth actions through `src/lib/authApi.ts` to `/api/auth/*`.
2. `src/hooks/useAuth.tsx` restores session state from:
   - a cached custom session in `authSession`
   - Supabase `auth.getSession()` if present
   - a custom refresh flow via `refreshAuthSession()`
3. Route guards in `AuthRoute` and `ProtectedRoute` call `useAuth()` and `useUserRole()` to decide redirects, subscription gating, and super-admin verification.
4. `server/index.ts` and `server/vercelHandler.ts` forward auth endpoints into `src/lib/otpAuth.server.ts`.
5. `src/lib/otpAuth.server.ts`:
   - uses Supabase service-role access for profile and role lookup
   - uses Redis/BullMQ for OTP cooldowns, rate limits, challenge state, and fallback delivery
   - mints custom JWT access tokens and refresh tokens
   - rotates trusted-device refresh sessions
   - returns cookies plus serialized client session payloads
6. `src/lib/requestAuth.server.ts` resolves incoming bearer tokens by:
   - parsing the `Authorization` header
   - trying Supabase `auth.getUser(token)`
   - falling back to local JWT verification
   - hydrating the user from `profiles` and `user_roles`
7. `useUserRole()` fetches `user_roles` on the client, augments with `affiliates` for partner detection, and drives route protection and home-route selection.

Auth-specific risk:

- `src/lib/otpAuth.server.ts` is the main auth chokepoint and the highest-degree file node in the graph.
- `src/lib/requestAuth.server.ts` and `src/hooks/useUserRole.ts` are tightly coupled to the `profiles`, `user_roles`, and `affiliates` schema.

### 2. Database schema relationships

Graphify plus the generated Supabase types and migrations show these core relationships:

- `students.library_id -> libraries.id`
- `students.plan_id -> plans.id`
- `students.seat_id -> seats.id`
- `students.slot_id -> time_slots.id`
- `payments.library_id -> libraries.id`
- `payments.student_id -> students.id`
- `plans.library_id -> libraries.id`
- `seats.library_id -> libraries.id`
- `time_slots.library_id -> libraries.id`
- `entry_devices.library_id -> libraries.id`
- `device_commands.device_id -> entry_devices.device_id`
- `device_commands.library_id -> libraries.id`
- `support_tickets.library_id -> libraries.id`
- `library_subscriptions.library_id -> libraries.id`
- `subscription_payments.library_id -> libraries.id`
- `subscription_payments.subscription_id -> library_subscriptions.id`

Logical but less strongly expressed in generated foreign-key metadata:

- `profiles.user_id` acts as the primary identity profile for authenticated users
- `user_roles.user_id` maps a user to one or more roles and optionally to a `library_id`
- `libraries.owner_id` links a user to an owned library
- `affiliates.user_id` links a partner or affiliate identity back to a user

Schema quality check:

- `scripts/check-supabase-schema-sync.mjs` confirms migrations and `src/integrations/supabase/types.ts` are in sync for public tables, views, and enums.

High-impact schema clusters:

- Student and payment domain: `students`, `payments`, `plans`, `libraries`
- Auth and role domain: `profiles`, `user_roles`, `affiliates`
- Subscription and automation domain: `library_subscriptions`, `subscription_plans`, `subscription_payments`
- Device and ops domain: `entry_devices`, `device_commands`, `support_tickets`, `platform_settings`

### 3. API routes and dependencies

There are three active API surfaces:

- Express server: `server/index.ts`
- Serverless router: `server/vercelHandler.ts`
- Narrow fallback proxies: `api/[...route].ts`, `api/auth/[...route].ts`

Important route groups:

- Maintenance/settings: `/api/settings`
- Device setup/heartbeat: `/api/device-setup`, `/api/device-heartbeat`
- Attendance scan: `/api/scan-attendance`, `/api/attendance/scan`
- Student QR signing: `/api/student-qr`
- Auth: `/api/auth/send-otp`, `/api/auth/verify-otp`, `/api/auth/login-email`, `/api/auth/super-admin/login`, `/api/auth/super-admin/verify-otp`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/logout-all`, `/api/auth/twilio-status`
- AI helper: `/api/ai/partner`
- Health: `/api/health`, `/api/health/live`, `/api/health/ready`, `/api/health/ops`

Dependency pattern:

- Route layer normalizes headers, request body, and method constraints
- Route layer forwards into `src/lib/*.server.ts` resolver modules
- Resolver modules depend on Supabase, Redis, queues, or external providers

### 4. Core business logic dependencies

Main business logic hubs surfaced by the graph:

- Auth and sessions:
  - `src/lib/otpAuth.server.ts`
  - `src/lib/requestAuth.server.ts`
  - `src/hooks/useAuth.tsx`
  - `src/hooks/useUserRole.ts`

- Subscription gating and monetization:
  - `src/lib/subscription.ts`
  - `src/lib/billingEdgeFunctions.ts`
  - `supabase/functions/_shared/subscription-access.ts`
  - `supabase/functions/start-payment-recovery-calls/index.ts`
  - `supabase/functions/send-payment-recovery-reminders/index.ts`

- Payment recovery:
  - `src/lib/paymentRecovery.ts`
  - `supabase/functions/_shared/payment-recovery.ts`
  - `src/api/students.ts`

- Maintenance mode:
  - `src/lib/maintenance.ts`
  - `src/lib/maintenanceClient.ts`
  - `src/lib/maintenance.server.ts`
  - `supabase/functions/_shared/maintenance.ts`
  - `/api/settings` in both Express and serverless route layers

- Attendance and scanner/device control:
  - `src/lib/scanAttendance.server.ts`
  - `src/lib/deviceCommands.ts`
  - `src/components/dashboard/DeviceControlCenter.tsx`
  - Supabase RPCs such as `issue_device_command`, `pull_device_commands`, and `record_device_command_status`

- Support and issue handling:
  - `src/pages/SupportPage.tsx`
  - `src/components/notifications/NotificationCenter.tsx`
  - `src/lib/errorHandling.ts`
  - `src/components/error/GlobalErrorBoundary.tsx`

### 5. Dead code or orphan modules

The file graph flagged some low-degree file nodes, but these need interpretation:

- Confirmed low-degree examples:
  - `eslint.config.js`
  - `postcss.config.js`
  - `tailwind.config.ts`
  - `vitest.config.ts`
- There are also route and page leaves that look isolated in the graph but are still valid entrypoints.

Review-candidate examples:

- `api/ai/[...route].ts`
- `api/attendance/[...route].ts`
- `api/health/[...route].ts`
- `scripts/check-supabase-schema-sync.mjs`
- `src/pages/SupportPage.tsx`
- `src/components/dashboard/DeviceControlCenter.tsx`

Conclusion:

- The graph found isolated modules, but not enough evidence to call them dead code without route registration checks, runtime usage, or analytics.
- Treat them as review candidates, not safe-delete targets.

### 6. Circular dependencies

Graph-derived cycle candidates were reviewed, but the targeted inspection did not confirm a hard TypeScript import loop in the auth or API files.

Verification result:

- The direct graph cycle scan did not surface a clear small file-level import cycle.
- Earlier candidates look more like conceptual feedback loops across auth, maintenance, and payment-recovery flows than literal module-import cycles.
- Treat these as architecture review candidates rather than confirmed circular dependencies.

### 7. High-risk files

Highest-risk files from the graph and targeted inspection:

- `src/lib/otpAuth.server.ts`
  - central auth resolver, token lifecycle, OTP, Redis, session cookies, trusted devices
  - top file-node degree in the graph: `81`
- `src/lib/requestAuth.server.ts`
  - bearer-token parsing and hydration from `profiles` / `user_roles`
- `src/hooks/useAuth.tsx`
  - client session restore, refresh, idle expiry, Supabase/custom session coordination
- `src/hooks/useUserRole.ts`
  - role resolution and schema-sensitive access control
- `src/api/students.ts`
  - payment rollups, student normalization, and high fan-in from payment workflows
- `src/lib/subscription.ts`
  - subscription access gate for dashboard availability
- `server/vercelHandler.ts`
  - serverless API router for auth, maintenance, attendance, health, and QR endpoints
- `server/index.ts`
  - Express route wiring for the same core surfaces
- `src/lib/maintenanceClient.ts`
  - maintenance-mode fallback chain on the client
- `supabase/functions/_shared/maintenance.ts`
  - shared maintenance kill-switch for edge functions
- `supabase/functions/_shared/payment-recovery.ts`
  - shared overdue-payment calculations used by automation jobs
- `supabase/functions/_shared/subscription-access.ts`
  - plan and automation feature gating used by recovery jobs

## "Issue Workflow" Interpretation

The exact query "Show dependencies for library issue workflow" was ambiguous in this codebase.

The graph surfaced two plausible "issue" workflows:

- Device command issuing:
  - `src/components/dashboard/DeviceControlCenter.tsx`
  - `src/lib/deviceCommands.ts`
  - `public.issue_device_command`
  - `public.device_commands`
  - `public.entry_devices`

- Support issue reporting:
  - `src/pages/SupportPage.tsx`
  - `src/components/notifications/NotificationCenter.tsx`
  - `src/lib/errorHandling.ts`
  - `src/components/error/GlobalErrorBoundary.tsx`
  - `public.support_tickets`

For future queries, prefer more specific wording:

- "Show dependencies for support ticket workflow"
- "Show dependencies for device command issue workflow"

## Required Workflow Going Forward

Before any code edit:

1. Read `graphify-out/GRAPH_REPORT.md` first.
2. Use `graphify-out/graph.json` or Graphify queries to identify impacted files.
3. Open only the relevant files.
4. Explain what may break.
5. Propose the change.
6. Then edit code.

After code changes:

- Run `graphify update .` to refresh the code graph.
- If the change materially affects docs or non-code knowledge, schedule a full semantic Graphify refresh rather than relying only on `update`.

Do not use generated bundles or full-repo scanning as the default source of truth unless the graph is missing coverage.

## Sample Query Review

Queries tested:

- "Explain the authentication flow."
- "Show dependencies for library issue workflow."
- "Find files impacted if user schema changes."

Observed behavior:

- The graph is effective at narrowing the relevant file set.
- Query quality is best when the question matches code concepts directly.
- Query quality is weaker for broad natural-language prompts and ambiguous terms.
- Generic nodes like `String()` still appear as high-degree hubs.
- The literal `graphify query "Explain the authentication flow."` result was noisy on this repo and surfaced nearby auth/theme nodes rather than a clean end-to-end flow.

What worked well:

- Auth hotspot discovery through `explain "resolveSuperAdminLoginRequest()"` and file-degree analysis
- User-schema impact discovery by tracing `profiles`, `user_roles`, and `affiliates` consumers
- Route surface mapping
- High-risk file detection
- Benchmarking token reduction

What was weaker:

- Ambiguous workflow queries
- Distinguishing true dead code from entrypoints
- Distinguishing conceptual cycles from import cycles
- One-shot natural-language summaries from `query` without follow-up targeting

## Optimization Review

### Token reduction potential

- Strong. The measured benchmark on `2026-04-20` showed about `98.3x` fewer tokens per query than a naive full-corpus read.
- Average graph-backed query budget was about `1,107` tokens versus an estimated `108,800` naive tokens for the corpus.
- Per-question reductions ranged from `84.2x` to `119.7x`.

### Context quality

- Good for architecture navigation and file narrowing.
- Strongest when used to find hotspots and impacted files before opening source.
- Weaker for fuzzy prompts unless the prompt is refined to repo concepts.

### Hallucination reduction

- Moderate improvement.
- The graph anchors attention to the right files and functions, which reduces blind full-repo guessing.
- It does not fully eliminate noisy inferred hubs, so human verification is still needed.

### Speed improvement

- Strong for repeated architecture questions.
- Build cost is upfront; reuse cost is low.
- On Windows, `benchmark` required `PYTHONIOENCODING=utf-8` to avoid console-encoding crashes from box-drawing characters.

### Risks

- Generated files can poison the graph if they are included.
- AST-heavy graphs are weaker for fuzzy semantic questions.
- File-level orphan and cycle findings still need human verification.
- Shell ergonomics on Windows are slightly rough because `graphify.exe` is not on `PATH` by default.

### Permanent adoption verdict

- Yes, adopt Graphify for this repo.
- Use the filtered source graph in `graphify-out/` as the shared memory layer.
- Keep `graphify update .` in the normal workflow after code changes.
- Prefer graph-guided targeted reads over broad repo scans.
- For architecture or onboarding work, treat `graphify-out/GRAPH_REPORT.md` as the first document to read.
