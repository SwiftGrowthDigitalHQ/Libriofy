# DevOps And Infra Runbook

Libriofy is no longer treated as "just a frontend app". Production now assumes a split, documented system:

- frontend on a CDN deployment platform
- backend API on a stable server runtime
- Supabase as the managed data platform
- GitHub Actions as the validation and deployment control layer
- Sentry plus ops alerts for failure visibility

This runbook is the operator-facing source of truth for deployment, monitoring, and handover.

## 1. Target Production Topology

| Layer | Recommended platform | Repo contract |
| --- | --- | --- |
| Frontend SPA | Vercel | `vercel.json`, `npm run build` |
| Backend API | Render web service or equivalent stable VPS/runtime | `Dockerfile.api`, `render.yaml`, `npm run start:api:prod` |
| Database | Supabase Postgres | `supabase/migrations/`, `src/integrations/supabase/types.ts` |
| Storage | Supabase Storage | buckets defined by migrations and feature code |
| CI/CD | GitHub Actions | `.github/workflows/ci-cd.yml` |
| Uptime monitoring | GitHub Actions scheduled workflow + health endpoints | `.github/workflows/uptime-monitor.yml` |
| Error monitoring | Sentry client + server | `src/lib/observability/` |
| Backup and recovery | PowerShell ops scripts + offsite storage | `scripts/`, `.env.ops`, `docs/backup-and-recovery.md` |

## 2. Environment Separation

Keep staging and production isolated. Never share one deployment target for both.

| Area | Staging | Production |
| --- | --- | --- |
| Git branch | `staging` | `main` |
| Frontend domain | `staging.example.com` | `app.example.com` |
| API domain | `api-staging.example.com` | `api.example.com` |
| Render service | `libriofy-api-staging` | `libriofy-api-production` |
| GitHub environment | `staging` | `production` |
| Sentry environment | `staging` | `production` |
| Restore target | `RESTORE_STAGING_DB_URL` | `RESTORE_DB_URL` |

Rule: staging is the recovery proving ground. Production recovery is never the first place where restore is tested.

## 3. Hosting And Deployment

### Frontend

- Use Vercel for static frontend delivery.
- `vercel.json` defines:
  - Vite build command
  - output directory `dist`
  - SPA rewrite rules
  - security headers
- Frontend deployments should only contain public `VITE_*` values.

### Backend API

- Use Render or an equivalent container-based host for the Express API.
- `Dockerfile.api` builds:
  - `dist/` for the frontend assets served by the API when needed
  - `dist-server/index.mjs` for the API runtime
- `render.yaml` defines separate staging and production services with `/health/ready` as the readiness probe.

### Domain And HTTPS

Recommended DNS shape:

- `app.example.com` -> Vercel production project
- `staging.example.com` -> Vercel staging project or preview alias
- `api.example.com` -> Render production service
- `api-staging.example.com` -> Render staging service

HTTPS should be terminated by the hosting platforms:

- Vercel handles TLS for frontend domains
- Render handles TLS for API domains

After DNS is mapped:

1. verify frontend loads over HTTPS
2. verify API health endpoints respond over HTTPS
3. update the related environment variables with the final public URLs
4. run `npm run ops:health -- --remote-only --strict`

## 4. Environment Management

### Local Templates

- `.env.example` is the runtime template for app development
- `.env.ops.example` is the operations template for backup, restore, alerts, and uptime checks

### Secret Placement Rules

| Secret type | Where it belongs |
| --- | --- |
| Browser-safe public config | Vercel env vars / local `.env` with `VITE_*` |
| Server-only app secrets | Render env vars / local server runtime |
| Supabase function secrets | Supabase Edge Function secrets |
| CI deployment tokens | GitHub environment secrets |
| Backup and alert secrets | `.env.ops` on the ops machine or secure secret manager |

Never hardcode:

- service-role keys
- provider tokens
- SMTP passwords
- deploy tokens
- Sentry DSNs that are not meant for the current runtime

### Required Templates To Keep Updated

- `.env.example`
- `.env.ops.example`
- docs in `docs/system-blueprint/`

If a new environment variable is introduced and not documented in these places, the change is incomplete.

## 5. CI/CD Pipeline

Main workflow: `.github/workflows/ci-cd.yml`

### Validation Gates

Every PR and push to `staging` or `main` runs:

1. dependency install
3. documentation coverage check on the actual git range
4. `npm test`
5. `npm run build:production`

Production deploy is blocked until validation passes.

### Deployment Flow

- push to `staging`
  - build frontend
  - deploy frontend through Vercel
  - trigger staging Render deploy hook
- push to `main`
  - build frontend
  - deploy frontend through Vercel
  - trigger production Render deploy hook

### Build Failure Alerts

If validation or deployment fails on push, GitHub Actions sends an alert through `OPS_ALERT_WEBHOOK_URL` using `scripts/send-webhook-alert.mjs`.

### Required GitHub Secrets

Frontend deployment:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Backend deployment:

- `RENDER_DEPLOY_HOOK_URL`

