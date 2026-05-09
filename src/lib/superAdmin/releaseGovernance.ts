import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { OPERATOR_POLICY_VERSION } from "./governance.js";
import type {
  AdminFeatureFlag,
  AdminFeatureFlagRolloutGovernance,
  AdminIncidentGroup,
  AdminLibraryControlRow,
  AdminReleaseBlastRadiusEstimate,
  AdminReleaseCanaryGovernance,
  AdminReleaseChannel,
  AdminReleaseCompatibilityWindow,
  AdminReleaseCompatibilityMatrixEntry,
  AdminReleaseCompatibilityStatus,
  AdminReleaseDeploymentOrchestration,
  AdminReleaseEvolutionForecast,
  AdminReleaseEvolutionForecasting,
  AdminReleaseEvolutionGovernance,
  AdminReleaseEvolutionRole,
  AdminReleaseEvolutionTrack,
  AdminReleaseForensicsEvent,
  AdminReleaseGovernancePolicy,
  AdminReleaseGovernanceSnapshot,
  AdminReleaseHealthScore,
  AdminReleaseHealthStatus,
  AdminReleaseLineage,
  AdminReleasePhase,
  AdminReleaseRollbackSafety,
  AdminReleaseRolloutGovernance,
  AdminReleaseSafetyGuardrails,
  AdminReleaseSafetyRule,
  AdminReleaseSimulation,
  AdminReleaseSchemaGovernance,
  AdminReleaseVersionRange,
  AdminTenantEvolutionGovernance,
  AdminTenantEvolutionProgressStatus,
  AdminTenantEvolutionRecord,
  AdminTenantEvolutionReadiness,
  AdminTenantEvolutionStage,
  AdminRuntimeGovernanceState,
  AdminRuntimeTraceEvent,
  AdminRuntimeVisibility,
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
  libraries?: Pick<
    AdminLibraryControlRow,
    | "activeStudents"
    | "city"
    | "controlReason"
    | "controlStatus"
    | "enabled"
    | "id"
    | "lastActivityAt"
    | "monthlyRevenue"
    | "name"
    | "paymentStatus"
    | "state"
    | "subscriptionStatus"
  >[];
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
const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

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

const isReleaseEvolutionRole = (value: string): value is AdminReleaseEvolutionRole =>
  ["current", "canary", "rollback", "migration_in_progress", "stale_runtime"].includes(value);

const isTenantEvolutionStage = (value: string): value is AdminTenantEvolutionStage =>
  ["pending", "canary", "phased", "stable", "rolling_back", "blocked"].includes(value);

const toReleaseHealthStatus = (
  value: unknown,
  fallback: AdminReleaseHealthStatus = "warning",
): AdminReleaseHealthStatus => {
  const normalized = normalizeLower(value);
  if (["healthy", "warning", "critical"].includes(normalized)) {
    return normalized as AdminReleaseHealthStatus;
  }

  if (["pass", "ok", "green"].includes(normalized)) {
    return "healthy";
  }
  if (["warn", "degraded", "yellow"].includes(normalized)) {
    return "warning";
  }
  if (["fail", "failed", "red", "blocked"].includes(normalized)) {
    return "critical";
  }

  return fallback;
};

const toNumberArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => toPositiveNumber(entry, Number.NaN))
      .filter((entry) => Number.isFinite(entry));
  }

  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      return toNumberArray(JSON.parse(value));
    } catch {
      return [] as number[];
    }
  }

  return [] as number[];
};

const toStringArrayRecord = (value: unknown) => {
  const record = toRecord(value);
  const normalized: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(record)) {
    const values = toStringArray(entry);
    if (values.length > 0) {
      normalized[normalizeText(key)] = values;
    }
  }

  return normalized;
};

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
  const canaryRecord = toRecord(record.canary);
  const migrationRecord = toRecord(record.migration);
  const rollbackRecord = toRecord(record.rollback);
  const rolloutRecord = toRecord(record.rollout);
  const runtimeRecord = toRecord(record.runtime);
  const releaseId =
    normalizeNullableText(record.releaseId) ??
    normalizeNullableText(readEnv(env, "RELEASE_ACTIVE_ID", "SENTRY_RELEASE", "RELEASE_SHA", "VERCEL_GIT_COMMIT_SHA"));
  const previousReleaseId =
    normalizeNullableText(record.previousReleaseId) ??
    normalizeNullableText(readEnv(env, "RELEASE_PREVIOUS_SHA", "PREVIOUS_RELEASE_SHA"));
  const phaseValue = normalizeLower(record.phase);
  const phase: AdminReleasePhase = isReleasePhase(phaseValue)
    ? phaseValue
    : toBoolean(rolloutRecord.paused, false)
      ? "paused"
      : "rolling";
  const dependencies = Array.isArray(record.dependencies)
    ? record.dependencies
        .map((entry) => toRecord(entry))
        .map((dependency) => ({
          currentVersion: normalizeNullableText(dependency.currentVersion),
          maximumVersion: normalizeNullableText(dependency.maximumVersion),
          minimumVersion: normalizeNullableText(dependency.minimumVersion),
          name: normalizeText(dependency.name),
          requiredCapabilities: toStringArray(dependency.requiredCapabilities),
          targetVersion: normalizeNullableText(dependency.targetVersion),
        }))
        .filter((dependency) => dependency.name)
    : [];
  const releases = Array.isArray(record.releases)
    ? record.releases
        .map((entry) => toRecord(entry))
        .map((trackedRelease) => {
          const roleValue = normalizeLower(trackedRelease.role);
          const role: AdminReleaseEvolutionRole = isReleaseEvolutionRole(roleValue)
            ? roleValue
            : normalizeNullableText(trackedRelease.releaseId) === normalizeNullableText(rollbackRecord.targetReleaseId)
              ? "rollback"
              : normalizeNullableText(trackedRelease.releaseId) === releaseId
                ? "current"
                : "canary";
          const trackedPhaseValue = normalizeLower(trackedRelease.phase);
          const trackedPhase: AdminReleasePhase = isReleasePhase(trackedPhaseValue)
            ? trackedPhaseValue
            : role === "rollback"
              ? "rollback"
              : role === "canary"
                ? "canary"
                : phase;
          const windowRecord = toRecord(trackedRelease.compatibilityWindow);
          const rangeRecord = toRecord(trackedRelease.supportedRange);

          return {
            compatibilityWindow: {
              maximumRuntimeVersion: normalizeNullableText(windowRecord.maximumRuntimeVersion),
              maximumSchemaVersion: normalizeNullableText(windowRecord.maximumSchemaVersion),
              minimumRuntimeVersion: normalizeNullableText(windowRecord.minimumRuntimeVersion),
              minimumSchemaVersion: normalizeNullableText(windowRecord.minimumSchemaVersion),
            },
            healthStatus: toReleaseHealthStatus(trackedRelease.healthStatus, "warning"),
            interoperableWith: toStringArray(trackedRelease.interoperableWith),
            phase: trackedPhase,
            releaseId: normalizeNullableText(trackedRelease.releaseId),
            role,
            runtimeTargets: toStringArray(trackedRelease.runtimeTargets),
            runtimeVersion: normalizeNullableText(trackedRelease.runtimeVersion),
            schemaVersion: normalizeNullableText(trackedRelease.schemaVersion),
            startedAt: normalizeNullableText(trackedRelease.startedAt),
            supportedRange: {
              maximumVersion: normalizeNullableText(rangeRecord.maximumVersion),
              minimumVersion: normalizeNullableText(rangeRecord.minimumVersion),
              targetVersion: normalizeNullableText(rangeRecord.targetVersion),
            },
          };
        })
    : [];
  const tenants = Array.isArray(record.tenants)
    ? record.tenants
        .map((entry) => toRecord(entry))
        .map((tenant) => {
          const stageValue = normalizeLower(tenant.stage);
          return {
            canary: toBoolean(tenant.canary, false),
            canaryGroup: normalizeNullableText(tenant.canaryGroup),
            healthStatus: toReleaseHealthStatus(tenant.healthStatus, "warning"),
            issues: toStringArray(tenant.issues),
            region: normalizeNullableText(tenant.region),
            releaseId: normalizeNullableText(tenant.releaseId),
            rollbackIsolated: toBoolean(tenant.rollbackIsolated, false),
            rollbackReleaseId: normalizeNullableText(tenant.rollbackReleaseId),
            rolloutPercentage: clampPercentage(tenant.rolloutPercentage, 0),
            stage: isTenantEvolutionStage(stageValue) ? stageValue : null,
            tenantId: normalizeNullableText(tenant.tenantId),
            tenantLabel: normalizeNullableText(tenant.tenantLabel),
          };
        })
        .filter((tenant) => tenant.tenantId || tenant.tenantLabel)
    : [];

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
    canary: {
      anomalyThreshold: Math.trunc(toPositiveNumber(canaryRecord.anomalyThreshold, 3)),
      longLived: toBoolean(canaryRecord.longLived, false),
      progressiveThresholds: toNumberArray(canaryRecord.progressiveThresholds).map((entry) => Math.min(100, Math.trunc(entry))),
    },
    completedAt: normalizeNullableText(record.completedAt),
    dependencies,
    migration: {
      maintenanceRequired: toBoolean(migrationRecord.maintenanceRequired, false),
      queueDrainRequired: toBoolean(migrationRecord.queueDrainRequired, false),
      safeWindowEndHourUtc: Number.isFinite(toPositiveNumber(migrationRecord.safeWindowEndHourUtc, Number.NaN))
        ? Math.trunc(toPositiveNumber(migrationRecord.safeWindowEndHourUtc, 0))
        : null,
      safeWindowStartHourUtc: Number.isFinite(toPositiveNumber(migrationRecord.safeWindowStartHourUtc, Number.NaN))
        ? Math.trunc(toPositiveNumber(migrationRecord.safeWindowStartHourUtc, 0))
        : null,
      strategy: (normalizeLower(migrationRecord.strategy) || "expand_contract") as
        | "breaking"
        | "expand_contract"
        | "online"
        | "unknown",
    },
    phase,
    previousReleaseId,
    releaseId,
    releases,
    rollback: {
      safeDegradationRequired: toBoolean(rollbackRecord.safeDegradationRequired, true),
      targetReleaseId: normalizeNullableText(rollbackRecord.targetReleaseId) ?? previousReleaseId,
    },
    rollout: {
      paused: toBoolean(rolloutRecord.paused, phase === "paused"),
      regionalSequence: toStringArray(rolloutRecord.regionalSequence),
    },
    runtime: {
      activationOrder: toStringArray(runtimeRecord.activationOrder),
      capabilities: toStringArrayRecord(runtimeRecord.capabilities),
      requirements: toStringArrayRecord(runtimeRecord.requirements),
      staleRuntimeReleaseIds: toStringArray(runtimeRecord.staleRuntimeReleaseIds),
    },
    startedAt: normalizeNullableText(record.startedAt),
    tenants,
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
  const runtimeActivationOrder =
    policy.runtime?.activationOrder && policy.runtime.activationOrder.length > 0
      ? policy.runtime.activationOrder
      : ["api", "queue_worker", "browser_runtime"];
  const capabilityNegotiationWarnings = uniqueStrings(
    Object.entries(policy.runtime?.requirements ?? {}).flatMap(([runtimeTarget, requirements]) => {
      const available = policy.runtime?.capabilities?.[runtimeTarget] ?? [];
      const missing = requirements.filter((requirement) => !available.includes(requirement));
      return missing.length > 0
        ? [`${runtimeTarget} is missing required capabilities: ${missing.join(", ")}.`]
        : [];
    }),
  );
  const dependencySequencing = uniqueStrings([
    ...(policy.dependencies ?? []).flatMap((dependency) =>
      dependency.currentVersion &&
      dependency.targetVersion &&
      compareReleaseVersions(dependency.currentVersion, dependency.targetVersion) !== 0
        ? [`Align dependency ${dependency.name} from ${dependency.currentVersion} to ${dependency.targetVersion} before wider runtime activation.`]
        : [],
    ),
    schema.pendingMigrations.length > 0 ? "Keep runtime activation behind pending schema changes." : null,
    queueDrainRequired ? "Queue-aware deployment requires a clean worker drain before migration-sensitive steps." : null,
  ]);
  const migrationAwareRolloutReady =
    schema.readiness !== "blocked" &&
    queueDrainReady &&
    maintenanceReady &&
    capabilityNegotiationWarnings.length === 0;

  return {
    capabilityNegotiationWarnings,
    degradedModeActive,
    dependencySequencing,
    maintenanceReady,
    maintenanceRequired,
    migrationAwareRolloutReady,
    partialRollbackActive: (policy.phase ?? "rolling") === "rollback" && !rollback.ready,
    phase: policy.phase ?? "rolling",
    queueDrainReady,
    queueDrainRequired,
    runtimeActivationOrder,
    rolloutPaused,
    steps: uniqueStrings([
      queueDrainRequired && !queueDrainReady ? "Pause queue claims and wait for queue lag to reach zero." : null,
      maintenanceRequired && !maintenanceReady ? "Enter maintenance mode before continuing the release." : null,
      schema.pendingMigrations.length > 0 ? "Apply pending migrations before widening the release window." : null,
      rolloutPaused ? "Rollout is paused; resume only after compatibility checks return green." : null,
      criticalIncidents > 0 ? "Critical incidents are active; hold rollout expansion until incident pressure drops." : null,
      dependencySequencing[0] ?? null,
      capabilityNegotiationWarnings[0] ?? null,
      rollback.ready ? "Rollback target is armed and safe if release health regresses." : null,
    ]),
  };
};

