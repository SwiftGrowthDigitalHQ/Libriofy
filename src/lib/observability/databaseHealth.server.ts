import {
  classifyAuthRuntimeFailure,
  CRITICAL_DB_ENTITIES,
  type AuthRuntimeContractCheck,
  type AuthRuntimeFailureCategory,
  type AuthRuntimeHealthPayload,
  type DatabaseHealthPayload,
  type DatabaseSchemaEntityCheck,
} from "./databaseHealth.shared.js";
import { sendAdminAlert } from "./alertService.server.js";
import { logEvent } from "./eventLogger.server.js";
import { captureServerError } from "./serverMonitoring.js";
import { listRecentObservabilitySignals } from "./store.server.js";
import { resolveSupabaseAdminConfig } from "./supabaseAdminConfig.server.js";

type EnvLike = Record<string, string | undefined>;

const DATABASE_HEALTH_CACHE_TTL_MS = 60_000;
const HEALTH_SERVICE_NAME = "supabase-database-health";

let cachedHealth: { expiresAt: number; value: DatabaseHealthPayload } | null = null;
let inFlightHealthCheck: Promise<DatabaseHealthPayload> | null = null;
let cachedAuthRuntimeHealth: { expiresAt: number; value: AuthRuntimeHealthPayload } | null = null;
let inFlightAuthRuntimeHealthCheck: Promise<AuthRuntimeHealthPayload> | null = null;
let lastLoggedFailureSignature = "";

const emptySignals = {
  recentCriticalErrors: [],
  systemWarnings: [],
};

const supabaseRequestHeaders = (serviceRoleKey: string) => ({
  Accept: "application/json",
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
  apikey: serviceRoleKey,
});

const buildFailedHealthPayload = (
  detail: string,
  signals: { recentCriticalErrors: DatabaseHealthPayload["recent_critical_errors"]; systemWarnings: DatabaseHealthPayload["system_warnings"] } = emptySignals,
  options: {
    authRuntimeChecks?: AuthRuntimeContractCheck[];
    authRuntimeFailureCategory?: AuthRuntimeFailureCategory | null;
    authRuntimeFailingChecks?: AuthRuntimeContractCheck[];
    entities?: DatabaseSchemaEntityCheck[];
    missingContracts?: string[];
    missingEntities?: string[];
  } = {},
): DatabaseHealthPayload => ({
  auth_runtime_checks: options.authRuntimeChecks ?? [],
  auth_runtime_failure_category: options.authRuntimeFailureCategory ?? null,
  auth_runtime_failing_checks: options.authRuntimeFailingChecks ?? [],
  entities: options.entities ?? [],
  missing: options.missingEntities ?? [],
  missing_contracts: options.missingContracts ?? [],
  missing_entities: options.missingEntities ?? [],
  checked_at: new Date().toISOString(),
  connectivity: "fail",
  detail,
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

  const signature = `${phase}:${payload.status}:${payload.missing_entities.join(",")}:${(payload.missing_contracts ?? []).join(",")}:${payload.detail ?? ""}`;
  if (signature === lastLoggedFailureSignature) {
    return;
  }

  lastLoggedFailureSignature = signature;

  console.error("[health] critical database schema issue", {
    connectivity: payload.connectivity,
    detail: payload.detail,
    missingContracts: payload.missing_contracts ?? [],
    missingEntities: payload.missing_entities,
    phase,
    source: "database_health",
    status: payload.status,
  });

  captureServerError(new Error(payload.detail || "Critical database schema validation failed."), {
    connectivity: payload.connectivity,
    missingContracts: payload.missing_contracts ?? [],
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
      missingContracts: payload.missing_contracts ?? [],
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
      missingContracts: payload.missing_contracts ?? [],
      missingEntities: payload.missing_entities,
      phase,
      source: "database_health",
      status: payload.status,
    },
  });
};

const formatFailedRpcDetail = (scope: string, status: number, rawText: string) =>
  `${scope} RPC failed with status ${status}: ${rawText.slice(0, 400) || "Unknown error"}`;