Validation and build env:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_AUTH_API_BASE`
- `VITE_API_BASE_URL`
- `VITE_SCAN_API_URL`
- `VITE_DEVICE_HEARTBEAT_API_URL`
- `VITE_STUDENT_QR_API_URL`
- `VITE_QR_PUBLIC_KEY`
- `VITE_STUDENT_QR_PUBLIC_KEY`
- `VITE_RAZORPAY_KEY_ID`
- `VITE_PUBLIC_APP_URL`
- `VITE_APP_URL`
- `VITE_APP_ENV`
- `VITE_RELEASE_SHA`
- `VITE_SENTRY_DSN`
- `VITE_SENTRY_TRACES_SAMPLE_RATE`

Alerting and uptime:

- `OPS_ALERT_WEBHOOK_URL`
- `HEALTHCHECK_PRODUCTION_FRONTEND_URL`
- `HEALTHCHECK_PRODUCTION_API_URL`
- `HEALTHCHECK_STAGING_FRONTEND_URL`
- `HEALTHCHECK_STAGING_API_URL`

## 6. Database Safety

The database contract is controlled by:

- `supabase/migrations/` as the final schema source of truth
- `src/integrations/supabase/types.ts` as the generated snapshot that must match it

Required workflow for schema changes:

1. add or update a migration
2. update generated types in the same change
4. update related docs

No commit, push, or deploy should be trusted if schema sync is failing.

## 7. Backup Integration

Libriofy already includes backup, restore, drill, and alert automation. Infra setup must wire it into daily operations:

- `.env.ops` lives on the ops machine
- daily backup task runs from `scripts/install-ops-schedule.ps1`
- offsite backup is mandatory for production
- restore drill runs monthly into staging
- failures alert through webhook, email, or WhatsApp/SMS

Use these commands:

```powershell
npm run backup:db
npm run backup:monitor
npm run restore:latest -- -Target staging
npm run restore:drill
npm run ops:health
```

Detailed recovery runbook: [backup-and-recovery.md](./backup-and-recovery.md)

## 8. Monitoring And Alerts

### Health Endpoints

The Express API exposes:

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET /health/ops`

Use `/health/ready` for load balancer or platform readiness checks.

### Error Monitoring

Sentry is initialized in both runtimes:

- frontend: `src/lib/observability/clientMonitoring.ts`
- backend: `src/lib/observability/serverMonitoring.ts`

Use:

- `VITE_SENTRY_DSN` for frontend
- `SENTRY_DSN` for backend
- matching environment and release values for both

### Uptime Monitoring

`.github/workflows/uptime-monitor.yml` runs every 15 minutes and calls:

```bash
npm run ops:health -- --remote-only --strict --json
```

If any production or staging endpoint is unhealthy, the workflow emits an alert through `OPS_ALERT_WEBHOOK_URL`.

### Request Tracing

The API now adds `x-request-id` on every request. Server-generated error responses return the request ID so operators can correlate:

- API response
- Render logs
- Sentry event
- operator incident note

## 9. Performance And Scaling

Current production-grade baseline:

- CDN delivery for the SPA
- immutable caching for hashed assets
- short cache for non-hashed static files
- `no-store` for HTML shell and dynamic ops endpoints
- gzip compression in the Express API
- readiness probes for stable restarts and platform health

Initial scaling target for `1000+` users is supported by:

- static assets on CDN instead of the API origin
- Supabase-managed Postgres
- split staging and production runtimes
- monitoring before failure becomes silent

When sustained concurrency grows beyond this baseline, next upgrades should be:

1. move heavy async work fully to queues and workers
2. introduce Redis-backed caching for hot, repeated reads
3. scale the API host plan vertically before re-architecting
4. review the largest frontend chunks and split rarely used admin screens further

## 10. Ops Command Surface

Use `npm run ops:health` for one-command operator status.

It reports:

- latest backup status
- latest restore status
- latest restore drill status
- latest alert status
- configured owner
- optional remote health endpoint status

Useful modes:

```bash
npm run ops:health
npm run ops:health -- --json
npm run ops:health -- --remote-only --strict
```

## 11. New Developer Onboarding

A new developer should be able to deploy and support the system using only repo docs plus platform access.

Minimum onboarding sequence:

1. read `docs/system-blueprint/README.md`
2. read `docs/system-blueprint/devops-and-infra.md`
3. copy `.env.example` and `.env.ops.example`
4. run `npm install`
7. verify `npm test`
8. verify `npm run build:production`
9. review `.github/workflows/ci-cd.yml` and `render.yaml`

## 12. Definition Of Done For Infra Changes

An infrastructure or deployment change is only complete when all of these exist:

- working code or config
- environment variable template update if needed
- system blueprint update
- operator-facing runbook update if needed
- validation proof

That is the minimum standard for a production-grade, developer-independent system.

## 13. Go-Live Gate

Before production release, run:

```bash
npm run go-live:check
```

This gate verifies env quality, staging and production endpoint health, database readiness, backup and drill freshness, alert-test evidence, schedule presence, and manual signoff for login, QR scan, and payment.

It also verifies release integrity:

- the verified release SHA must be declared
- the production API must report that same SHA
- the production frontend must expose that same SHA through `/release.json`

For release trust, also use:

```bash
npm run release:truth
```

That command rebuilds production artifacts first and then applies the full gate.

For machine-readable release status, use `npm run go-live:report`. Its `release_truth` output is the compact system verdict for verification, reproducibility, and monitoring.
