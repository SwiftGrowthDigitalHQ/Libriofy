# Future-Safe System Guide

## Objective

The system should stay understandable and operable even if the current developer, next developer, and future agency are all different people.

That means:

- clear source-of-truth boundaries
- migration-first backend changes
- explicit contracts
- minimal hidden knowledge
- operational playbooks that live in the repo

## Core Principles

### 1. Database First, UI Second

Every feature in Libriofy ultimately becomes durable only when:

- a migration exists
- the tables or RPCs exist
- the type snapshot is updated
- the UI points to those contracts

If the schema exists only in React state or only in a component assumption, it is not a finished system feature.

### 1A. Documentation Ships With The Change

Every feature or behavior change must update the system blueprint in the same change.

Minimum expectation:

- update the affected flow doc
- update database or API docs if contracts changed
- record any new operational setup or deployment steps

If the code changed but the system docs did not, the task is not done.

### 1B. Commit And Push Must Enforce The Rules

Policy alone is not enough.

Libriofy now treats these checks as gatekeepers:

- if either hook fails, the change is not ready

GitHub Actions is also part of the enforcement layer:

- deployment validation checks schema sync
- deployment validation checks documentation coverage on the real git range
- production deployment happens only after validation succeeds
- final production readiness must pass `npm run go-live:check`
- go-live evidence and release matching are mandatory, not optional process notes
- release trust depends on verification, reproducibility, and monitoring

### 2. Library Scope Is The Main Boundary

Most operational data must stay library-scoped.

For new features, default to:

- one `library_id`
- one authorization path
- one clearly owned table or RPC

### 3. Use The Right Backend Layer

Choose backend contracts intentionally:

- direct table reads for simple, library-scoped queries
- Postgres RPCs for rules-heavy domain mutations
- custom REST endpoints for sensitive flows that need server secrets or tighter validation
- Edge Functions for external providers, webhooks, long-running automation, or server-only integrations

### 4. Prefer Shared Server Logic Over Duplicated Route Logic

The repo already follows a good pattern:

- route handlers stay thin
- business logic sits in `src/lib/*server.ts`

Keep doing that. If both Express and serverless handlers need the same behavior, the rule engine should live once in `src/lib`.

### 5. Idempotency Is Mandatory For Device And Payment Flows

Critical flows already depend on unique identifiers or webhook-safe updates:

- attendance uses `entry_id`
- device commands have lifecycle status
- payment verification and webhooks reconcile the same payment

New operational flows should keep the same principle.

## Non-Negotiable System Invariants

| Invariant | Why it matters |
| --- | --- |
| Signed student QR must be server-issued and scanner-verified | prevents fake scans and cross-library misuse |
| Attendance writes must be idempotent by `entry_id` | prevents duplicate check-ins during retries or offline replay |
| Kiosk must be both library-bound and device-token validated when configured | prevents scanner spoofing |
| `library_subscriptions` is the source of truth for billing access | prevents UI-only access drift |
| Role checks must resolve from `user_roles` or the partner affiliate mapping | prevents privilege ambiguity |
| Migrations are the DB source of truth | prevents schema drift and undocumented hotfixes |
| Browser builds must not depend on service-role secrets | prevents catastrophic data exposure |
| Staging and production must stay isolated by branch, secrets, host, and domain | prevents accidental production impact |
| Production route behavior must match development middleware behavior | prevents dev-only success and prod-only failure |
| Health probes and alerting must exist before a service is considered production-ready | prevents silent outages |
| Releases must be reproducible from lockfile and CI build path | prevents one-off or untrusted deployments |

## Recommended Change Workflow

For any new feature or major change, follow this order:

1. Define the business rule and the owning module.
2. Add or update the database migration.
3. Add or update Postgres RPCs or Edge Functions if needed.
4. Update the typed schema snapshot.
5. Update frontend queries and UI.
7. Add or update docs in this folder.
8. Run a smoke test on the real end-to-end flow.

