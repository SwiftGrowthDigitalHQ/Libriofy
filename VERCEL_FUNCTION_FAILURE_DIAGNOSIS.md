# Vercel Function Failure Diagnosis

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
