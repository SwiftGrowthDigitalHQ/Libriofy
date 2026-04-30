# Vercel Function Failure Diagnosis

## Live Production Incident Update - 2026-04-30

I re-checked the live production site directly on 2026-04-30 and the current failure is now much clearer.

### What is failing on the live site

Direct checks against production returned:

- `GET https://www.libriofy.com/api/settings` -> `500 Internal Server Error`
- `GET https://www.libriofy.com/api/health` -> `500 Internal Server Error`
- `GET https://www.libriofy.com/health` -> `500 Internal Server Error`

Important response header from production:

- `X-Vercel-Error: FUNCTION_INVOCATION_FAILED`

Important body from production:

```text
A server error has occurred

FUNCTION_INVOCATION_FAILED
```

That matters because this is not a normal handled API error from our route code. This is Vercel reporting that the serverless function itself is failing during invocation or bootstrap.

### Why this is probably not an auth-form bug

The login page is noisy because it keeps polling `/api/settings`, but the root issue is broader than login.

Code facts:

- `api/[...route].ts` handles `/api/settings` with a very small handler and already falls back to a safe response if maintenance lookup fails.
- `api/health/[...route].ts` handles `/api/health` and `/api/health/live` with extremely simple JSON responses.
- Even those health routes are failing in production.

Conclusion:

- the issue is not "wrong email/password"
- the issue is not "maintenance lookup returned bad data"
- the issue is not isolated to auth logic
- the issue is at the Vercel function runtime/deployment layer

### Strongest current root-cause signal

The production release manifest is also wrong right now:

- `GET https://www.libriofy.com/release.json` returned:
  - `"appEnv": "development"`
  - `"release": null`

That is a major clue. The checked-in GitHub workflow passes many `VITE_*` values only into the local `npm run build` step, but `vercel deploy --prod` performs a separate remote Vercel build. If those same values are not configured inside the Vercel project itself, the live deployment can:

- build with fallback/default values
- ship a frontend that looks deployed
- still crash or misbehave at the serverless runtime

This production result strongly suggests Vercel project environment/config drift.

### Most likely problem

Most likely the current Vercel project is missing or mismatching required production environment/configuration, and the deployed serverless functions are crashing before the handlers can return their normal JSON responses.

At minimum, production behavior shows that Vercel is not receiving the intended release/environment metadata for the live build.

### How to solve it

