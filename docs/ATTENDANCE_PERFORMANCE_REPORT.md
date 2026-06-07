# Attendance Performance Report

Scope: production performance validation for Attendance V3.

Use this report after running:

- [`docs/PERFORMANCE_TESTING_GUIDE.md`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/docs/PERFORMANCE_TESTING_GUIDE.md)
- [`scripts/run_attendance_benchmark.ps1`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/scripts/run_attendance_benchmark.ps1)
- [`scripts/run_attendance_benchmark.sql`](/c:/Users/SHOP4/OneDrive/Desktop/Libriofy/scripts/run_attendance_benchmark.sql)

## Benchmark Summary

| Check | Target | Result | PASS / FAIL | Notes |
|---|---:|---:|---|---|
| `process_attendance_scan` | `< 200ms` |  |  |  |
| `get_monthly_attendance_analytics` | `< 300ms` |  |  |  |
| Dashboard attendance query | `< 300ms` |  |  |  |
| Critical sequential scans | None on `attendance_logs` |  |  |  |
| Missing index warnings | None |  |  |  |

## Execution Context

| Field | Value |
|---|---|
| Date |  |
| Supabase project |  |
| Database connection type |  |
| Benchmark runner |  |
| SQL log file |  |
| Database size / load |  |

## Monthly Analytics

### `get_monthly_attendance_analytics` - 100 students

| Metric | Value |
|---|---|
| Query cost |  |
| Total execution time |  |
| Buffer hits |  |
| Buffer reads |  |
| Buffer writes |  |
| Index usage |  |
| Sequential scans |  |

### `get_monthly_attendance_analytics` - 1000 students

| Metric | Value |
|---|---|
| Query cost |  |
| Total execution time |  |
| Buffer hits |  |
| Buffer reads |  |
| Buffer writes |  |
| Index usage |  |
| Sequential scans |  |

## Dashboard Query

### Attendance log read path - 100 students

| Metric | Value |
|---|---|
| Query cost |  |
| Total execution time |  |
| Buffer hits |  |
| Buffer reads |  |
| Buffer writes |  |
| Index usage |  |
| Sequential scans |  |

### Attendance log read path - 1000 students

| Metric | Value |
|---|---|
| Query cost |  |
| Total execution time |  |
| Buffer hits |  |
| Buffer reads |  |
| Buffer writes |  |
| Index usage |  |
| Sequential scans |  |

## Attendance Scan

### `process_attendance_scan` - valid QR

| Metric | Value |
|---|---|
| Query cost |  |
| Total execution time |  |
| Buffer hits |  |
| Buffer reads |  |
| Buffer writes |  |
| Index usage |  |
| Sequential scans |  |

### `process_attendance_scan` - duplicate scan

| Metric | Value |
|---|---|
| Query cost |  |
| Total execution time |  |
| Buffer hits |  |
| Buffer reads |  |
| Buffer writes |  |
| Index usage |  |
| Sequential scans |  |

### `process_attendance_scan` - check-out

| Metric | Value |
|---|---|
| Query cost |  |
| Total execution time |  |
| Buffer hits |  |
| Buffer reads |  |
| Buffer writes |  |
| Index usage |  |
| Sequential scans |  |

### `process_attendance_scan` - check-in again

| Metric | Value |
|---|---|
| Query cost |  |
| Total execution time |  |
| Buffer hits |  |
| Buffer reads |  |
| Buffer writes |  |
| Index usage |  |
| Sequential scans |  |

## Bottlenecks

List every issue observed in the benchmark output.

- Sequential scans:
  - 
- Missing indexes:
  - 
- Slow joins:
  - 
- High-cost operations:
  - 

## Recommendations

Provide exact SQL for any fix that should be applied.

### Missing Indexes

```sql
-- Paste SQL here
```

### Materialized Views

```sql
-- Paste SQL here
```

### Query Rewrites

```sql
-- Paste SQL here
```

## PASS / FAIL Summary

### PASS if all of the following are true

- `process_attendance_scan < 200ms`
- `get_monthly_attendance_analytics < 300ms`
- no critical sequential scans
- no missing index warnings
- no regression from Attendance V3

### FAIL if any of the following are true

- any query exceeds its target
- `Seq Scan` appears on `attendance_logs`
- index usage is not observed
- a missing index warning appears
- the new Attendance V3 path regresses compared with the last known good baseline

### Final Verdict

PASS / FAIL: 

## Notes

- Include the raw `EXPLAIN ANALYZE` output in the benchmark log file.
- Prefer the direct PostgreSQL connection string for benchmarking.
- The benchmark uses a rollback-safe transaction, so test data should not persist.
