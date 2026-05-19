# Operational Health Architecture

Date validated: May 19, 2026

## Signal pipeline

The control plane computes health in two layers.

1. Base control-plane signals from `buildStatusSignals()`
   - Database
   - Redis
   - Email
   - API
   - Auth
   - Queue
   - Latency

2. Operational overlays
   - Attendance signal added in `getControlCenterData()`
   - Deployment, queue, and auth overlays merged into `/api/admin/analytics`

## Status mapping

### Database

- source: `getCriticalDatabaseHealth()`
- mapping:
  - `ok` -> `green` / `Healthy`
  - `degraded` -> `yellow` / `Degraded`
  - `failed` -> `red` / `Unhealthy`
- fallback:
  - `yellow` / `Telemetry pending`

### Redis

- source: explicit `PING` through `runRedisOperation()`
- mapping:
  - fast successful ping -> `green`
  - slow ping -> `yellow`
  - no `REDIS_URL` -> `yellow` / `Bypassed`
  - failed ping -> `yellow` / `Degraded`

This was intentionally softened from a blanket red outage because Redis loss here degrades visibility and queue ergonomics, but does not necessarily mean the full admin plane is down.

### API

- source: `buildServerReadiness()`
- mapping:
  - readiness true -> `green` / `Ready`
  - readiness false -> `red` / `Degraded`
  - timeout/no snapshot -> `yellow` / `Telemetry pending`

### Auth

- source:
  - runtime auth success/failure counters
  - failed login totals from `login_logs`
- mapping:
  - >= 98% success -> `green`
  - >= 92% success -> `yellow`
  - below 92% -> `red`

### Queue

- source:
  - runtime queue counters
  - `platform_job_queue`
  - `platform_job_dead_letters`
- mapping:
  - failures present -> `red`
  - retries present -> `yellow`
  - otherwise -> `green`

### Attendance

- source:
  - live `attendance_logs`
  - trailing live series
  - `lastAttendanceAt`
- mapping:
  - scans today -> `green`
  - no scans today but recent prior activity -> `yellow` / `Quiet today`
  - no known scans yet -> `yellow` / `Quiet today`

## System status calculation

The control-plane root status still uses `resolveSystemStatus(signals)`:

- any red base signal -> `red`
- else any yellow base signal -> `yellow`
- else -> `green`

Important nuance:

- the extra analytics overlays and the attendance signal improve operator visibility
- they do not currently override the root color by themselves

This keeps the root state conservative while still showing richer operational context in the health center.

## Resilience model

### Control center

- optional table reads use `readOptionalRows()`
- partial data returns remain successful
- the UI receives real degraded payloads instead of total failure or fake zero-state success

### Analytics center

- uses `Promise.allSettled()`
- only the control center is mandatory
- communication, incidents, security, automation, and billing all degrade independently

### Browser behavior

- control-plane fetch timeout increased to `30000ms`
- dashboard no longer duplicates platform + analytics fetches
- dashboard and analytics subscribe to scoped realtime invalidation instead of polling

## Empty and quiet-state policy

The admin plane now distinguishes between:

- telemetry failure
  - `Telemetry reconnecting`
  - `Control-plane telemetry is temporarily unavailable`

- quiet but healthy operations
  - `Attendance systems are quiet right now`
  - `Automation queues are clear`
  - `No suspicious IPs are elevated right now`
  - `No onboarding conversions have been recorded yet`

- first-data onboarding states
  - `Revenue analytics unlock after the first approved transaction`
  - `Waiting for the first attendance activity`

## Remaining architectural risks

1. The control-plane route is still a wide read fanout.
2. Some local environments still surface Redis connection refusal beneath the degraded signal handling.
3. Secondary observability transports are not configured in this workspace, so admin alert delivery remains a safe no-op failure.
