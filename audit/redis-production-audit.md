# Redis Production Audit — Libriofy

> Audited: May 2026 | Role: Senior Production Infrastructure Engineer

---

## 1. Redis Usage Map

| File | Purpose | Data Type | Survives Restart? | Data Loss Risk |
|------|---------|-----------|-------------------|----------------|
| `src/lib/otpAuth.server.ts` | OTP storage (super admin) | Hashed OTP + metadata | ❌ In-memory fallback | **Critical** — OTP lost mid-flow |
| `src/lib/otpAuth.server.ts` | Rate limiting (login/verify) | Counters with TTL | ❌ In-memory fallback | Medium — rate limits reset |
| `src/lib/otpAuth.server.ts` | Super admin block tracking | Block flags with TTL | ❌ In-memory fallback | Medium — blocked users unblocked |
| `src/lib/otpAuth.server.ts` | BullMQ WhatsApp fallback queue | Job payloads | ❌ In-memory fallback | **High** — SMS jobs lost |
| `src/lib/superAdmin/service.server.ts` | Operational locks | Distributed locks | ❌ Memory fallback | Medium — duplicate operations |
| `src/lib/superAdmin/service.server.ts` | Feature flag cache | Serialized flags | ❌ Memory fallback | Low — refetched from DB |
| `src/lib/superAdmin/service.server.ts` | Circuit breaker state | Failure counters | ❌ Memory only | Low — resets on restart |
| `src/lib/superAdmin/apiRoute.server.ts` | Admin API rate limiting | Counters | ❌ Memory fallback | Low — limits reset |

---

## 2. Dangerous In-Memory Fallbacks

### Location 1: `src/lib/otpAuth.server.ts` — Lines 666-810

```typescript
// In-memory Redis-compatible store for local development
const inMemoryStore = new Map<string, { value: string; expiresAt: number | null }>();
```

**Risk:** If `REDIS_URL` is set but Redis is unreachable, the code falls back to in-memory. In serverless (Vercel), each invocation gets a fresh memory space — OTPs stored in one invocation are invisible to the next.

**What breaks:**
- User requests OTP → stored in invocation A's memory
- User verifies OTP → hits invocation B → OTP not found → "OTP expired"
- Super admin login becomes impossible

### Location 2: `src/lib/otpAuth.server.ts` — `getRedisConnection` retry strategy

```typescript
retryStrategy: (times: number) => {
  if (times > 3 && isNonProductionAuthEnv(env)) {
    return null as unknown as number; // Stop retrying in dev
  }
  return Math.min(250 * times, 2_000);
}
```

**Risk:** In production, retries continue forever with 2s max delay. If Redis is permanently down, every request hangs for 2s on each Redis operation before timing out.

### Location 3: `src/lib/superAdmin/service.server.ts` — `runRedisOperation`

```typescript
const runRedisOperation = async <T>(env, operationName, operation, fallback) => {
  const redis = getRedisClient(env);
  if (!redis || isDependencyCircuitOpen("redis")) {
    return await fallback(); // Silent fallback
  }
  // ...timeout + fallback on error
}
```

**Risk:** Every Redis failure silently falls back to in-memory. Admin operations (locks, rate limits) lose consistency. Two admins can execute the same governed action simultaneously.

### Location 4: `src/lib/superAdmin/apiRoute.server.ts` — Rate limiting

```typescript
const memoryRateLimitStore = new Map<string, { count: number; resetAt: number }>();
```

**Risk:** Rate limiting is per-process. In serverless, each invocation has its own counter. Rate limiting is effectively disabled.

---

## 3. BullMQ Assessment

### Current State
- BullMQ imported in `otpAuth.server.ts` for WhatsApp fallback queue
- Queue created with `new Queue<FallbackJobData>(...)` 
- Worker created with `new Worker(...)`
- **No persistent connection** — uses same Redis client that may be in-memory

### Issues
- Jobs are lost if Redis is unavailable (queued to in-memory proxy which doesn't implement BullMQ protocol)
- No dead-letter queue configuration
- No stalled job recovery
- Worker runs in same process as API — serverless cold starts kill workers
- No job completion callbacks or monitoring

---

## 4. Production Impact Assessment

### If Redis Goes Down During Peak Usage (100 customers):

1. **Immediate (0-5 seconds):**
   - All super admin login attempts fail (OTP can't be stored/verified)
   - Rate limiting stops working (falls back to per-process memory)
   - Admin API rate limits reset

2. **Short-term (5-60 seconds):**
   - Circuit breaker opens after 3 failures
   - All Redis operations fall back to memory
   - BullMQ jobs silently lost
   - Distributed locks become process-local (race conditions possible)

3. **Ongoing (Redis still down):**
   - Super admin auth completely broken
   - WhatsApp OTP fallback queue not processing
   - Rate limiting ineffective (brute force possible)
   - Admin governed actions lose idempotency protection

4. **After Redis recovers:**
   - In-memory OTPs are stale/lost — users must restart login
   - BullMQ jobs queued during outage are permanently lost
   - Rate limit counters reset — brief window of no protection
   - No automatic recovery notification

---

## 5. Production Verdict

| Customer Count | Safe? | Reasoning |
|----------------|-------|-----------|
| 10 customers | ⚠️ Risky | Works if Redis stays up. No resilience. |
| 50 customers | ❌ Unsafe | Redis failure = auth outage for all admins |
| 100 customers | ❌ Unsafe | Need HA Redis + proper error handling |
| 500 customers | ❌ Unsafe | Need Redis Cluster + connection pooling |

### Minimum Requirements for 100 Customers:
1. Managed Redis with persistence (Redis Cloud, Upstash, AWS ElastiCache)
2. Remove in-memory fallback in production
3. Fail loudly on Redis unavailability (return 503, don't silently degrade)
4. Add Redis health check endpoint
5. Add reconnection monitoring/alerting
6. Move BullMQ to dedicated worker process (not in API handler)

---

## 6. Recommended Architecture

```
Production:
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│ API Server  │────▶│ Managed Redis    │◀────│ BullMQ      │
│ (Vercel)    │     │ (Upstash/Redis   │     │ Worker      │
│             │     │  Cloud, TLS,     │     │ (separate   │
│             │     │  persistence)    │     │  process)   │
└─────────────┘     └──────────────────┘     └─────────────┘

Development:
┌─────────────┐     ┌──────────────────┐
│ Vite Dev    │────▶│ In-Memory Store  │ (only if REDIS_URL unset)
│ Server      │     │ (acceptable)     │
└─────────────┘     └──────────────────┘
```

---

*End of audit.*
