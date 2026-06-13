# Vercel Parity Recovery Report

Scope: recover parity between the local workspace and Vercel deployment/build behavior for the Libriofy project.

## Executive Summary

- Local TypeScript and local production build both pass.
- `vercel build` passes for both preview and production targets in the current workspace.
- The current production deploy still does not become `READY`.
- The blocking deploy failure is now platform-level: the Hobby plan rejects this deployment because it contains more than 12 Serverless Functions.

## Environment Parity

| Setting | Local | Vercel |
| ---- | ---- | ---- |
| Node | `v23.11.1` | `22.x` |
| TypeScript | `5.8.3` | `5.8.3` |

Notes:

- `package.json` pins `"engines": { "node": "22.x" }`, which overrides the project setting shown in Vercel as `24.x`.
- The Vercel logs explicitly report `Using TypeScript 5.8.3 (local user-provided)`.

## Verified Config

- `package.json`
  - Build script is `vite build`.
  - Node engine is pinned to `22.x`.
  - There are 16 API route files under `api/`, which matters for the Hobby plan function cap.
- `tsconfig.json`
  - Composite project references are enabled.
  - `skipLibCheck` is on.
  - `allowJs` is on.
- `vercel.json`
  - `framework` is `vite`.
  - `buildCommand` is `npm run build`.
  - `outputDirectory` is `dist`.
  - `functions.includeFiles` is broad for `api/*.ts` and `api/**/*.ts`.
- `vite.config.ts`
  - Vite dev middleware and API shims are configured in-process.
  - This does not reduce the number of deployed `api/` serverless functions.

## Verification Runbook

Commands run:

- `npx tsc --noEmit`
- `npm run build`
- `npx vercel@54.9.0 build --yes`
- `npx vercel@54.9.0 build --prod --yes`
- `npx vercel@54.9.0 deploy --prebuilt --prod --yes`
- `npx vercel@54.9.0 deploy --prebuilt --prod --yes --archive=tgz --debug`

Build results:

- `npx tsc --noEmit`: pass
- `npm run build`: pass
- `vercel build`: pass
- `vercel build --prod`: pass

Deploy results:

- `vercel deploy --prebuilt --prod` without archive packaging failed because the upload exceeded Vercel's raw file-list limit.
- `vercel deploy --prebuilt --prod --archive=tgz` failed because the deployment exceeds the Hobby plan's 12 Serverless Functions limit.

## Blocker Inventory

| File | Line | Error | Root Cause |
| ---- | ---- | ----- | ---------- |
| `src/lib/observability/store.server.ts` | `118` | `ObservabilityMetadata` was not assignable to the insert payload metadata type | Payload typing drift between observability metadata and the database insert shape |
| `src/lib/studentApiRoute.server.ts` | `734` | Student profile payload was assignable to `never` | The request/response shape was narrower in the route than the assembled payload |
| `src/lib/superAdmin/apiRoute.server.ts` | `206, 251, 427, 475, 700, 1973, 1992, 2002, 2014, 2026, 2059, 2066, 2100, 2106, 2117, 2129, 2136, 2143, 2160, 2581` | Zod and object-literal mismatches across feature-flag, incident, job, and moderation actions | Shared admin input types were drifting from the route schemas, especially required-vs-optional fields and widened literals |
| `src/lib/platformSettings.server.ts` | `224` | No overload matched the call | Supabase builder/query typing did not line up with the expected payload type |
| `src/lib/studentQr.ts` | `113` | `StudentQrSigningEligibility` was not assignable to the expected parameter | Eligibility union/type shape drift in the QR signing path |
| `src/lib/superAdmin/service.server.ts` | `4186, 4339, 4595, 4839, 4882, 5182, 5207` | Multiple overload and property-shape mismatches | Supabase query builders and derived record types were too narrow or stale for the service layer payloads |
| `src/lib/superAdmin/service.server.ts` | `5626, 5834, 6006` | `StructuredApiResponse<unknown>` was not assignable to the expected concrete response type | Helper return types were widened to `unknown` and needed explicit narrowing |
| `src/lib/superAdmin/service.server.ts` | `6761, 6771, 6780, 6785, 6791, 6800` | `const` assertions and `AdminStatusSignal` references failed to type-check | Status signal types were widened or missing at the call sites |
| `src/lib/superAdmin/service.server.ts` | `7896, 7917, 8264, 8269, 8281, 8284` | Queue payload and helper-argument mismatches | Queue payload construction and query helper signatures were out of sync with the generated database types |
| `src/lib/superAdmin/service.server.ts` | `8560` | Incident-center data was not assignable to `SuperAdminIncidentCenterData` | `metricWindow` widened to `unknown` instead of the literal union |
| `src/lib/superAdmin/service.server.ts` | `9468, 9469, 9512, 9525` | Feature-flag input properties were missing and `cache_ttl_seconds` was not accepted | Stale generated Supabase types plus schema drift in the feature-flag insert path |
| `src/lib/superAdmin/service.server.ts` | `11512, 11538, 11558, 11642, 11673, 11701, 11708, 11722, 11728, 11755, 11770, 11791, 11792, 11793, 11794, 11840, 11849, 11880, 11900, 11991, 11999, 12026, 12035, 12063, 12114, 12132, 12162, 12190, 12205` | Supabase client, PromiseLike, and queue-row typing mismatches | The service layer expected typed `SupabaseClient` and Promise-like builders, but the inferred builders were still using stale or overly generic shapes |
| `src/lib/publicAppUrl.ts` | `20, 21, 44` | `ImportMeta.env` was missing | Vite env typing needed explicit augmentation |
| `src/lib/superAdmin/governanceRuntime.ts` | `822, 828, 830, 1289` | Literal unions widened to `string` | Governance records needed explicit literal preservation for `type`, `shiftState`, `severity`, and `status` |
| Deployment packaging | N/A | `files` exceeded the 15,000-item upload limit; then the deployment failed on the Hobby plan function limit | Raw deployment upload was too large, and the repo contains 16 serverless functions, which exceeds the Hobby cap of 12 |

## Files Changed

- `src/lib/observability/store.server.ts`
- `src/lib/publicAppUrl.ts`
- `src/lib/superAdmin/governance.ts`
- `src/lib/superAdmin/governanceRuntime.ts`
- `src/lib/superAdmin/service.server.ts`
- `src/integrations/supabase/types.ts`
- `src/vite-env.d.ts`
- `.gitignore`

## Root Causes Found

- Stale or incomplete generated Supabase types.
- `Json` and `Record<string, unknown>` shape mismatches in inserts and service payloads.
- Promise vs `PromiseLike` mismatches in helper wrappers around Supabase builders.
- Widened literal unions in governance and admin data structures.
- Missing Vite `ImportMeta.env` augmentation.
- Deployment packaging limits on Vercel.
- Hobby plan serverless function cap exceeded by the current `api/` layout.

## Remaining Blockers

- The production deployment is not `READY`.
- The health endpoint has not been verified for this release because the new production deploy does not complete successfully.
- The current repo structure exceeds the Vercel Hobby plan's 12-function limit.

## Final Status

- `vercel build`: pass
- production deploy: fail
- `/api/health/ready`: not verified for this release
- verdict: `FAIL`