const resolveCompatibilityStatusFromIssues = (
  hardIssues: string[],
  warningIssues: string[],
): AdminReleaseCompatibilityStatus => {
  if (hardIssues.length > 0) {
    return "incompatible";
  }

  if (warningIssues.length > 0) {
    return "warning";
  }

  return "compatible";
};

const findCompatibilityEntry = (
  compatibility: AdminReleaseCompatibilityMatrixEntry[],
  contract: AdminReleaseCompatibilityMatrixEntry["contract"],
) => compatibility.find((entry) => entry.contract === contract);

const resolveReleaseTrackHealthStatus = ({
  explicitStatus,
  issues,
  status,
}: {
  explicitStatus?: AdminReleaseHealthStatus | null;
  issues: string[];
  status: AdminReleaseCompatibilityStatus;
}): AdminReleaseHealthStatus => {
  if (explicitStatus === "critical") {
    return "critical";
  }
  if (explicitStatus === "warning" && status !== "incompatible") {
    return "warning";
  }

  if (status === "incompatible") {
    return "critical";
  }
  if (status === "warning" || issues.length > 0) {
    return "warning";
  }

  return explicitStatus ?? "healthy";
};

const buildSupportedRange = ({
  maximumVersion,
  minimumVersion,
  targetVersion,
}: {
  maximumVersion: string | null;
  minimumVersion: string | null;
  targetVersion: string | null;
}): AdminReleaseVersionRange => ({
  maximumVersion,
  minimumVersion,
  targetVersion,
});

const buildCompatibilityWindow = ({
  maximumRuntimeVersion,
  maximumSchemaVersion,
  minimumRuntimeVersion,
  minimumSchemaVersion,
}: {
  maximumRuntimeVersion: string | null;
  maximumSchemaVersion: string | null;
  minimumRuntimeVersion: string | null;
  minimumSchemaVersion: string | null;
}): AdminReleaseCompatibilityWindow => ({
  maximumRuntimeVersion,
  maximumSchemaVersion,
  minimumRuntimeVersion,
  minimumSchemaVersion,
});

