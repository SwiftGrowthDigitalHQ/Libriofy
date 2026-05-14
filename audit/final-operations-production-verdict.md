# Operations & Observability Production Verdict — Libriofy

> Audited: May 2026 | Role: Senior Site Reliability Engineer

---

## VERDICT: NOT OPERATIONALLY READY

The team would discover most outages from customer complaints, not monitoring.

---

## 1. What EXISTS (Internal Observability)

### Impressive Internal Framework (`src/lib/observability/` — 33 files)

| Component | File | Status |
|-----------|------|--------|
| Event logger | `eventLogger.server.ts` | ✅ Logs to `app_event_logs` table |
| Runtime metrics | `runtimeMetrics.server.ts` | ✅ Counters, gauges, latency histograms |
| Request tracing | `requestContext.server.ts` | ✅ Correlation IDs, trace IDs |
| Database health | `databaseHealth.server.ts` | ✅ Periodic health checks |
| Server health | `serverHealth.server.ts` | ✅ Liveness/readiness reports |
| Alert service | `alertService.server.ts` | ✅ Internal alert generation |
| Admin dashboard | `SuperAdminObservability.tsx` | ✅ Trace console, metrics view |
| Incident grouping | `superAdmin/model.ts` | ✅ Groups events into incidents |
| Health endpoints | `api/health/[...route].ts` | ✅ `/api/health/live`, `/ready`, `/db` |

### What This Means
The codebase has a **self-contained observability system** that logs events to its own database and displays them in the admin panel. This is useful for debugging but **NOT for production alerting**.

---

## 2. What's MISSING (External Monitoring)

### Critical Gaps

| System | Status | Impact |
|--------|--------|--------|
| **Sentry** (error tracking) | ❌ DSN empty in `.env` | Frontend crashes invisible |
| **External uptime monitor** | ❌ None configured | Site-down undetected |
| **Slack/Discord/Email alerts** | ❌ None | Team not notified of issues |
| **APM** (Datadog/New Relic) | ❌ None | Can't trace production latency |
| **Log aggregation** (Logtail/Axiom) | ❌ None | Logs lost on restart |
| **Webhook monitoring** | ❌ None | Failed Razorpay webhooks invisible |
| **Synthetic monitoring** | ❌ None | Can't detect partial outages |
| **On-call rotation** | ❌ None | Nobody responsible at 2AM |

### Evidence from `.env`:
```
SENTRY_DSN=                          # Empty — no error tracking
SENTRY_ENVIRONMENT=staging
SENTRY_TRACES_SAMPLE_RATE=0          # Zero — no performance tracing
```

---

## 3. Failure Detection Simulation

### Scenario: Redis Goes Down at 2AM

| Time | What Happens | Detected? |
|------|-------------|-----------|
| 2:00 AM | Redis disconnects | ❌ No alert |
| 2:01 AM | Super admin login fails | ❌ No one logging in at 2AM |
| 2:02 AM | Rate limiting stops working | ❌ No external check |
| 2:05 AM | Circuit breaker opens, metrics logged to DB | ❌ Only visible in admin panel |
| 8:00 AM | Admin tries to log in, fails | ✅ Discovered manually |
| **Detection time: 6 hours** | | |

### Scenario: Razorpay Webhook Fails

| Time | What Happens | Detected? |
|------|-------------|-----------|
| Day 1 | Customer pays, webhook fails | ❌ No alert |
| Day 1 | Payment shows in Razorpay but not in Libriofy | ❌ No reconciliation |
| Day 3 | Customer complains "I paid but no access" | ✅ Support ticket |
| **Detection time: 2-3 days** | | |

### Scenario: Database Slow (Supabase overloaded)

| Time | What Happens | Detected? |
|------|-------------|-----------|
| 10:00 AM | Queries take 3-5s | ❌ No latency alert |
| 10:05 AM | Admin dashboard times out | ❌ Only if admin is looking |
| 10:10 AM | `AUTH_ROUTE_SLOW` events logged internally | ❌ Only in admin panel |
| 10:30 AM | Library owners report slow dashboard | ✅ Customer complaint |
| **Detection time: 30 minutes** | | |

### Scenario: Frontend Crash (React error)

| Time | What Happens | Detected? |
|------|-------------|-----------|
| Anytime | Component throws, error boundary catches | ❌ Sentry DSN empty |
| Anytime | User sees error screen, refreshes | ❌ No tracking |
| Days later | Multiple users report same issue | ✅ Support volume |
| **Detection time: Days** | | |

---

## 4. Current Metrics Architecture

### Internal Metrics (in-memory, per-process)

```typescript
// src/lib/observability/runtimeMetrics.server.ts
incrementRuntimeMetric("http_requests_total", 1, { ... });
recordRuntimeLatency("http_request_latency_ms", durationMs, { ... });
recordRuntimeGauge("redis_connections_active", count, { ... });
```

