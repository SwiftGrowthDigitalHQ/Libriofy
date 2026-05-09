import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { OPERATOR_POLICY_VERSION } from "./governance.js";
import type {
  AdminFeatureFlag,
  AdminFeatureFlagRolloutGovernance,
  AdminReleaseChannel,
  AdminReleaseCompatibilityMatrixEntry,
  AdminReleaseCompatibilityStatus,
  AdminReleaseDeploymentOrchestration,
  AdminReleaseForensicsEvent,
  AdminReleaseGovernancePolicy,
  AdminReleaseGovernanceSnapshot,
  AdminReleaseHealthScore,
  AdminReleaseHealthStatus,
  AdminReleaseLineage,
  AdminReleasePhase,
  AdminReleaseRollbackSafety,
  AdminReleaseRolloutGovernance,
  AdminReleaseSchemaGovernance,
  AdminRuntimeGovernanceState,
  AdminRuntimeTraceEvent,
  AdminRuntimeVisibility,
  AdminIncidentGroup,
} from "./types.js";

const RELEASE_GOVERNANCE_POLICY_KEY = "release_governance_policy";
const RELEASE_GOVERNANCE_CONTRACT_VERSION = "2026-05-09-release-governance-v1";
const OPERATIONAL_INTELLIGENCE_CONTRACT_VERSION = "2026-05-09-operational-intelligence-v1";
const OBSERVABILITY_PAYLOAD_CONTRACT_VERSION = "2026-05-09-observability-payload-v1";

type EnvLike = Record<string, string | undefined>;

type SettingsMapValue = {
  updatedAt?: string | null;
  value: unknown;
} | unknown;

type ReleaseAuditLog = {
  action: string;
  actorEmail?: string | null;
  createdAt: string | null;
  metadata?: Record<string, unknown>;
  targetDisplay?: string | null;
  targetType?: string | null;
};

type ReleaseGovernanceInput = {
  auditLogs?: ReleaseAuditLog[];
  env?: EnvLike;
  featureFlags?: AdminFeatureFlag[];
  incidents?: Pick<AdminIncidentGroup, "incidentKey" | "lastSeenAt" | "latestMessage" | "severity">[];
  migrationVersions?: string[];
  now?: number;
  runtimeGovernance: AdminRuntimeGovernanceState;
  runtimeVisibility: AdminRuntimeVisibility;
  settingsMap?: Map<string, SettingsMapValue>;
  traceEvents?: AdminRuntimeTraceEvent[];
};

export type FeatureFlagExposureContext = {
  releaseId?: string | null;
  runtimeTarget?: string | null;
  subjectId?: string | null;
  tenantId?: string | null;
};

export type FeatureFlagExposureResult = {
  enabled: boolean;
  matchedTargets: string[];
  reasons: string[];
  stage: AdminFeatureFlagRolloutGovernance["stage"];
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeNullableText = (value: unknown) => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const normalizeLower = (value: unknown) => normalizeText(value).toLowerCase();

const toRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const toBoolean = (value: unknown, fallback = false) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return fallback;
};

const toStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => normalizeText(entry)).filter(Boolean))];
  }

  if (typeof value === "string") {
    if (value.trim().startsWith("[")) {
      try {
        return toStringArray(JSON.parse(value));
      } catch {
        // Fall through to comma splitting.
      }
    }

    return [...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    )];
  }

  return [] as string[];
};

const toPositiveNumber = (value: unknown, fallback = 0) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Number(parsed));
};

const clampPercentage = (value: unknown, fallback = 0) => Math.max(0, Math.min(100, toPositiveNumber(value, fallback)));

const readEnv = (env: EnvLike = process.env, ...names: string[]) => {
  for (const name of names) {
    const value = normalizeText(env[name]);
    if (value) {
      return value;
    }
  }

  return "";
};

const uniqueStrings = (values: Array<string | null | undefined>) =>
  [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];

const getSettingValue = (settingsMap: Map<string, SettingsMapValue> | undefined, key: string) => {
  if (!settingsMap) {
    return null;
  }

  const entry = settingsMap.get(key);
  if (entry && typeof entry === "object" && !Array.isArray(entry) && "value" in entry) {
    return (entry as { value: unknown }).value;
  }

  return entry ?? null;
};

const parseOptionalJsonRecord = (value: unknown) => {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      return toRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }

  return toRecord(value);
};

const isReleasePhase = (value: string): value is AdminReleasePhase =>
  [
    "planned",
    "validating",
    "canary",
    "rolling",
    "paused",
    "degraded",
    "maintenance",
    "rollback",
    "completed",
  ].includes(value);

const isReleaseChannel = (value: string): value is AdminReleaseChannel =>
  ["development", "staging", "production"].includes(value);

const inferReleaseChannel = (env: EnvLike, explicitValue: unknown): AdminReleaseChannel => {
  const declared = normalizeLower(explicitValue);
  if (declared && isReleaseChannel(declared)) {
    return declared;
  }

  const appEnv = normalizeLower(readEnv(env, "APP_ENV", "NODE_ENV"));
  if (appEnv.includes("prod")) {
    return "production";
  }
  if (appEnv.includes("stage")) {
    return "staging";
  }

  return "development";
};

const hashReleaseBucket = (key: string, subjectId: string) =>
  Number.parseInt(createHash("sha256").update(`${key}:${subjectId}`).digest("hex").slice(0, 8), 16) % 100;

const compareReleaseVersions = (leftValue: string | null, rightValue: string | null) => {
  const left = normalizeText(leftValue);
  const right = normalizeText(rightValue);
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }

  const tokenize = (value: string) =>
    value
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment.toLowerCase()));

  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const length = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken == null && rightToken == null) {
      return 0;
    }
    if (leftToken == null) {
      return -1;
    }
    if (rightToken == null) {
      return 1;
    }
    if (leftToken === rightToken) {
      continue;
    }
    if (typeof leftToken === "number" && typeof rightToken === "number") {
      return leftToken < rightToken ? -1 : 1;
    }

    const comparison = String(leftToken).localeCompare(String(rightToken));
    if (comparison !== 0) {
      return comparison;
    }
  }

  return left.localeCompare(right);
};

