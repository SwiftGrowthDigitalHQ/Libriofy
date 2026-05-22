import IORedis from "ioredis";
import jwt from "jsonwebtoken";

import {
  hasCustomJwtSigningConfig,
  hasSuperAdminEmailOtpConfig,
  SUPER_ADMIN_EMAIL_OTP_REQUIREMENT,
} from "./authRuntimeConfig.js";
import { LIBRIOFY_PUBLIC_APP_URL, isLibriofyAppUrl } from "./libriofyConfig.js";
import { getAuthRuntimeHealth } from "./observability/databaseHealth.server.js";
import {
  classifyAuthRuntimeFailure,
  type AuthRuntimeFailureCategory,
} from "./observability/databaseHealth.shared.js";
import { logInternalError, logInternalWarning } from "./observability/internalLogger.server.js";
import { getRequestTraceContext } from "./observability/requestContext.server.js";
import { incrementRuntimeMetric, recordRuntimeLatency } from "./observability/runtimeMetrics.server.js";
import { resolveSupabaseAdminConfig } from "./observability/supabaseAdminConfig.server.js";

type EnvLike = Record<string, string | undefined>;

export type AuthIntegrityFlow =
  | "auth_refresh"
  | "startup"
  | "super_admin_login"
  | "super_admin_verify";

export type AuthIntegrityFailureCategory = AuthRuntimeFailureCategory;

type AuthIntegrityCheck = {
  code: AuthIntegrityFailureCategory | null;
  detail: string;
  name: string;
  requirement?: string | null;
  status: "fail" | "pass" | "warn";
};

export type AuthIntegrityReport = {
  checkedAt: string;
  checks: AuthIntegrityCheck[];
  deploymentId: string | null;
  deploymentVersion: string | null;
  detail: string;
  durationMs: number;
  environmentSource: string;
  failedCodes: AuthIntegrityFailureCategory[];
  flow: AuthIntegrityFlow;
  primaryCode: AuthIntegrityFailureCategory | null;
  status: "failed" | "ok";
};

const AUTH_INTEGRITY_CACHE_TTL_MS = 60_000;
const AUTH_INTEGRITY_PROBE_TIMEOUT_MS = 1_500;

const cachedReports = new Map<AuthIntegrityFlow, { expiresAt: number; value: AuthIntegrityReport }>();
const inFlightReports = new Map<AuthIntegrityFlow, Promise<AuthIntegrityReport>>();
const lastFailureSignatureByFlow = new Map<AuthIntegrityFlow, string>();

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = trimText(env[name]);
    if (value) {
      return value;
    }
  }

  return "";
};

const hasValue = (value: unknown) => Boolean(trimText(value));

const isTestRuntime = (env: EnvLike) => {
  const appEnv = readEnv(env, "APP_ENV", "NODE_ENV").toLowerCase();
  return appEnv === "test";
};

const resolveDeploymentVersion = (env: EnvLike) =>
  readEnv(env, "SENTRY_RELEASE", "RELEASE_SHA", "VERCEL_GIT_COMMIT_SHA") || null;

const resolveDeploymentId = (env: EnvLike) =>
  readEnv(env, "VERCEL_DEPLOYMENT_ID", "RAILWAY_DEPLOYMENT_ID", "RENDER_GIT_COMMIT") || null;

const resolveEnvironmentSource = (env: EnvLike) => {
  const vercelEnv = readEnv(env, "VERCEL_ENV");
  if (vercelEnv) {
    return `vercel:${vercelEnv}`;
  }

  const appEnv = readEnv(env, "APP_ENV", "NODE_ENV");
  return appEnv ? `process_env:${appEnv}` : "process_env:unknown";
};

const buildCheck = (
  name: string,
  status: AuthIntegrityCheck["status"],
  detail: string,
  options: {
    code?: AuthIntegrityFailureCategory | null;
    requirement?: string | null;
  } = {},
): AuthIntegrityCheck => ({
  code: options.code ?? null,
  detail,
  name,
  requirement: options.requirement ?? null,
  status,
});

const createTimeoutSignal = (timeoutMs = AUTH_INTEGRITY_PROBE_TIMEOUT_MS) =>
  typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;