const buildReleaseEvolutionTracks = ({
  compatibility,
  featureFlags,
  lineage,
  policy,
  rollback,
  rollouts,
  schema,
}: {
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  featureFlags: AdminFeatureFlag[];
  lineage: AdminReleaseLineage;
  policy: AdminReleaseGovernancePolicy;
  rollback: AdminReleaseRollbackSafety;
  rollouts: AdminReleaseRolloutGovernance;
  schema: AdminReleaseSchemaGovernance;
}): AdminReleaseEvolutionTrack[] => {
  const apiCompatibility = findCompatibilityEntry(compatibility, "api_version");
  const queueCompatibility = findCompatibilityEntry(compatibility, "queue_worker");
  const browserCompatibility = findCompatibilityEntry(compatibility, "browser_runtime");
  const releaseTargets = uniqueStrings(featureFlags.flatMap((flag) => flag.rollout.releaseTargets));
  const runtimeTargets = uniqueStrings(featureFlags.flatMap((flag) => flag.rollout.runtimeTargets));
  const declaredReleases = policy.releases ?? [];
  const staleRuntimeReleaseIds = uniqueStrings([
    ...(policy.runtime?.staleRuntimeReleaseIds ?? []),
    lineage.releaseId && apiCompatibility?.actualVersion && apiCompatibility.actualVersion !== lineage.releaseId
      ? apiCompatibility.actualVersion
      : null,
    lineage.releaseId && queueCompatibility?.actualVersion && queueCompatibility.actualVersion !== lineage.releaseId
      ? queueCompatibility.actualVersion
      : null,
    lineage.releaseId && browserCompatibility?.actualVersion && browserCompatibility.actualVersion !== lineage.releaseId
      ? browserCompatibility.actualVersion
      : null,
  ]);
  const derivedTracks: NonNullable<AdminReleaseGovernancePolicy["releases"]> = [];

  if (!declaredReleases.some((release) => release.role === "current")) {
    derivedTracks.push({
      healthStatus: rollouts.healthStatus,
      phase: lineage.phase,
      releaseId: lineage.releaseId,
      role: "current",
      runtimeTargets: runtimeTargets.length > 0 ? runtimeTargets : ["api", "queue_worker", "browser_runtime"],
      runtimeVersion: apiCompatibility?.actualVersion ?? lineage.releaseId,
      schemaVersion: schema.appliedVersion,
      startedAt: lineage.startedAt,
      supportedRange: {
        maximumVersion: policy.compatibility?.apiVersion?.maximumVersion ?? null,
        minimumVersion: policy.compatibility?.apiVersion?.minimumVersion ?? null,
        targetVersion: policy.compatibility?.apiVersion?.targetVersion ?? lineage.releaseId,
      },
    });
  }

  if (
    !declaredReleases.some((release) => release.role === "canary") &&
    (rollouts.canaryFlags > 0 || lineage.phase === "canary")
  ) {
    derivedTracks.push({
      healthStatus: rollouts.healthStatus,
      phase: "canary",
      releaseId: releaseTargets[0] ?? lineage.releaseId,
      role: "canary",
      runtimeTargets: runtimeTargets.length > 0 ? runtimeTargets : ["api", "queue_worker"],
      runtimeVersion: queueCompatibility?.actualVersion ?? apiCompatibility?.actualVersion ?? lineage.releaseId,
      schemaVersion: schema.targetVersion ?? schema.appliedVersion,
      startedAt: lineage.startedAt,
      supportedRange: {
        maximumVersion: policy.compatibility?.apiVersion?.maximumVersion ?? lineage.releaseId,
        minimumVersion: policy.compatibility?.apiVersion?.minimumVersion ?? lineage.previousReleaseId ?? lineage.releaseId,
        targetVersion: releaseTargets[0] ?? policy.compatibility?.apiVersion?.targetVersion ?? lineage.releaseId,
      },
    });
  }

  if (!declaredReleases.some((release) => release.role === "rollback") && lineage.rollbackTargetReleaseId) {
    derivedTracks.push({
      healthStatus: rollback.ready ? "healthy" : "critical",
      phase: "rollback",
      releaseId: lineage.rollbackTargetReleaseId,
      role: "rollback",
      runtimeTargets: ["api", "queue_worker"],
      runtimeVersion: lineage.rollbackTargetReleaseId,
      schemaVersion: schema.appliedVersion,
      startedAt: lineage.startedAt,
      supportedRange: {
        maximumVersion: lineage.releaseId,
        minimumVersion: lineage.previousReleaseId ?? lineage.rollbackTargetReleaseId,
        targetVersion: lineage.rollbackTargetReleaseId,
      },
    });
  }

  if (
    !declaredReleases.some((release) => release.role === "migration_in_progress") &&
    (schema.pendingMigrations.length > 0 || schema.appliedVersion !== schema.targetVersion)
  ) {
    derivedTracks.push({
      healthStatus: schema.readiness === "blocked" ? "critical" : "warning",
      phase: schema.pendingMigrations.length > 0 ? "validating" : lineage.phase,
      releaseId: lineage.releaseId,
      role: "migration_in_progress",
      runtimeTargets: runtimeTargets.length > 0 ? runtimeTargets : ["api"],
      runtimeVersion: apiCompatibility?.actualVersion ?? lineage.releaseId,
      schemaVersion: schema.targetVersion,
      startedAt: lineage.startedAt,
      supportedRange: {
        maximumVersion: policy.compatibility?.apiVersion?.maximumVersion ?? lineage.releaseId,
        minimumVersion: policy.compatibility?.apiVersion?.minimumVersion ?? lineage.previousReleaseId ?? lineage.releaseId,
        targetVersion: lineage.releaseId,
      },
    });
  }

  if (!declaredReleases.some((release) => release.role === "stale_runtime")) {
    staleRuntimeReleaseIds.forEach((staleReleaseId) => {
      derivedTracks.push({
        healthStatus: "critical",
        phase: lineage.phase,
        releaseId: staleReleaseId,
        role: "stale_runtime",
        runtimeTargets: ["queue_worker", "browser_runtime"],
        runtimeVersion: staleReleaseId,
        schemaVersion: schema.appliedVersion,
        startedAt: lineage.startedAt,
        supportedRange: {
          maximumVersion: lineage.releaseId,
          minimumVersion: policy.compatibility?.apiVersion?.minimumVersion ?? lineage.previousReleaseId ?? staleReleaseId,
          targetVersion: lineage.releaseId,
        },
      });
    });
  }

  const tracks = [...declaredReleases, ...derivedTracks];
  const orderedRoles: AdminReleaseEvolutionRole[] = [
    "current",
    "canary",
    "rollback",
    "migration_in_progress",
    "stale_runtime",
  ];

  return tracks
    .map((track) => {
      const supportedRange = buildSupportedRange({
        maximumVersion: normalizeNullableText(track.supportedRange?.maximumVersion) ?? policy.compatibility?.apiVersion?.maximumVersion ?? null,
        minimumVersion: normalizeNullableText(track.supportedRange?.minimumVersion) ?? policy.compatibility?.apiVersion?.minimumVersion ?? null,
        targetVersion:
          normalizeNullableText(track.supportedRange?.targetVersion) ??
          (track.role === "rollback"
            ? lineage.rollbackTargetReleaseId
            : track.releaseId ?? policy.compatibility?.apiVersion?.targetVersion ?? lineage.releaseId),
      });
      const compatibilityWindow = buildCompatibilityWindow({
        maximumRuntimeVersion:
          normalizeNullableText(track.compatibilityWindow?.maximumRuntimeVersion) ??
          policy.compatibility?.apiVersion?.maximumVersion ??
          null,
        maximumSchemaVersion:
          normalizeNullableText(track.compatibilityWindow?.maximumSchemaVersion) ??
          policy.compatibility?.schema?.maximumVersion ??
          null,
        minimumRuntimeVersion:
          normalizeNullableText(track.compatibilityWindow?.minimumRuntimeVersion) ??
          policy.compatibility?.apiVersion?.minimumVersion ??
          null,
        minimumSchemaVersion:
          normalizeNullableText(track.compatibilityWindow?.minimumSchemaVersion) ??
          schema.minimumCompatibleVersion ??
          null,
      });
      const effectiveRuntimeVersion =
        normalizeNullableText(track.runtimeVersion) ??
        (track.role === "rollback"
          ? lineage.rollbackTargetReleaseId
          : track.role === "stale_runtime"
            ? queueCompatibility?.actualVersion
            : apiCompatibility?.actualVersion ?? lineage.releaseId);
      const effectiveSchemaVersion =
        normalizeNullableText(track.schemaVersion) ??
        (track.role === "migration_in_progress" ? schema.targetVersion : schema.appliedVersion);
      const effectiveRuntimeTargets = uniqueStrings([
        ...(track.runtimeTargets ?? []),
        ...(track.role === "current" && runtimeTargets.length === 0 ? ["api", "queue_worker", "browser_runtime"] : []),
      ]);
      const interoperabilityReleaseIds = uniqueStrings([
        ...(track.interoperableWith ?? []),
        lineage.releaseId,
        lineage.previousReleaseId,
        lineage.rollbackTargetReleaseId,
        ...releaseTargets,
      ]);
      const hardIssues = uniqueStrings([
        track.releaseId && supportedRange.minimumVersion && compareReleaseVersions(track.releaseId, supportedRange.minimumVersion) < 0
          ? `Release ${track.releaseId} is below the supported minimum ${supportedRange.minimumVersion}.`
          : null,
        track.releaseId && supportedRange.maximumVersion && compareReleaseVersions(track.releaseId, supportedRange.maximumVersion) > 0
          ? `Release ${track.releaseId} is above the supported maximum ${supportedRange.maximumVersion}.`
          : null,
        effectiveRuntimeVersion &&
        compatibilityWindow.minimumRuntimeVersion &&
        compareReleaseVersions(effectiveRuntimeVersion, compatibilityWindow.minimumRuntimeVersion) < 0
          ? `Runtime ${effectiveRuntimeVersion} is below the minimum interoperable runtime ${compatibilityWindow.minimumRuntimeVersion}.`
          : null,
        effectiveRuntimeVersion &&
        compatibilityWindow.maximumRuntimeVersion &&
        compareReleaseVersions(effectiveRuntimeVersion, compatibilityWindow.maximumRuntimeVersion) > 0
          ? `Runtime ${effectiveRuntimeVersion} exceeds the maximum interoperable runtime ${compatibilityWindow.maximumRuntimeVersion}.`
          : null,
        effectiveSchemaVersion &&
        compatibilityWindow.minimumSchemaVersion &&
        compareReleaseVersions(effectiveSchemaVersion, compatibilityWindow.minimumSchemaVersion) < 0
          ? `Schema ${effectiveSchemaVersion} is below the minimum interoperable schema ${compatibilityWindow.minimumSchemaVersion}.`
          : null,
        effectiveSchemaVersion &&
        compatibilityWindow.maximumSchemaVersion &&
        compareReleaseVersions(effectiveSchemaVersion, compatibilityWindow.maximumSchemaVersion) > 0
          ? `Schema ${effectiveSchemaVersion} exceeds the maximum interoperable schema ${compatibilityWindow.maximumSchemaVersion}.`
          : null,
        track.role === "rollback" && !rollback.ready
          ? "Rollback track is declared without a safe rollback posture."
          : null,
        track.role === "migration_in_progress" && schema.readiness === "blocked"
          ? "Migration track is blocked by schema safety constraints."
          : null,
        track.role === "stale_runtime" && effectiveRuntimeVersion && lineage.releaseId && effectiveRuntimeVersion !== lineage.releaseId
          ? `Runtime ${effectiveRuntimeVersion} is stale relative to active release ${lineage.releaseId}.`
          : null,
      ]);
      const warningIssues = uniqueStrings([
        track.role === "current" && compatibility.some((entry) => entry.status === "warning")
          ? "Current release is operating with compatibility warnings."
          : null,
        track.role === "canary" && rollouts.canaryFlags === 0
          ? "Canary track exists without active canary flags."
          : null,
        track.role === "canary" && !rollback.ready
          ? "Canary rollout is active without rollback readiness."
          : null,
        track.role === "migration_in_progress" && schema.pendingMigrations.length > 0
          ? `${schema.pendingMigrations.length} migration(s) still need coordination with runtime rollout.`
          : null,
        track.role === "rollback" && lineage.rollbackTargetReleaseId === lineage.releaseId
          ? "Rollback target matches the active release identifier."
          : null,
        interoperabilityReleaseIds.some((releaseId) =>
          Boolean(
            releaseId &&
            supportedRange.minimumVersion &&
            compareReleaseVersions(releaseId, supportedRange.minimumVersion) < 0,
          ),
        )
          ? "Interoperability set includes releases below the supported minimum window."
          : null,
      ]);
      const status = resolveCompatibilityStatusFromIssues(hardIssues, warningIssues);
      const issues = uniqueStrings([...hardIssues, ...warningIssues]);
      const stableRuntime =
        track.role !== "stale_runtime" &&
        (!effectiveRuntimeVersion || !lineage.releaseId || effectiveRuntimeVersion === lineage.releaseId);

      return {
        compatibilityWindow,
        healthStatus: resolveReleaseTrackHealthStatus({
          explicitStatus: track.healthStatus,
          issues,
          status,
        }),
        interoperabilityReleaseIds,
        issues,
        phase: track.phase ?? lineage.phase,
        releaseId: normalizeNullableText(track.releaseId),
        rollbackReady: rollback.ready,
        role: track.role ?? "current",
        runtimeTargets: effectiveRuntimeTargets,
        runtimeVersion: effectiveRuntimeVersion,
        schemaVersion: effectiveSchemaVersion,
        stableRuntime,
        startedAt: normalizeNullableText(track.startedAt) ?? lineage.startedAt,
        status,
        summary:
          status === "compatible"
            ? `${normalizeText(track.role).replaceAll("_", " ")} track is operating inside the declared compatibility window.`
            : `${normalizeText(track.role).replaceAll("_", " ")} track needs evolution attention before rollout advances.`,
        supportedRange,
      } satisfies AdminReleaseEvolutionTrack;
    })
    .sort((left, right) => {
      const roleDelta = orderedRoles.indexOf(left.role) - orderedRoles.indexOf(right.role);
      if (roleDelta !== 0) {
        return roleDelta;
      }

      return (left.releaseId ?? "").localeCompare(right.releaseId ?? "");
    });
};

