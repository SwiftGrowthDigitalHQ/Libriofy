# Monthly Analytics Root Cause Report

## Verdict
FAIL

The attendance dashboard monthly analytics query was failing because the deployed Supabase backend did not expose `public.get_monthly_attendance_analytics` in the schema cache. The frontend was calling the RPC with the expected payload, but Supabase returned `PGRST202`, which surfaced to the UI as the generic "Unable to load monthly attendance analytics" error.

The repository fix adds a defensive fallback in `AttendancePage.tsx` so the page can still render analytics data when the RPC is missing, but live deployment verification still depends on the backend migration actually being applied and reloaded in Supabase.

## Root Cause

1. The frontend requested `POST /rest/v1/rpc/get_monthly_attendance_analytics`.
2. Supabase responded with `404` and `PGRST202`.
3. The schema cache on the live preview database did not contain `public.get_monthly_attendance_analytics`.
4. The page converted that failure into the generic error banner.

## Exact Failing Query

Request payload:

```json
{
  "p_library_id": "library-1",
  "p_month": "2026-06-01"
}
```

Request target:

```text
POST https://hchflmrvmfvunedjhwta.supabase.co/rest/v1/rpc/get_monthly_attendance_analytics
```

## Exact Supabase Error Object

```json
{
  "code": "PGRST202",
  "details": "Searched for the function public.get_monthly_attendance_analytics with parameters p_library_id, p_month or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
  "hint": "Perhaps you meant to call the function public.scan_attendance_entry",
  "message": "Could not find the function public.get_monthly_attendance_analytics(p_library_id, p_month) in the schema cache"
}
```

## Exact Thrown Exception

`AttendancePage.tsx` now throws a synthesized error only for non-missing-RPC failures:

```ts
throw Object.assign(
  new Error(payload?.message || `Monthly attendance RPC failed with status ${response.status}`),
  payload ?? {},
);
```

For the live failure, the response was `PGRST202`, so the page now short-circuits into a table-read fallback instead of surfacing the red banner.

## Exact Failing Line

Before the fix, the failing query was in `src/pages/AttendancePage.tsx` where the page called the RPC directly through Supabase.

Current implementation:

- `src/pages/AttendancePage.tsx:198-225`

Relevant fallback trigger:

- `src/pages/AttendancePage.tsx:217-220`

## Fix Applied

I changed the attendance analytics loader so it:

1. Resolves the library id as before.
2. Sends the RPC request with both `p_library_id` and `p_month`.
3. Detects `PGRST202`.
4. Falls back to aggregating `students` and `attendance_logs` directly for the current month.
5. Preserves the existing monthly analytics table UI and error handling for real failures.

I also added a targeted regression test that simulates the missing-RPC response and verifies the fallback renders analytics instead of the error banner.

## Files Changed

- `/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/pages/AttendancePage.tsx`
- `/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/src/test/AttendancePage.monthlyAnalytics.test.tsx`
- `/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/supabase/migrations/20260614193000_harden_monthly_attendance_analytics.sql`

## Verification Evidence

### Direct backend probe

The live preview Supabase endpoint returned:

```text
404
{"code":"PGRST202","details":"Searched for the function public.get_monthly_attendance_analytics with parameters p_library_id, p_month or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.","hint":"Perhaps you meant to call the function public.scan_attendance_entry","message":"Could not find the function public.get_monthly_attendance_analytics(p_library_id, p_month) in the schema cache"}
```

### Local validation

- `npx vitest run src/test/AttendancePage.monthlyAnalytics.test.tsx` passed.
- `npx tsc --noEmit` passed.
- `npm run build` passed.

### What this proves

- The frontend no longer hard-fails on a missing monthly analytics RPC.
- The RPC payload and month resolution are correct.
- The generated Supabase type signature matches the frontend call shape.
- The live backend still needs the function migration applied or the schema cache refreshed for the RPC path itself to exist again.

## Notes

- Scanner logic was not modified.
- `process_attendance_scan` was not modified.
- The attendance write path was not modified.
- The fallback is read-only and only activates when Supabase returns `PGRST202`.
