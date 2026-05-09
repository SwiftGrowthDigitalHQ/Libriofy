import { CRITICAL_DB_ENTITIES, type DatabaseHealthPayload, type DatabaseSchemaEntityCheck } from "./databaseHealth.shared.js";
import { sendAdminAlert } from "./alertService.server.js";
import { logEvent } from "./eventLogger.server.js";
import { captureServerError } from "./serverMonitoring.js";
import { listRecentObservabilitySignals } from "./store.server.js";

type EnvLike = Record<string, string | undefined>;

const DATABASE_HEALTH_CACHE_TTL_MS = 60_000;
const HEALTH_SERVICE_NAME = "supabase-database-health";

let cachedHealth: { expiresAt: number; value: DatabaseHealthPayload } | null = null;
let inFlightHealthCheck: Promise<DatabaseHealthPayload> | null = null;
let lastLoggedFailureSignature = "";

const emptySignals = {
  recentCriticalErrors: [],
  systemWarnings: [],
};

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const buildFailedHealthPayload = (
  detail: string,
  signals: { recentCriticalErrors: DatabaseHealthPayload["recent_critical_errors"]; systemWarnings: DatabaseHealthPayload["system_warnings"] } = emptySignals,
): DatabaseHealthPayload => ({
  checked_at: new Date().toISOString(),
  connectivity: "fail",
  detail,
  entities: CRITICAL_DB_ENTITIES.map((entity_name) => ({
    entity_name,
    exists_in_schema: false,
    relation_name: null,
  })),
  missing: [...CRITICAL_DB_ENTITIES],
  missing_entities: [...CRITICAL_DB_ENTITIES],
  recent_critical_errors: signals.recentCriticalErrors,
  service: HEALTH_SERVICE_NAME,
  source: "live",
  status: "failed",
  system_warnings: signals.systemWarnings,
});

const loadRecentSignals = async (env: EnvLike) => {
  try {
    return await listRecentObservabilitySignals(env);
  } catch (error) {
    console.warn("[health] Unable to load recent observability signals", error);
    captureServerError(error, {
      source: "database_health_recent_signals",
    });

    return emptySignals;
  }
};

const logCriticalSchemaFailure = (payload: DatabaseHealthPayload, phase: string) => {
  if (payload.status === "ok") {
    lastLoggedFailureSignature = "";
    return;
  }

  const signature = `${phase}:${payload.status}:${payload.missing_entities.join(",")}:${payload.detail ?? ""}`;
  if (signature === lastLoggedFailureSignature) {
    return;
  }

  lastLoggedFailureSignature = signature;

  console.error("[health] critical database schema issue", {
    connectivity: payload.connectivity,
    detail: payload.detail,
    missingEntities: payload.missing_entities,
    phase,
    source: "database_health",
    status: payload.status,
  });

  captureServerError(new Error(payload.detail || "Critical database schema validation failed."), {
    connectivity: payload.connectivity,
    missingEntities: payload.missing_entities,
    phase,
    source: "database_health",
    status: payload.status,
  });

  const severity = payload.status === "failed" ? "CRITICAL" : "WARNING";

  void logEvent({
    type: "DATABASE_HEALTH_FAILED",
    status: "FAILED",
    user: HEALTH_SERVICE_NAME,
    metadata: {
      connectivity: payload.connectivity,
      missingEntities: payload.missing_entities,
      phase,
      severity,
      source: "database_health",
      status: payload.status,
    },
    message: payload.detail || "Critical database schema validation failed.",
  });

  void sendAdminAlert({
    type: "DATABASE_HEALTH_FAILED",
    severity,
    user: HEALTH_SERVICE_NAME,
    message: payload.detail || "Critical database schema validation failed.",
    metadata: {
      connectivity: payload.connectivity,
      missingEntities: payload.missing_entities,
      phase,
      source: "database_health",
      status: payload.status,
    },
  });
};

const loadLiveDatabaseHealth = async (env: EnvLike): Promise<DatabaseHealthPayload> => {
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return buildFailedHealthPayload("Supabase URL or service role key is missing.", await loadRecentSignals(env));
  }

  try {
    const endpoint = new URL("/rest/v1/rpc/get_schema_entity_status", supabaseUrl);
    const response = await fetch(endpoint.toString(), {
      body: JSON.stringify({
        p_entities: [...CRITICAL_DB_ENTITIES],
      }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
      },
      method: "POST",
    });

    const rawText = await response.text();
    if (!response.ok) {
      return buildFailedHealthPayload(
        `Schema health RPC failed with status ${response.status}: ${rawText.slice(0, 400) || "Unknown error"}`,
        await loadRecentSignals(env),
      );
    }

    const entities = (JSON.parse(rawText) as DatabaseSchemaEntityCheck[]) ?? [];
    const missingEntities = entities
      .filter((entity) => !entity.exists_in_schema)
      .map((entity) => entity.entity_name);
    const signals = await loadRecentSignals(env);

    return {
      checked_at: new Date().toISOString(),
      connectivity: "pass",
      detail:
        missingEntities.length > 0
          ? `Missing critical database entities: ${missingEntities.join(", ")}.`
          : "Critical database schema verified.",
      entities,
      missing: missingEntities,
      missing_entities: missingEntities,
      recent_critical_errors: signals.recentCriticalErrors,
      service: HEALTH_SERVICE_NAME,
      source: "live",
      status: missingEntities.length > 0 ? "degraded" : "ok",
      system_warnings: signals.systemWarnings,
    };
  } catch (error) {
    return buildFailedHealthPayload(
      error instanceof Error ? error.message : "Unexpected database health validation failure.",
      await loadRecentSignals(env),
    );
  }
};

export const getCriticalDatabaseHealth = async (
  env: EnvLike = process.env,
  options: { forceRefresh?: boolean; phase?: string } = {},
): Promise<DatabaseHealthPayload> => {
  const forceRefresh = options.forceRefresh === true;
  const phase = options.phase ?? "request";

  if (!forceRefresh && cachedHealth && cachedHealth.expiresAt > Date.now()) {
    const cachedValue = {
      ...cachedHealth.value,
      source: "cache" as const,
    };
    logCriticalSchemaFailure(cachedValue, `${phase}:cache`);
    return cachedValue;
  }

  if (!forceRefresh && inFlightHealthCheck) {
    return inFlightHealthCheck;
  }

  inFlightHealthCheck = loadLiveDatabaseHealth(env)
    .then((result) => {
      cachedHealth = {
        expiresAt: Date.now() + DATABASE_HEALTH_CACHE_TTL_MS,
        value: result,
      };
      logCriticalSchemaFailure(result, phase);
      return result;
    })
    .finally(() => {
      inFlightHealthCheck = null;
    });

  return inFlightHealthCheck;
};

export const warmCriticalDatabaseHealth = (env: EnvLike = process.env) => {
  void getCriticalDatabaseHealth(env, {
    forceRefresh: true,
    phase: "startup",
  }).catch(() => undefined);
};