const resolveTenantMigrationReadiness = (score: number): AdminTenantEvolutionReadiness =>
  score < 60 ? "blocked" : score < 85 ? "caution" : "ready";

const buildTenantAuditLineage = ({
  canaryGroup,
  flags,
  progressionStatus,
  region,
  releaseId,
  rollbackReleaseId,
  stage,
  tenantId,
}: {
  canaryGroup: string | null;
  flags: AdminFeatureFlag[];
  progressionStatus: AdminTenantEvolutionProgressStatus;
  region: string | null;
  releaseId: string | null;
  rollbackReleaseId: string | null;
  stage: AdminTenantEvolutionStage;
  tenantId: string;
}) =>
  uniqueStrings([
    `tenant:${tenantId}`,
    region ? `region:${region}` : null,
    releaseId ? `release:${releaseId}` : null,
    rollbackReleaseId ? `rollback:${rollbackReleaseId}` : null,
    canaryGroup ? `canary_group:${canaryGroup}` : null,
    `stage:${stage}`,
    `progression:${progressionStatus}`,
    ...flags.map((flag) => `flag:${flag.key}:${flag.rollout.stage}`),
  ]);

const buildTenantEvolutionGovernance = ({
  currentReleaseId,
  featureFlags,
  libraries,
  policy,
  rollbackTargetReleaseId,
  rollouts,
  schema,
  tracks,
}: {
  currentReleaseId: string | null;
  featureFlags: AdminFeatureFlag[];
  libraries: Pick<
    AdminLibraryControlRow,
    | "activeStudents"
    | "city"
    | "controlReason"
    | "controlStatus"
    | "enabled"
    | "id"
    | "lastActivityAt"
    | "monthlyRevenue"
    | "name"
    | "paymentStatus"
    | "state"
    | "subscriptionStatus"
  >[];
  policy: AdminReleaseGovernancePolicy;
  rollbackTargetReleaseId: string | null;
  rollouts: AdminReleaseRolloutGovernance;
  schema: AdminReleaseSchemaGovernance;
  tracks: AdminReleaseEvolutionTrack[];
}): AdminTenantEvolutionGovernance => {
  const tenantPolicyById = new Map(
    (policy.tenants ?? [])
      .map((tenant) => [normalizeText(tenant.tenantId ?? tenant.tenantLabel), tenant] as const)
      .filter(([tenantId]) => tenantId),
  );
  const libraryById = new Map(libraries.map((library) => [normalizeText(library.id), library] as const));
  const flagsByTenant = new Map<string, AdminFeatureFlag[]>();

  for (const flag of featureFlags) {
    for (const tenantId of flag.rollout.tenantTargets) {
      const key = normalizeText(tenantId);
      if (!key) {
        continue;
      }

      const current = flagsByTenant.get(key) ?? [];
      current.push(flag);
      flagsByTenant.set(key, current);
    }
  }

  const candidateTenantIds = uniqueStrings([
    ...[...tenantPolicyById.keys()],
    ...[...flagsByTenant.keys()],
  ]);
  const drafts = candidateTenantIds.map((tenantId) => {
    const tenantPolicy = tenantPolicyById.get(tenantId);
    const library = libraryById.get(tenantId);
    const applicableFlags = flagsByTenant.get(tenantId) ?? [];
    const rolloutPercentage =
      tenantPolicy?.rolloutPercentage != null
        ? clampPercentage(tenantPolicy.rolloutPercentage, 0)
        : applicableFlags.length > 0
          ? Number(
              (
                applicableFlags.reduce((sum, flag) => sum + clampPercentage(flag.rolloutPercentage, 0), 0) /
                applicableFlags.length
              ).toFixed(2),
            )
          : 0;
    const releaseId =
      normalizeNullableText(tenantPolicy?.releaseId) ??
      applicableFlags.flatMap((flag) => flag.rollout.releaseTargets)[0] ??
      currentReleaseId;
    const canary =
      toBoolean(tenantPolicy?.canary, false) ||
      applicableFlags.some((flag) => flag.rollout.stage === "canary" || flag.rollout.canaryPercentage > 0);
    const rollbackReleaseId =
      normalizeNullableText(tenantPolicy?.rollbackReleaseId) ??
      (canary || applicableFlags.length > 0 ? rollbackTargetReleaseId : null);
    const rollbackIsolatedBase =
      toBoolean(tenantPolicy?.rollbackIsolated, false) ||
      Boolean(rollbackReleaseId) ||
      applicableFlags.length > 0;
    const releaseTrack = tracks.find((track) => track.releaseId === releaseId) ?? null;
    const issues = uniqueStrings([
      ...(tenantPolicy?.issues ?? []),
      ...applicableFlags.flatMap((flag) => flag.rollout.warnings),
      !library?.enabled ? "Tenant runtime is disabled." : null,
      library?.controlStatus === "banned" ? "Tenant is currently banned from active rollout." : null,
      library?.controlStatus === "suspended" ? "Tenant is currently suspended during staged evolution." : null,
      library?.controlReason ? library.controlReason : null,
      library?.subscriptionStatus && !["active", "trial"].includes(library.subscriptionStatus.toLowerCase())
        ? `Subscription is ${library.subscriptionStatus}.`
        : null,
      library?.paymentStatus && !["paid", "success", "approved"].includes(library.paymentStatus.toLowerCase())
        ? `Payment posture is ${library.paymentStatus}.`
        : null,
    ]);
    const compatibilityStatus: AdminReleaseCompatibilityStatus =
      !releaseTrack
        ? releaseId
          ? "warning"
          : "compatible"
        : releaseTrack.status === "incompatible" || applicableFlags.some((flag) => flag.rollout.healthStatus === "critical")
          ? "incompatible"
          : issues.length > 0 || applicableFlags.some((flag) => flag.rollout.healthStatus === "warning")
            ? "warning"
            : "compatible";
    const stage: AdminTenantEvolutionStage =
      tenantPolicy?.stage ??
      (compatibilityStatus === "incompatible"
        ? "blocked"
        : rollbackReleaseId && releaseId === rollbackReleaseId
          ? "rolling_back"
          : canary
            ? "canary"
            : applicableFlags.length > 0 || (rolloutPercentage > 0 && rolloutPercentage < 100)
              ? "phased"
              : releaseId === currentReleaseId && rolloutPercentage >= 100
                ? "stable"
                : "pending");
    let compatibilityScore = 100;
    if (!releaseTrack && releaseId) {
      compatibilityScore -= 20;
    }
    if (releaseTrack?.status === "warning") {
      compatibilityScore -= 18;
    }
    if (releaseTrack?.status === "incompatible") {
      compatibilityScore -= 45;
    }
    if (applicableFlags.some((flag) => flag.rollout.healthStatus === "critical")) {
      compatibilityScore -= 25;
    } else if (applicableFlags.some((flag) => flag.rollout.healthStatus === "warning")) {
      compatibilityScore -= 10;
    }
    if (canary && !rollbackReleaseId) {
      compatibilityScore -= 12;
    }
    compatibilityScore -= Math.min(24, issues.length * 6);
    compatibilityScore = clampScore(compatibilityScore);

    const baseReadinessReasons = uniqueStrings([
      schema.readiness === "blocked" ? "Schema readiness is blocked for tenant promotion." : null,
      schema.readiness === "caution" ? "Schema readiness is still in caution mode." : null,
      rollouts.pausedFlags > 0 ? `${rollouts.pausedFlags} rollout flag(s) are paused.` : null,
      releaseTrack?.role === "stale_runtime" ? "Tenant is pinned to a stale runtime track." : null,
      !rollbackIsolatedBase && (canary || rolloutPercentage < 100)
        ? "Rollback isolation is not guaranteed for this tenant rollout."
        : null,
      ...issues.slice(0, 4),
    ]);

    let readinessScore = compatibilityScore;
    if (schema.readiness === "blocked") {
      readinessScore -= 25;
    } else if (schema.readiness === "caution") {
      readinessScore -= 10;
    }
    if (rollouts.pausedFlags > 0) {
      readinessScore -= 8;
    }
    if (releaseTrack?.role === "stale_runtime") {
      readinessScore -= 18;
    }
    if (!rollbackIsolatedBase && (canary || rolloutPercentage < 100)) {
      readinessScore -= 12;
    }
    readinessScore = clampScore(readinessScore);

    const initialHealthStatus: AdminReleaseHealthStatus =
      compatibilityStatus === "incompatible" || library?.controlStatus === "banned" || tenantPolicy?.healthStatus === "critical" || readinessScore < 60
        ? "critical"
        : issues.length > 0 ||
            library?.controlStatus === "suspended" ||
            tenantPolicy?.healthStatus === "warning" ||
            rolloutPercentage < 100 ||
            readinessScore < 85
          ? "warning"
          : "healthy";

    return {
      applicableFlags,
      canary,
      canaryGroup: normalizeNullableText(tenantPolicy?.canaryGroup),
      compatibilityScore,
      compatibilityStatus,
      healthStatus: initialHealthStatus,
      issues,
      lastActivityAt: library?.lastActivityAt ?? null,
      migrationReadinessReasons: baseReadinessReasons,
      region: normalizeNullableText(tenantPolicy?.region) ?? library?.state ?? library?.city ?? null,
      readinessScore,
      releaseId,
      rollbackIsolated: rollbackIsolatedBase,
      rollbackReleaseId,
      rolloutPercentage,
      stage,
      tenantId,
      tenantLabel: normalizeText(tenantPolicy?.tenantLabel ?? library?.name ?? tenantId) || tenantId,
    };
  });

  const regionalSequence =
    policy.rollout?.regionalSequence && policy.rollout.regionalSequence.length > 0
      ? uniqueStrings(policy.rollout.regionalSequence)
      : uniqueStrings(drafts.map((record) => record.region));
  const blockedRegions = new Set(
    drafts
      .filter(
        (record) =>
          record.compatibilityStatus === "incompatible" ||
          record.healthStatus === "critical" ||
          record.readinessScore < 60,
      )
      .map((record) => record.region)
      .filter((region): region is string => Boolean(region)),
  );
  const records = drafts
    .map((draft) => {
      const regionIndex = draft.region ? regionalSequence.indexOf(draft.region) : -1;
      const priorBlockedRegion =
        regionIndex > 0
          ? regionalSequence.slice(0, regionIndex).find((region) => blockedRegions.has(region)) ?? null
          : null;
      const readinessReasons = uniqueStrings([
        ...draft.migrationReadinessReasons,
        priorBlockedRegion ? `Regional sequencing is waiting for ${priorBlockedRegion} to clear rollout blockers.` : null,
      ]);
      const readinessScore = clampScore(draft.readinessScore - (priorBlockedRegion ? 10 : 0));
      const migrationReadiness = resolveTenantMigrationReadiness(readinessScore);
      const progressionStatus: AdminTenantEvolutionProgressStatus =
        draft.stage === "blocked" || draft.compatibilityStatus === "incompatible" || migrationReadiness === "blocked"
          ? "blocked"
          : priorBlockedRegion || rollouts.pausedFlags > 0 || draft.stage === "pending"
            ? "holding"
            : ["canary", "phased"].includes(draft.stage) &&
                migrationReadiness === "ready" &&
                draft.compatibilityScore >= 85 &&
                draft.issues.length === 0
              ? "ready_for_promotion"
              : draft.rolloutPercentage > 0 || draft.stage === "stable" || draft.stage === "rolling_back"
                ? "progressing"
                : "holding";
      const healthStatus: AdminReleaseHealthStatus =
        draft.compatibilityStatus === "incompatible" || migrationReadiness === "blocked"
          ? "critical"
          : readinessReasons.length > 0 || draft.issues.length > 0 || draft.rolloutPercentage < 100
            ? "warning"
            : draft.healthStatus;
      const auditLineage = buildTenantAuditLineage({
        canaryGroup: draft.canaryGroup,
        flags: draft.applicableFlags,
        progressionStatus,
        region: draft.region,
        releaseId: draft.releaseId,
        rollbackReleaseId: draft.rollbackReleaseId,
        stage: draft.stage,
        tenantId: draft.tenantId,
      });

      return {
        auditLineage,
        canary: draft.canary,
        canaryGroup: draft.canaryGroup,
        compatibilityScore: draft.compatibilityScore,
        compatibilityStatus: draft.compatibilityStatus,
        healthStatus,
        issues: draft.issues,
        lastActivityAt: draft.lastActivityAt,
        migrationReadiness,
        migrationReadinessReasons: readinessReasons,
        progressionStatus,
        region: draft.region,
        readinessScore,
        releaseId: draft.releaseId,
        rollbackIsolated: draft.rollbackIsolated,
        rollbackReleaseId: draft.rollbackReleaseId,
        rolloutPercentage: draft.rolloutPercentage,
        stage: draft.stage,
        summary:
          draft.releaseId
            ? `${draft.tenantLabel} is ${progressionStatus.replaceAll("_", " ")} in ${draft.stage.replaceAll("_", " ")} evolution for ${draft.releaseId}.`
            : `${draft.tenantLabel} is queued for staged evolution.`,
        tenantId: draft.tenantId,
        tenantLabel: draft.tenantLabel,
      } satisfies AdminTenantEvolutionRecord;
    })
    .sort((left, right) => left.tenantLabel.localeCompare(right.tenantLabel));

  const issues = uniqueStrings([
    ...records.flatMap((record) => record.issues),
    ...records.flatMap((record) => record.migrationReadinessReasons),
  ]);
  const blockedTenants = records.filter(
    (record) =>
      record.stage === "blocked" ||
      record.compatibilityStatus === "incompatible" ||
      record.progressionStatus === "blocked",
  ).length;
  const canaryTenants = records.filter((record) => record.canary).length;
  const phasedTenants = records.filter((record) => ["canary", "phased"].includes(record.stage)).length;
  const promotionReadyTenants = records.filter((record) => record.progressionStatus === "ready_for_promotion").length;
  const averageCompatibilityScore =
    records.length > 0
      ? Number((records.reduce((sum, record) => sum + record.compatibilityScore, 0) / records.length).toFixed(2))
      : 100;
  const averageReadinessScore =
    records.length > 0
      ? Number((records.reduce((sum, record) => sum + record.readinessScore, 0) / records.length).toFixed(2))
      : 100;

  return {
    activeTenants: records.length,
    averageCompatibilityScore,
    averageReadinessScore,
    blockedTenants,
    canaryTenants,
    healthStatus:
      blockedTenants > 0
        ? "critical"
        : issues.length > 0 || records.some((record) => record.healthStatus === "warning")
          ? "warning"
          : "healthy",
    issues,
    phasedTenants,
    promotionReadyTenants,
    records,
    regionalSequence,
  };
};