const isSafeWindowActive = (
  startHourUtc: number | null | undefined,
  endHourUtc: number | null | undefined,
  now = Date.now(),
) => {
  if (!Number.isFinite(startHourUtc) || !Number.isFinite(endHourUtc)) {
    return true;
  }

  const hour = new Date(now).getUTCHours();
  const start = Math.max(0, Math.min(23, Math.trunc(startHourUtc ?? 0)));
  const end = Math.max(0, Math.min(23, Math.trunc(endHourUtc ?? 0)));

  if (start === end) {
    return true;
  }

  if (start < end) {
    return hour >= start && hour < end;
  }

  return hour >= start || hour < end;
};

const getLocalMigrationVersions = () => {
  try {
    const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
    return fs
      .readdirSync(migrationsDir)
      .filter((fileName) => fileName.endsWith(".sql"))
      .map((fileName) => normalizeText(fileName).split("_")[0] || "")
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [] as string[];
  }
};

const resolveRolloutHealthStatus = (
  warnings: string[],
  explicitStatus: string,
): AdminReleaseHealthStatus => {
  if (["critical", "failed", "red"].includes(explicitStatus)) {
    return "critical";
  }
  if (["warning", "warn", "yellow", "degraded"].includes(explicitStatus)) {
    return "warning";
  }
  if (warnings.length > 0) {
    return "warning";
  }
  return "healthy";
};

const parseRolloutConfig = (config: Record<string, unknown>) => {
  const rollout = toRecord(config.rollout);
  const directTenants = toStringArray(config.tenantTargets);
  const directRuntimeTargets = toStringArray(config.runtimeTargets);
  const directReleaseTargets = toStringArray(config.releaseTargets);
  const tenantTargets = uniqueStrings([
    ...directTenants,
    ...toStringArray(rollout.tenantTargets),
    ...toStringArray(toRecord(rollout.tenants).allow),
  ]);
  const runtimeTargets = uniqueStrings([
    ...directRuntimeTargets,
    ...toStringArray(rollout.runtimeTargets),
  ]);
  const releaseTargets = uniqueStrings([
    ...directReleaseTargets,
    ...toStringArray(rollout.releaseTargets),
  ]);
  const warnings = uniqueStrings([
    ...toStringArray(config.rolloutWarnings),
    ...toStringArray(rollout.warnings),
  ]);
  const explicitStage = normalizeLower(rollout.stage || config.rolloutStage);

  return {
    canaryPercentage: clampPercentage(
      rollout.canaryPercentage ?? rollout.percentage ?? config.canaryPercentage,
      0,
    ),
    emergencyRollbackReady: toBoolean(
      rollout.emergencyRollbackReady ?? rollout.emergencyKillSwitch ?? config.emergencyRollbackReady,
      true,
    ),
    explicitStage,
    healthStatus: normalizeLower(String(rollout.healthStatus ?? config.rolloutHealthStatus ?? "")),
    paused: toBoolean(rollout.paused ?? config.rolloutPaused, false),
    releaseTargets,
    runtimeTargets,
    tenantTargets,
    warnings,
  };
};

const resolveFeatureFlagStage = ({
  enabled,
  rolloutPercentage,
  canaryPercentage,
  paused,
  releaseTargets,
  runtimeTargets,
  tenantTargets,
  explicitStage,
}: {
  canaryPercentage: number;
  enabled: boolean;
  explicitStage: string;
  paused: boolean;
  releaseTargets: string[];
  rolloutPercentage: number;
  runtimeTargets: string[];
  tenantTargets: string[];
}) => {
  if (!enabled || rolloutPercentage <= 0) {
    return "disabled" as const;
  }

  if (explicitStage === "rolled_back") {
    return "rolled_back" as const;
  }

  if (paused || explicitStage === "paused") {
    return "paused" as const;
  }

  if (canaryPercentage > 0 && canaryPercentage < 100) {
    return "canary" as const;
  }

  if (tenantTargets.length > 0 || explicitStage === "tenant_scoped") {
    return "tenant_scoped" as const;
  }

  if (runtimeTargets.length > 0 || releaseTargets.length > 0 || explicitStage === "runtime_targeted") {
    return "runtime_targeted" as const;
  }

  if (rolloutPercentage < 100 || explicitStage === "staged") {
    return "staged" as const;
  }

  return "full" as const;
};

export const deriveFeatureFlagRolloutGovernance = (
  flag: Pick<AdminFeatureFlag, "config" | "enabled" | "key" | "rolloutPercentage">,
): AdminFeatureFlagRolloutGovernance => {
  const rolloutConfig = parseRolloutConfig(flag.config ?? {});
  const stage = resolveFeatureFlagStage({
    canaryPercentage: rolloutConfig.canaryPercentage,
    enabled: flag.enabled,
    explicitStage: rolloutConfig.explicitStage,
    paused: rolloutConfig.paused,
    releaseTargets: rolloutConfig.releaseTargets,
    rolloutPercentage: flag.rolloutPercentage,
    runtimeTargets: rolloutConfig.runtimeTargets,
    tenantTargets: rolloutConfig.tenantTargets,
  });
  const healthStatus = resolveRolloutHealthStatus(rolloutConfig.warnings, rolloutConfig.healthStatus);
  const targetSummary = uniqueStrings([
    rolloutConfig.tenantTargets.length ? `${rolloutConfig.tenantTargets.length} tenants` : null,
    rolloutConfig.runtimeTargets.length ? `${rolloutConfig.runtimeTargets.length} runtime targets` : null,
    rolloutConfig.releaseTargets.length ? `${rolloutConfig.releaseTargets.length} releases` : null,
    rolloutConfig.canaryPercentage > 0 && rolloutConfig.canaryPercentage < 100
      ? `${rolloutConfig.canaryPercentage}% canary`
      : flag.rolloutPercentage < 100
        ? `${flag.rolloutPercentage}% staged`
        : null,
  ]);

  return {
    canaryPercentage: rolloutConfig.canaryPercentage,
    emergencyRollbackReady: rolloutConfig.emergencyRollbackReady,
    healthStatus,
    paused: rolloutConfig.paused,
    releaseTargets: rolloutConfig.releaseTargets,
    runtimeTargets: rolloutConfig.runtimeTargets,
    stage,
    summary: targetSummary.join(" | ") || "Global rollout",
    tenantTargets: rolloutConfig.tenantTargets,
    warnings: rolloutConfig.warnings,
  };
};

