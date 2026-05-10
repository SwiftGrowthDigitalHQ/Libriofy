import { createHash } from "node:crypto";

import {
  hasCustomJwtSigningConfig,
  hasSuperAdminEmailOtpConfig,
  getSuperAdminLoginRuntimeIssues,
  SUPER_ADMIN_EMAIL_OTP_REQUIREMENT,
} from "../authRuntimeConfig.js";
import {
  LIBRIOFY_AUTH_EMAIL,
  LIBRIOFY_PUBLIC_APP_URL,
  isLibriofyAppUrl,
} from "../libriofyConfig.js";
import { readSafeMaintenanceStatus } from "../maintenanceRuntime.server.js";
import { getCriticalDatabaseHealth } from "./databaseHealth.server.js";
import type {
  RuntimeCapabilityMode,
  RuntimeCapabilityReport,
  RuntimeConfigReport,
  RuntimeContractName,
  RuntimeContractReport,
  RuntimeDeploymentReport,
  RuntimeGovernanceStatus,
  RuntimeLivenessReport,
  RuntimeMaintenanceReport,
  RuntimeReadinessReport,
  RuntimeTarget,
  ServerHealthCheck,
} from "./runtimeGovernance.shared.js";

type EnvLike = Record<string, string | undefined>;

type RuntimeConfigOptions = {
  hasDist?: boolean;
  target: RuntimeTarget;
};

type RuntimeReadinessOptions = RuntimeConfigOptions & {
  phase?: string;
  requestId?: string | null;
  service: string;
  startedAt?: number;
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const hasValue = (value: unknown) => Boolean(trimText(value));

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = trimText(env[name]);
    if (value) {
      return value;
    }
  }

  return "";
};

const nowIso = () => new Date().toISOString();

