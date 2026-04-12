# Go-Live Checklist

Libriofy is not considered ready for production until every item in this checklist is green.

Mandatory command:

```bash
npm run go-live:init
npm run go-live:check
```

This command fails if any required automation, health check, backup signal, or manual business-flow signoff is missing.

## Release Principles

- system decides readiness, not humans
- one failed check invalidates release
- if it cannot be verified, it is not deployed
- if it is not reproducible, it is not trusted
- if it is not monitored, it is already broken
- manual checks require evidence
- backup and restore must be proven, not assumed
- deployed frontend and API must match the verified release SHA

## Release Truth Output

`npm run go-live:report` now emits a machine-readable `release_truth` block.

That block means:

- `verified = true` only when deployment, release integrity, domain/HTTPS, database safety, and manual business-flow evidence are all green
- `reproducible = true` only when lockfile, CI build path, and local production artifacts prove the verified release can be rebuilt
- `monitored = true` only when monitoring, alerting, and ops-system checks are green

If any one of those truth signals is `false`, the release is not trustworthy.

## 1. Env & Secrets

The go-live check validates:

- app runtime values from `.env` or process environment
- ops values from `.env.ops` or process environment
- placeholder values are rejected
- server startup requirements are enforced at runtime

Commands:

```bash
npm run validate:env
```

Server startup now fails fast if these values are missing:

- `APP_ENV`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STUDENT_QR_PRIVATE_KEY`
- one of `APP_URL`, `PUBLIC_APP_URL`, or `SITE_URL`

## 2. Deployment

Go-live requires both staging and production deployments to be healthy.

Automated checks:

- staging frontend responds
- staging API readiness responds
- production frontend responds
- production API readiness responds

The check uses:

- `HEALTHCHECK_STAGING_FRONTEND_URL`
- `HEALTHCHECK_STAGING_API_URL`
- `HEALTHCHECK_PRODUCTION_FRONTEND_URL`
- `HEALTHCHECK_PRODUCTION_API_URL`

## 2A. Release Integrity

The system now requires a verified release SHA and checks that the deployed version matches it.

Automated checks:

- manual signoff file must declare `verified_release_sha`
- production API `/health` must return the same release SHA
- production frontend `/release.json` must return the same release SHA

If the deployed version does not match the verified version, release is invalid.

## 2B. Reproducibility

The system also checks whether the release can be trusted as a reproducible build.

Automated checks:

- `package-lock.json` must exist
- CI workflow must use `npm ci`
- CI workflow must run `npm run build:production`
- local `dist/index.html` must exist
- local `dist/release.json` must exist
- local `dist-server/index.mjs` must exist
- local release manifest must match the verified release SHA

If the release cannot be reproduced from lockfile plus CI build path, it is not trusted.

## 3. Domain & HTTPS

Production is blocked until:

- staging and production URLs are different
- production frontend and API use `https://`
- production hosts are not placeholder or local domains
- production `/health` returns `200`

## 4. Database Safety

The checklist treats database safety as mandatory:

- production API readiness must report `supabase_connectivity = pass`
- latest backup must be successful and fresh
- latest restore drill must be successful and fresh

The readiness endpoint now verifies live Supabase REST connectivity, not only variable presence.

## 5. Monitoring

The checklist requires:

- uptime workflow file and remote health URLs
- Sentry DSNs for frontend and backend
- latest alert test success

Run a fresh alert test before go-live:

```bash
npm run ops:alert:test
```

## 6. Ops System

The checklist requires:

- `npm run ops:health` to be healthy
- scheduled backup tasks active on Windows
- latest restore drill status to be `success`

Expected scheduled tasks:

- `Libriofy-DailyBackup`
- `Libriofy-BackupHealthCheck`
- `Libriofy-MonthlyRestoreDrill`

## 7. Final Test

These three business-critical checks require explicit manual signoff:

- login works
- QR scan works
- payment works

Manual signoff file:

- copy [.ops/go-live-manual-checks.example.json](../.ops/go-live-manual-checks.example.json) to `.ops/go-live-manual-checks.json`
- or generate it with:

```bash
npm run go-live:init
```
- the file must also include `verified_release_sha`, `verified_by`, and `verified_at_utc`
- each manual check must include `status = pass`, `checked_at_utc`, `checked_by`, `environment`, `release_sha`, and non-empty `evidence`

Example evidence:

- ticket or QA run URL
- screenshot path
- payment gateway dashboard proof
- scan video or attendance log reference

- mark each item as `pass`
- include `checked_at_utc`

Until that file says all three are `pass`, `npm run go-live:check` will fail.

## Strict Release Command

For a release-grade check that rebuilds production artifacts and then applies the go-live gate:

```bash
npm run release:truth
```

Use `npm run go-live:report` when another system needs the JSON verdict without immediately failing the shell.

## Rule

Only after all sections are green is Libriofy considered go-live ready.