## Definition Of Done For New Features

A feature is not complete until all of these exist:

| Artifact | Example question to answer |
| --- | --- |
| Route or UI entry point | where does the user start it? |
| Backend contract | which endpoint, function, or RPC owns it? |
| Durable storage | which table or storage bucket keeps the data? |
| Authorization rule | who can read or mutate it? |
| Operational behavior | what happens on failure, retry, or webhook replay? |
| Documentation update | where is the new flow recorded in `docs/system-blueprint/`? |

## Schema Sync Policy

`supabase/migrations/` is the final schema source of truth.

That means:

- generated Supabase types must stay aligned in the same change
- tables, views, and enums must never drift from migrations

If the checker fails, fix the types snapshot before the work is considered complete.

## Current Risks To Address Over Time

### 1. Mixed Data Access Patterns Need Discipline

Libriofy intentionally mixes:

- direct Supabase access
- REST endpoints
- Edge Functions
- RPCs

This is fine, but future developers should always document which pattern a feature chose and why.

### 2. Service Secret Hygiene Must Stay Strict

Some code paths currently support fallback env names that look browser-safe. Production deployments should standardize:

- anon keys in browser code only
- service-role keys in server runtimes and function secrets only

### 3. Compatibility Paths Increase Cognitive Load

The codebase contains valuable but complex fallback logic for:

- locker schema compatibility
- older student photo flows
- lead schema compatibility
- attendance RPC fallback between `scan_attendance_entry` and `qr_check_in`

When compatibility is no longer needed, remove it deliberately and document the cleanup.

### 4. API Surface Exists In Multiple Runtimes

Custom REST routes currently exist through:

- Vite dev middlewares
- Express server
- serverless `api/` files

This is workable because business logic is centralized, but route parity must stay verified whenever an auth or scanner endpoint changes.

### 5. Infrastructure Changes Need The Same Discipline As Feature Changes

Infra changes are real product changes. That means:

- update env templates when variables change
- update deployment docs when hosting flow changes
- update ops docs when monitoring or alerting changes
- keep CI/CD config in repo, not in memory

## Folder Ownership Model For Future Work

| Area | Primary place to change |
| --- | --- |
| Route additions | `src/App.tsx` and route pages |
| Shared UI behavior | `src/components/`, `src/hooks/` |
| Browser-side feature data access | `src/api/`, `src/lib/` |
| Secure server logic | `src/lib/*server.ts` |
| Custom REST API exposure | `server/index.ts`, `api/`, `vite.config.ts` |
| Database schema and rules | `supabase/migrations/` |
| Provider automation | `supabase/functions/` |
| Ops and backups | `scripts/`, `docs/backup-and-recovery.md`, `docs/system-blueprint/backup-and-recovery.md` |
| Deployment and monitoring | `.github/workflows/`, `render.yaml`, `vercel.json`, `Dockerfile.api`, `docs/devops-and-infra.md`, `docs/system-blueprint/devops-and-infra.md` |

## Handover Checklist For A New Developer

1. Read the docs in `docs/system-blueprint/`.
2. Review the latest migrations before trusting frontend assumptions.
3. Trace one complete flow end to end:
   `auth -> dashboard -> student -> QR -> kiosk -> attendance`.
4. Confirm local environment variables are split correctly between browser and server.
5. Verify the critical external providers for the environment:
   Razorpay, Twilio, OpenAI, Google, backup target.
6. Check whether generated Supabase types need regeneration.
7. Confirm `npm run ops:health` and the remote health endpoints are understood.

## What "System-Dependent" Looks Like For Libriofy

The platform becomes system-dependent when:

- the important rules live in migrations, RPCs, functions, or shared server helpers
- docs explain the why and the where, not only the what
- deploy steps are repeatable
- operational recovery does not require memory of one developer
- new work extends existing contracts instead of creating hidden side paths

That is the standard this documentation hub is meant to enforce.