export const evaluateFeatureFlagExposure = (
  flag: Pick<AdminFeatureFlag, "enabled" | "key" | "rolloutPercentage"> & {
    rollout: AdminFeatureFlagRolloutGovernance;
  },
  context: FeatureFlagExposureContext = {},
): FeatureFlagExposureResult => {
  const reasons: string[] = [];
  const matchedTargets: string[] = [];

  if (!flag.enabled || flag.rollout.stage === "disabled" || flag.rollout.stage === "rolled_back") {
    reasons.push("Flag is disabled.");
    return {
      enabled: false,
      matchedTargets,
      reasons,
      stage: flag.rollout.stage,
    };
  }

  if (flag.rollout.paused || flag.rollout.stage === "paused") {
    reasons.push("Rollout is paused.");
    return {
      enabled: false,
      matchedTargets,
      reasons,
      stage: flag.rollout.stage,
    };
  }

  if (flag.rollout.releaseTargets.length > 0) {
    if (!context.releaseId || !flag.rollout.releaseTargets.includes(context.releaseId)) {
      reasons.push("Release target is outside the rollout window.");
      return {
        enabled: false,
        matchedTargets,
        reasons,
        stage: flag.rollout.stage,
      };
    }
    matchedTargets.push(`release:${context.releaseId}`);
  }

  if (flag.rollout.runtimeTargets.length > 0) {
    if (!context.runtimeTarget || !flag.rollout.runtimeTargets.includes(context.runtimeTarget)) {
      reasons.push("Runtime target is outside the rollout window.");
      return {
        enabled: false,
        matchedTargets,
        reasons,
        stage: flag.rollout.stage,
      };
    }
    matchedTargets.push(`runtime:${context.runtimeTarget}`);
  }

  if (flag.rollout.tenantTargets.length > 0) {
    if (!context.tenantId || !flag.rollout.tenantTargets.includes(context.tenantId)) {
      reasons.push("Tenant is outside the rollout window.");
      return {
        enabled: false,
        matchedTargets,
        reasons,
        stage: flag.rollout.stage,
      };
    }
    matchedTargets.push(`tenant:${context.tenantId}`);
  }

  const effectivePercentage =
    flag.rollout.canaryPercentage > 0
      ? Math.min(flag.rollout.canaryPercentage, flag.rolloutPercentage)
      : flag.rolloutPercentage;
  if (effectivePercentage <= 0) {
    reasons.push("Rollout percentage is zero.");
    return {
      enabled: false,
      matchedTargets,
      reasons,
      stage: flag.rollout.stage,
    };
  }

  if (effectivePercentage < 100 && normalizeText(context.subjectId)) {
    const bucket = hashReleaseBucket(flag.key, normalizeText(context.subjectId));
    if (bucket >= effectivePercentage) {
      reasons.push(`Subject bucket ${bucket} is outside the ${effectivePercentage}% rollout.`);
      return {
        enabled: false,
        matchedTargets,
        reasons,
        stage: flag.rollout.stage,
      };
    }
    matchedTargets.push(`bucket:${bucket}`);
  } else if (effectivePercentage < 100) {
    reasons.push(`Partial rollout active at ${effectivePercentage}%.`);
  }

  reasons.push("Context is compatible with the rollout policy.");
  return {
    enabled: true,
    matchedTargets,
    reasons,
    stage: flag.rollout.stage,
  };
};