**Problem:** These metrics are stored in process memory. In serverless (Vercel), each invocation has its own memory space. Metrics are lost between requests. The admin dashboard only sees metrics from the current process.

### Event Logs (database-persisted)

```typescript
// src/lib/observability/eventLogger.server.ts
await logEvent({ type: "AUTH_ERROR", status: "FAILED", ... });
```

**Problem:** Events are written to `app_event_logs` table. This survives restarts but:
- No external alerting on critical events
- Table grows unbounded (no retention policy)
- Querying large event tables is slow
- No real-time streaming to external systems

---

## 5. What Would Make This Production-Ready

### Minimum Viable Monitoring (for 100 customers)

| Priority | System | Tool | Cost | Setup Time |
|----------|--------|------|------|------------|
| P0 | Error tracking | Sentry | Free tier | 30 min |
| P0 | Uptime monitoring | BetterUptime/UptimeRobot | Free | 15 min |
| P0 | Alert notifications | Slack webhook | Free | 20 min |
| P1 | Log aggregation | Axiom/Logtail | Free tier | 1 hour |
| P1 | Webhook monitoring | Custom health check | Free | 1 hour |
| P2 | APM | Sentry Performance | Free tier | 30 min |
| P2 | Synthetic monitoring | Checkly | Free tier | 1 hour |

**Total cost: $0-20/month. Total setup: 1 day.**

---

## 6. Incident Response Readiness

### Current State

| Capability | Status |
|------------|--------|
| Incident severity levels | ✅ Defined (CRITICAL/ERROR/WARNING/INFO) |
| Incident grouping | ✅ Automatic in admin panel |
| SLA tracking | ✅ Time-to-acknowledge, time-to-resolve |
| Escalation rules | ❌ None — single admin |
| On-call rotation | ❌ None |
| Runbooks | ❌ None |
| Post-mortem process | ❌ None |
| Status page | ❌ None |
| Customer communication | ❌ None |

### Recovery Procedures

| Failure | Recovery | Automated? |
|---------|----------|------------|
| Redis down | Restart Redis / switch provider | ❌ Manual |
| DB slow | Check Supabase dashboard | ❌ Manual |
| Webhook missed | Check Razorpay dashboard | ❌ Manual |
| Frontend crash | Deploy fix | ❌ Manual |
| Auth broken | Check env vars, restart | ❌ Manual |
| Queue stuck | Admin panel retry | ⚠️ Semi-manual |

---

## 7. Scaling Simulation

### At 100 Customers — Operational Load

| Metric | Daily Volume | Monitoring Need |
|--------|-------------|-----------------|
| API requests | ~50,000 | Latency tracking |
| QR scans | ~3,000 | Success rate monitoring |
| Auth events | ~500 | Failure rate alerting |
| Payments | ~10 | Webhook verification |
| Admin actions | ~50 | Audit trail |
| Background jobs | ~200 | Queue health |

### Would the Team Detect Issues?

| Issue | Current Detection | Required Detection |
|-------|-------------------|-------------------|
| Site completely down | ❌ Customer complaint | ✅ <1 min (uptime monitor) |
| Partial API failure | ❌ Customer complaint | ✅ <5 min (error rate alert) |
| Slow dashboard | ❌ Admin notices | ✅ <5 min (latency alert) |
| Payment webhook fail | ❌ Customer complaint (days) | ✅ <1 hour (reconciliation) |
| Redis disconnect | ❌ Admin login fails | ✅ <2 min (health check) |
| Frontend crash spike | ❌ Never (Sentry empty) | ✅ <5 min (Sentry alert) |
| Queue backlog | ❌ Admin panel check | ✅ <10 min (queue alert) |

---

## 8. Final Verdict

| Customers | Operationally Safe? | Reasoning |
|-----------|--------------------|-----------| 
| 10 | ⚠️ Risky | Issues found manually within hours |
| 50 | ❌ Unsafe | Too many failure paths to monitor manually |
| 100 | ❌ Unsafe | Guaranteed missed incidents |
| 500 | ❌ Dangerous | Operational chaos |

---

## Honest Answer

> "If Libriofy partially broke at 2AM, how quickly would anyone know?"

**Nobody would know until morning (6-8 hours later).** There is zero external alerting. No uptime monitor. No Sentry. No Slack notifications. No on-call. The internal observability framework logs events to the database, but nobody is watching the database at 2AM.

The admin would discover the issue when they try to log in the next morning, or when customers start complaining via WhatsApp/email.

**For a SaaS serving 100 paying customers, this is unacceptable.** A single night of undetected downtime could mean:
- 100 libraries unable to scan attendance for morning shift
- Lost revenue from failed payment webhooks
- Customer trust damage
- No data about what went wrong (logs lost in serverless)

**The fix is simple and free:** Configure Sentry (30 min), add UptimeRobot (15 min), add a Slack webhook for critical events (20 min). Total: 1 hour of work for 24/7 visibility.