const buildAuthRuntimeDetail = (missingContracts: string[]) =>
  missingContracts.length > 0
    ? `Missing auth runtime contracts: ${missingContracts.join(", ")}.`
    : "Auth runtime contracts verified.";

const buildHealthDetail = (missingEntities: string[], missingContracts: string[]) => {
  const issues: string[] = [];

  if (missingEntities.length > 0) {
    issues.push(`Missing critical database entities: ${missingEntities.join(", ")}.`);
  }

  if (missingContracts.length > 0) {
    issues.push(`Missing auth runtime contracts: ${missingContracts.join(", ")}.`);
  }

  return issues.length > 0 ? issues.join(" ") : "Critical database schema and auth runtime contracts verified.";
};

const parseRpcJson = <T>(rawText: string, scope: string): T => {
  if (!rawText.trim()) {
    throw new Error(`${scope} RPC returned an empty response body.`);
  }

  return JSON.parse(rawText) as T;
};

const invokeSupabaseRpc = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  functionName: string,
  body: Record<string, unknown> = {},
) => {
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, supabaseUrl);
  const response = await fetch(endpoint.toString(), {
    body: JSON.stringify(body),
    headers: supabaseRequestHeaders(serviceRoleKey),
    method: "POST",
  });

  return {
    ok: response.ok,
    rawText: await response.text(),
    status: response.status,
  };
};

const buildFailedAuthRuntimeHealthPayload = (
  detail: string,
  options: {
    checks?: AuthRuntimeContractCheck[];
    failureCategory?: AuthRuntimeFailureCategory | null;
    failingChecks?: AuthRuntimeContractCheck[];
    missingContracts?: string[];
  } = {},
): AuthRuntimeHealthPayload => ({
  checked_at: new Date().toISOString(),
  checks: options.checks ?? [],
  connectivity: "fail",
  detail,
  failing_checks: options.failingChecks ?? options.checks ?? [],
  failure_category: options.failureCategory ?? classifyAuthRuntimeFailure(detail, options.missingContracts ?? []),
  missing_contracts: options.missingContracts ?? [],
  service: HEALTH_SERVICE_NAME,
  source: "live",
  status: "failed",
});

const loadLiveAuthRuntimeHealth = async (env: EnvLike): Promise<AuthRuntimeHealthPayload> => {
  const adminConfig = resolveSupabaseAdminConfig(env);
  if (!adminConfig.ok) {
    return buildFailedAuthRuntimeHealthPayload(adminConfig.detail);
  }

  try {
    const authRuntimeResponse = await invokeSupabaseRpc(
      adminConfig.config.supabaseUrl,
      adminConfig.config.serviceRoleKey,
      "get_auth_runtime_status",
    );
    if (!authRuntimeResponse.ok) {
      return buildFailedAuthRuntimeHealthPayload(
        formatFailedRpcDetail("Auth runtime health", authRuntimeResponse.status, authRuntimeResponse.rawText),
      );
    }

    const checks = parseRpcJson<AuthRuntimeContractCheck[]>(authRuntimeResponse.rawText, "Auth runtime health") ?? [];
    const missingContracts = checks.filter((check) => !check.ok).map((check) => check.check_name);
    const failingChecks = checks.filter((check) => !check.ok);

    return {
      checked_at: new Date().toISOString(),
      checks,
      connectivity: "pass",
      detail: buildAuthRuntimeDetail(missingContracts),
      failing_checks: failingChecks,
      failure_category:
        missingContracts.length > 0
          ? classifyAuthRuntimeFailure(buildAuthRuntimeDetail(missingContracts), missingContracts)
          : null,
      missing_contracts: missingContracts,
      service: HEALTH_SERVICE_NAME,
      source: "live",
      status: missingContracts.length > 0 ? "degraded" : "ok",
    };
  } catch (error) {
    return buildFailedAuthRuntimeHealthPayload(
      error instanceof Error ? error.message : "Unexpected auth runtime health validation failure.",
    );
  }
};