const normalizeReleasePolicy = (value: unknown, env: EnvLike): AdminReleaseGovernancePolicy => {
  const record = parseOptionalJsonRecord(value);
  const compatibility = toRecord(record.compatibility);
  const releaseId =
    normalizeNullableText(record.releaseId) ??
    normalizeNullableText(readEnv(env, "RELEASE_ACTIVE_ID", "SENTRY_RELEASE", "RELEASE_SHA", "VERCEL_GIT_COMMIT_SHA"));
  const previousReleaseId =
    normalizeNullableText(record.previousReleaseId) ??
    normalizeNullableText(readEnv(env, "RELEASE_PREVIOUS_SHA", "PREVIOUS_RELEASE_SHA"));
  const phaseValue = normalizeLower(record.phase);
  const phase: AdminReleasePhase = isReleasePhase(phaseValue)
    ? phaseValue
    : toBoolean(toRecord(record.rollout).paused, false)
      ? "paused"
      : "rolling";

  return {
    appliedSchemaVersion:
      normalizeNullableText(record.appliedSchemaVersion) ??
      normalizeNullableText(toRecord(compatibility.schema).currentVersion) ??
      normalizeNullableText(readEnv(env, "RELEASE_APPLIED_SCHEMA_VERSION")),
    channel: inferReleaseChannel(env, record.channel),
    compatibility: {
      apiVersion: {
        currentVersion:
          normalizeNullableText(toRecord(compatibility.apiVersion).currentVersion) ??
          normalizeNullableText(readEnv(env, "RELEASE_API_VERSION", "SENTRY_RELEASE", "RELEASE_SHA")),
        maximumVersion: normalizeNullableText(toRecord(compatibility.apiVersion).maximumVersion),
        minimumVersion: normalizeNullableText(toRecord(compatibility.apiVersion).minimumVersion),
        targetVersion: normalizeNullableText(toRecord(compatibility.apiVersion).targetVersion) ?? releaseId,
      },
      browserRuntime: {
        currentVersion: normalizeNullableText(toRecord(compatibility.browserRuntime).currentVersion),
        maximumVersion: normalizeNullableText(toRecord(compatibility.browserRuntime).maximumVersion),
        minimumVersion: normalizeNullableText(toRecord(compatibility.browserRuntime).minimumVersion),
        targetVersion: normalizeNullableText(toRecord(compatibility.browserRuntime).targetVersion),
      },
      governanceContract: {
        currentVersion:
          normalizeNullableText(toRecord(compatibility.governanceContract).currentVersion) ??
          normalizeNullableText(readEnv(env, "RELEASE_GOVERNANCE_CONTRACT_VERSION")) ??
          OPERATOR_POLICY_VERSION,
        maximumVersion: normalizeNullableText(toRecord(compatibility.governanceContract).maximumVersion),
        minimumVersion:
          normalizeNullableText(toRecord(compatibility.governanceContract).minimumVersion) ??
          OPERATOR_POLICY_VERSION,
        targetVersion:
          normalizeNullableText(toRecord(compatibility.governanceContract).targetVersion) ??
          OPERATOR_POLICY_VERSION,
      },
      observabilityPayload: {
        currentVersion:
          normalizeNullableText(toRecord(compatibility.observabilityPayload).currentVersion) ??
          normalizeNullableText(readEnv(env, "RELEASE_OBSERVABILITY_VERSION")) ??
          OBSERVABILITY_PAYLOAD_CONTRACT_VERSION,
        maximumVersion: normalizeNullableText(toRecord(compatibility.observabilityPayload).maximumVersion),
        minimumVersion:
          normalizeNullableText(toRecord(compatibility.observabilityPayload).minimumVersion) ??
          OBSERVABILITY_PAYLOAD_CONTRACT_VERSION,
        targetVersion:
          normalizeNullableText(toRecord(compatibility.observabilityPayload).targetVersion) ??
          OBSERVABILITY_PAYLOAD_CONTRACT_VERSION,
      },
      operationalIntelligence: {
        currentVersion:
          normalizeNullableText(toRecord(compatibility.operationalIntelligence).currentVersion) ??
          normalizeNullableText(readEnv(env, "RELEASE_OPERATIONAL_INTELLIGENCE_VERSION")) ??
          OPERATIONAL_INTELLIGENCE_CONTRACT_VERSION,
        maximumVersion: normalizeNullableText(toRecord(compatibility.operationalIntelligence).maximumVersion),
        minimumVersion:
          normalizeNullableText(toRecord(compatibility.operationalIntelligence).minimumVersion) ??
          OPERATIONAL_INTELLIGENCE_CONTRACT_VERSION,
        targetVersion:
          normalizeNullableText(toRecord(compatibility.operationalIntelligence).targetVersion) ??
          OPERATIONAL_INTELLIGENCE_CONTRACT_VERSION,
      },
      queueWorker: {
        currentVersion:
          normalizeNullableText(toRecord(compatibility.queueWorker).currentVersion) ??
          normalizeNullableText(readEnv(env, "RELEASE_QUEUE_WORKER_VERSION", "SENTRY_RELEASE", "RELEASE_SHA")),
        maximumVersion: normalizeNullableText(toRecord(compatibility.queueWorker).maximumVersion),
        minimumVersion: normalizeNullableText(toRecord(compatibility.queueWorker).minimumVersion),
        targetVersion: normalizeNullableText(toRecord(compatibility.queueWorker).targetVersion) ?? releaseId,
      },
      schema: {
        currentVersion:
          normalizeNullableText(toRecord(compatibility.schema).currentVersion) ??
          normalizeNullableText(readEnv(env, "RELEASE_APPLIED_SCHEMA_VERSION")),
        maximumVersion: normalizeNullableText(toRecord(compatibility.schema).maximumVersion),
        minimumVersion:
          normalizeNullableText(toRecord(compatibility.schema).minimumVersion) ??
          normalizeNullableText(readEnv(env, "RELEASE_MIN_SCHEMA_VERSION")),
        targetVersion:
          normalizeNullableText(toRecord(compatibility.schema).targetVersion) ??
          normalizeNullableText(readEnv(env, "RELEASE_SCHEMA_VERSION")),
      },
    },
    completedAt: normalizeNullableText(record.completedAt),
    migration: {
      maintenanceRequired: toBoolean(toRecord(record.migration).maintenanceRequired, false),
      queueDrainRequired: toBoolean(toRecord(record.migration).queueDrainRequired, false),
      safeWindowEndHourUtc: Number.isFinite(toPositiveNumber(toRecord(record.migration).safeWindowEndHourUtc, Number.NaN))
        ? Math.trunc(toPositiveNumber(toRecord(record.migration).safeWindowEndHourUtc, 0))
        : null,
      safeWindowStartHourUtc: Number.isFinite(toPositiveNumber(toRecord(record.migration).safeWindowStartHourUtc, Number.NaN))
        ? Math.trunc(toPositiveNumber(toRecord(record.migration).safeWindowStartHourUtc, 0))
        : null,
      strategy: (normalizeLower(toRecord(record.migration).strategy) || "expand_contract") as
        | "breaking"
        | "expand_contract"
        | "online"
        | "unknown",
    },
    phase,
    previousReleaseId,
    releaseId,
    rollback: {
      safeDegradationRequired: toBoolean(toRecord(record.rollback).safeDegradationRequired, true),
      targetReleaseId: normalizeNullableText(toRecord(record.rollback).targetReleaseId) ?? previousReleaseId,
    },
    rollout: {
      paused: toBoolean(toRecord(record.rollout).paused, phase === "paused"),
    },
    startedAt: normalizeNullableText(record.startedAt),
  };
};

const buildCompatibilityEntry = ({
  actualVersion,
  contract,
  detailWhenCompatible,
  expectedVersion,
  maximumVersion,
  minimumVersion,
}: {
  actualVersion: string | null;
  contract: AdminReleaseCompatibilityMatrixEntry["contract"];
  detailWhenCompatible: string;
  expectedVersion: string | null;
  maximumVersion: string | null;
  minimumVersion: string | null;
}): AdminReleaseCompatibilityMatrixEntry => {
  let status: AdminReleaseCompatibilityStatus = "compatible";
  let detail = detailWhenCompatible;

  if (!actualVersion && (expectedVersion || minimumVersion || maximumVersion)) {
    status = "warning";
    detail = "Current version is not being reported for this contract.";
  } else if (actualVersion && minimumVersion && compareReleaseVersions(actualVersion, minimumVersion) < 0) {
    status = "incompatible";
    detail = `Current version ${actualVersion} is below the minimum compatible version ${minimumVersion}.`;
  } else if (actualVersion && maximumVersion && compareReleaseVersions(actualVersion, maximumVersion) > 0) {
    status = "incompatible";
    detail = `Current version ${actualVersion} is above the maximum compatible version ${maximumVersion}.`;
  } else if (
    actualVersion &&
    expectedVersion &&
    compareReleaseVersions(actualVersion, expectedVersion) !== 0 &&
    minimumVersion &&
    compareReleaseVersions(expectedVersion, minimumVersion) === 0 &&
    !maximumVersion
  ) {
    status = "incompatible";
    detail = `Current version ${actualVersion} does not match the fixed contract version ${expectedVersion}.`;
  } else if (actualVersion && expectedVersion && compareReleaseVersions(actualVersion, expectedVersion) !== 0) {
    status = "warning";
    detail = `Current version ${actualVersion} differs from the targeted release version ${expectedVersion}.`;
  }

  return {
    actualVersion,
    contract,
    detail,
    expectedVersion,
    maximumVersion,
    minimumVersion,
    status,
  };
};

