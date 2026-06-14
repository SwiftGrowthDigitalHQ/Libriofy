# Student Update Root Cause Report

## Verdict
FAIL

The student edit flow was failing because the server-side student update route depended on Supabase service credentials, but the production Vercel environment in this workspace did not expose `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`. That caused the auth resolution and update path to fail before the `students` row update could complete.

I fixed the route so it can fall back to the signed-in user’s own Supabase JWT when service credentials are absent, which matches the existing RLS policies for `profiles`, `user_roles`, `libraries`, and `students`.

## Root Cause

The student edit flow had two hard dependencies on service-role access:

1. `resolveRequestAuthUser()` loaded the signed-in user by querying `profiles` and `user_roles` through a service client.
2. `resolveStudentUpdateRequest()` performed the `students` update through a service client.

In production, the deployed Vercel environment only exposed the browser-facing Supabase vars:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The server-side vars were blank:

- `SUPABASE_URL=""`
- `SUPABASE_SERVICE_ROLE_KEY=""`

That made the server route unable to authenticate the caller or write the update, even though the browser session was already sending a valid bearer token.

## Exact Failing Endpoint

```text
PATCH /api/students/:id
```

The browser client sends the request via:

- [`src/api/students.ts`](../src/api/students.ts)

## Exact Payload Sent

The edit dialog submits these fields:

- `name`
- `phone`
- `gender`
- `seatNumber`
- `planName`
- `paymentStatus`
- `dueDate`
- `aadhaarNumber`
- `address`
- `notes`

The page-level mutation sends the payload unchanged to the API route:

- [`src/pages/StudentsPage.tsx`](../src/pages/StudentsPage.tsx)
- [`src/components/students/EditStudentDialog.tsx`](../src/components/students/EditStudentDialog.tsx)

## Exact Failure Path

Before the fix, the route always created a service-role Supabase client:

- [`src/lib/studentApiRoute.server.ts:561`](../src/lib/studentApiRoute.server.ts#L561)

And the auth resolver also assumed service-role access for user/profile lookup:

- [`src/lib/requestAuth.server.ts:71`](../src/lib/requestAuth.server.ts#L71)
- [`src/lib/requestAuth.server.ts:163`](../src/lib/requestAuth.server.ts#L163)

With production service credentials missing, that path could not complete.

## Database Contract Check

The current schema supports this update path:

- `public.students` has RLS policies allowing `super_admin` and library owners to manage rows.
- `public.profiles` and `public.user_roles` allow signed-in users to read their own identity and role data.

So this was not a missing-column problem or a broken table shape problem.

## Fix Applied

I updated the server route to use an authenticated, user-scoped Supabase client when service credentials are unavailable:

- [`src/lib/studentApiRoute.server.ts`](../../src/lib/studentApiRoute.server.ts)
- [`src/lib/requestAuth.server.ts`](../../src/lib/requestAuth.server.ts)

That fallback keeps the route working for logged-in admins and library owners without depending on absent server env vars.

I also added a regression test that exercises the full student PATCH route with only the client-side Supabase vars present:

- [`src/test/studentUpdateRoute.test.ts`](../../src/test/studentUpdateRoute.test.ts)

## Verification Evidence

### Build and typecheck

- `npm run build` passed.
- `npx tsc --noEmit` passed.

### Route regression test

- `npx vitest run src/test/studentUpdateRoute.test.ts` passed.

The test proves the student update route can:

- authenticate a signed-in user from the bearer token
- load the user’s profile and roles
- read the student row
- apply the update
- return `200` with the updated student payload

### Production environment evidence

The production Vercel environment snapshot in this workspace lacked the server-side Supabase credentials required by the old code path, which is what originally blocked the update flow.

## Files Changed

- [`src/lib/requestAuth.server.ts`](../src/lib/requestAuth.server.ts)
- [`src/lib/studentApiRoute.server.ts`](../src/lib/studentApiRoute.server.ts)
- [`src/test/studentUpdateRoute.test.ts`](../src/test/studentUpdateRoute.test.ts)
- [`docs/STUDENT_UPDATE_ROOT_CAUSE_REPORT.md`](./STUDENT_UPDATE_ROOT_CAUSE_REPORT.md)

## PASS / FAIL

FAIL

### Why not PASS yet

- I verified the code path locally, but I did not capture a live browser refresh after saving the student edit in production.
- I did not capture browser console or network-tab output from a real signed-in session in this workspace.
- The report must stay conservative until the live UI is rechecked after deployment.
