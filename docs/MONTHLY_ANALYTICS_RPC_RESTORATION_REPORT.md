# Monthly Analytics RPC Restoration Report

## Verdict
FAIL

The monthly attendance analytics RPC is defined in the repository and I added a restoration migration, but I could not apply the migration to the live Supabase database from this workspace because the Supabase CLI requires an access token or linked DB password that is not available here.

Live evidence still shows the previous failure mode on the direct RPC call:

- `PGRST202`
- `Could not find the function public.get_monthly_attendance_analytics(p_library_id, p_month) in the schema cache`

## Root Cause

The live Supabase backend was missing `public.get_monthly_attendance_analytics(UUID, DATE)` from the deployed schema cache. The repository already contained the canonical Attendance V3 definition, but the live database did not expose the function when the frontend called it.

This points to one of two backend states:

1. The migration that created the RPC was never deployed to the live database.
2. The migration was deployed inconsistently and PostgREST had not refreshed the schema cache.

The evidence favors a deployment / schema-cache issue rather than a frontend shape issue.

## Migration Trace

Canonical definition:

- `/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/supabase/migrations/20260607200000_attendance_v3_monthly_analytics.sql`

This migration creates the RPC with the expected signature:

- `public.get_monthly_attendance_analytics(UUID, DATE)`

It also grants execution to `authenticated` and `service_role`.

Restoration migration added in this task:

- `/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/supabase/migrations/20260614194500_restore_monthly_attendance_analytics.sql`

## Exact SQL Used

The restoration migration creates or replaces the function, keeps it scan-only/read-only, and forces a schema reload:

```sql
CREATE OR REPLACE FUNCTION public.get_monthly_attendance_analytics(
  p_library_id UUID,
  p_month DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE
)
RETURNS TABLE (
  student_id UUID,
  full_name TEXT,
  present_days INTEGER,
  absent_days INTEGER,
  attendance_percent DOUBLE PRECISION,
  last_check_in TIMESTAMPTZ,
  last_check_out TIMESTAMPTZ,
  membership_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET row_security = off
AS $$ ... $$;

REVOKE ALL ON FUNCTION public.get_monthly_attendance_analytics(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_monthly_attendance_analytics(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_attendance_analytics(UUID, DATE) TO service_role;

NOTIFY pgrst, 'reload schema';
```

Full file:

- `/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/supabase/migrations/20260614194500_restore_monthly_attendance_analytics.sql`

## Live Verification Attempts

### 1. Direct Supabase RPC probe

Request:

```text
POST https://hchflmrvmfvunedjhwta.supabase.co/rest/v1/rpc/get_monthly_attendance_analytics
```

Payload:

```json
{
  "p_library_id": "library-1",
  "p_month": "2026-06-01"
}
```

Response:

```json
{
  "code": "PGRST202",
  "details": "Searched for the function public.get_monthly_attendance_analytics with parameters p_library_id, p_month or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.",
  "hint": "Perhaps you meant to call the function public.scan_attendance_entry",
  "message": "Could not find the function public.get_monthly_attendance_analytics(p_library_id, p_month) in the schema cache"
}
```

### 2. Vercel protected health probe

Deployment URL:

```text
https://libriofy-a1e07in4q-swiftgrowthdigitals-projects.vercel.app
```

Commands:

```text
npx vercel curl /api/health/db --deployment https://libriofy-a1e07in4q-swiftgrowthdigitals-projects.vercel.app --trace --json --yes
npx vercel curl /api/health/ready --deployment https://libriofy-a1e07in4q-swiftgrowthdigitals-projects.vercel.app --trace --json --yes
```

Result:

- The protected DB health endpoint is reachable and reports the live linked Supabase project as healthy for the current critical schema contract.
- The generic health route is protected and returned the live health payload via `vercel curl`.
- The existing critical database contract does not currently include the monthly analytics RPC, so this probe cannot by itself prove the RPC is present.

### 3. Supabase CLI deployment path

Attempted commands:

```text
npx supabase migration list --linked
npx supabase projects list
```

Result:

- `supabase projects list` failed with `LegacyPlatformAuthRequiredError` because no `SUPABASE_ACCESS_TOKEN` was available in this workspace.
- `supabase migration list --linked` could not be completed here for the same reason.

## Deployment Steps

To restore the live RPC, the backend should be updated with the new migration and the schema cache should be refreshed:

1. Authenticate the Supabase CLI with `supabase login` or provide `SUPABASE_ACCESS_TOKEN`.
2. Apply the linked migrations to the live project:

```text
supabase db push --linked --include-all --yes
```

3. Confirm the migration ran and the schema cache was refreshed.
4. Re-test the RPC directly:

```text
POST /rest/v1/rpc/get_monthly_attendance_analytics
```

with:

```json
{
  "p_library_id": "<library-uuid>",
  "p_month": "2026-06-01"
}
```

5. Confirm the RPC returns `200` and a JSON array of student analytics rows.

## Verification Queries

Once the live DB is accessible, run:

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_name = 'get_monthly_attendance_analytics';
```

and, for the exact signature:

```sql
SELECT routine_name, data_type
FROM information_schema.routines
WHERE routine_name = 'get_monthly_attendance_analytics';
```

If the live database supports the expected contract, the function should be visible as `public.get_monthly_attendance_analytics`.

## Files Changed

- `/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/supabase/migrations/20260614194500_restore_monthly_attendance_analytics.sql`
- `/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/docs/MONTHLY_ANALYTICS_RPC_RESTORATION_REPORT.md`

## PASS / FAIL

FAIL

Reason:

- Live database apply was not completed from this workspace because Supabase CLI auth is unavailable.
- The direct RPC probe still returned `PGRST202` before the restoration migration was applied.
- I cannot honestly claim the production RPC exists or returns `200` until the migration is pushed to the live project and rechecked.

## Notes

- Scanner logic was not modified.
- `process_attendance_scan` was not modified.
- The attendance write path was not modified.
- The SQL migration keeps the RPC read-only and scan-only.