const buildSchemaGovernance = ({
  migrationVersions,
  now,
  policy,
  runtimeGovernance,
  runtimeVisibility,
}: {
  migrationVersions: string[];
  now: number;
  policy: AdminReleaseGovernancePolicy;
  runtimeGovernance: AdminRuntimeGovernanceState;
  runtimeVisibility: AdminRuntimeVisibility;
}): AdminReleaseSchemaGovernance => {
  const latestLocalVersion = migrationVersions[migrationVersions.length - 1] ?? null;
  const schemaPolicy = toRecord(policy.compatibility?.schema);
  const appliedVersion =
    normalizeNullableText(policy.appliedSchemaVersion) ??
    normalizeNullableText(schemaPolicy.currentVersion) ??
    latestLocalVersion;
  const targetVersion =
    normalizeNullableText(schemaPolicy.targetVersion) ??
    latestLocalVersion;
  const minimumCompatibleVersion =
    normalizeNullableText(schemaPolicy.minimumVersion) ??
    targetVersion;
  const safeWindowActive = isSafeWindowActive(
    policy.migration?.safeWindowStartHourUtc,
    policy.migration?.safeWindowEndHourUtc,
    now,
  );
  const pendingMigrations = appliedVersion
    ? migrationVersions.filter((version) => compareReleaseVersions(version, appliedVersion) > 0)
    : migrationVersions;
  const driftWarnings = uniqueStrings([
    latestLocalVersion && targetVersion && latestLocalVersion !== targetVersion
      ? `Latest local migration ${latestLocalVersion} differs from target release schema ${targetVersion}.`
      : null,
    pendingMigrations.length > 0
      ? `${pendingMigrations.length} migration(s) are newer than the applied schema version.`
      : null,
    appliedVersion && minimumCompatibleVersion && compareReleaseVersions(appliedVersion, minimumCompatibleVersion) < 0
      ? `Applied schema ${appliedVersion} is below the minimum compatible version ${minimumCompatibleVersion}.`
      : null,
    !safeWindowActive && pendingMigrations.length > 0
      ? "Schema changes are pending outside the declared migration window."
      : null,
  ]);
  const sequencing = uniqueStrings([
    pendingMigrations.length > 0 ? "Apply schema expansion changes before widening runtime rollout." : null,
    policy.migration?.queueDrainRequired ? "Drain queue workers before applying release-sensitive migrations." : null,
    policy.migration?.maintenanceRequired ? "Enter maintenance mode before executing blocking migrations." : null,
    compareReleaseVersions(appliedVersion, targetVersion) === 0
      ? "Runtime and schema are aligned for the current release target."
      : null,
  ]);

  const queueDrainReady =
    !policy.migration?.queueDrainRequired ||
    (!runtimeGovernance.queueProcessingEnabled && runtimeVisibility.activeWorkers === 0 && runtimeVisibility.queueLagMs === 0);
  const maintenanceReady = !policy.migration?.maintenanceRequired || runtimeGovernance.maintenanceMode;

  const readiness =
    (appliedVersion && minimumCompatibleVersion && compareReleaseVersions(appliedVersion, minimumCompatibleVersion) < 0) ||
    !queueDrainReady ||
    !maintenanceReady
      ? "blocked"
      : pendingMigrations.length > 0 || !safeWindowActive || driftWarnings.length > 0
        ? "caution"
        : "ready";

  return {
    appliedVersion,
    driftWarnings,
    latestLocalVersion,
    maintenanceRequired: toBoolean(policy.migration?.maintenanceRequired, false),
    minimumCompatibleVersion,
    pendingMigrations,
    queueDrainRequired: toBoolean(policy.migration?.queueDrainRequired, false),
    readiness,
    safeWindowActive,
    sequencing,
    strategy: policy.migration?.strategy ?? "unknown",
    targetVersion,
  };
};

const buildReleaseRolloutGovernance = (featureFlags: AdminFeatureFlag[]): AdminReleaseRolloutGovernance => {
  const activeFlags = featureFlags.filter((flag) => flag.enabled && flag.rollout.stage !== "disabled");
  const canaryFlags = activeFlags.filter((flag) => flag.rollout.stage === "canary").length;
  const tenantScopedFlags = activeFlags.filter((flag) => flag.rollout.tenantTargets.length > 0).length;
  const runtimeTargetedFlags = activeFlags.filter((flag) => flag.rollout.runtimeTargets.length > 0 || flag.rollout.releaseTargets.length > 0).length;
  const stagedFlags = activeFlags.filter((flag) =>
    ["canary", "tenant_scoped", "runtime_targeted", "staged", "paused"].includes(flag.rollout.stage),
  ).length;
  const pausedFlags = featureFlags.filter((flag) => flag.rollout.paused).length;
  const emergencyRollbackReady = activeFlags.every((flag) => flag.rollout.emergencyRollbackReady);
  const issues = uniqueStrings(
    activeFlags.flatMap((flag) => [
      ...flag.rollout.warnings,
      flag.rollout.healthStatus === "critical"
        ? `${flag.name} is reporting critical rollout health.`
        : null,
    ]),
  );
  const healthStatus: AdminReleaseHealthStatus =
    issues.some((issue) => issue.toLowerCase().includes("critical")) || !emergencyRollbackReady
      ? "critical"
      : issues.length > 0 || pausedFlags > 0
        ? "warning"
        : "healthy";

  return {
    activeFlagCount: activeFlags.length,
    canaryFlags,
    emergencyRollbackReady,
    healthStatus,
    issues,
    pausedFlags,
    progressPercentage:
      activeFlags.length > 0
        ? Number(
            (
              activeFlags.reduce((sum, flag) => sum + clampPercentage(flag.rolloutPercentage, 0), 0) / activeFlags.length
            ).toFixed(2),
          )
        : 0,
    runtimeTargetedFlags,
    stagedFlags,
    tenantScopedFlags,
  };
};

