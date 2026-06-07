# Performance Testing Guide

This guide explains how to benchmark Attendance V3 against a Supabase PostgreSQL database and how to interpret the results.

## What You Need

- A direct Supabase PostgreSQL connection string.
- `psql` installed locally.
- A linked benchmark SQL file:
  - [`scripts/run_attendance_benchmark.sql`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/scripts/run_attendance_benchmark.sql)
- A PowerShell shell on Windows.

## How To Obtain The Supabase Connection String

Use the direct database connection string, not the transaction pooler string.

### Supabase Dashboard

1. Open your Supabase project.
2. Go to `Project Settings`.
3. Open `Database`.
4. Copy the direct `Connection string` URI.
5. Prefer the direct PostgreSQL host for benchmarking so the session can use temporary tables and `EXPLAIN ANALYZE` safely.

### Recommended Connection String Shape

Use a connection string like:

```text
postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
```

## How To Run The Benchmark

### PowerShell

```powershell
$env:DATABASE_URL = "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
.\scripts\run_attendance_benchmark.ps1
```

You can also pass the connection string directly:

```powershell
.\scripts\run_attendance_benchmark.ps1 -ConnectionString "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
```

### Direct `psql`

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/run_attendance_benchmark.sql
```

## What The Benchmark Measures

The benchmark script measures:

- `public.get_monthly_attendance_analytics`
- dashboard attendance read queries
- `public.process_attendance_scan`

It also prints probe queries that expose:

- index usage
- sequential scans
- buffer reads and writes
- query cost
- total execution time

## How To Read `EXPLAIN ANALYZE`

Look for these fields in each plan:

- `cost=...`
- `actual time=...`
- `Buffers: shared hit=... read=... dirtied=... written=...`
- `Index Scan`
- `Bitmap Index Scan`
- `Seq Scan`

### Good Signs

- `Index Scan` or `Bitmap Index Scan` appears for students, attendance logs, or entry devices.
- `Seq Scan` does not appear on `attendance_logs` for hot-path probes.
- Execution time stays under the target.

### Bad Signs

- `Seq Scan on public.attendance_logs`
- `Seq Scan on public.students` for the QR lookup probe
- `Seq Scan on public.entry_devices` for device validation
- Total execution time exceeds the target

## Benchmark Targets

PASS if all of the following are true:

- `process_attendance_scan < 200ms`
- `get_monthly_attendance_analytics < 300ms`
- no critical sequential scans
- no missing index warnings

FAIL if any of the following are true:

- any query exceeds its target
- a full table scan appears on `attendance_logs`
- index usage is not observed

## What To Copy Into The Report

After running the benchmark, copy these values into the report template:

- execution time
- query cost
- buffer usage
- index usage
- sequential scans
- recommendations
- PASS / FAIL summary

## Notes

- The benchmark uses a transaction and rolls back at the end.
- The test data does not persist.
- For the cleanest result, run the benchmark on a quiet database instance.
- If you use a pooled connection string, switch to the direct PostgreSQL connection first.