const buildCanaryGovernance = ({
  incidents,
  policy,
  rollback,
  rollouts,
  runtimeVisibility,
  tracks,
  tenants,
}: {
  incidents: Pick<AdminIncidentGroup, "severity">[];
  policy: AdminReleaseGovernancePolicy;
  rollback: AdminReleaseRollbackSafety;
  rollouts: AdminReleaseRolloutGovernance;
  runtimeVisibility: AdminRuntimeVisibility;
  tracks: AdminReleaseEvolutionTrack[];
  tenants: AdminTenantEvolutionGovernance;
}): AdminReleaseCanaryGovernance => {
  const canaryTrack = tracks.find((track) => track.role === "canary") ?? null;
  const progressiveThresholds =
    policy.canary?.progressiveThresholds && policy.canary.progressiveThresholds.length > 0
      ? [...policy.canary.progressiveThresholds].sort((left, right) => left - right)
      : [10, 25, 50, 100];
  const issues = uniqueStrings([
    ...tracks.filter((track) => track.role === "canary").flatMap((track) => track.issues),
    !rollback.ready && rollouts.canaryFlags > 0 ? "Canary is active without rollback readiness." : null,
    runtimeVisibility.redisDegraded && rollouts.canaryFlags > 0 ? "Redis is degraded during canary observation." : null,
    runtimeVisibility.queueLagMs > 5_000 && rollouts.canaryFlags > 0
      ? `Queue lag ${runtimeVisibility.queueLagMs}ms is constraining canary confidence.`
      : null,
    runtimeVisibility.deadLetterJobs > 0 && rollouts.canaryFlags > 0
      ? `${runtimeVisibility.deadLetterJobs} dead-letter job(s) intersect the canary window.`
      : null,
    incidents.some((incident) => incident.severity === "CRITICAL") && rollouts.canaryFlags > 0
      ? "Critical incidents are active during the canary window."
      : null,
    tenants.records.some((tenant) => tenant.canary && tenant.compatibilityStatus === "incompatible")
      ? "At least one canary tenant is incompatible with the active release window."
      : null,
  ]);
  const anomalyCount = issues.length;
  const anomalyThreshold = Math.max(1, Math.trunc(policy.canary?.anomalyThreshold ?? 3));
  let healthScore = 100;
  healthScore -= anomalyCount * 12;
  if (!rollback.ready && rollouts.canaryFlags > 0) {
    healthScore -= 18;
  }
  if (runtimeVisibility.redisDegraded) {
    healthScore -= 10;
  }
  if (runtimeVisibility.queueLagMs > 5_000) {
    healthScore -= 8;
  }
  if (runtimeVisibility.deadLetterJobs > 0) {
    healthScore -= 8;
  }
  if (incidents.some((incident) => incident.severity === "CRITICAL")) {
    healthScore -= 12;
  }
  healthScore = Math.max(0, healthScore);
  const active = rollouts.canaryFlags > 0 || canaryTrack != null;
  const rollbackRecommended = active && (!rollback.ready || anomalyCount >= anomalyThreshold || healthScore < 70);
  const lifecycle =
    !active
      ? "idle"
      : rollbackRecommended
        ? "rollback_recommended"
        : rollouts.pausedFlags > 0
          ? "holding"
          : rollouts.progressPercentage < progressiveThresholds[0]
            ? "warming"
            : anomalyCount > 0
              ? "observing"
              : rollouts.progressPercentage < 100
                ? "progressing"
                : "rolled_back";
  const healthStatus: AdminReleaseHealthStatus =
    healthScore < 70 ? "critical" : healthScore < 85 || anomalyCount > 0 ? "warning" : "healthy";

  return {
    active,
    anomalyCount,
    canaryFlags: rollouts.canaryFlags,
    canaryTenants: tenants.canaryTenants,
    healthScore,
    healthStatus,
    issues,
    lifecycle,
    progressiveThresholds,
    releaseId: canaryTrack?.releaseId ?? null,
    rollbackRecommended,
    summary:
      !active
        ? "No long-lived canary is currently active."
        : rollbackRecommended
          ? "Canary safety has regressed beyond the configured threshold."
          : "Canary is operating inside the configured progression thresholds.",
  };
};