const buildReleaseLineage = ({
  env,
  policy,
  schema,
}: {
  env: EnvLike;
  policy: AdminReleaseGovernancePolicy;
  schema: AdminReleaseSchemaGovernance;
}): AdminReleaseLineage => {
  const commitSha = normalizeNullableText(readEnv(env, "VERCEL_GIT_COMMIT_SHA", "RELEASE_SHA", "SENTRY_RELEASE"));
  const deploymentId = normalizeNullableText(readEnv(env, "VERCEL_DEPLOYMENT_ID", "RAILWAY_DEPLOYMENT_ID", "RENDER_GIT_COMMIT"));
  const fingerprint = createHash("sha256")
    .update([
      policy.releaseId ?? "missing",
      policy.phase ?? "rolling",
      commitSha ?? "missing",
      deploymentId ?? "missing",
      schema.targetVersion ?? "missing",
    ].join("|"))
    .digest("hex")
    .slice(0, 16);

  return {
    channel: policy.channel ?? "development",
    commitSha,
    completedAt: normalizeNullableText(policy.completedAt),
    deploymentId,
    fingerprint,
    phase: policy.phase ?? "rolling",
    previousReleaseId: normalizeNullableText(policy.previousReleaseId),
    releaseId: normalizeNullableText(policy.releaseId),
    rollbackTargetReleaseId: normalizeNullableText(policy.rollback?.targetReleaseId),
    startedAt: normalizeNullableText(policy.startedAt),
  };
};

const buildRollbackSafety = ({
  lineage,
  rollouts,
  runtimeGovernance,
  runtimeVisibility,
  schema,
  policy,
}: {
  lineage: AdminReleaseLineage;
  policy: AdminReleaseGovernancePolicy;
  rollouts: AdminReleaseRolloutGovernance;
  runtimeGovernance: AdminRuntimeGovernanceState;
  runtimeVisibility: AdminRuntimeVisibility;
  schema: AdminReleaseSchemaGovernance;
}): AdminReleaseRollbackSafety => {
  const safeDegradationActive =
    runtimeGovernance.maintenanceMode ||
    !runtimeGovernance.queueProcessingEnabled ||
    runtimeVisibility.redisDegraded;
  const blockers = uniqueStrings([
    !lineage.rollbackTargetReleaseId
      ? "No rollback target release is recorded."
      : null,
    schema.strategy === "breaking"
      ? "Schema strategy is marked as breaking, so rollback cannot be assumed safe."
      : null,
    schema.readiness === "blocked"
      ? "Schema readiness is blocked for the declared compatibility window."
      : null,
    !rollouts.emergencyRollbackReady
      ? "At least one active staged rollout lacks an emergency rollback path."
      : null,
    toBoolean(policy.rollback?.safeDegradationRequired, true) && !safeDegradationActive
      ? "Rollback requires degraded-mode protection, but the runtime is still fully live."
      : null,
  ]);

  return {
    blockers,
    ready: blockers.length === 0,
    safeDegradationActive,
    summary:
      blockers.length === 0
        ? "Rollback can proceed with the recorded release target and current degradation posture."
        : "Rollback is not yet safe because release or schema prerequisites are missing.",
    targetReleaseId: lineage.rollbackTargetReleaseId,
  };
};

const buildDeploymentOrchestration = ({
  incidents,
  policy,
  rollback,
  runtimeGovernance,
  runtimeVisibility,
  schema,
}: {
  incidents: Pick<AdminIncidentGroup, "severity">[];
  policy: AdminReleaseGovernancePolicy;
  rollback: AdminReleaseRollbackSafety;
  runtimeGovernance: AdminRuntimeGovernanceState;
  runtimeVisibility: AdminRuntimeVisibility;
  schema: AdminReleaseSchemaGovernance;
}): AdminReleaseDeploymentOrchestration => {
  const queueDrainRequired = schema.queueDrainRequired;
  const queueDrainReady =
    !queueDrainRequired ||
    (!runtimeGovernance.queueProcessingEnabled && runtimeVisibility.activeWorkers === 0 && runtimeVisibility.queueLagMs === 0);
  const maintenanceRequired = schema.maintenanceRequired;
  const maintenanceReady = !maintenanceRequired || runtimeGovernance.maintenanceMode;
  const degradedModeActive = runtimeGovernance.maintenanceMode || runtimeVisibility.redisDegraded;
  const criticalIncidents = incidents.filter((incident) => incident.severity === "CRITICAL").length;
  const rolloutPaused = toBoolean(policy.rollout?.paused, false);

  return {
    degradedModeActive,
    maintenanceReady,
    maintenanceRequired,
    partialRollbackActive: (policy.phase ?? "rolling") === "rollback" && !rollback.ready,
    phase: policy.phase ?? "rolling",
    queueDrainReady,
    queueDrainRequired,
    rolloutPaused,
    steps: uniqueStrings([
      queueDrainRequired && !queueDrainReady ? "Pause queue claims and wait for queue lag to reach zero." : null,
      maintenanceRequired && !maintenanceReady ? "Enter maintenance mode before continuing the release." : null,
      schema.pendingMigrations.length > 0 ? "Apply pending migrations before widening the release window." : null,
      rolloutPaused ? "Rollout is paused; resume only after compatibility checks return green." : null,
      criticalIncidents > 0 ? "Critical incidents are active; hold rollout expansion until incident pressure drops." : null,
      rollback.ready ? "Rollback target is armed and safe if release health regresses." : null,
    ]),
  };
};

const buildReleaseHealthScore = ({
  compatibility,
  incidents,
  lineage,
  orchestration,
  rollback,
  rollouts,
  schema,
}: {
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  incidents: Pick<AdminIncidentGroup, "severity">[];
  lineage: AdminReleaseLineage;
  orchestration: AdminReleaseDeploymentOrchestration;
  rollback: AdminReleaseRollbackSafety;
  rollouts: AdminReleaseRolloutGovernance;
  schema: AdminReleaseSchemaGovernance;
}): AdminReleaseHealthScore => {
  let score = 100;
  const drivers: string[] = [];

  if (!lineage.releaseId) {
    score -= 25;
    drivers.push("Active release identifier is missing.");
  }

  for (const entry of compatibility) {
    if (entry.status === "incompatible") {
      score -= 20;
      drivers.push(`${entry.contract} is incompatible: ${entry.detail}`);
    } else if (entry.status === "warning") {
      score -= 8;
      drivers.push(`${entry.contract} needs attention: ${entry.detail}`);
    }
  }

  if (schema.readiness === "blocked") {
    score -= 20;
    drivers.push("Schema readiness is blocked.");
  } else if (schema.readiness === "caution") {
    score -= 8;
    drivers.push("Schema readiness is in caution mode.");
  }

  if (!rollback.ready) {
    score -= 12;
    drivers.push("Rollback is not yet safe.");
  }

  if (rollouts.healthStatus === "critical") {
    score -= 22;
    drivers.push("One or more rollouts lack safe health or rollback posture.");
  } else if (rollouts.healthStatus === "warning") {
    score -= 6;
    drivers.push("Active rollouts need additional monitoring.");
  }

  if (rollouts.stagedFlags > 0 && !rollouts.emergencyRollbackReady) {
    score -= 18;
    drivers.push("Staged rollout is active without a guaranteed emergency rollback path.");
  }

  if (orchestration.degradedModeActive) {
    score -= 5;
    drivers.push("Release is running with degraded-mode protections active.");
  }

  const criticalIncidentCount = incidents.filter((incident) => incident.severity === "CRITICAL").length;
  if (criticalIncidentCount > 0) {
    score -= 10;
    drivers.push(`${criticalIncidentCount} critical incident(s) are active during the release.`);
  }

  score = Math.max(0, score);
  const status: AdminReleaseHealthStatus = score < 65 ? "critical" : score < 85 ? "warning" : "healthy";

  return {
    drivers,
    score,
    status,
    summary:
      status === "healthy"
        ? "Release is operating inside the declared compatibility and rollback guardrails."
        : status === "warning"
          ? "Release is still recoverable, but compatibility or sequencing warnings need attention."
          : "Release safety is at risk because compatibility, migration, or rollback controls are incomplete.",
  };
};

