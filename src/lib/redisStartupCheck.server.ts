/**
 * Redis Production Startup Validation
 * 
 * Call this at server boot to verify Redis is reachable.
 * In production, a failed check should prevent the server from accepting traffic.
 */
import IORedis from "ioredis";

type EnvLike = Record<string, string | undefined>;

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) return value.trim();
  }
  return "";
};

const isProduction = (env: EnvLike) => {
  const appEnv = readEnv(env, "APP_ENV", "NODE_ENV").toLowerCase();
  return appEnv === "production" || appEnv === "staging";
};

export type RedisHealthStatus = {
  connected: boolean;
  latencyMs: number | null;
  error: string | null;
  memoryUsageMb: number | null;
  version: string | null;
};

/**
 * Validates Redis connectivity at startup.
 * Returns health status. In production, caller should abort if not connected.
 */
export const checkRedisHealth = async (env: EnvLike = process.env): Promise<RedisHealthStatus> => {
  const redisUrl = readEnv(env, "REDIS_URL");

  if (!redisUrl) {
    if (isProduction(env)) {
      return { connected: false, latencyMs: null, error: "REDIS_URL is not configured. Required in production.", memoryUsageMb: null, version: null };
    }
    return { connected: false, latencyMs: null, error: "REDIS_URL not set (acceptable in development)", memoryUsageMb: null, version: null };
  }

  const client = new IORedis(redisUrl, {
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // Don't retry during health check
    lazyConnect: true,
  });

  try {
    const start = Date.now();
    await client.connect();
    await client.ping();
    const latencyMs = Date.now() - start;

    let memoryUsageMb: number | null = null;
    let version: string | null = null;

    try {
      const info = await client.info("memory");
      const memMatch = info.match(/used_memory:(\d+)/);
      if (memMatch) memoryUsageMb = Math.round(Number(memMatch[1]) / 1024 / 1024 * 100) / 100;
      const verMatch = info.match(/redis_version:(.+)/);
      if (verMatch) version = verMatch[1].trim();
    } catch {
      // Info command may not be available on all Redis providers
    }

    return { connected: true, latencyMs, error: null, memoryUsageMb, version };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Redis connection failed";
    return { connected: false, latencyMs: null, error: message, memoryUsageMb: null, version: null };
  } finally {
    try { await client.quit(); } catch { client.disconnect(); }
  }
};

/**
 * Validates Redis at startup. Logs result. Returns true if healthy.
 * In production, returns false if Redis is unreachable (caller should abort).
 */
export const validateRedisOnStartup = async (env: EnvLike = process.env): Promise<boolean> => {
  const health = await checkRedisHealth(env);

  if (health.connected) {
    console.log(`[redis] ✓ Connected (${health.latencyMs}ms latency, ${health.memoryUsageMb ?? "?"}MB used, v${health.version ?? "unknown"})`);
    return true;
  }

  if (isProduction(env)) {
    console.error(`[redis] ✗ PRODUCTION STARTUP BLOCKED — ${health.error}`);
    console.error("[redis] Redis is REQUIRED in production for OTP, rate limiting, and job queues.");
    return false;
  }

  console.warn(`[redis] ⚠ ${health.error} — using in-memory fallback (development only)`);
  return true; // Allow startup in dev without Redis
};