const normalizeUrl = (value: string) => {
  try {
    const url = new URL(value);
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.hostname}${normalizedPath}${url.search}`;
  } catch {
    return value.trim();
  }
};

const looksLikePlaceholder = (key: string, value: string | undefined) => {
  const normalized = trimText(value);
  if (!normalized) {
    return false;
  }

  const genericPatterns = [
    /example\.com/i,
    /your-project\.supabase\.co/i,
    /your[_-]/i,
    /prod-host/i,
    /staging-host/i,
    /gdrive:libriofy-backups/i,
    /ops-backups/i,
    /x{6,}/i,
  ];

  if (genericPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if ((key === "RELEASE_SHA" || key === "SENTRY_RELEASE") && normalized === "local") {
    return true;
  }

  if (key.endsWith("_URL") && /localhost|127\.0\.0\.1/i.test(normalized)) {
    return true;
  }

  return false;
};

const buildCheck = (
  name: string,
  status: ServerHealthCheck["status"],
  detail: string,
  options: Pick<ServerHealthCheck, "category" | "requirement"> = {},
): ServerHealthCheck => ({
  category: options.category,
  detail,
  name,
  requirement: options.requirement,
  status,
});

const getAppEnv = (env: EnvLike) => readEnv(env, "APP_ENV", "NODE_ENV") || "development";

const getRelease = (env: EnvLike) => readEnv(env, "SENTRY_RELEASE", "RELEASE_SHA", "VERCEL_GIT_COMMIT_SHA") || null;

const getCommitSha = (env: EnvLike) => readEnv(env, "VERCEL_GIT_COMMIT_SHA", "RELEASE_SHA") || null;

const getDeploymentId = (env: EnvLike) =>
  readEnv(env, "VERCEL_DEPLOYMENT_ID", "RAILWAY_DEPLOYMENT_ID", "RENDER_GIT_COMMIT") || null;

const isServerlessRuntime = (env: EnvLike) => hasValue(env.VERCEL) || hasValue(env.AWS_LAMBDA_FUNCTION_NAME);

const buildRuntimeCapabilities = (target: RuntimeTarget): RuntimeCapabilityReport[] => {
  const capability = (
    name: string,
    mode: RuntimeCapabilityMode,
    detail: string,
    status: RuntimeCapabilityReport["status"] = "pass",
  ): RuntimeCapabilityReport => ({
    detail,
    mode,
    name,
    status,
  });

  switch (target) {
    case "express":
      return [
        capability("async_request_context", "native", "Request-scoped tracing is handled in-process."),
        capability("background_workers", "native", "Background workers may run in the Node process."),
        capability("persistent_process_state", "native", "Long-lived process state is available to the runtime."),
      ];
    case "serverless":
      return [
        capability("async_request_context", "native", "Request-scoped tracing is rebuilt for each invocation."),
        capability("background_workers", "delegated", "Queue execution is delegated to a long-lived worker runtime."),
        capability("persistent_process_state", "disabled", "Serverless handlers must remain stateless between invocations."),
      ];
    case "queue_worker":
      return [
        capability("async_request_context", "disabled", "Queue jobs are not request-scoped and do not depend on HTTP context."),
        capability("background_workers", "native", "Queue processing runs natively in the worker runtime."),
        capability("persistent_process_state", "native", "Worker state may stay warm across job executions."),
      ];
    case "operational_intelligence":
      return [
        capability("async_request_context", "native", "Operational intelligence is request-scoped and server-executed."),
        capability("background_workers", "delegated", "Operational intelligence may observe worker state but does not own queue execution."),
        capability("persistent_process_state", "disabled", "Operational intelligence must stay deterministic and stateless."),
      ];
    case "observability":
      return [
        capability("async_request_context", "native", "Tracing and request correlation are available to observability handlers."),
        capability("background_workers", "delegated", "Observability may observe worker runtimes without depending on local execution."),
        capability("persistent_process_state", "disabled", "Observability should not rely on mutable in-memory coordination."),
      ];
  }
};

const buildDriftWarnings = (env: EnvLike) => {
  const warnings: string[] = [];

  const canonicalUrlValues = ["APP_URL", "PUBLIC_APP_URL", "SITE_URL"]
    .map((key) => trimText(env[key]))
    .filter(Boolean);
  const distinctUrls = [...new Set(canonicalUrlValues.map(normalizeUrl))];
  if (distinctUrls.length > 1) {
    warnings.push(`Public app URL drift detected across APP_URL/PUBLIC_APP_URL/SITE_URL (${distinctUrls.join(", ")}).`);
  }

  const releaseValues = ["SENTRY_RELEASE", "RELEASE_SHA", "VERCEL_GIT_COMMIT_SHA"]
    .map((key) => trimText(env[key]))
    .filter(Boolean);
  const distinctReleases = [...new Set(releaseValues)];
  if (distinctReleases.length > 1) {
    warnings.push(`Release lineage drift detected across SENTRY_RELEASE/RELEASE_SHA/VERCEL_GIT_COMMIT_SHA (${distinctReleases.join(", ")}).`);
  }

  const supabaseUrlValues = ["SUPABASE_URL", "VITE_SUPABASE_URL"]
    .map((key) => trimText(env[key]))
    .filter(Boolean);
  const distinctSupabaseUrls = [...new Set(supabaseUrlValues.map(normalizeUrl))];
  if (distinctSupabaseUrls.length > 1) {
    warnings.push(`Supabase URL drift detected across SUPABASE_URL/VITE_SUPABASE_URL (${distinctSupabaseUrls.join(", ")}).`);
  }

  if (hasValue(env.VITE_SUPABASE_SERVICE_ROLE_KEY)) {
    warnings.push("VITE_SUPABASE_SERVICE_ROLE_KEY is configured and should remain server-only.");
  }

  return warnings;
};

const summarizeStatus = (checks: ServerHealthCheck[]): RuntimeGovernanceStatus => {
  if (checks.some((check) => check.status === "fail")) {
    return "failed";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "degraded";
  }

  return "ok";
};

export const validateRuntimeConfiguration = (
  env: EnvLike = process.env,
  options: RuntimeConfigOptions,
): RuntimeConfigReport => {
  const checks: ServerHealthCheck[] = [];
  const missing: string[] = [];

  const requireValue = (name: string, requirement: string, value: string | undefined, detail: string) => {
    const ok = hasValue(value) && !looksLikePlaceholder(requirement, value);
    checks.push(
      buildCheck(
        name,
        ok ? "pass" : "fail",
        ok ? "configured" : detail,
        { category: "config", requirement },
      ),
    );
    if (!ok && !missing.includes(requirement)) {
      missing.push(requirement);
    }
  };

  requireValue("app_env", "APP_ENV", env.APP_ENV, "APP_ENV is missing or placeholder.");

  const hasCanonicalUrl = ["APP_URL", "PUBLIC_APP_URL", "SITE_URL"].some((key) => isLibriofyAppUrl(env[key]));
  checks.push(
    buildCheck(
      "canonical_app_url",
      hasCanonicalUrl ? "pass" : "fail",
      hasCanonicalUrl ? "Canonical Libriofy app URL is configured." : `Expected ${LIBRIOFY_PUBLIC_APP_URL}.`,
      {
        category: "config",
        requirement: `APP_URL|PUBLIC_APP_URL|SITE_URL=${LIBRIOFY_PUBLIC_APP_URL}`,
      },
    ),
  );
  if (!hasCanonicalUrl) {
    missing.push(`APP_URL|PUBLIC_APP_URL|SITE_URL=${LIBRIOFY_PUBLIC_APP_URL}`);
  }

  requireValue("supabase_url", "SUPABASE_URL", env.SUPABASE_URL, "SUPABASE_URL is missing or placeholder.");
  requireValue(
    "supabase_service_role",
    "SUPABASE_SERVICE_ROLE_KEY",
    env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY is missing or placeholder.",
  );
  requireValue(
    "student_qr_signing",
    "STUDENT_QR_PRIVATE_KEY",
    env.STUDENT_QR_PRIVATE_KEY,
    "STUDENT_QR_PRIVATE_KEY is missing or placeholder.",
  );

  const hasRedis = hasValue(env.REDIS_URL) && !looksLikePlaceholder("REDIS_URL", env.REDIS_URL);
  checks.push(
    buildCheck(
      "redis_session_storage",
      hasRedis ? "pass" : "fail",
      hasRedis ? "Redis session storage is configured." : "REDIS_URL is missing or placeholder.",
      {
        category: "config",
        requirement: "REDIS_URL",
      },
    ),
  );
  if (!hasRedis) {
    missing.push("REDIS_URL");
  }

  const hasJwtSigning = hasCustomJwtSigningConfig(env);
  checks.push(
    buildCheck(
      "auth_jwt_signing",
      hasJwtSigning ? "pass" : "fail",
      hasJwtSigning ? "JWT signing configuration is present." : "Custom auth token signing is not configured.",
      {
        category: "config",
        requirement: "SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET",
      },
    ),
  );
  if (!hasJwtSigning) {
    missing.push("SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET");
  }

  const hasEmailOtp = hasSuperAdminEmailOtpConfig(env);
  checks.push(
    buildCheck(
      "super_admin_email_otp",
      hasEmailOtp ? "pass" : "fail",
        hasEmailOtp
          ? "Super admin email OTP delivery is configured."
          : `Super admin email OTP delivery must use ${LIBRIOFY_AUTH_EMAIL} via Resend.`,
      {
        category: "config",
        requirement: SUPER_ADMIN_EMAIL_OTP_REQUIREMENT,
      },
    ),
  );
  if (!hasEmailOtp) {
    missing.push(SUPER_ADMIN_EMAIL_OTP_REQUIREMENT);
  }

  if (options.target === "express") {
    const hasDist = options.hasDist === true;
    checks.push(
      buildCheck(
        "frontend_bundle",
        hasDist ? "pass" : "fail",
        hasDist ? "dist/ is present for the Express runtime." : "dist/ was not found on the Express runtime.",
        {
          category: "deployment",
          requirement: "dist/",
        },
      ),
    );
    if (!hasDist) {
      missing.push("dist/");
    }
  }

  if (options.target === "queue_worker") {
    const supported = !isServerlessRuntime(env);
    checks.push(
      buildCheck(
        "queue_worker_runtime",
        supported ? "pass" : "fail",
        supported
          ? "Queue worker target is running in a long-lived Node runtime."
          : "Queue workers must not start inside serverless runtimes.",
        {
          category: "capability",
          requirement: "QUEUE_WORKER_RUNTIME=node_process",
        },
      ),
    );
    if (!supported) {
      missing.push("QUEUE_WORKER_RUNTIME=node_process");
    }
  }

  const release = getRelease(env);
  checks.push(
    buildCheck(
      "release_identifier",
      release ? "pass" : "warn",
      release ? `Release lineage resolved to ${release}.` : "Release lineage is missing.",
      {
        category: "deployment",
        requirement: "SENTRY_RELEASE|RELEASE_SHA|VERCEL_GIT_COMMIT_SHA",
      },
    ),
  );

  const driftWarnings = buildDriftWarnings(env);
  checks.push(
    buildCheck(
      "config_drift",
      driftWarnings.length > 0 ? "warn" : "pass",
      driftWarnings.length > 0 ? driftWarnings.join(" ") : "No cross-runtime configuration drift detected.",
      {
        category: "deployment",
      },
    ),
  );

  return {
    checks,
    driftWarnings,
    missing,
    ok: checks.every((check) => check.status !== "fail"),
    status: summarizeStatus(checks),
  };
};

const buildDeploymentReport = (
  env: EnvLike,
  target: RuntimeTarget,
  driftWarnings: string[],
): RuntimeDeploymentReport => {
  const release = getRelease(env);
  const commitSha = getCommitSha(env);
  const deploymentId = getDeploymentId(env);
  const platform =
    target === "express"
      ? "express"
      : target === "queue_worker"
        ? "worker"
        : isServerlessRuntime(env)
          ? "serverless"
          : "node";

  const fingerprintSource = [
    `target:${target}`,
    `app_env:${getAppEnv(env)}`,
    `release:${release ?? "missing"}`,
    `node:${process.version}`,
    `platform:${platform}`,
  ].join("|");
  const runtimeFingerprint = createHash("sha256").update(fingerprintSource).digest("hex").slice(0, 16);

  const configFingerprintSource = [
    `app_env:${getAppEnv(env)}`,
    `app_url:${isLibriofyAppUrl(env.APP_URL) ? LIBRIOFY_PUBLIC_APP_URL : trimText(env.APP_URL) || "missing"}`,
    `public_app_url:${isLibriofyAppUrl(env.PUBLIC_APP_URL) ? LIBRIOFY_PUBLIC_APP_URL : trimText(env.PUBLIC_APP_URL) || "missing"}`,
    `site_url:${isLibriofyAppUrl(env.SITE_URL) ? LIBRIOFY_PUBLIC_APP_URL : trimText(env.SITE_URL) || "missing"}`,
    `supabase_url:${trimText(env.SUPABASE_URL) || "missing"}`,
    `redis:${hasValue(env.REDIS_URL) ? "configured" : "missing"}`,
    `release:${release ?? "missing"}`,
  ].join("|");
  const configFingerprint = createHash("sha256").update(configFingerprintSource).digest("hex").slice(0, 16);

  return {
    commitSha,
    configFingerprint,
    deploymentId,
    driftWarnings,
    lineage: [
      `platform:${platform}`,
      `target:${target}`,
      `release:${release ?? "missing"}`,
      `deployment:${deploymentId ?? "missing"}`,
      `commit:${commitSha ?? "missing"}`,
      `runtime:${runtimeFingerprint}`,
      `config:${configFingerprint}`,
    ],
    platform,
    release,
    runtimeFingerprint,
  };
};

const buildContractStatus = (
  name: RuntimeContractName,
  status: RuntimeGovernanceStatus,
  summary: string,
  details: string[],
): RuntimeContractReport => ({
  details,
  name,
  status,
  summary,
});

const toContractStatus = (issues: string[], warnings: string[] = []): RuntimeGovernanceStatus => {
  if (issues.length > 0) {
    return "failed";
  }

  if (warnings.length > 0) {
    return "degraded";
  }

  return "ok";
};

const buildRuntimeContracts = ({
  config,
  databaseHealthy,
  env,
  maintenance,
  target,
}: {
  config: RuntimeConfigReport;
  databaseHealthy: boolean;
  env: EnvLike;
  maintenance: RuntimeMaintenanceReport;
  target: RuntimeTarget;
}): RuntimeContractReport[] => {
  const authIssues = getSuperAdminLoginRuntimeIssues(env);
  const releaseWarnings = config.checks
    .filter((check) => check.name === "release_identifier" && check.status === "warn")
    .map((check) => check.detail || "Release lineage is missing.");
  const driftWarnings = config.driftWarnings;

  const contracts: RuntimeContractReport[] = [];

  const authSummaryTarget =
    target === "queue_worker"
      ? "Queue workers do not mint or verify user sessions directly."
      : authIssues.length === 0
        ? "Auth and session requirements are aligned across runtimes."
        : "Auth/session behavior is missing required runtime dependencies.";
  contracts.push(
    buildContractStatus(
      "auth_session",
      target === "queue_worker" ? "ok" : toContractStatus(authIssues.map((issue) => issue.message)),
      authSummaryTarget,
      target === "queue_worker" ? ["Session orchestration is delegated to API runtimes."] : authIssues.map((issue) => issue.message),
    ),
  );

  contracts.push(
    buildContractStatus(
      "observability",
      toContractStatus([], [...releaseWarnings, ...driftWarnings]),
      releaseWarnings.length === 0
        ? "Observability runtime has stable release lineage and request tracing semantics."
        : "Observability runtime is operating without complete release lineage.",
      [...releaseWarnings, ...driftWarnings],
    ),
  );

  const governanceIssues = databaseHealthy && config.ok ? [] : ["Governance runtime depends on healthy database and service-role access."];
  contracts.push(
    buildContractStatus(
      "governance",
      toContractStatus(governanceIssues),
      governanceIssues.length === 0
        ? "Governance controls share deterministic runtime dependencies."
        : "Governance runtime is degraded by dependency or configuration drift.",
      governanceIssues,
    ),
  );

  const queueIssues: string[] = [];
  const queueWarnings: string[] = [];
  if (!hasValue(env.REDIS_URL)) {
    queueIssues.push("Queue storage requires REDIS_URL.");
  }
  if (target === "queue_worker" && isServerlessRuntime(env)) {
    queueIssues.push("Queue workers must not run inside serverless runtimes.");
  }
  if (target === "serverless") {
    queueWarnings.push("Queue execution is delegated to a long-lived worker runtime.");
  }
  contracts.push(
    buildContractStatus(
      "queue",
      target === "serverless" && queueIssues.length === 0 ? "ok" : toContractStatus(queueIssues, target === "serverless" ? [] : queueWarnings),
      target === "serverless"
        ? "Serverless handlers enqueue work and delegate execution to worker runtimes."
        : queueIssues.length === 0
          ? "Queue runtime dependencies are consistent."
          : "Queue runtime dependencies are incomplete.",
      [...queueIssues, ...queueWarnings],
    ),
  );

  const controlPlaneIssues = databaseHealthy && config.ok ? [] : ["Operational intelligence requires the same database and control-plane dependencies as governance."];
  contracts.push(
    buildContractStatus(
      "operational_intelligence",
      target === "queue_worker" ? "ok" : toContractStatus(controlPlaneIssues),
      target === "queue_worker"
        ? "Operational intelligence is API-delivered and not executed inside the queue worker."
        : controlPlaneIssues.length === 0
          ? "Operational intelligence remains server-executed and DTO-delivered."
          : "Operational intelligence is degraded by control-plane dependency failures.",
      target === "queue_worker" ? ["Delivery remains delegated to API runtimes."] : controlPlaneIssues,
    ),
  );

  contracts.push(
    buildContractStatus(
      "feature_flags",
      toContractStatus(governanceIssues),
      governanceIssues.length === 0
        ? "Feature-flag state is backed by the same control-plane contract across runtimes."
        : "Feature-flag evaluation is degraded by control-plane dependency failures.",
      governanceIssues,
    ),
  );

  const maintenanceWarnings = maintenance.source === "fallback" ? ["Maintenance status is using safe fallback semantics."] : [];
  const maintenanceDetails = maintenance.maintenanceMode
    ? [`Maintenance mode is active via ${maintenance.source}.`]
    : [`Maintenance mode is inactive via ${maintenance.source}.`];
  contracts.push(
    buildContractStatus(
      "maintenance",
      toContractStatus([], maintenanceWarnings),
      maintenanceWarnings.length === 0
        ? "Maintenance handling is deterministic across runtimes."
        : "Maintenance handling is running in safe degraded mode.",
      [...maintenanceDetails, ...maintenanceWarnings],
    ),
  );

  return contracts;
};

const normalizeMaintenance = (value: Awaited<ReturnType<typeof readSafeMaintenanceStatus>>): RuntimeMaintenanceReport => ({
  maintenance: value.maintenance,
  maintenanceMode: value.maintenanceMode,
  source: value.source,
  updatedAt: value.updatedAt,
});

export const buildRuntimeLivenessReport = (
  env: EnvLike = process.env,
  options: Pick<RuntimeReadinessOptions, "service" | "startedAt" | "target">,
): RuntimeLivenessReport => ({
  appEnv: getAppEnv(env),
  release: getRelease(env),
  service: options.service,
  status: "ok",
  target: options.target,
  timestamp: nowIso(),
  uptimeSeconds: Math.max(0, Math.round((Date.now() - (options.startedAt ?? Date.now())) / 1000)),
});

export const buildRuntimeReadinessReport = async (
  env: EnvLike = process.env,
  options: RuntimeReadinessOptions,
): Promise<RuntimeReadinessReport> => {
  const config = validateRuntimeConfiguration(env, options);
  const maintenance = normalizeMaintenance(await readSafeMaintenanceStatus());
  const database = await getCriticalDatabaseHealth(env, {
    phase: options.phase ?? `${options.target}_readiness`,
  });

  const checks = [...config.checks];
  checks.push(
    buildCheck(
      "maintenance_source",
      maintenance.source === "fallback" ? "warn" : "pass",
      maintenance.source === "fallback"
        ? "Maintenance settings are using safe fallback semantics."
        : `Maintenance settings resolved from ${maintenance.source}.`,
      {
        category: "contract",
      },
    ),
  );
  checks.push(
    buildCheck(
      "maintenance_mode_state",
      maintenance.maintenanceMode ? "warn" : "pass",
      maintenance.maintenanceMode
        ? `Maintenance mode is active via ${maintenance.source}.`
        : "Maintenance mode is inactive.",
      {
        category: "contract",
      },
    ),
  );
  checks.push(
    buildCheck(
      "supabase_connectivity",
      database.connectivity === "pass" ? "pass" : "fail",
      database.connectivity === "pass"
        ? "Supabase REST connectivity verified."
        : database.detail || "Supabase connectivity failed.",
      {
        category: "dependency",
      },
    ),
  );
  checks.push(
    buildCheck(
      "critical_database_schema",
      database.status === "ok" ? "pass" : "fail",
      database.status === "ok"
        ? "Critical database entities and auth runtime contracts are present."
        : database.detail || "Critical database entities are missing.",
      {
        category: "dependency",
      },
    ),
  );

  const deployment = buildDeploymentReport(env, options.target, config.driftWarnings);
  const capabilities = buildRuntimeCapabilities(options.target);
  const contracts = buildRuntimeContracts({
    config,
    databaseHealthy: database.status === "ok",
    env,
    maintenance,
    target: options.target,
  });

  const contractWarnings = contracts.filter((contract) => contract.status === "degraded");
  const contractFailures = contracts.filter((contract) => contract.status === "failed");
  const status = contractFailures.length > 0 || checks.some((check) => check.status === "fail")
    ? "failed"
    : contractWarnings.length > 0 || checks.some((check) => check.status === "warn")
      ? "degraded"
      : "ok";

  const degradedReasons = [
    ...checks
      .filter((check) => check.status !== "pass")
      .map((check) => check.detail || check.name),
    ...contracts
      .filter((contract) => contract.status !== "ok")
      .map((contract) => contract.summary),
  ];

  return {
    appEnv: getAppEnv(env),
    capabilities,
    checks,
    config,
    contracts,
    database,
    degraded: {
      active: status !== "ok",
      reasons: [...new Set(degradedReasons)],
    },
    deployment,
    maintenance,
    nodeVersion: process.version,
    ok: checks.every((check) => check.status !== "fail"),
    requestId: options.requestId ?? null,
    service: options.service,
    status,
    target: options.target,
    timestamp: nowIso(),
    uptimeSeconds: Math.max(0, Math.round((Date.now() - (options.startedAt ?? Date.now())) / 1000)),
  };
};