const buildReleaseForensics = ({
  auditLogs,
  incidents,
  lineage,
  now,
  traceEvents,
}: {
  auditLogs: ReleaseAuditLog[];
  incidents: Pick<AdminIncidentGroup, "incidentKey" | "lastSeenAt" | "latestMessage" | "severity">[];
  lineage: AdminReleaseLineage;
  now: number;
  traceEvents: AdminRuntimeTraceEvent[];
}) => {
  const deploymentEvent: AdminReleaseForensicsEvent = {
    detail: `Fingerprint ${lineage.fingerprint}.`,
    occurredAt: lineage.startedAt ?? new Date(now).toISOString(),
    releaseId: lineage.releaseId,
    severity: "info",
    summary: lineage.releaseId
      ? `Release ${lineage.releaseId} entered ${lineage.phase} phase.`
      : "Release phase changed without a recorded release identifier.",
    type: "deployment",
  };

  const auditEvents = auditLogs
    .map((log): AdminReleaseForensicsEvent | null => {
      const action = normalizeLower(log.action);
      if (!action) {
        return null;
      }

      const mappedType =
        action.includes("feature_flag")
          ? "rollout"
          : action.includes("release")
            ? "deployment"
            : action.includes("rollback")
              ? "rollback"
              : action.includes("platform_settings")
                ? "migration"
                : null;

      if (!mappedType) {
        return null;
      }

      return {
        detail: normalizeText(log.targetDisplay) || normalizeText(log.targetType) || "Platform control-plane action.",
        occurredAt: log.createdAt ?? new Date(now).toISOString(),
        releaseId: lineage.releaseId,
        severity: action.includes("rollback") ? "high" : "info",
        summary: normalizeText(log.action).replaceAll("_", " "),
        type: mappedType,
      };
    })
    .filter((event): event is AdminReleaseForensicsEvent => Boolean(event));

  const traceForensics = traceEvents
    .map((event): AdminReleaseForensicsEvent | null => {
      const haystack = `${event.type} ${event.message ?? ""}`.toLowerCase();
      const type =
        haystack.includes("rollback")
          ? "rollback"
          : haystack.includes("migration") || haystack.includes("schema")
            ? "migration"
            : haystack.includes("release") || haystack.includes("deploy")
              ? "deployment"
              : haystack.includes("compat")
                ? "compatibility"
                : null;

      if (!type) {
        return null;
      }

      return {
        detail: event.message || event.type,
        occurredAt: event.occurredAt,
        releaseId: lineage.releaseId,
        severity:
          event.severity === "CRITICAL"
            ? "critical"
            : event.severity === "ERROR"
              ? "high"
              : event.severity === "WARNING"
                ? "medium"
                : "info",
        summary: event.type,
        type,
      };
    })
    .filter((event): event is AdminReleaseForensicsEvent => Boolean(event));

  const incidentEvents = incidents
    .filter((incident) => normalizeText(incident.lastSeenAt))
    .map((incident): AdminReleaseForensicsEvent => ({
      detail: incident.latestMessage || incident.incidentKey,
      occurredAt: incident.lastSeenAt || new Date(now).toISOString(),
      releaseId: lineage.releaseId,
      severity: incident.severity === "CRITICAL" ? "critical" : incident.severity === "ERROR" ? "high" : "medium",
      summary: `Incident ${incident.incidentKey} intersected the release.`,
      type: "incident",
    }));

  const events = [deploymentEvent, ...auditEvents, ...traceForensics, ...incidentEvents]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 20);

  return {
    events,
    incidentCount: incidentEvents.length,
    rollbackChain: uniqueStrings([
      lineage.releaseId,
      lineage.previousReleaseId,
      lineage.rollbackTargetReleaseId,
    ]),
  };
};