const shouldProbeRedis = (flow: AuthIntegrityFlow) =>
  flow === "startup" || flow === "super_admin_login" || flow === "super_admin_verify";

const shouldProbeResend = (flow: AuthIntegrityFlow) =>
  flow === "startup" || flow === "super_admin_login";

const buildFailedReportDetail = (checks: AuthIntegrityCheck[]) =>
  checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.name}: ${check.detail}`)
    .join(" ");

const logIntegrityReportFailure = (report: AuthIntegrityReport) => {
  if (report.status === "ok") {
    lastFailureSignatureByFlow.delete(report.flow);
    return;
  }

  const signature = `${report.flow}:${report.primaryCode}:${report.failedCodes.join(",")}:${report.detail}`;
  if (lastFailureSignatureByFlow.get(report.flow) === signature) {
    return;
  }

  lastFailureSignatureByFlow.set(report.flow, signature);

  void logInternalError({
    type: report.primaryCode ?? "AUTH_RUNTIME_FAILURE",
    message: `Auth integrity validation failed for ${report.flow}.`,
    metadata: {
      area: "auth",
      checks: report.checks.map((check) => ({
        code: check.code,
        detail: check.detail,
        name: check.name,
        requirement: check.requirement,
        status: check.status,
      })),
      deployment_id: report.deploymentId,
      deployment_version: report.deploymentVersion,
      duration_ms: report.durationMs,
      environment_source: report.environmentSource,
      failed_codes: report.failedCodes,
      flow: report.flow,
      summary: report.detail,
    },
  });
};

const maybeWarnOnAnonKeyDrift = (env: EnvLike) => {
  const anonKey = readEnv(env, "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
  if (!anonKey) {
    return buildCheck(
      "supabase_anon_key",
      "warn",
      "SUPABASE_ANON_KEY is missing. Browser Supabase session verification may drift from custom auth sessions.",
      {
        requirement: "SUPABASE_ANON_KEY",
      },
    );
  }

  return buildCheck("supabase_anon_key", "pass", "SUPABASE_ANON_KEY is configured.", {
    requirement: "SUPABASE_ANON_KEY",
  });
};

const buildSupabaseAdminConfigChecks = (env: EnvLike): AuthIntegrityCheck[] => {
  const adminConfig = resolveSupabaseAdminConfig(env);
  if (adminConfig.ok) {
    return [
      buildCheck("supabase_url", "pass", "Supabase admin URL is configured.", {
        requirement: "SUPABASE_URL|VITE_SUPABASE_URL",
      }),
      buildCheck("supabase_service_role_key", "pass", "Supabase admin service role key is configured.", {
        requirement: "SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_SERVICE_ROLE_KEY",
      }),
    ];
  }

  const hasUrlCandidate = hasValue(env.SUPABASE_URL) || hasValue(env.VITE_SUPABASE_URL);
  const urlCheck = buildCheck(
    "supabase_url",
    hasUrlCandidate ? "pass" : "fail",
    hasUrlCandidate ? "Supabase admin URL candidate is present." : adminConfig.detail,
    {
      code: hasUrlCandidate ? null : "AUTH_RUNTIME_FAILURE",
      requirement: "SUPABASE_URL|VITE_SUPABASE_URL",
    },
  );

  return [
    urlCheck,
    buildCheck(
      "supabase_service_role_key",
      "fail",
      adminConfig.detail,
      {
        code: "AUTH_RUNTIME_FAILURE",
        requirement: "SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_SERVICE_ROLE_KEY",
      },
    ),
  ];
};

const buildConfigChecks = (env: EnvLike, flow: AuthIntegrityFlow) => {
  const checks: AuthIntegrityCheck[] = [];

  const hasCanonicalUrl = ["APP_URL", "PUBLIC_APP_URL", "SITE_URL"].some((name) => isLibriofyAppUrl(env[name]));
  checks.push(
    buildCheck(
      "canonical_app_url",
      hasCanonicalUrl ? "pass" : "fail",
      hasCanonicalUrl ? "Canonical Libriofy app URL is configured." : `Expected ${LIBRIOFY_PUBLIC_APP_URL}.`,
      {
        code: hasCanonicalUrl ? null : "AUTH_RUNTIME_FAILURE",
        requirement: `APP_URL|PUBLIC_APP_URL|SITE_URL=${LIBRIOFY_PUBLIC_APP_URL}`,
      },
    ),
  );

  checks.push(...buildSupabaseAdminConfigChecks(env));

  const hasJwtSecret = hasCustomJwtSigningConfig(env);
  if (!hasJwtSecret) {
    checks.push(
      buildCheck(
        "jwt_signing_config",
        "fail",
        "Custom auth token signing is not configured.",
        {
          code: "AUTH_RUNTIME_FAILURE",
          requirement: "SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET",
        },
      ),
    );
  } else {
    try {
      const secret = readEnv(env, "SUPABASE_JWT_SECRET", "JWT_SECRET", "APP_JWT_SECRET");
      const token = jwt.sign({ aud: "authenticated", sub: "auth-runtime-integrity-probe" }, secret, {
        algorithm: "HS256",
        expiresIn: 60,
      });
      jwt.verify(token, secret, {
        algorithms: ["HS256"],
        audience: "authenticated",
      });

      checks.push(
        buildCheck("jwt_signing_config", "pass", "JWT signing configuration passed a sign/verify probe.", {
          requirement: "SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET",
        }),
      );
    } catch (error) {
      checks.push(
        buildCheck(
          "jwt_signing_config",
          "fail",
          `JWT signing configuration failed a sign/verify probe: ${error instanceof Error ? error.message : String(error)}`,
          {
            code: "AUTH_RUNTIME_FAILURE",
            requirement: "SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET",
          },
        ),
      );
    }
  }

  if (shouldProbeRedis(flow)) {
    const redisUrl = readEnv(env, "REDIS_URL");
    checks.push(
      buildCheck(
        "redis_url",
        redisUrl ? "pass" : "fail",
        redisUrl ? "REDIS_URL is configured." : "REDIS_URL is missing.",
        {
          code: redisUrl ? null : "AUTH_REDIS_FAILURE",
          requirement: "REDIS_URL",
        },
      ),
    );
  }

  if (shouldProbeResend(flow)) {
    const hasResendConfig = hasSuperAdminEmailOtpConfig(env);
    checks.push(
      buildCheck(
        "super_admin_resend_config",
        hasResendConfig ? "pass" : "fail",
        hasResendConfig
          ? "Super admin email OTP delivery is configured."
          : "Super admin email OTP delivery must use hello@libriofy.com via Resend.",
        {
          code: hasResendConfig ? null : "AUTH_RESEND_FAILURE",
          requirement: SUPER_ADMIN_EMAIL_OTP_REQUIREMENT,
        },
      ),
    );
  }

  checks.push(maybeWarnOnAnonKeyDrift(env));

  return checks;
};

const probeRedisReachability = async (env: EnvLike) => {
  const redisUrl = readEnv(env, "REDIS_URL");
  if (!redisUrl) {
    return null;
  }

  if (isTestRuntime(env)) {
    return buildCheck("redis_reachability", "pass", "Redis reachability probe skipped in test runtime.", {
      requirement: "REDIS_URL",
    });
  }

  const client = new IORedis(redisUrl, {
    enableReadyCheck: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  const startedAt = Date.now();

  try {
    await client.connect();
    const pong = await client.ping();
    return buildCheck(
      "redis_reachability",
      "pass",
      `Redis responded to PING with ${pong} in ${Date.now() - startedAt}ms.`,
      {
        requirement: "REDIS_URL",
      },
    );
  } catch (error) {
    return buildCheck(
      "redis_reachability",
      "fail",
      `Redis reachability probe failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        code: "AUTH_REDIS_FAILURE",
        requirement: "REDIS_URL",
      },
    );
  } finally {
    client.disconnect();
  }
};