const buildEvolutionForecasting = ({
  compatibility,
  orchestration,
  policy,
  rollback,
  rollouts,
  runtimeVisibility,
  schema,
  tracks,
}: {
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  orchestration: AdminReleaseDeploymentOrchestration;
  policy: AdminReleaseGovernancePolicy;
  rollback: AdminReleaseRollbackSafety;
  rollouts: AdminReleaseRolloutGovernance;
  runtimeVisibility: AdminRuntimeVisibility;
  schema: AdminReleaseSchemaGovernance;
  tracks: AdminReleaseEvolutionTrack[];
}): AdminReleaseEvolutionForecasting => {
  const dependencyForecasts = (policy.dependencies ?? [])
    .map((dependency): AdminReleaseEvolutionForecast | null => {
      const hardMismatch =
        dependency.currentVersion &&
        dependency.minimumVersion &&
        compareReleaseVersions(dependency.currentVersion, dependency.minimumVersion) < 0;
      const driftMismatch =
        dependency.currentVersion &&
        dependency.targetVersion &&
        compareReleaseVersions(dependency.currentVersion, dependency.targetVersion) !== 0;

      if (!hardMismatch && !driftMismatch) {
        return null;
      }

      return {
        confidencePercent: hardMismatch ? 92 : 74,
        evidence: uniqueStrings([
          dependency.currentVersion ? `current=${dependency.currentVersion}` : null,
          dependency.minimumVersion ? `minimum=${dependency.minimumVersion}` : null,
          dependency.targetVersion ? `target=${dependency.targetVersion}` : null,
        ]),
        id: `dependency-${normalizeLower(dependency.name)}`,
        recommendedActions: uniqueStrings([
          dependency.targetVersion ? `Align ${dependency.name} to ${dependency.targetVersion} before widening rollout.` : null,
          dependency.requiredCapabilities?.length
            ? `Verify ${dependency.name} exposes capabilities: ${dependency.requiredCapabilities.join(", ")}.`
            : null,
        ]),
        severity: hardMismatch ? "high" : "medium",
        summary: hardMismatch
          ? `${dependency.name} is below the minimum supported version.`
          : `${dependency.name} is drifting away from the targeted release dependency version.`,
        title: `${dependency.name} mismatch`,
        type: "dependency_mismatch",
      };
    })
    .filter((forecast): forecast is AdminReleaseEvolutionForecast => Boolean(forecast));

  const synthesized: Array<AdminReleaseEvolutionForecast | null> = [
    compatibility.some((entry) => entry.status !== "compatible") || schema.pendingMigrations.length > 0
      ? {
          confidencePercent: compatibility.some((entry) => entry.status === "incompatible") ? 94 : 76,
          evidence: uniqueStrings([
            ...compatibility.filter((entry) => entry.status !== "compatible").map((entry) => `${entry.contract}: ${entry.detail}`),
            ...schema.driftWarnings,
          ]),
          id: "compatibility-drift",
          recommendedActions: [
            "Freeze rollout expansion until compatibility windows return to green.",
            "Reconcile schema and runtime version ranges before promoting the release.",
          ],
          severity: compatibility.some((entry) => entry.status === "incompatible") ? "critical" : "medium",
          summary: "Compatibility drift is likely to widen if rollout progression continues.",
          title: "Compatibility drift risk",
          type: "compatibility_drift",
        }
      : null,
    schema.readiness !== "ready"
      ? {
          confidencePercent: schema.readiness === "blocked" ? 95 : 72,
          evidence: uniqueStrings([
            ...schema.driftWarnings,
            ...schema.sequencing,
          ]),
          id: "migration-risk",
          recommendedActions: [
            "Complete the declared migration safety sequence before widening rollout.",
            "Use maintenance mode and queue draining when the policy requires them.",
          ],
          severity: schema.readiness === "blocked" ? "critical" : "medium",
          summary: "Migration risk is elevated because schema readiness is not fully green.",
          title: "Migration risk",
          type: "migration_risk",
        }
      : null,
    rollouts.pausedFlags > 0 || runtimeVisibility.queueLagMs > 5_000
      ? {
          confidencePercent: runtimeVisibility.queueLagMs > 5_000 ? 84 : 68,
          evidence: uniqueStrings([
            rollouts.pausedFlags > 0 ? `${rollouts.pausedFlags} paused rollout flag(s).` : null,
            runtimeVisibility.queueLagMs > 5_000 ? `queue_lag_ms=${runtimeVisibility.queueLagMs}` : null,
            runtimeVisibility.activeWorkers === 0 && orchestration.queueDrainRequired ? "Queue workers are inactive during rollout gating." : null,
          ]),
          id: "rollout-bottleneck",
          recommendedActions: [
            "Resolve queue pressure and paused rollout states before advancing tenants or runtimes.",
          ],
          severity: runtimeVisibility.queueLagMs > 5_000 ? "high" : "medium",
          summary: "Rollout progression is likely to bottleneck on queue pressure or paused stages.",
          title: "Rollout bottleneck",
          type: "rollout_bottleneck",
        }
      : null,
    tracks.some((track) => track.role === "stale_runtime")
      ? {
          confidencePercent: 97,
          evidence: tracks
            .filter((track) => track.role === "stale_runtime")
            .map((track) => `${track.releaseId ?? "unknown"} is stale against ${track.supportedRange.targetVersion ?? "target"}`),
          id: "stale-runtime",
          recommendedActions: [
            "Block stale runtime activation and align workers before any new rollout progression.",
          ],
          severity: "critical",
          summary: "Stale runtime activation risk is already present in the active release set.",
          title: "Stale runtime risk",
          type: "stale_runtime_risk",
        }
      : null,
    findCompatibilityEntry(compatibility, "queue_worker")?.status !== "compatible" || runtimeVisibility.queueLagMs > 5_000
      ? {
          confidencePercent: findCompatibilityEntry(compatibility, "queue_worker")?.status === "incompatible" ? 93 : 71,
          evidence: uniqueStrings([
            findCompatibilityEntry(compatibility, "queue_worker")?.detail ?? null,
            runtimeVisibility.queueLagMs > 5_000 ? `queue_lag_ms=${runtimeVisibility.queueLagMs}` : null,
            rollback.ready ? null : "Rollback posture is not ready for queue/runtime mismatch recovery.",
          ]),
          id: "queue-runtime-incompatibility",
          recommendedActions: [
            "Align queue worker versioning with the active release before resuming queue-aware deployments.",
          ],
          severity:
            findCompatibilityEntry(compatibility, "queue_worker")?.status === "incompatible" ? "critical" : "medium",
          summary: "Queue/runtime incompatibility could amplify latency or replay pressure.",
          title: "Queue/runtime incompatibility",
          type: "queue_runtime_incompatibility",
        }
      : null,
  ];

  const allForecasts = [...dependencyForecasts, ...synthesized.filter((forecast): forecast is AdminReleaseEvolutionForecast => Boolean(forecast))];
  const healthStatus: AdminReleaseHealthStatus =
    allForecasts.some((forecast) => forecast.severity === "critical")
      ? "critical"
      : allForecasts.length > 0
        ? "warning"
        : "healthy";

  return {
    forecasts: allForecasts,
    healthStatus,
  };
};

const buildReleaseSafetyGuardrails = ({
  compatibility,
  rollback,
  rollouts,
  schema,
  tracks,
}: {
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  rollback: AdminReleaseRollbackSafety;
  rollouts: AdminReleaseRolloutGovernance;
  schema: AdminReleaseSchemaGovernance;
  tracks: AdminReleaseEvolutionTrack[];
}): AdminReleaseSafetyGuardrails => {
  const staleRuntimeTrack = tracks.find((track) => track.role === "stale_runtime");
  const rules: AdminReleaseSafetyRule[] = [
    {
      detail:
        rollouts.stagedFlags > 0 && (!rollback.ready || schema.readiness !== "ready" || compatibility.some((entry) => entry.status === "incompatible"))
          ? "Staged rollout cannot advance while rollback, schema readiness, or compatibility is unsafe."
          : "Rollout progression prerequisites are satisfied.",
      key: "unsafe_rollout_progression",
      severity: "critical",
      status:
        rollouts.stagedFlags > 0 && (!rollback.ready || schema.readiness !== "ready" || compatibility.some((entry) => entry.status === "incompatible"))
          ? "block"
          : rollouts.pausedFlags > 0
            ? "warn"
            : "pass",
      summary: "Block unsafe rollout progression",
    },
    {
      detail:
        schema.readiness === "blocked" || schema.strategy === "breaking"
          ? "Migration plan is not safe for overlapping release evolution."
          : "Migration posture stays inside the declared safety window.",
      key: "incompatible_migration",
      severity: "critical",
      status: schema.readiness === "blocked" || schema.strategy === "breaking" ? "block" : schema.readiness === "caution" ? "warn" : "pass",
      summary: "Block incompatible migrations",
    },
    {
      detail:
        staleRuntimeTrack
          ? staleRuntimeTrack.issues.join(" ")
          : "No stale runtime activation is currently detected.",
      key: "stale_runtime_activation",
      severity: "critical",
      status: staleRuntimeTrack ? "block" : "pass",
      summary: "Block stale runtime activation",
    },
    {
      detail: rollback.ready ? "Rollback target is prepared for interoperable recovery." : rollback.summary,
      key: "unsafe_rollback",
      severity: "critical",
      status: rollback.ready ? "pass" : "block",
      summary: "Block unsafe rollback",
    },
    {
      detail:
        compatibility.some((entry) => ["schema", "api_version", "queue_worker"].includes(entry.contract) && entry.status === "incompatible")
          ? "Schema/runtime interoperability is broken for at least one active contract."
          : "Schema/runtime compatibility is aligned for active contracts.",
      key: "schema_runtime_mismatch",
      severity: "critical",
      status:
        compatibility.some((entry) => ["schema", "api_version", "queue_worker"].includes(entry.contract) && entry.status === "incompatible")
          ? "block"
          : compatibility.some((entry) => ["schema", "api_version", "queue_worker"].includes(entry.contract) && entry.status === "warning")
            ? "warn"
            : "pass",
      summary: "Block schema/runtime mismatch",
    },
  ];

  return {
    blockedRules: rules.filter((rule) => rule.status === "block").length,
    rules,
    warningRules: rules.filter((rule) => rule.status === "warn").length,
  };
};

