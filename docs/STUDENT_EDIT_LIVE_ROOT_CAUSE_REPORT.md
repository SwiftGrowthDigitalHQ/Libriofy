# Student Edit Live Root Cause Report

## Verdict

FAIL

## Root Cause

Student edit was not persisting because the server-side student auth/update path preferred `SUPABASE_URL` over `VITE_SUPABASE_URL`.

In this production environment, the Supabase URL values drifted, and `SUPABASE_URL` pointed at the stale project while `VITE_SUPABASE_URL` pointed at the live linked project.

That meant the save flow could authenticate or write against the wrong Supabase project, so the edit appeared to run but did not persist in the live app.

## Exact Failing Files

- [`src/lib/requestAuth.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/requestAuth.server.ts)
- [`src/lib/studentApiRoute.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/studentApiRoute.server.ts)

## Exact Failing Lines

- `src/lib/requestAuth.server.ts:104`
- `src/lib/studentApiRoute.server.ts:240`

Those lines originally resolved Supabase URLs with `SUPABASE_URL` first.

## Exact Supabase Diagnostic

Live readiness output showed URL drift between the two runtime env vars:

- `SUPABASE_URL` -> `https://xaoitjyuuxwksofmmydh.supabase.co/`
- `VITE_SUPABASE_URL` -> `https://hchflmrvmfvunedjhwta.supabase.co/`

That drift is the concrete runtime condition that broke the save path.

## Exact Fix

The student auth/update helpers now prefer `VITE_SUPABASE_URL` first, then fall back to `SUPABASE_URL`:

- [`src/lib/requestAuth.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/requestAuth.server.ts)
- [`src/lib/studentApiRoute.server.ts`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/lib/studentApiRoute.server.ts)

## Verification Evidence

### Local proof

- `npx vitest run src/test/studentUpdateRoute.test.ts` passed.
- `npx tsc --noEmit` passed.

The regression test now proves the route uses the live linked Supabase URL even when `SUPABASE_URL` is drifted.

### Live proof available in this workspace

- Production deployment is `READY`.
- `/dashboard/students` responds with `200`.
- The runtime diagnostics still show the Supabase URL drift that caused the failure.

### Live proof not captured

- A signed-in browser `Save Changes` click on a real student record.
- Live PATCH request payload and response payload.
- Before/after field values on a persisted student row after refresh.

## PASS / FAIL

FAIL

## Why This Is Still FAIL

- The root cause is fixed in code, but I could not capture a real authenticated live browser save in this workspace.
- Because the user explicitly required production proof, the report stays FAIL until the UI save is proven end-to-end on a real student record.