const loadLiveDatabaseHealth = async (env: EnvLike): Promise<DatabaseHealthPayload> => {
  const adminConfig = resolveSupabaseAdminConfig(env);
  if (!adminConfig.ok) {
    return buildFailedHealthPayload(adminConfig.detail, await loadRecentSignals(env));
  }

  try {
    const [schemaResponse, authRuntimeHealth] = await Promise.all([
      invokeSupabaseRpc(adminConfig.config.supabaseUrl, adminConfig.config.serviceRoleKey, "get_schema_entity_status", {
        p_entities: [...CRITICAL_DB_ENTITIES],
      }),
      loadLiveAuthRuntimeHealth(env),
    ]);

    if (!schemaResponse.ok) {
      return buildFailedHealthPayload(
        formatFailedRpcDetail("Schema health", schemaResponse.status, schemaResponse.rawText),
        await loadRecentSignals(env),
      );
    }

    if (authRuntimeHealth.connectivity !== "pass") {
      return buildFailedHealthPayload(
        authRuntimeHealth.detail || "Auth runtime health validation failed.",
        await loadRecentSignals(env),
        {
          authRuntimeChecks: authRuntimeHealth.checks,
          authRuntimeFailureCategory: authRuntimeHealth.failure_category ?? null,
          authRuntimeFailingChecks: authRuntimeHealth.failing_checks ?? [],
          missingContracts: authRuntimeHealth.missing_contracts,
        },
      );
    }

    const entities = parseRpcJson<DatabaseSchemaEntityCheck[]>(schemaResponse.rawText, "Schema health") ?? [];
    const authRuntimeChecks = authRuntimeHealth.checks;
    const missingEntities = entities
      .filter((entity) => !entity.exists_in_schema)
      .map((entity) => entity.entity_name);
    const missingContracts = authRuntimeHealth.missing_contracts;
    const signals = await loadRecentSignals(env);

    return {
      auth_runtime_checks: authRuntimeChecks,
      auth_runtime_failure_category: authRuntimeHealth.failure_category ?? null,
      auth_runtime_failing_checks: authRuntimeHealth.failing_checks ?? [],
      checked_at: new Date().toISOString(),
      connectivity: "pass",
      detail: buildHealthDetail(missingEntities, missingContracts),
      entities,
      missing: missingEntities,
      missing_contracts: missingContracts,
      missing_entities: missingEntities,
      recent_critical_errors: signals.recentCriticalErrors,
      service: HEALTH_SERVICE_NAME,
      source: "live",
      status: missingEntities.length > 0 || missingContracts.length > 0 ? "degraded" : "ok",
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

export const getAuthRuntimeHealth = async (
  env: EnvLike = process.env,
  options: { forceRefresh?: boolean } = {},
): Promise<AuthRuntimeHealthPayload> => {
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && cachedAuthRuntimeHealth && cachedAuthRuntimeHealth.expiresAt > Date.now()) {
    return {
      ...cachedAuthRuntimeHealth.value,
      source: "cache",
    };
  }

  if (!forceRefresh && inFlightAuthRuntimeHealthCheck) {
    return inFlightAuthRuntimeHealthCheck;
  }

  inFlightAuthRuntimeHealthCheck = loadLiveAuthRuntimeHealth(env)
    .then((result) => {
      cachedAuthRuntimeHealth = {
        expiresAt: Date.now() + DATABASE_HEALTH_CACHE_TTL_MS,
        value: result,
      };
      return result;
    })
    .finally(() => {
      inFlightAuthRuntimeHealthCheck = null;
    });

  return inFlightAuthRuntimeHealthCheck;
};

export const warmCriticalDatabaseHealth = (env: EnvLike = process.env) => {
  void getCriticalDatabaseHealth(env, {
    forceRefresh: true,
    phase: "startup",
  }).catch(() => undefined);
  void getAuthRuntimeHealth(env, {
    forceRefresh: true,
  }).catch(() => undefined);
};