const buildEvolutionGovernance = ({
  compatibility,
  featureFlags,
  incidents,
  libraries,
  lineage,
  orchestration,
  policy,
  rollback,
  rollouts,
  runtimeVisibility,
  schema,
}: {
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  featureFlags: AdminFeatureFlag[];
  incidents: Pick<AdminIncidentGroup, "severity">[];
  libraries: Pick<
    AdminLibraryControlRow,
    | "activeStudents"
    | "city"
    | "controlReason"
    | "controlStatus"
    | "enabled"
    | "id"
    | "lastActivityAt"
    | "monthlyRevenue"
    | "name"
    | "paymentStatus"
    | "state"
    | "subscriptionStatus"
  >[];
  lineage: AdminReleaseLineage;
  orchestration: AdminReleaseDeploymentOrchestration;
  policy: AdminReleaseGovernancePolicy;
  rollback: AdminReleaseRollbackSafety;
  rollouts: AdminReleaseRolloutGovernance;
  runtimeVisibility: AdminRuntimeVisibility;
  schema: AdminReleaseSchemaGovernance;
}): AdminReleaseEvolutionGovernance => {
  const activeReleases = buildReleaseEvolutionTracks({
    compatibility,
    featureFlags,
    lineage,
    policy,
    rollback,
    rollouts,
    schema,
  });
  const tenants = buildTenantEvolutionGovernance({
    currentReleaseId: lineage.releaseId,
    featureFlags,
    libraries,
    policy,
    rollbackTargetReleaseId: lineage.rollbackTargetReleaseId,
    rollouts,
    schema,
    tracks: activeReleases,
  });
  const canary = buildCanaryGovernance({
    incidents,
    policy,
    rollback,
    rollouts,
    runtimeVisibility,
    tracks: activeReleases,
    tenants,
  });
  const forecasting = buildEvolutionForecasting({
    compatibility,
    orchestration,
    policy,
    rollback,
    rollouts,
    runtimeVisibility,
    schema,
    tracks: activeReleases,
  });
  const guardrails = buildReleaseSafetyGuardrails({
    compatibility,
    rollback,
    rollouts,
    schema,
    tracks: activeReleases,
  });
  const staleRuntimeCount = activeReleases.filter((track) => track.role === "stale_runtime").length;
  const healthStatus: AdminReleaseHealthStatus =
    guardrails.blockedRules > 0 ||
    canary.healthStatus === "critical" ||
    forecasting.healthStatus === "critical" ||
    tenants.healthStatus === "critical" ||
    activeReleases.some((track) => track.status === "incompatible")
      ? "critical"
      : guardrails.warningRules > 0 ||
          canary.healthStatus === "warning" ||
          forecasting.healthStatus === "warning" ||
          tenants.healthStatus === "warning" ||
          activeReleases.some((track) => track.status === "warning")
        ? "warning"
        : "healthy";

  return {
    activeReleases,
    canary,
    forecasting,
    guardrails,
    healthStatus,
    staleRuntimeCount,
    tenants,
  };
};

const buildReleaseBlastRadiusEstimate = ({
  impactedReleases,
  impactedRuntimes,
  impactedTenants,
  scope,
}: {
  impactedReleases: number;
  impactedRuntimes: number;
  impactedTenants: number;
  scope: AdminReleaseBlastRadiusEstimate["scope"];
}): AdminReleaseBlastRadiusEstimate => ({
  impactedReleases,
  impactedRuntimes,
  impactedTenants,
  scope,
  summary: `${impactedTenants} tenant(s) | ${impactedRuntimes} runtime(s) | ${impactedReleases} release track(s)`,
});

const buildReleaseSimulations = ({
  compatibility,
  evolution,
  orchestration,
  rollback,
  schema,
}: {
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  evolution: AdminReleaseEvolutionGovernance;
  orchestration: AdminReleaseDeploymentOrchestration;
  rollback: AdminReleaseRollbackSafety;
  schema: AdminReleaseSchemaGovernance;
}): AdminReleaseSimulation[] => {
  const impactedRuntimes = uniqueStrings(
    evolution.activeReleases.flatMap((track) => track.runtimeTargets),
  ).length;
  const impactedReleases = uniqueStrings(
    evolution.activeReleases.map((track) => track.releaseId),
  ).length;
  const blockedRules = evolution.guardrails.rules.filter((rule) => rule.status === "block");
  const warningRules = evolution.guardrails.rules.filter((rule) => rule.status === "warn");
  const incompatibleCompatibilityCount = compatibility.filter((entry) => entry.status === "incompatible").length;
  const warningCompatibilityCount = compatibility.filter((entry) => entry.status === "warning").length;
  const rollbackIsolatedTenants = evolution.tenants.records.filter((record) => record.rollbackIsolated).length;
  const rollbackIsolationCoverage =
    evolution.tenants.records.length > 0
      ? (rollbackIsolatedTenants / evolution.tenants.records.length) * 100
      : rollback.ready
        ? 100
        : 0;
  const sharedRollbackTenants = evolution.tenants.records.filter(
    (record) => record.rolloutPercentage > 0 && !record.rollbackIsolated,
  ).length;
  const tenantScopedReleaseCount = uniqueStrings(
    evolution.tenants.records.map((record) => record.releaseId),
  ).length;

  const deploymentSafetyScore = clampScore(
    100 -
      blockedRules.length * 18 -
      warningRules.length * 7 -
      incompatibleCompatibilityCount * 12 -
      warningCompatibilityCount * 4 -
      (orchestration.degradedModeActive ? 8 : 0),
  );
  const rollbackViabilityScore = clampScore(
    (rollback.ready ? 70 : 30) +
      Math.round(rollbackIsolationCoverage * 0.3) -
      evolution.staleRuntimeCount * 10 -
      sharedRollbackTenants * 6,
  );
  const migrationSafetyScore = clampScore(
    100 -
      (schema.readiness === "blocked" ? 40 : schema.readiness === "caution" ? 18 : 0) -
      schema.pendingMigrations.length * 5 -
      (orchestration.queueDrainRequired && !orchestration.queueDrainReady ? 15 : 0) -
      incompatibleCompatibilityCount * 6,
  );
  const tenantRolloutSafetyScore = clampScore(
    Math.round((evolution.tenants.averageCompatibilityScore + evolution.tenants.averageReadinessScore) / 2) -
      evolution.tenants.blockedTenants * 10,
  );

  return [
    {
      blastRadius: buildReleaseBlastRadiusEstimate({
        impactedReleases,
        impactedRuntimes,
        impactedTenants: evolution.tenants.activeTenants,
        scope: impactedRuntimes > 1 || impactedReleases > 1 ? "platform" : "runtime",
      }),
      dryRunSupported: true,
      guardrails: uniqueStrings([
        ...blockedRules.map((rule) => rule.summary),
        ...orchestration.capabilityNegotiationWarnings,
      ]).slice(0, 4),
      id: "simulation:deployment",
      kind: "deployment",
      readiness:
        blockedRules.length > 0 || !orchestration.migrationAwareRolloutReady
          ? "blocked"
          : deploymentSafetyScore < 85
            ? "caution"
            : "ready",
      recommendedActions: uniqueStrings([
        ...orchestration.steps,
        blockedRules.length > 0 ? "Resolve blocked release guardrails before promoting the next release stage." : null,
        orchestration.capabilityNegotiationWarnings.length > 0
          ? "Reconcile runtime capability negotiation before activating later runtime targets."
          : null,
      ]).slice(0, 4),
      rollbackViabilityScore,
      safetyScore: deploymentSafetyScore,
      summary:
        deploymentSafetyScore >= 85
          ? "Deployment dry-run is inside the current compatibility and rollout windows."
          : "Deployment dry-run still exposes compatibility, sequencing, or capability risk.",
      title: "Deployment simulation",
    },
    {
      blastRadius: buildReleaseBlastRadiusEstimate({
        impactedReleases: Math.max(1, tenantScopedReleaseCount || impactedReleases),
        impactedRuntimes,
        impactedTenants: evolution.tenants.records.filter((record) => record.rollbackReleaseId).length,
        scope: evolution.tenants.records.some((record) => record.rollbackIsolated) ? "tenant" : "platform",
      }),
      dryRunSupported: true,
      guardrails: uniqueStrings([
        ...rollback.blockers,
        evolution.canary.rollbackRecommended ? "Canary already recommends a rollback hold." : null,
        evolution.staleRuntimeCount > 0 ? "Stale runtimes reduce rollback interoperability." : null,
      ]).slice(0, 4),
      id: "simulation:rollback",
      kind: "rollback",
      readiness: !rollback.ready ? "blocked" : rollbackViabilityScore < 85 ? "caution" : "ready",
      recommendedActions: uniqueStrings([
        rollback.ready ? "Exercise the prepared rollback target with a tenant-scoped rehearsal." : null,
        sharedRollbackTenants > 0 ? "Increase tenant rollback isolation before widening shared rollback scope." : null,
        evolution.staleRuntimeCount > 0 ? "Reconcile stale runtimes before executing rollback across regions." : null,
      ]).slice(0, 4),
      rollbackViabilityScore,
      safetyScore: clampScore(Math.round((rollbackViabilityScore + deploymentSafetyScore) / 2)),
      summary:
        rollback.ready
          ? "Rollback dry-run can be rehearsed, but tenant isolation and stale runtimes still shape the blast radius."
          : "Rollback dry-run is blocked because the current release cannot yet unwind safely.",
      title: "Rollback simulation",
    },
    {
      blastRadius: buildReleaseBlastRadiusEstimate({
        impactedReleases: impactedReleases,
        impactedRuntimes,
        impactedTenants:
          evolution.tenants.phasedTenants > 0 ? evolution.tenants.phasedTenants : evolution.tenants.activeTenants,
        scope: evolution.tenants.regionalSequence.length > 1 ? "regional" : "platform",
      }),
      dryRunSupported: true,
      guardrails: uniqueStrings([
        schema.strategy === "breaking" ? "Breaking migration strategy is active." : null,
        ...schema.sequencing,
        ...schema.driftWarnings,
      ]).slice(0, 4),
      id: "simulation:migration",
      kind: "migration",
      readiness:
        schema.readiness === "blocked"
          ? "blocked"
          : migrationSafetyScore < 85
            ? "caution"
            : "ready",
      recommendedActions: uniqueStrings([
        ...schema.sequencing,
        schema.pendingMigrations.length > 0 ? "Apply pending migrations in the declared safe window before rollout expansion." : null,
        orchestration.queueDrainRequired && !orchestration.queueDrainReady
          ? "Drain queue workers before migration-sensitive rollout steps."
          : null,
      ]).slice(0, 4),
      rollbackViabilityScore,
      safetyScore: migrationSafetyScore,
      summary:
        schema.readiness === "ready"
          ? "Migration dry-run aligns schema sequencing with the active runtime contract."
          : "Migration dry-run still exposes sequencing or compatibility pressure.",
      title: "Migration impact simulation",
    },
    {
      blastRadius: buildReleaseBlastRadiusEstimate({
        impactedReleases: Math.max(1, tenantScopedReleaseCount || impactedReleases),
        impactedRuntimes,
        impactedTenants:
          evolution.tenants.phasedTenants > 0 ? evolution.tenants.phasedTenants : evolution.tenants.activeTenants,
        scope: evolution.tenants.regionalSequence.length > 1 ? "regional" : "tenant",
      }),
      dryRunSupported: true,
      guardrails: uniqueStrings([
        ...evolution.tenants.records
          .filter((record) => record.progressionStatus === "blocked")
          .flatMap((record) => record.migrationReadinessReasons.slice(0, 1)),
        evolution.tenants.promotionReadyTenants === 0 && evolution.tenants.activeTenants > 0
          ? "No tenant is currently ready for promotion."
          : null,
      ]).slice(0, 4),
      id: "simulation:tenant_rollout",
      kind: "tenant_rollout",
      readiness:
        evolution.tenants.blockedTenants > 0
          ? "blocked"
          : tenantRolloutSafetyScore < 85
            ? "caution"
            : "ready",
      recommendedActions: uniqueStrings([
        evolution.tenants.promotionReadyTenants > 0
          ? `Promote ${evolution.tenants.promotionReadyTenants} tenant-scoped rollout(s) inside the regional sequence.`
          : null,
        evolution.tenants.records.some((record) => record.progressionStatus === "holding")
          ? "Clear regional sequence holds before promoting the next tenant wave."
          : null,
        sharedRollbackTenants > 0 ? "Increase isolated rollback coverage for tenant-scoped rollout." : null,
      ]).slice(0, 4),
      rollbackViabilityScore: clampScore(rollbackViabilityScore - sharedRollbackTenants * 4),
      safetyScore: tenantRolloutSafetyScore,
      summary:
        evolution.tenants.promotionReadyTenants > 0
          ? "Tenant rollout dry-run can promote the next wave without crossing declared safety gates."
          : "Tenant rollout dry-run is still constrained by compatibility, readiness, or sequencing gates.",
      title: "Tenant rollout simulation",
    },
  ];
};