export const buildReleaseGovernanceSnapshot = ({
  auditLogs = [],
  env = process.env,
  featureFlags = [],
  incidents = [],
  migrationVersions,
  now = Date.now(),
  runtimeGovernance,
  runtimeVisibility,
  settingsMap,
  traceEvents = [],
}: ReleaseGovernanceInput): AdminReleaseGovernanceSnapshot => {
  const rawPolicy = getSettingValue(settingsMap, RELEASE_GOVERNANCE_POLICY_KEY) ?? env.RELEASE_GOVERNANCE_POLICY;
  const policy = normalizeReleasePolicy(rawPolicy, env);
  const enrichedFeatureFlags = featureFlags.map((flag) => ({
    ...flag,
    rollout: flag.rollout ?? deriveFeatureFlagRolloutGovernance(flag),
  }));
  const schema = buildSchemaGovernance({
    migrationVersions: migrationVersions ?? getLocalMigrationVersions(),
    now,
    policy,
    runtimeGovernance,
    runtimeVisibility,
  });
  const lineage = buildReleaseLineage({
    env,
    policy,
    schema,
  });
  const compatibility: AdminReleaseCompatibilityMatrixEntry[] = [
    buildCompatibilityEntry({
      actualVersion: normalizeNullableText(policy.compatibility?.browserRuntime?.currentVersion ?? null),
      contract: "browser_runtime",
      detailWhenCompatible: "Browser runtime compatibility window is satisfied.",
      expectedVersion: normalizeNullableText(policy.compatibility?.browserRuntime?.targetVersion ?? null),
      maximumVersion: normalizeNullableText(policy.compatibility?.browserRuntime?.maximumVersion ?? null),
      minimumVersion: normalizeNullableText(policy.compatibility?.browserRuntime?.minimumVersion ?? null),
    }),
    buildCompatibilityEntry({
      actualVersion: normalizeNullableText(readEnv(env, "RELEASE_API_VERSION", "SENTRY_RELEASE", "RELEASE_SHA")) ?? lineage.releaseId,
      contract: "api_version",
      detailWhenCompatible: "API release version is inside the declared compatibility window.",
      expectedVersion: normalizeNullableText(policy.compatibility?.apiVersion?.targetVersion ?? null),
      maximumVersion: normalizeNullableText(policy.compatibility?.apiVersion?.maximumVersion ?? null),
      minimumVersion: normalizeNullableText(policy.compatibility?.apiVersion?.minimumVersion ?? null),
    }),
    buildCompatibilityEntry({
      actualVersion: normalizeNullableText(readEnv(env, "RELEASE_QUEUE_WORKER_VERSION", "SENTRY_RELEASE", "RELEASE_SHA")) ?? lineage.releaseId,
      contract: "queue_worker",
      detailWhenCompatible: "Queue worker version is inside the declared compatibility window.",
      expectedVersion: normalizeNullableText(policy.compatibility?.queueWorker?.targetVersion ?? null),
      maximumVersion: normalizeNullableText(policy.compatibility?.queueWorker?.maximumVersion ?? null),
      minimumVersion: normalizeNullableText(policy.compatibility?.queueWorker?.minimumVersion ?? null),
    }),
    buildCompatibilityEntry({
      actualVersion:
        normalizeNullableText(readEnv(env, "RELEASE_OPERATIONAL_INTELLIGENCE_VERSION")) ??
        OPERATIONAL_INTELLIGENCE_CONTRACT_VERSION,
      contract: "operational_intelligence",
      detailWhenCompatible: "Operational-intelligence contract is aligned with the release window.",
      expectedVersion: normalizeNullableText(policy.compatibility?.operationalIntelligence?.targetVersion ?? null),
      maximumVersion: normalizeNullableText(policy.compatibility?.operationalIntelligence?.maximumVersion ?? null),
      minimumVersion: normalizeNullableText(policy.compatibility?.operationalIntelligence?.minimumVersion ?? null),
    }),
    buildCompatibilityEntry({
      actualVersion:
        normalizeNullableText(readEnv(env, "RELEASE_GOVERNANCE_CONTRACT_VERSION")) ??
        OPERATOR_POLICY_VERSION,
      contract: "governance_contract",
      detailWhenCompatible: "Governance contract version is aligned with the release window.",
      expectedVersion: normalizeNullableText(policy.compatibility?.governanceContract?.targetVersion ?? null),
      maximumVersion: normalizeNullableText(policy.compatibility?.governanceContract?.maximumVersion ?? null),
      minimumVersion: normalizeNullableText(policy.compatibility?.governanceContract?.minimumVersion ?? null),
    }),
    buildCompatibilityEntry({
      actualVersion:
        normalizeNullableText(readEnv(env, "RELEASE_OBSERVABILITY_VERSION")) ??
        OBSERVABILITY_PAYLOAD_CONTRACT_VERSION,
      contract: "observability_payload",
      detailWhenCompatible: "Observability payload version is aligned with the release window.",
      expectedVersion: normalizeNullableText(policy.compatibility?.observabilityPayload?.targetVersion ?? null),
      maximumVersion: normalizeNullableText(policy.compatibility?.observabilityPayload?.maximumVersion ?? null),
      minimumVersion: normalizeNullableText(policy.compatibility?.observabilityPayload?.minimumVersion ?? null),
    }),
    buildCompatibilityEntry({
      actualVersion: schema.appliedVersion,
      contract: "schema",
      detailWhenCompatible: "Applied schema version is inside the declared compatibility window.",
      expectedVersion: schema.targetVersion,
      maximumVersion: normalizeNullableText(policy.compatibility?.schema?.maximumVersion ?? null),
      minimumVersion: schema.minimumCompatibleVersion,
    }),
  ];
  const rollouts = buildReleaseRolloutGovernance(enrichedFeatureFlags);
  const rollback = buildRollbackSafety({
    lineage,
    policy,
    rollouts,
    runtimeGovernance,
    runtimeVisibility,
    schema,
  });
  const orchestration = buildDeploymentOrchestration({
    incidents,
    policy,
    rollback,
    runtimeGovernance,
    runtimeVisibility,
    schema,
  });
  const health = buildReleaseHealthScore({
    compatibility,
    incidents,
    lineage,
    orchestration,
    rollback,
    rollouts,
    schema,
  });
  const forensics = buildReleaseForensics({
    auditLogs,
    incidents,
    lineage,
    now,
    traceEvents,
  });

  return {
    compatibility,
    forensics,
    health,
    lineage,
    orchestration,
    policy,
    rollback,
    rollouts,
    schema,
    warnings: uniqueStrings([
      ...compatibility.filter((entry) => entry.status !== "compatible").map((entry) => entry.detail),
      ...schema.driftWarnings,
      ...rollouts.issues,
      ...rollback.blockers,
    ]),
  };
};

export const validateReleaseGovernanceSnapshot = (snapshot: AdminReleaseGovernanceSnapshot) => {
  const blockers = uniqueStrings([
    snapshot.health.status === "critical" ? snapshot.health.summary : null,
    ...snapshot.rollback.blockers,
    snapshot.schema.readiness === "blocked" ? "Schema readiness is blocked." : null,
    ...snapshot.compatibility
      .filter((entry) => entry.status === "incompatible")
      .map((entry) => `${entry.contract}: ${entry.detail}`),
  ]);

  return {
    blockers,
    ok: blockers.length === 0,
    warnings: snapshot.warnings,
  };
};

export {
  RELEASE_GOVERNANCE_CONTRACT_VERSION,
  RELEASE_GOVERNANCE_POLICY_KEY,
  OBSERVABILITY_PAYLOAD_CONTRACT_VERSION,
  OPERATIONAL_INTELLIGENCE_CONTRACT_VERSION,
};