const probeResendReadiness = async (env: EnvLike) => {
  if (!hasSuperAdminEmailOtpConfig(env)) {
    return null;
  }

  if (isTestRuntime(env)) {
    return buildCheck(
      "resend_readiness",
      "pass",
      "Resend readiness probe skipped in test runtime.",
      {
        requirement: SUPER_ADMIN_EMAIL_OTP_REQUIREMENT,
      },
    );
  }

  const apiKey = readEnv(env, "RESEND_API_KEY");
  const startedAt = Date.now();

  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      method: "GET",
      signal: createTimeoutSignal(),
    });

    if (!response.ok) {
      const rawText = await response.text();
      return buildCheck(
        "resend_readiness",
        "fail",
        `Resend readiness probe failed with status ${response.status}: ${rawText.slice(0, 200) || "Unknown error"}`,
        {
          code: "AUTH_RESEND_FAILURE",
          requirement: SUPER_ADMIN_EMAIL_OTP_REQUIREMENT,
        },
      );
    }

    return buildCheck(
      "resend_readiness",
      "pass",
      `Resend readiness probe succeeded in ${Date.now() - startedAt}ms.`,
      {
        requirement: SUPER_ADMIN_EMAIL_OTP_REQUIREMENT,
      },
    );
  } catch (error) {
    return buildCheck(
      "resend_readiness",
      "fail",
      `Resend readiness probe failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        code: "AUTH_RESEND_FAILURE",
        requirement: SUPER_ADMIN_EMAIL_OTP_REQUIREMENT,
      },
    );
  }
};

const probeSupabaseAuthRuntime = async (env: EnvLike) => {
  const health = await getAuthRuntimeHealth(env, {
    forceRefresh: true,
  });

  if (health.status === "ok") {
    return buildCheck(
      "supabase_auth_runtime",
      "pass",
      health.detail || "Auth runtime contracts verified.",
    );
  }

  return buildCheck(
    "supabase_auth_runtime",
    "fail",
    health.detail || "Auth runtime contracts could not be verified.",
    {
      code: classifyAuthRuntimeFailure(health.detail, health.missing_contracts),
    },
  );
};

const loadAuthRuntimeIntegrity = async (
  env: EnvLike,
  flow: AuthIntegrityFlow,
): Promise<AuthIntegrityReport> => {
  const startedAt = Date.now();
  const checks = buildConfigChecks(env, flow);
  const hasBlockingConfigFailure = checks.some((check) => check.status === "fail");

  const asyncChecks: Array<Promise<AuthIntegrityCheck | null>> = [];

  // Skip expensive Supabase schema probe for refresh flow - it only needs auth_trusted_devices
  const shouldRunSupabaseProbe = flow !== "auth_refresh"
    && checks.find((check) => check.name === "supabase_url")?.status === "pass"
    && checks.find((check) => check.name === "supabase_service_role_key")?.status === "pass";
  if (shouldRunSupabaseProbe) {
    asyncChecks.push(probeSupabaseAuthRuntime(env));
  }

  if (!hasBlockingConfigFailure && shouldProbeRedis(flow)) {
    asyncChecks.push(probeRedisReachability(env));
  }

  if (!hasBlockingConfigFailure && shouldProbeResend(flow)) {
    asyncChecks.push(probeResendReadiness(env));
  }

  const resolvedAsyncChecks = (await Promise.all(asyncChecks)).filter(Boolean) as AuthIntegrityCheck[];
  const finalChecks = [...checks, ...resolvedAsyncChecks];
  const failedChecks = finalChecks.filter((check) => check.status === "fail");
  const failedCodes = [...new Set(
    failedChecks
      .map((check) => check.code)
      .filter((code): code is AuthIntegrityFailureCategory => Boolean(code)),
  )];
  const durationMs = Date.now() - startedAt;
  const report: AuthIntegrityReport = {
    checkedAt: new Date().toISOString(),
    checks: finalChecks,
    deploymentId: resolveDeploymentId(env),
    deploymentVersion: resolveDeploymentVersion(env),
    detail: failedChecks.length > 0 ? buildFailedReportDetail(failedChecks) : "Auth runtime integrity verified.",
    durationMs,
    environmentSource: resolveEnvironmentSource(env),
    failedCodes,
    flow,
    primaryCode: failedCodes[0] ?? null,
    status: failedChecks.length > 0 ? "failed" : "ok",
  };

  incrementRuntimeMetric("auth_runtime_integrity_total", 1, {
    flow,
    outcome: report.status,
  });
  recordRuntimeLatency("auth_runtime_integrity_latency_ms", durationMs, {
    flow,
    outcome: report.status,
  });

  if (report.status === "failed") {
    logIntegrityReportFailure(report);
  } else {
    const warningChecks = report.checks.filter((check) => check.status === "warn");
    if (warningChecks.length > 0) {
      void logInternalWarning({
        type: "AUTH_RUNTIME_FAILURE",
        message: `Auth integrity validation for ${flow} completed with warnings.`,
        metadata: {
          area: "auth",
          deployment_id: report.deploymentId,
          deployment_version: report.deploymentVersion,
          duration_ms: report.durationMs,
          environment_source: report.environmentSource,
          flow,
          warnings: warningChecks.map((check) => ({
            detail: check.detail,
            name: check.name,
            requirement: check.requirement,
          })),
        },
      });
    }
  }

  return report;
};

export const getAuthRuntimeIntegrity = async (
  env: EnvLike = process.env,
  options: {
    flow?: AuthIntegrityFlow;
    forceRefresh?: boolean;
  } = {},
): Promise<AuthIntegrityReport> => {
  const flow = options.flow ?? "startup";
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh) {
    const cached = cachedReports.get(flow);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const inFlight = inFlightReports.get(flow);
    if (inFlight) {
      return inFlight;
    }
  }

  const reportPromise = loadAuthRuntimeIntegrity(env, flow)
    .then((report) => {
      cachedReports.set(flow, {
        expiresAt: Date.now() + AUTH_INTEGRITY_CACHE_TTL_MS,
        value: report,
      });

      return report;
    })
    .finally(() => {
      inFlightReports.delete(flow);
    });

  inFlightReports.set(flow, reportPromise);
  return reportPromise;
};

export const warmAuthRuntimeIntegrity = (
  env: EnvLike = process.env,
  flow: AuthIntegrityFlow = "startup",
) => {
  void getAuthRuntimeIntegrity(env, {
    flow,
    forceRefresh: true,
  }).catch(() => undefined);
};

export const clearAuthRuntimeIntegrityCacheForTest = () => {
  cachedReports.clear();
  inFlightReports.clear();
  lastFailureSignatureByFlow.clear();
};

export const assertAuthSchemaIntegrity = async (
  env: EnvLike = process.env,
  options: {
    flow?: AuthIntegrityFlow;
  } = {},
) => {
  const report = await getAuthRuntimeIntegrity(env, {
    flow: options.flow ?? "startup",
    forceRefresh: true,
  });

  if (report.status === "ok") {
    return report;
  }

  const error = new Error(report.detail);
  Object.assign(error, {
    code: report.primaryCode ?? "AUTH_RUNTIME_FAILURE",
    report,
  });
  throw error;
};

const mapPrimaryCodeToClientCode = (
  primaryCode: AuthIntegrityFailureCategory | null,
  flow: AuthIntegrityFlow,
) => {
  if (flow === "auth_refresh") {
    return "AUTH_REFRESH_ERROR";
  }

  switch (primaryCode) {
    case "AUTH_RESEND_FAILURE":
      return "OTP_DELIVERY_UNAVAILABLE";
    case "AUTH_RPC_FAILURE":
    case "AUTH_SCHEMA_FAILURE":
      return "AUTH_SESSION_STORE_SCHEMA_MISMATCH";
    case "AUTH_GRANT_FAILURE":
    case "AUTH_RLS_FAILURE":
      return "AUTH_SESSION_STORE_UNAVAILABLE";
    case "AUTH_REDIS_FAILURE":
    case "AUTH_RUNTIME_FAILURE":
    default:
      return "AUTH_INFRA_UNAVAILABLE";
  }
};

export const buildAuthIntegrityFailureResponse = (
  report: AuthIntegrityReport,
  flow: AuthIntegrityFlow,
) => {
  const requestId = getRequestTraceContext()?.requestId ?? null;
  const message =
    flow === "auth_refresh"
      ? "Unable to refresh the session right now. Please sign in again."
      : "Super admin sign-in is temporarily unavailable. Please try again shortly.";

  return {
    body: {
      code: mapPrimaryCodeToClientCode(report.primaryCode, flow),
      detail: report.detail,
      error: message,
      failureCategory: report.primaryCode,
      message,
      ...(requestId ? { requestId } : {}),
      success: false as const,
    },
    statusCode: 503,
  };
};