1. Open the Vercel project settings for the production environment.
2. Verify that the production env vars exist in Vercel itself, not only in GitHub Actions.
3. Re-check at least these server-side values:
   - `APP_ENV`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STUDENT_QR_PRIVATE_KEY`
   - one of `APP_URL`, `PUBLIC_APP_URL`, or `SITE_URL`
4. Re-check the public build values used by the frontend:
   - `VITE_APP_ENV`
   - `VITE_RELEASE_SHA`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - any other `VITE_*` values expected by the app
5. Redeploy from Vercel after envs are corrected.
6. Immediately smoke-test:
   - `/api/settings`
   - `/api/health`
   - `/health`
   - `/release.json`
   - `/auth`
7. Confirm that:
   - `/api/settings` returns JSON, not Vercel plain-text 500
   - `/api/health` returns 200 JSON
   - `/release.json` no longer says `"appEnv": "development"` on production
   - `"release"` is populated

### Recommended hardening after the fix

- Add a post-deploy smoke test in CI that fails the deployment if `/api/settings` or `/api/health` returns non-200.
- Run `vercel pull --yes` plus `vercel build` in CI or a release-check workflow so function packaging is verified before production deploy.
- Log and alert on `X-Vercel-Error: FUNCTION_INVOCATION_FAILED`.
- Keep `/release.json` in the smoke-test checklist because it quickly exposes Vercel env drift.

Scope of this audit:

- `.github/workflows/ci-cd.yml`
- `vercel.json`
- `api/[...route].ts`
- `api/auth/[...route].ts`
- `api/health/[...route].ts`
- `server/vercelHandler.ts`

Local verification performed:

- Read `AUTH_SYSTEM_FLOW.md`
- Ran `vercel --version` -> `Vercel CLI 50.1.6`
- Ran `vercel build` -> failed before app build with: `No Project Settings found locally. Run vercel pull --yes to retrieve them.`

That last point matters: I could not generate a local `.vercel/output` artifact in this checkout, so the conclusions below separate confirmed code/config facts from Vercel-project-dependent runtime/build assumptions.

## Short Answers

### 1. Are `/api` functions actually included in deployment?

Yes, based on the current deployment mode and file layout, `/api` functions should be included in Vercel deployment now.

Why:

- The workflow now uses `vercel deploy --prod` in both staging and production, not `--prebuilt`:
  - `.github/workflows/ci-cd.yml:114`
  - `.github/workflows/ci-cd.yml:170`
- `vercel.json` is configured as a Vite project for the frontend, but the repo also contains real Vercel serverless entrypoints under `api/`:
  - `vercel.json:3-5`
  - `api/[...route].ts:37`
  - `api/auth/[...route].ts:120`
  - `api/health/[...route].ts:40`
- The rewrites send friendly URLs into those serverless routes:
  - `/auth/*` -> `/api/auth/*` in `vercel.json:36-69`
  - `/health*` -> `/api/health*` in `vercel.json:72-85`

Bottom line:

- The old failure mode was "frontend artifact uploaded without `.vercel/output` functions."
- That specific failure mode is no longer present in the GitHub workflow as currently written.

### 2. Could the current Vercel build still be shipping frontend but crashing functions?

Yes. That is still plausible.

Reasons:

- `vercel deploy --prod` tells Vercel to build the project remotely. The local GitHub step `npm run build` is not what determines whether Vercel functions are bundled successfully:
  - `.github/workflows/ci-cd.yml:85-114`
  - `.github/workflows/ci-cd.yml:141-170`
- The workflow passes many `VITE_*` vars into the local GitHub `npm run build`, but those are not the same thing as Vercel project env vars available during Vercel's own build/runtime.
- The API handlers depend on server-side env/runtime state through `process.env`:
  - `api/[...route].ts:62`
  - `api/auth/[...route].ts:125-149`
  - `api/health/[...route].ts:50`
  - `server/vercelHandler.ts:66-68`
  - `server/vercelHandler.ts:132-145`

So the likely production pattern is:

- frontend deploy succeeds
- `/api` functions are present
- one or more functions fail at runtime or cold start because Vercel-side env/config is incomplete or different from GitHub Actions env

### 3. Is there a shared import or module-load crash killing all routes?

There is no strong evidence from these audited files that one shared import is killing all audited routes.

Important distinction:

- `api/auth/[...route].ts` is its own auth function entrypoint and does not import `server/vercelHandler.ts`
- `api/health/[...route].ts` is its own health function entrypoint and does not import `server/vercelHandler.ts`
- `api/[...route].ts` is its own settings entrypoint and does not import `server/vercelHandler.ts`

So `server/vercelHandler.ts` is not the single shared boot path for the three route groups you asked about.

What `server/vercelHandler.ts` actually is:

- a heavier shared handler used by other API entrypoints
- repo search shows imports from:
  - `api/attendance/[...route].ts:1`
  - `api/ai/[...route].ts:1`

That means:

- a module-load failure inside `server/vercelHandler.ts` could break attendance/AI routes
- it would not, by itself, explain auth, settings, and health all failing together

Within the audited route files:

- `api/auth/[...route].ts` depends mainly on `httpRequest.server` and `otpAuth.server`:
  - `api/auth/[...route].ts:1-12`
- `api/[...route].ts` and `api/health/[...route].ts` depend on `maintenance.server`:
  - `api/[...route].ts:1`
  - `api/health/[...route].ts:1`

So the narrower failure possibilities are:

- `otpAuth.server` import/runtime issue -> auth routes fail
- `maintenance.server` import/runtime issue -> settings/ready/ops behavior affected
- `server/vercelHandler.ts` issue -> attendance/AI routes fail

But there is no evidence here of one universal import crash that would kill every `/api` route at once.

### 4. Is the Vercel deploy workflow still wrong in any way?

Not in the original `--prebuilt` way. That part is fixed.

Remaining concerns:

1. The local `npm run build` step is now mostly redundant for Vercel deployment.
   - Vercel is doing its own build after `vercel deploy --prod`.
   - `.github/workflows/ci-cd.yml:85-114`
   - `.github/workflows/ci-cd.yml:141-170`

2. The workflow is not self-verifying for Vercel function output.
   - A local `vercel build` or `vercel pull && vercel build` path is not used.
   - In this checkout, `vercel build` cannot run because project settings are not pulled locally.

3. The biggest remaining risk is env mismatch between GitHub Actions and Vercel.
   - GitHub injects many `VITE_*` values into the local build step.
   - The serverless functions read runtime env from `process.env`.
   - If those server-side secrets are not configured in the Vercel project itself, the frontend can deploy while functions still fail.

So the workflow is no longer obviously broken, but it is still incomplete as a diagnostic pipeline because it does not prove function health before or after deploy.

### 5. Is there any evidence auth logic itself is broken? Or is deployment still the root issue?

From the audited files only, there is no clear evidence that auth logic itself is the primary root issue.

Why:

- Auth routes are explicitly wired and exported:
  - `api/auth/[...route].ts:120-149`
- Auth resolver failures are caught and returned as JSON 500s inside the handler:
  - `api/auth/[...route].ts:109-117`
- Health and settings handlers are simple and resilient:
  - `api/[...route].ts:62-74`
  - `api/health/[...route].ts:49-87`

That means:

- if production symptoms are route-level 404s, missing functions, cold-start crashes, or non-JSON failures, deployment/runtime remains the more likely root issue
- if production symptoms are JSON 500 responses from auth endpoints with resolver messages, then auth/runtime env inside the function becomes more likely

Based on these files alone, deployment/runtime configuration is still the stronger root cause than "auth logic is fundamentally broken."

## Evidence by File

### `.github/workflows/ci-cd.yml`

Confirmed:

- Vercel deploy no longer uses `--prebuilt`
  - `114: vercel deploy --prod --token "..."`
  - `170: vercel deploy --prod --token "..."`
- The workflow still runs a local frontend build first
  - `85-109`
  - `141-164`

Implication:

- Vercel should build both frontend and `api/` functions remotely
- local GitHub build success does not guarantee Vercel function success

### `vercel.json`

Confirmed:

- Vercel frontend build config is Vite
  - `3-5`
- Auth and health paths are rewritten into `/api/*`
  - `36-85`
- Catch-all SPA rewrite excludes `api/`
  - `88-89`

Implication:

- frontend routing should not swallow `/api/*`
- `/api` requests should stay server-side

### `api/[...route].ts`

Confirmed:

- Dedicated handler exists for `/api/settings`
  - `37-75`
- It only imports `resolveMaintenanceStatus`
  - `1`
- It catches maintenance lookup failure and falls back
  - `62-66`

Implication:

- this route is lightweight
- if `/api/settings` is failing hard in production, that points more toward function deployment/boot issues than auth logic

### `api/auth/[...route].ts`

Confirmed:

- Dedicated auth handler exists and maps all listed auth endpoints
  - `120-149`
- It wraps resolver execution in a `try/catch`
  - `94-117`
- Failures return JSON 500 with `"Unexpected auth failure"` fallback
  - `113-115`

Implication:

- auth logic failures should usually surface as handled JSON responses
- platform-level failures suggest deployment/cold-start/env problems before or outside resolver execution

### `api/health/[...route].ts`

Confirmed:

- Dedicated health handler exists
  - `40-87`
- `/api/health` and `/api/health/live` are simple
  - `69-87`
- `/api/health/ready` and `/api/health/ops` call maintenance status with fallback
  - `49-67`

Implication:

- if even `/api/health` is failing, the problem is unlikely to be auth logic
- it more likely indicates function packaging, boot, or environment/runtime failure

### `server/vercelHandler.ts`

Confirmed:

- This file imports many heavier server dependencies
  - `1-20`
- It includes auth, health, settings, AI, attendance, device, and QR routing
  - `350-534`
- It reads env-dependent values at module scope for OpenAI defaults
  - `66-68`
- It creates a Supabase client only when needed, not immediately at import
  - `132-145`

Implication:

- this file is a realistic module-load risk for the routes that import it
- but it is not the universal entrypoint for the dedicated auth/health/settings routes audited above

## Final Diagnosis

Most likely state right now:

1. The original GitHub workflow mistake around `vercel deploy --prebuilt` without `.vercel/output` has been fixed.
2. `/api` functions should now be included in deployment when GitHub runs `vercel deploy --prod`.
3. A frontend-success-plus-function-failure scenario is still very plausible.
4. There is no strong evidence in these files that auth logic itself is the primary bug.
5. Deployment/runtime configuration on Vercel is still the stronger root cause candidate than broken auth code.

## Confidence Notes

High confidence:

- `/api` is no longer being skipped because of `--prebuilt`
- `vercel.json` rewrites are not routing `/api` into the SPA
- `server/vercelHandler.ts` is not the shared entrypoint for auth/health/settings

Medium confidence:

- functions are included in cloud deployment, because I could not run a full local `vercel build` without `vercel pull`

Open unknown that still matters:

- whether all required server-side env vars are configured in the Vercel project itself, not just in GitHub Actions