const buildReleaseHealthScore = ({
  compatibility,
  evolution,
  incidents,
  lineage,
  orchestration,
  rollback,
  rollouts,
  schema,
}: {
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  evolution: AdminReleaseEvolutionGovernance;
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

  if (evolution.activeReleases.some((track) => track.status === "incompatible")) {
    score -= 16;
    drivers.push("At least one active release track is incompatible with the supported evolution window.");
  } else if (evolution.activeReleases.some((track) => track.status === "warning")) {
    score -= 6;
    drivers.push("One or more release tracks are drifting inside the evolution window.");
  }

  if (evolution.tenants.healthStatus === "critical") {
    score -= 12;
    drivers.push("Tenant-scoped rollout safety is blocked for at least one tenant.");
  } else if (evolution.tenants.healthStatus === "warning") {
    score -= 5;
    drivers.push("Tenant-scoped rollout still needs monitoring.");
  }

  if (evolution.canary.rollbackRecommended) {
    score -= 10;
    drivers.push("Canary governance recommends rollback or a hold before further rollout expansion.");
  } else if (evolution.canary.healthStatus === "warning") {
    score -= 4;
    drivers.push("Canary governance is active with anomaly signals.");
  }

  if (evolution.guardrails.blockedRules > 0) {
    score -= 18;
    drivers.push(`${evolution.guardrails.blockedRules} evolution guardrail(s) are actively blocking rollout progression.`);
  } else if (evolution.guardrails.warningRules > 0) {
    score -= 5;
    drivers.push(`${evolution.guardrails.warningRules} evolution guardrail(s) are warning about rollout safety.`);
  }

  if (evolution.forecasting.forecasts.some((forecast) => forecast.severity === "critical")) {
    score -= 12;
    drivers.push("Forecasting predicts critical evolution risk if rollout continues unchanged.");
  } else if (evolution.forecasting.forecasts.length > 0) {
    score -= 4;
    drivers.push("Forecasting predicts near-term evolution risk that needs mitigation.");
  }

  const criticalIncidentCount = incidents.filter((incident) => incident.severity === "CRITICAL").length;
  if (criticalIncidentCount > 0) {
    score -= 10;
    drivers.push(`${criticalIncidentCount} critical incident(s) are active during the release.`);
  }

  score = Math.max(0, score);
  const status: AdminReleaseHealthStatus =
    evolution.guardrails.blockedRules > 0 || score < 65 ? "critical" : score < 85 ? "warning" : "healthy";

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
  compatibility,
  evolution,
  featureFlags,
  incidents,
  lineage,
  now,
  schema,
  traceEvents,
}: {
  auditLogs: ReleaseAuditLog[];
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  evolution: AdminReleaseEvolutionGovernance;
  featureFlags: AdminFeatureFlag[];
  incidents: Pick<AdminIncidentGroup, "incidentKey" | "lastSeenAt" | "latestMessage" | "severity">[];
  lineage: AdminReleaseLineage;
  now: number;
  schema: AdminReleaseSchemaGovernance;
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
  const syntheticCompatibilityEvents = compatibility
    .filter((entry) => entry.status !== "compatible")
    .map((entry): AdminReleaseForensicsEvent => ({
      detail: entry.detail,
      occurredAt: new Date(now).toISOString(),
      releaseId: lineage.releaseId,
      severity: entry.status === "incompatible" ? "high" : "medium",
      summary: `${entry.contract} compatibility regression`,
      type: "compatibility",
    }));

  const events = [deploymentEvent, ...auditEvents, ...traceForensics, ...incidentEvents, ...syntheticCompatibilityEvents]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 20);
  const migrationConflicts = uniqueStrings([
    ...schema.driftWarnings,
    ...traceEvents
      .filter((event) => {
        const haystack = `${event.type} ${event.message ?? ""}`.toLowerCase();
        return haystack.includes("migration conflict") || haystack.includes("schema drift");
      })
      .map((event) => event.message || event.type),
  ]);
  const compatibilityRegressions = uniqueStrings([
    ...compatibility.filter((entry) => entry.status !== "compatible").map((entry) => entry.detail),
    ...evolution.activeReleases
      .filter((track) => track.status !== "compatible")
      .flatMap((track) => track.issues.map((issue) => `${track.role}: ${issue}`)),
    ...traceEvents
      .filter((event) => `${event.type} ${event.message ?? ""}`.toLowerCase().includes("compat"))
      .map((event) => event.message || event.type),
  ]);
  const rolloutChain = uniqueStrings([
    lineage.previousReleaseId,
    lineage.releaseId,
    ...featureFlags.flatMap((flag) => flag.rollout.releaseTargets),
    ...evolution.activeReleases.map((track) => track.releaseId),
    ...evolution.tenants.records.map((tenant) => tenant.releaseId),
  ]);
  const rollbackChain = uniqueStrings([
    lineage.releaseId,
    lineage.previousReleaseId,
    lineage.rollbackTargetReleaseId,
    ...evolution.tenants.records.map((tenant) => tenant.rollbackReleaseId),
  ]);
  const releaseIncidentKeys = uniqueStrings(incidents.map((incident) => incident.incidentKey));
  const staleRuntimeConflicts = uniqueStrings(
    evolution.activeReleases
      .filter((track) => track.role === "stale_runtime")
      .flatMap((track) => track.issues.length > 0 ? track.issues : [track.summary]),
  );

  return {
    compatibilityRegressions,
    events,
    incidentCount: incidentEvents.length,
    migrationConflicts,
    releaseIncidentKeys,
    rollbackChain,
    rolloutChain,
    staleRuntimeConflicts,
  };
};

export const buildReleaseGovernanceSnapshot = ({
  auditLogs = [],
  env = process.env,
  featureFlags = [],
  incidents = [],
  libraries = [],
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
  const evolution = buildEvolutionGovernance({
    compatibility,
    featureFlags: enrichedFeatureFlags,
    incidents,
    libraries,
    lineage,
    orchestration,
    policy,
    rollback,
    rollouts,
    runtimeVisibility,
    schema,
  });
  const health = buildReleaseHealthScore({
    compatibility,
    evolution,
    incidents,
    lineage,
    orchestration,
    rollback,
    rollouts,
    schema,
  });
  const forensics = buildReleaseForensics({
    auditLogs,
    compatibility,
    evolution,
    featureFlags: enrichedFeatureFlags,
    incidents,
    lineage,
    now,
    schema,
    traceEvents,
  });
  const simulations = buildReleaseSimulations({
    compatibility,
    evolution,
    orchestration,
    rollback,
    schema,
  });

  return {
    compatibility,
    evolution,
    forensics,
    health,
    lineage,
    orchestration,
    policy,
    rollback,
    rollouts,
    schema,
    simulations,
    warnings: uniqueStrings([
      ...compatibility.filter((entry) => entry.status !== "compatible").map((entry) => entry.detail),
      ...schema.driftWarnings,
      ...rollouts.issues,
      ...rollback.blockers,
      ...evolution.activeReleases.flatMap((track) => track.issues),
      ...evolution.tenants.issues,
      ...evolution.canary.issues,
      ...evolution.guardrails.rules.filter((rule) => rule.status !== "pass").map((rule) => rule.detail),
      ...evolution.forecasting.forecasts.map((forecast) => forecast.summary),
      ...simulations
        .filter((simulation) => simulation.readiness !== "ready")
        .map((simulation) => `${simulation.title}: ${simulation.summary}`),
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
    ...snapshot.evolution.guardrails.rules
      .filter((rule) => rule.status === "block")
      .map((rule) => `${rule.summary}: ${rule.detail}`),
    ...snapshot.evolution.activeReleases
      .filter((track) => track.status === "incompatible")
      .map((track) => `${track.role}: ${track.summary}`),
    snapshot.evolution.tenants.blockedTenants > 0
      ? `${snapshot.evolution.tenants.blockedTenants} tenant rollout(s) are blocked.`
      : null,
    snapshot.evolution.canary.rollbackRecommended
      ? "Canary governance recommends rollback or an immediate rollout hold."
      : null,
    ...snapshot.simulations
      .filter((simulation) => simulation.readiness === "blocked")
      .map((simulation) => `${simulation.title}: ${simulation.summary}`),
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
