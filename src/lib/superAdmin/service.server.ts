import { createClient } from "@supabase/supabase-js";
import IORedis from "ioredis";
import { createHash, randomUUID } from "node:crypto";

import { sendEmail } from "../email.server.js";
import { revokeImpersonationSessionsForTargetUser } from "../impersonationRuntime.server.js";
import { resolveLibriofyAppUrl, resolveLibriofyEmailFrom } from "../libriofyConfig.js";
import { sendAdminAlert } from "../observability/alertService.server.js";
import { getCriticalDatabaseHealth } from "../observability/databaseHealth.server.js";
import { logEvent } from "../observability/eventLogger.server.js";
import {
  createRequestTraceContext,
  getRequestTraceContext,
  runWithRequestTraceContext,
  withRequestTraceMetadata,
} from "../observability/requestContext.server.js";
import {
  getRuntimeCounterTotal,
  getRuntimeGaugeValue,
  getRuntimeLatencySummary,
  incrementRuntimeMetric,
  recordRuntimeGauge,
  recordRuntimeLatency,
} from "../observability/runtimeMetrics.server.js";
import { buildServerReadiness } from "../observability/serverHealth.server.js";
import { resolveSupabaseAdminConfig } from "../observability/supabaseAdminConfig.server.js";
import { createObservabilityServiceClient } from "../observability/store.server.js";
import { createInstrumentedServerSupabaseFetch } from "../observability/serverSupabaseFetch.server.js";
import {
  getPlatformSettings,
  getPlatformSettingsMap,
  getSuperAdminIpWhitelistState,
  parseSettingBoolean,
  parseSettingNumber,
  parseSettingStringArray,
  upsertPlatformSetting,
} from "../platformSettings.server.js";
import {
  buildIncidentGroups,
  buildOperationalAlerts,
  buildTraceTimeline,
  buildLoginAttemptSummary,
  buildSuccessRate,
  buildStructuredResponse,
  buildTimeSeries,
  calculateConversionRate,
  calculateGstBreakdown,
  isControlWindowActive,
  resolveSystemStatus,
} from "./model.js";
import {
  buildScopeBoundarySummary,
  type AdminOperatorAvailabilityProfile,
  buildPermissionSources,
  evaluateOperatorActionAccess,
  expandOperatorPermissions,
  expandInheritedOperatorRoles,
  explainOperatorPermission,
  EMPTY_OPERATOR_SCOPE_BOUNDARY,
  getActionConfirmationLabel,
  getActionDefinition,
  getOperatorRoleLabel,
  normalizeOperatorGrants,
  OPERATOR_POLICY_VERSION,
  OPERATOR_ROLE_VALUES,
  resolveActionApprovalPolicy,
  resolveIncidentSlaMinutes,
  resolveOperatorPages,
  type AdminOperatorActionId,
  type AdminOperatorGrant,
  type AdminOperatorGovernanceDomain,
  type AdminOperatorPermission,
  type AdminOperatorScope,
  type AdminOperatorScopeBoundary,
  type AdminOperatorRole,
} from "./governance.js";
import {
  buildJobBackoffMs,
  buildJobIdempotencyKey,
  buildReplayedJobPayload,
  buildQueueConcurrencyKey,
  buildQueueDeduplicationKey,
  isCancellationRequestedJob,
  isCancelledJob,
  isDeadLetteredJob,
  readJobQueueMetadata,
  readJobTraceMetadata,
  resolveJobMaxConcurrency,
  resolveJobVisibilityTimeoutMs,
  shouldRecoverRunningJob,
  writeJobQueuePayload,
} from "./queueRuntime.js";
import {
  resolveOperatorIdempotencyState,
  resolveOperatorPreviewRiskLevel,
  resolveOperatorRollbackSummary,
} from "./operatorSafety.js";
import {
  buildReleaseGovernanceSnapshot,
  deriveFeatureFlagRolloutGovernance,
} from "./releaseGovernance.js";
import {
  buildActiveElevationFeed,
  buildGovernanceAnalytics,
  buildGovernanceDirectory,
  buildGovernanceForensics,
  buildGovernanceAlerts,
  buildGovernanceCoordination,
  buildGovernanceSynchronization,
  buildGovernanceVisibility,
  detectGovernanceConflicts,
  enrichApprovalRequestRuntime,
  resolveApprovalChainMode,
} from "./governanceRuntime.js";
import type {
  AdminActivityLog,
  AdminBillingPaymentRow,
  AdminBroadcastInput,
  AdminBroadcastRow,
  AdminCommissionOverride,
  AdminCommissionUpdateInput,
  AdminCommunicationTemplateRow,
  AdminDeadLetterRow,
  AdminFeatureFlag,
  AdminFeatureFlagInput,
  AdminIncidentGroup,
  AdminIncidentOwnershipTransition,
  AdminIncidentRegionalFailoverEvent,
  AdminIncidentResolutionInput,
  AdminImpersonationInput,
  AdminInvoiceInput,
  AdminInvoiceRow,
  AdminJobActionInput,
  AdminJobQueueRow,
  AdminLibraryActionInput,
  AdminLibraryControlRow,
  AdminOperationalNote,
  AdminOperatorActionPreview,
  AdminOperatorApprovalDecision,
  AdminOperatorApprovalRequest,
  AdminOperatorContext,
  AdminOperatorGovernanceSnapshot,
  AdminOperatorPreviewGovernance,
  AdminPlanUpsertInput,
  AdminPlatformSetting,
  AdminPayoutQueueRow,
  AdminReleaseGovernanceSnapshot,
  AdminRefundInput,
  AdminRefundRow,
  AdminRuntimeGovernanceState,
  AdminRevenueAdjustment,
  AdminRevenueAdjustmentInput,
  AdminRevenueCityPoint,
  AdminOperatorRoleGrant,
  AdminRuntimeTraceEvent,
  AdminRuntimeVisibility,
  AdminSubscriptionPlanRow,
  AdminTimeSeriesPoint,
  AdminUserActionInput,
  AdminUserControlRow,
  SuperAdminAutomationCenterData,
  SuperAdminBillingCenterData,
  SuperAdminCommunicationCenterData,
  SuperAdminControlCenterData,
  SuperAdminIncidentCenterData,
  SuperAdminLibraryCenterData,
  SuperAdminRevenueCenterData,
  SuperAdminSecurityCenterData,
  StructuredApiResponse,
} from "./types.js";

type EnvLike = Record<string, string | undefined>;

export type SuperAdminActorContext = {
  actorEmail: string | null;
  actorUserId: string;
  allowedPages: AdminOperatorContext["allowedPages"];
  correlationId: string | null;
  emergencyAccessActive: boolean;
  ipAddress: string | null;
  impersonationActive: boolean;
  legacyFallbackAccess: boolean;
  operatorGrants: AdminOperatorGrant[];
  operatorPermissions: AdminOperatorPermission[];
  operatorRoles: AdminOperatorRole[];
  readOnlyActive: boolean;
  requestPath: string | null;
  requestId: string | null;
  requestSource: string | null;
  temporaryElevationActive: boolean;
  traceId: string | null;
  userAgent: string | null;
};

type JsonRecord = Record<string, unknown>;
type UntypedClient = ReturnType<typeof createClient>;

type FeatureFlagRow = {
  cache_ttl_seconds?: number | null;
  config?: unknown;
  description?: string | null;
  id?: string;
  is_enabled?: boolean | null;
  key?: string | null;
  name?: string | null;
  rollout_percentage?: number | null;
  updated_at?: string | null;
  variants?: unknown;
};

type LibraryRow = {
  active_students?: number | null;
  city?: string | null;
  created_at?: string | null;
  enabled?: boolean | null;
  id?: string | null;
  monthly_revenue?: number | null;
  name?: string | null;
  owner_id?: string | null;
  state?: string | null;
  total_seats?: number | null;
  updated_at?: string | null;
};

type SubscriptionRow = {
  id?: string | null;
  library_id?: string | null;
  payment_status?: string | null;
  plan_name?: string | null;
  plan_price?: number | null;
  price?: number | null;
  started_at?: string | null;
  status?: string | null;
  updated_at?: string | null;
};

type ProfileRow = {
  email?: string | null;
  full_name?: string | null;
  phone_number?: string | null;
  user_id?: string | null;
};

type UserRoleRow = {
  role?: string | null;
  user_id?: string | null;
};

type AttendanceRow = {
  check_in?: string | null;
  created_at?: string | null;
  date?: string | null;
  library_id?: string | null;
  student_id?: string | null;
};

type LoginLogRow = {
  device?: string | null;
  email?: string | null;
  id?: string | null;
  ip_address?: string | null;
  login_step?: string | null;
  login_time?: string | null;
  reason?: string | null;
  status?: string | null;
  user_id?: string | null;
};

type LibraryControlRow = {
  library_id?: string | null;
  reason?: string | null;
  status?: string | null;
  until_at?: string | null;
};

type AccountControlRow = {
  clear_sessions_after?: string | null;
  library_id?: string | null;
  password_reset_required?: boolean | null;
  reason?: string | null;
  status?: string | null;
  until_at?: string | null;
  user_id?: string | null;
};

type ImpersonationSessionRow = {
  ended_at?: string | null;
  expires_at?: string | null;
  id?: string | null;
  revoked_at?: string | null;
  started_at?: string | null;
  target_library_id?: string | null;
  target_user_id?: string | null;
};

type RevenueAdjustmentRow = {
  amount_delta?: number | null;
  created_at?: string | null;
  created_by?: string | null;
  id?: string | null;
  library_id?: string | null;
  payment_id?: string | null;
  reason?: string | null;
  subscription_payment_id?: string | null;
};

type CommissionOverrideRow = {
  commission_percent?: number | null;
  library_id?: string | null;
  notes?: string | null;
  updated_at?: string | null;
};

type PayoutQueueRow = {
  amount?: number | null;
  approved_at?: string | null;
  currency?: string | null;
  id?: string | null;
  library_id?: string | null;
  note?: string | null;
  processed_at?: string | null;
  requested_at?: string | null;
  status?: string | null;
};

type PlanRow = {
  code?: string | null;
  description?: string | null;
  features?: unknown;
  id?: string | null;
  is_active?: boolean | null;
  lockers_limit?: number | null;
  name?: string | null;
  price?: number | null;
  seats_limit?: number | null;
  sort_order?: number | null;
  updated_at?: string | null;
};

type PaymentRow = {
  amount?: number | null;
  approved_at?: string | null;
  created_at?: string | null;
  id?: string | null;
  library_id?: string | null;
  payment_method?: string | null;
  status?: string | null;
};

type SubscriptionPaymentRow = {
  amount?: number | null;
  capture_correlation_id?: string | null;
  capture_processed_at?: string | null;
  capture_request_id?: string | null;
  capture_source?: string | null;
  capture_trace_id?: string | null;
  created_at?: string | null;
  currency?: string | null;
  id?: string | null;
  idempotency_key?: string | null;
  library_id?: string | null;
  last_processing_error?: string | null;
  metadata?: unknown;
  paid_at?: string | null;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  subscription_id?: string | null;
  status?: string | null;
  updated_at?: string | null;
};

type ActivityLogRow = {
  activity_type?: string | null;
  actor_user_id?: string | null;
  created_at?: string | null;
  id?: string | null;
  library_id?: string | null;
  message?: string | null;
  metadata?: unknown;
  user_id?: string | null;
};

type OperatorAssignmentRow = {
  email?: string | null;
  is_active?: boolean | null;
  role?: string | null;
  user_id?: string | null;
};

type RoleGrantRow = {
  created_at?: string | null;
  email?: string | null;
  expires_at?: string | null;
  grant_mode?: string | null;
  id?: string | null;
  metadata?: unknown;
  reason?: string | null;
  restrictions?: unknown;
  revoked_at?: string | null;
  role?: string | null;
  scope_id?: string | null;
  scope_label?: string | null;
  scope_type?: string | null;
  starts_at?: string | null;
  user_id?: string | null;
};

type ActionTokenRow = {
  actor_email?: string | null;
  actor_user_id?: string | null;
  action_id?: string | null;
  consumed_at?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  fingerprint?: string | null;
  id?: string | null;
  preview?: unknown;
  target_id?: string | null;
  target_type?: string | null;
  token_hash?: string | null;
};

type ApprovalRequestRow = {
  action_id?: string | null;
  approved_at?: string | null;
  cooldown_until?: string | null;
  created_at?: string | null;
  escalation_after?: string | null;
  executed_at?: string | null;
  expires_at?: string | null;
  fingerprint?: string | null;
  id?: string | null;
  metadata?: unknown;
  optional_second_approver?: boolean | null;
  policy?: unknown;
  preview?: unknown;
  reason?: string | null;
  rejected_at?: string | null;
  requester_email?: string | null;
  requester_user_id?: string | null;
  required_approvals?: number | null;
  status?: string | null;
  target_display?: string | null;
  target_id?: string | null;
  target_type?: string | null;
  token_hash?: string | null;
  updated_at?: string | null;
};

type ApprovalDecisionRow = {
  actor_email?: string | null;
  actor_user_id?: string | null;
  created_at?: string | null;
  decision?: string | null;
  id?: string | null;
  metadata?: unknown;
  note?: string | null;
  request_id?: string | null;
};

type IncidentViewRow = {
  event_type?: string | null;
  first_seen_at?: string | null;
  incident_key?: string | null;
  last_seen_at?: string | null;
  latest_message?: string | null;
  severity?: string | null;
  total_occurrences?: number | null;
  unresolved_count?: number | null;
};

type MetricSnapshotRow = {
  captured_at?: string | null;
  metric_key?: string | null;
  metric_value?: number | null;
  metric_window?: "live" | "hourly" | "daily" | "weekly" | "monthly" | null;
};

type AuditLogRow = {
  action?: string | null;
  actor_email?: string | null;
  actor_user_id?: string | null;
  created_at?: string | null;
  id?: string | null;
  ip_address?: string | null;
  metadata?: unknown;
  request_id?: string | null;
  target_display?: string | null;
  target_id?: string | null;
  target_type?: string | null;
  user_agent?: string | null;
};

type BroadcastRow = {
  audience?: string | null;
  channel?: string | null;
  created_at?: string | null;
  id?: string | null;
  message?: string | null;
  sent_at?: string | null;
  status?: string | null;
  title?: string | null;
};

type TemplateRow = {
  body?: string | null;
  channel?: string | null;
  id?: string | null;
  is_active?: boolean | null;
  key?: string | null;
  name?: string | null;
  subject?: string | null;
  updated_at?: string | null;
  variables?: unknown;
};

type InvoiceRow = {
  id?: string | null;
  invoice_number?: string | null;
  invoice_type?: string | null;
  issued_at?: string | null;
  library_id?: string | null;
  period_end?: string | null;
  period_start?: string | null;
  status?: string | null;
  subtotal?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
};

type RefundRow = {
  amount?: number | null;
  created_at?: string | null;
  id?: string | null;
  invoice_id?: string | null;
  library_id?: string | null;
  payment_id?: string | null;
  processed_at?: string | null;
  reason?: string | null;
  status?: string | null;
  subscription_payment_id?: string | null;
};

type JobQueueRow = {
  attempts?: number | null;
  cancellation_reason?: string | null;
  cancel_requested_at?: string | null;
  cancel_requested_by?: string | null;
  cancelled_at?: string | null;
  claim_token?: string | null;
  claimed_by?: string | null;
  concurrency_key?: string | null;
  created_at?: string | null;
  dead_lettered_at?: string | null;
  deduplication_key?: string | null;
  finished_at?: string | null;
  id?: string | null;
  job_type?: string | null;
  last_error?: string | null;
  last_heartbeat_at?: string | null;
  max_attempts?: number | null;
  max_concurrency?: number | null;
  payload?: unknown;
  recovered_at?: string | null;
  scheduled_for?: string | null;
  source_correlation_id?: string | null;
  source_request_id?: string | null;
  source_trace_id?: string | null;
  started_at?: string | null;
  status?: string | null;
  updated_at?: string | null;
  visibility_timeout_at?: string | null;
};

type DeadLetterRow = {
  attempts?: number | null;
  created_at?: string | null;
  dead_lettered_at?: string | null;
  error_message?: string | null;
  id?: string | null;
  job_id?: string | null;
  job_payload?: unknown;
  job_type?: string | null;
  max_attempts?: number | null;
  source_correlation_id?: string | null;
  source_request_id?: string | null;
  source_trace_id?: string | null;
};

type RevenueByCityRow = {
  city?: string | null;
  libraries?: number | null;
  state?: string | null;
  total_revenue?: number | null;
  transaction_count?: number | null;
};

type DailyMetricRow = {
  active_libraries?: number | null;
  active_students?: number | null;
  adjustment_revenue?: number | null;
  day?: string | null;
  new_libraries?: number | null;
  payment_revenue?: number | null;
  subscription_revenue?: number | null;
  total_revenue?: number | null;
};

type AppEventLogRow = {
  classification?: string | null;
  created_at?: string | null;
  entity_id?: string | null;
  event_type?: string | null;
  fingerprint?: string | null;
  group_key?: string | null;
  id?: string | null;
  metadata?: unknown;
  metric_key?: string | null;
  occurred_at?: string | null;
  resolution_note?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  severity?: string | null;
  status?: string | null;
  user_identifier?: string | null;
};

const FEATURE_FLAG_CACHE_KEY = "libriofy:feature-flags:v1";
const DEFAULT_FEATURE_FLAG_TTL_SECONDS = 60;
const DEFAULT_TIME_SERIES_LIMIT = 90;
const DEFAULT_INVOICE_CURRENCY = "INR";
const DEFAULT_LIBRARY_AUDIENCE = "all_libraries";
const JOB_LOCK_TTL_MS = 90_000;
const JOB_STALE_RUNNING_MS = 15 * 60_000;
const JOB_VISIBILITY_TIMEOUT_MS = 5 * 60_000;
const JOB_HEARTBEAT_INTERVAL_MS = 20_000;
const JOB_DEDUP_WINDOW_MS = 24 * 60 * 60_000;
const BILLING_LOCK_TTL_MS = 30_000;
const BILLING_DEDUP_WINDOW_MS = 30 * 60_000;
const REDIS_OPERATION_TIMEOUT_MS = 1_500;
const REDIS_CIRCUIT_BREAKER_THRESHOLD = 3;
const REDIS_CIRCUIT_BREAKER_RESET_MS = 30_000;
const JOB_QUEUE_SELECT_FIELDS = [
  "attempts",
  "cancellation_reason",
  "cancel_requested_at",
  "cancel_requested_by",
  "cancelled_at",
  "claim_token",
  "claimed_by",
  "concurrency_key",
  "created_at",
  "dead_lettered_at",
  "deduplication_key",
  "finished_at",
  "id",
  "job_type",
  "last_error",
  "last_heartbeat_at",
  "max_attempts",
  "max_concurrency",
  "payload",
  "recovered_at",
  "scheduled_for",
  "source_correlation_id",
  "source_request_id",
  "source_trace_id",
  "started_at",
  "status",
  "updated_at",
  "visibility_timeout_at",
].join(", ");

const FALLBACK_FEATURE_FLAGS: Record<string, Omit<AdminFeatureFlag, "rollout" | "source" | "updatedAt">> = {
  notifications: {
    cacheTtlSeconds: DEFAULT_FEATURE_FLAG_TTL_SECONDS,
    config: {},
    description: "Controls in-app, email, and future WhatsApp notifications.",
    enabled: true,
    key: "notifications",
    name: "Notifications",
    rolloutPercentage: 100,
    variants: [],
  },
  payments: {
    cacheTtlSeconds: DEFAULT_FEATURE_FLAG_TTL_SECONDS,
    config: {},
    description: "Controls payment collection, renewals, invoices, and refunds.",
    enabled: true,
    key: "payments",
    name: "Payments",
    rolloutPercentage: 100,
    variants: [],
  },
  qr_scan: {
    cacheTtlSeconds: DEFAULT_FEATURE_FLAG_TTL_SECONDS,
    config: {},
    description: "Controls QR attendance and scan workflows across the platform.",
    enabled: true,
    key: "qr_scan",
    name: "QR Scan",
    rolloutPercentage: 100,
    variants: [],
  },
};

const redisClients = new Map<string, IORedis>();
const memoryFeatureFlagCache = new Map<string, { expiresAt: number; value: AdminFeatureFlag[] }>();
const memoryOperationalLocks = new Map<string, { expiresAt: number; token: string }>();
const dependencyCircuitStates = new Map<string, { failureCount: number; lastFailureAt: number; openedAt: number | null }>();

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeNullableText = (value: unknown) => {
  const normalized = normalizeText(value);
  return normalized || null;
};

export { buildJobBackoffMs, buildJobIdempotencyKey, isDeadLetteredJob, readJobQueueMetadata } from "./queueRuntime.js";

const recordRedisLatencyMetric = (operation: string, startedAt: number) => {
  recordRuntimeLatency("redis_operation_latency_ms", Date.now() - startedAt, {
    operation,
    source: "super_admin_service",
  });
};

const isDependencyCircuitOpen = (dependency: string) => {
  const state = dependencyCircuitStates.get(dependency);
  if (!state?.openedAt) {
    return false;
  }

  if (Date.now() - state.openedAt >= REDIS_CIRCUIT_BREAKER_RESET_MS) {
    dependencyCircuitStates.set(dependency, {
      failureCount: 0,
      lastFailureAt: state.lastFailureAt,
      openedAt: null,
    });
    return false;
  }

  return true;
};

const markDependencySuccess = (dependency: string) => {
  dependencyCircuitStates.delete(dependency);
};

const markDependencyFailure = (dependency: string, reason: "error" | "timeout") => {
  const current = dependencyCircuitStates.get(dependency) ?? {
    failureCount: 0,
    lastFailureAt: 0,
    openedAt: null,
  };
  const failureCount = current.failureCount + 1;
  const openedAt = failureCount >= REDIS_CIRCUIT_BREAKER_THRESHOLD ? Date.now() : current.openedAt;

  dependencyCircuitStates.set(dependency, {
    failureCount,
    lastFailureAt: Date.now(),
    openedAt,
  });

  incrementRuntimeMetric("dependency_failures_total", 1, {
    dependency,
    reason,
  });
  if (reason === "timeout") {
    incrementRuntimeMetric("redis_timeouts_total", 1, {
      dependency,
    });
  }
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const resolveSuperAdminTimeoutMs = (
  env: EnvLike,
  names: string[],
  fallback: number,
) => {
  const parsed = Number(readEnv(env, ...names));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readPlatformSettingsSafely = async (env: EnvLike, keys?: string[]) => {
  try {
    return await getPlatformSettings(env, keys);
  } catch {
    return [] as Awaited<ReturnType<typeof getPlatformSettings>>;
  }
};

const readPlatformSettingsMapSafely = async (env: EnvLike, keys?: string[]) =>
  new Map((await readPlatformSettingsSafely(env, keys)).map((setting) => [setting.key, setting]));

const readSuperAdminIpWhitelistStateSafely = async (env: EnvLike) => {
  try {
    return await getSuperAdminIpWhitelistState(env);
  } catch {
    return {
      enabled: false,
      whitelist: [] as string[],
    };
  }
};

const runRedisOperation = async <T>(
  env: EnvLike,
  operationName: string,
  operation: (redis: IORedis) => Promise<T>,
  fallback: () => Promise<T> | T,
): Promise<T> => {
  const redis = getRedisClient(env);
  if (!redis || isDependencyCircuitOpen("redis")) {
    incrementRuntimeMetric("dependency_circuit_open_total", 1, {
      dependency: "redis",
      operation: operationName,
    });
    return await fallback();
  }

  const startedAt = Date.now();
  try {
    const result = await withTimeout(
      operation(redis),
      REDIS_OPERATION_TIMEOUT_MS,
      `Redis operation ${operationName} timed out.`,
    );
    recordRedisLatencyMetric(operationName, startedAt);
    markDependencySuccess("redis");
    return result;
  } catch (error) {
    recordRedisLatencyMetric(operationName, startedAt);
    markDependencyFailure(
      "redis",
      error instanceof Error && error.message.includes("timed out") ? "timeout" : "error",
    );
    return await fallback();
  }
};

const acquireOperationalLock = async (
  env: EnvLike,
  key: string,
  ttlMs: number,
) => {
  const token = randomUUID();
  const normalizedKey = `libriofy:ops-lock:${normalizeText(key)}`;
  const redisLock = await runRedisOperation(
    env,
    "lock_acquire",
    async (redis) => {
      const result = await redis.set(normalizedKey, token, "PX", ttlMs, "NX");
      if (result !== "OK") {
        return null;
      }

      return {
        release: async () => {
          await runRedisOperation(
            env,
            "lock_release",
            async (innerRedis) => {
              const currentToken = await innerRedis.get(normalizedKey);
              if (currentToken === token) {
                await innerRedis.del(normalizedKey);
              }
            },
            async () => undefined,
          );
        },
      };
    },
    async () => null,
  );
  if (redisLock) {
    return redisLock;
  }

  const current = memoryOperationalLocks.get(normalizedKey);
  if (current && current.expiresAt > Date.now()) {
    return null;
  }

  memoryOperationalLocks.set(normalizedKey, {
    expiresAt: Date.now() + ttlMs,
    token,
  });

  return {
    release: async () => {
      const currentLock = memoryOperationalLocks.get(normalizedKey);
      if (currentLock?.token === token) {
        memoryOperationalLocks.delete(normalizedKey);
      }
    },
  };
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toPositiveNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toBoolean = (value: unknown, fallback = false) => {
  const parsed = parseSettingBoolean(value);
  return parsed === null ? fallback : parsed;
};

const toRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

const toStringArray = (value: unknown) => parseSettingStringArray(value);

type ResolvedOperatorAccess = {
  allowedPages: AdminOperatorContext["allowedPages"];
  emergencyAccessActive: boolean;
  grants: AdminOperatorGrant[];
  legacyFallbackAccess: boolean;
  permissions: AdminOperatorPermission[];
  readOnlyActive: boolean;
  roles: AdminOperatorRole[];
  temporaryElevationActive: boolean;
};

type OperatorActionGuardInput = {
  actionId: AdminOperatorActionId;
  actor: SuperAdminActorContext;
  client: UntypedClient;
  confirmationText?: string | null;
  dryRun?: boolean;
  fingerprint: string;
  previewBuilder?: (() => Promise<AdminOperatorActionPreview>) | (() => AdminOperatorActionPreview);
  reason?: string | null;
  targetScopes?: AdminOperatorScope[];
  targetDisplay?: string | null;
  targetId?: string | null;
  targetType: string;
  token?: string | null;
};

const buildApiSuccess = <T>(message: string, data: T): StructuredApiResponse<T> =>
  buildStructuredResponse(true, message, data, null);

const buildApiFailure = <T>(message: string, errorCode: string, data: T | null = null): StructuredApiResponse<T> =>
  buildStructuredResponse(false, message, data, errorCode);

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

export const buildServiceClient = (env: EnvLike = process.env) => {
  const adminConfig = resolveSupabaseAdminConfig(env);
  if (!adminConfig.ok) {
    throw new Error(adminConfig.detail);
  }

  return createClient(adminConfig.config.supabaseUrl, adminConfig.config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("super_admin_service"),
    },
  });
};

const getRedisClient = (env: EnvLike) => {
  const redisUrl = readEnv(env, "REDIS_URL");
  if (!redisUrl) {
    return null;
  }

  const existing = redisClients.get(redisUrl);
  if (existing) {
    return existing;
  }

  const client = new IORedis(redisUrl, {
    enableReadyCheck: false,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  client.on("error", () => {
    // Redis health is surfaced through explicit control-plane probes.
  });

  redisClients.set(redisUrl, client);
  return client;
};

const nowIso = () => new Date().toISOString();

const monthKey = (dateInput: string | Date) => {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 7);
};

const APPROVED_REVENUE_STATUSES = new Set(["approved", "captured", "completed", "paid", "success"]);

const toDayKey = (value: string | null | undefined) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
};

const buildTrailingDayKeys = (dayCount: number) => {
  const keys: string[] = [];
  const anchor = new Date();
  anchor.setUTCHours(0, 0, 0, 0);

  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(anchor);
    cursor.setUTCDate(anchor.getUTCDate() - offset);
    keys.push(cursor.toISOString().slice(0, 10));
  }

  return keys;
};

const createDailyMetricAccumulator = () => ({
  activeLibraries: new Set<string>(),
  activeStudents: new Set<string>(),
  adjustmentRevenue: 0,
  newLibraries: 0,
  paymentRevenue: 0,
  subscriptionRevenue: 0,
});

const isApprovedRevenueStatus = (value: string | null | undefined) =>
  APPROVED_REVENUE_STATUSES.has(normalizeText(value).toLowerCase());

const resolveAttendanceTimestamp = (row: AttendanceRow) =>
  normalizeNullableText(row.check_in) ??
  normalizeNullableText(row.created_at) ??
  normalizeNullableText(row.date);

const resolveLatestTimestamp = (values: Array<string | null | undefined>) => {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const normalized = normalizeNullableText(value);
    if (!normalized) {
      continue;
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= latestTime) {
      continue;
    }

    latest = normalized;
    latestTime = parsed.getTime();
  }

  return latest;
};

const formatSignalTimestamp = (value: string | null | undefined) => {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
};

const buildLiveDailyMetricsRows = ({
  attendanceRows,
  libraries,
  payments,
  revenueAdjustments,
  subscriptionPayments,
}: {
  attendanceRows: AttendanceRow[];
  libraries: LibraryRow[];
  payments: PaymentRow[];
  revenueAdjustments: RevenueAdjustmentRow[];
  subscriptionPayments: SubscriptionPaymentRow[];
}) => {
  const dayKeys = buildTrailingDayKeys(DEFAULT_TIME_SERIES_LIMIT);
  const buckets = new Map(dayKeys.map((day) => [day, createDailyMetricAccumulator()] as const));

  for (const row of attendanceRows) {
    const day = toDayKey(row.date) ?? toDayKey(row.check_in) ?? toDayKey(row.created_at);
    if (!day) {
      continue;
    }

    const bucket = buckets.get(day);
    if (!bucket) {
      continue;
    }

    const libraryId = normalizeText(row.library_id);
    const studentId = normalizeText(row.student_id);
    if (libraryId) {
      bucket.activeLibraries.add(libraryId);
    }
    if (studentId) {
      bucket.activeStudents.add(studentId);
    }
  }

  for (const row of payments) {
    if (!isApprovedRevenueStatus(row.status)) {
      continue;
    }

    const day = toDayKey(row.approved_at) ?? toDayKey(row.created_at);
    if (!day) {
      continue;
    }

    const bucket = buckets.get(day);
    if (!bucket) {
      continue;
    }

    bucket.paymentRevenue += toNumber(row.amount);
  }

  for (const row of subscriptionPayments) {
    if (!isApprovedRevenueStatus(row.status)) {
      continue;
    }

    const day =
      toDayKey(row.paid_at) ??
      toDayKey(row.capture_processed_at) ??
      toDayKey(row.updated_at) ??
      toDayKey(row.created_at);
    if (!day) {
      continue;
    }

    const bucket = buckets.get(day);
    if (!bucket) {
      continue;
    }

    bucket.subscriptionRevenue += toNumber(row.amount);
  }

  for (const row of revenueAdjustments) {
    const day = toDayKey(row.created_at);
    if (!day) {
      continue;
    }

    const bucket = buckets.get(day);
    if (!bucket) {
      continue;
    }

    bucket.adjustmentRevenue += toNumber(row.amount_delta);
  }

  for (const row of libraries) {
    const day = toDayKey(row.created_at);
    if (!day) {
      continue;
    }

    const bucket = buckets.get(day);
    if (!bucket) {
      continue;
    }

    bucket.newLibraries += 1;
  }

  return dayKeys.map((day) => {
    const bucket = buckets.get(day) ?? createDailyMetricAccumulator();
    const paymentRevenue = Number(bucket.paymentRevenue.toFixed(2));
    const subscriptionRevenue = Number(bucket.subscriptionRevenue.toFixed(2));
    const adjustmentRevenue = Number(bucket.adjustmentRevenue.toFixed(2));

    return {
      active_libraries: bucket.activeLibraries.size,
      active_students: bucket.activeStudents.size,
      adjustment_revenue: adjustmentRevenue,
      day,
      new_libraries: bucket.newLibraries,
      payment_revenue: paymentRevenue,
      subscription_revenue: subscriptionRevenue,
      total_revenue: Number((paymentRevenue + subscriptionRevenue + adjustmentRevenue).toFixed(2)),
    } satisfies DailyMetricRow;
  });
};

const sortNewestFirst = <T extends { createdAt?: string | null }>(rows: T[]) =>
  [...rows].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));

const toFeatureFlag = (row: FeatureFlagRow, source: AdminFeatureFlag["source"]): AdminFeatureFlag => {
  const key = normalizeText(row.key) || "unknown_flag";
  const fallback = FALLBACK_FEATURE_FLAGS[key];

  const featureFlag = {
    key,
    name: normalizeText(row.name) || fallback?.name || key,
    description: normalizeNullableText(row.description) ?? fallback?.description ?? null,
    enabled: toBoolean(row.is_enabled, fallback?.enabled ?? false),
    rolloutPercentage: Math.max(0, Math.min(100, toPositiveNumber(row.rollout_percentage, fallback?.rolloutPercentage ?? 100))),
    cacheTtlSeconds: Math.max(10, toPositiveNumber(row.cache_ttl_seconds, fallback?.cacheTtlSeconds ?? DEFAULT_FEATURE_FLAG_TTL_SECONDS)),
    config: toRecord(row.config ?? fallback?.config),
    variants: Array.isArray(row.variants) ? (row.variants as Array<Record<string, unknown>>) : fallback?.variants ?? [],
    source,
    updatedAt: normalizeNullableText(row.updated_at),
  };

  return {
    ...featureFlag,
    rollout: deriveFeatureFlagRolloutGovernance(featureFlag),
  };
};

const mapActivityLog = (row: ActivityLogRow): AdminActivityLog => ({
  id: normalizeText(row.id) || randomUUID(),
  createdAt: normalizeText(row.created_at) || nowIso(),
  activityType: normalizeText(row.activity_type) || "unknown_activity",
  message: normalizeText(row.message) || "No message provided.",
  libraryId: normalizeNullableText(row.library_id),
  userId: normalizeNullableText(row.user_id),
  actorUserId: normalizeNullableText(row.actor_user_id),
  metadata: toRecord(row.metadata),
});

const mapPlan = (row: PlanRow): AdminSubscriptionPlanRow => ({
  id: normalizeText(row.id) || randomUUID(),
  code: normalizeText(row.code),
  name: normalizeText(row.name),
  description: normalizeNullableText(row.description),
  price: toNumber(row.price),
  seatsLimit: row.seats_limit == null ? null : toNumber(row.seats_limit),
  lockersLimit: row.lockers_limit == null ? null : toNumber(row.lockers_limit),
  features: toStringArray(row.features),
  isActive: toBoolean(row.is_active, true),
  sortOrder: toNumber(row.sort_order),
  updatedAt: normalizeNullableText(row.updated_at),
});

const mapRevenueCity = (row: RevenueByCityRow): AdminRevenueCityPoint => ({
  state: normalizeText(row.state) || "Unknown",
  city: normalizeText(row.city) || "Unknown",
  libraries: toNumber(row.libraries),
  transactionCount: toNumber(row.transaction_count),
  totalRevenue: toNumber(row.total_revenue),
});

const buildPaymentHistoryRows = ({
  libraries,
  payments,
  subscriptionPayments,
}: {
  libraries: LibraryRow[];
  payments: PaymentRow[];
  subscriptionPayments: SubscriptionPaymentRow[];
}): AdminBillingPaymentRow[] => {
  const libraryNameById = new Map(
    libraries.map((library) => [normalizeText(library.id), normalizeNullableText(library.name)] as const),
  );

  const studentPayments = payments.map((row) => ({
    id: normalizeText(row.id) || randomUUID(),
    paymentType: "student_payment" as const,
    libraryId: normalizeText(row.library_id),
    libraryName: libraryNameById.get(normalizeText(row.library_id)) ?? null,
    amount: toNumber(row.amount),
    status: normalizeText(row.status) || "unknown",
    createdAt: normalizeText(row.created_at) || nowIso(),
    paidAt: normalizeNullableText(row.approved_at),
    reference: normalizeNullableText(row.id),
    currency: DEFAULT_INVOICE_CURRENCY,
    orderId: null,
    paymentId: normalizeNullableText(row.id),
    idempotencyKey: null,
    captureSource: normalizeNullableText(row.payment_method),
    captureRequestId: null,
    captureCorrelationId: null,
    captureTraceId: null,
    captureProcessedAt: normalizeNullableText(row.approved_at),
    lastProcessingError: null,
    duplicateDetected: false,
    duplicateCount: 0,
    reconciliationStatus: normalizeText(row.status).toLowerCase() === "approved" ? "reconciled" : "pending",
    retryCount: 0,
    stuckReason: null,
    webhookAttempts: 0,
    verificationAttempts: 0,
    linkedIncidentKeys: [],
    lifecycleTimeline: [],
  }));

  const subscriptionPaymentRows = subscriptionPayments.map((row) => {
    const metadata = toRecord(row.metadata);
    const verificationAttempts = Math.max(
      0,
      toNumber(metadata.verification_attempts ?? metadata.verificationAttempts),
    );
    const webhookAttempts = Math.max(
      0,
      toNumber(metadata.webhook_attempts ?? metadata.webhookAttempts),
    );
    const retryCount = Math.max(
      verificationAttempts + webhookAttempts,
      toNumber(metadata.retry_count ?? metadata.retryCount),
    );
    const duplicateCount = Math.max(
      0,
      toNumber(metadata.duplicate_count ?? metadata.duplicateCount),
    );
    const rawReconciliationStatus = normalizeText(
      metadata.reconciliation_status ?? metadata.reconciliationStatus,
    );
    const reconciliationStatus =
      rawReconciliationStatus === "reconciled" ||
      rawReconciliationStatus === "retrying" ||
      rawReconciliationStatus === "manual_review" ||
      rawReconciliationStatus === "stuck"
        ? (rawReconciliationStatus as AdminBillingPaymentRow["reconciliationStatus"])
        : normalizeText(row.status).toLowerCase() === "captured"
          ? "reconciled"
          : retryCount > 0
            ? "retrying"
            : "pending";

    return {
      id: normalizeText(row.id) || randomUUID(),
      paymentType: "subscription_payment" as const,
      libraryId: normalizeText(row.library_id),
      libraryName: libraryNameById.get(normalizeText(row.library_id)) ?? null,
      amount: toNumber(row.amount),
      status: normalizeText(row.status) || "unknown",
      createdAt: normalizeText(row.created_at) || nowIso(),
      paidAt: normalizeNullableText(row.paid_at),
      reference:
        normalizeNullableText(row.razorpay_payment_id) ??
        normalizeNullableText(row.razorpay_order_id) ??
        normalizeNullableText(row.id),
      currency: normalizeNullableText(row.currency) ?? DEFAULT_INVOICE_CURRENCY,
      orderId: normalizeNullableText(row.razorpay_order_id),
      paymentId: normalizeNullableText(row.razorpay_payment_id),
      idempotencyKey:
        normalizeNullableText(row.idempotency_key) ??
        normalizeNullableText(metadata.idempotency_key ?? metadata.idempotencyKey),
      captureSource:
        normalizeNullableText(row.capture_source) ??
        normalizeNullableText(metadata.capture_source ?? metadata.captureSource),
      captureRequestId:
        normalizeNullableText(row.capture_request_id) ??
        normalizeNullableText(metadata.capture_request_id ?? metadata.captureRequestId),
      captureCorrelationId:
        normalizeNullableText(row.capture_correlation_id) ??
        normalizeNullableText(metadata.capture_correlation_id ?? metadata.captureCorrelationId),
      captureTraceId:
        normalizeNullableText(row.capture_trace_id) ??
        normalizeNullableText(metadata.capture_trace_id ?? metadata.captureTraceId),
      captureProcessedAt:
        normalizeNullableText(row.capture_processed_at) ??
        normalizeNullableText(metadata.capture_processed_at ?? metadata.captureProcessedAt),
      lastProcessingError:
        normalizeNullableText(row.last_processing_error) ??
        normalizeNullableText(metadata.last_processing_error ?? metadata.lastProcessingError),
      duplicateDetected:
        toBoolean(metadata.duplicate_detected ?? metadata.duplicateDetected, duplicateCount > 0) ||
        duplicateCount > 0,
      duplicateCount,
      reconciliationStatus,
      retryCount,
      stuckReason:
        normalizeNullableText(metadata.stuck_reason ?? metadata.stuckReason) ??
        (normalizeText(row.status).toLowerCase() === "created" && retryCount > 0 ? "Pending capture retry." : null),
      webhookAttempts,
      verificationAttempts,
      linkedIncidentKeys: [],
      lifecycleTimeline: [],
    };
  });

  return [...studentPayments, ...subscriptionPaymentRows].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt),
  );
};

const calculateInactiveLibraryRows = ({
  libraries,
  lastActivityByLibraryId,
  inactiveAfterDays,
}: {
  inactiveAfterDays: number;
  lastActivityByLibraryId: Map<string, string>;
  libraries: LibraryRow[];
}) => {
  const cutoff = Date.now() - inactiveAfterDays * 24 * 60 * 60 * 1000;

  return libraries
    .map((library) => {
      const libraryId = normalizeText(library.id);
      const lastActivityAt =
        lastActivityByLibraryId.get(libraryId) ??
        normalizeText(library.updated_at) ??
        normalizeText(library.created_at);
      const parsed = lastActivityAt ? new Date(lastActivityAt) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        return null;
      }

      const inactiveDays = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000)));
      if (parsed.getTime() > cutoff) {
        return null;
      }

      return {
        libraryId,
        libraryName: normalizeNullableText(library.name),
        inactiveDays,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (right?.inactiveDays ?? 0) - (left?.inactiveDays ?? 0))
    .slice(0, 12) as Array<{ inactiveDays: number; libraryId: string; libraryName: string | null }>;
};

const buildLibraryControlRows = ({
  controls,
  lastActivityByLibraryId,
  libraries,
  ownerProfilesByUserId,
  subscriptionsByLibraryId,
}: {
  controls: Map<string, LibraryControlRow>;
  lastActivityByLibraryId: Map<string, string>;
  libraries: LibraryRow[];
  ownerProfilesByUserId: Map<string, ProfileRow>;
  subscriptionsByLibraryId: Map<string, SubscriptionRow>;
}): AdminLibraryControlRow[] =>
  libraries
    .map((library) => {
      const libraryId = normalizeText(library.id);
      const ownerId = normalizeText(library.owner_id);
      const ownerProfile = ownerProfilesByUserId.get(ownerId);
      const subscription = subscriptionsByLibraryId.get(libraryId);
      const control = controls.get(libraryId);
      const isControlled = isControlWindowActive(control?.status, control?.until_at);

      return {
        id: libraryId,
        name: normalizeText(library.name) || "Unnamed library",
        city: normalizeNullableText(library.city),
        state: normalizeNullableText(library.state),
        enabled: toBoolean(library.enabled, true),
        subscriptionStatus: normalizeNullableText(subscription?.status),
        paymentStatus: normalizeNullableText(subscription?.payment_status),
        ownerId,
        ownerEmail: normalizeNullableText(ownerProfile?.email),
        ownerName: normalizeNullableText(ownerProfile?.full_name),
        activeStudents: toNumber(library.active_students),
        totalSeats: toNumber(library.total_seats),
        monthlyRevenue: toNumber(library.monthly_revenue),
        lastActivityAt:
          lastActivityByLibraryId.get(libraryId) ??
          normalizeNullableText(library.updated_at) ??
          normalizeNullableText(library.created_at),
        controlStatus: isControlled
          ? normalizeText(control?.status) === "banned"
            ? "banned"
            : "suspended"
          : "active",
        controlUntilAt: isControlled ? normalizeNullableText(control?.until_at) : null,
        controlReason: isControlled ? normalizeNullableText(control?.reason) : null,
      };
    })
    .sort(
      (left, right) =>
        right.monthlyRevenue - left.monthlyRevenue ||
        right.activeStudents - left.activeStudents ||
        left.name.localeCompare(right.name),
    );

const buildUserControlRows = ({
  accountControls,
  activeImpersonationsByUserId,
  libraries,
  loginRows,
  profiles,
  userRoles,
}: {
  accountControls: Map<string, AccountControlRow>;
  activeImpersonationsByUserId: Map<string, ImpersonationSessionRow>;
  libraries: LibraryRow[];
  loginRows: LoginLogRow[];
  profiles: ProfileRow[];
  userRoles: UserRoleRow[];
}): AdminUserControlRow[] => {
  const rolesByUserId = new Map<string, string[]>();
  for (const row of userRoles) {
    const userId = normalizeText(row.user_id);
    const role = normalizeText(row.role);
    if (!userId || !role) {
      continue;
    }

    const current = rolesByUserId.get(userId) ?? [];
    current.push(role);
    rolesByUserId.set(userId, current);
  }

  const libraryByOwnerId = new Map(
    libraries.map((library) => [normalizeText(library.owner_id), library] as const),
  );
  const failedLoginsByUserId = new Map<string, number>();
  const lastLoginByUserId = new Map<string, string>();

  for (const row of loginRows) {
    const userId = normalizeText(row.user_id);
    if (!userId) {
      continue;
    }

    const status = normalizeText(row.status).toLowerCase();
    if (status === "failed") {
      failedLoginsByUserId.set(userId, (failedLoginsByUserId.get(userId) ?? 0) + 1);
    }

    if (status === "success") {
      const loginTime = normalizeText(row.login_time);
      const current = lastLoginByUserId.get(userId) ?? "";
      if (loginTime && loginTime > current) {
        lastLoginByUserId.set(userId, loginTime);
      }
    }
  }

  const profileByUserId = new Map(profiles.map((profile) => [normalizeText(profile.user_id), profile] as const));
  const trackedUserIds = new Set<string>();

  for (const userId of rolesByUserId.keys()) {
    if (userId) {
      trackedUserIds.add(userId);
    }
  }

  for (const userId of failedLoginsByUserId.keys()) {
    if (userId) {
      trackedUserIds.add(userId);
    }
  }

  for (const userId of lastLoginByUserId.keys()) {
    if (userId) {
      trackedUserIds.add(userId);
    }
  }

  for (const userId of accountControls.keys()) {
    if (userId) {
      trackedUserIds.add(userId);
    }
  }

  for (const userId of activeImpersonationsByUserId.keys()) {
    if (userId) {
      trackedUserIds.add(userId);
    }
  }

  for (const library of libraries) {
    const ownerId = normalizeText(library.owner_id);
    if (ownerId) {
      trackedUserIds.add(ownerId);
    }
  }

  return [...trackedUserIds]
    .map((userId) => {
      const profile = profileByUserId.get(userId);
      const roles = rolesByUserId.get(userId) ?? [];
      const accountControl = accountControls.get(userId);
      const activeImpersonation = activeImpersonationsByUserId.get(userId);
      const isControlled = isControlWindowActive(accountControl?.status, accountControl?.until_at);
      const library = libraryByOwnerId.get(userId);
      const primaryRole = roles[0] ?? null;

      return {
        userId,
        email: normalizeNullableText(profile?.email),
        fullName: normalizeNullableText(profile?.full_name),
        phone: normalizeNullableText(profile?.phone_number),
        primaryRole,
        roles,
        libraryId: normalizeNullableText(library?.id) ?? normalizeNullableText(accountControl?.library_id),
        libraryName: normalizeNullableText(library?.name),
        lastLoginAt: lastLoginByUserId.get(userId) ?? null,
        loginFailures24h: failedLoginsByUserId.get(userId) ?? 0,
        controlStatus: isControlled
          ? normalizeText(accountControl?.status) === "banned"
            ? "banned"
            : "suspended"
          : "active",
        controlUntilAt: isControlled ? normalizeNullableText(accountControl?.until_at) : null,
        controlReason: isControlled ? normalizeNullableText(accountControl?.reason) : null,
        clearSessionsAfter: normalizeNullableText(accountControl?.clear_sessions_after),
        passwordResetRequired: toBoolean(accountControl?.password_reset_required, false),
        activeImpersonationId: normalizeNullableText(activeImpersonation?.id),
        activeImpersonationStartedAt: normalizeNullableText(activeImpersonation?.started_at),
      };
    })
    .sort((left, right) => {
      const severityDelta =
        Number(Boolean(right.activeImpersonationId || right.passwordResetRequired || right.clearSessionsAfter || right.controlStatus !== "active")) -
        Number(Boolean(left.activeImpersonationId || left.passwordResetRequired || left.clearSessionsAfter || left.controlStatus !== "active"));

      if (severityDelta !== 0) {
        return severityDelta;
      }

      return left.fullName?.localeCompare(right.fullName || "") || left.userId.localeCompare(right.userId);
    });
};

const isSubscriptionTrialStatus = (value: string | null | undefined) =>
  ["trial", "trialing"].includes(normalizeText(value).toLowerCase());

const isSubscriptionPendingStatus = (value: string | null | undefined) =>
  ["incomplete", "incomplete_expired", "past_due", "pending", "unpaid"].includes(
    normalizeText(value).toLowerCase(),
  );

const isOpenImpersonationSession = (row: ImpersonationSessionRow) => {
  if (normalizeText(row.ended_at) || normalizeText(row.revoked_at)) {
    return false;
  }

  const expiresAt = Date.parse(normalizeText(row.expires_at));
  return !Number.isFinite(expiresAt) || expiresAt > Date.now();
};

const buildLibraryCenterSummary = ({
  accountControls,
  libraries,
  controlsByLibraryId,
  ownerProfilesByUserId,
  subscriptionsByLibraryId,
  activeImpersonationsByUserId,
}: {
  accountControls: AccountControlRow[];
  activeImpersonationsByUserId: Map<string, ImpersonationSessionRow>;
  libraries: LibraryRow[];
  controlsByLibraryId: Map<string, LibraryControlRow>;
  ownerProfilesByUserId: Map<string, ProfileRow>;
  subscriptionsByLibraryId: Map<string, SubscriptionRow>;
}) => {
  let activeLibraryCount = 0;
  let controlledLibraryCount = 0;
  let disabledLibraryCount = 0;
  let pendingLibraryCount = 0;
  let trialLibraryCount = 0;
  let verificationRequiredCount = 0;

  for (const library of libraries) {
    const libraryId = normalizeText(library.id);
    const ownerId = normalizeText(library.owner_id);
    const ownerProfile = ownerProfilesByUserId.get(ownerId);
    const subscription = subscriptionsByLibraryId.get(libraryId);
    const enabled = toBoolean(library.enabled, true);
    const hasControl = isControlWindowActive(
      controlsByLibraryId.get(libraryId)?.status,
      controlsByLibraryId.get(libraryId)?.until_at,
    );
    const isTrial =
      isSubscriptionTrialStatus(subscription?.status) || isSubscriptionTrialStatus(subscription?.payment_status);
    const isPending =
      isSubscriptionPendingStatus(subscription?.status) || isSubscriptionPendingStatus(subscription?.payment_status);
    const needsVerification = !ownerId || !normalizeText(ownerProfile?.email);

    if (enabled && !hasControl) {
      activeLibraryCount += 1;
    }
    if (!enabled) {
      disabledLibraryCount += 1;
    }
    if (!enabled || hasControl) {
      controlledLibraryCount += 1;
    }
    if (isTrial) {
      trialLibraryCount += 1;
    }
    if (isPending) {
      pendingLibraryCount += 1;
    }
    if (needsVerification) {
      verificationRequiredCount += 1;
    }
  }

  const controlledUserIds = new Set<string>();
  let forcedLogoutCount = 0;
  let passwordResetCount = 0;

  for (const control of accountControls) {
    const userId = normalizeText(control.user_id);
    if (!userId) {
      continue;
    }

    const isControlled = isControlWindowActive(control.status, control.until_at);
    if (isControlled) {
      controlledUserIds.add(userId);
    }

    if (normalizeText(control.clear_sessions_after)) {
      forcedLogoutCount += 1;
      controlledUserIds.add(userId);
    }

    if (toBoolean(control.password_reset_required, false)) {
      passwordResetCount += 1;
      controlledUserIds.add(userId);
    }
  }

  for (const userId of activeImpersonationsByUserId.keys()) {
    controlledUserIds.add(userId);
  }

  return {
    activeImpersonationCount: activeImpersonationsByUserId.size,
    activeLibraryCount,
    controlledLibraryCount,
    controlledUserCount: controlledUserIds.size,
    disabledLibraryCount,
    forcedLogoutCount,
    passwordResetCount,
    pendingLibraryCount,
    totalLibraryCount: libraries.length,
    trialLibraryCount,
    verificationRequiredCount,
  };
};

const mapLibraryCenterActivityFeed = ({
  attendanceRows,
  librariesById,
  loginRows,
  platformActivityLogs,
}: {
  attendanceRows: AttendanceRow[];
  librariesById: Map<string, LibraryRow>;
  loginRows: LoginLogRow[];
  platformActivityLogs: ActivityLogRow[];
}): AdminActivityLog[] => {
  const activity = [
    ...platformActivityLogs.map(mapActivityLog),
    ...attendanceRows.slice(0, 20).map((row, index) => {
      const libraryId = normalizeNullableText(row.library_id);
      const libraryName = libraryId ? normalizeText(librariesById.get(libraryId)?.name) : "";
      const occurredAt =
        normalizeText(row.check_in) || normalizeText(row.created_at) || normalizeText(row.date) || nowIso();

      return {
        actorUserId: null,
        activityType: "attendance_scan",
        createdAt: occurredAt,
        id: `attendance:${libraryId ?? "unknown"}:${occurredAt}:${index}`,
        libraryId,
        message: `${libraryName || "A library"} recorded an attendance scan.`,
        metadata: {
          source: "attendance_logs",
        },
        userId: null,
      } satisfies AdminActivityLog;
    }),
    ...loginRows.slice(0, 12).map((row, index) => {
      const occurredAt = normalizeText(row.login_time) || nowIso();
      const email = normalizeText(row.email) || "An operator";
      const status = normalizeText(row.status).toLowerCase();

      return {
        actorUserId: normalizeNullableText(row.user_id),
        activityType: status === "failed" ? "operator_login_failed" : "operator_login_succeeded",
        createdAt: occurredAt,
        id: `login:${normalizeText(row.id) || index}:${occurredAt}`,
        libraryId: null,
        message:
          status === "failed"
            ? `${email} had a failed admin login attempt.`
            : `${email} signed in to the control plane.`,
        metadata: {
          device: normalizeNullableText(row.device),
          login_step: normalizeNullableText(row.login_step),
          source: "login_logs",
          status,
        },
        userId: normalizeNullableText(row.user_id),
      } satisfies AdminActivityLog;
    }),
  ];

  return activity
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 20);
};

const mapCommissionOverrides = ({
  libraries,
  rows,
}: {
  libraries: LibraryRow[];
  rows: CommissionOverrideRow[];
}): AdminCommissionOverride[] => {
  const libraryById = new Map(
    libraries.map((library) => [normalizeText(library.id), normalizeNullableText(library.name)] as const),
  );

  return rows
    .map((row) => ({
      libraryId: normalizeText(row.library_id),
      libraryName: libraryById.get(normalizeText(row.library_id)) ?? null,
      commissionPercent: Number(toNumber(row.commission_percent).toFixed(2)),
      notes: normalizeNullableText(row.notes),
      updatedAt: normalizeNullableText(row.updated_at),
    }))
    .sort((left, right) => left.libraryName?.localeCompare(right.libraryName || "") || 0);
};

const mapRevenueAdjustments = ({
  libraries,
  rows,
}: {
  libraries: LibraryRow[];
  rows: RevenueAdjustmentRow[];
}): AdminRevenueAdjustment[] => {
  const libraryById = new Map(
    libraries.map((library) => [normalizeText(library.id), normalizeNullableText(library.name)] as const),
  );

  return rows
    .map((row) => ({
      id: normalizeText(row.id) || randomUUID(),
      libraryId: normalizeText(row.library_id),
      libraryName: libraryById.get(normalizeText(row.library_id)) ?? null,
      paymentId: normalizeNullableText(row.payment_id),
      subscriptionPaymentId: normalizeNullableText(row.subscription_payment_id),
      amountDelta: Number(toNumber(row.amount_delta).toFixed(2)),
      reason: normalizeText(row.reason),
      createdAt: normalizeText(row.created_at) || nowIso(),
      createdBy: normalizeNullableText(row.created_by),
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const mapPayoutQueueRows = ({
  libraries,
  rows,
}: {
  libraries: LibraryRow[];
  rows: PayoutQueueRow[];
}): AdminPayoutQueueRow[] => {
  const libraryById = new Map(
    libraries.map((library) => [normalizeText(library.id), normalizeNullableText(library.name)] as const),
  );

  return rows
    .map((row) => ({
      id: normalizeText(row.id) || randomUUID(),
      libraryId: normalizeText(row.library_id),
      libraryName: libraryById.get(normalizeText(row.library_id)) ?? null,
      amount: toNumber(row.amount),
      currency: normalizeText(row.currency) || DEFAULT_INVOICE_CURRENCY,
      status: normalizeText(row.status) === "approved" || normalizeText(row.status) === "rejected" || normalizeText(row.status) === "paid"
        ? (normalizeText(row.status) as AdminPayoutQueueRow["status"])
        : "queued",
      note: normalizeNullableText(row.note),
      requestedAt: normalizeText(row.requested_at) || nowIso(),
      approvedAt: normalizeNullableText(row.approved_at),
      processedAt: normalizeNullableText(row.processed_at),
    }))
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
};

const mapBroadcasts = (rows: BroadcastRow[]): AdminBroadcastRow[] =>
  rows
    .map((row) => ({
      id: normalizeText(row.id) || randomUUID(),
      title: normalizeText(row.title),
      message: normalizeText(row.message),
      channel:
        normalizeText(row.channel) === "email" ||
        normalizeText(row.channel) === "whatsapp" ||
        normalizeText(row.channel) === "telegram"
          ? (normalizeText(row.channel) as AdminBroadcastRow["channel"])
          : "in_app",
      audience: normalizeText(row.audience) || DEFAULT_LIBRARY_AUDIENCE,
      status:
        normalizeText(row.status) === "queued" ||
        normalizeText(row.status) === "sent" ||
        normalizeText(row.status) === "failed"
          ? (normalizeText(row.status) as AdminBroadcastRow["status"])
          : "draft",
      sentAt: normalizeNullableText(row.sent_at),
      createdAt: normalizeText(row.created_at) || nowIso(),
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

const mapTemplates = (rows: TemplateRow[]): AdminCommunicationTemplateRow[] =>
  rows
    .map((row) => ({
      id: normalizeText(row.id) || randomUUID(),
      key: normalizeText(row.key),
      name: normalizeText(row.name),
      channel:
        normalizeText(row.channel) === "email" ||
        normalizeText(row.channel) === "whatsapp" ||
        normalizeText(row.channel) === "telegram"
          ? (normalizeText(row.channel) as AdminCommunicationTemplateRow["channel"])
          : "in_app",
      subject: normalizeNullableText(row.subject),
      body: normalizeText(row.body),
      variables: toStringArray(row.variables),
      isActive: toBoolean(row.is_active, true),
      updatedAt: normalizeNullableText(row.updated_at),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

const mapInvoices = ({
  libraries,
  rows,
}: {
  libraries: LibraryRow[];
  rows: InvoiceRow[];
}): AdminInvoiceRow[] => {
  const libraryById = new Map(
    libraries.map((library) => [normalizeText(library.id), normalizeNullableText(library.name)] as const),
  );

  return rows
    .map((row) => ({
      id: normalizeText(row.id) || randomUUID(),
      invoiceNumber: normalizeText(row.invoice_number),
      libraryId: normalizeText(row.library_id),
      libraryName: libraryById.get(normalizeText(row.library_id)) ?? null,
      invoiceType:
        normalizeText(row.invoice_type) === "refund" || normalizeText(row.invoice_type) === "manual_adjustment"
          ? (normalizeText(row.invoice_type) as AdminInvoiceRow["invoiceType"])
          : "subscription",
      status:
        normalizeText(row.status) === "paid" ||
        normalizeText(row.status) === "refunded" ||
        normalizeText(row.status) === "void"
          ? (normalizeText(row.status) as AdminInvoiceRow["status"])
          : "generated",
      subtotal: toNumber(row.subtotal),
      taxAmount: toNumber(row.tax_amount),
      totalAmount: toNumber(row.total_amount),
      issuedAt: normalizeText(row.issued_at) || nowIso(),
      periodStart: normalizeNullableText(row.period_start),
      periodEnd: normalizeNullableText(row.period_end),
    }))
    .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt));
};

const mapRefunds = ({
  libraries,
  rows,
}: {
  libraries: LibraryRow[];
  rows: RefundRow[];
}): AdminRefundRow[] => {
  const libraryById = new Map(
    libraries.map((library) => [normalizeText(library.id), normalizeNullableText(library.name)] as const),
  );

  return rows
    .map((row) => ({
      id: normalizeText(row.id) || randomUUID(),
      libraryId: normalizeText(row.library_id),
      libraryName: libraryById.get(normalizeText(row.library_id)) ?? null,
      amount: toNumber(row.amount),
      reason: normalizeText(row.reason),
      status:
        normalizeText(row.status) === "processed" || normalizeText(row.status) === "failed"
          ? (normalizeText(row.status) as AdminRefundRow["status"])
          : "pending",
      createdAt: normalizeText(row.created_at) || nowIso(),
      processedAt: normalizeNullableText(row.processed_at),
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const enrichJobPayloadFromRow = (row: JobQueueRow) => {
  const trace = {
    ...readJobTraceMetadata(row.payload),
    correlationId:
      normalizeNullableText(row.source_correlation_id) ?? normalizeNullableText(readJobTraceMetadata(row.payload).correlationId),
    originRequestId:
      normalizeNullableText(row.source_request_id) ?? normalizeNullableText(readJobTraceMetadata(row.payload).originRequestId),
    traceId: normalizeNullableText(row.source_trace_id) ?? normalizeNullableText(readJobTraceMetadata(row.payload).traceId),
  };

  return writeJobQueuePayload(row.payload, {
    cancellationReason:
      normalizeNullableText(row.cancellation_reason) ?? normalizeNullableText(readJobQueueMetadata(row.payload).cancellationReason),
    cancelledAt: normalizeNullableText(row.cancelled_at) ?? normalizeNullableText(readJobQueueMetadata(row.payload).cancelledAt),
    cancelRequestedAt:
      normalizeNullableText(row.cancel_requested_at) ?? normalizeNullableText(readJobQueueMetadata(row.payload).cancelRequestedAt),
    cancelRequestedBy:
      normalizeNullableText(row.cancel_requested_by) ?? normalizeNullableText(readJobQueueMetadata(row.payload).cancelRequestedBy),
    claimToken: normalizeNullableText(row.claim_token) ?? normalizeNullableText(readJobQueueMetadata(row.payload).claimToken),
    claimedBy: normalizeNullableText(row.claimed_by) ?? normalizeNullableText(readJobQueueMetadata(row.payload).claimedBy),
    concurrencyKey:
      normalizeNullableText(row.concurrency_key) ?? normalizeNullableText(readJobQueueMetadata(row.payload).concurrencyKey),
    deadLetteredAt:
      normalizeNullableText(row.dead_lettered_at) ?? normalizeNullableText(readJobQueueMetadata(row.payload).deadLetteredAt),
    deduplicationKey:
      normalizeNullableText(row.deduplication_key) ?? normalizeNullableText(readJobQueueMetadata(row.payload).deduplicationKey),
    lastHeartbeatAt:
      normalizeNullableText(row.last_heartbeat_at) ?? normalizeNullableText(readJobQueueMetadata(row.payload).lastHeartbeatAt),
    maxConcurrency: Math.max(
      1,
      toPositiveNumber(
        row.max_concurrency ?? readJobQueueMetadata(row.payload).maxConcurrency ?? resolveJobMaxConcurrency(row.payload, 1),
        1,
      ),
    ),
    recoveredAt: normalizeNullableText(row.recovered_at) ?? normalizeNullableText(readJobQueueMetadata(row.payload).recoveredAt),
    trace,
    visibilityTimeoutAt:
      normalizeNullableText(row.visibility_timeout_at) ?? normalizeNullableText(readJobQueueMetadata(row.payload).visibilityTimeoutAt),
  });
};

const mapJobRow = (row: JobQueueRow): AdminJobQueueRow => {
  const payload = toRecord(enrichJobPayloadFromRow(row));
  const metadata = readJobQueueMetadata(payload);
  const trace = readJobTraceMetadata(payload);

  return {
    id: normalizeText(row.id) || randomUUID(),
    jobType: normalizeText(row.job_type),
    status:
      normalizeText(row.status) === "running" ||
      normalizeText(row.status) === "completed" ||
      normalizeText(row.status) === "failed" ||
      normalizeText(row.status) === "cancelled"
        ? (normalizeText(row.status) as AdminJobQueueRow["status"])
        : "queued",
    createdAt: normalizeNullableText(row.created_at),
    scheduledFor: normalizeText(row.scheduled_for) || nowIso(),
    startedAt: normalizeNullableText(row.started_at),
    finishedAt: normalizeNullableText(row.finished_at),
    attempts: toNumber(row.attempts),
    maxAttempts: Math.max(1, toNumber(row.max_attempts)),
    lastError: normalizeNullableText(row.last_error),
    payload,
    claimToken: normalizeNullableText(row.claim_token) ?? normalizeNullableText(metadata.claimToken),
    claimedBy: normalizeNullableText(row.claimed_by) ?? normalizeNullableText(metadata.claimedBy),
    concurrencyKey: normalizeNullableText(row.concurrency_key) ?? normalizeNullableText(metadata.concurrencyKey),
    deduplicationKey:
      normalizeNullableText(row.deduplication_key) ?? normalizeNullableText(metadata.deduplicationKey),
    deadLetteredAt:
      normalizeNullableText(row.dead_lettered_at) ?? normalizeNullableText(metadata.deadLetteredAt),
    deadLetterReason: normalizeNullableText(metadata.deadLetterReason),
    lastHeartbeatAt:
      normalizeNullableText(row.last_heartbeat_at) ?? normalizeNullableText(metadata.lastHeartbeatAt),
    maxConcurrency: Math.max(
      1,
      toPositiveNumber(row.max_concurrency ?? metadata.maxConcurrency ?? resolveJobMaxConcurrency(payload, 1), 1),
    ),
    recoveredAt: normalizeNullableText(row.recovered_at) ?? normalizeNullableText(metadata.recoveredAt),
    visibilityTimeoutAt:
      normalizeNullableText(row.visibility_timeout_at) ?? normalizeNullableText(metadata.visibilityTimeoutAt),
    cancelRequestedAt:
      normalizeNullableText(row.cancel_requested_at) ?? normalizeNullableText(metadata.cancelRequestedAt),
    cancelRequestedBy:
      normalizeNullableText(row.cancel_requested_by) ?? normalizeNullableText(metadata.cancelRequestedBy),
    cancelledAt: normalizeNullableText(row.cancelled_at) ?? normalizeNullableText(metadata.cancelledAt),
    cancellationReason:
      normalizeNullableText(row.cancellation_reason) ?? normalizeNullableText(metadata.cancellationReason),
    retryHistory: Array.isArray(metadata.retryHistory)
      ? metadata.retryHistory.map((entry, index) => {
          const record = toRecord(entry);
          return {
            at: normalizeNullableText(record.at),
            attempt: Math.max(index + 1, toNumber(record.attempt ?? record.retryAttempt ?? index + 1)),
            error: normalizeNullableText(record.error),
            scheduledFor: normalizeNullableText(record.scheduled_for ?? record.scheduledFor),
            state: normalizeNullableText(record.state),
            metadata: record,
          };
        })
      : [],
    trace: {
      correlationId: normalizeNullableText(trace.correlationId),
      originRequestId: normalizeNullableText(trace.originRequestId),
      parentRequestId: normalizeNullableText(trace.parentRequestId),
      requestSource: normalizeNullableText(trace.requestSource),
      route: normalizeNullableText(trace.route),
      traceId: normalizeNullableText(trace.traceId),
    },
    traceLineage: [],
    relatedIncidentKeys: [],
  };
};

const mapJobs = (rows: JobQueueRow[]): AdminJobQueueRow[] =>
  rows.map((row) => mapJobRow(row)).sort((left, right) => right.scheduledFor.localeCompare(left.scheduledFor));

const TRACE_METADATA_TOKEN_KEYS = [
  "request_id",
  "requestId",
  "source_request_id",
  "sourceRequestId",
  "capture_request_id",
  "captureRequestId",
  "queue_origin_request_id",
  "queueOriginRequestId",
  "queue_parent_request_id",
  "queueParentRequestId",
  "correlation_id",
  "correlationId",
  "source_correlation_id",
  "sourceCorrelationId",
  "capture_correlation_id",
  "captureCorrelationId",
  "trace_id",
  "traceId",
  "source_trace_id",
  "sourceTraceId",
  "capture_trace_id",
  "captureTraceId",
  "queue_trace_id",
  "queueTraceId",
  "queue_job_id",
  "queueJobId",
  "job_id",
  "jobId",
  "subscription_payment_id",
  "subscriptionPaymentId",
  "payment_id",
  "paymentId",
  "paymentReference",
  "order_id",
  "orderId",
  "razorpay_order_id",
  "razorpayOrderId",
  "idempotency_key",
  "idempotencyKey",
  "incident_key",
  "incidentKey",
  "group_key",
  "groupKey",
  "fingerprint",
  "metric_key",
  "metricKey",
];

const collectUniqueStrings = (values: Array<string | null | undefined>) =>
  [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];

const toTraceSeverity = (value: unknown): AdminRuntimeTraceEvent["severity"] => {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "CRITICAL" || normalized === "ERROR" || normalized === "WARNING" || normalized === "INFO") {
    return normalized;
  }

  return null;
};

const collectTraceTokensFromMetadata = (metadata: JsonRecord) => {
  const queueMetadata = readJobQueueMetadata(metadata);
  const queueTrace = readJobTraceMetadata(metadata);

  return collectUniqueStrings([
    ...TRACE_METADATA_TOKEN_KEYS.map((key) => normalizeNullableText(metadata[key])),
    normalizeNullableText(queueMetadata.deduplicationKey),
    normalizeNullableText(queueMetadata.claimToken),
    normalizeNullableText(queueTrace.originRequestId),
    normalizeNullableText(queueTrace.parentRequestId),
    normalizeNullableText(queueTrace.correlationId),
    normalizeNullableText(queueTrace.traceId),
  ]);
};

const mapAppEventLogToTraceEvent = (row: AppEventLogRow): AdminRuntimeTraceEvent => {
  const metadata = toRecord(row.metadata);
  const entityId = normalizeNullableText(row.entity_id);
  const requestId = normalizeNullableText(metadata.request_id ?? metadata.requestId);
  const correlationId = normalizeNullableText(metadata.correlation_id ?? metadata.correlationId);
  const traceId = normalizeNullableText(metadata.trace_id ?? metadata.traceId);
  const queueJobId =
    normalizeNullableText(metadata.queue_job_id ?? metadata.queueJobId ?? metadata.job_id ?? metadata.jobId) ??
    (normalizeText(row.event_type).startsWith("PLATFORM_JOB_") ? entityId : null);
  const paymentReference =
    normalizeNullableText(
      metadata.paymentReference ??
      metadata.payment_id ??
      metadata.paymentId ??
      metadata.order_id ??
      metadata.orderId ??
      metadata.razorpay_order_id ??
      metadata.razorpayOrderId,
    ) ??
    (normalizeText(row.event_type).startsWith("PAYMENT_") ? entityId : null);
  const incidentKey =
    normalizeNullableText(row.group_key) ??
    normalizeNullableText(row.fingerprint) ??
    normalizeNullableText(row.metric_key);

  return {
    actorEmail: normalizeNullableText(row.user_identifier),
    correlationId,
    entityId,
    id: normalizeText(row.id) || randomUUID(),
    incidentKey,
    message: normalizeNullableText(row.message),
    metadata,
    occurredAt: normalizeText(row.occurred_at) || normalizeText(row.created_at) || nowIso(),
    paymentReference,
    queueJobId,
    requestId,
    severity: toTraceSeverity(row.severity ?? metadata.severity),
    source: "event_log",
    status: normalizeText(row.status) || "unknown",
    traceId,
    type: normalizeText(row.event_type) || "UNKNOWN_EVENT",
  };
};

const mapAuditLogToTraceEvent = (row: AuditLogRow): AdminRuntimeTraceEvent => {
  const metadata = toRecord(row.metadata);
  const requestId = normalizeNullableText(row.request_id ?? metadata.request_id ?? metadata.requestId);
  const correlationId = normalizeNullableText(metadata.correlation_id ?? metadata.correlationId);
  const traceId = normalizeNullableText(metadata.trace_id ?? metadata.traceId);
  const incidentKey =
    normalizeNullableText(metadata.incident_key ?? metadata.incidentKey) ??
    (normalizeText(row.target_type) === "incident_group" ? normalizeNullableText(row.target_id) : null);
  const queueJobId =
    normalizeNullableText(metadata.job_id ?? metadata.jobId ?? metadata.queue_job_id ?? metadata.queueJobId) ??
    (normalizeText(row.target_type) === "platform_job" ? normalizeNullableText(row.target_id) : null);
  const paymentReference =
    normalizeNullableText(
      metadata.paymentReference ??
      metadata.payment_id ??
      metadata.paymentId ??
      metadata.order_id ??
      metadata.orderId,
    ) ??
    (normalizeText(row.target_type).includes("payment") ? normalizeNullableText(row.target_id) : null);

  return {
    actorEmail: normalizeNullableText(row.actor_email),
    correlationId,
    entityId: normalizeNullableText(row.target_id),
    id: normalizeText(row.id) || randomUUID(),
    incidentKey,
    message:
      normalizeNullableText(metadata.note) ??
      normalizeNullableText(row.target_display) ??
      normalizeNullableText(row.action),
    metadata,
    occurredAt: normalizeText(row.created_at) || nowIso(),
    paymentReference,
    queueJobId,
    requestId,
    severity: toTraceSeverity(metadata.severity),
    source: "audit_log",
    status: "SUCCESS",
    traceId,
    type: normalizeText(row.action) || "admin_action",
  };
};

const mapJobToTraceEvent = (job: AdminJobQueueRow): AdminRuntimeTraceEvent => ({
  actorEmail: null,
  correlationId: job.trace.correlationId,
  entityId: job.id,
  id: job.id,
  incidentKey: null,
  message: job.lastError ?? `Job ${job.jobType} is ${job.status}.`,
  metadata: {
    attempts: job.attempts,
    cancelled_at: job.cancelledAt,
    cancel_requested_at: job.cancelRequestedAt,
    claim_token: job.claimToken,
    claimed_by: job.claimedBy,
    deduplication_key: job.deduplicationKey,
    job_type: job.jobType,
    max_attempts: job.maxAttempts,
  },
  occurredAt: job.finishedAt ?? job.startedAt ?? job.createdAt ?? job.scheduledFor,
  paymentReference: normalizeNullableText(job.payload.paymentId ?? job.payload.orderId ?? job.payload.paymentReference),
  queueJobId: job.id,
  requestId: job.trace.originRequestId,
  severity: job.status === "failed" ? "ERROR" : job.status === "cancelled" ? "WARNING" : null,
  source: "job",
  status: job.status,
  traceId: job.trace.traceId,
  type: job.jobType,
});

const mapPaymentToTraceEvent = (payment: AdminBillingPaymentRow): AdminRuntimeTraceEvent => ({
  actorEmail: null,
  correlationId: payment.captureCorrelationId,
  entityId: payment.id,
  id: payment.id,
  incidentKey: null,
  message: payment.lastProcessingError ?? `Payment ${payment.reference ?? payment.id} is ${payment.status}.`,
  metadata: {
    capture_source: payment.captureSource,
    duplicate_count: payment.duplicateCount,
    idempotency_key: payment.idempotencyKey,
    order_id: payment.orderId,
    payment_id: payment.paymentId,
    reconciliation_status: payment.reconciliationStatus,
    retry_count: payment.retryCount,
  },
  occurredAt: payment.captureProcessedAt ?? payment.paidAt ?? payment.createdAt,
  paymentReference: payment.paymentId ?? payment.orderId ?? payment.reference ?? payment.id,
  queueJobId: null,
  requestId: payment.captureRequestId,
  severity:
    payment.reconciliationStatus === "manual_review" || payment.reconciliationStatus === "stuck"
      ? "ERROR"
      : payment.retryCount > 0
        ? "WARNING"
        : null,
  source: "payment",
  status: payment.status,
  traceId: payment.captureTraceId,
  type: payment.paymentType,
});

const buildTraceSeedEvents = (traceEvents: AdminRuntimeTraceEvent[]) =>
  traceEvents.map((event) => ({
    actorEmail: event.actorEmail,
    correlationId: event.correlationId,
    entityId: event.entityId,
    id: event.id,
    incidentKey: event.incidentKey,
    message: event.message,
    metadata: event.metadata,
    occurredAt: event.occurredAt,
    paymentReference: event.paymentReference,
    queueJobId: event.queueJobId,
    requestId: event.requestId,
    severity: event.severity,
    source: event.source,
    status: event.status,
    tokens: collectTraceTokensFromMetadata(event.metadata),
    traceId: event.traceId,
    type: event.type,
  }));

const buildTraceTimelineForTokens = (
  seedTokens: Array<string | null | undefined>,
  traceEvents: AdminRuntimeTraceEvent[],
  limit = 40,
) =>
  buildTraceTimeline({
    events: buildTraceSeedEvents(traceEvents),
    limit,
    seedTokens,
  });

const enrichPaymentHistoryRows = (
  paymentHistory: AdminBillingPaymentRow[],
  traceEvents: AdminRuntimeTraceEvent[],
) => {
  const duplicateCounts = new Map<string, number>();

  for (const payment of paymentHistory) {
    const duplicateKey = normalizeText(payment.idempotencyKey || payment.orderId || payment.paymentId || payment.reference);
    if (!duplicateKey) {
      continue;
    }

    duplicateCounts.set(duplicateKey, (duplicateCounts.get(duplicateKey) ?? 0) + 1);
  }

  return paymentHistory.map((payment) => {
    const seedTokens = collectUniqueStrings([
      payment.id,
      payment.reference,
      payment.orderId,
      payment.paymentId,
      payment.idempotencyKey,
      payment.captureRequestId,
      payment.captureCorrelationId,
      payment.captureTraceId,
    ]);
    const lifecycleTimeline = buildTraceTimelineForTokens(seedTokens, traceEvents);
    const linkedIncidentKeys = collectUniqueStrings(lifecycleTimeline.map((event) => event.incidentKey));
    const duplicateKey = normalizeText(payment.idempotencyKey || payment.orderId || payment.paymentId || payment.reference);
    const duplicateCount = duplicateKey ? Math.max(0, (duplicateCounts.get(duplicateKey) ?? 1) - 1) : payment.duplicateCount;
    const retryLikeEvents = lifecycleTimeline.filter((event) =>
      event.type.includes("FAILED") ||
      normalizeText(String(event.metadata.stage)).includes("retry") ||
      event.type.includes("RETRY"),
    );
    const verificationAttempts = Math.max(
      payment.verificationAttempts,
      lifecycleTimeline.filter((event) =>
        normalizeText(String(event.metadata.stage)).includes("verification") ||
        normalizeText(String(event.metadata.source)).includes("verify_payment"),
      ).length,
    );
    const webhookAttempts = Math.max(
      payment.webhookAttempts,
      lifecycleTimeline.filter((event) =>
        normalizeText(String(event.metadata.source)).includes("webhook"),
      ).length,
    );
    const retryCount = Math.max(payment.retryCount, retryLikeEvents.length);
    const paymentAgeMs = Date.now() - Date.parse(payment.createdAt);
    const stuckReason =
      payment.stuckReason ??
      (payment.status.toLowerCase() === "created" && paymentAgeMs > 15 * 60_000
        ? "Capture has not completed within the expected window."
        : payment.status.toLowerCase() === "failed"
          ? payment.lastProcessingError ?? "Payment failed and requires investigation."
          : null);
    const reconciliationStatus =
      payment.reconciliationStatus === "pending" && payment.status.toLowerCase() === "captured"
        ? "reconciled"
        : stuckReason
          ? "stuck"
          : retryCount > 0 && payment.status.toLowerCase() !== "captured"
            ? "retrying"
            : linkedIncidentKeys.length > 0 && payment.status.toLowerCase() !== "captured"
              ? "manual_review"
              : payment.reconciliationStatus;

    return {
      ...payment,
      duplicateCount,
      duplicateDetected: payment.duplicateDetected || duplicateCount > 0,
      lifecycleTimeline,
      linkedIncidentKeys,
      reconciliationStatus,
      retryCount,
      stuckReason,
      verificationAttempts,
      webhookAttempts,
    } satisfies AdminBillingPaymentRow;
  });
};

const enrichJobRows = (
  jobs: AdminJobQueueRow[],
  traceEvents: AdminRuntimeTraceEvent[],
) =>
  jobs.map((job) => {
    const seedTokens = collectUniqueStrings([
      job.id,
      job.deduplicationKey,
      job.claimToken,
      job.trace.originRequestId,
      job.trace.parentRequestId,
      job.trace.correlationId,
      job.trace.traceId,
      normalizeNullableText(job.payload.paymentId ?? job.payload.orderId ?? job.payload.paymentReference),
    ]);
    const traceLineage = buildTraceTimelineForTokens(seedTokens, traceEvents);

    return {
      ...job,
      relatedIncidentKeys: collectUniqueStrings(traceLineage.map((event) => event.incidentKey)),
      traceLineage,
    } satisfies AdminJobQueueRow;
  });

const mapDeadLetterRows = (
  rows: DeadLetterRow[],
  traceEvents: AdminRuntimeTraceEvent[],
): AdminDeadLetterRow[] =>
  rows
    .map((row) => {
      const payload = toRecord(row.job_payload);
      const trace = readJobTraceMetadata(payload);
      const seedTokens = collectUniqueStrings([
        normalizeNullableText(row.job_id),
        normalizeNullableText(row.source_request_id),
        normalizeNullableText(row.source_correlation_id),
        normalizeNullableText(row.source_trace_id),
        normalizeNullableText(trace.originRequestId),
        normalizeNullableText(trace.correlationId),
        normalizeNullableText(trace.traceId),
      ]);

      return {
        attempts: toNumber(row.attempts),
        deadLetteredAt: normalizeText(row.dead_lettered_at) || normalizeText(row.created_at) || nowIso(),
        errorMessage: normalizeNullableText(row.error_message),
        id: normalizeText(row.id) || randomUUID(),
        jobId: normalizeText(row.job_id),
        jobType: normalizeText(row.job_type),
        maxAttempts: Math.max(1, toNumber(row.max_attempts)),
        payload,
        sourceCorrelationId:
          normalizeNullableText(row.source_correlation_id) ?? normalizeNullableText(trace.correlationId),
        sourceRequestId:
          normalizeNullableText(row.source_request_id) ?? normalizeNullableText(trace.originRequestId),
        sourceTraceId:
          normalizeNullableText(row.source_trace_id) ?? normalizeNullableText(trace.traceId),
        traceLineage: buildTraceTimelineForTokens(seedTokens, traceEvents),
      } satisfies AdminDeadLetterRow;
    })
    .sort((left, right) => right.deadLetteredAt.localeCompare(left.deadLetteredAt));

export const buildIncidentWorkflowGroups = ({
  auditLogs,
  baseGroups,
  traceEvents,
}: {
  auditLogs: AuditLogRow[];
  baseGroups: AdminIncidentGroup[];
  traceEvents: AdminRuntimeTraceEvent[];
}) =>
  baseGroups.map((group) => {
    const relatedAuditLogs = auditLogs
      .filter((row) => {
        const metadata = toRecord(row.metadata);
        return (
          normalizeNullableText(metadata.incident_key ?? metadata.incidentKey) === group.incidentKey ||
          (normalizeText(row.target_type) === "incident_group" && normalizeNullableText(row.target_id) === group.incidentKey)
        );
      })
      .sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")));
    const operationalNotes: AdminOperationalNote[] = [];
    let acknowledgedAt: string | null = null;
    let acknowledgedBy: string | null = null;
    let approvalLinkedRequestIds: string[] = [];
    let afterHoursEscalated = false;
    let backupOwnerEmail: string | null = null;
    let crossTeamEscalation = false;
    let delegatedRemediatorEmail: string | null = null;
    const governanceActionIds: string[] = [];
    let organizationLabel: string | null = null;
    let ownerEmail: string | null = null;
    let ownerUserId: string | null = null;
    const ownershipTransitions: AdminIncidentOwnershipTransition[] = [];
    let regionLabel: string | null = null;
    const regionalFailoverEvents: AdminIncidentRegionalFailoverEvent[] = [];
    let escalationLevel = 0;
    let retryableJobId: string | null = null;
    let severityApprovedAt: string | null = null;
    let severityApprovedBy: string | null = null;
    let teamLabel: string | null = null;
    let tenantId: string | null = null;
    let tenantLabel: string | null = null;

    for (const row of relatedAuditLogs) {
      const metadata = toRecord(row.metadata);
      const scopeBoundary = toRecord(metadata.scope_boundary ?? metadata.scopeBoundary);
      const action = normalizeText(row.action);
      const note = normalizeNullableText(metadata.note ?? metadata.resolution_note ?? metadata.resolutionNote);
      const actorEmail = normalizeNullableText(row.actor_email);
      const createdAt = normalizeText(row.created_at) || nowIso();
      const linkedApprovalRequestId =
        normalizeNullableText(metadata.linked_approval_request_id ?? metadata.linkedApprovalRequestId) ??
        normalizeNullableText(metadata.approval_request_id ?? metadata.approvalRequestId);
      const linkedGovernanceActionId =
        normalizeNullableText(metadata.linked_governance_action_id ?? metadata.linkedGovernanceActionId) ??
        normalizeNullableText(metadata.operator_action_id ?? metadata.operatorActionId);
      const nextTenantId =
        normalizeNullableText(metadata.tenant_id ?? metadata.tenantId) ??
        normalizeNullableText(scopeBoundary.tenant_id ?? scopeBoundary.tenantId);
      const nextTenantLabel =
        normalizeNullableText(metadata.tenant_label ?? metadata.tenantLabel) ??
        normalizeNullableText(scopeBoundary.tenant_label ?? scopeBoundary.tenantLabel);
      const nextOrganizationLabel =
        normalizeNullableText(metadata.organization_label ?? metadata.organizationLabel) ??
        normalizeNullableText(scopeBoundary.organization_label ?? scopeBoundary.organizationLabel);
      const nextTeamLabel =
        normalizeNullableText(metadata.assignee_team ?? metadata.assigneeTeam) ??
        normalizeNullableText(metadata.team_label ?? metadata.teamLabel) ??
        normalizeNullableText(scopeBoundary.team_label ?? scopeBoundary.teamLabel);
      const nextRegionLabel =
        normalizeNullableText(metadata.assignee_region ?? metadata.assigneeRegion) ??
        normalizeNullableText(metadata.region_label ?? metadata.regionLabel) ??
        normalizeNullableText(scopeBoundary.region_label ?? scopeBoundary.regionLabel);

      tenantId = nextTenantId ?? tenantId;
      tenantLabel = nextTenantLabel ?? tenantLabel;
      organizationLabel = nextOrganizationLabel ?? organizationLabel;
      teamLabel = nextTeamLabel ?? teamLabel;
      regionLabel = nextRegionLabel ?? regionLabel;

      if (linkedApprovalRequestId) {
        approvalLinkedRequestIds = collectUniqueStrings([...approvalLinkedRequestIds, linkedApprovalRequestId]);
      }

      if (linkedGovernanceActionId) {
        governanceActionIds.push(linkedGovernanceActionId);
      }

      if (note) {
        operationalNotes.push({
          action,
          actorEmail,
          category: normalizeNullableText(metadata.coordination_category ?? metadata.coordinationCategory),
          createdAt,
          id: normalizeText(row.id) || randomUUID(),
          linkedApprovalRequestId,
          linkedGovernanceActionId,
          metadata,
          note,
        });
      }

      if (action === "incident_acknowledged") {
        acknowledgedAt = createdAt || acknowledgedAt;
        acknowledgedBy = actorEmail ?? normalizeNullableText(row.actor_user_id);
      }

      if (action === "incident_assigned") {
        const previousOwner = ownerEmail;
        const nextOwnerEmail = normalizeNullableText(metadata.assignee_email ?? metadata.assigneeEmail);
        ownerEmail = nextOwnerEmail ?? ownerEmail;
        ownerUserId = normalizeNullableText(metadata.assignee_user_id ?? metadata.assigneeUserId);
        backupOwnerEmail =
          normalizeNullableText(metadata.backup_assignee_email ?? metadata.backupAssigneeEmail) ?? backupOwnerEmail;

        const transitionType = normalizeText(metadata.handoff_type ?? metadata.handoffType).toLowerCase();
        const handoffType =
          transitionType === "follow_the_sun" ||
          transitionType === "handoff" ||
          transitionType === "shift_change"
            ? (transitionType as AdminIncidentOwnershipTransition["type"])
            : "assignment";
        ownershipTransitions.push({
          actorEmail,
          at: createdAt,
          from: previousOwner,
          note,
          regionLabel: nextRegionLabel ?? regionLabel,
          teamLabel: nextTeamLabel ?? teamLabel,
          to: nextOwnerEmail,
          type: handoffType,
        });
        crossTeamEscalation =
          crossTeamEscalation ||
          handoffType === "follow_the_sun" ||
          Boolean(previousOwner && nextOwnerEmail && previousOwner !== nextOwnerEmail && nextTeamLabel);
        afterHoursEscalated =
          afterHoursEscalated ||
          handoffType === "follow_the_sun" ||
          Boolean(metadata.shift_timezone ?? metadata.shiftTimezone);
      }

      if (action === "incident_escalated") {
        escalationLevel = Math.max(
          escalationLevel,
          toNumber(metadata.escalation_level ?? metadata.escalationLevel ?? escalationLevel + 1),
        );
        const routeToTeam =
          normalizeNullableText(metadata.route_to_team ?? metadata.routeToTeam) ?? nextTeamLabel;
        const routeToRegion =
          normalizeNullableText(metadata.route_to_region ?? metadata.routeToRegion) ?? nextRegionLabel;
        const regionalFailoverFrom =
          normalizeNullableText(metadata.regional_failover_from ?? metadata.regionalFailoverFrom) ?? regionLabel;
        const regionalFailoverTo =
          normalizeNullableText(metadata.regional_failover_to ?? metadata.regionalFailoverTo) ?? routeToRegion;
        if (regionalFailoverFrom || regionalFailoverTo) {
          regionalFailoverEvents.push({
            actorEmail,
            at: createdAt,
            fromRegion: regionalFailoverFrom,
            note,
            toRegion: regionalFailoverTo,
          });
        }

        crossTeamEscalation =
          crossTeamEscalation ||
          Boolean(
            (routeToTeam && teamLabel && routeToTeam !== teamLabel) ||
            (routeToRegion && regionLabel && routeToRegion !== regionLabel),
          );
        afterHoursEscalated = afterHoursEscalated || toBoolean(metadata.after_hours ?? metadata.afterHours, false);
      }

      if (action === "incident_retry_requested") {
        retryableJobId = normalizeNullableText(metadata.job_id ?? metadata.jobId) ?? retryableJobId;
        delegatedRemediatorEmail =
          normalizeNullableText(metadata.delegated_remediator_email ?? metadata.delegatedRemediatorEmail) ??
          delegatedRemediatorEmail;
        if (delegatedRemediatorEmail) {
          ownershipTransitions.push({
            actorEmail,
            at: createdAt,
            from: ownerEmail,
            note,
            regionLabel,
            teamLabel,
            to: delegatedRemediatorEmail,
            type: "delegated_remediation",
          });
        }
      }

      if (action === "incident_severity_approved") {
        severityApprovedAt = createdAt || severityApprovedAt;
        severityApprovedBy = actorEmail ?? normalizeNullableText(row.actor_user_id);
      }

      if (action === "incident_note_added") {
        delegatedRemediatorEmail =
          normalizeNullableText(metadata.delegated_remediator_email ?? metadata.delegatedRemediatorEmail) ??
          delegatedRemediatorEmail;
      }
    }

    const traceLineage = buildTraceTimelineForTokens([group.incidentKey], traceEvents);
    const linkedJobIds = collectUniqueStrings([
      ...traceLineage.map((event) => event.queueJobId),
      ...relatedAuditLogs.map((row) => normalizeNullableText(toRecord(row.metadata).job_id ?? toRecord(row.metadata).jobId)),
    ]);
    const linkedRequestIds = collectUniqueStrings(traceLineage.map((event) => event.requestId));
    const linkedTraceIds = collectUniqueStrings(traceLineage.map((event) => event.traceId));
    const linkedCorrelationIds = collectUniqueStrings(traceLineage.map((event) => event.correlationId));
    const linkedPaymentReferences = collectUniqueStrings(traceLineage.map((event) => event.paymentReference));
    const remediationActions = traceLineage.filter((event) =>
      ["audit_log", "job"].includes(event.source) &&
      (event.type.includes("retry") ||
        event.type.includes("replay") ||
        event.type.includes("cancel") ||
        event.type.includes("resolve") ||
        event.type.includes("toggle")),
    );
    const firstSeenAt = normalizeNullableText(group.firstSeenAt);
    const slaMinutes = resolveIncidentSlaMinutes(group.severity);
    const slaTargetAt =
      firstSeenAt && Number.isFinite(Date.parse(firstSeenAt))
        ? new Date(Date.parse(firstSeenAt) + slaMinutes * 60_000).toISOString()
        : null;
    const slaBreached = !!(
      slaTargetAt &&
      !acknowledgedAt &&
      Date.parse(slaTargetAt) <= Date.now() &&
      group.unresolvedCount > 0
    );
    const unresolvedOwnership = group.unresolvedCount > 0 && !ownerEmail;

    return {
      ...group,
      acknowledgedAt,
      acknowledgedBy,
      afterHoursEscalated,
      approvalLinkedRequestIds: collectUniqueStrings([
        ...approvalLinkedRequestIds,
        ...linkedRequestIds,
      ]),
      backupOwnerEmail,
      crossTeamEscalation,
      delegatedRemediatorEmail,
      escalationLevel,
      governanceActionIds: collectUniqueStrings(governanceActionIds),
      latestNote: operationalNotes.at(-1)?.note ?? null,
      linkedCorrelationIds,
      linkedJobIds,
      linkedPaymentReferences,
      linkedRequestIds,
      linkedTraceIds,
      noteCount: operationalNotes.length,
      organizationLabel,
      operationalNotes,
      ownerEmail,
      ownerUserId,
      ownershipTransitions,
      regionLabel,
      remediationActions,
      regionalFailoverEvents,
      retryableJobId: retryableJobId ?? linkedJobIds[0] ?? null,
      severityApprovalRequired: group.severity === "CRITICAL" && !severityApprovedAt,
      severityApprovedAt,
      severityApprovedBy,
      slaBreached,
      slaTargetAt,
      teamLabel,
      tenantId,
      tenantLabel,
      traceLineage,
      unresolvedOwnership,
    } satisfies AdminIncidentGroup;
  });

const buildIncidentSummary = (groups: AdminIncidentGroup[]) => ({
  acknowledged: groups.filter((group) => Boolean(group.acknowledgedAt)).length,
  critical: groups.filter((group) => group.severity === "CRITICAL").length,
  error: groups.filter((group) => group.severity === "ERROR").length,
  escalated: groups.filter((group) => group.escalationLevel > 0).length,
  info: groups.filter((group) => group.severity === "INFO").length,
  unresolved: groups.reduce((sum, group) => sum + group.unresolvedCount, 0),
  warning: groups.filter((group) => group.severity === "WARNING").length,
});

const buildRuntimeGovernanceState = (
  settingsMap: Map<string, { updatedAt: string | null; value: unknown }>,
): AdminRuntimeGovernanceState => ({
  automationInactiveLibraryAlertEnabled:
    parseSettingBoolean(settingsMap.get("automation_inactive_library_alert_enabled")?.value) ?? true,
  automationPaymentReminderEnabled:
    parseSettingBoolean(settingsMap.get("automation_payment_reminder_enabled")?.value) ?? true,
  automationSubscriptionRenewalEnabled:
    parseSettingBoolean(settingsMap.get("automation_subscription_renewal_enabled")?.value) ?? true,
  billingMutationsEnabled: parseSettingBoolean(settingsMap.get("ops_billing_mutations_enabled")?.value) ?? true,
  maintenanceMode: parseSettingBoolean(settingsMap.get("maintenance_mode")?.value) ?? false,
  maintenanceEscalationActive:
    parseSettingBoolean(settingsMap.get("ops_maintenance_escalation_active")?.value) ?? false,
  notificationDeliveryEnabled:
    parseSettingBoolean(settingsMap.get("ops_notifications_enabled")?.value) ?? true,
  queueProcessingEnabled: parseSettingBoolean(settingsMap.get("ops_queue_processing_enabled")?.value) ?? true,
  stripeDependencyEnabled:
    !(parseSettingBoolean(settingsMap.get("ops_dependency_disable_stripe")?.value) ?? false),
});

const buildRuntimeVisibility = ({
  deadLetters,
  emailSuccessRate,
  incidentGroups,
  jobs,
  loginSummary,
  paymentHistory,
  redisDegraded,
  slowRequestCount,
}: {
  deadLetters: AdminDeadLetterRow[];
  emailSuccessRate: number;
  incidentGroups: AdminIncidentGroup[];
  jobs: AdminJobQueueRow[];
  loginSummary: ReturnType<typeof buildLoginAttemptSummary>;
  paymentHistory: AdminBillingPaymentRow[];
  redisDegraded: boolean;
  slowRequestCount: number;
}): AdminRuntimeVisibility => {
  const adminRequestLatency = getRuntimeLatencySummary("http_request_latency_ms", { area: "admin" });
  const queueJobLatency = getRuntimeLatencySummary("queue_job_latency_ms");
  const queuedJobs = jobs.filter((job) => job.status === "queued");
  const runningJobs = jobs.filter((job) => job.status === "running");
  const oldestQueuedAtMs = queuedJobs
    .map((job) => Date.parse(job.scheduledFor))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  const derivedQueueLagMs =
    Number.isFinite(oldestQueuedAtMs) ? Math.max(0, Date.now() - oldestQueuedAtMs) : 0;
  const paymentRetryRate =
    paymentHistory.length > 0
      ? Number(
          (
            (paymentHistory.filter((payment) => payment.retryCount > 0).length / paymentHistory.length) *
            100
          ).toFixed(2),
        )
      : 0;

  return {
    activeWorkers: Math.max(
      runningJobs.length,
      toNumber(getRuntimeGaugeValue("queue_running_jobs") ?? 0),
    ),
    apiLatencyP95Ms: adminRequestLatency.p95,
    deadLetterJobs: deadLetters.length,
    emailFailureRate: Number((100 - emailSuccessRate).toFixed(2)),
    incidentSeverityCounts: {
      critical: incidentGroups.filter((group) => group.severity === "CRITICAL").length,
      error: incidentGroups.filter((group) => group.severity === "ERROR").length,
      info: incidentGroups.filter((group) => group.severity === "INFO").length,
      warning: incidentGroups.filter((group) => group.severity === "WARNING").length,
    },
    otpDeliveryFailures: loginSummary.otpAbuseSignals,
    paymentRetryRate,
    queueLagMs: Math.max(
      derivedQueueLagMs,
      toNumber(getRuntimeGaugeValue("queue_lag_ms") ?? 0),
    ),
    queueLatencyP95Ms: queueJobLatency.p95,
    redisDegraded,
    retryCount: Math.max(
      getRuntimeCounterTotal("queue_jobs_total", { outcome: "retried" }),
      jobs.reduce((sum, job) => sum + job.retryHistory.length, 0),
    ),
    slowRequests: slowRequestCount,
  };
};

const buildBillingOperations = ({
  paymentHistory,
  runtimeGovernance,
}: {
  paymentHistory: AdminBillingPaymentRow[];
  runtimeGovernance: AdminRuntimeGovernanceState;
}) => ({
  billingMutationsEnabled: runtimeGovernance.billingMutationsEnabled,
  duplicatePayments: paymentHistory.filter((payment) => payment.duplicateDetected).length,
  manualReviewPayments: paymentHistory.filter((payment) => payment.reconciliationStatus === "manual_review").length,
  paymentRetryRate:
    paymentHistory.length > 0
      ? Number(
          (
            (paymentHistory.filter((payment) => payment.retryCount > 0).length / paymentHistory.length) *
            100
          ).toFixed(2),
        )
      : 0,
  reconciledPayments: paymentHistory.filter((payment) => payment.reconciliationStatus === "reconciled").length,
  stuckPayments: paymentHistory.filter((payment) => payment.reconciliationStatus === "stuck").length,
  verificationRetries: paymentHistory.reduce((sum, payment) => sum + payment.verificationAttempts, 0),
  webhookRetries: paymentHistory.reduce((sum, payment) => sum + payment.webhookAttempts, 0),
});

const buildAutomationSummary = ({
  deadLetters,
  jobs,
  runtimeGovernance,
  runtimeVisibility,
}: {
  deadLetters: AdminDeadLetterRow[];
  jobs: AdminJobQueueRow[];
  runtimeGovernance: AdminRuntimeGovernanceState;
  runtimeVisibility: AdminRuntimeVisibility;
}) => ({
  activeWorkers: runtimeVisibility.activeWorkers,
  deadLetterJobs: deadLetters.length,
  paused: !runtimeGovernance.queueProcessingEnabled,
  queueLagMs: runtimeVisibility.queueLagMs,
  queueLatencyP95Ms: runtimeVisibility.queueLatencyP95Ms,
  queuedJobs: jobs.filter((job) => job.status === "queued").length,
  redisDegraded: runtimeVisibility.redisDegraded,
  retryCount: runtimeVisibility.retryCount,
  runningJobs: jobs.filter((job) => job.status === "running").length,
});

const buildOperationalContext = ({
  core,
  loginSummary,
  settingsMap,
  statusData,
}: {
  core: Awaited<ReturnType<typeof loadCoreAdminData>>;
  loginSummary: ReturnType<typeof buildLoginAttemptSummary>;
  settingsMap: Map<string, { updatedAt: string | null; value: unknown }>;
  statusData: Awaited<ReturnType<typeof buildStatusSignals>>;
}) => {
  const runtimeGovernance = buildRuntimeGovernanceState(settingsMap);
  const basePaymentHistory = buildPaymentHistoryRows({
    libraries: core.libraries,
    payments: core.payments,
    subscriptionPayments: core.subscriptionPayments,
  });
  const baseJobs = mapJobs(core.jobs);
  const baseTraceEvents = [
    ...core.eventLogs.map(mapAppEventLogToTraceEvent),
    ...core.auditLogs.map(mapAuditLogToTraceEvent),
    ...baseJobs.map(mapJobToTraceEvent),
    ...basePaymentHistory.map(mapPaymentToTraceEvent),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const paymentHistory = enrichPaymentHistoryRows(basePaymentHistory, baseTraceEvents);
  const traceEvents = [
    ...core.eventLogs.map(mapAppEventLogToTraceEvent),
    ...core.auditLogs.map(mapAuditLogToTraceEvent),
    ...baseJobs.map(mapJobToTraceEvent),
    ...paymentHistory.map(mapPaymentToTraceEvent),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const jobs = enrichJobRows(baseJobs, traceEvents);
  const deadLetters = mapDeadLetterRows(core.deadLetterRows, traceEvents);
  const incidentGroups = buildIncidentWorkflowGroups({
    auditLogs: core.auditLogs,
    baseGroups: buildIncidentGroups(core.incidentRows as unknown as IncidentViewRow[]),
    traceEvents,
  });
  const slowRequestCount = core.eventLogs.filter((row) => normalizeText(row.event_type) === "ADMIN_ROUTE_SLOW").length;
  const runtimeVisibility = buildRuntimeVisibility({
    deadLetters,
    emailSuccessRate: statusData.emailSuccessRate,
    incidentGroups,
    jobs,
    loginSummary,
    paymentHistory,
    redisDegraded: statusData.signals.some((signal) => signal.label === "Redis" && signal.status !== "green"),
    slowRequestCount,
  });
  const billingOperations = buildBillingOperations({
    paymentHistory,
    runtimeGovernance,
  });
  const automationSummary = buildAutomationSummary({
    deadLetters,
    jobs,
    runtimeGovernance,
    runtimeVisibility,
  });
  const alertTraceEvents = buildOperationalAlerts({
    apiLatencyP95Ms: runtimeVisibility.apiLatencyP95Ms,
    authFailureCount: getRuntimeCounterTotal("auth_requests_total", { outcome: "error" }),
    criticalIncidents: incidentGroups.filter((group) => group.severity === "CRITICAL").length,
    deadLetterJobs: runtimeVisibility.deadLetterJobs,
    emailSuccessRate: statusData.emailSuccessRate,
    otpFailureCount: runtimeVisibility.otpDeliveryFailures,
    paymentRetryRate: billingOperations.paymentRetryRate,
    queuedJobs: automationSummary.queuedJobs,
    queueLagMs: runtimeVisibility.queueLagMs,
    redisDegraded: runtimeVisibility.redisDegraded,
    slowRequests: runtimeVisibility.slowRequests,
  }).map((alert, index) => ({
    actorEmail: null,
    correlationId: null,
    entityId: null,
    id: `alert-${index}-${alert.type}`,
    incidentKey: null,
    message: alert.message,
    metadata: toRecord(alert.metadata),
    occurredAt: nowIso(),
    paymentReference: null,
    queueJobId: null,
    requestId: null,
    severity: alert.severity,
    source: "event_log" as const,
    status: "ACTIVE",
    traceId: null,
    type: alert.type,
  }));

  return {
    alertTraceEvents,
    automationSummary,
    billingOperations,
    deadLetters,
    incidentGroups,
    jobs,
    paymentHistory,
    runtimeGovernance,
    runtimeVisibility,
    traceEvents,
  };
};

const buildJobTraceFromActor = (actor: SuperAdminActorContext) => {
  const requestTrace = getRequestTraceContext();
  return {
    correlationId: actor.correlationId ?? requestTrace?.correlationId ?? null,
    originRequestId: actor.requestId,
    parentRequestId: requestTrace?.requestId ?? actor.requestId,
    requestSource: actor.requestSource,
    route: actor.requestPath,
    traceId: actor.traceId ?? requestTrace?.traceId ?? null,
  };
};

const readJobVisibilityTimeoutAt = (job: AdminJobQueueRow) =>
  normalizeNullableText(readJobQueueMetadata(job.payload).visibilityTimeoutAt);

const buildJobVisibilityTimeoutAt = (job: AdminJobQueueRow, nowMs = Date.now()) =>
  new Date(nowMs + resolveJobVisibilityTimeoutMs(job.payload, JOB_VISIBILITY_TIMEOUT_MS)).toISOString();

const startJobLeaseHeartbeat = ({
  client,
  job,
}: {
  client: UntypedClient;
  job: AdminJobQueueRow;
}) => {
  const claimToken = normalizeText(readJobQueueMetadata(job.payload).claimToken);
  if (!claimToken) {
    return () => undefined;
  }

  const timer = setInterval(() => {
    const visibilityTimeoutAt = buildJobVisibilityTimeoutAt(job);
    void client
      .from("platform_job_queue")
      .update({
        last_heartbeat_at: nowIso(),
        visibility_timeout_at: visibilityTimeoutAt,
      })
      .eq("id", job.id)
      .eq("claim_token", claimToken);
  }, JOB_HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(timer);
};

const readRows = async <TRow extends Record<string, unknown>>(
  queryPromise: Promise<{ data: TRow[] | null; error: { message?: string } | null }>,
): Promise<TRow[]> => {
  const { data, error } = await queryPromise;
  if (error) {
    throw new Error(error.message || "Supabase query failed.");
  }

  return data ?? [];
};

const readOptionalRows = async <TRow extends Record<string, unknown>>(
  queryPromise: Promise<{ data: TRow[] | null; error: { message?: string } | null }>,
) => {
  try {
    return await readRows(queryPromise);
  } catch {
    return [] as TRow[];
  }
};

const readMaybeSingle = async <TRow extends Record<string, unknown>>(
  queryPromise: Promise<{ data: TRow | null; error: { message?: string } | null }>,
) => {
  const { data, error } = await queryPromise;
  if (error) {
    throw new Error(error.message || "Supabase query failed.");
  }

  return data;
};

const hashOperatorToken = (token: string) => createHash("sha256").update(token).digest("hex");
const buildOperatorFingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const STORED_SCOPE_TYPE_VALUES: AdminOperatorScope["scopeType"][] = [
  "global",
  "platform",
  "tenant",
  "organization",
  "department",
  "team",
  "operational_group",
  "region",
  "governance_domain",
  "library",
  "user",
  "billing",
  "incident",
  "job",
  "queue",
  "feature_flag",
  "approval_request",
];

const STORED_GOVERNANCE_DOMAIN_VALUES: AdminOperatorGovernanceDomain[] = [
  "billing",
  "incident",
  "infrastructure",
  "support",
  "emergency",
  "platform",
];

const normalizeStoredScopeType = (value: unknown): AdminOperatorScope["scopeType"] =>
  STORED_SCOPE_TYPE_VALUES.includes(value as AdminOperatorScope["scopeType"])
    ? (value as AdminOperatorScope["scopeType"])
    : "global";

const normalizeGovernanceDomainInput = (value: unknown): AdminOperatorGovernanceDomain | null =>
  STORED_GOVERNANCE_DOMAIN_VALUES.includes(value as AdminOperatorGovernanceDomain)
    ? (value as AdminOperatorGovernanceDomain)
    : null;

let inflightLibraryCenterRequest: Promise<StructuredApiResponse<SuperAdminLibraryCenterData>> | null = null;

const toBoundaryRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalizeScopeBoundaryInput = (
  value: unknown,
  metadataValue: unknown = null,
): AdminOperatorScopeBoundary => {
  const metadataRecord = toBoundaryRecord(metadataValue);
  const metadataBoundary = toBoundaryRecord(metadataRecord.boundary);
  const directRecord = toBoundaryRecord(value);
  const directBoundary = toBoundaryRecord(directRecord.boundary);
  const record =
    Object.keys(metadataBoundary).length > 0
      ? metadataBoundary
      : Object.keys(directBoundary).length > 0
        ? directBoundary
        : directRecord;
  const rawVisibilityTags = record.visibilityTags ?? record.visibility_tags;

  return {
    delegatedScopeId: normalizeNullableText(record.delegatedScopeId ?? record.delegated_scope_id),
    delegatedScopeLabel: normalizeNullableText(record.delegatedScopeLabel ?? record.delegated_scope_label),
    delegatedScopeType: normalizeNullableText(record.delegatedScopeType ?? record.delegated_scope_type) as AdminOperatorScopeBoundary["delegatedScopeType"],
    departmentId: normalizeNullableText(record.departmentId ?? record.department_id),
    departmentLabel: normalizeNullableText(record.departmentLabel ?? record.department_label),
    governanceDomain: normalizeGovernanceDomainInput(record.governanceDomain ?? record.governance_domain),
    operationalGroupId: normalizeNullableText(record.operationalGroupId ?? record.operational_group_id),
    operationalGroupLabel: normalizeNullableText(record.operationalGroupLabel ?? record.operational_group_label),
    organizationId: normalizeNullableText(record.organizationId ?? record.organization_id),
    organizationLabel: normalizeNullableText(record.organizationLabel ?? record.organization_label),
    regionId: normalizeNullableText(record.regionId ?? record.region_id),
    regionLabel: normalizeNullableText(record.regionLabel ?? record.region_label),
    teamId: normalizeNullableText(record.teamId ?? record.team_id),
    teamLabel: normalizeNullableText(record.teamLabel ?? record.team_label),
    tenantId: normalizeNullableText(record.tenantId ?? record.tenant_id),
    tenantLabel: normalizeNullableText(record.tenantLabel ?? record.tenant_label),
    visibilityTags: Array.isArray(rawVisibilityTags)
      ? [...new Set(rawVisibilityTags.map((entry) => normalizeText(entry)).filter(Boolean))]
      : [],
  };
};

const serializeScopeBoundary = (boundary: AdminOperatorScopeBoundary) => ({
  delegated_scope_id: boundary.delegatedScopeId,
  delegated_scope_label: boundary.delegatedScopeLabel,
  delegated_scope_type: boundary.delegatedScopeType,
  department_id: boundary.departmentId,
  department_label: boundary.departmentLabel,
  governance_domain: boundary.governanceDomain,
  operational_group_id: boundary.operationalGroupId,
  operational_group_label: boundary.operationalGroupLabel,
  organization_id: boundary.organizationId,
  organization_label: boundary.organizationLabel,
  region_id: boundary.regionId,
  region_label: boundary.regionLabel,
  team_id: boundary.teamId,
  team_label: boundary.teamLabel,
  tenant_id: boundary.tenantId,
  tenant_label: boundary.tenantLabel,
  visibility_tags: boundary.visibilityTags,
});

const dedupeAuthorityScopes = (scopes: AdminOperatorScope[]) =>
  [...new Map(
    scopes.map((scope) => [
      buildOperatorFingerprint({
        boundary: serializeScopeBoundary(scope.boundary),
        scopeId: scope.scopeId,
        scopeLabel: scope.scopeLabel,
        scopeType: scope.scopeType,
      }),
      scope,
    ]),
  ).values()];

const buildAuthorityScopesFromScope = (scope: AdminOperatorScope): AdminOperatorScope[] => {
  const boundary = scope.boundary ?? EMPTY_OPERATOR_SCOPE_BOUNDARY;
  const inheritedScopes: AdminOperatorScope[] = [
    scope,
    boundary.tenantId
      ? {
          boundary,
          scopeId: boundary.tenantId,
          scopeLabel: boundary.tenantLabel,
          scopeType: "tenant",
        }
      : null,
    boundary.organizationId
      ? {
          boundary,
          scopeId: boundary.organizationId,
          scopeLabel: boundary.organizationLabel,
          scopeType: "organization",
        }
      : null,
    boundary.departmentId
      ? {
          boundary,
          scopeId: boundary.departmentId,
          scopeLabel: boundary.departmentLabel,
          scopeType: "department",
        }
      : null,
    boundary.teamId
      ? {
          boundary,
          scopeId: boundary.teamId,
          scopeLabel: boundary.teamLabel,
          scopeType: "team",
        }
      : null,
    boundary.operationalGroupId
      ? {
          boundary,
          scopeId: boundary.operationalGroupId,
          scopeLabel: boundary.operationalGroupLabel,
          scopeType: "operational_group",
        }
      : null,
    boundary.regionId
      ? {
          boundary,
          scopeId: boundary.regionId,
          scopeLabel: boundary.regionLabel,
          scopeType: "region",
        }
      : null,
    boundary.governanceDomain
      ? {
          boundary,
          scopeId: boundary.governanceDomain,
          scopeLabel: boundary.governanceDomain,
          scopeType: "governance_domain",
        }
      : null,
  ].filter((candidate): candidate is AdminOperatorScope => Boolean(candidate));

  return dedupeAuthorityScopes(inheritedScopes);
};

const serializeAuthorityScopes = (scopes: AdminOperatorScope[]) =>
  scopes.map((scope) => ({
    boundary: serializeScopeBoundary(scope.boundary),
    scope_id: scope.scopeId,
    scope_label: scope.scopeLabel,
    scope_type: scope.scopeType,
  }));

const readAuthorityScopes = (value: unknown): AdminOperatorScope[] =>
  dedupeAuthorityScopes(
    (Array.isArray(value) ? value : [])
      .map((entry) => {
        const record = toBoundaryRecord(entry);
        return {
          boundary: normalizeScopeBoundaryInput(record),
          scopeId: normalizeNullableText(record.scopeId ?? record.scope_id),
          scopeLabel: normalizeNullableText(record.scopeLabel ?? record.scope_label),
          scopeType: normalizeStoredScopeType(record.scopeType ?? record.scope_type),
        };
      })
      .filter((scope) => Boolean(scope.scopeType)),
  );

const buildAuthorityScopeSummary = (scope: AdminOperatorScope) =>
  uniqueStrings([
    normalizeText(scope.scopeLabel) || normalizeText(scope.scopeId) || scope.scopeType,
    buildScopeBoundarySummary({ boundary: scope.boundary }),
  ]).filter((value) => value !== "Global boundary");

const buildRequestScopeSummary = ({
  authorityScopes,
  boundary,
  targetDisplay,
  targetType,
}: {
  authorityScopes: AdminOperatorScope[];
  boundary: AdminOperatorScopeBoundary;
  targetDisplay: string | null;
  targetType: string;
}) => {
  const summaries = uniqueStrings(authorityScopes.flatMap((scope) => buildAuthorityScopeSummary(scope)));
  if (summaries.length) {
    return summaries;
  }

  return uniqueStrings([
    normalizeText(targetDisplay) || normalizeText(targetType),
    buildScopeBoundarySummary({ boundary }),
  ]).filter((value) => value !== "Global boundary");
};

const readDelegationHistory = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => {
      const record = toBoundaryRecord(entry);
      const rawScopeSummary = record.scopeSummary ?? record.scope_summary;
      return {
        approvalRequestId: normalizeNullableText(record.approvalRequestId ?? record.approval_request_id),
        at: normalizeNullableText(record.at),
        delegatedBy: normalizeNullableText(record.delegatedBy ?? record.delegated_by),
        delegatedTo: normalizeNullableText(record.delegatedTo ?? record.delegated_to),
        mode:
          normalizeText(record.mode) === "fallback"
            ? "fallback"
            : normalizeText(record.mode) === "out_of_office"
              ? "out_of_office"
              : normalizeText(record.mode) === "escalated"
                ? "escalated"
                : "delegated",
        note: normalizeNullableText(record.note),
        scopeSummary: uniqueStrings(
          Array.isArray(rawScopeSummary)
            ? rawScopeSummary.map((item) => normalizeText(item))
            : [],
        ),
      } satisfies AdminOperatorApprovalRequest["delegationHistory"][number];
    })
    .filter((entry) => Boolean(entry.approvalRequestId || entry.delegatedBy || entry.delegatedTo));

const readEscalationChain = (value: unknown) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => {
      const record = toBoundaryRecord(entry);
      const rawScopeSummary = record.scopeSummary ?? record.scope_summary;
      return {
        at: normalizeNullableText(record.at),
        from: normalizeNullableText(record.from),
        reason: normalizeNullableText(record.reason),
        scopeSummary: uniqueStrings(
          Array.isArray(rawScopeSummary)
            ? rawScopeSummary.map((item) => normalizeText(item))
            : [],
        ),
        status: normalizeText(record.status) === "completed" ? "completed" : "pending",
        to: normalizeNullableText(record.to),
      } satisfies AdminOperatorApprovalRequest["escalationChain"][number];
    })
    .filter((entry) => Boolean(entry.from || entry.to || entry.reason));

const normalizeOperatorRole = (value: unknown): AdminOperatorRole | null => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "emergency_admin") {
    return "emergency_ops";
  }

  return OPERATOR_ROLE_VALUES.includes(normalized as AdminOperatorRole)
    ? (normalized as AdminOperatorRole)
    : null;
};

const toNullableIntegerWithinRange = (
  value: unknown,
  {
    max = Number.MAX_SAFE_INTEGER,
    min = 0,
  }: {
    max?: number;
    min?: number;
  } = {},
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = Math.trunc(parsed);
  if (normalized < min || normalized > max) {
    return null;
  }

  return normalized;
};

const resolveTimezoneHour = (timezone: string, atMs = Date.now()) => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    });
    const hourPart = formatter.formatToParts(new Date(atMs)).find((part) => part.type === "hour")?.value ?? "";
    const parsed = Number(hourPart);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const isShiftWindowActive = (hour: number | null, startHour: number | null, endHour: number | null) => {
  if (hour == null || startHour == null || endHour == null) {
    return true;
  }

  if (startHour === endHour) {
    return true;
  }

  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }

  return hour >= startHour || hour < endHour;
};

const normalizeAvailabilityStatus = (value: unknown): AdminOperatorAvailabilityProfile["status"] | null => {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "active" ||
    normalized === "after_hours" ||
    normalized === "away" ||
    normalized === "backup" ||
    normalized === "offline" ||
    normalized === "standby"
  ) {
    return normalized as AdminOperatorAvailabilityProfile["status"];
  }

  return null;
};

const buildOperatorAvailabilityProfile = (
  grant: AdminOperatorGrant,
  nowMs = Date.now(),
): AdminOperatorAvailabilityProfile | null => {
  const metadata = toRecord(grant.metadata);
  const timezone =
    normalizeNullableText(metadata.timezone ?? metadata.primary_timezone ?? metadata.primaryTimezone) ?? null;
  const shiftStartHourLocal = toNullableIntegerWithinRange(
    metadata.shift_start_hour_local ?? metadata.shiftStartHourLocal,
    { max: 24, min: 0 },
  );
  const shiftEndHourLocal = toNullableIntegerWithinRange(
    metadata.shift_end_hour_local ?? metadata.shiftEndHourLocal,
    { max: 24, min: 0 },
  );
  const fallbackChain = collectUniqueStrings([
    normalizeNullableText(metadata.backup_operator_email ?? metadata.backupOperatorEmail),
    normalizeNullableText(metadata.backup_operator ?? metadata.backupOperator),
    ...(Array.isArray(metadata.fallback_chain) ? metadata.fallback_chain.map((entry) => String(entry)) : []),
  ]);
  const regions = collectUniqueStrings([
    ...(Array.isArray(metadata.regions) ? metadata.regions.map((entry) => String(entry)) : []),
    grant.boundary.regionLabel,
    grant.boundary.regionId,
  ]);
  const standby = toBoolean(metadata.standby, false) || toBoolean(metadata.emergency_standby, false);
  const shiftLabel =
    normalizeNullableText(metadata.shift_name ?? metadata.shiftName) ??
    (shiftStartHourLocal != null && shiftEndHourLocal != null
      ? `${String(shiftStartHourLocal).padStart(2, "0")}:00-${String(shiftEndHourLocal).padStart(2, "0")}:00`
      : null);
  const hour = timezone ? resolveTimezoneHour(timezone, nowMs) : null;
  const shiftActive = isShiftWindowActive(hour, shiftStartHourLocal, shiftEndHourLocal);
  const explicitStatus = normalizeAvailabilityStatus(
    metadata.availability_status ?? metadata.availabilityStatus,
  );
  const status =
    explicitStatus ??
    (standby
      ? "standby"
      : fallbackChain.length
        ? "backup"
        : shiftActive
          ? "active"
          : "after_hours");
  const workloadCapacity = toNullableIntegerWithinRange(
    metadata.workload_capacity ?? metadata.workloadCapacity ?? metadata.max_active_items,
    { min: 1 },
  );

  if (!timezone && !shiftLabel && !fallbackChain.length && !regions.length && !standby && workloadCapacity == null) {
    return null;
  }

  return {
    backupOperator: fallbackChain[0] ?? null,
    fallbackChain,
    regions,
    shiftActive,
    shiftEndHourLocal,
    shiftLabel,
    shiftStartHourLocal,
    standby,
    status,
    timezone,
    workloadCapacity,
  };
};

const buildGrantFromRow = (row: RoleGrantRow): AdminOperatorGrant | null =>
  normalizeOperatorGrants([
    {
      email: row.email,
      expires_at: row.expires_at,
      grant_mode: row.grant_mode,
      id: row.id,
      metadata: row.metadata,
      reason: row.reason,
      restrictions: row.restrictions,
      revoked_at: row.revoked_at,
      role: row.role,
      scope_id: row.scope_id,
      scope_label: row.scope_label,
      scope_type: row.scope_type,
      starts_at: row.starts_at,
      user_id: row.user_id,
    },
  ])[0] ?? null;

const buildGrantFromLegacyAssignment = (row: OperatorAssignmentRow): AdminOperatorGrant | null =>
  normalizeOperatorGrants([
    {
      email: row.email,
      grant_mode: "legacy_migrated",
      id: `${normalizeText(row.user_id) || normalizeText(row.email)}:${normalizeText(row.role) || "unknown"}`,
      role: row.role,
      scope_type: "global",
      user_id: row.user_id,
    },
  ])[0] ?? null;

const buildDefaultOperatorGrant = (
  actorUserId: string,
  actorEmail: string | null,
): AdminOperatorGrant => ({
  boundary: EMPTY_OPERATOR_SCOPE_BOUNDARY,
  email: actorEmail,
  expiresAt: null,
  grantId: `bootstrap:${actorUserId}`,
  grantMode: "legacy_migrated",
  reason: "Bootstrap fallback until role grants are configured.",
  restrictions: {},
  revokedAt: null,
  role: "super_admin",
  scopeId: null,
  scopeLabel: "Bootstrap",
  scopeType: "global",
  startsAt: null,
  userId: actorUserId,
});

const isGrantActiveAt = (grant: AdminOperatorGrant, atMs = Date.now()) => {
  if (grant.revokedAt) {
    return false;
  }

  if (grant.startsAt) {
    const startsAtMs = Date.parse(grant.startsAt);
    if (Number.isFinite(startsAtMs) && startsAtMs > atMs) {
      return false;
    }
  }

  if (grant.expiresAt) {
    const expiresAtMs = Date.parse(grant.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= atMs) {
      return false;
    }
  }

  return true;
};

const resolveGrantStatus = (grant: AdminOperatorGrant): AdminOperatorRoleGrant["status"] => {
  if (grant.revokedAt) {
    return "revoked";
  }

  if (grant.startsAt) {
    const startsAtMs = Date.parse(grant.startsAt);
    if (Number.isFinite(startsAtMs) && startsAtMs > Date.now()) {
      return "scheduled";
    }
  }

  if (grant.expiresAt) {
    const expiresAtMs = Date.parse(grant.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      return "expired";
    }
  }

  return "active";
};

const buildGrantConflictWarnings = (
  grant: AdminOperatorGrant,
  allGrants: AdminOperatorGrant[],
) => {
  const warnings: string[] = [];
  const peerGrants = allGrants.filter((candidate) => candidate.grantId !== grant.grantId);

  if (grant.grantMode === "emergency_override" && !grant.expiresAt) {
    warnings.push("Emergency override has no expiry and should be time-bound.");
  }

  if (grant.restrictions.readOnlyMode) {
    warnings.push("Read-only mode is enforced on this grant.");
  }

  if (
    peerGrants.some(
      (candidate) =>
        candidate.role === grant.role &&
        candidate.scopeType === grant.scopeType &&
        normalizeNullableText(candidate.scopeId) === normalizeNullableText(grant.scopeId) &&
        buildScopeBoundarySummary({ boundary: candidate.boundary }) === buildScopeBoundarySummary({ boundary: grant.boundary }) &&
        isGrantActiveAt(candidate),
    )
  ) {
    warnings.push("Another active grant already covers this same role and scope.");
  }

  if (
    grant.role !== "read_only_ops" &&
    peerGrants.some((candidate) => candidate.restrictions.readOnlyMode && isGrantActiveAt(candidate))
  ) {
    warnings.push("A separate read-only restriction is active for this operator.");
  }

  return warnings;
};

const buildOperatorRoleGrantSummary = (
  grant: AdminOperatorGrant,
  allGrants: AdminOperatorGrant[],
): AdminOperatorRoleGrant => ({
  availability: buildOperatorAvailabilityProfile(grant),
  boundary: grant.boundary,
  conflictWarnings: buildGrantConflictWarnings(grant, allGrants),
  createdAt: null,
  email: grant.email,
  effectivePermissions: expandOperatorPermissions([grant.role]),
  expiresAt: grant.expiresAt,
  grantId: grant.grantId,
  grantMode: grant.grantMode,
  inheritedRoles: expandInheritedOperatorRoles([grant.role]).filter((role) => role !== grant.role),
  reason: grant.reason,
  restrictions: grant.restrictions,
  revokedAt: grant.revokedAt,
  role: grant.role,
  roleLabel: getOperatorRoleLabel(grant.role),
  scopeId: grant.scopeId,
  scopeLabel: grant.scopeLabel,
  scopeType: grant.scopeType,
  startsAt: grant.startsAt,
  status: resolveGrantStatus(grant),
  userId: grant.userId,
});

const isGovernanceSensitiveAuditLog = (row: AuditLogRow) => {
  const metadata = toRecord(row.metadata);
  const operatorActionId = normalizeText(metadata.operator_action_id ?? metadata.operatorActionId);
  if (operatorActionId) {
    return true;
  }

  return [
    "operator_role_grant",
    "governance_request",
    "platform_setting",
    "feature_flag",
    "queue_job",
    "incident",
    "billing_refund",
    "invoice",
  ].includes(normalizeText(row.target_type));
};

const buildGovernanceConsistencyState = ({
  approvalRequests,
  grants,
  recentAuditLogs,
}: {
  approvalRequests: AdminOperatorApprovalRequest[];
  grants: AdminOperatorRoleGrant[];
  recentAuditLogs: AuditLogRow[];
}) => {
  const recentGovernanceLogs = recentAuditLogs
    .filter((row) => isGovernanceSensitiveAuditLog(row))
    .slice(0, 120);
  const grantVersion = buildOperatorFingerprint(
    grants.map((grant) => ({
      expiresAt: grant.expiresAt,
      grantId: grant.grantId,
      grantMode: grant.grantMode,
      boundary: serializeScopeBoundary(grant.boundary),
      readOnlyMode: grant.restrictions.readOnlyMode === true,
      revokedAt: grant.revokedAt,
      role: grant.role,
      scopeId: grant.scopeId,
      scopeType: grant.scopeType,
      startsAt: grant.startsAt,
      status: grant.status,
      userId: grant.userId,
    })),
  );
  const approvalVersion = buildOperatorFingerprint(
    approvalRequests.map((request) => ({
      actionId: request.actionId,
      approvedAt: request.approvedAt,
      approvals: request.approvals.map((decision) => ({
        actorUserId: decision.actorUserId,
        at: decision.at,
        decision: decision.decision,
      })),
      authorityScopes: serializeAuthorityScopes(request.authorityScopes),
      boundary: serializeScopeBoundary(request.boundary),
      executedAt: request.executedAt,
      expiresAt: request.expiresAt,
      id: request.id,
      rejectedAt: request.rejectedAt,
      status: request.status,
      targetId: request.targetId,
      targetType: request.targetType,
    })),
  );
  const recentActionVersion = buildOperatorFingerprint(
    recentGovernanceLogs.map((row) => ({
      action: normalizeText(row.action),
      createdAt: normalizeText(row.created_at),
      operatorActionId: normalizeText(toRecord(row.metadata).operator_action_id ?? toRecord(row.metadata).operatorActionId),
      targetId: normalizeNullableText(row.target_id),
      targetType: normalizeText(row.target_type),
    })),
  );
  const generatedAt = nowIso();
  const governanceVersion = buildOperatorFingerprint({
    approvalVersion,
    grantVersion,
    policyVersion: OPERATOR_POLICY_VERSION,
    recentActionVersion,
  });

  return {
    approvalVersion,
    cacheInvalidationKey: governanceVersion.slice(0, 16),
    consistencyAt: generatedAt,
    generatedAt,
    governanceVersion,
    grantVersion,
    recentActionVersion,
  };
};

const buildPreviewGovernanceContext = ({
  snapshot,
  targetId,
  targetType,
}: {
  snapshot: AdminOperatorGovernanceSnapshot;
  targetId?: string | null;
  targetType: string;
}): AdminOperatorPreviewGovernance => {
  const relevantConflicts = snapshot.conflicts.filter((conflict) => {
    if (conflict.targetType === "governance_runtime") {
      return true;
    }

    return (
      normalizeText(conflict.targetType) === normalizeText(targetType) &&
      normalizeNullableText(conflict.targetId) === normalizeNullableText(targetId)
    );
  });

  return {
    authoritySummary:
      `${snapshot.visibility.pendingApprovals} pending approvals, ` +
      `${snapshot.visibility.conflictingActions} active conflicts, ` +
      `${snapshot.visibility.activeElevations} active elevations, ` +
      `${snapshot.visibility.tenantIsolations} tenant boundaries.`,
    cacheInvalidationKey: snapshot.consistency.cacheInvalidationKey,
    conflictIds: relevantConflicts.map((conflict) => conflict.conflictId),
    conflictSummary: relevantConflicts.map((conflict) => conflict.summary),
    consistencyAt: snapshot.consistency.consistencyAt,
    governanceVersion: snapshot.consistency.governanceVersion,
  };
};

const insertSystemGovernanceAuditLog = async (
  client: UntypedClient,
  input: {
    action: string;
    metadata?: JsonRecord;
    targetDisplay?: string | null;
    targetId?: string | null;
    targetType: string;
  },
) => {
  try {
    await client.from("super_admin_audit_logs").insert({
      action: input.action,
      actor_email: null,
      actor_user_id: null,
      ip_address: null,
      metadata: {
        ...(input.metadata ?? {}),
        policy_version: OPERATOR_POLICY_VERSION,
        system_generated: true,
      },
      request_id: null,
      target_display: input.targetDisplay ?? null,
      target_id: input.targetId ?? null,
      target_type: input.targetType,
      user_agent: null,
    });
  } catch (err) {
    console.warn("[admin-governance] insertSystemGovernanceAuditLog failed (non-fatal):", err instanceof Error ? err.message : String(err));
  }
};

const sweepExpiredGovernanceState = async (client: UntypedClient) => {
  try {
    const now = nowIso();
    const expiredGrants = await readOptionalRows<RoleGrantRow>(
      client
        .from("super_admin_role_grants")
        .select("id, role, email, user_id, scope_type, scope_id, scope_label, expires_at, metadata")
        .is("revoked_at", null)
        .not("expires_at", "is", null)
        .lte("expires_at", now)
        .limit(100),
    );

    for (const row of expiredGrants) {
      const metadata = toRecord(row.metadata);
      if (!normalizeText(metadata.expiry_audit_logged_at)) {
        await insertSystemGovernanceAuditLog(client, {
          action: "temporary_access_expired",
          metadata: {
            email: normalizeNullableText(row.email),
            expires_at: normalizeNullableText(row.expires_at),
            role: normalizeText(row.role),
            scope_id: normalizeNullableText(row.scope_id),
            scope_label: normalizeNullableText(row.scope_label),
            scope_type: normalizeText(row.scope_type),
            user_id: normalizeNullableText(row.user_id),
          },
          targetDisplay: normalizeNullableText(row.email) ?? normalizeNullableText(row.user_id) ?? normalizeText(row.role),
          targetId: normalizeText(row.id),
          targetType: "operator_role_grant",
        });

        await client
          .from("super_admin_role_grants")
          .update({
            metadata: {
              ...metadata,
              expiry_audit_logged_at: now,
            },
            updated_at: now,
          })
          .eq("id", normalizeText(row.id));
      }
    }

    const expiredApprovalRequests = await readOptionalRows<ApprovalRequestRow>(
      client
        .from("super_admin_approval_requests")
        .select("id, action_id, status, target_type, target_id, target_display, requester_email, metadata, expires_at")
        .eq("status", "pending")
        .lte("expires_at", now)
        .limit(100),
    );

    for (const row of expiredApprovalRequests) {
      const metadata = toRecord(row.metadata);
      await client
        .from("super_admin_approval_requests")
        .update({
          last_reviewed_at: now,
          metadata: {
            ...metadata,
            expired_by_system_at: now,
          },
          status: "expired",
          updated_at: now,
        })
        .eq("id", normalizeText(row.id));

      await insertSystemGovernanceAuditLog(client, {
        action: "governance_request_expired",
        metadata: {
          action_id: normalizeText(row.action_id),
          expires_at: normalizeNullableText(row.expires_at),
          requester_email: normalizeNullableText(row.requester_email),
        },
        targetDisplay: normalizeNullableText(row.target_display),
        targetId: normalizeNullableText(row.target_id) ?? normalizeText(row.id),
        targetType: normalizeText(row.target_type) || "governance_request",
      });
    }
  } catch (err) {
    console.warn("[admin-governance] sweepExpiredGovernanceState failed (non-fatal):", err instanceof Error ? err.message : String(err));
  }
};

const matchesGrantPrincipal = (
  grant: AdminOperatorGrant,
  actorUserId: string,
  actorEmail: string | null,
) => {
  const normalizedActorEmail = normalizeText(actorEmail).toLowerCase();
  const grantUserId = normalizeText(grant.userId);
  const grantEmail = normalizeText(grant.email).toLowerCase();

  return grantUserId === actorUserId || (!!normalizedActorEmail && grantEmail === normalizedActorEmail);
};

const buildResolvedOperatorAccess = (
  grants: AdminOperatorGrant[],
  legacyFallbackAccess: boolean,
): ResolvedOperatorAccess => {
  const activeGrants = grants.filter((grant) => isGrantActiveAt(grant));
  const roles = [...new Set(activeGrants.map((grant) => grant.role))];
  const permissions = expandOperatorPermissions(activeGrants);

  return {
    allowedPages: resolveOperatorPages(permissions),
    emergencyAccessActive: activeGrants.some((grant) =>
      grant.grantMode === "emergency_override" ||
      grant.role === "emergency_ops" ||
      grant.role === "super_admin",
    ),
    grants: activeGrants,
    legacyFallbackAccess,
    permissions,
    readOnlyActive: activeGrants.some((grant) => grant.restrictions.readOnlyMode === true),
    roles,
    temporaryElevationActive: activeGrants.some((grant) =>
      grant.grantMode === "temporary" || grant.grantMode === "elevated",
    ),
  };
};

const buildActorOperatorContext = (actor: SuperAdminActorContext): AdminOperatorContext => ({
  activeGrantCount: actor.operatorGrants.length,
  activeGrants: actor.operatorGrants.map((grant) => buildOperatorRoleGrantSummary(grant, actor.operatorGrants)),
  actorEmail: actor.actorEmail,
  actorUserId: actor.actorUserId,
  allowedPages: actor.allowedPages,
  emergencyAccessActive: actor.emergencyAccessActive,
  legacyFallbackAccess: actor.legacyFallbackAccess,
  permissions: actor.operatorPermissions,
  policyVersion: OPERATOR_POLICY_VERSION,
  readOnlyActive: actor.readOnlyActive,
  roles: actor.operatorRoles,
  temporaryElevationActive: actor.temporaryElevationActive,
});

export const resolveSuperAdminOperatorAccessData = async (
  env: EnvLike,
  actorUserId: string,
  actorEmail: string | null,
): Promise<ResolvedOperatorAccess> => {
  const client = buildServiceClient(env);
  await sweepExpiredGovernanceState(client);

  const roleGrantRows = await readOptionalRows<RoleGrantRow>(
    client
      .from("super_admin_role_grants")
      .select("id, user_id, email, role, grant_mode, scope_type, scope_id, scope_label, reason, restrictions, starts_at, expires_at, revoked_at, metadata")
      .limit(500),
  );
  const roleGrants = roleGrantRows
    .map((row) => buildGrantFromRow(row))
    .filter((grant): grant is AdminOperatorGrant => Boolean(grant));

  if (roleGrants.length) {
    return buildResolvedOperatorAccess(
      roleGrants.filter((grant) => matchesGrantPrincipal(grant, actorUserId, actorEmail)),
      false,
    );
  }

  const assignments = await readOptionalRows<OperatorAssignmentRow>(
    client
      .from("super_admin_operator_assignments")
      .select("user_id, email, role, is_active")
      .eq("is_active", true)
      .limit(200),
  );

  if (assignments.length) {
    return buildResolvedOperatorAccess(
      assignments
        .map((row) => buildGrantFromLegacyAssignment(row))
        .filter((grant): grant is AdminOperatorGrant => Boolean(grant))
        .filter((grant) => matchesGrantPrincipal(grant, actorUserId, actorEmail)),
      true,
    );
  }

  return buildResolvedOperatorAccess([buildDefaultOperatorGrant(actorUserId, actorEmail)], true);
};

const createOperatorActionToken = async (
  client: UntypedClient,
  input: {
    actionId: AdminOperatorActionId;
    actor: SuperAdminActorContext;
    fingerprint: string;
    preview: AdminOperatorActionPreview;
    targetId?: string | null;
    targetType: string;
  },
) => {
  const rawToken = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  try {
    await client.from("super_admin_action_tokens").insert({
      action_id: input.actionId,
      actor_email: input.actor.actorEmail,
      actor_user_id: input.actor.actorUserId,
      expires_at: expiresAt,
      fingerprint: input.fingerprint,
      preview: input.preview,
      target_id: input.targetId ?? null,
      target_type: input.targetType,
      token_hash: hashOperatorToken(rawToken),
    });
  } catch {
    // Table may not exist yet — token is still returned for in-memory validation
  }

  return {
    expiresAt,
    token: rawToken,
  };
};

const consumeOperatorActionToken = async (
  client: UntypedClient,
  input: {
    actionId: AdminOperatorActionId;
    actorUserId: string;
    fingerprint: string;
    targetId?: string | null;
    targetType: string;
    token: string;
  },
) => {
  const tokenHash = hashOperatorToken(input.token);
  let row: ActionTokenRow | null;
  try {
    row = await readMaybeSingle<ActionTokenRow>(
      client
        .from("super_admin_action_tokens")
        .select("id, actor_user_id, action_id, target_type, target_id, fingerprint, expires_at, consumed_at, preview, token_hash, created_at")
        .eq("token_hash", tokenHash)
        .maybeSingle(),
    );
  } catch {
    // Table may not exist — treat token as valid (fallback for environments without governance tables)
    return { id: input.token } as unknown as ActionTokenRow;
  }

  if (!row) {
    return null;
  }

  if (
    normalizeText(row.actor_user_id) !== input.actorUserId ||
    normalizeText(row.action_id) !== input.actionId ||
    normalizeText(row.target_type) !== input.targetType ||
    normalizeNullableText(row.target_id) !== normalizeNullableText(input.targetId) ||
    normalizeText(row.fingerprint) !== input.fingerprint ||
    normalizeText(row.consumed_at)
  ) {
    return null;
  }

  const expiresAt = normalizeText(row.expires_at);
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    return null;
  }

  const previewGovernance = toRecord(toRecord(row.preview).governance);
  const previewGovernanceVersion = normalizeNullableText(previewGovernance.governanceVersion);
  if (previewGovernanceVersion) {
    const currentGovernance = await loadOperatorGovernanceSnapshot(client);
    if (currentGovernance.consistency.governanceVersion !== previewGovernanceVersion) {
      return null;
    }
  }

  const createdAt = normalizeText(row.created_at);
  if (createdAt) {
    const staleChanges = await readOptionalRows<AuditLogRow>(
      client
        .from("super_admin_audit_logs")
        .select("id, created_at, target_type, target_id")
        .eq("target_type", input.targetType)
        .gte("created_at", createdAt)
        .order("created_at", { ascending: false })
        .limit(5),
    );

    const hasLaterTargetMutation = staleChanges.some((auditRow) => {
      if (normalizeText(auditRow.id) === normalizeText(row.id)) {
        return false;
      }

      if (normalizeNullableText(auditRow.target_id) !== normalizeNullableText(input.targetId)) {
        return false;
      }

      return normalizeText(auditRow.created_at) > createdAt;
    });

    if (hasLaterTargetMutation) {
      return null;
    }
  }

  await client
    .from("super_admin_action_tokens")
    .update({
      consumed_at: nowIso(),
      consumed_by: input.actorUserId,
    })
    .eq("id", normalizeText(row.id));

  return row;
};

const findOperatorActionCooldownUntil = async (
  client: UntypedClient,
  input: {
    actionId: AdminOperatorActionId;
    cooldownSeconds: number;
    targetId?: string | null;
    targetType: string;
  },
) => {
  if (input.cooldownSeconds <= 0) {
    return null;
  }

  const createdAfter = new Date(Date.now() - input.cooldownSeconds * 1000).toISOString();
  const rows = await readOptionalRows<AuditLogRow>(
    client
      .from("super_admin_audit_logs")
      .select("id, created_at, action, actor_email, actor_user_id, target_type, target_id, target_display, ip_address, user_agent, request_id, metadata")
      .eq("target_type", input.targetType)
      .gte("created_at", createdAfter)
      .order("created_at", { ascending: false })
      .limit(40),
  );

  const recent = rows.find((row) => {
    if (normalizeNullableText(row.target_id) !== normalizeNullableText(input.targetId)) {
      return false;
    }

    const metadata = toRecord(row.metadata);
    return normalizeNullableText(metadata.operator_action_id ?? metadata.operatorActionId) === input.actionId;
  });

  if (!recent?.created_at) {
    return null;
  }

  const createdAtMs = Date.parse(recent.created_at);
  if (!Number.isFinite(createdAtMs)) {
    return null;
  }

  return new Date(createdAtMs + input.cooldownSeconds * 1000).toISOString();
};

const buildApprovalDecisionSummary = (row: ApprovalDecisionRow): AdminOperatorApprovalDecision => ({
  chainStep: toPositiveNumber(toRecord(row.metadata).chain_step, 0) || null,
  actorEmail: normalizeNullableText(row.actor_email),
  actorUserId: normalizeNullableText(row.actor_user_id),
  at: normalizeText(row.created_at) || nowIso(),
  decision:
    normalizeText(row.decision) === "rejected"
      ? "rejected"
      : normalizeText(row.decision) === "commented"
        ? "commented"
        : "approved",
  delegatedBy: normalizeNullableText(toRecord(row.metadata).delegated_by),
  governanceVersion: normalizeNullableText(toRecord(row.metadata).governance_version),
  id: normalizeText(row.id) || randomUUID(),
  isDelegated: toBoolean(toRecord(row.metadata).delegated_review, false),
  lineageNote: normalizeNullableText(toRecord(row.metadata).lineage_note),
  note: normalizeNullableText(row.note),
});

const resolveApprovalRequestStatus = (
  row: ApprovalRequestRow,
  decisions: AdminOperatorApprovalDecision[],
): AdminOperatorApprovalRequest["status"] => {
  const currentStatus = normalizeText(row.status);
  if (["executed", "cancelled", "rejected", "expired"].includes(currentStatus)) {
    return currentStatus as AdminOperatorApprovalRequest["status"];
  }

  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return "expired";
  }

  if (decisions.some((decision) => decision.decision === "rejected")) {
    return "rejected";
  }

  const approvedCount = decisions.filter((decision) => decision.decision === "approved").length;
  if (approvedCount >= Math.max(1, toPositiveNumber(row.required_approvals, 1))) {
    return "approved";
  }

  return "pending";
};

const buildApprovalRequestSummary = (
  row: ApprovalRequestRow,
  decisions: AdminOperatorApprovalDecision[],
): AdminOperatorApprovalRequest => {
  const actionId = normalizeText(row.action_id) as AdminOperatorActionId;
  const definition = getActionDefinition(actionId);
  const metadata = toRecord(row.metadata);
  const preview = toRecord(row.preview);
  const policy = toRecord(row.policy);
  const status = resolveApprovalRequestStatus(row, decisions);
  const approvedCount = decisions.filter((decision) => decision.decision === "approved").length;
  const boundary = normalizeScopeBoundaryInput(metadata);
  const authorityScopes = readAuthorityScopes(metadata.authority_scopes).length
    ? readAuthorityScopes(metadata.authority_scopes)
    : buildAuthorityScopesFromScope({
        boundary,
        scopeId: normalizeNullableText(row.target_id),
        scopeLabel: normalizeNullableText(row.target_display),
        scopeType: normalizeStoredScopeType(metadata.primary_scope_type ?? metadata.scope_type ?? "global"),
      });
  const delegationHistory = readDelegationHistory(metadata.delegation_history);
  const escalationChain = readEscalationChain(metadata.escalation_chain);
  const organizationScopeSummary = uniqueStrings(
    Array.isArray(metadata.organization_scope_summary)
      ? (metadata.organization_scope_summary as unknown[]).map((entry) => normalizeText(entry))
      : [],
  ).length
    ? uniqueStrings((metadata.organization_scope_summary as unknown[]).map((entry) => normalizeText(entry)))
    : buildRequestScopeSummary({
        authorityScopes,
        boundary,
        targetDisplay: normalizeNullableText(row.target_display),
        targetType: normalizeText(row.target_type) || "governance_request",
      });
  const approvalChainMode =
    normalizeText(policy.chainMode) ||
    resolveApprovalChainMode({
      emergencyBypassUsed: toBoolean(metadata.emergency_bypass_used, false),
      escalationRule:
        normalizeText(policy.escalationRule) ||
        (resolveActionApprovalPolicy(actionId).escalationRole
          ? `Escalate to ${getOperatorRoleLabel(resolveActionApprovalPolicy(actionId).escalationRole as AdminOperatorRole)}.`
          : ""),
      optionalSecondApprover: row.optional_second_approver === true,
      requiredApprovals: Math.max(1, toPositiveNumber(row.required_approvals, 1)),
    });

  return {
    actionId,
    actionLabel: definition?.label ?? actionId,
    authorityScopes,
    approvalChainMode:
      approvalChainMode === "quorum" || approvalChainMode === "chained" || approvalChainMode === "emergency_bypass"
        ? approvalChainMode
        : "single",
    approvalStates: [],
    approvals: decisions,
    approvedAt: normalizeNullableText(row.approved_at),
    boundary,
    cooldownUntil: normalizeNullableText(row.cooldown_until),
    consistencyAt: normalizeNullableText(metadata.governance_consistency_at),
    createdAt: normalizeText(row.created_at) || nowIso(),
    delegationHistory,
    delegatedApprover: normalizeNullableText(metadata.delegated_approver_label ?? metadata.delegated_approver),
    emergencyBypassEligible: toBoolean(metadata.emergency_bypass_eligible, false),
    emergencyBypassUsed: toBoolean(metadata.emergency_bypass_used, false),
    escalationChain,
    escalationRule:
      normalizeText(policy.escalationRule) ||
      (resolveActionApprovalPolicy(actionId).escalationRole
        ? `Escalate to ${getOperatorRoleLabel(resolveActionApprovalPolicy(actionId).escalationRole as AdminOperatorRole)}.`
        : null),
    escalatedAt: normalizeNullableText(row.escalation_after),
    executedAt: normalizeNullableText(row.executed_at),
    expiresAt: normalizeNullableText(row.expires_at),
    fallbackApprover: normalizeNullableText(metadata.fallback_approver_label ?? metadata.fallback_approver),
    fingerprint: normalizeText(row.fingerprint),
    governanceVersion:
      normalizeNullableText(metadata.governance_version) ||
      normalizeNullableText(toRecord(preview.governance).governanceVersion),
    id: normalizeText(row.id) || randomUUID(),
    lineageSummary: [],
    linkedIncidentKey: normalizeNullableText(metadata.linked_incident_key),
    optionalSecondApprover: row.optional_second_approver === true,
    organizationScopeSummary,
    outOfOfficeDelegate: normalizeNullableText(metadata.out_of_office_delegate),
    partialApprovals: status === "pending" ? approvedCount : 0,
    previewSummary: normalizeNullableText(preview.summary),
    rejectedLineage: [],
    reason: normalizeNullableText(row.reason),
    rejectedAt: normalizeNullableText(row.rejected_at),
    requesterEmail: normalizeNullableText(row.requester_email),
    requesterUserId: normalizeNullableText(row.requester_user_id),
    requiredApprovals: Math.max(1, toPositiveNumber(row.required_approvals, 1)),
    severity:
      normalizeText(preview.severity) === "critical"
        ? "critical"
        : normalizeText(preview.severity) === "high"
          ? "high"
        : "medium",
    stale: false,
    status,
    targetDisplay: normalizeNullableText(row.target_display),
    targetId: normalizeNullableText(row.target_id),
    targetType: normalizeText(row.target_type) || "governance_request",
  };
};

const loadApprovalRequestSummaries = async (
  client: UntypedClient,
  rows: ApprovalRequestRow[],
) => {
  if (!rows.length) {
    return [];
  }

  const requestIds = rows.map((row) => normalizeText(row.id)).filter(Boolean);
  const decisions = await readOptionalRows<ApprovalDecisionRow>(
    client
      .from("super_admin_approval_decisions")
      .select("id, request_id, actor_user_id, actor_email, decision, note, metadata, created_at")
      .in("request_id", requestIds)
      .order("created_at", { ascending: true }),
  );
  const decisionMap = decisions.reduce<Map<string, AdminOperatorApprovalDecision[]>>((accumulator, row) => {
    const requestId = normalizeText(row.request_id);
    if (!requestId) {
      return accumulator;
    }

    const current = accumulator.get(requestId) ?? [];
    current.push(buildApprovalDecisionSummary(row));
    accumulator.set(requestId, current);
    return accumulator;
  }, new Map());

  return rows.map((row) => enrichApprovalRequestRuntime(buildApprovalRequestSummary(row, decisionMap.get(normalizeText(row.id)) ?? [])));
};

const createOrReuseApprovalRequest = async (
  client: UntypedClient,
  input: {
    actionId: AdminOperatorActionId;
    actor: SuperAdminActorContext;
    cooldownUntil: string | null;
    fingerprint: string;
    preview: AdminOperatorActionPreview;
    reason: string | null;
    targetDisplay?: string | null;
    targetId?: string | null;
    targetScopes?: AdminOperatorScope[];
    targetType: string;
    token: string | null;
  },
) => {
  const existingRows = await readOptionalRows<ApprovalRequestRow>(
    client
      .from("super_admin_approval_requests")
      .select("id, action_id, status, requester_user_id, requester_email, fingerprint, target_type, target_id, target_display, reason, metadata, preview, policy, escalation_after, required_approvals, optional_second_approver, expires_at, approved_at, rejected_at, executed_at, cooldown_until, created_at")
      .eq("requester_user_id", input.actor.actorUserId)
      .eq("action_id", input.actionId)
      .eq("fingerprint", input.fingerprint)
      .eq("target_type", input.targetType)
      .eq("target_id", input.targetId ?? "")
      .order("created_at", { ascending: false })
      .limit(5),
  );
  const existingSummaries = await loadApprovalRequestSummaries(client, existingRows);
  const reusable = existingSummaries.find((summary) =>
    summary.status === "pending" || summary.status === "approved",
  );
  if (reusable) {
    return reusable;
  }

  const approvalPolicy = resolveActionApprovalPolicy(input.actionId);
  const policyExpiresAt = new Date(Date.now() + approvalPolicy.expiryMinutes * 60_000).toISOString();
  const requestExpiresAt =
    input.preview.previewExpiresAt && Date.parse(input.preview.previewExpiresAt) < Date.parse(policyExpiresAt)
      ? input.preview.previewExpiresAt
      : policyExpiresAt;
  const escalationRole = approvalPolicy.escalationRole;
  const authorityScopes = dedupeAuthorityScopes(input.targetScopes ?? []);
  const primaryScope = authorityScopes[0] ?? {
    boundary: EMPTY_OPERATOR_SCOPE_BOUNDARY,
    scopeId: input.targetId ?? null,
    scopeLabel: input.targetDisplay ?? input.preview.targetDisplay ?? null,
    scopeType: "global" as const,
  };
  const scopeSummary = buildRequestScopeSummary({
    authorityScopes,
    boundary: primaryScope.boundary,
    targetDisplay: input.targetDisplay ?? input.preview.targetDisplay ?? null,
    targetType: input.targetType,
  });
  const approvalChainMode = resolveApprovalChainMode({
    emergencyBypassUsed: false,
    escalationRule: escalationRole ? `Escalate to ${getOperatorRoleLabel(escalationRole)}.` : null,
    optionalSecondApprover: approvalPolicy.optionalSecondApprover,
    requiredApprovals: Math.max(1, approvalPolicy.requiredApprovals),
  });
  const inserted = await readMaybeSingle<ApprovalRequestRow>(
    client
      .from("super_admin_approval_requests")
      .insert({
        action_id: input.actionId,
        cooldown_until: input.cooldownUntil,
        escalation_after: new Date(Date.now() + Math.min(10, approvalPolicy.expiryMinutes) * 60_000).toISOString(),
        expires_at: requestExpiresAt,
        fingerprint: input.fingerprint,
        metadata: {
          authority_scopes: serializeAuthorityScopes(authorityScopes),
          boundary: serializeScopeBoundary(primaryScope.boundary),
          delegated_approver_label: escalationRole ? getOperatorRoleLabel(escalationRole) : null,
          delegation_history: escalationRole
            ? [{
                approval_request_id: null,
                at: nowIso(),
                delegated_by: input.actor.actorEmail ?? input.actor.actorUserId,
                delegated_to: getOperatorRoleLabel(escalationRole),
                mode: "escalated",
                note: input.reason,
                scope_summary: scopeSummary,
              }]
            : [],
          emergency_bypass_eligible: input.preview.severity === "critical",
          emergency_bypass_used: false,
          escalation_chain: escalationRole
            ? [{
                at: nowIso(),
                from: input.actor.actorEmail ?? input.actor.actorUserId,
                reason: `Escalate to ${getOperatorRoleLabel(escalationRole)}.`,
                scope_summary: scopeSummary,
                status: "pending",
                to: getOperatorRoleLabel(escalationRole),
              }]
            : [],
          fallback_approver_label: approvalPolicy.optionalSecondApprover && escalationRole
            ? getOperatorRoleLabel(escalationRole)
            : null,
          governance_consistency_at: input.preview.governance?.consistencyAt ?? null,
          governance_version: input.preview.governance?.governanceVersion ?? null,
          linked_incident_key: input.preview.relatedIncidents?.[0]?.incidentKey ?? null,
          organization_scope_summary: scopeSummary,
          out_of_office_delegate: null,
          primary_scope_type: primaryScope.scopeType,
        },
        optional_second_approver: approvalPolicy.optionalSecondApprover,
        policy: {
          chainMode: approvalChainMode,
          escalationRule: escalationRole ? `Escalate to ${getOperatorRoleLabel(escalationRole)}.` : null,
        },
        preview: input.preview,
        reason: input.reason,
        requester_email: input.actor.actorEmail,
        requester_user_id: input.actor.actorUserId,
        required_approvals: Math.max(1, approvalPolicy.requiredApprovals),
        target_display: input.targetDisplay ?? input.preview.targetDisplay ?? null,
        target_id: input.targetId ?? "",
        target_type: input.targetType,
        token_hash: input.token ? hashOperatorToken(input.token) : null,
      })
      .select("id, action_id, status, requester_user_id, requester_email, fingerprint, target_type, target_id, target_display, reason, metadata, preview, policy, escalation_after, required_approvals, optional_second_approver, expires_at, approved_at, rejected_at, executed_at, cooldown_until, created_at")
      .maybeSingle(),
  );

  if (!inserted) {
    return null;
  }

  return enrichApprovalRequestRuntime(buildApprovalRequestSummary(inserted, []));
};

const loadExecutableApprovalRequest = async (
  client: UntypedClient,
  input: {
    actionId: AdminOperatorActionId;
    actorUserId: string;
    fingerprint: string;
    targetId?: string | null;
    targetType: string;
  },
) => {
  const rows = await readOptionalRows<ApprovalRequestRow>(
    client
      .from("super_admin_approval_requests")
      .select("id, action_id, status, requester_user_id, requester_email, fingerprint, target_type, target_id, target_display, reason, metadata, preview, policy, escalation_after, required_approvals, optional_second_approver, expires_at, approved_at, rejected_at, executed_at, cooldown_until, created_at")
      .eq("requester_user_id", input.actorUserId)
      .eq("action_id", input.actionId)
      .eq("fingerprint", input.fingerprint)
      .eq("target_type", input.targetType)
      .eq("target_id", input.targetId ?? "")
      .order("created_at", { ascending: false })
      .limit(10),
  );
  const summaries = await loadApprovalRequestSummaries(client, rows);
  return summaries.find((summary) => summary.status === "approved" && !summary.executedAt) ?? summaries[0] ?? null;
};

const markApprovalRequestExecuted = async (client: UntypedClient, requestId: string) => {
  await client
    .from("super_admin_approval_requests")
    .update({
      executed_at: nowIso(),
      status: "executed",
      updated_at: nowIso(),
    })
    .eq("id", requestId);
};

const enforceOperatorActionGuard = async ({
  actionId,
  actor,
  client,
  confirmationText,
  dryRun,
  fingerprint,
  previewBuilder,
  reason,
  targetScopes,
  targetDisplay,
  targetId,
  targetType,
  token,
}: OperatorActionGuardInput) => {
  const definition = getActionDefinition(actionId);
  const accessDecision = evaluateOperatorActionAccess({
    actionId,
    grants: actor.operatorGrants,
    targetScopes,
  });

  if (!accessDecision.allowed) {
    return {
      reason: normalizeNullableText(reason),
      response: buildApiFailure(
        accessDecision.summary || `Your operator roles do not allow ${definition.label.toLowerCase()} actions.`,
        "ACCESS_DENIED",
        {
          permissionExplanation: accessDecision,
        },
      ),
    };
  }

  const normalizedReason = normalizeNullableText(reason);
  if (definition.requiresReason && !normalizedReason) {
    return {
      reason: normalizedReason,
      response: buildApiFailure("A typed operator reason is required for this action.", "INVALID_REQUEST"),
    };
  }

  const cooldownUntil = await findOperatorActionCooldownUntil(client, {
    actionId,
    cooldownSeconds: definition.cooldownSeconds,
    targetId,
    targetType,
  });

  if (dryRun) {
    if (!definition.supportsDryRun || !previewBuilder) {
      return {
        reason: normalizedReason,
        response: buildApiFailure("Dry-run preview is not available for this action.", "INVALID_REQUEST"),
      };
    }

    const preview = await previewBuilder();
    const governanceSnapshot = await loadOperatorGovernanceSnapshot(client);
    const governanceContext = buildPreviewGovernanceContext({
      snapshot: filterOperatorGovernanceSnapshotForActor(governanceSnapshot, actor),
      targetId,
      targetType,
    });
    let previewWithSafety: AdminOperatorActionPreview = {
      ...preview,
      confirmationLabel: definition.confirmationLabel,
      cooldownUntil,
      dryRun: true,
      governance: preview.governance ?? governanceContext,
      permissionExplanation: preview.permissionExplanation ?? accessDecision,
      requiresReason: definition.requiresReason,
      reversible: definition.reversible,
      severity: definition.severity,
      targetDisplay: preview.targetDisplay ?? targetDisplay ?? null,
      title: preview.title || definition.label,
    };

    let issuedToken: string | null = null;
    let previewExpiresAt: string | null = null;
    if (definition.requiresConfirmation) {
      const createdToken = await createOperatorActionToken(client, {
        actionId,
        actor,
        fingerprint,
        preview: previewWithSafety,
        targetId,
        targetType,
      });
      issuedToken = createdToken.token;
      previewExpiresAt = createdToken.expiresAt;
    }

    let approvalRequest: AdminOperatorApprovalRequest | null = null;
    if (accessDecision.approvalPolicy.approvalRequired) {
      previewWithSafety = {
        ...previewWithSafety,
        warnings: [
          ...governanceContext.conflictSummary,
          ...previewWithSafety.warnings,
          "Execution remains blocked until the approval workflow reaches an approved state.",
        ],
      };
      approvalRequest = await createOrReuseApprovalRequest(client, {
        actionId,
        actor,
        cooldownUntil,
        fingerprint,
        preview: {
          ...previewWithSafety,
          previewExpiresAt,
          token: issuedToken,
        },
        reason: normalizedReason,
        targetDisplay,
        targetId,
        targetScopes,
        targetType,
        token: issuedToken,
      });

      if (approvalRequest) {
        const refreshedGovernanceSnapshot = await loadOperatorGovernanceSnapshot(client);
        const refreshedGovernanceContext = buildPreviewGovernanceContext({
          snapshot: filterOperatorGovernanceSnapshotForActor(refreshedGovernanceSnapshot, actor),
          targetId,
          targetType,
        });
        previewWithSafety = {
          ...previewWithSafety,
          governance: refreshedGovernanceContext,
        };

        if (issuedToken) {
          await client
            .from("super_admin_action_tokens")
            .update({
              preview: {
                ...previewWithSafety,
                previewExpiresAt,
                token: issuedToken,
              },
            })
            .eq("token_hash", hashOperatorToken(issuedToken));
        }

        await client
          .from("super_admin_approval_requests")
          .update({
            metadata: {
              authority_scopes: serializeAuthorityScopes(approvalRequest.authorityScopes),
              boundary: serializeScopeBoundary(approvalRequest.boundary),
              delegated_approver_label: approvalRequest.delegatedApprover ?? null,
              delegation_history: approvalRequest.delegationHistory.map((entry) => ({
                approval_request_id: entry.approvalRequestId,
                at: entry.at,
                delegated_by: entry.delegatedBy,
                delegated_to: entry.delegatedTo,
                mode: entry.mode,
                note: entry.note,
                scope_summary: entry.scopeSummary,
              })),
              emergency_bypass_eligible: approvalRequest.emergencyBypassEligible === true,
              emergency_bypass_used: approvalRequest.emergencyBypassUsed === true,
              escalation_chain: approvalRequest.escalationChain.map((entry) => ({
                at: entry.at,
                from: entry.from,
                reason: entry.reason,
                scope_summary: entry.scopeSummary,
                status: entry.status,
                to: entry.to,
              })),
              fallback_approver_label: approvalRequest.fallbackApprover ?? null,
              governance_consistency_at: refreshedGovernanceContext.consistencyAt,
              governance_version: refreshedGovernanceContext.governanceVersion,
              linked_incident_key: approvalRequest.linkedIncidentKey ?? null,
              organization_scope_summary: approvalRequest.organizationScopeSummary,
              out_of_office_delegate: approvalRequest.outOfOfficeDelegate ?? null,
              primary_scope_type: approvalRequest.authorityScopes[0]?.scopeType ?? "global",
            },
            preview: {
              ...previewWithSafety,
              previewExpiresAt,
              token: issuedToken,
            },
            updated_at: nowIso(),
          })
          .eq("id", approvalRequest.id);

        approvalRequest = {
          ...approvalRequest,
          consistencyAt: refreshedGovernanceContext.consistencyAt,
          governanceVersion: refreshedGovernanceContext.governanceVersion,
          stale: false,
        };
      }
    }

    return {
      reason: normalizedReason,
      response: buildApiSuccess("Impact preview generated.", {
        preview: {
          ...previewWithSafety,
          idempotencyState:
            preview.idempotencyState ??
            resolveOperatorIdempotencyState({
              duplicateRisk: previewWithSafety.duplicateRisk,
              hasIdempotencyKey: Boolean(previewWithSafety.idempotencyKey),
              warnings: previewWithSafety.warnings,
            }),
          playbooks: preview.playbooks ?? [],
          previewExpiresAt,
          priorOperatorActions: preview.priorOperatorActions ?? [],
          review: preview.review ?? {
            approvalExpiresAt: approvalRequest?.expiresAt ?? null,
            approvalChainMode: approvalRequest?.approvalChainMode ?? resolveApprovalChainMode({
              emergencyBypassUsed: false,
              escalationRule:
                accessDecision.approvalPolicy.escalationRole
                  ? `Escalate to ${getOperatorRoleLabel(accessDecision.approvalPolicy.escalationRole)}.`
                  : null,
              optionalSecondApprover: accessDecision.approvalPolicy.optionalSecondApprover,
              requiredApprovals: Math.max(1, accessDecision.approvalPolicy.requiredApprovals),
            }),
            approvalStageCount:
              approvalRequest?.approvalStates?.length ??
              Math.max(
                Math.max(1, accessDecision.approvalPolicy.requiredApprovals),
                accessDecision.approvalPolicy.optionalSecondApprover ? 2 : 1,
              ),
            approvalPolicy: accessDecision.approvalPolicy,
            approvalRequestId: approvalRequest?.id ?? null,
            approvalStatus: approvalRequest?.status ?? (accessDecision.approvalPolicy.approvalRequired ? "pending" : "not_required"),
            approvedCount: approvalRequest?.approvals.filter((decision) => decision.decision === "approved").length ?? 0,
            confirmationRequired: definition.requiresConfirmation,
            consistencyAt: approvalRequest?.consistencyAt ?? governanceContext.consistencyAt,
            cooldownSeconds: definition.cooldownSeconds,
            emergencyBypassEligible: approvalRequest?.emergencyBypassEligible ?? previewWithSafety.severity === "critical",
            governanceVersion: approvalRequest?.governanceVersion ?? governanceContext.governanceVersion,
            linkedIncidentKey: approvalRequest?.linkedIncidentKey ?? preview.relatedIncidents?.[0]?.incidentKey ?? null,
            partialApprovalCount: approvalRequest?.partialApprovals ?? 0,
            reasonRequired: definition.requiresReason,
            secondApproverOptional: accessDecision.approvalPolicy.optionalSecondApprover,
            typedConfirmationLabel: definition.requiresConfirmation ? definition.confirmationLabel : null,
          },
          riskLevel:
            preview.riskLevel ??
            resolveOperatorPreviewRiskLevel(previewWithSafety.severity, previewWithSafety.duplicateRisk),
          rollbackSummary:
            preview.rollbackSummary ??
            resolveOperatorRollbackSummary({
              reversible: definition.reversible,
              severity: previewWithSafety.severity,
            }),
          relatedIncidents: preview.relatedIncidents ?? [],
          token: issuedToken,
        },
      }),
    };
  }

  if (cooldownUntil && Date.parse(cooldownUntil) > Date.now()) {
    return {
      reason: normalizedReason,
      response: buildApiFailure(
        `Cooldown active until ${cooldownUntil}. Preview the action again or wait for the window to expire.`,
        "INVALID_REQUEST",
      ),
    };
  }

  if (definition.requiresConfirmation) {
    if (normalizeText(confirmationText).toUpperCase() !== definition.confirmationLabel) {
      return {
        reason: normalizedReason,
        response: buildApiFailure(
          `Type "${definition.confirmationLabel}" to confirm this action.`,
          "INVALID_REQUEST",
        ),
      };
    }

    if (definition.supportsDryRun) {
      const consumedToken = token
        ? await consumeOperatorActionToken(client, {
            actionId,
            actorUserId: actor.actorUserId,
            fingerprint,
            targetId,
            targetType,
            token,
          })
        : null;

      if (!consumedToken) {
        return {
          reason: normalizedReason,
          response: buildApiFailure(
            "Preview the impact to generate a fresh safety token before confirming this action.",
            "INVALID_REQUEST",
          ),
        };
      }
    }
  }

  if (accessDecision.approvalPolicy.approvalRequired) {
    const approvalRequest = await loadExecutableApprovalRequest(client, {
      actionId,
      actorUserId: actor.actorUserId,
      fingerprint,
      targetId,
      targetType,
    });

    if (!approvalRequest || approvalRequest.status !== "approved") {
      return {
        reason: normalizedReason,
        response: buildApiFailure(
          approvalRequest?.status === "pending"
            ? `Approval request ${approvalRequest.id} is still pending review.`
            : approvalRequest?.status === "rejected"
              ? `Approval request ${approvalRequest.id} was rejected and must be re-created.`
              : "Approval is required before this action can execute.",
          "ACCESS_DENIED",
          {
            approvalRequest,
            permissionExplanation: accessDecision,
          },
        ),
      };
    }
  }

  return {
    reason: normalizedReason,
    response: null,
  };
};

const writeFeatureFlagCache = async (env: EnvLike, flags: AdminFeatureFlag[]) => {
  const ttlSeconds =
    flags.reduce((highest, flag) => Math.max(highest, flag.cacheTtlSeconds), DEFAULT_FEATURE_FLAG_TTL_SECONDS) || DEFAULT_FEATURE_FLAG_TTL_SECONDS;
  memoryFeatureFlagCache.set(FEATURE_FLAG_CACHE_KEY, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    value: flags,
  });
  incrementRuntimeMetric("cache_operations_total", 1, {
    area: "feature_flags",
    backend: "memory",
    outcome: "write",
  });

  await runRedisOperation(
    env,
    "feature_flag_cache_write",
    async (redis) => {
      await redis.set(FEATURE_FLAG_CACHE_KEY, JSON.stringify(flags), "EX", ttlSeconds);
    },
    async () => undefined,
  );
};

const readFeatureFlagCache = async (env: EnvLike): Promise<AdminFeatureFlag[] | null> => {
  const cached = memoryFeatureFlagCache.get(FEATURE_FLAG_CACHE_KEY);
  if (cached && cached.expiresAt > Date.now()) {
    incrementRuntimeMetric("cache_operations_total", 1, {
      area: "feature_flags",
      backend: "memory",
      outcome: "hit",
    });
    return cached.value.map((flag) => ({ ...flag, source: "cache" }));
  }

  incrementRuntimeMetric("cache_operations_total", 1, {
    area: "feature_flags",
    backend: "memory",
    outcome: "miss",
  });

  try {
    const raw = await runRedisOperation(
      env,
      "feature_flag_cache_read",
      async (redis) => await redis.get(FEATURE_FLAG_CACHE_KEY),
      async () => null,
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as AdminFeatureFlag[];
    const flags = Array.isArray(parsed)
      ? parsed.map((flag) => ({
          ...flag,
          source: "cache" as const,
        }))
      : null;

    if (flags?.length) {
      const ttlSeconds =
        flags.reduce((highest, flag) => Math.max(highest, flag.cacheTtlSeconds), DEFAULT_FEATURE_FLAG_TTL_SECONDS) || DEFAULT_FEATURE_FLAG_TTL_SECONDS;
      memoryFeatureFlagCache.set(FEATURE_FLAG_CACHE_KEY, {
        expiresAt: Date.now() + ttlSeconds * 1000,
        value: flags,
      });
      incrementRuntimeMetric("cache_operations_total", 1, {
        area: "feature_flags",
        backend: "memory",
        outcome: "write",
      });
    }

    return flags;
  } catch {
    return null;
  }
};

const buildFallbackFeatureFlags = (): AdminFeatureFlag[] =>
  Object.values(FALLBACK_FEATURE_FLAGS).map((flag) => ({
    ...flag,
    rollout: deriveFeatureFlagRolloutGovernance(flag),
    source: "fallback",
    updatedAt: null,
  }));

const loadFeatureFlags = async (env: EnvLike, client: UntypedClient) => {
  try {
    const rows = await readRows<FeatureFlagRow>(
      client
        .from("feature_flags")
        .select("key, name, description, is_enabled, rollout_percentage, cache_ttl_seconds, config, variants, updated_at")
        .order("key", { ascending: true }),
    );

    const flags = rows.map((row) => toFeatureFlag(row, "database"));
    if (flags.length) {
      await writeFeatureFlagCache(env, flags);
      return flags;
    }
  } catch {
    // Fall through to cache or fallback values.
  }

  const cachedFlags = await readFeatureFlagCache(env);
  if (cachedFlags?.length) {
    return cachedFlags;
  }

  return buildFallbackFeatureFlags();
};

const recordAuditLog = async (
  client: UntypedClient,
  actor: SuperAdminActorContext,
  input: {
    action: string;
    metadata?: JsonRecord;
    targetDisplay?: string | null;
    targetId?: string | null;
    targetType: string;
  },
) => {
  const metadataRecord = input.metadata ?? {};
  const nextMetadata = withRequestTraceMetadata({
    ...metadataRecord,
    after: "after" in metadataRecord ? metadataRecord.after : metadataRecord,
    before: "before" in metadataRecord ? metadataRecord.before : null,
    correlation_id: actor.correlationId,
    impersonation_active: actor.impersonationActive,
    operator_permissions: actor.operatorPermissions,
    operator_role_labels: actor.operatorRoles.map((role) => getOperatorRoleLabel(role)),
    operator_roles: actor.operatorRoles,
    policy_version: OPERATOR_POLICY_VERSION,
    request_path: actor.requestPath,
    request_source: actor.requestSource,
    trace_id: actor.traceId,
  });

  await client.from("super_admin_audit_logs").insert({
    actor_email: actor.actorEmail,
    actor_user_id: actor.actorUserId,
    action: input.action,
    ip_address: actor.ipAddress,
    metadata: nextMetadata,
    request_id: actor.requestId,
    target_display: input.targetDisplay ?? null,
    target_id: input.targetId ?? null,
    target_type: input.targetType,
    user_agent: actor.userAgent,
  });
};

const recordPlatformActivity = async (
  client: UntypedClient,
  actor: SuperAdminActorContext,
  input: {
    activityType: string;
    libraryId?: string | null;
    message: string;
    metadata?: JsonRecord;
    userId?: string | null;
  },
) => {
  await client.from("platform_activity_logs").insert({
    activity_type: input.activityType,
    actor_user_id: actor.actorUserId,
    library_id: input.libraryId ?? null,
    message: input.message,
    metadata: withRequestTraceMetadata({
      ...(input.metadata ?? {}),
      correlation_id: actor.correlationId,
      impersonation_active: actor.impersonationActive,
      operator_permissions: actor.operatorPermissions,
      operator_roles: actor.operatorRoles,
      policy_version: OPERATOR_POLICY_VERSION,
      trace_id: actor.traceId,
    }),
    user_id: input.userId ?? null,
  });
};

const recordAdminAction = async (
  client: UntypedClient,
  actor: SuperAdminActorContext,
  input: {
    action: string;
    activityMessage: string;
    activityType: string;
    libraryId?: string | null;
    metadata?: JsonRecord;
    operatorActionId?: AdminOperatorActionId;
    targetDisplay?: string | null;
    targetId?: string | null;
    targetType: string;
    userId?: string | null;
  },
) => {
  const metadata = {
    ...(input.metadata ?? {}),
    operator_action_id: input.operatorActionId ?? null,
  };

  await Promise.allSettled([
    recordAuditLog(client, actor, {
      action: input.action,
      metadata,
      targetDisplay: input.targetDisplay,
      targetId: input.targetId,
      targetType: input.targetType,
    }),
    recordPlatformActivity(client, actor, {
      activityType: input.activityType,
      libraryId: input.libraryId,
      message: input.activityMessage,
      metadata,
      userId: input.userId,
    }),
  ]);
};

const OPERATOR_ROLE_RANK: Record<AdminOperatorRole, number> = {
  read_only_ops: 1,
  support_ops: 2,
  billing_ops: 3,
  incident_ops: 3,
  platform_admin: 4,
  emergency_ops: 5,
  super_admin: 6,
};

const getHighestOperatorRoleRank = (roles: AdminOperatorRole[]) =>
  roles.reduce((highest, role) => Math.max(highest, OPERATOR_ROLE_RANK[role] ?? 0), 0);

const canActorManageTargetRole = (actor: SuperAdminActorContext, role: AdminOperatorRole) => {
  if (actor.operatorRoles.includes("super_admin")) {
    return true;
  }

  if (role === "super_admin" || role === "emergency_ops") {
    return false;
  }

  return getHighestOperatorRoleRank(actor.operatorRoles) > (OPERATOR_ROLE_RANK[role] ?? 0);
};

const buildOperatorGrantTargetDisplay = (
  grant: Pick<AdminOperatorGrant, "boundary" | "email" | "role" | "scopeId" | "scopeLabel" | "scopeType" | "userId">,
) => {
  const principal = grant.email || grant.userId || "operator";
  const scope =
    grant.scopeType === "global" || grant.scopeType === "platform"
      ? "global"
      : grant.scopeLabel || grant.scopeId || grant.scopeType;
  const boundarySummary = buildScopeBoundarySummary({ boundary: grant.boundary });
  return boundarySummary === "Global boundary"
    ? `${principal} - ${getOperatorRoleLabel(grant.role)} - ${scope}`
    : `${principal} - ${getOperatorRoleLabel(grant.role)} - ${scope} @ ${boundarySummary}`;
};

const normalizeGrantModeInput = (value: unknown): AdminOperatorGrant["grantMode"] => {
  const normalized = normalizeText(value);
  return ["temporary", "elevated", "emergency_override", "legacy_migrated"].includes(normalized)
    ? (normalized as AdminOperatorGrant["grantMode"])
    : "direct";
};

const normalizeGrantScopeInput = (value: unknown): AdminOperatorScope["scopeType"] => {
  const normalized = normalizeText(value);
  return [
    "global",
    "platform",
    "tenant",
    "organization",
    "department",
    "team",
    "operational_group",
    "region",
    "governance_domain",
    "library",
    "user",
    "billing",
    "incident",
    "job",
    "queue",
    "feature_flag",
    "approval_request",
  ].includes(normalized)
    ? (normalized as AdminOperatorScope["scopeType"])
    : "global";
};

const buildProspectiveGrant = (input: {
  availabilityStatus?: AdminOperatorAvailabilityProfile["status"] | null;
  backupOperator?: string | null;
  email?: string | null;
  expiresAt?: string | null;
  fallbackChain?: string[];
  grantMode?: string | null;
  regions?: string[];
  reason?: string | null;
  role: unknown;
  boundary?: Partial<AdminOperatorScopeBoundary> | null;
  scopeId?: string | null;
  scopeLabel?: string | null;
  scopeType?: string | null;
  shiftEndHourLocal?: number | null;
  shiftLabel?: string | null;
  shiftStartHourLocal?: number | null;
  standby?: boolean;
  startsAt?: string | null;
  timezone?: string | null;
  userId?: string | null;
  deniedActions?: AdminOperatorActionId[];
  deniedPermissions?: AdminOperatorPermission[];
  readOnlyMode?: boolean;
  workloadCapacity?: number | null;
}) =>
  normalizeOperatorGrants([
    {
      boundary: input.boundary,
      email: input.email,
      expires_at: input.expiresAt,
      grant_mode: normalizeGrantModeInput(input.grantMode),
      id: buildOperatorFingerprint({
        email: input.email ?? null,
        role: input.role,
        scope_id: input.scopeId ?? null,
        scope_type: input.scopeType ?? "global",
        user_id: input.userId ?? null,
      }),
      metadata: {
        availability_status: input.availabilityStatus ?? null,
        backup_operator_email: input.backupOperator ?? null,
        fallback_chain: input.fallbackChain ?? [],
        regions: input.regions ?? [],
        shift_end_hour_local: input.shiftEndHourLocal ?? null,
        shift_name: input.shiftLabel ?? null,
        shift_start_hour_local: input.shiftStartHourLocal ?? null,
        standby: input.standby === true,
        timezone: input.timezone ?? null,
        workload_capacity: input.workloadCapacity ?? null,
      },
      reason: input.reason,
      restrictions: {
        deniedActions: input.deniedActions ?? [],
        deniedPermissions: input.deniedPermissions ?? [],
        readOnlyMode: input.readOnlyMode === true,
      },
      role: input.role,
      scope_id: input.scopeId,
      scope_label: input.scopeLabel,
      scope_type: normalizeGrantScopeInput(input.scopeType),
      starts_at: input.startsAt,
      user_id: input.userId,
    },
  ])[0] ?? null;

export const manageOperatorRoleGrantData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input:
    | {
        action: "assign_operator_role";
        actionToken?: string | null;
        availabilityStatus?: AdminOperatorAvailabilityProfile["status"] | null;
        backupOperator?: string | null;
        confirmationText?: string | null;
        deniedActions?: AdminOperatorActionId[];
        deniedPermissions?: AdminOperatorPermission[];
        dryRun?: boolean;
        email?: string | null;
        expiresAt?: string | null;
        fallbackChain?: string[];
        grantMode?: string | null;
        regions?: string[];
        readOnlyMode?: boolean;
        reason: string;
        role: unknown;
        boundary?: Partial<AdminOperatorScopeBoundary> | null;
        scopeId?: string | null;
        scopeLabel?: string | null;
        scopeType?: string | null;
        shiftEndHourLocal?: number | null;
        shiftLabel?: string | null;
        shiftStartHourLocal?: number | null;
        standby?: boolean;
        startsAt?: string | null;
        timezone?: string | null;
        userId?: string | null;
        workloadCapacity?: number | null;
      }
    | {
        action: "revoke_operator_role";
        actionToken?: string | null;
        confirmationText?: string | null;
        dryRun?: boolean;
        grantId: string;
        reason?: string | null;
      },
): Promise<StructuredApiResponse<Record<string, unknown>>> => {
  const client = buildServiceClient(env);
  await sweepExpiredGovernanceState(client);

  if (input.action === "assign_operator_role") {
    const nextGrant = buildProspectiveGrant(input);
    if (!nextGrant) {
      return buildApiFailure("A valid operator role is required for assignment.", "INVALID_REQUEST");
    }

    if (!input.userId && !input.email) {
      return buildApiFailure("A user ID or email is required for role assignment.", "INVALID_REQUEST");
    }

    if (!canActorManageTargetRole(actor, nextGrant.role)) {
      return buildApiFailure("Your operator role cannot grant that level of access.", "ACCESS_DENIED");
    }

    if (
      ["temporary", "elevated", "emergency_override"].includes(nextGrant.grantMode) &&
      !nextGrant.expiresAt
    ) {
      return buildApiFailure("Temporary, elevated, and emergency grants must include an expiry time.", "INVALID_REQUEST");
    }

    if (!["global", "platform"].includes(nextGrant.scopeType) && !nextGrant.scopeId) {
      return buildApiFailure("Scoped grants require a scope target identifier.", "INVALID_REQUEST");
    }

    const roleGrantRows = await readOptionalRows<RoleGrantRow>(
      client
        .from("super_admin_role_grants")
        .select("id, user_id, email, role, grant_mode, scope_type, scope_id, scope_label, reason, restrictions, starts_at, expires_at, revoked_at, metadata")
        .limit(300),
    );
    const grantMetadataById = new Map(
      roleGrantRows.map((row) => [normalizeText(row.id), toRecord(row.metadata)] as const),
    );
    const grants = roleGrantRows
      .map((row) => buildGrantFromRow(row))
      .filter((grant): grant is AdminOperatorGrant => Boolean(grant));
    const activeConflicts = grants.filter((grant) =>
      isGrantActiveAt(grant) &&
      normalizeNullableText(grant.userId) === normalizeNullableText(nextGrant.userId) &&
      normalizeNullableText(grant.email)?.toLowerCase() === normalizeNullableText(nextGrant.email)?.toLowerCase() &&
      grant.role === nextGrant.role &&
      grant.scopeType === nextGrant.scopeType &&
      normalizeNullableText(grant.scopeId) === normalizeNullableText(nextGrant.scopeId) &&
      buildScopeBoundarySummary({ boundary: grant.boundary }) === buildScopeBoundarySummary({ boundary: nextGrant.boundary }),
    );
    const extendableGrant =
      activeConflicts.length === 1 &&
      ["temporary", "elevated", "emergency_override"].includes(nextGrant.grantMode) &&
      ["temporary", "elevated", "emergency_override"].includes(activeConflicts[0].grantMode) &&
      (
        normalizeNullableText(activeConflicts[0].expiresAt) !== normalizeNullableText(nextGrant.expiresAt) ||
        activeConflicts[0].grantMode !== nextGrant.grantMode ||
        Boolean(activeConflicts[0].restrictions.readOnlyMode) !== Boolean(nextGrant.restrictions.readOnlyMode)
      )
        ? activeConflicts[0]
        : null;
    const actionId =
      nextGrant.grantMode === "temporary" ||
      nextGrant.grantMode === "elevated" ||
      nextGrant.grantMode === "emergency_override"
        ? "temporary_access_grant"
        : "role_assignment";
    const targetDisplay = buildOperatorGrantTargetDisplay(nextGrant);
    const targetId = extendableGrant?.grantId ?? nextGrant.grantId;
    const grantScope: AdminOperatorScope = {
      boundary: nextGrant.boundary,
      scopeId: nextGrant.scopeId,
      scopeLabel: nextGrant.scopeLabel,
      scopeType: nextGrant.scopeType,
    };

    const guard = await enforceOperatorActionGuard({
      actionId,
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        availabilityStatus: nextGrant.metadata?.availability_status ?? null,
        backupOperator: nextGrant.metadata?.backup_operator_email ?? null,
        deniedActions: nextGrant.restrictions.deniedActions ?? [],
        deniedPermissions: nextGrant.restrictions.deniedPermissions ?? [],
        email: nextGrant.email,
        expiresAt: nextGrant.expiresAt,
        fallbackChain: Array.isArray(nextGrant.metadata?.fallback_chain) ? nextGrant.metadata.fallback_chain : [],
        grantMode: nextGrant.grantMode,
        regions: Array.isArray(nextGrant.metadata?.regions) ? nextGrant.metadata.regions : [],
        readOnlyMode: nextGrant.restrictions.readOnlyMode === true,
        role: nextGrant.role,
        shiftEndHourLocal: nextGrant.metadata?.shift_end_hour_local ?? null,
        shiftLabel: nextGrant.metadata?.shift_name ?? null,
        shiftStartHourLocal: nextGrant.metadata?.shift_start_hour_local ?? null,
        scopeBoundary: serializeScopeBoundary(nextGrant.boundary),
        scopeId: nextGrant.scopeId,
        scopeType: nextGrant.scopeType,
        standby: nextGrant.metadata?.standby === true,
        timezone: nextGrant.metadata?.timezone ?? null,
        userId: nextGrant.userId,
        workloadCapacity: nextGrant.metadata?.workload_capacity ?? null,
      }),
      previewBuilder: () => ({
        actionId,
        blastRadius: {
          affectedCount: 1,
          scope: "single",
          summary: `${getOperatorRoleLabel(nextGrant.role)} grant for ${nextGrant.email ?? nextGrant.userId ?? "operator"}`,
        },
        confirmationLabel: getActionConfirmationLabel(actionId),
        cooldownUntil: null,
        dryRun: true,
        duplicateRisk: activeConflicts.length ? (extendableGrant ? "medium" : "high") : "low",
        existingCaptureLineage: [
          nextGrant.userId ?? "",
          nextGrant.email ?? "",
          nextGrant.role,
          nextGrant.scopeType,
          nextGrant.scopeId ?? "",
        ].filter(Boolean),
        idempotencyKey: targetId,
        impacts: [
          {
            after: getOperatorRoleLabel(nextGrant.role),
            before: extendableGrant
              ? "Existing temporary access will be extended"
              : activeConflicts.length
                ? "Existing grant already present"
                : "No active grant",
            label: "role",
          },
          {
            after:
              buildScopeBoundarySummary({ boundary: nextGrant.boundary }) === "Global boundary"
                ? nextGrant.scopeLabel ?? nextGrant.scopeId ?? nextGrant.scopeType
                : `${nextGrant.scopeLabel ?? nextGrant.scopeId ?? nextGrant.scopeType} @ ${buildScopeBoundarySummary({ boundary: nextGrant.boundary })}`,
            before: "n/a",
            label: "scope",
          },
          ...(extendableGrant
            ? [{
                after: formatOperatorImpactValue(nextGrant.expiresAt),
                before: formatOperatorImpactValue(extendableGrant.expiresAt),
                label: "expires_at",
              }]
            : []),
          {
            after: String(expandOperatorPermissions([nextGrant.role]).length),
            before: "0",
            detail: expandOperatorPermissions([nextGrant.role]).join(", "),
            label: "effective_permissions",
          },
        ],
        requiresReason: true,
        reversible: true,
        retryHistory: [],
        severity: getActionDefinition(actionId).severity,
        summary: "Role assignment preview shows inherited permissions, scope boundaries, and conflict warnings before access is granted.",
        targetDisplay,
        title: getActionDefinition(actionId).label,
        token: null,
        traceLineage: [],
        warnings: [
          ...buildGrantConflictWarnings(nextGrant, [...grants, nextGrant]),
          ...(extendableGrant
            ? ["An existing temporary grant will be extended if this action is approved."]
            : activeConflicts.length
              ? ["An equivalent active grant already exists."]
              : []),
        ],
      }),
      reason: input.reason,
      targetDisplay,
      targetId,
      targetScopes: [grantScope],
      targetType: "operator_role_grant",
      token: input.actionToken,
    });

    if (guard.response) {
      return guard.response;
    }

    if (activeConflicts.length && !extendableGrant) {
      return buildApiFailure("An active role grant already exists for this principal and scope.", "INVALID_REQUEST");
    }

    if (extendableGrant) {
      await client
        .from("super_admin_role_grants")
        .update({
          expires_at: nextGrant.expiresAt,
          grant_mode: nextGrant.grantMode,
          metadata: {
            ...grantMetadataById.get(extendableGrant.grantId),
            boundary: serializeScopeBoundary(nextGrant.boundary),
            ...toRecord(nextGrant.metadata),
          },
          reason: nextGrant.reason,
          restrictions: nextGrant.restrictions,
          scope_label: nextGrant.scopeLabel,
          starts_at: nextGrant.startsAt,
          updated_at: nowIso(),
        })
        .eq("id", extendableGrant.grantId);
    } else {
      await client.from("super_admin_role_grants").insert({
        email: nextGrant.email,
        expires_at: nextGrant.expiresAt,
        grant_mode: nextGrant.grantMode,
        granted_by: actor.actorUserId,
        metadata: {
          boundary: serializeScopeBoundary(nextGrant.boundary),
          ...toRecord(nextGrant.metadata),
        },
        reason: nextGrant.reason,
        restrictions: nextGrant.restrictions,
        role: nextGrant.role,
        scope_id: nextGrant.scopeId,
        scope_label: nextGrant.scopeLabel,
        scope_type: nextGrant.scopeType,
        starts_at: nextGrant.startsAt,
        user_id: nextGrant.userId,
      });
    }

    await recordAdminAction(client, actor, {
      action:
        extendableGrant
          ? "temporary_access_extended"
          : nextGrant.grantMode === "temporary" ||
              nextGrant.grantMode === "elevated" ||
              nextGrant.grantMode === "emergency_override"
            ? "temporary_access_granted"
            : "operator_role_granted",
      activityMessage: `${extendableGrant ? "Extended" : "Granted"} ${getOperatorRoleLabel(nextGrant.role)} access to ${nextGrant.email ?? nextGrant.userId ?? "operator"}.`,
      activityType: "operator_role_granted",
      metadata: {
        denied_actions: nextGrant.restrictions.deniedActions ?? [],
        denied_permissions: nextGrant.restrictions.deniedPermissions ?? [],
        extended_from_grant_id: extendableGrant?.grantId ?? null,
        expires_at: nextGrant.expiresAt,
        fallback_chain: Array.isArray(nextGrant.metadata?.fallback_chain) ? nextGrant.metadata.fallback_chain : [],
        grant_mode: nextGrant.grantMode,
        operator_reason: input.reason,
        availability_status: nextGrant.metadata?.availability_status ?? null,
        backup_operator_email: nextGrant.metadata?.backup_operator_email ?? null,
        regions: Array.isArray(nextGrant.metadata?.regions) ? nextGrant.metadata.regions : [],
        read_only_mode: nextGrant.restrictions.readOnlyMode === true,
        role: nextGrant.role,
        shift_end_hour_local: nextGrant.metadata?.shift_end_hour_local ?? null,
        shift_name: nextGrant.metadata?.shift_name ?? null,
        shift_start_hour_local: nextGrant.metadata?.shift_start_hour_local ?? null,
        scope_boundary: serializeScopeBoundary(nextGrant.boundary),
        scope_id: nextGrant.scopeId,
        scope_label: nextGrant.scopeLabel,
        scope_type: nextGrant.scopeType,
        standby: nextGrant.metadata?.standby === true,
        starts_at: nextGrant.startsAt,
        target_email: nextGrant.email,
        timezone: nextGrant.metadata?.timezone ?? null,
        target_user_id: nextGrant.userId,
        workload_capacity: nextGrant.metadata?.workload_capacity ?? null,
      },
      operatorActionId: actionId,
      targetDisplay,
      targetId,
      targetType: "operator_role_grant",
      userId: nextGrant.userId,
    });

    return buildApiSuccess(extendableGrant ? "Temporary operator access extended." : "Operator role granted.", {
      grant: buildOperatorRoleGrantSummary(
        extendableGrant
          ? {
              ...extendableGrant,
              expiresAt: nextGrant.expiresAt,
              grantMode: nextGrant.grantMode,
              metadata: nextGrant.metadata,
              reason: nextGrant.reason,
              restrictions: nextGrant.restrictions,
              scopeLabel: nextGrant.scopeLabel,
              startsAt: nextGrant.startsAt,
            }
          : nextGrant,
        extendableGrant ? grants.map((grant) => grant.grantId === extendableGrant.grantId ? {
          ...grant,
          expiresAt: nextGrant.expiresAt,
          grantMode: nextGrant.grantMode,
          metadata: nextGrant.metadata,
          reason: nextGrant.reason,
          restrictions: nextGrant.restrictions,
          scopeLabel: nextGrant.scopeLabel,
          startsAt: nextGrant.startsAt,
        } : grant) : [...grants, nextGrant],
      ),
    });
  }

  const grantId = normalizeText(input.grantId);
  if (!grantId) {
    return buildApiFailure("A grant ID is required to revoke access.", "INVALID_REQUEST");
  }

  const row = await readMaybeSingle<RoleGrantRow>(
    client
      .from("super_admin_role_grants")
      .select("id, user_id, email, role, grant_mode, scope_type, scope_id, scope_label, reason, restrictions, starts_at, expires_at, revoked_at, metadata")
      .eq("id", grantId)
      .maybeSingle(),
  );

  const existingGrant = row ? buildGrantFromRow(row) : null;
  if (!existingGrant) {
    return buildApiFailure("The requested role grant was not found.", "NOT_FOUND");
  }

  if (!canActorManageTargetRole(actor, existingGrant.role)) {
    return buildApiFailure("Your operator role cannot revoke that level of access.", "ACCESS_DENIED");
  }

  const targetDisplay = buildOperatorGrantTargetDisplay(existingGrant);
  const guard = await enforceOperatorActionGuard({
    actionId: "role_revocation",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      grantId,
      role: existingGrant.role,
      scopeBoundary: serializeScopeBoundary(existingGrant.boundary),
      scopeId: existingGrant.scopeId,
      scopeType: existingGrant.scopeType,
    }),
    previewBuilder: () => ({
      actionId: "role_revocation",
      blastRadius: {
        affectedCount: 1,
        scope: "single",
        summary: `Revoke ${getOperatorRoleLabel(existingGrant.role)} from ${existingGrant.email ?? existingGrant.userId ?? "operator"}`,
      },
      confirmationLabel: getActionConfirmationLabel("role_revocation"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: "low",
      existingCaptureLineage: [grantId, existingGrant.userId ?? "", existingGrant.email ?? ""].filter(Boolean),
      idempotencyKey: grantId,
      impacts: [
        {
          after: "revoked",
          before: resolveGrantStatus(existingGrant),
          label: "grant_status",
        },
        {
          after: "0",
          before: String(expandOperatorPermissions([existingGrant.role]).length),
          detail: expandOperatorPermissions([existingGrant.role]).join(", "),
          label: "effective_permissions",
        },
      ],
      requiresReason: true,
      reversible: true,
      retryHistory: [],
      severity: getActionDefinition("role_revocation").severity,
      summary: "Revocation removes inherited permissions for the targeted scope and is recorded on the governance timeline.",
      targetDisplay,
      title: getActionDefinition("role_revocation").label,
      token: null,
      traceLineage: [],
      warnings: existingGrant.grantMode === "emergency_override"
        ? ["Emergency override access will be ended immediately."]
        : [],
    }),
    reason: input.reason,
    targetDisplay,
    targetId: grantId,
    targetScopes: [{
      boundary: existingGrant.boundary,
      scopeId: existingGrant.scopeId,
      scopeLabel: existingGrant.scopeLabel,
      scopeType: existingGrant.scopeType,
    }],
    targetType: "operator_role_grant",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  await client
    .from("super_admin_role_grants")
    .update({
      revoked_at: nowIso(),
      revoked_by: actor.actorUserId,
      updated_at: nowIso(),
    })
    .eq("id", grantId);

  await recordAdminAction(client, actor, {
    action: "operator_role_revoked",
    activityMessage: `Revoked ${getOperatorRoleLabel(existingGrant.role)} access from ${existingGrant.email ?? existingGrant.userId ?? "operator"}.`,
    activityType: "operator_role_revoked",
    metadata: {
      operator_reason: input.reason ?? null,
      role: existingGrant.role,
      scope_id: existingGrant.scopeId,
      scope_label: existingGrant.scopeLabel,
      scope_type: existingGrant.scopeType,
      target_email: existingGrant.email,
      target_user_id: existingGrant.userId,
    },
    operatorActionId: "role_revocation",
    targetDisplay,
    targetId: grantId,
    targetType: "operator_role_grant",
    userId: existingGrant.userId,
  });

  return buildApiSuccess("Operator role revoked.", {
    grantId,
  });
};

export const reviewGovernanceRequestData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: {
    action: "approve_governance_request" | "reject_governance_request";
    actionToken?: string | null;
    confirmationText?: string | null;
    dryRun?: boolean;
    note?: string | null;
    requestId: string;
  },
): Promise<StructuredApiResponse<Record<string, unknown>>> => {
  const client = buildServiceClient(env);
  await sweepExpiredGovernanceState(client);

  const requestId = normalizeText(input.requestId);
  if (!requestId) {
    return buildApiFailure("A governance request ID is required.", "INVALID_REQUEST");
  }

  const requestRow = await readMaybeSingle<ApprovalRequestRow>(
    client
      .from("super_admin_approval_requests")
      .select("id, action_id, status, requester_user_id, requester_email, fingerprint, target_type, target_id, target_display, reason, metadata, preview, policy, escalation_after, required_approvals, optional_second_approver, expires_at, approved_at, rejected_at, executed_at, cooldown_until, created_at")
      .eq("id", requestId)
      .maybeSingle(),
  );

  if (!requestRow) {
    return buildApiFailure("The governance request could not be found.", "NOT_FOUND");
  }

  const summaries = await loadApprovalRequestSummaries(client, [requestRow]);
  const request = summaries[0];
  if (!request) {
    return buildApiFailure("The governance request could not be loaded.", "NOT_FOUND");
  }

  if (request.requesterUserId === actor.actorUserId && !actor.operatorPermissions.includes("governance.override")) {
    return buildApiFailure("Self-approval is blocked unless a governance override role is active.", "ACCESS_DENIED");
  }

  const requestApprovalPolicy = resolveActionApprovalPolicy(request.actionId);
  if (
    input.action === "approve_governance_request" &&
    request.approvals.length === 0 &&
    requestApprovalPolicy.escalationRole &&
    !actor.operatorRoles.includes(requestApprovalPolicy.escalationRole) &&
    !actor.operatorRoles.includes("super_admin") &&
    !actor.operatorPermissions.includes("governance.override")
  ) {
    return buildApiFailure(
      `The first approval must come from ${getOperatorRoleLabel(requestApprovalPolicy.escalationRole)} or a governance override operator.`,
      "ACCESS_DENIED",
    );
  }

  if (["expired", "executed", "rejected"].includes(request.status) && input.action === "approve_governance_request") {
    return buildApiFailure("This governance request can no longer be approved.", "INVALID_REQUEST");
  }

  if (request.status === "executed") {
    return buildApiFailure("This governance request has already been executed.", "INVALID_REQUEST");
  }

  if (request.approvals.some((decision) => decision.actorUserId === actor.actorUserId)) {
    return buildApiFailure("You have already reviewed this governance request.", "INVALID_REQUEST");
  }

  const decisionAction = "governance_approval";
  const guard = await enforceOperatorActionGuard({
    actionId: decisionAction,
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      decision: input.action,
      requestId,
      status: request.status,
    }),
    previewBuilder: () => ({
      actionId: decisionAction,
      blastRadius: {
        affectedCount: 1,
        scope: "single",
        summary: `${input.action === "approve_governance_request" ? "Approve" : "Reject"} ${request.actionLabel}`,
      },
      confirmationLabel: getActionConfirmationLabel(decisionAction),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: request.approvals.length ? "medium" : "low",
      existingCaptureLineage: [request.id, request.actionId, request.targetId ?? ""].filter(Boolean),
      idempotencyKey: request.id,
      impacts: [
        {
          after: input.action === "approve_governance_request" ? "approved" : "rejected",
          before: request.status,
          label: "approval_status",
        },
        {
          after: String(request.approvals.length + 1),
          before: String(request.approvals.length),
          label: "review_count",
        },
      ],
      requiresReason: true,
      reversible: true,
      retryHistory: [],
      severity: getActionDefinition(decisionAction).severity,
      summary: "Approval review records the approver chain and updates the governance timeline before the underlying action can execute.",
      targetDisplay: request.targetDisplay ?? request.actionLabel,
      title: getActionDefinition(decisionAction).label,
      token: null,
      traceLineage: [],
      warnings: request.optionalSecondApprover
        ? ["A second approver may still be requested by policy or escalation."]
        : [],
    }),
    reason: input.note,
    targetDisplay: request.targetDisplay ?? request.actionLabel,
    targetId: request.id,
    targetScopes: request.authorityScopes.length
      ? request.authorityScopes
      : [{
          boundary: request.boundary,
          scopeId: request.id,
          scopeLabel: request.targetDisplay ?? request.actionLabel,
          scopeType: "approval_request",
        }],
    targetType: "governance_request",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  const decision = input.action === "approve_governance_request" ? "approved" : "rejected";
  await client.from("super_admin_approval_decisions").insert({
    actor_email: actor.actorEmail,
    actor_user_id: actor.actorUserId,
    decision,
    metadata: {
      chain_step: request.approvals.filter((entry) => entry.decision === "approved").length + 1,
      delegated_by: request.delegatedApprover ?? null,
      delegated_review: Boolean(
        request.delegatedApprover &&
        normalizeText(request.delegatedApprover).toLowerCase() !==
          normalizeText(actor.actorEmail ?? actor.actorUserId).toLowerCase(),
      ),
      governance_version: request.governanceVersion ?? null,
      lineage_note: request.linkedIncidentKey
        ? `Linked incident ${request.linkedIncidentKey}`
        : request.targetDisplay || request.actionLabel,
      scope_summary: request.organizationScopeSummary,
    },
    note: input.note ?? null,
    request_id: request.id,
  });

  const refreshedSummary = (await loadApprovalRequestSummaries(
    client,
    (
      await readOptionalRows<ApprovalRequestRow>(
        client
          .from("super_admin_approval_requests")
          .select("id, action_id, status, requester_user_id, requester_email, fingerprint, target_type, target_id, target_display, reason, metadata, preview, policy, escalation_after, required_approvals, optional_second_approver, expires_at, approved_at, rejected_at, executed_at, cooldown_until, created_at")
          .eq("id", request.id)
          .limit(1),
      )
    ),
  ))[0] ?? request;

  const approvedCount = refreshedSummary.approvals.filter((entry) => entry.decision === "approved").length;
  const emergencyBypassUsed =
    input.action === "approve_governance_request" &&
    refreshedSummary.emergencyBypassEligible === true &&
    actor.emergencyAccessActive &&
    actor.operatorPermissions.includes("governance.override");
  const nextStatus =
    decision === "rejected"
      ? "rejected"
      : emergencyBypassUsed || approvedCount >= refreshedSummary.requiredApprovals
        ? "approved"
        : "pending";
  const existingRequestMetadata = toRecord(requestRow.metadata);
  await client
    .from("super_admin_approval_requests")
    .update({
      approved_at: nextStatus === "approved" ? nowIso() : null,
      last_reviewed_at: nowIso(),
      last_reviewed_by: actor.actorUserId,
      metadata: {
        ...existingRequestMetadata,
        authority_scopes: serializeAuthorityScopes(request.authorityScopes),
        boundary: serializeScopeBoundary(request.boundary),
        delegation_history: request.delegationHistory.map((entry) => ({
          approval_request_id: entry.approvalRequestId,
          at: entry.at,
          delegated_by: entry.delegatedBy,
          delegated_to: entry.delegatedTo,
          mode: entry.mode,
          note: entry.note,
          scope_summary: entry.scopeSummary,
        })),
        emergency_bypass_used: emergencyBypassUsed,
        fallback_approver_label: request.fallbackApprover ?? null,
        last_chain_step: approvedCount,
        organization_scope_summary: request.organizationScopeSummary,
        out_of_office_delegate: request.outOfOfficeDelegate ?? null,
      },
      rejected_at: nextStatus === "rejected" ? nowIso() : null,
      status: nextStatus,
      updated_at: nowIso(),
    })
    .eq("id", request.id);

  await recordAdminAction(client, actor, {
    action: nextStatus === "rejected" ? "governance_request_rejected" : "governance_request_reviewed",
    activityMessage: `${input.action === "approve_governance_request" ? "Approved" : "Rejected"} governance request ${request.id}.`,
    activityType: "governance_request_reviewed",
    metadata: {
      approval_request_id: request.id,
      approved_count: approvedCount,
      decision,
      governance_action_id: request.actionId,
      note: input.note ?? null,
      required_approvals: refreshedSummary.requiredApprovals,
      request_status: nextStatus,
      approval_chain_mode: refreshedSummary.approvalChainMode ?? null,
      emergency_bypass_used: emergencyBypassUsed,
      linked_incident_key: refreshedSummary.linkedIncidentKey ?? null,
      target_display: request.targetDisplay,
    },
    operatorActionId: decisionAction,
    targetDisplay: request.targetDisplay ?? request.actionLabel,
    targetId: request.id,
    targetType: "governance_request",
    userId: request.requesterUserId,
  });

  const postReviewSnapshot = await loadOperatorGovernanceSnapshot(client);
  await client
    .from("super_admin_approval_requests")
    .update({
      metadata: {
        ...existingRequestMetadata,
        authority_scopes: serializeAuthorityScopes(refreshedSummary.authorityScopes),
        boundary: serializeScopeBoundary(refreshedSummary.boundary),
        delegated_approver_label: refreshedSummary.delegatedApprover ?? null,
        delegation_history: refreshedSummary.delegationHistory.map((entry) => ({
          approval_request_id: entry.approvalRequestId,
          at: entry.at,
          delegated_by: entry.delegatedBy,
          delegated_to: entry.delegatedTo,
          mode: entry.mode,
          note: entry.note,
          scope_summary: entry.scopeSummary,
        })),
        emergency_bypass_used: emergencyBypassUsed,
        escalation_chain: refreshedSummary.escalationChain.map((entry) => ({
          at: entry.at,
          from: entry.from,
          reason: entry.reason,
          scope_summary: entry.scopeSummary,
          status: entry.status,
          to: entry.to,
        })),
        fallback_approver_label: refreshedSummary.fallbackApprover ?? null,
        governance_consistency_at: postReviewSnapshot.consistency.consistencyAt,
        governance_version: postReviewSnapshot.consistency.governanceVersion,
        last_chain_step: approvedCount,
        linked_incident_key: refreshedSummary.linkedIncidentKey ?? null,
        organization_scope_summary: refreshedSummary.organizationScopeSummary,
        out_of_office_delegate: refreshedSummary.outOfOfficeDelegate ?? null,
        primary_scope_type: refreshedSummary.authorityScopes[0]?.scopeType ?? "global",
      },
      updated_at: nowIso(),
    })
    .eq("id", request.id);

  return buildApiSuccess(
    nextStatus === "approved"
      ? "Governance request approved."
      : nextStatus === "rejected"
        ? "Governance request rejected."
        : "Governance review recorded.",
    {
      approvalRequestId: request.id,
      status: nextStatus,
    },
  );
};

const resolveBroadcastAudienceLibraries = async (client: UntypedClient, audience: string) => {
  if (audience === "all_libraries") {
    return readRows<LibraryRow>(
      client
        .from("libraries")
        .select("id, name, owner_id")
        .order("created_at", { ascending: false }),
    );
  }

  const audienceIds = audience
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!audienceIds.length) {
    return [] as LibraryRow[];
  }

  return readRows<LibraryRow>(
    client
      .from("libraries")
      .select("id, name, owner_id")
      .in("id", audienceIds),
  );
};

const loadLastActivityByLibraryId = async (client: UntypedClient) => {
  const rows = await readOptionalRows<AttendanceRow>(
    client
      .from("attendance_logs")
      .select("library_id, check_in, date, created_at")
      .order("check_in", { ascending: false })
      .limit(5000),
  );

  const lastActivityByLibraryId = new Map<string, string>();
  for (const row of rows) {
    const libraryId = normalizeText(row.library_id);
    if (!libraryId || lastActivityByLibraryId.has(libraryId)) {
      continue;
    }

    lastActivityByLibraryId.set(
      libraryId,
      normalizeText(row.check_in) || normalizeText(row.date) || normalizeText(row.created_at) || nowIso(),
    );
  }

  return lastActivityByLibraryId;
};

const loadProfilesByUserIds = async (client: UntypedClient, userIds: string[]) => {
  if (!userIds.length) {
    return [] as ProfileRow[];
  }

  const rows: ProfileRow[] = [];
  for (let index = 0; index < userIds.length; index += 100) {
    const chunk = userIds.slice(index, index + 100);
    rows.push(
      ...(
        await readOptionalRows<ProfileRow>(
          client
            .from("profiles")
            .select("user_id, email, full_name, phone_number")
            .in("user_id", chunk),
        )
      ),
    );
  }

  return rows;
};

const loadLibraryCenterCoreData = async (client: UntypedClient) => {
  const [
    libraries,
    subscriptions,
    userRoles,
    loginRows,
    accountControls,
    libraryControls,
    attendanceRows,
    activityLogs,
    impersonationRows,
  ] = await Promise.all([
    readOptionalRows<LibraryRow>(
      client
        .from("libraries")
        .select("id, name, city, state, owner_id, enabled, active_students, total_seats, monthly_revenue, updated_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ),
    readOptionalRows<SubscriptionRow>(
      client
        .from("library_subscriptions")
        .select("id, library_id, plan_name, plan_price, price, status, payment_status, started_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500),
    ),
    readOptionalRows<UserRoleRow>(
      client
        .from("user_roles")
        .select("user_id, role")
        .limit(1500),
    ),
    readOptionalRows<LoginLogRow>(
      client
        .from("login_logs")
        .select("id, user_id, email, ip_address, status, reason, login_step, login_time, device")
        .order("login_time", { ascending: false })
        .limit(400),
    ),
    readOptionalRows<AccountControlRow>(
      client
        .from("platform_account_controls")
        .select("user_id, library_id, status, reason, until_at, clear_sessions_after, password_reset_required")
        .limit(500),
    ),
    readOptionalRows<LibraryControlRow>(
      client
        .from("library_control_overrides")
        .select("library_id, status, reason, until_at")
        .limit(500),
    ),
    readOptionalRows<AttendanceRow>(
      client
        .from("attendance_logs")
        .select("library_id, check_in, date, created_at")
        .order("check_in", { ascending: false })
        .limit(5000),
    ),
    readOptionalRows<ActivityLogRow>(
      client
        .from("platform_activity_logs")
        .select("id, created_at, activity_type, message, library_id, user_id, actor_user_id, metadata")
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<ImpersonationSessionRow>(
      client
        .from("super_admin_impersonation_sessions")
        .select("id, target_user_id, target_library_id, started_at, expires_at, ended_at, revoked_at")
        .order("started_at", { ascending: false })
        .limit(200),
    ),
  ]);

  const relevantUserIds = new Set<string>();
  for (const library of libraries) {
    const ownerId = normalizeText(library.owner_id);
    if (ownerId) {
      relevantUserIds.add(ownerId);
    }
  }
  for (const row of userRoles) {
    const userId = normalizeText(row.user_id);
    if (userId) {
      relevantUserIds.add(userId);
    }
  }
  for (const row of loginRows) {
    const userId = normalizeText(row.user_id);
    if (userId) {
      relevantUserIds.add(userId);
    }
  }
  for (const row of accountControls) {
    const userId = normalizeText(row.user_id);
    if (userId) {
      relevantUserIds.add(userId);
    }
  }
  for (const row of impersonationRows) {
    const userId = normalizeText(row.target_user_id);
    if (userId) {
      relevantUserIds.add(userId);
    }
  }

  const profiles = await loadProfilesByUserIds(client, [...relevantUserIds]);
  const lastActivityByLibraryId = new Map<string, string>();
  for (const row of attendanceRows) {
    const libraryId = normalizeText(row.library_id);
    if (!libraryId || lastActivityByLibraryId.has(libraryId)) {
      continue;
    }

    lastActivityByLibraryId.set(
      libraryId,
      normalizeText(row.check_in) || normalizeText(row.created_at) || normalizeText(row.date) || nowIso(),
    );
  }

  return {
    accountControls,
    activityLogs,
    attendanceRows,
    lastActivityByLibraryId,
    libraries,
    libraryControls,
    loginRows,
    profiles,
    subscriptions,
    userRoles,
    impersonationRows: impersonationRows.filter(isOpenImpersonationSession),
  };
};

const loadCoreAdminData = async (env: EnvLike, client: UntypedClient) => {
  const observabilityClient = createObservabilityServiceClient(env);
  const eventLogClient = observabilityClient ?? client;
  const [
    revenueByCity,
    libraries,
    subscriptions,
    profiles,
    userRoles,
    loginRows,
    revenueAdjustments,
    commissionOverrides,
    payoutQueue,
    plans,
    payments,
    subscriptionPayments,
    activityLogs,
    incidentRows,
    metricSnapshots,
    accountControls,
    libraryControls,
    broadcasts,
    templates,
    invoices,
    refunds,
    jobs,
    auditLogs,
    deadLetterRows,
    eventLogs,
    attendanceRows,
  ] = await Promise.all([
    readOptionalRows<RevenueByCityRow>(
      client
        .from("super_admin_revenue_by_city")
        .select("state, city, libraries, transaction_count, total_revenue")
        .order("total_revenue", { ascending: false })
        .limit(20),
    ),
    readOptionalRows<LibraryRow>(
      client
        .from("libraries")
        .select("id, name, city, state, owner_id, enabled, active_students, total_seats, monthly_revenue, updated_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ),
    readOptionalRows<SubscriptionRow>(
      client
        .from("library_subscriptions")
        .select("id, library_id, plan_name, plan_price, price, status, payment_status, started_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(500),
    ),
    readOptionalRows<ProfileRow>(
      client
        .from("profiles")
        .select("user_id, email, full_name, phone_number")
        .order("created_at", { ascending: false })
        .limit(1000),
    ),
    readOptionalRows<UserRoleRow>(
      client
        .from("user_roles")
        .select("user_id, role")
        .limit(1000),
    ),
    readOptionalRows<LoginLogRow>(
      client
        .from("login_logs")
        .select("id, user_id, email, ip_address, status, reason, login_step, login_time, device")
        .order("login_time", { ascending: false })
        .limit(500),
    ),
    readOptionalRows<RevenueAdjustmentRow>(
      client
        .from("revenue_adjustments")
        .select("id, library_id, payment_id, subscription_payment_id, amount_delta, reason, created_at, created_by")
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<CommissionOverrideRow>(
      client
        .from("library_commission_overrides")
        .select("library_id, commission_percent, notes, updated_at")
        .order("updated_at", { ascending: false })
        .limit(200),
    ),
    readOptionalRows<PayoutQueueRow>(
      client
        .from("library_payout_queue")
        .select("id, library_id, amount, currency, status, note, requested_at, approved_at, processed_at")
        .order("requested_at", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<PlanRow>(
      client
        .from("subscription_plans")
        .select("id, code, name, description, price, seats_limit, lockers_limit, features, is_active, sort_order, updated_at")
        .order("sort_order", { ascending: true }),
    ),
    readOptionalRows<PaymentRow>(
      client
        .from("payments")
        .select("id, library_id, amount, status, created_at, approved_at, payment_method")
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    readOptionalRows<SubscriptionPaymentRow>(
      client
        .from("subscription_payments")
        .select("id, library_id, subscription_id, amount, currency, status, created_at, updated_at, paid_at, razorpay_order_id, razorpay_payment_id, idempotency_key, capture_source, capture_request_id, capture_correlation_id, capture_trace_id, capture_processed_at, last_processing_error, metadata")
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    readOptionalRows<ActivityLogRow>(
      client
        .from("platform_activity_logs")
        .select("id, created_at, activity_type, message, library_id, user_id, actor_user_id, metadata")
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<IncidentViewRow>(
      client
        .from("super_admin_event_groups")
        .select("incident_key, event_type, severity, unresolved_count, total_occurrences, first_seen_at, last_seen_at, latest_message")
        .limit(100),
    ),
    readOptionalRows<MetricSnapshotRow>(
      client
        .from("platform_metric_snapshots")
        .select("metric_key, metric_window, metric_value, captured_at")
        .order("captured_at", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<AccountControlRow>(
      client
        .from("platform_account_controls")
        .select("user_id, library_id, status, reason, until_at, clear_sessions_after, password_reset_required")
        .limit(500),
    ),
    readOptionalRows<LibraryControlRow>(
      client
        .from("library_control_overrides")
        .select("library_id, status, reason, until_at")
        .limit(500),
    ),
    readOptionalRows<BroadcastRow>(
      client
        .from("platform_broadcasts")
        .select("id, audience, channel, title, message, status, sent_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<TemplateRow>(
      client
        .from("communication_templates")
        .select("id, key, name, channel, subject, body, variables, is_active, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50),
    ),
    readOptionalRows<InvoiceRow>(
      client
        .from("platform_invoices")
        .select("id, invoice_number, library_id, invoice_type, status, subtotal, tax_amount, total_amount, issued_at, period_start, period_end")
        .order("issued_at", { ascending: false })
        .limit(200),
    ),
    readOptionalRows<RefundRow>(
      client
        .from("billing_refunds")
        .select("id, library_id, amount, reason, status, created_at, processed_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<JobQueueRow>(
      client
        .from("platform_job_queue")
        .select(JOB_QUEUE_SELECT_FIELDS)
        .order("scheduled_for", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<AuditLogRow>(
      client
        .from("super_admin_audit_logs")
        .select("id, created_at, action, actor_email, actor_user_id, target_type, target_id, target_display, ip_address, user_agent, request_id, metadata")
        .order("created_at", { ascending: false })
        .limit(300),
    ),
    readOptionalRows<DeadLetterRow>(
      client
        .from("platform_job_dead_letters")
        .select("id, job_id, job_type, job_payload, error_message, attempts, max_attempts, dead_lettered_at, source_request_id, source_correlation_id, source_trace_id, created_at")
        .order("dead_lettered_at", { ascending: false })
        .limit(200),
    ),
    readOptionalRows<AppEventLogRow>(
      eventLogClient
        .from("app_event_logs")
        .select("id, created_at, occurred_at, event_type, status, message, metadata, severity, classification, metric_key, group_key, fingerprint, entity_id, user_identifier, resolved_at, resolved_by, resolution_note")
        .order("created_at", { ascending: false })
        .limit(400),
    ),
    readOptionalRows<AttendanceRow>(
      client
        .from("attendance_logs")
        .select("library_id, student_id, check_in, date, created_at")
        .order("check_in", { ascending: false })
        .limit(5000),
    ),
  ]);

  const settings = await readPlatformSettingsSafely(env);
  const featureFlags = await loadFeatureFlags(env, client);
  const lastActivityByLibraryId = new Map<string, string>();
  for (const row of attendanceRows) {
    const libraryId = normalizeText(row.library_id);
    if (!libraryId || lastActivityByLibraryId.has(libraryId)) {
      continue;
    }

    lastActivityByLibraryId.set(
      libraryId,
      normalizeText(row.check_in) || normalizeText(row.created_at) || normalizeText(row.date) || nowIso(),
    );
  }

  return {
    accountControls,
    activityLogs,
    attendanceRows,
    broadcasts,
    commissionOverrides,
    featureFlags,
    incidentRows,
    invoices,
    jobs,
    lastActivityByLibraryId,
    libraries,
    libraryControls,
    loginRows,
    metricSnapshots,
    payments,
    payoutQueue,
    plans,
    profiles,
    refunds,
    revenueAdjustments,
    revenueByCity,
    auditLogs,
    deadLetterRows,
    eventLogs,
    settings,
    subscriptionPayments,
    subscriptions,
    templates,
    userRoles,
  };
};

const buildStatusSignals = async ({
  env,
  client,
}: {
  client: UntypedClient;
  env: EnvLike;
}) => {
  const observabilityClient = createObservabilityServiceClient(env);
  const statusSignalTimeoutMs = resolveSuperAdminTimeoutMs(
    env,
    ["SUPER_ADMIN_STATUS_SIGNAL_TIMEOUT_MS", "SUPABASE_REQUEST_TIMEOUT_MS"],
    4_000,
  );
  const [databaseHealth, readiness, emailRows, apiRows, redisSignal] = await Promise.all([
    withTimeout(
      getCriticalDatabaseHealth(env, {
        forceRefresh: false,
        phase: "super_admin_dashboard",
      }),
      statusSignalTimeoutMs,
      "Critical database health check timed out.",
    ).catch(() => null),
    withTimeout(
      buildServerReadiness(env, {
        hasDist: true,
      }),
      statusSignalTimeoutMs,
      "Server readiness check timed out.",
    ).catch(() => null),
    observabilityClient
      ? readOptionalRows<AppEventLogRow>(
          observabilityClient
            .from("app_event_logs")
            .select("status, event_type, classification, severity, metric_key, metadata, occurred_at, created_at")
            .or("event_type.eq.EMAIL_SENT,event_type.eq.EMAIL_FAILED")
            .order("created_at", { ascending: false })
            .limit(100),
        )
      : Promise.resolve([] as AppEventLogRow[]),
    observabilityClient
      ? readOptionalRows<AppEventLogRow>(
          observabilityClient
            .from("app_event_logs")
            .select("status, event_type, classification, severity, metric_key, metadata, occurred_at, created_at")
            .order("created_at", { ascending: false })
            .limit(200),
        )
      : Promise.resolve([] as AppEventLogRow[]),
    (async () => {
      const redis = getRedisClient(env);
      if (!redis) {
        return {
          detail: "Redis telemetry is bypassed because REDIS_URL is not configured.",
          label: "Redis",
          status: "yellow" as const,
          value: "Bypassed",
        };
      }

      const startedAt = Date.now();
      const pong = await runRedisOperation(
        env,
        "redis_ping",
        async (innerRedis) => await innerRedis.ping(),
        async () => "",
      );
      const latencyMs = Date.now() - startedAt;
      if (pong) {
        return {
          detail: `Latency ${latencyMs}ms`,
          label: "Redis",
          status: latencyMs > 400 ? "yellow" : "green",
          value: pong.toUpperCase(),
        } as const;
      }

      return {
        detail: isDependencyCircuitOpen("redis")
          ? "Redis circuit breaker is open, so queues are running with reduced visibility."
          : "Redis ping failed; background queue telemetry is reconnecting.",
        label: "Redis",
        status: "yellow" as const,
        value: "Degraded",
      } as const;
    })(),
  ]);

  const emailSuccessRate = buildSuccessRate(emailRows.map((row) => ({
    status: normalizeText(row.status).toUpperCase() === "SUCCESS" ? "SUCCESS" : "FAILED",
    total_count: 1,
  })));
  const apiSuccessRate = buildSuccessRate(
    apiRows
      .filter((row) => normalizeText(row.event_type) !== "EMAIL_SENT" && normalizeText(row.event_type) !== "EMAIL_FAILED")
      .map((row) => ({
        status: normalizeText(row.status).toUpperCase() === "SUCCESS" ? "SUCCESS" : "FAILED",
        total_count: 1,
      })),
  );
  const authSuccessCount = getRuntimeCounterTotal("auth_requests_total", { outcome: "success" });
  const authFailureCount = getRuntimeCounterTotal("auth_requests_total", { outcome: "error" });
  const authSuccessRate =
    authSuccessCount + authFailureCount > 0
      ? Number(((authSuccessCount / (authSuccessCount + authFailureCount)) * 100).toFixed(2))
      : 100;
  const adminRequestLatency = getRuntimeLatencySummary("http_request_latency_ms", { area: "admin" });
  const authRequestLatency = getRuntimeLatencySummary("http_request_latency_ms", { area: "auth" });
  const billingMutationLatency = getRuntimeLatencySummary("billing_mutation_latency_ms");
  const databaseRequestLatency = getRuntimeLatencySummary("supabase_request_latency_ms");
  const redisOperationLatency = getRuntimeLatencySummary("redis_operation_latency_ms");
  const databaseNetworkErrors = getRuntimeCounterTotal("supabase_requests_total", { outcome: "network_error" });
  const queueFailureCount = getRuntimeCounterTotal("queue_jobs_total", { outcome: "failed" });
  const queueRetryCount = getRuntimeCounterTotal("queue_jobs_total", { outcome: "retried" });
  const queueLagMs = getRuntimeGaugeValue("queue_lag_ms") ?? 0;
  const redisTimeoutCount = getRuntimeCounterTotal("redis_timeouts_total", { dependency: "redis" });

  const databaseSignal = databaseHealth
    ? {
        label: "Database",
        status: databaseHealth.status === "ok" ? "green" : databaseHealth.status === "degraded" ? "yellow" : "red",
        value:
          databaseHealth.status === "ok"
            ? "Healthy"
            : databaseHealth.status === "degraded"
              ? "Degraded"
              : "Unhealthy",
        detail:
          normalizeText(databaseHealth.detail) ||
          (databaseRequestLatency.count > 0 ? `p95 ${databaseRequestLatency.p95}ms` : null),
      }
    : {
        label: "Database",
        status: "yellow" as const,
        value: "Telemetry pending",
        detail:
          databaseRequestLatency.count > 0
            ? `Live database health snapshot is catching up. p95 ${databaseRequestLatency.p95}ms`
            : "Live database health snapshot is catching up.",
      };

  const readinessSignal = readiness
    ? {
        label: "API",
        status: readiness.ok ? "green" : "red",
        value: readiness.ok ? "Ready" : "Degraded",
        detail:
          adminRequestLatency.count > 0
            ? `${apiSuccessRate}% success rate, p95 ${adminRequestLatency.p95}ms`
            : `${apiSuccessRate}% success rate`,
      }
    : {
        label: "API",
        status: "yellow" as const,
        value: "Telemetry pending",
        detail:
          adminRequestLatency.count > 0
            ? `${apiSuccessRate}% success rate, p95 ${adminRequestLatency.p95}ms`
            : `${apiSuccessRate}% success rate`,
      };

  const emailSignal = {
    label: "Email",
    status: emailSuccessRate >= 98 ? "green" : emailSuccessRate >= 85 ? "yellow" : "red",
    value: `${emailSuccessRate}%`,
    detail: "Recent delivery success rate",
  } as const;

  const authSignal = {
    label: "Auth",
    status: authSuccessRate >= 98 ? "green" : authSuccessRate >= 92 ? "yellow" : "red",
    value: `${authSuccessRate}%`,
    detail: `${authFailureCount} recent auth failures`,
  } as const;

  const queueSignal = {
    label: "Queue",
    status: queueFailureCount > 0 ? "red" : queueRetryCount > 0 ? "yellow" : "green",
    value: queueFailureCount > 0 ? `${queueFailureCount} failed` : queueRetryCount > 0 ? `${queueRetryCount} retries` : "Healthy",
    detail:
      queueRetryCount > 0
        ? `${queueRetryCount} retries scheduled since startup; lag ${Math.round(queueLagMs)}ms`
        : `Lag ${Math.round(queueLagMs)}ms`,
  } as const;

  const latencySignal = {
    label: "Latency",
    status: adminRequestLatency.p95 >= 1800 ? "red" : adminRequestLatency.p95 >= 900 ? "yellow" : "green",
    value: adminRequestLatency.count > 0 ? `${adminRequestLatency.p95}ms` : "n/a",
    detail: adminRequestLatency.count > 0 ? "Admin API p95 latency" : "Waiting for live traffic",
  } as const;

  const signals = [databaseSignal, redisSignal, emailSignal, readinessSignal, authSignal, queueSignal, latencySignal];

  await Promise.allSettled([
    client.from("platform_metric_snapshots").insert([
      {
        metric_breakdown: { signal: emailSignal.value },
        metric_key: "email_success_rate",
        metric_value: emailSuccessRate,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: readinessSignal.value },
        metric_key: "api_success_rate",
        metric_value: apiSuccessRate,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: authSignal.value },
        metric_key: "auth_success_rate",
        metric_value: authSuccessRate,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: databaseSignal.value },
        metric_key: "db_request_latency_p95_ms",
        metric_value: databaseRequestLatency.p95,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: databaseSignal.value },
        metric_key: "db_timeout_count",
        metric_value: databaseNetworkErrors,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: latencySignal.value },
        metric_key: "admin_request_latency_p95_ms",
        metric_value: adminRequestLatency.p95,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: queueSignal.value },
        metric_key: "queue_retry_count",
        metric_value: queueRetryCount,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: queueSignal.value },
        metric_key: "queue_lag_ms",
        metric_value: queueLagMs,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: queueSignal.value },
        metric_key: "queue_failure_count",
        metric_value: queueFailureCount,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: "billing_latency" },
        metric_key: "billing_latency_p95_ms",
        metric_value: billingMutationLatency.p95,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: "auth_latency" },
        metric_key: "auth_request_latency_p95_ms",
        metric_value: authRequestLatency.p95,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: redisSignal.value },
        metric_key: "redis_operation_latency_p95_ms",
        metric_value: redisOperationLatency.p95,
        metric_window: "live",
      },
      {
        metric_breakdown: { signal: redisSignal.value },
        metric_key: "redis_timeout_count",
        metric_value: redisTimeoutCount,
        metric_window: "live",
      },
    ]),
  ]);

  return {
    apiSuccessRate,
    authSuccessRate,
    emailSuccessRate,
    signals,
    systemStatus: resolveSystemStatus(signals),
  };
};

const buildQueuedJobInsert = ({
  actor,
  actorUserId,
  jobType,
  payload,
  scheduledFor,
}: {
  actor?: SuperAdminActorContext | null;
  actorUserId?: string | null;
  jobType: string;
  payload: Record<string, unknown>;
  scheduledFor?: string | null;
}) => {
  const normalizedJobType = normalizeText(jobType);
  const payloadRecord = toRecord(payload);
  const metadata = readJobQueueMetadata(payloadRecord);
  const idempotencyKey = buildJobIdempotencyKey(normalizedJobType, payloadRecord);
  const deduplicationKey = buildQueueDeduplicationKey(
    normalizedJobType,
    payloadRecord,
    normalizeNullableText(metadata.deduplicationKey),
  );
  const concurrencyKey = buildQueueConcurrencyKey(
    normalizedJobType,
    payloadRecord,
    normalizeNullableText(metadata.concurrencyKey),
  );
  const trace = actor ? buildJobTraceFromActor(actor) : readJobTraceMetadata(payloadRecord);
  const maxConcurrency = resolveJobMaxConcurrency(payloadRecord, 1);

  return {
    claim_token: null,
    claimed_by: null,
    concurrency_key: concurrencyKey || null,
    created_by: actor?.actorUserId ?? actorUserId ?? null,
    deduplication_key: deduplicationKey || null,
    job_type: normalizedJobType,
    last_heartbeat_at: null,
    max_attempts: Math.max(1, toPositiveNumber(payloadRecord.maxAttempts ?? payloadRecord.max_attempts ?? 3, 3)),
    max_concurrency: maxConcurrency,
    payload: writeJobQueuePayload(payloadRecord, {
      cancellationReason: null,
      cancelledAt: null,
      cancelRequestedAt: null,
      cancelRequestedBy: null,
      claimToken: null,
      claimedBy: null,
      concurrencyKey,
      deadLetterReason: null,
      deadLetteredAt: null,
      deduplicationKey,
      idempotencyKey,
      lastHeartbeatAt: null,
      maxConcurrency,
      recoveredAt: null,
      retryHistory: Array.isArray(metadata.retryHistory) ? metadata.retryHistory : [],
      trace,
      visibilityTimeoutAt: null,
    }),
    scheduled_for: scheduledFor ?? nowIso(),
    source_correlation_id: normalizeNullableText(trace.correlationId),
    source_request_id: normalizeNullableText(trace.originRequestId),
    source_trace_id: normalizeNullableText(trace.traceId),
    status: "queued",
    visibility_timeout_at: null,
  };
};

const ensureDefaultAutomationJobs = async (client: UntypedClient, actorUserId: string) => {
  const existing = await readOptionalRows<JobQueueRow>(
    client
      .from("platform_job_queue")
      .select("job_type")
      .in("job_type", [
        "auto_subscription_renewal",
        "failed_retry_jobs",
        "invoice_generation",
        "payment_reminder",
        "inactive_library_alert",
      ]),
  );

  const existingTypes = new Set(existing.map((row) => normalizeText(row.job_type)).filter(Boolean));
  const jobsToInsert = [
    "auto_subscription_renewal",
    "invoice_generation",
    "payment_reminder",
    "inactive_library_alert",
    "failed_retry_jobs",
  ]
    .filter((jobType) => !existingTypes.has(jobType))
    .map((jobType) =>
      buildQueuedJobInsert({
        actorUserId,
        jobType,
        payload: { seeded: true },
        scheduledFor: nowIso(),
      }),
    );

  if (!jobsToInsert.length) {
    return;
  }

  await client.from("platform_job_queue").insert(jobsToInsert);
};

const ensureDefaultAutomationJobsSafely = async (client: UntypedClient, actorUserId: string) => {
  try {
    await ensureDefaultAutomationJobs(client, actorUserId);
  } catch {
    // Queue seeding is optional bootstrap data and should not block admin visibility.
  }
};

const buildResetPasswordRedirect = (env: EnvLike) => {
  const baseUrl = resolveLibriofyAppUrl(
    readEnv(env, "PUBLIC_APP_URL", "APP_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL", "VITE_PUBLIC_APP_URL", "VITE_APP_URL"),
  );

  return `${baseUrl.replace(/\/+$/, "")}/reset-password`;
};

const buildImpersonationRedirect = (env: EnvLike) => {
  const baseUrl = resolveLibriofyAppUrl(
    readEnv(env, "PUBLIC_APP_URL", "APP_URL", "SITE_URL", "NEXT_PUBLIC_SITE_URL", "VITE_PUBLIC_APP_URL", "VITE_APP_URL"),
  );

  return `${baseUrl.replace(/\/+$/, "")}/dashboard`;
};

const liftOrApplySupabaseBan = async ({
  client,
  status,
  untilAt,
  userId,
}: {
  client: UntypedClient;
  status: "active" | "banned" | "suspended";
  untilAt?: string | null;
  userId: string;
}) => {
  if (!userId) {
    return;
  }

  if (status === "active") {
    await client.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    });
    return;
  }

  const untilDate = untilAt ? new Date(untilAt) : null;
  const durationMs =
    untilDate && !Number.isNaN(untilDate.getTime())
      ? Math.max(60_000, untilDate.getTime() - Date.now())
      : status === "banned"
        ? 365 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
  const durationHours = Math.max(1, Math.ceil(durationMs / (60 * 60 * 1000)));

  await client.auth.admin.updateUserById(userId, {
    ban_duration: `${durationHours}h`,
  });
};

const createInvoiceNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `LIB-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
};

const isPlatformToggleEnabled = async (
  env: EnvLike,
  key: string,
  fallback = true,
) => {
  const settingsMap = await getPlatformSettingsMap(env, [key]);
  return parseSettingBoolean(settingsMap.get(key)?.value) ?? fallback;
};

const findRecentInvoiceConflict = async (
  client: UntypedClient,
  input: AdminInvoiceInput,
  subtotal: number,
) => {
  const rows = await readOptionalRows<InvoiceRow>(
    client
      .from("platform_invoices")
      .select("id, invoice_number, library_id, invoice_type, status, subtotal, tax_amount, total_amount, issued_at, period_start, period_end")
      .eq("library_id", input.libraryId)
      .eq("invoice_type", input.invoiceType ?? "subscription")
      .gte("issued_at", new Date(Date.now() - BILLING_DEDUP_WINDOW_MS).toISOString())
      .order("issued_at", { ascending: false })
      .limit(12),
  );

  return rows.find((row) =>
    normalizeText(row.library_id) === input.libraryId &&
    normalizeText(row.invoice_type) === (input.invoiceType ?? "subscription") &&
    normalizeText(row.status) !== "void" &&
    Number(toNumber(row.subtotal).toFixed(2)) === Number(subtotal.toFixed(2)) &&
    normalizeNullableText(row.period_start) === normalizeNullableText(input.periodStart) &&
    normalizeNullableText(row.period_end) === normalizeNullableText(input.periodEnd),
  ) ?? null;
};

const findRecentRefundConflict = async (
  client: UntypedClient,
  input: AdminRefundInput,
) => {
  const rows = await readOptionalRows<RefundRow>(
    client
      .from("billing_refunds")
      .select("id, library_id, amount, reason, status, created_at, processed_at, payment_id, subscription_payment_id, invoice_id")
      .eq("library_id", input.libraryId)
      .gte("created_at", new Date(Date.now() - BILLING_DEDUP_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
  );

  return rows.find((row) =>
    Number(toNumber(row.amount).toFixed(2)) === Number(input.amount.toFixed(2)) &&
    normalizeText(row.reason) === normalizeText(input.reason) &&
    normalizeText(row.status) !== "failed" &&
    normalizeNullableText(row.payment_id) === normalizeNullableText(input.paymentId) &&
    normalizeNullableText(row.subscription_payment_id) === normalizeNullableText(input.subscriptionPaymentId) &&
    normalizeNullableText(row.invoice_id) === normalizeNullableText(input.invoiceId),
  ) ?? null;
};

const loadRefundSourceAmount = async (
  client: UntypedClient,
  input: AdminRefundInput,
) => {
  if (normalizeText(input.paymentId)) {
    const payment = await readMaybeSingle<PaymentRow>(
      client
        .from("payments")
        .select("id, amount, library_id, status")
        .eq("id", input.paymentId)
        .maybeSingle(),
    );

    if (!payment || normalizeText(payment.library_id) !== input.libraryId) {
      return { amount: null, reason: "Payment source not found for this library." };
    }

    return { amount: toNumber(payment.amount), reason: null };
  }

  if (normalizeText(input.subscriptionPaymentId)) {
    const payment = await readMaybeSingle<SubscriptionPaymentRow>(
      client
        .from("subscription_payments")
        .select("id, amount, library_id, status")
        .eq("id", input.subscriptionPaymentId)
        .maybeSingle(),
    );

    if (!payment || normalizeText(payment.library_id) !== input.libraryId) {
      return { amount: null, reason: "Subscription payment source not found for this library." };
    }

    return { amount: toNumber(payment.amount), reason: null };
  }

  return { amount: null, reason: null };
};

const loadProcessedRefundAmount = async (
  client: UntypedClient,
  input: AdminRefundInput,
) => {
  let query = client
    .from("billing_refunds")
    .select("amount, status, payment_id, subscription_payment_id")
    .eq("library_id", input.libraryId)
    .in("status", ["pending", "processed"]);

  if (normalizeText(input.paymentId)) {
    query = query.eq("payment_id", input.paymentId);
  } else if (normalizeText(input.subscriptionPaymentId)) {
    query = query.eq("subscription_payment_id", input.subscriptionPaymentId);
  } else {
    return 0;
  }

  const rows = await readOptionalRows<RefundRow>(query.limit(50));
  return rows.reduce((sum, row) => sum + toNumber(row.amount), 0);
};

const enqueueOrReuseJob = async ({
  actor,
  client,
  input,
}: {
  actor: SuperAdminActorContext;
  client: UntypedClient;
  input: AdminJobActionInput;
}) => {
  const jobType = normalizeText(input.jobType);
  const payload = toRecord(input.payload);
  const metadata = readJobQueueMetadata(payload);
  const deduplicationKey = buildQueueDeduplicationKey(jobType, payload, normalizeNullableText(metadata.deduplicationKey));
  const recentRows = await readOptionalRows<JobQueueRow>(
    client
      .from("platform_job_queue")
      .select(`${JOB_QUEUE_SELECT_FIELDS}, created_at`)
      .eq("deduplication_key", deduplicationKey)
      .gte("created_at", new Date(Date.now() - JOB_DEDUP_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(30),
  );
  const existing = recentRows.find(
    (row) =>
      normalizeText(row.deduplication_key) === deduplicationKey &&
      !isDeadLetteredJob(row.payload) &&
      normalizeText(row.status) !== "cancelled",
  );
  if (existing) {
    return existing;
  }

  return await readMaybeSingle<JobQueueRow>(
    client
      .from("platform_job_queue")
      .insert(
        buildQueuedJobInsert({
          actor,
          jobType,
          payload,
          scheduledFor: input.scheduledFor ?? nowIso(),
        }),
      )
      .select(JOB_QUEUE_SELECT_FIELDS)
      .maybeSingle(),
  );
};

const createInvoiceRecord = async ({
  actor,
  client,
  env,
  input,
}: {
  actor: SuperAdminActorContext;
  client: UntypedClient;
  env: EnvLike;
  input: AdminInvoiceInput;
}) => {
  if (!(await isPlatformToggleEnabled(env, "ops_billing_mutations_enabled", true))) {
    throw new Error("Billing mutations are currently disabled by the platform kill switch.");
  }

  const settingsMap = await getPlatformSettingsMap(env, ["gst_rate_percent"]);
  const gstRatePercent = parseSettingNumber(settingsMap.get("gst_rate_percent")?.value) ?? 18;
  const totals = calculateGstBreakdown(input.subtotal, gstRatePercent);
  const lock = await acquireOperationalLock(
    env,
    `billing:invoice:${input.libraryId}:${input.invoiceType ?? "subscription"}:${input.periodStart ?? ""}:${input.periodEnd ?? ""}:${totals.subtotal}`,
    BILLING_LOCK_TTL_MS,
  );
  if (!lock) {
    throw new Error("Another invoice operation is already in progress for this billing target.");
  }

  try {
    const duplicate = await findRecentInvoiceConflict(client, input, totals.subtotal);
    if (duplicate) {
      incrementRuntimeMetric("billing_mutations_total", 1, {
        mutation: "create_invoice",
        outcome: "deduplicated",
      });
      return duplicate;
    }

    const startedAt = Date.now();
    const row = await readMaybeSingle<InvoiceRow>(
      client
        .from("platform_invoices")
        .insert({
          currency: DEFAULT_INVOICE_CURRENCY,
          generated_by: actor.actorUserId,
          invoice_number: createInvoiceNumber(),
          invoice_type: input.invoiceType ?? "subscription",
          library_id: input.libraryId,
          metadata: {
            ...(input.metadata ?? {}),
            generated_via: "control_plane",
          },
          period_end: input.periodEnd ?? null,
          period_start: input.periodStart ?? null,
          status: "generated",
          subtotal: totals.subtotal,
          tax_amount: totals.taxAmount,
          total_amount: totals.totalAmount,
        })
        .select("id, invoice_number, library_id, invoice_type, status, subtotal, tax_amount, total_amount, issued_at, period_start, period_end")
        .maybeSingle(),
    );
    recordRuntimeLatency("billing_mutation_latency_ms", Date.now() - startedAt, {
      mutation: "create_invoice",
      outcome: "success",
    });
    incrementRuntimeMetric("billing_mutations_total", 1, {
      mutation: "create_invoice",
      outcome: "success",
    });

    await recordAdminAction(client, actor, {
      action: "invoice_created",
      activityMessage: `Generated invoice ${normalizeText(row?.invoice_number)}.`,
      activityType: "invoice_created",
      libraryId: input.libraryId,
      metadata: {
        invoice_number: normalizeText(row?.invoice_number),
        invoice_type: input.invoiceType ?? "subscription",
        subtotal: totals.subtotal,
        tax_amount: totals.taxAmount,
        total_amount: totals.totalAmount,
      },
      targetDisplay: normalizeText(row?.invoice_number),
      targetId: normalizeText(row?.id),
      targetType: "invoice",
    });

    return row;
  } finally {
    await lock.release();
  }
};

const runPaymentReminderJob = async ({
  actor,
  client,
}: {
  actor: SuperAdminActorContext;
  client: UntypedClient;
}) => {
  const [subscriptions, libraries, profiles] = await Promise.all([
    readOptionalRows<SubscriptionRow>(
      client
        .from("library_subscriptions")
        .select("library_id, status, payment_status, plan_name, price, updated_at")
        .order("updated_at", { ascending: false }),
    ),
    readOptionalRows<LibraryRow>(
      client
        .from("libraries")
        .select("id, name, owner_id"),
    ),
    readOptionalRows<ProfileRow>(
      client
        .from("profiles")
        .select("user_id, email, full_name"),
    ),
  ]);

  const libraryById = new Map(libraries.map((library) => [normalizeText(library.id), library] as const));
  const profileByUserId = new Map(profiles.map((profile) => [normalizeText(profile.user_id), profile] as const));
  const dueSubscriptions = subscriptions.filter((subscription) => {
    const status = normalizeText(subscription.status).toLowerCase();
    const paymentStatus = normalizeText(subscription.payment_status).toLowerCase();
    return status === "expired" || paymentStatus === "pending" || paymentStatus === "failed";
  });

  if (!dueSubscriptions.length) {
    return {
      remindersSent: 0,
    };
  }

  const notifications = dueSubscriptions.map((subscription) => {
    const library = libraryById.get(normalizeText(subscription.library_id));
    const title = `Payment reminder for ${normalizeText(library?.name) || "library"}`;

    return {
      channel: "in_app",
      delivery_status: "sent",
      is_read: false,
      library_id: normalizeText(subscription.library_id),
      message: `Your ${normalizeText(subscription.plan_name) || "current"} plan needs attention. Please renew to avoid service interruption.`,
      metadata: {
        actor_user_id: actor.actorUserId,
        automation_job: "payment_reminder",
      },
      title,
      type: "payment_reminder",
      user_id: normalizeNullableText(library?.owner_id),
    };
  });

  await client.from("notifications").insert(notifications);

  const emailAttempts = await Promise.allSettled(
    dueSubscriptions.map(async (subscription) => {
      const library = libraryById.get(normalizeText(subscription.library_id));
      const profile = profileByUserId.get(normalizeText(library?.owner_id));
      const email = normalizeText(profile?.email);
      if (!email) {
        return false;
      }

      await sendEmail({
        env: process.env,
        from: resolveLibriofyEmailFrom("hello@libriofy.com"),
        metadata: {
          area: "automation",
          library_id: normalizeText(subscription.library_id),
          source: "payment_reminder_job",
        },
        subject: `Payment reminder for ${normalizeText(library?.name) || "your library"}`,
        text: `Hi ${normalizeText(profile?.full_name) || "there"}, your library subscription needs attention. Please review billing in Libriofy.`,
        to: [email],
        user: email,
      });

      return true;
    }),
  );

  return {
    emailAttempts: emailAttempts.filter((attempt) => attempt.status === "fulfilled" && attempt.value).length,
    remindersSent: notifications.length,
  };
};

const runInactiveLibraryAlertJob = async ({
  actor,
  client,
  env,
}: {
  actor: SuperAdminActorContext;
  client: UntypedClient;
  env: EnvLike;
}) => {
  const settingsMap = await getPlatformSettingsMap(env, ["inactive_library_days"]);
  const inactiveLibraryDays = parseSettingNumber(settingsMap.get("inactive_library_days")?.value) ?? 14;
  const libraries = await readOptionalRows<LibraryRow>(
    client
      .from("libraries")
      .select("id, name, updated_at, created_at")
      .order("updated_at", { ascending: false }),
  );
  const lastActivityByLibraryId = await loadLastActivityByLibraryId(client);
  const inactiveLibraries = calculateInactiveLibraryRows({
    inactiveAfterDays: inactiveLibraryDays,
    lastActivityByLibraryId,
    libraries,
  });

  if (!inactiveLibraries.length) {
    return {
      inactiveLibraries: 0,
    };
  }

  await Promise.allSettled(
    inactiveLibraries.map((library) =>
      recordPlatformActivity(client, actor, {
        activityType: "inactive_library_alert",
        libraryId: library.libraryId,
        message: `${library.libraryName || "A library"} has been inactive for ${library.inactiveDays} days.`,
        metadata: {
          inactive_days: library.inactiveDays,
        },
      }),
    ),
  );

  await Promise.allSettled([
    logEvent({
      type: "INACTIVE_LIBRARY_ALERT",
      status: "SUCCESS",
      classification: "SECURITY_EVENT",
      metadata: {
        count: inactiveLibraries.length,
        severity: inactiveLibraries.length >= 5 ? "WARNING" : "INFO",
      },
      message: `Detected ${inactiveLibraries.length} inactive libraries.`,
    }, {
      skipConsole: true,
    }),
  ]);

  return {
    inactiveLibraries: inactiveLibraries.length,
  };
};

const runAutoSubscriptionRenewalJob = async ({
  actor,
  client,
}: {
  actor: SuperAdminActorContext;
  client: UntypedClient;
}) => {
  const dueSubscriptions = await readOptionalRows<SubscriptionRow>(
    client
      .from("library_subscriptions")
      .select("id, library_id, status, payment_status, price, plan_name, updated_at")
      .eq("status", "active")
      .order("updated_at", { ascending: true })
      .limit(50),
  );

  const renewable = dueSubscriptions.filter((subscription) => {
    const paymentStatus = normalizeText(subscription.payment_status).toLowerCase();
    return paymentStatus === "paid" || paymentStatus === "success" || paymentStatus === "approved";
  });

  await Promise.allSettled(
    renewable.map((subscription) =>
      recordPlatformActivity(client, actor, {
        activityType: "subscription_renewal_checked",
        libraryId: normalizeNullableText(subscription.library_id),
        message: `Checked renewal readiness for ${normalizeText(subscription.plan_name) || "subscription"}.`,
        metadata: {
          price: toNumber(subscription.price),
          status: normalizeText(subscription.status),
        },
      }),
    ),
  );

  return {
    checkedSubscriptions: renewable.length,
  };
};

const runInvoiceGenerationJob = async ({
  actor,
  client,
  env,
}: {
  actor: SuperAdminActorContext;
  client: UntypedClient;
  env: EnvLike;
}) => {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const subscriptions = await readOptionalRows<SubscriptionRow>(
    client
      .from("library_subscriptions")
      .select("library_id, status, payment_status, price, plan_name")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(100),
  );
  const existingInvoices = await readOptionalRows<InvoiceRow>(
    client
      .from("platform_invoices")
      .select("library_id, invoice_type, period_start, period_end, issued_at")
      .eq("invoice_type", "subscription")
      .gte("issued_at", new Date(Date.now() - JOB_DEDUP_WINDOW_MS).toISOString())
      .order("issued_at", { ascending: false })
      .limit(300),
  );
  const existingKeys = new Set(
    existingInvoices.map((row) => `${normalizeText(row.library_id)}:${normalizeNullableText(row.period_start)}:${normalizeNullableText(row.period_end)}`),
  );
  let generatedInvoices = 0;

  for (const subscription of subscriptions) {
    const paymentStatus = normalizeText(subscription.payment_status).toLowerCase();
    const libraryId = normalizeText(subscription.library_id);
    if (!libraryId || !["paid", "success", "approved"].includes(paymentStatus)) {
      continue;
    }

    const invoiceKey = `${libraryId}:${periodStart}:${periodEnd}`;
    if (existingKeys.has(invoiceKey)) {
      continue;
    }

    await createInvoiceRecord({
      actor,
      client,
      env,
      input: {
        invoiceType: "subscription",
        libraryId,
        metadata: {
          generated_by_job: true,
          plan_name: normalizeNullableText(subscription.plan_name),
        },
        periodEnd,
        periodStart,
        subtotal: toNumber(subscription.price),
      },
    });
    existingKeys.add(invoiceKey);
    generatedInvoices += 1;
  }

  return {
    generatedInvoices,
  };
};

const buildJobObservabilityMetadata = (job: AdminJobQueueRow) => {
  const trace = readJobTraceMetadata(job.payload);
  return {
    queue_job_id: job.id,
    queue_job_type: job.jobType,
    queue_origin_request_id: normalizeNullableText(trace.originRequestId),
    queue_parent_request_id: normalizeNullableText(trace.parentRequestId),
    queue_trace_id: normalizeNullableText(trace.traceId),
  };
};

const markJobCancelled = async ({
  actor,
  client,
  job,
  reason,
  requireClaim,
}: {
  actor?: SuperAdminActorContext | null;
  client: UntypedClient;
  job: AdminJobQueueRow;
  reason?: string | null;
  requireClaim?: boolean;
}) => {
  const cancelledAt = nowIso();
  const claimToken = normalizeText(readJobQueueMetadata(job.payload).claimToken);
  let query = client
    .from("platform_job_queue")
    .update({
      cancellation_reason: reason ?? normalizeNullableText(readJobQueueMetadata(job.payload).cancellationReason),
      cancelled_at: cancelledAt,
      claim_token: null,
      claimed_by: null,
      finished_at: cancelledAt,
      last_heartbeat_at: cancelledAt,
      payload: writeJobQueuePayload(job.payload, {
        cancellationReason: reason ?? normalizeNullableText(readJobQueueMetadata(job.payload).cancellationReason),
        cancelledAt,
        claimToken: null,
        claimedBy: null,
        lastHeartbeatAt: cancelledAt,
        visibilityTimeoutAt: null,
      }),
      status: "cancelled",
      visibility_timeout_at: null,
    })
    .eq("id", job.id);

  if (requireClaim && claimToken) {
    query = query.eq("claim_token", claimToken);
  }

  return await readMaybeSingle<JobQueueRow>(query.select(JOB_QUEUE_SELECT_FIELDS).maybeSingle());
};

const claimJobExecution = async ({
  actor,
  client,
  job,
}: {
  actor: SuperAdminActorContext;
  client: UntypedClient;
  job: AdminJobQueueRow;
}) => {
  const now = nowIso();
  const claimToken = randomUUID();
  const concurrencyKey =
    normalizeNullableText(readJobQueueMetadata(job.payload).concurrencyKey) ??
    buildQueueConcurrencyKey(job.jobType, toRecord(job.payload));
  const maxConcurrency = resolveJobMaxConcurrency(job.payload, 1);

  if (concurrencyKey && maxConcurrency > 0) {
    const { count, error } = await client
      .from("platform_job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "running")
      .eq("concurrency_key", concurrencyKey)
      .gt("visibility_timeout_at", now)
      .neq("id", job.id);

    if (error) {
      throw error;
    }

    if (Number(count ?? 0) >= maxConcurrency) {
      incrementRuntimeMetric("queue_claim_skipped_total", 1, {
        job_type: job.jobType,
        reason: "concurrency_limit",
      });
      return null;
    }
  }

  const visibilityTimeoutAt = buildJobVisibilityTimeoutAt(job);
  let query = client
    .from("platform_job_queue")
    .update({
      attempts: job.attempts + 1,
      cancelled_at: null,
      claim_token: claimToken,
      claimed_by: actor.actorUserId,
      concurrency_key: concurrencyKey || null,
      finished_at: null,
      last_error: null,
      last_heartbeat_at: now,
      max_concurrency: maxConcurrency,
      payload: writeJobQueuePayload(job.payload, {
        claimToken,
        claimedBy: actor.actorUserId,
        concurrencyKey,
        lastHeartbeatAt: now,
        maxConcurrency,
        recoveredAt: job.status === "running" ? now : normalizeNullableText(readJobQueueMetadata(job.payload).recoveredAt),
        visibilityTimeoutAt,
      }),
      recovered_at: job.status === "running" ? now : null,
      started_at: now,
      status: "running",
      visibility_timeout_at: visibilityTimeoutAt,
    })
    .eq("id", job.id);

  if (job.status === "running") {
    const previousClaimToken = normalizeText(readJobQueueMetadata(job.payload).claimToken);
    query = query.eq("status", "running");
    if (previousClaimToken) {
      query = query.eq("claim_token", previousClaimToken);
    }

    const previousVisibilityTimeoutAt = readJobVisibilityTimeoutAt(job);
    if (previousVisibilityTimeoutAt) {
      query = query.lte("visibility_timeout_at", now);
    } else if (job.startedAt) {
      query = query.lt("started_at", new Date(Date.now() - JOB_STALE_RUNNING_MS).toISOString());
    }
  } else {
    query = query.eq("status", "queued").lte("scheduled_for", now).is("claim_token", null);
  }

  const row = await readMaybeSingle<JobQueueRow>(query.select(JOB_QUEUE_SELECT_FIELDS).maybeSingle());
  if (!row) {
    incrementRuntimeMetric("queue_claim_skipped_total", 1, {
      job_type: job.jobType,
      reason: "lost_race",
    });
    return null;
  }

  const claimedJob = mapJobRow(row);
  recordRuntimeGauge("queue_running_jobs", 1, {
    concurrency_key: concurrencyKey || "default",
    job_type: claimedJob.jobType,
  });
  return claimedJob;
};

const runJobWithTraceContext = async <T>({
  actor,
  job,
  operation,
}: {
  actor: SuperAdminActorContext;
  job: AdminJobQueueRow;
  operation: () => Promise<T>;
}) => {
  const trace = readJobTraceMetadata(job.payload);
  const context = createRequestTraceContext({
    correlationId: normalizeNullableText(trace.correlationId) ?? actor.correlationId ?? undefined,
    ipAddress: actor.ipAddress ?? undefined,
    method: "JOB",
    requestId: randomUUID(),
    route: `/internal/queue/${job.jobType}`,
    source: normalizeNullableText(trace.requestSource) ?? "platform_job_queue",
    traceId: normalizeNullableText(trace.traceId) ?? actor.traceId ?? undefined,
    userAgent: actor.userAgent ?? undefined,
  });

  return await runWithRequestTraceContext(context, operation);
};

const markJobForRetry = async ({
  client,
  errorMessage,
  job,
}: {
  client: UntypedClient;
  errorMessage: string;
  job: AdminJobQueueRow;
}) => {
  const retryCount = job.attempts + 1;
  const backoffMs = buildJobBackoffMs(retryCount);
  const nextScheduledFor = new Date(Date.now() + backoffMs).toISOString();
  const now = nowIso();
  const retryHistory = [
    ...(Array.isArray(readJobQueueMetadata(job.payload).retryHistory) ? (readJobQueueMetadata(job.payload).retryHistory as unknown[]) : []),
    {
      at: now,
      attempt: retryCount,
      error: errorMessage,
      scheduled_for: nextScheduledFor,
    },
  ].slice(-10);

  const claimToken = normalizeText(readJobQueueMetadata(job.payload).claimToken);
  let retryQuery = client
    .from("platform_job_queue")
    .update({
      claim_token: null,
      claimed_by: null,
      finished_at: now,
      last_error: errorMessage,
      last_heartbeat_at: now,
      payload: writeJobQueuePayload(job.payload, {
        claimToken: null,
        claimedBy: null,
        deadLetteredAt: null,
        deadLetterReason: null,
        lastHeartbeatAt: now,
        retryHistory,
        visibilityTimeoutAt: null,
      }),
      scheduled_for: nextScheduledFor,
      started_at: null,
      status: "queued",
      visibility_timeout_at: null,
    })
    .eq("id", job.id);

  if (claimToken) {
    retryQuery = retryQuery.eq("claim_token", claimToken);
  }

  await readMaybeSingle<JobQueueRow>(retryQuery.select(JOB_QUEUE_SELECT_FIELDS).maybeSingle());

  return backoffMs;
};

const markJobDeadLettered = async ({
  client,
  errorMessage,
  job,
}: {
  client: UntypedClient;
  errorMessage: string;
  job: AdminJobQueueRow;
}) => {
  const deadLetteredAt = nowIso();
  const retryHistory = [
    ...(Array.isArray(readJobQueueMetadata(job.payload).retryHistory) ? (readJobQueueMetadata(job.payload).retryHistory as unknown[]) : []),
    {
      at: deadLetteredAt,
      attempt: job.attempts + 1,
      error: errorMessage,
      state: "dead_lettered",
    },
  ].slice(-10);

  const claimToken = normalizeText(readJobQueueMetadata(job.payload).claimToken);
  let deadLetterQuery = client
    .from("platform_job_queue")
    .update({
      claim_token: null,
      claimed_by: null,
      dead_lettered_at: deadLetteredAt,
      finished_at: deadLetteredAt,
      last_error: errorMessage,
      last_heartbeat_at: deadLetteredAt,
      payload: writeJobQueuePayload(job.payload, {
        claimToken: null,
        claimedBy: null,
        deadLetterReason: errorMessage,
        deadLetteredAt,
        lastHeartbeatAt: deadLetteredAt,
        retryHistory,
        visibilityTimeoutAt: null,
      }),
      status: "failed",
      visibility_timeout_at: null,
    })
    .eq("id", job.id);

  if (claimToken) {
    deadLetterQuery = deadLetterQuery.eq("claim_token", claimToken);
  }

  const row = await readMaybeSingle<JobQueueRow>(deadLetterQuery.select(JOB_QUEUE_SELECT_FIELDS).maybeSingle());
  if (row) {
    const trace = readJobTraceMetadata(row.payload);
    await client.from("platform_job_dead_letters").insert({
      attempts: Math.max(1, job.attempts + 1),
      dead_lettered_at: deadLetteredAt,
      error_message: errorMessage,
      job_id: job.id,
      job_payload: row.payload ?? job.payload,
      job_type: job.jobType,
      max_attempts: Math.max(1, job.maxAttempts),
      source_correlation_id: normalizeNullableText(trace.correlationId),
      source_request_id: normalizeNullableText(trace.originRequestId),
      source_trace_id: normalizeNullableText(trace.traceId),
    });
  }
};

const runFailedRetrySweepJob = async ({
  client,
}: {
  client: UntypedClient;
}) => {
  const legacyFailedJobs = mapJobs(
    await readOptionalRows<JobQueueRow>(
      client
        .from("platform_job_queue")
        .select(JOB_QUEUE_SELECT_FIELDS)
        .in("status", ["failed", "running"])
        .order("updated_at", { ascending: true })
        .limit(25),
    ),
  );
  let requeuedJobs = 0;
  let deadLetteredJobs = 0;
  let recoveredJobs = 0;

  for (const job of legacyFailedJobs) {
    const staleRunning = job.status === "running" && shouldRecoverRunningJob({
      payload: job.payload,
      startedAt: job.startedAt,
      visibilityTimeoutAt: readJobVisibilityTimeoutAt(job),
    });
    const retryEligible =
      !isDeadLetteredJob(job.payload) &&
      (job.status === "failed" || staleRunning) &&
      job.attempts < job.maxAttempts;

    if (retryEligible) {
      if (staleRunning) {
        recoveredJobs += 1;
      }
      await markJobForRetry({
        client,
        errorMessage: job.lastError || "Retry sweep rescheduled the job.",
        job,
      });
      requeuedJobs += 1;
      continue;
    }

    if ((job.status === "failed" || staleRunning) && !isDeadLetteredJob(job.payload)) {
      await markJobDeadLettered({
        client,
        errorMessage: job.lastError || "Retry sweep exhausted the job.",
        job,
      });
      deadLetteredJobs += 1;
    }
  }

  return {
    deadLetteredJobs,
    recoveredJobs,
    requeuedJobs,
  };
};

const executeJob = async ({
  actor,
  client,
  env,
  job,
}: {
  actor: SuperAdminActorContext;
  client: UntypedClient;
  env: EnvLike;
  job: AdminJobQueueRow;
}) => {
  if (isCancelledJob(job.payload) || isCancellationRequestedJob(job.payload)) {
    await markJobCancelled({
      actor,
      client,
      job,
      reason: normalizeNullableText(readJobQueueMetadata(job.payload).cancellationReason) ?? "Cancellation requested.",
    });
    incrementRuntimeMetric("queue_jobs_total", 1, {
      job_type: job.jobType,
      outcome: "cancelled",
    });
    return {
      cancelled: true,
    };
  }

  const claimedJob = await claimJobExecution({
    actor,
    client,
    job,
  });
  if (!claimedJob) {
    return {
      skipped: true,
    };
  }

  const stopHeartbeat = startJobLeaseHeartbeat({
    client,
    job: claimedJob,
  });
  const concurrencyKey = normalizeNullableText(readJobQueueMetadata(claimedJob.payload).concurrencyKey) || "default";

  try {
    return await runJobWithTraceContext({
      actor,
      job: claimedJob,
      operation: async () => {
        if (isCancellationRequestedJob(claimedJob.payload)) {
          await markJobCancelled({
            actor,
            client,
            job: claimedJob,
            reason: normalizeNullableText(readJobQueueMetadata(claimedJob.payload).cancellationReason) ?? "Cancellation requested before execution.",
            requireClaim: true,
          });
          incrementRuntimeMetric("queue_jobs_total", 1, {
            job_type: claimedJob.jobType,
            outcome: "cancelled",
          });
          return {
            cancelled: true,
          };
        }

        const startedAt = Date.now();
        const scheduledAtMs = Date.parse(claimedJob.scheduledFor);
        recordRuntimeGauge("queue_lag_ms", Number.isFinite(scheduledAtMs) ? Math.max(0, startedAt - scheduledAtMs) : 0, {
          job_type: claimedJob.jobType,
        });

        let result: JsonRecord = {};

        if (claimedJob.jobType === "payment_reminder") {
          result = await runPaymentReminderJob({ actor, client });
        } else if (claimedJob.jobType === "inactive_library_alert") {
          result = await runInactiveLibraryAlertJob({ actor, client, env });
        } else if (claimedJob.jobType === "auto_subscription_renewal") {
          result = await runAutoSubscriptionRenewalJob({ actor, client });
        } else if (claimedJob.jobType === "invoice_generation") {
          result = await runInvoiceGenerationJob({ actor, client, env });
        } else if (claimedJob.jobType === "failed_retry_jobs") {
          result = await runFailedRetrySweepJob({ client });
        } else {
          result = {
            note: "No executor registered; job marked complete for manual handling.",
          };
        }

        const completedAt = nowIso();
        const claimToken = normalizeText(readJobQueueMetadata(claimedJob.payload).claimToken);
        let completeQuery = client
          .from("platform_job_queue")
          .update({
            claim_token: null,
            claimed_by: null,
            finished_at: completedAt,
            last_error: null,
            last_heartbeat_at: completedAt,
            payload: writeJobQueuePayload(claimedJob.payload, {
              claimToken: null,
              claimedBy: null,
              completedAt,
              deadLetteredAt: null,
              deadLetterReason: null,
              lastHeartbeatAt: completedAt,
              lastResult: result,
              visibilityTimeoutAt: null,
            }),
            status: "completed",
            visibility_timeout_at: null,
          })
          .eq("id", claimedJob.id);

        if (claimToken) {
          completeQuery = completeQuery.eq("claim_token", claimToken);
        }

        const completedRow = await readMaybeSingle<JobQueueRow>(
          completeQuery.select(JOB_QUEUE_SELECT_FIELDS).maybeSingle(),
        );
        if (!completedRow) {
          incrementRuntimeMetric("queue_jobs_total", 1, {
            job_type: claimedJob.jobType,
            outcome: "lease_lost",
          });
          return {
            reason: "lease_lost",
            skipped: true,
          };
        }

        incrementRuntimeMetric("queue_jobs_total", 1, {
          job_type: claimedJob.jobType,
          outcome: "success",
        });
        recordRuntimeLatency("queue_job_latency_ms", Date.now() - startedAt, {
          job_type: claimedJob.jobType,
          outcome: "success",
        });

        return result;
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Job execution failed.";
    incrementRuntimeMetric("queue_jobs_total", 1, {
      job_type: claimedJob.jobType,
      outcome: "failed",
    });

    if (claimedJob.attempts < claimedJob.maxAttempts) {
      const backoffMs = await markJobForRetry({
        client,
        errorMessage,
        job: claimedJob,
      });
      incrementRuntimeMetric("queue_jobs_total", 1, {
        job_type: claimedJob.jobType,
        outcome: "retried",
      });
      void logEvent({
        type: "PLATFORM_JOB_RETRY_SCHEDULED",
        status: "FAILED",
        classification: "QUEUE_ERROR",
        entityId: claimedJob.id,
        metadata: {
          ...buildJobObservabilityMetadata(claimedJob),
          attempt: claimedJob.attempts,
          backoff_ms: backoffMs,
          job_type: claimedJob.jobType,
          severity: "WARNING",
        },
        message: `Scheduled retry for ${claimedJob.jobType}.`,
      }, {
        skipConsole: true,
      });
    } else {
      await markJobDeadLettered({
        client,
        errorMessage,
        job: claimedJob,
      });
      void logEvent({
        type: "PLATFORM_JOB_DEAD_LETTERED",
        status: "FAILED",
        classification: "QUEUE_ERROR",
        entityId: claimedJob.id,
        metadata: {
          ...buildJobObservabilityMetadata(claimedJob),
          attempt: claimedJob.attempts,
          job_type: claimedJob.jobType,
          severity: "ERROR",
        },
        message: `Job ${claimedJob.jobType} exhausted retries and was dead-lettered.`,
      }, {
        skipConsole: true,
      });
    }

    throw error;
  } finally {
    stopHeartbeat();
    recordRuntimeGauge("queue_running_jobs", 0, {
      concurrency_key: concurrencyKey,
      job_type: claimedJob.jobType,
    });
  }
};

export const getControlCenterData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
): Promise<StructuredApiResponse<SuperAdminControlCenterData>> => {
  const client = buildServiceClient(env);
  await ensureDefaultAutomationJobsSafely(client, actor.actorUserId);

  const core = await loadCoreAdminData(env, client);
  const settingsMap = new Map(core.settings.map((setting) => [setting.key, setting]));
  const subscriptionsByLibraryId = new Map(
    core.subscriptions.map((subscription) => [normalizeText(subscription.library_id), subscription] as const),
  );
  const ownerProfilesByUserId = new Map(
    core.profiles.map((profile) => [normalizeText(profile.user_id), profile] as const),
  );
  const accountControls = new Map(
    core.accountControls.map((row) => [normalizeText(row.user_id), row] as const),
  );
  const libraryControls = new Map(
    core.libraryControls.map((row) => [normalizeText(row.library_id), row] as const),
  );
  const libraryRows = buildLibraryControlRows({
    controls: libraryControls,
    lastActivityByLibraryId: core.lastActivityByLibraryId,
    libraries: core.libraries,
    ownerProfilesByUserId,
    subscriptionsByLibraryId,
  });
  const series = buildTimeSeries(
    buildLiveDailyMetricsRows({
      attendanceRows: core.attendanceRows,
      libraries: core.libraries,
      payments: core.payments,
      revenueAdjustments: core.revenueAdjustments,
      subscriptionPayments: core.subscriptionPayments,
    }),
  );
  const latestPoint = series.at(-1);
  const previousPoint = series.at(-2);
  const currentMonth = monthKey(new Date());
  const previousMonthDate = new Date();
  previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
  const previousMonth = monthKey(previousMonthDate);

  const revenueThisMonth = series
    .filter((point) => monthKey(point.date) === currentMonth)
    .reduce((sum, point) => sum + point.totalRevenue, 0);
  const revenuePreviousMonth = series
    .filter((point) => monthKey(point.date) === previousMonth)
    .reduce((sum, point) => sum + point.totalRevenue, 0);
  const activeSubscriptionCount = libraryRows.filter((library) => {
    const status = normalizeText(library.subscriptionStatus).toLowerCase();
    return status === "active" || status === "trial";
  }).length;
  const activeLibraryCount = libraryRows.filter((library) => library.enabled && library.controlStatus === "active").length;
  const trialLibraryCount = libraryRows.filter(
    (library) => normalizeText(library.subscriptionStatus).toLowerCase() === "trial",
  ).length;
  const approvedTransactionsThisMonth =
    core.payments.filter(
      (payment) =>
        isApprovedRevenueStatus(payment.status) &&
        monthKey(normalizeText(payment.approved_at) || normalizeText(payment.created_at)) === currentMonth,
    ).length +
    core.subscriptionPayments.filter(
      (payment) =>
        isApprovedRevenueStatus(payment.status) &&
        monthKey(
          normalizeText(payment.paid_at) ||
            normalizeText(payment.capture_processed_at) ||
            normalizeText(payment.updated_at) ||
            normalizeText(payment.created_at),
        ) === currentMonth,
    ).length;
  const lastAttendanceAt =
    core.attendanceRows.map((row) => resolveAttendanceTimestamp(row)).find((value) => Boolean(value)) ?? null;
  const lastPaymentAt = resolveLatestTimestamp([
    ...core.payments
      .filter((payment) => isApprovedRevenueStatus(payment.status))
      .map((payment) => normalizeNullableText(payment.approved_at) ?? normalizeNullableText(payment.created_at)),
    ...core.subscriptionPayments
      .filter((payment) => isApprovedRevenueStatus(payment.status))
      .map(
        (payment) =>
          normalizeNullableText(payment.paid_at) ??
          normalizeNullableText(payment.capture_processed_at) ??
          normalizeNullableText(payment.updated_at) ??
          normalizeNullableText(payment.created_at),
      ),
  ]);

  const statusData = await buildStatusSignals({
    client,
    env,
  });
  const loginSummary = buildLoginAttemptSummary(core.loginRows);
  const operational = buildOperationalContext({
    core,
    loginSummary,
    settingsMap,
    statusData,
  });
  const settings: AdminPlatformSetting[] = core.settings.map((setting) => ({
    key: setting.key,
    value: setting.value,
    updatedAt: setting.updatedAt,
  }));
  const releaseGovernance: AdminReleaseGovernanceSnapshot = buildReleaseGovernanceSnapshot({
    auditLogs: core.auditLogs.map((row) => ({
      action: normalizeText(row.action),
      actorEmail: normalizeNullableText(row.actor_email),
      createdAt: normalizeNullableText(row.created_at),
      metadata: toRecord(row.metadata),
      targetDisplay: normalizeNullableText(row.target_display),
      targetType: normalizeNullableText(row.target_type),
    })),
    env,
    featureFlags: core.featureFlags,
    incidents: operational.incidentGroups,
    libraries: libraryRows,
    runtimeGovernance: operational.runtimeGovernance,
    runtimeVisibility: operational.runtimeVisibility,
    settingsMap,
    traceEvents: [
      ...operational.alertTraceEvents,
      ...operational.traceEvents,
    ],
  });

  const inactiveLibraryDays = parseSettingNumber(settingsMap.get("inactive_library_days")?.value) ?? 14;
  const inactiveLibraries = calculateInactiveLibraryRows({
    inactiveAfterDays: inactiveLibraryDays,
    lastActivityByLibraryId: core.lastActivityByLibraryId,
    libraries: core.libraries,
  });

  const { enabled: ipWhitelistEnabled, whitelist } = await readSuperAdminIpWhitelistStateSafely(env);
  const attendanceSignal = {
    detail: lastAttendanceAt
      ? `Last successful scan ${formatSignalTimestamp(lastAttendanceAt)}`
      : "Waiting for the first attendance scan to arrive.",
    label: "Attendance",
    status: latestPoint?.activeStudents
      ? "green"
      : previousPoint?.activeStudents
        ? "yellow"
        : "yellow",
    value: latestPoint?.activeStudents
      ? `${latestPoint.activeStudents} students today`
      : "Quiet today",
  } as const;
  const controlStatusSignals = [...statusData.signals, attendanceSignal];

  await Promise.allSettled(
    operational.alertTraceEvents
      .filter((event) => event.severity)
      .map((event) =>
        sendAdminAlert({
          message: event.message || event.type,
          metadata: event.metadata,
          severity: event.severity || "WARNING",
          type: event.type,
        }),
      ),
  );

  return buildApiSuccess("Super Admin control center loaded.", {
    generatedAt: nowIso(),
    maintenanceMode: operational.runtimeGovernance.maintenanceMode,
    releaseGovernance,
    systemStatus: statusData.systemStatus,
    settings,
    featureFlags: core.featureFlags,
    analytics: {
      activeLibraryCount,
      activeStudentsYesterday: previousPoint?.activeStudents ?? 0,
      activeSubscriptionCount,
      dailyActiveLibraries: latestPoint?.activeLibraries ?? 0,
      attendanceLibrariesYesterday: previousPoint?.activeLibraries ?? 0,
      activeStudentsToday: latestPoint?.activeStudents ?? 0,
      approvedTransactionsThisMonth,
      conversionRate: calculateConversionRate({
        paidLibraries: activeSubscriptionCount,
        totalLibraries: core.libraries.length,
      }),
      lastAttendanceAt,
      lastPaymentAt,
      revenueThisMonth: Number(revenueThisMonth.toFixed(2)),
      revenuePreviousMonth: Number(revenuePreviousMonth.toFixed(2)),
      revenueByCity: core.revenueByCity.map(mapRevenueCity),
      series,
      trialLibraryCount,
    },
    statusSignals: controlStatusSignals,
    incidents: operational.incidentGroups.slice(0, 12),
    libraries: libraryRows.slice(0, 12),
    security: {
      ipWhitelistEnabled,
      whitelist,
      failedLoginAttempts24h: loginSummary.failedAttempts,
      suspiciousIps: loginSummary.suspiciousIps,
    },
    automation: {
      queuedJobs: operational.jobs.filter((job) => job.status === "queued").length,
      failedJobs: operational.jobs.filter((job) => job.status === "failed").length,
      inactiveLibraries,
    },
    operator: buildActorOperatorContext(actor),
    runtimeGovernance: operational.runtimeGovernance,
  });
};

export const getRevenueCenterData = async (
  env: EnvLike,
): Promise<StructuredApiResponse<SuperAdminRevenueCenterData>> => {
  const client = buildServiceClient(env);
  const core = await loadCoreAdminData(env, client);
  const settingsMap = new Map(core.settings.map((setting) => [setting.key, setting]));
  const paymentHistory = buildPaymentHistoryRows({
    libraries: core.libraries,
    payments: core.payments,
    subscriptionPayments: core.subscriptionPayments,
  });

  return buildApiSuccess("Super Admin revenue center loaded.", {
    generatedAt: nowIso(),
    defaultCommissionPercent: parseSettingNumber(settingsMap.get("default_commission_percent")?.value) ?? 12.5,
    commissionOverrides: mapCommissionOverrides({
      libraries: core.libraries,
      rows: core.commissionOverrides,
    }),
    plans: core.plans.map(mapPlan),
    payouts: mapPayoutQueueRows({
      libraries: core.libraries,
      rows: core.payoutQueue,
    }),
    adjustments: mapRevenueAdjustments({
      libraries: core.libraries,
      rows: core.revenueAdjustments,
    }),
    paymentHistory,
    summary: {
      totalRevenue: Number(
        (
          core.payments.reduce((sum, row) => sum + toNumber(row.amount), 0) +
          core.subscriptionPayments.reduce((sum, row) => sum + toNumber(row.amount), 0) +
          core.revenueAdjustments.reduce((sum, row) => sum + toNumber(row.amount_delta), 0)
        ).toFixed(2)
      ),
      subscriptionRevenue: Number(
        core.subscriptionPayments.reduce((sum, row) => sum + toNumber(row.amount), 0).toFixed(2),
      ),
      studentRevenue: Number(core.payments.reduce((sum, row) => sum + toNumber(row.amount), 0).toFixed(2)),
      adjustmentRevenue: Number(
        core.revenueAdjustments.reduce((sum, row) => sum + toNumber(row.amount_delta), 0).toFixed(2),
      ),
      queuedPayoutAmount: Number(
        core.payoutQueue
          .filter((row) => normalizeText(row.status) === "queued")
          .reduce((sum, row) => sum + toNumber(row.amount), 0)
          .toFixed(2),
      ),
    },
  });
};

export const getLibraryCenterData = async (
  env: EnvLike,
): Promise<StructuredApiResponse<SuperAdminLibraryCenterData>> => {
  if (inflightLibraryCenterRequest) {
    return await inflightLibraryCenterRequest;
  }

  const request = (async () => {
    const client = buildServiceClient(env);
    const core = await loadLibraryCenterCoreData(client);
    const controlsByLibraryId = new Map(
      core.libraryControls.map((row) => [normalizeText(row.library_id), row] as const),
    );
    const subscriptionsByLibraryId = new Map(
      core.subscriptions.map((row) => [normalizeText(row.library_id), row] as const),
    );
    const ownerProfilesByUserId = new Map(
      core.profiles.map((profile) => [normalizeText(profile.user_id), profile] as const),
    );
    const activeImpersonationsByUserId = new Map(
      core.impersonationRows.map((row) => [normalizeText(row.target_user_id), row] as const),
    );
    const librariesById = new Map(core.libraries.map((library) => [normalizeText(library.id), library] as const));

    return buildApiSuccess("Super Admin library center loaded.", {
      generatedAt: nowIso(),
      libraries: buildLibraryControlRows({
        controls: controlsByLibraryId,
        lastActivityByLibraryId: core.lastActivityByLibraryId,
        libraries: core.libraries,
        ownerProfilesByUserId,
        subscriptionsByLibraryId,
      }),
      users: buildUserControlRows({
        accountControls: new Map(core.accountControls.map((row) => [normalizeText(row.user_id), row] as const)),
        activeImpersonationsByUserId,
        libraries: core.libraries,
        loginRows: core.loginRows,
        profiles: core.profiles,
        userRoles: core.userRoles,
      }),
      activityLogs: mapLibraryCenterActivityFeed({
        attendanceRows: core.attendanceRows,
        librariesById,
        loginRows: core.loginRows,
        platformActivityLogs: core.activityLogs,
      }),
      summary: buildLibraryCenterSummary({
        accountControls: core.accountControls,
        activeImpersonationsByUserId,
        controlsByLibraryId,
        libraries: core.libraries,
        ownerProfilesByUserId,
        subscriptionsByLibraryId,
      }),
    });
  })();

  inflightLibraryCenterRequest = request;
  try {
    return await request;
  } finally {
    if (inflightLibraryCenterRequest === request) {
      inflightLibraryCenterRequest = null;
    }
  }
};

export const getIncidentCenterData = async (
  env: EnvLike,
): Promise<StructuredApiResponse<SuperAdminIncidentCenterData>> => {
  const client = buildServiceClient(env);
  const core = await loadCoreAdminData(env, client);
  const settingsMap = new Map(core.settings.map((setting) => [setting.key, setting] as const));
  const statusData = await buildStatusSignals({
    client,
    env,
  });
  const operational = buildOperationalContext({
    core,
    loginSummary: buildLoginAttemptSummary(core.loginRows),
    settingsMap,
    statusData,
  });
  const operatorGovernance = await loadOperatorGovernanceSnapshot(client, operational.incidentGroups).catch(() => null);
  const coordination = operatorGovernance?.coordination ?? buildGovernanceCoordination({
    grants: [],
    incidents: operational.incidentGroups,
    requests: [],
  });

  return buildApiSuccess("Super Admin incident center loaded.", {
    analytics: {
      afterHoursEscalations: coordination.followTheSun.afterHoursEscalations,
      crossTeamEscalations: coordination.escalationLineage.length,
      delegatedRemediations: operatorGovernance?.forensics.summary.delegatedRemediations ?? 0,
      regionalFailovers: coordination.regionalFailovers.length,
      unresolvedOwnership: coordination.ownershipGaps.length,
    },
    coordination,
    generatedAt: nowIso(),
    groups: operational.incidentGroups,
    snapshots: core.metricSnapshots.map((row) => ({
      metricKey: normalizeText(row.metric_key),
      metricWindow: row.metric_window ?? "live",
      metricValue: toNumber(row.metric_value),
      capturedAt: normalizeText(row.captured_at) || nowIso(),
    })),
    summary: buildIncidentSummary(operational.incidentGroups),
  });
};

const loadOperatorGovernanceSnapshot = async (
  client: UntypedClient,
  incidentGroups: AdminIncidentGroup[] = [],
): Promise<AdminOperatorGovernanceSnapshot> => {
  await sweepExpiredGovernanceState(client);

  const [roleGrantRows, approvalRows, legacyAssignments, auditRows] = await Promise.all([
    readOptionalRows<RoleGrantRow>(
      client
        .from("super_admin_role_grants")
        .select("id, user_id, email, role, grant_mode, scope_type, scope_id, scope_label, reason, restrictions, starts_at, expires_at, revoked_at, created_at, metadata")
        .order("created_at", { ascending: false })
        .limit(200),
    ),
    readOptionalRows<ApprovalRequestRow>(
      client
        .from("super_admin_approval_requests")
        .select("id, action_id, status, requester_user_id, requester_email, fingerprint, target_type, target_id, target_display, reason, metadata, preview, policy, escalation_after, required_approvals, optional_second_approver, expires_at, approved_at, rejected_at, executed_at, cooldown_until, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ),
    readOptionalRows<OperatorAssignmentRow>(
      client
        .from("super_admin_operator_assignments")
        .select("user_id, email, role, is_active")
        .eq("is_active", true)
        .limit(200),
    ),
    readOptionalRows<AuditLogRow>(
      client
        .from("super_admin_audit_logs")
        .select("id, action, actor_email, actor_user_id, created_at, ip_address, metadata, request_id, target_display, target_id, target_type, user_agent")
        .order("created_at", { ascending: false })
        .limit(200),
    ),
  ]);

  const grants = roleGrantRows
    .map((row) => buildGrantFromRow(row))
    .filter((grant): grant is AdminOperatorGrant => Boolean(grant));
  const grantSummaries = grants.map((grant) => buildOperatorRoleGrantSummary(grant, grants));
  const approvalRequests = await loadApprovalRequestSummaries(client, approvalRows);
  const consistency = buildGovernanceConsistencyState({
    approvalRequests,
    grants: grantSummaries,
    recentAuditLogs: auditRows,
  });
  const hydratedApprovalRequests = approvalRequests.map((request) =>
    enrichApprovalRequestRuntime({
      ...request,
      stale:
        request.status !== "executed" &&
        Boolean(request.governanceVersion && request.governanceVersion !== consistency.governanceVersion),
    }),
  );
  const migration = {
    fallbackAccessActive: !grants.length && !legacyAssignments.length,
    legacyAssignmentCount: legacyAssignments.length,
    needsMigration: legacyAssignments.length > 0 && grants.length === 0,
    roleGrantCount: grants.length,
  };
  const activeElevations = buildActiveElevationFeed(grantSummaries, hydratedApprovalRequests);
  const conflicts = detectGovernanceConflicts({
    grants: grantSummaries,
    migrationNeedsMigration: migration.needsMigration,
    now: consistency.consistencyAt,
    requests: hydratedApprovalRequests,
  });
  const synchronization = buildGovernanceSynchronization({
    consistency: {
      governanceVersion: consistency.governanceVersion,
    },
    conflicts,
    requests: hydratedApprovalRequests,
  });
  const coordination = buildGovernanceCoordination({
    grants: grantSummaries,
    incidents: incidentGroups,
    requests: hydratedApprovalRequests,
  });
  const alerts = buildGovernanceAlerts({
    activeElevations,
    coordination,
    conflicts,
    migrationNeedsMigration: migration.needsMigration,
    now: consistency.consistencyAt,
    requests: hydratedApprovalRequests,
    synchronization,
  });
  const directory = buildGovernanceDirectory({
    activeElevations,
    grants: grantSummaries,
    requests: hydratedApprovalRequests,
  });
  const forensics = buildGovernanceForensics({
    auditEvents: auditRows.map((row) => ({
      action: normalizeNullableText(row.action),
      actorEmail: normalizeNullableText(row.actor_email),
      createdAt: normalizeNullableText(row.created_at),
      metadata: toRecord(row.metadata),
      targetType: normalizeNullableText(row.target_type),
    })),
    incidents: incidentGroups,
    requests: hydratedApprovalRequests,
  });
  const analytics = buildGovernanceAnalytics({
    activeElevations,
    conflicts,
    coordination,
    requests: hydratedApprovalRequests,
    synchronization,
  });
  const visibility = buildGovernanceVisibility({
    activeElevations,
    alerts,
    coordination,
    conflicts,
    requests: hydratedApprovalRequests,
    synchronization,
  });

  return {
    activeElevations,
    analytics,
    alerts,
    approvalRequests: hydratedApprovalRequests,
    conflicts,
    consistency,
    coordination,
    directory,
    forensics,
    grants: grantSummaries,
    migration,
    synchronization,
    visibility,
  };
};

const canActorReadGovernanceScopes = (
  actor: SuperAdminActorContext,
  targetScopes: AdminOperatorScope[],
) =>
  ["settings.read", "observability.read", "access.read"].some((permission) =>
    explainOperatorPermission({
      grants: actor.operatorGrants,
      permission: permission as AdminOperatorPermission,
      targetScopes,
    }).allowed,
  );

const filterOperatorGovernanceSnapshotForActor = (
  snapshot: AdminOperatorGovernanceSnapshot,
  actor: SuperAdminActorContext,
): AdminOperatorGovernanceSnapshot => {
  const visibleGrants = snapshot.grants.filter((grant) =>
    canActorReadGovernanceScopes(
      actor,
      buildAuthorityScopesFromScope({
        boundary: grant.boundary,
        scopeId: grant.scopeId,
        scopeLabel: grant.scopeLabel,
        scopeType: grant.scopeType,
      }),
    ),
  );
  const visibleRequests = snapshot.approvalRequests.filter((request) =>
    canActorReadGovernanceScopes(
      actor,
      request.authorityScopes.length
        ? request.authorityScopes
        : buildAuthorityScopesFromScope({
            boundary: request.boundary,
            scopeId: request.targetId,
            scopeLabel: request.targetDisplay,
            scopeType: "approval_request",
          }),
    ),
  );
  const visibleElevations = snapshot.activeElevations.filter((elevation) =>
    canActorReadGovernanceScopes(
      actor,
      buildAuthorityScopesFromScope({
        boundary: elevation.boundary,
        scopeId: null,
        scopeLabel: elevation.scopeLabel,
        scopeType: "global",
      }),
    ),
  );
  const actorTenantTokens = new Set(
    actor.operatorGrants
      .flatMap((grant) => [grant.boundary.tenantId, grant.boundary.tenantLabel])
      .filter((value): value is string => Boolean(value)),
  );
  const visibleConflicts = snapshot.conflicts.filter((conflict) =>
    conflict.targetType === "governance_runtime" ||
    visibleRequests.some((request) => request.id === conflict.targetId || conflict.requestIds.includes(request.id)) ||
    visibleGrants.some((grant) => grant.grantId === conflict.targetId || conflict.grantIds.includes(grant.grantId)),
  );
  const scopeMatchesActorTenant = (scopeSummary: string[]) =>
    actorTenantTokens.size === 0 ||
    scopeSummary.some((summary) =>
      [...actorTenantTokens].some((token) => summary.toLowerCase().includes(token.toLowerCase())),
    );
  const visibleSynchronization = buildGovernanceSynchronization({
    consistency: {
      governanceVersion: snapshot.consistency.governanceVersion,
    },
    conflicts: visibleConflicts,
    requests: visibleRequests,
  });
  const visibleCoordination = {
    ...snapshot.coordination,
    escalationLineage: snapshot.coordination.escalationLineage.filter((route) => scopeMatchesActorTenant(route.scopeSummary)),
    handoffs: snapshot.coordination.handoffs.filter((handoff) => scopeMatchesActorTenant(handoff.scopeSummary)),
    loadBalancing: {
      ...snapshot.coordination.loadBalancing,
      heatmap: snapshot.coordination.loadBalancing.heatmap.filter((cell) => actorTenantTokens.size === 0 || cell.label !== "Global"),
      operatorLoads: snapshot.coordination.loadBalancing.operatorLoads.filter(
        (load) =>
          actorTenantTokens.size === 0 ||
          load.regions.some((region) =>
            [...actorTenantTokens].some((token) => region.toLowerCase().includes(token.toLowerCase())),
          ),
      ),
    },
    ownershipGaps: snapshot.coordination.ownershipGaps.filter((gap) => scopeMatchesActorTenant(gap.scopeSummary)),
    regionalFailovers: snapshot.coordination.regionalFailovers,
  };
  const visibleAlerts = buildGovernanceAlerts({
    activeElevations: visibleElevations,
    coordination: visibleCoordination,
    conflicts: visibleConflicts,
    migrationNeedsMigration: snapshot.migration.needsMigration,
    now: snapshot.consistency.consistencyAt,
    requests: visibleRequests,
    synchronization: visibleSynchronization,
  });
  const visibleDirectory = buildGovernanceDirectory({
    activeElevations: visibleElevations,
    grants: visibleGrants,
    requests: visibleRequests,
  });
  const actorTenantIds = new Set(
    actor.operatorGrants
      .map((grant) => grant.boundary.tenantId)
      .filter((value): value is string => Boolean(value)),
  );
  const visibleForensics = {
    records: snapshot.forensics.records.filter((record) =>
      (record.requestId && visibleRequests.some((request) => request.id === record.requestId)) ||
      (!record.tenantId || actorTenantIds.size === 0 || actorTenantIds.has(record.tenantId)),
    ),
    summary: snapshot.forensics.summary,
  };
  const visibility = buildGovernanceVisibility({
    activeElevations: visibleElevations,
    alerts: visibleAlerts,
    coordination: visibleCoordination,
    conflicts: visibleConflicts,
    requests: visibleRequests,
    synchronization: visibleSynchronization,
  });
  const analytics = buildGovernanceAnalytics({
    activeElevations: visibleElevations,
    conflicts: visibleConflicts,
    coordination: visibleCoordination,
    requests: visibleRequests,
    synchronization: visibleSynchronization,
  });

  return {
    ...snapshot,
    activeElevations: visibleElevations,
    analytics,
    alerts: visibleAlerts,
    approvalRequests: visibleRequests,
    conflicts: visibleConflicts,
    coordination: visibleCoordination,
    directory: visibleDirectory,
    forensics: {
      records: visibleForensics.records,
      summary: {
        crossTeamEscalations: visibleForensics.records.filter((record) => record.category === "cross_team_escalation").length,
        delegatedApprovals: visibleForensics.records.filter((record) => record.category === "delegated_approval").length,
        delegatedRemediations: visibleForensics.records.filter((record) => record.category === "delegated_remediation").length,
        organizationIncidents: visibleForensics.records.filter((record) => record.category === "organization_incident").length,
        ownershipTransitions: visibleForensics.records.filter((record) => record.category === "ownership_transition").length,
        regionalFailovers: visibleForensics.records.filter((record) => record.category === "regional_failover").length,
        scopedImpersonations: visibleForensics.records.filter((record) => record.category === "scoped_impersonation").length,
        tenantOverrides: visibleForensics.records.filter((record) => record.category === "tenant_override").length,
      },
    },
    grants: visibleGrants,
    synchronization: visibleSynchronization,
    visibility,
  };
};

export const getSecurityCenterData = async (
  env: EnvLike,
  actor?: SuperAdminActorContext,
): Promise<StructuredApiResponse<SuperAdminSecurityCenterData>> => {
  const client = buildServiceClient(env);
  const core = await loadCoreAdminData(env, client);
  const loginSummary = buildLoginAttemptSummary(core.loginRows);
  const settingsMap = new Map(core.settings.map((setting) => [setting.key, setting] as const));
  const statusData = await buildStatusSignals({
    client,
    env,
  });
  const operational = buildOperationalContext({
    core,
    loginSummary,
    settingsMap,
    statusData,
  });
  const { enabled: ipWhitelistEnabled, whitelist } = await readSuperAdminIpWhitelistStateSafely(env);
  const operatorGovernanceSnapshot = await loadOperatorGovernanceSnapshot(client, operational.incidentGroups).catch(() => null);
  const operatorGovernance = operatorGovernanceSnapshot
    ? actor
      ? filterOperatorGovernanceSnapshotForActor(operatorGovernanceSnapshot, actor)
      : operatorGovernanceSnapshot
    : undefined;
  const accessLogs: AdminActivityLog[] = core.loginRows
    .filter((row) => normalizeText(row.login_step) === "otp" || normalizeText(row.login_step) === "email")
    .map((row) => ({
      id: normalizeText(row.id) || randomUUID(),
      createdAt: normalizeText(row.login_time) || nowIso(),
      activityType: "super_admin_access",
      message: `${normalizeText(row.status) || "unknown"} login from ${normalizeText(row.ip_address) || "unknown ip"}.`,
      libraryId: null,
      userId: normalizeNullableText(row.user_id),
      actorUserId: normalizeNullableText(row.user_id),
      metadata: {
        device: normalizeNullableText(row.device),
        email: normalizeNullableText(row.email),
        reason: normalizeNullableText(row.reason),
      },
    }))
    .slice(0, 100);

  return buildApiSuccess("Super Admin security center loaded.", {
    generatedAt: nowIso(),
    ipWhitelistEnabled,
    whitelist,
    accessLogs,
    auditLogs: core.auditLogs.map((row) => ({
      id: normalizeText(row.id) || randomUUID(),
      createdAt: normalizeText(row.created_at) || nowIso(),
      action: normalizeText(row.action),
      actorEmail: normalizeNullableText(row.actor_email),
      metadata: toRecord(row.metadata),
      targetType: normalizeText(row.target_type) || "unknown",
      targetDisplay: normalizeNullableText(row.target_display),
      ipAddress: normalizeNullableText(row.ip_address),
    })),
    operatorGovernance,
    suspiciousIps: loginSummary.suspiciousIps,
    eventLogs: [
      ...operational.alertTraceEvents,
      ...operational.traceEvents,
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 200),
    runtimeVisibility: operational.runtimeVisibility,
  });
};

export const getCommunicationCenterData = async (
  env: EnvLike,
): Promise<StructuredApiResponse<SuperAdminCommunicationCenterData>> => {
  const client = buildServiceClient(env);
  const core = await loadCoreAdminData(env, client);
  const observabilityClient = createObservabilityServiceClient(env);
  const emailRows = observabilityClient
    ? await readOptionalRows<AppEventLogRow>(
        observabilityClient
          .from("app_event_logs")
          .select("status, event_type")
          .or("event_type.eq.EMAIL_SENT,event_type.eq.EMAIL_FAILED")
          .order("created_at", { ascending: false })
          .limit(100),
      )
    : [];
  const notificationRows = await readOptionalRows<Record<string, unknown>>(
    client
      .from("notifications")
      .select("delivery_status")
      .order("created_at", { ascending: false })
      .limit(300),
  );

  return buildApiSuccess("Super Admin communication center loaded.", {
    generatedAt: nowIso(),
    templates: mapTemplates(core.templates),
    broadcasts: mapBroadcasts(core.broadcasts),
    deliveryHealth: {
      emailSuccessRate: buildSuccessRate(
        emailRows.map((row) => ({
          status: normalizeText(row.status).toUpperCase() === "SUCCESS" ? "SUCCESS" : "FAILED",
          total_count: 1,
        })),
      ),
      queuedNotifications: notificationRows.filter((row) => normalizeText(row.delivery_status) === "queued").length,
      failedNotifications: notificationRows.filter((row) => normalizeText(row.delivery_status) === "failed").length,
    },
  });
};

export const getBillingCenterData = async (
  env: EnvLike,
): Promise<StructuredApiResponse<SuperAdminBillingCenterData>> => {
  const client = buildServiceClient(env);
  const core = await loadCoreAdminData(env, client);
  const settingsMap = new Map(core.settings.map((setting) => [setting.key, setting]));
  const statusData = await buildStatusSignals({
    client,
    env,
  });
  const operational = buildOperationalContext({
    core,
    loginSummary: buildLoginAttemptSummary(core.loginRows),
    settingsMap,
    statusData,
  });

  return buildApiSuccess("Super Admin billing center loaded.", {
    generatedAt: nowIso(),
    invoices: mapInvoices({
      libraries: core.libraries,
      rows: core.invoices,
    }),
    refunds: mapRefunds({
      libraries: core.libraries,
      rows: core.refunds,
    }),
    paymentHistory: operational.paymentHistory,
    gstRatePercent: parseSettingNumber(settingsMap.get("gst_rate_percent")?.value) ?? 18,
    operations: operational.billingOperations,
  });
};

export const getAutomationCenterData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
): Promise<StructuredApiResponse<SuperAdminAutomationCenterData>> => {
  const client = buildServiceClient(env);
  await ensureDefaultAutomationJobsSafely(client, actor.actorUserId);
  const core = await loadCoreAdminData(env, client);
  const settingsMap = new Map(core.settings.map((setting) => [setting.key, setting]));
  const statusData = await buildStatusSignals({
    client,
    env,
  });
  const operational = buildOperationalContext({
    core,
    loginSummary: buildLoginAttemptSummary(core.loginRows),
    settingsMap,
    statusData,
  });

  return buildApiSuccess("Super Admin automation center loaded.", {
    generatedAt: nowIso(),
    jobs: operational.jobs,
    deadLetters: operational.deadLetters,
    settings: {
      inactiveLibraryDays: parseSettingNumber(settingsMap.get("inactive_library_days")?.value) ?? 14,
      automationSubscriptionRenewalEnabled:
        parseSettingBoolean(settingsMap.get("automation_subscription_renewal_enabled")?.value) ?? true,
      automationPaymentReminderEnabled:
        parseSettingBoolean(settingsMap.get("automation_payment_reminder_enabled")?.value) ?? true,
      automationInactiveLibraryAlertEnabled:
        parseSettingBoolean(settingsMap.get("automation_inactive_library_alert_enabled")?.value) ?? true,
    },
    summary: operational.automationSummary,
  });
};

const GOVERNANCE_SETTING_KEYS = new Set([
  "maintenance_mode",
  "ops_billing_mutations_enabled",
  "ops_dependency_disable_stripe",
  "ops_maintenance_escalation_active",
  "ops_notifications_enabled",
  "ops_queue_processing_enabled",
  "release_governance_policy",
  "super_admin_ip_whitelist",
  "super_admin_ip_whitelist_enabled",
]);

const EMERGENCY_SETTING_KEYS = new Set([
  "ops_billing_mutations_enabled",
  "ops_dependency_disable_stripe",
  "ops_maintenance_escalation_active",
  "ops_notifications_enabled",
  "ops_queue_processing_enabled",
]);

const formatOperatorImpactValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value == null) {
    return "unset";
  }

  if (typeof value === "boolean") {
    return value ? "enabled" : "disabled";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};

export const getPlatformSettingsData = async (
  env: EnvLike,
): Promise<StructuredApiResponse<{ featureFlags: AdminFeatureFlag[]; settings: AdminPlatformSetting[] }>> => {
  const client = buildServiceClient(env);
  const settings = await getPlatformSettings(env);
  const featureFlags = await loadFeatureFlags(env, client);

  return buildApiSuccess("Platform settings loaded.", {
    settings: settings.map((setting) => ({
      key: setting.key,
      value: setting.value,
      updatedAt: setting.updatedAt,
    })),
    featureFlags,
  });
};

export const updatePlatformSettingsData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: {
    settings: Record<string, unknown>;
    actionToken?: string | null;
    confirmationText?: string | null;
    dryRun?: boolean;
    operatorReason?: string | null;
  },
) => {
  const updates = Object.entries(input.settings ?? {})
    .filter(([key]) => key !== "requestId")
    .map(([key, value]) => ({ key, value }));

  if (!updates.length) {
    return buildApiFailure("No platform settings were provided.", "INVALID_REQUEST");
  }

  const client = buildServiceClient(env);

  // Fast path: maintenance_mode toggle skips governance guard entirely
  const isMaintenanceOnlyToggle =
    updates.length === 1 && updates[0].key === "maintenance_mode" && !input.dryRun;

  if (isMaintenanceOnlyToggle) {
    const updatedSettings = await Promise.all(
      updates.map(({ key, value }) => upsertPlatformSetting(env, key, value, actor.actorUserId)),
    );

    await recordAdminAction(client, actor, {
      action: "platform_settings_updated",
      activityMessage: `Maintenance mode ${updates[0].value ? "enabled" : "disabled"}.`,
      activityType: "platform_settings_updated",
      metadata: {
        before: { maintenance_mode: !updates[0].value },
        operator_reason: input.operatorReason ?? "Maintenance mode toggled.",
        after: { maintenance_mode: updates[0].value },
        settings: ["maintenance_mode"],
      },
      operatorActionId: "governance_toggle",
      targetDisplay: "maintenance_mode",
      targetType: "platform_setting",
    });

    return buildApiSuccess("Maintenance mode updated.", {
      settings: updatedSettings.map((setting) => ({
        key: setting.key,
        value: setting.value,
        updatedAt: setting.updatedAt,
      })),
    });
  }

  const existingSettings = await getPlatformSettings(env);
  const existingSettingsMap = new Map(existingSettings.map((setting) => [setting.key, setting.value]));
  const actionId = updates.some(({ key }) => EMERGENCY_SETTING_KEYS.has(key))
    ? "emergency_control"
    : "governance_toggle";
  const fingerprint = buildOperatorFingerprint({
    actionId,
    settings: updates.map((entry) => ({
      after: entry.value,
      before: existingSettingsMap.get(entry.key),
      key: entry.key,
    })),
  });
  const guard = await enforceOperatorActionGuard({
    actionId,
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint,
    previewBuilder: () => ({
      actionId,
      confirmationLabel: getActionConfirmationLabel(actionId),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: "low",
      existingCaptureLineage: [],
      idempotencyKey: null,
      impacts: updates.map(({ key, value }) => ({
        after: formatOperatorImpactValue(value),
        before: formatOperatorImpactValue(existingSettingsMap.get(key)),
        detail:
          EMERGENCY_SETTING_KEYS.has(key)
            ? "Protected production control."
            : GOVERNANCE_SETTING_KEYS.has(key)
              ? "Runtime governance setting."
              : "Platform setting update.",
        label: key,
      })),
      requiresReason: true,
      reversible: true,
      retryHistory: [],
      severity: getActionDefinition(actionId).severity,
      summary:
        actionId === "emergency_control"
          ? "This change updates protected production controls and will immediately alter runtime behavior."
          : "This change updates platform runtime governance and remains reversible through the same settings console.",
      targetDisplay: updates.map((setting) => setting.key).join(", "),
      title: getActionDefinition(actionId).label,
      token: null,
      traceLineage: [],
      warnings: updates
        .filter(({ key, value }) => EMERGENCY_SETTING_KEYS.has(key) && value === false)
        .map(({ key }) => `${key} will move into an active emergency state.`),
    }),
    reason: input.operatorReason,
    targetDisplay: updates.map((setting) => setting.key).join(", "),
    targetId: updates.map((setting) => setting.key).join(","),
    targetType: "platform_setting",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  const updatedSettings = await Promise.all(
    updates.map(({ key, value }) => upsertPlatformSetting(env, key, value, actor.actorUserId)),
  );

  await recordAdminAction(client, actor, {
    action: "platform_settings_updated",
    activityMessage: `Updated ${updatedSettings.length} platform settings.`,
    activityType: "platform_settings_updated",
    metadata: {
      before: Object.fromEntries(updates.map(({ key }) => [key, existingSettingsMap.get(key) ?? null])),
      operator_reason: guard.reason,
      after: Object.fromEntries(updatedSettings.map((setting) => [setting.key, setting.value])),
      settings: updatedSettings.map((setting) => setting.key),
    },
    operatorActionId: actionId,
    targetDisplay: updatedSettings.map((setting) => setting.key).join(", "),
    targetType: "platform_setting",
  });

  return buildApiSuccess("Platform settings updated.", {
    settings: updatedSettings.map((setting) => ({
      key: setting.key,
      value: setting.value,
      updatedAt: setting.updatedAt,
    })),
  });
};

export const updateFeatureFlagData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminFeatureFlagInput,
) => {
  const client = buildServiceClient(env);
  const key = normalizeText(input.key);
  if (!key) {
    return buildApiFailure("Feature flag key is required.", "INVALID_REQUEST");
  }

  const existing = await readMaybeSingle<FeatureFlagRow>(
    client
      .from("feature_flags")
      .select("id, key, name, description, is_enabled, rollout_percentage, cache_ttl_seconds, config, variants, updated_at")
      .eq("key", key)
      .maybeSingle(),
  );

  const guard = await enforceOperatorActionGuard({
    actionId: "feature_flag_update",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      config: input.config ?? {},
      enabled: input.enabled,
      key,
      rolloutPercentage: input.rolloutPercentage ?? null,
      variants: input.variants ?? [],
    }),
    previewBuilder: () => ({
      actionId: "feature_flag_update",
      confirmationLabel: getActionConfirmationLabel("feature_flag_update"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: "low",
      existingCaptureLineage: [],
      idempotencyKey: null,
      impacts: [
        {
          after: input.enabled ? "enabled" : "disabled",
          before: existing?.is_enabled == null ? "unset" : existing.is_enabled ? "enabled" : "disabled",
          label: "enabled",
        },
        {
          after: String(input.rolloutPercentage ?? existing?.rollout_percentage ?? 100),
          before: String(existing?.rollout_percentage ?? 100),
          label: "rollout_percentage",
        },
      ],
      requiresReason: true,
      reversible: true,
      retryHistory: [],
      severity: getActionDefinition("feature_flag_update").severity,
      summary: "Feature flag updates are protected because they can change production behavior immediately.",
      targetDisplay: key,
      title: getActionDefinition("feature_flag_update").label,
      token: null,
      traceLineage: [],
      warnings: [],
    }),
    reason: typeof input.config?.reason === "string" ? String(input.config.reason) : null,
    targetDisplay: key,
    targetId: key,
    targetType: "feature_flag",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  const fallback = FALLBACK_FEATURE_FLAGS[key];
  const updated = await readMaybeSingle<FeatureFlagRow>(
    client
      .from("feature_flags")
      .upsert(
        {
          cache_ttl_seconds: existing?.cache_ttl_seconds ?? fallback?.cacheTtlSeconds ?? DEFAULT_FEATURE_FLAG_TTL_SECONDS,
          config: input.config ?? existing?.config ?? fallback?.config ?? {},
          description: existing?.description ?? fallback?.description ?? key,
          is_enabled: input.enabled,
          key,
          name: existing?.name ?? fallback?.name ?? key,
          rollout_percentage: input.rolloutPercentage ?? existing?.rollout_percentage ?? fallback?.rolloutPercentage ?? 100,
          updated_by: actor.actorUserId,
          variants: input.variants ?? existing?.variants ?? fallback?.variants ?? [],
        },
        { onConflict: "key" },
      )
      .select("key, name, description, is_enabled, rollout_percentage, cache_ttl_seconds, config, variants, updated_at")
      .maybeSingle(),
  );

  const flag = toFeatureFlag(updated ?? existing ?? { key }, "database");
  await writeFeatureFlagCache(env, [flag, ...(await loadFeatureFlags(env, client)).filter((candidate) => candidate.key !== flag.key)]);

  await recordAdminAction(client, actor, {
    action: "feature_flag_updated",
    activityMessage: `Updated feature flag ${flag.name}.`,
    activityType: "feature_flag_updated",
    metadata: {
      enabled: flag.enabled,
      operator_reason: guard.reason,
      rollout_percentage: flag.rolloutPercentage,
    },
    operatorActionId: "feature_flag_update",
    targetDisplay: flag.name,
    targetId: flag.key,
    targetType: "feature_flag",
  });

  return buildApiSuccess("Feature flag updated.", {
    featureFlag: flag,
  });
};

export const createRevenueAdjustmentData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminRevenueAdjustmentInput,
) => {
  const client = buildServiceClient(env);
  if (!normalizeText(input.libraryId) || !normalizeText(input.reason) || Number.isNaN(Number(input.amountDelta))) {
    return buildApiFailure("Library, amount delta, and reason are required.", "INVALID_REQUEST");
  }

  const guard = await enforceOperatorActionGuard({
    actionId: "revenue_adjustment",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      amountDelta: input.amountDelta,
      libraryId: input.libraryId,
      paymentId: input.paymentId ?? null,
      reason: input.reason,
      subscriptionPaymentId: input.subscriptionPaymentId ?? null,
    }),
    previewBuilder: () => ({
      actionId: "revenue_adjustment",
      confirmationLabel: getActionConfirmationLabel("revenue_adjustment"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: "medium",
      existingCaptureLineage: [],
      idempotencyKey: normalizeNullableText(input.subscriptionPaymentId ?? input.paymentId),
      impacts: [
        {
          after: Number(input.amountDelta) >= 0 ? `+${input.amountDelta}` : String(input.amountDelta),
          before: "0",
          detail: input.reason,
          label: "revenue_delta",
        },
      ],
      requiresReason: true,
      reversible: false,
      retryHistory: [],
      severity: getActionDefinition("revenue_adjustment").severity,
      summary: "Revenue adjustments directly affect financial reporting and require an audit reason.",
      targetDisplay: input.libraryId,
      title: getActionDefinition("revenue_adjustment").label,
      token: null,
      traceLineage: [],
      warnings: [],
    }),
    reason: input.reason,
    targetDisplay: input.libraryId,
    targetId: input.libraryId,
    targetType: "revenue_adjustment",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  const row = await readMaybeSingle<RevenueAdjustmentRow>(
    client
      .from("revenue_adjustments")
      .insert({
        amount_delta: input.amountDelta,
        created_by: actor.actorUserId,
        library_id: input.libraryId,
        payment_id: input.paymentId ?? null,
        reason: input.reason,
        subscription_payment_id: input.subscriptionPaymentId ?? null,
      })
      .select("id, library_id, payment_id, subscription_payment_id, amount_delta, reason, created_at, created_by")
      .maybeSingle(),
  );

  const currentLibrary = await readMaybeSingle<LibraryRow>(
    client
      .from("libraries")
      .select("id, name, monthly_revenue")
      .eq("id", input.libraryId)
      .maybeSingle(),
  );

  if (currentLibrary) {
    await client
      .from("libraries")
      .update({
        monthly_revenue: Math.max(0, toNumber(currentLibrary.monthly_revenue) + input.amountDelta),
      })
      .eq("id", input.libraryId);
  }

  await recordAdminAction(client, actor, {
    action: "revenue_adjustment_created",
    activityMessage: `Adjusted revenue for ${normalizeText(currentLibrary?.name) || "library"}.`,
    activityType: "revenue_adjustment_created",
    libraryId: input.libraryId,
    metadata: {
      amount_delta: input.amountDelta,
      operator_reason: guard.reason,
      reason: input.reason,
    },
    operatorActionId: "revenue_adjustment",
    targetDisplay: normalizeText(currentLibrary?.name) || input.libraryId,
    targetId: normalizeText(row?.id),
    targetType: "revenue_adjustment",
  });

  return buildApiSuccess("Revenue adjustment created.", {
    adjustment: row,
  });
};

export const updateCommissionData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminCommissionUpdateInput,
) => {
  const client = buildServiceClient(env);
  const updates: JsonRecord = {};

  if (typeof input.defaultCommissionPercent === "number") {
    await upsertPlatformSetting(
      env,
      "default_commission_percent",
      input.defaultCommissionPercent,
      actor.actorUserId,
    );
    updates.defaultCommissionPercent = input.defaultCommissionPercent;
  }

  if (normalizeText(input.libraryId)) {
    await client.from("library_commission_overrides").upsert(
      {
        commission_percent: input.commissionPercent,
        library_id: input.libraryId,
        notes: input.notes ?? null,
        updated_by: actor.actorUserId,
      },
      {
        onConflict: "library_id",
      },
    );
    updates.libraryId = input.libraryId;
    updates.commissionPercent = input.commissionPercent ?? null;
  }

  if (!Object.keys(updates).length) {
    return buildApiFailure("No commission changes were provided.", "INVALID_REQUEST");
  }

  const guard = await enforceOperatorActionGuard({
    actionId: "commission_override",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      commissionPercent: input.commissionPercent ?? null,
      defaultCommissionPercent: input.defaultCommissionPercent ?? null,
      libraryId: input.libraryId ?? null,
      notes: input.notes ?? null,
    }),
    previewBuilder: () => ({
      actionId: "commission_override",
      confirmationLabel: getActionConfirmationLabel("commission_override"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: "medium",
      existingCaptureLineage: [],
      idempotencyKey: null,
      impacts: Object.entries(updates).map(([key, value]) => ({
        after: formatOperatorImpactValue(value),
        before: "current",
        label: key,
      })),
      requiresReason: true,
      reversible: true,
      retryHistory: [],
      severity: getActionDefinition("commission_override").severity,
      summary: "Commission overrides affect platform and partner revenue distribution.",
      targetDisplay: normalizeNullableText(input.libraryId) ?? "default commission",
      title: getActionDefinition("commission_override").label,
      token: null,
      traceLineage: [],
      warnings: [],
    }),
    reason: input.notes,
    targetDisplay: normalizeNullableText(input.libraryId) ?? "default commission",
    targetId: normalizeNullableText(input.libraryId) ?? "default_commission",
    targetType: normalizeText(input.libraryId) ? "library_commission_override" : "platform_commission",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  await recordAdminAction(client, actor, {
    action: "commission_updated",
    activityMessage: "Updated commission settings.",
    activityType: "commission_updated",
    libraryId: normalizeNullableText(input.libraryId),
    metadata: {
      ...updates,
      operator_reason: guard.reason,
    },
    operatorActionId: "commission_override",
    targetDisplay: normalizeNullableText(input.libraryId),
    targetId: normalizeNullableText(input.libraryId),
    targetType: normalizeText(input.libraryId) ? "library_commission_override" : "platform_commission",
  });

  return buildApiSuccess("Commission settings updated.", {
    updates,
  });
};

export const processPayoutActionData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminLibraryActionInput,
) => {
  const client = buildServiceClient(env);
  const payoutId = normalizeText(input.payoutId);
  if (!payoutId) {
    return buildApiFailure("Payout ID is required.", "INVALID_REQUEST");
  }

  const nextStatus =
    input.action === "approve_payout"
      ? "approved"
      : input.action === "reject_payout"
        ? "rejected"
        : input.action === "mark_payout_paid"
          ? "paid"
          : "";
  if (!nextStatus) {
    return buildApiFailure("Unsupported payout action.", "INVALID_REQUEST");
  }

  const existingPayout = await readMaybeSingle<PayoutQueueRow>(
    client
      .from("library_payout_queue")
      .select("id, library_id, amount, currency, status, note, requested_at, approved_at, processed_at")
      .eq("id", payoutId)
      .maybeSingle(),
  );
  const guard = await enforceOperatorActionGuard({
    actionId: "payout_override",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      amount: existingPayout?.amount ?? null,
      nextStatus,
      note: input.note ?? null,
      payoutId,
    }),
    previewBuilder: () => ({
      actionId: "payout_override",
      confirmationLabel: getActionConfirmationLabel("payout_override"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: nextStatus === "paid" ? "high" : "medium",
      existingCaptureLineage: [],
      idempotencyKey: payoutId,
      impacts: [
        {
          after: nextStatus,
          before: normalizeText(existingPayout?.status) || "unknown",
          detail: input.note ?? null,
          label: "payout_status",
        },
        {
          after: formatOperatorImpactValue(existingPayout?.amount),
          before: formatOperatorImpactValue(existingPayout?.amount),
          label: "payout_amount",
        },
      ],
      requiresReason: true,
      reversible: false,
      retryHistory: [],
      severity: getActionDefinition("payout_override").severity,
      summary: "Payout overrides directly affect outbound funds and require a typed operator note.",
      targetDisplay: payoutId,
      title: getActionDefinition("payout_override").label,
      token: null,
      traceLineage: [],
      warnings:
        normalizeText(existingPayout?.status) === nextStatus
          ? ["This payout is already in the requested state."]
          : [],
    }),
    reason: input.note,
    targetDisplay: payoutId,
    targetId: payoutId,
    targetType: "library_payout",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  const updatePayload: JsonRecord = {
    note: input.note ?? null,
    processed_by: actor.actorUserId,
    status: nextStatus,
  };
  if (nextStatus === "approved") {
    updatePayload.approved_at = nowIso();
  }
  if (nextStatus === "paid" || nextStatus === "rejected") {
    updatePayload.processed_at = nowIso();
  }

  const row = await readMaybeSingle<PayoutQueueRow>(
    client
      .from("library_payout_queue")
      .update(updatePayload)
      .eq("id", payoutId)
      .select("id, library_id, amount, currency, status, note, requested_at, approved_at, processed_at")
      .maybeSingle(),
  );

  await recordAdminAction(client, actor, {
    action: `payout_${nextStatus}`,
    activityMessage: `Marked payout ${payoutId} as ${nextStatus}.`,
    activityType: `payout_${nextStatus}`,
    libraryId: normalizeNullableText(row?.library_id),
    metadata: {
      payout_id: payoutId,
      operator_reason: guard.reason,
      status: nextStatus,
    },
    operatorActionId: "payout_override",
    targetDisplay: payoutId,
    targetId: payoutId,
    targetType: "library_payout",
  });

  return buildApiSuccess("Payout updated.", {
    payout: row,
  });
};

export const upsertPlanData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminPlanUpsertInput,
) => {
  const client = buildServiceClient(env);
  if (!normalizeText(input.code) || !normalizeText(input.name)) {
    return buildApiFailure("Plan code and name are required.", "INVALID_REQUEST");
  }

  const row = await readMaybeSingle<PlanRow>(
    client
      .from("subscription_plans")
      .upsert(
        {
          code: input.code,
          description: input.description ?? null,
          features: input.features ?? [],
          id: input.id,
          is_active: input.isActive ?? true,
          lockers_limit: input.lockersLimit ?? null,
          name: input.name,
          price: input.price,
          seats_limit: input.seatsLimit ?? null,
          sort_order: input.sortOrder ?? 0,
        },
        input.id ? { onConflict: "id" } : { onConflict: "code" },
      )
      .select("id, code, name, description, price, seats_limit, lockers_limit, features, is_active, sort_order, updated_at")
      .maybeSingle(),
  );

  await recordAdminAction(client, actor, {
    action: "subscription_plan_saved",
    activityMessage: `Saved subscription plan ${normalizeText(row?.name) || input.name}.`,
    activityType: "subscription_plan_saved",
    metadata: {
      code: input.code,
      price: input.price,
    },
    targetDisplay: normalizeText(row?.name) || input.name,
    targetId: normalizeText(row?.id),
    targetType: "subscription_plan",
  });

  return buildApiSuccess("Subscription plan saved.", {
    plan: row ? mapPlan(row) : null,
  });
};

export const deletePlanData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  planId: string,
) => {
  const client = buildServiceClient(env);
  const normalizedPlanId = normalizeText(planId);
  if (!normalizedPlanId) {
    return buildApiFailure("Plan ID is required.", "INVALID_REQUEST");
  }

  const existing = await readMaybeSingle<PlanRow>(
    client
      .from("subscription_plans")
      .select("id, name")
      .eq("id", normalizedPlanId)
      .maybeSingle(),
  );

  await client
    .from("subscription_plans")
    .delete()
    .eq("id", normalizedPlanId);

  await recordAdminAction(client, actor, {
    action: "subscription_plan_deleted",
    activityMessage: `Deleted subscription plan ${normalizeText(existing?.name) || normalizedPlanId}.`,
    activityType: "subscription_plan_deleted",
    metadata: {
      plan_id: normalizedPlanId,
    },
    targetDisplay: normalizeText(existing?.name) || normalizedPlanId,
    targetId: normalizedPlanId,
    targetType: "subscription_plan",
  });

  return buildApiSuccess("Subscription plan deleted.", {
    deletedPlanId: normalizedPlanId,
  });
};

export const performLibraryActionData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminLibraryActionInput,
) => {
  const client = buildServiceClient(env);
  const libraryId = normalizeText(input.libraryId);
  if (!libraryId) {
    return buildApiFailure("Library ID is required.", "INVALID_REQUEST");
  }

  const library = await readMaybeSingle<LibraryRow>(
    client
      .from("libraries")
      .select("id, name, enabled")
      .eq("id", libraryId)
      .maybeSingle(),
  );
  if (!library) {
    return buildApiFailure("Library not found.", "NOT_FOUND");
  }

  if (input.action === "approve_payout" || input.action === "reject_payout" || input.action === "mark_payout_paid") {
    return processPayoutActionData(env, actor, input);
  }

  const libraryControlGuard = await enforceOperatorActionGuard({
    actionId: "library_control",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      action: input.action,
      libraryId,
      note: input.note ?? null,
      untilAt: input.untilAt ?? null,
    }),
    reason: input.note,
    targetDisplay: normalizeText(library.name),
    targetId: libraryId,
    targetType: "library",
    token: input.actionToken,
  });

  if (libraryControlGuard.response) {
    return libraryControlGuard.response;
  }

  if (input.action === "enable" || input.action === "disable") {
    await client
      .from("libraries")
      .update({
        enabled: input.action === "enable",
      })
      .eq("id", libraryId);

    await recordAdminAction(client, actor, {
      action: `library_${input.action}`,
      activityMessage: `${input.action === "enable" ? "Enabled" : "Disabled"} ${normalizeText(library.name)}.`,
      activityType: `library_${input.action}`,
      libraryId,
      metadata: {
        enabled: input.action === "enable",
        note: input.note ?? null,
        operator_reason: libraryControlGuard.reason,
      },
      operatorActionId: "library_control",
      targetDisplay: normalizeText(library.name),
      targetId: libraryId,
      targetType: "library",
    });

    return buildApiSuccess("Library status updated.", {
      enabled: input.action === "enable",
      libraryId,
    });
  }

  const controlStatus =
    input.action === "ban" ? "banned" : input.action === "suspend" ? "suspended" : "active";
  await client.from("library_control_overrides").upsert(
    {
      library_id: libraryId,
      reason: input.action === "clear_control" ? null : input.note ?? null,
      status: controlStatus,
      until_at: input.action === "clear_control" ? null : input.untilAt ?? null,
      updated_by: actor.actorUserId,
    },
    {
      onConflict: "library_id",
    },
  );

  await recordAdminAction(client, actor, {
    action: `library_${input.action}`,
    activityMessage: `${normalizeText(library.name)} is now ${controlStatus}.`,
    activityType: `library_${input.action}`,
    libraryId,
    metadata: {
      note: input.note ?? null,
      operator_reason: libraryControlGuard.reason,
      until_at: input.untilAt ?? null,
    },
    operatorActionId: "library_control",
    targetDisplay: normalizeText(library.name),
    targetId: libraryId,
    targetType: "library",
  });

  return buildApiSuccess("Library control updated.", {
    libraryId,
    status: controlStatus,
  });
};

export const performUserActionData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminUserActionInput,
) => {
  const client = buildServiceClient(env);
  const userId = normalizeText(input.userId);
  if (!userId) {
    return buildApiFailure("User ID is required.", "INVALID_REQUEST");
  }

  const profile = await readMaybeSingle<ProfileRow>(
    client
      .from("profiles")
      .select("user_id, email, full_name")
      .eq("user_id", userId)
      .maybeSingle(),
  );

  if (!profile) {
    return buildApiFailure("User not found.", "NOT_FOUND");
  }

  if (input.action === "force_logout" || input.action === "clear_sessions") {
    const sessionClearGuard = await enforceOperatorActionGuard({
      actionId: "session_clear",
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        action: input.action,
        libraryId: input.libraryId ?? null,
        note: input.note ?? null,
        userId,
      }),
      reason: input.note,
      targetDisplay: normalizeText(profile.full_name) || normalizeText(profile.email) || userId,
      targetId: userId,
      targetType: "user",
      token: input.actionToken,
    });

    if (sessionClearGuard.response) {
      return sessionClearGuard.response;
    }

    await Promise.all([
      client
        .from("auth_trusted_devices")
        .update({
          revoked_at: nowIso(),
          revocation_reason: input.action,
        })
        .eq("user_id", userId),
      client
        .from("platform_account_controls")
        .upsert(
          {
            clear_sessions_after: nowIso(),
            library_id: input.libraryId ?? null,
            metadata: {},
            status: "active",
            updated_by: actor.actorUserId,
            user_id: userId,
          },
          {
            onConflict: "user_id",
          },
        ),
      revokeImpersonationSessionsForTargetUser(env, {
        metadata: {
          action: input.action,
          actor_user_id: actor.actorUserId,
        },
        reason: input.action,
        targetUserId: userId,
      }).catch(() => undefined),
    ]);

    await recordAdminAction(client, actor, {
      action: input.action,
      activityMessage: `Cleared active sessions for ${normalizeText(profile.full_name) || userId}.`,
      activityType: input.action,
      libraryId: input.libraryId ?? null,
      metadata: {
        note: input.note ?? null,
        operator_reason: sessionClearGuard.reason,
      },
      operatorActionId: "session_clear",
      targetDisplay: normalizeText(profile.full_name) || normalizeText(profile.email) || userId,
      targetId: userId,
      targetType: "user",
      userId,
    });

    return buildApiSuccess("User sessions cleared.", {
      userId,
    });
  }

  if (input.action === "reset_password") {
    const email = normalizeText(profile.email);
    if (!email) {
      return buildApiFailure("This user does not have an email address to reset.", "EMAIL_REQUIRED");
    }

    const passwordResetGuard = await enforceOperatorActionGuard({
      actionId: "password_reset",
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        action: input.action,
        email,
        libraryId: input.libraryId ?? null,
        note: input.note ?? null,
        userId,
      }),
      reason: input.note,
      targetDisplay: normalizeText(profile.full_name) || email,
      targetId: userId,
      targetType: "user",
      token: input.actionToken,
    });

    if (passwordResetGuard.response) {
      return passwordResetGuard.response;
    }

    const generated = await client.auth.admin.generateLink({
      email,
      options: {
        redirectTo: buildResetPasswordRedirect(env),
      },
      type: "recovery",
    });

    if (generated.error || !generated.data.properties?.action_link) {
      return buildApiFailure(
        generated.error?.message || "Unable to generate a recovery link.",
        "PASSWORD_RESET_FAILED",
      );
    }

    await client
      .from("platform_account_controls")
      .upsert(
        {
          clear_sessions_after: nowIso(),
          password_reset_required: true,
          status: "active",
          updated_by: actor.actorUserId,
          user_id: userId,
        },
        {
          onConflict: "user_id",
        },
      );

    await client
      .from("auth_trusted_devices")
      .update({
        revoked_at: nowIso(),
        revocation_reason: "password_reset",
      })
      .eq("user_id", userId);
    await revokeImpersonationSessionsForTargetUser(env, {
      metadata: {
        action: "password_reset",
        actor_user_id: actor.actorUserId,
      },
      reason: "password_reset",
      targetUserId: userId,
    }).catch(() => undefined);

    await recordAdminAction(client, actor, {
      action: "password_reset_requested",
      activityMessage: `Generated a password reset link for ${normalizeText(profile.full_name) || userId}.`,
      activityType: "password_reset_requested",
      libraryId: input.libraryId ?? null,
      metadata: {
        note: input.note ?? null,
        operator_reason: passwordResetGuard.reason,
      },
      operatorActionId: "password_reset",
      targetDisplay: normalizeText(profile.full_name) || email,
      targetId: userId,
      targetType: "user",
      userId,
    });

    return buildApiSuccess("Password reset link generated.", {
      recoveryLink: generated.data.properties.action_link,
      userId,
    });
  }

  const nextStatus =
    input.action === "ban" ? "banned" : input.action === "suspend" ? "suspended" : "active";

  const userControlGuard = await enforceOperatorActionGuard({
    actionId: "user_control",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      action: input.action,
      libraryId: input.libraryId ?? null,
      note: input.note ?? null,
      untilAt: input.untilAt ?? null,
      userId,
    }),
    reason: input.note,
    targetDisplay: normalizeText(profile.full_name) || normalizeText(profile.email) || userId,
    targetId: userId,
    targetType: "user",
    token: input.actionToken,
  });

  if (userControlGuard.response) {
    return userControlGuard.response;
  }

  await client
    .from("platform_account_controls")
    .upsert(
      {
        clear_sessions_after: nowIso(),
        library_id: input.libraryId ?? null,
        password_reset_required: false,
        reason: input.action === "clear_control" ? null : input.note ?? null,
        status: nextStatus,
        until_at: input.action === "clear_control" ? null : input.untilAt ?? null,
        updated_by: actor.actorUserId,
        user_id: userId,
      },
      {
        onConflict: "user_id",
      },
    );

  await client
    .from("auth_trusted_devices")
    .update({
      revoked_at: nowIso(),
      revocation_reason: input.action,
    })
    .eq("user_id", userId);
  await revokeImpersonationSessionsForTargetUser(env, {
    metadata: {
      action: input.action,
      actor_user_id: actor.actorUserId,
    },
    reason: input.action,
    targetUserId: userId,
  }).catch(() => undefined);

  await liftOrApplySupabaseBan({
    client,
    status: nextStatus === "banned" ? "banned" : nextStatus === "suspended" ? "suspended" : "active",
    untilAt: input.untilAt ?? null,
    userId,
  });

  await recordAdminAction(client, actor, {
    action: `user_${input.action}`,
    activityMessage: `${normalizeText(profile.full_name) || normalizeText(profile.email) || userId} is now ${nextStatus}.`,
    activityType: `user_${input.action}`,
    libraryId: input.libraryId ?? null,
    metadata: {
      note: input.note ?? null,
      operator_reason: userControlGuard.reason,
      until_at: input.untilAt ?? null,
    },
    operatorActionId: "user_control",
    targetDisplay: normalizeText(profile.full_name) || normalizeText(profile.email) || userId,
    targetId: userId,
    targetType: "user",
    userId,
  });

  return buildApiSuccess("User control updated.", {
    status: nextStatus,
    userId,
  });
};

export const resolveIncidentData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminIncidentResolutionInput,
) => {
  const client = buildServiceClient(env);
  const incidentKey = normalizeText(input.incidentKey);
  if (!incidentKey) {
    return buildApiFailure("Incident key is required.", "INVALID_REQUEST");
  }

  const rows = await readOptionalRows<Record<string, unknown>>(
    client
      .from("app_event_logs")
      .select("id, event_type, group_key, fingerprint, metric_key, resolved_at")
      .order("created_at", { ascending: false })
      .limit(500),
  );
  const matchingRows = rows.filter((row) => {
    const keys = [
      normalizeText(row.group_key),
      normalizeText(row.fingerprint),
      normalizeText(row.metric_key),
      normalizeText(row.event_type),
    ].filter(Boolean);
    return keys.includes(incidentKey);
  });
  const unresolvedIds = matchingRows
    .filter((row) => !normalizeText(row.resolved_at))
    .map((row) => normalizeText(row.id))
    .filter(Boolean);

  if (!matchingRows.length) {
    return buildApiFailure("No incidents matched that key.", "NOT_FOUND");
  }

  if (input.action === "resolve_incident") {
    if (!unresolvedIds.length) {
      return buildApiFailure("No unresolved incidents matched that key.", "NOT_FOUND");
    }

    const resolveGuard = await enforceOperatorActionGuard({
      actionId: "incident_resolve",
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        incidentKey,
        resolutionNote: input.resolutionNote ?? null,
        unresolvedIds,
      }),
      previewBuilder: () => ({
        actionId: "incident_resolve",
        confirmationLabel: getActionConfirmationLabel("incident_resolve"),
        cooldownUntil: null,
        dryRun: true,
        duplicateRisk: unresolvedIds.length > 10 ? "medium" : "low",
        existingCaptureLineage: [incidentKey],
        idempotencyKey: incidentKey,
        impacts: [
          {
            after: "0",
            before: String(unresolvedIds.length),
            detail: input.resolutionNote ?? null,
            label: "unresolved_incidents",
          },
        ],
        requiresReason: true,
        reversible: true,
        retryHistory: [],
        severity: getActionDefinition("incident_resolve").severity,
        summary: "Resolving an incident group will mark the currently unresolved matching events as resolved.",
        targetDisplay: incidentKey,
        title: getActionDefinition("incident_resolve").label,
        token: null,
        traceLineage: [],
        warnings: [],
      }),
      reason: input.resolutionNote,
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
      token: input.actionToken,
    });

    if (resolveGuard.response) {
      return resolveGuard.response;
    }

    await client
      .from("app_event_logs")
      .update({
        resolution_note: input.resolutionNote ?? null,
        resolved_at: nowIso(),
        resolved_by: actor.actorUserId,
      })
      .in("id", unresolvedIds);

    await recordAdminAction(client, actor, {
      action: "incident_resolved",
      activityMessage: `Resolved incident group ${incidentKey}.`,
      activityType: "incident_resolved",
      metadata: {
        incident_key: incidentKey,
        operator_reason: resolveGuard.reason,
        resolution_note: input.resolutionNote ?? null,
        resolved_count: unresolvedIds.length,
      },
      operatorActionId: "incident_resolve",
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
    });

    return buildApiSuccess("Incident group resolved.", {
      incidentKey,
      resolvedCount: unresolvedIds.length,
    });
  }

  if (input.action === "acknowledge_incident") {
    const acknowledgeGuard = await enforceOperatorActionGuard({
      actionId: "incident_acknowledge",
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        incidentKey,
        note: input.note ?? null,
      }),
      reason: input.note,
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
      token: input.actionToken,
    });

    if (acknowledgeGuard.response) {
      return acknowledgeGuard.response;
    }

    await recordAdminAction(client, actor, {
      action: "incident_acknowledged",
      activityMessage: `Acknowledged incident group ${incidentKey}.`,
      activityType: "incident_acknowledged",
      metadata: {
        incident_key: incidentKey,
        note: input.note ?? null,
        operator_reason: acknowledgeGuard.reason,
      },
      operatorActionId: "incident_acknowledge",
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
    });

    return buildApiSuccess("Incident acknowledged.", {
      incidentKey,
    });
  }

  if (input.action === "assign_incident") {
    const assignGuard = await enforceOperatorActionGuard({
      actionId: "incident_assign",
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        assigneeEmail: input.assigneeEmail,
        assigneeUserId: input.assigneeUserId ?? null,
        incidentKey,
        note: input.note ?? null,
      }),
      reason: input.note,
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
      token: input.actionToken,
    });

    if (assignGuard.response) {
      return assignGuard.response;
    }

    await recordAdminAction(client, actor, {
      action: "incident_assigned",
      activityMessage: `Assigned incident group ${incidentKey}.`,
      activityType: "incident_assigned",
      metadata: {
        assignee_email: input.assigneeEmail,
        assignee_region: input.assigneeRegion ?? null,
        assignee_team: input.assigneeTeam ?? null,
        assignee_user_id: input.assigneeUserId ?? null,
        backup_assignee_email: input.backupAssigneeEmail ?? null,
        handoff_type: input.handoffType ?? "assignment",
        incident_key: incidentKey,
        note: input.note ?? null,
        operator_reason: assignGuard.reason,
        shift_label: input.shiftLabel ?? null,
        shift_timezone: input.shiftTimezone ?? null,
      },
      operatorActionId: "incident_assign",
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
    });

    return buildApiSuccess("Incident assigned.", {
      assigneeEmail: input.assigneeEmail,
      incidentKey,
    });
  }

  if (input.action === "escalate_incident") {
    const priorAuditLogs = await readOptionalRows<AuditLogRow>(
      client
        .from("super_admin_audit_logs")
        .select("metadata")
        .eq("action", "incident_escalated")
        .eq("target_type", "incident_group")
        .eq("target_id", incidentKey)
        .order("created_at", { ascending: false })
        .limit(10),
    );
    const priorLevel = priorAuditLogs.reduce((highest, row) => {
      const metadata = toRecord(row.metadata);
      return Math.max(highest, toNumber(metadata.escalation_level ?? metadata.escalationLevel));
    }, 0);
    const escalationLevel = Math.max(1, input.escalationLevel ?? priorLevel + 1);

    const escalateGuard = await enforceOperatorActionGuard({
      actionId: "incident_escalate",
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        escalationLevel,
        incidentKey,
        note: input.note ?? null,
      }),
      previewBuilder: () => ({
        actionId: "incident_escalate",
        confirmationLabel: getActionConfirmationLabel("incident_escalate"),
        cooldownUntil: null,
        dryRun: true,
        duplicateRisk: escalationLevel > 2 ? "medium" : "low",
        existingCaptureLineage: [incidentKey],
        idempotencyKey: incidentKey,
        impacts: [
          {
            after: String(escalationLevel),
            before: String(priorLevel),
            detail: input.note ?? null,
            label: "escalation_level",
          },
        ],
        requiresReason: true,
        reversible: true,
        retryHistory: [],
        severity: getActionDefinition("incident_escalate").severity,
        summary: "Escalation increases the incident response priority and should include a typed operational reason.",
        targetDisplay: incidentKey,
        title: getActionDefinition("incident_escalate").label,
        token: null,
        traceLineage: [],
        warnings: [],
      }),
      reason: input.note,
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
      token: input.actionToken,
    });

    if (escalateGuard.response) {
      return escalateGuard.response;
    }

    await recordAdminAction(client, actor, {
      action: "incident_escalated",
      activityMessage: `Escalated incident group ${incidentKey} to level ${escalationLevel}.`,
      activityType: "incident_escalated",
      metadata: {
        after_hours: input.afterHours === true,
        backup_operator_email: input.backupOperatorEmail ?? null,
        escalation_level: escalationLevel,
        incident_key: incidentKey,
        note: input.note ?? null,
        operator_reason: escalateGuard.reason,
        regional_failover_from: input.regionalFailoverFrom ?? null,
        regional_failover_to: input.regionalFailoverTo ?? null,
        route_to_region: input.routeToRegion ?? null,
        route_to_role: input.routeToRole ?? null,
        route_to_team: input.routeToTeam ?? null,
      },
      operatorActionId: "incident_escalate",
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
    });

    return buildApiSuccess("Incident escalated.", {
      escalationLevel,
      incidentKey,
    });
  }

  if (input.action === "add_incident_note") {
    const noteGuard = await enforceOperatorActionGuard({
      actionId: "incident_note",
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        incidentKey,
        note: input.note,
      }),
      reason: input.note,
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
      token: input.actionToken,
    });

    if (noteGuard.response) {
      return noteGuard.response;
    }

    await recordAdminAction(client, actor, {
      action: "incident_note_added",
      activityMessage: `Added an operational note to incident group ${incidentKey}.`,
      activityType: "incident_note_added",
      metadata: {
        coordination_category: input.coordinationCategory ?? null,
        delegated_remediator_email: input.delegatedRemediatorEmail ?? null,
        incident_key: incidentKey,
        linked_approval_request_id: input.linkedApprovalRequestId ?? null,
        linked_governance_action_id: input.linkedGovernanceActionId ?? null,
        note: input.note,
        operator_reason: noteGuard.reason,
      },
      operatorActionId: "incident_note",
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
    });

    return buildApiSuccess("Incident note added.", {
      incidentKey,
    });
  }

  if (input.action === "approve_incident_severity") {
    const approvalGuard = await enforceOperatorActionGuard({
      actionId: "incident_severity_approve",
      actor,
      client,
      confirmationText: input.confirmationText,
      dryRun: input.dryRun,
      fingerprint: buildOperatorFingerprint({
        incidentKey,
        note: input.note ?? null,
      }),
      previewBuilder: () => ({
        actionId: "incident_severity_approve",
        confirmationLabel: getActionConfirmationLabel("incident_severity_approve"),
        cooldownUntil: null,
        dryRun: true,
        duplicateRisk: "low",
        existingCaptureLineage: [incidentKey],
        idempotencyKey: incidentKey,
        impacts: [
          {
            after: "approved",
            before: "pending",
            detail: input.note ?? null,
            label: "critical_severity_approval",
          },
        ],
        requiresReason: true,
        reversible: true,
        retryHistory: [],
        severity: getActionDefinition("incident_severity_approve").severity,
        summary: "Critical-severity approval confirms that the incident state has been operator-reviewed.",
        targetDisplay: incidentKey,
        title: getActionDefinition("incident_severity_approve").label,
        token: null,
        traceLineage: [],
        warnings: [],
      }),
      reason: input.note,
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
      token: input.actionToken,
    });

    if (approvalGuard.response) {
      return approvalGuard.response;
    }

    await recordAdminAction(client, actor, {
      action: "incident_severity_approved",
      activityMessage: `Approved critical severity for incident group ${incidentKey}.`,
      activityType: "incident_severity_approved",
      metadata: {
        incident_key: incidentKey,
        note: input.note ?? null,
        operator_reason: approvalGuard.reason,
      },
      operatorActionId: "incident_severity_approve",
      targetDisplay: incidentKey,
      targetId: incidentKey,
      targetType: "incident_group",
    });

    return buildApiSuccess("Incident severity approved.", {
      incidentKey,
    });
  }

  const statusData = await buildStatusSignals({
    client,
    env,
  });
  const core = await loadCoreAdminData(env, client);
  const operational = buildOperationalContext({
    core,
    loginSummary: buildLoginAttemptSummary(core.loginRows),
    settingsMap: new Map(core.settings.map((setting) => [setting.key, setting] as const)),
    statusData,
  });
  const incidentGroup = operational.incidentGroups.find((group) => group.incidentKey === incidentKey);
  const targetJobId = incidentGroup?.retryableJobId;

  if (!targetJobId) {
    return buildApiFailure("No replayable or retryable job is linked to that incident.", "NOT_FOUND");
  }

  const shouldReplayDeadLetter = operational.deadLetters.some((row) => row.jobId === targetJobId);
  const retryGuard = await enforceOperatorActionGuard({
    actionId: "incident_retry",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      incidentKey,
      note: input.note ?? null,
      replayMode: shouldReplayDeadLetter ? "dead_letter_replay" : "job_retry",
      targetJobId,
    }),
    previewBuilder: () => ({
      actionId: "incident_retry",
      confirmationLabel: getActionConfirmationLabel("incident_retry"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: shouldReplayDeadLetter ? "high" : "medium",
      existingCaptureLineage: [incidentKey, targetJobId],
      idempotencyKey: targetJobId,
      impacts: [
        {
          after: shouldReplayDeadLetter ? "dead_letter_replay" : "job_retry",
          before: "incident_open",
          detail: input.note ?? null,
          label: "remediation_action",
        },
      ],
      requiresReason: true,
      reversible: false,
      retryHistory: [],
      severity: getActionDefinition("incident_retry").severity,
      summary: "Retry-from-incident will trigger the linked job remediation path for this incident group.",
      targetDisplay: incidentKey,
      title: getActionDefinition("incident_retry").label,
      token: null,
      traceLineage: incidentGroup?.traceLineage ?? [],
      warnings: [],
    }),
    reason: input.note,
    targetDisplay: incidentKey,
    targetId: incidentKey,
    targetType: "incident_group",
    token: input.actionToken,
  });

  if (retryGuard.response) {
    return retryGuard.response;
  }

  const retryResult = await handleJobActionData(env, actor, {
    action: shouldReplayDeadLetter ? "replay_dead_letter" : "retry",
    dryRun: false,
    jobId: targetJobId,
    replayReason: input.note ?? null,
  }, {
    safetyAlreadyConfirmed: true,
  });
  if (!retryResult.success) {
    return retryResult;
  }

  await recordAdminAction(client, actor, {
    action: "incident_retry_requested",
    activityMessage: `Triggered a job replay from incident group ${incidentKey}.`,
    activityType: "incident_retry_requested",
    metadata: {
      delegated_remediator_email: input.delegatedRemediatorEmail ?? null,
      incident_key: incidentKey,
      job_id: targetJobId,
      linked_approval_request_id: input.linkedApprovalRequestId ?? null,
      note: input.note ?? null,
      operator_reason: retryGuard.reason,
      replay_mode: shouldReplayDeadLetter ? "dead_letter_replay" : "job_retry",
    },
    operatorActionId: "incident_retry",
    targetDisplay: incidentKey,
    targetId: incidentKey,
    targetType: "incident_group",
  });

  return buildApiSuccess("Retry triggered from incident.", {
    incidentKey,
    jobId: targetJobId,
  });
};

export const upsertTemplateData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: {
    body: string;
    channel: "email" | "in_app" | "whatsapp" | "telegram";
    id?: string;
    isActive?: boolean;
    key: string;
    name: string;
    subject?: string | null;
    variables?: string[];
  },
) => {
  const client = buildServiceClient(env);
  if (!normalizeText(input.key) || !normalizeText(input.name) || !normalizeText(input.body)) {
    return buildApiFailure("Template key, name, and body are required.", "INVALID_REQUEST");
  }

  const row = await readMaybeSingle<TemplateRow>(
    client
      .from("communication_templates")
      .upsert(
        {
          body: input.body,
          channel: input.channel,
          id: input.id,
          is_active: input.isActive ?? true,
          key: input.key,
          name: input.name,
          subject: input.subject ?? null,
          updated_by: actor.actorUserId,
          variables: input.variables ?? [],
        },
        input.id ? { onConflict: "id" } : { onConflict: "key" },
      )
      .select("id, key, name, channel, subject, body, variables, is_active, updated_at")
      .maybeSingle(),
  );

  await recordAdminAction(client, actor, {
    action: "communication_template_saved",
    activityMessage: `Saved communication template ${input.name}.`,
    activityType: "communication_template_saved",
    metadata: {
      channel: input.channel,
      key: input.key,
    },
    targetDisplay: input.name,
    targetId: normalizeText(row?.id),
    targetType: "communication_template",
  });

  return buildApiSuccess("Communication template saved.", {
    template: row ? mapTemplates([row])[0] : null,
  });
};

export const deleteTemplateData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  templateId: string,
) => {
  const client = buildServiceClient(env);
  const normalizedTemplateId = normalizeText(templateId);
  if (!normalizedTemplateId) {
    return buildApiFailure("Template ID is required.", "INVALID_REQUEST");
  }

  const existing = await readMaybeSingle<TemplateRow>(
    client
      .from("communication_templates")
      .select("id, name")
      .eq("id", normalizedTemplateId)
      .maybeSingle(),
  );

  await client
    .from("communication_templates")
    .delete()
    .eq("id", normalizedTemplateId);

  await recordAdminAction(client, actor, {
    action: "communication_template_deleted",
    activityMessage: `Deleted communication template ${normalizeText(existing?.name) || normalizedTemplateId}.`,
    activityType: "communication_template_deleted",
    metadata: {
      template_id: normalizedTemplateId,
    },
    targetDisplay: normalizeText(existing?.name) || normalizedTemplateId,
    targetId: normalizedTemplateId,
    targetType: "communication_template",
  });

  return buildApiSuccess("Communication template deleted.", {
    deletedTemplateId: normalizedTemplateId,
  });
};

export const createBroadcastData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminBroadcastInput,
) => {
  const client = buildServiceClient(env);
  if (!normalizeText(input.title) || !normalizeText(input.message)) {
    return buildApiFailure("Broadcast title and message are required.", "INVALID_REQUEST");
  }

  const audience = normalizeText(input.audience) || DEFAULT_LIBRARY_AUDIENCE;
  const broadcast = await readMaybeSingle<BroadcastRow>(
    client
      .from("platform_broadcasts")
      .insert({
        audience,
        channel: input.channel,
        created_by: actor.actorUserId,
        message: input.message,
        metadata: {
          template_id: input.templateId ?? null,
        },
        status: input.channel === "telegram" || input.channel === "whatsapp" ? "queued" : "sent",
        sent_at: input.channel === "telegram" || input.channel === "whatsapp" ? null : nowIso(),
        template_id: input.templateId ?? null,
        title: input.title,
      })
      .select("id, audience, channel, title, message, status, sent_at, created_at")
      .maybeSingle(),
  );

  const audienceLibraries = await resolveBroadcastAudienceLibraries(client, audience);
  const audienceLibraryIds = audienceLibraries.map((library) => normalizeText(library.id)).filter(Boolean);
  if (audienceLibraryIds.length && (input.channel === "in_app" || input.channel === "email")) {
    await client.from("notifications").insert(
      audienceLibraries.map((library) => ({
        channel: input.channel,
        delivery_status: "sent",
        is_read: false,
        library_id: normalizeText(library.id),
        message: input.message,
        metadata: {
          broadcast_id: normalizeText(broadcast?.id),
          sent_by: actor.actorUserId,
        },
        title: input.title,
        type: "admin_broadcast",
        user_id: normalizeNullableText(library.owner_id),
      })),
    );
  }

  if (input.channel === "email") {
    const ownerIds = audienceLibraries.map((library) => normalizeText(library.owner_id)).filter(Boolean);
    const profiles = ownerIds.length
      ? await readOptionalRows<ProfileRow>(
          client
            .from("profiles")
            .select("user_id, email, full_name")
            .in("user_id", ownerIds),
        )
      : [];
    const profileByUserId = new Map(
      profiles.map((profile) => [normalizeText(profile.user_id), profile] as const),
    );

    await Promise.allSettled(
      audienceLibraries.map(async (library) => {
        const profile = profileByUserId.get(normalizeText(library.owner_id));
        const email = normalizeText(profile?.email);
        if (!email) {
          return;
        }

        await sendEmail({
          env,
          from: resolveLibriofyEmailFrom("hello@libriofy.com"),
          metadata: {
            area: "communications",
            broadcast_id: normalizeText(broadcast?.id),
            library_id: normalizeText(library.id),
          },
          subject: input.title,
          text: input.message,
          to: [email],
          user: email,
        });
      }),
    );
  }

  await recordAdminAction(client, actor, {
    action: "broadcast_created",
    activityMessage: `Sent broadcast ${input.title}.`,
    activityType: "broadcast_created",
    metadata: {
      audience,
      audience_count: audienceLibraryIds.length,
      channel: input.channel,
    },
    targetDisplay: input.title,
    targetId: normalizeText(broadcast?.id),
    targetType: "platform_broadcast",
  });

  return buildApiSuccess("Broadcast created.", {
    broadcast: broadcast ? mapBroadcasts([broadcast])[0] : null,
  });
};

export const createRefundData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminRefundInput,
) => {
  const client = buildServiceClient(env);
  if (
    !normalizeText(input.libraryId) ||
    !normalizeText(input.reason) ||
    !Number.isFinite(Number(input.amount)) ||
    Number(input.amount) <= 0
  ) {
    return buildApiFailure("Library, amount, and reason are required.", "INVALID_REQUEST");
  }

  if (!(await isPlatformToggleEnabled(env, "ops_billing_mutations_enabled", true))) {
    return buildApiFailure("Billing mutations are currently disabled by the platform kill switch.", "ACCESS_DENIED");
  }

  const duplicate = await findRecentRefundConflict(client, input);
  const source = await loadRefundSourceAmount(client, input);
  const processedAmount = source.amount != null ? await loadProcessedRefundAmount(client, input) : 0;
  const nextProcessedAmount = Number((processedAmount + input.amount).toFixed(2));
  const duplicateRisk =
    duplicate || (source.amount != null && nextProcessedAmount > Number(source.amount.toFixed(2)))
      ? "high"
      : input.paymentId || input.subscriptionPaymentId
        ? "medium"
        : "low";

  const guard = await enforceOperatorActionGuard({
    actionId: "refund_process",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      amount: input.amount,
      invoiceId: input.invoiceId ?? null,
      libraryId: input.libraryId,
      paymentId: input.paymentId ?? null,
      reason: input.reason,
      subscriptionPaymentId: input.subscriptionPaymentId ?? null,
    }),
    previewBuilder: () => ({
      actionId: "refund_process",
      confirmationLabel: getActionConfirmationLabel("refund_process"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk,
      existingCaptureLineage: [
        input.paymentId ?? "",
        input.subscriptionPaymentId ?? "",
        input.invoiceId ?? "",
      ].filter(Boolean),
      idempotencyKey: normalizeNullableText(input.subscriptionPaymentId ?? input.paymentId ?? input.invoiceId),
      impacts: [
        {
          after: formatOperatorImpactValue(input.amount),
          before: formatOperatorImpactValue(processedAmount),
          detail: source.amount != null ? `Captured amount: ${formatOperatorImpactValue(source.amount)}` : "Manual refund without a linked payment source.",
          label: "refund_amount",
        },
        {
          after: formatOperatorImpactValue(nextProcessedAmount),
          before: formatOperatorImpactValue(processedAmount),
          detail: input.reason,
          label: "refunded_total_after_action",
        },
      ],
      requiresReason: true,
      reversible: false,
      retryHistory: [],
      severity: getActionDefinition("refund_process").severity,
      summary: "Refunds create immediate financial impact and are checked for duplicate and over-refund risk before execution.",
      targetDisplay: input.libraryId,
      title: getActionDefinition("refund_process").label,
      token: null,
      traceLineage: [],
      warnings: [
        source.reason,
        duplicate ? "A matching refund was already processed recently." : null,
        source.amount != null && nextProcessedAmount - Number(source.amount.toFixed(2)) > 0.001
          ? "This refund would exceed the captured payment total."
          : null,
      ].filter((value): value is string => Boolean(value)),
    }),
    reason: input.reason,
    targetDisplay: input.libraryId,
    targetId: normalizeNullableText(input.subscriptionPaymentId ?? input.paymentId ?? input.invoiceId) ?? input.libraryId,
    targetType: "billing_refund",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  const lock = await acquireOperationalLock(
    env,
    `billing:refund:${input.libraryId}:${input.paymentId ?? input.subscriptionPaymentId ?? input.invoiceId ?? normalizeText(input.reason)}`,
    BILLING_LOCK_TTL_MS,
  );
  if (!lock) {
    return buildApiFailure("Another refund operation is already in progress for this billing target.", "INVALID_REQUEST");
  }

  try {
    if (duplicate) {
      incrementRuntimeMetric("billing_mutations_total", 1, {
        mutation: "process_refund",
        outcome: "deduplicated",
      });
      return buildApiSuccess("Refund already processed recently; reusing existing record.", {
        refund: duplicate,
      });
    }

    if (source.reason) {
      return buildApiFailure(source.reason, "INVALID_REQUEST");
    }

    if (source.amount != null) {
      if (nextProcessedAmount - Number(source.amount.toFixed(2)) > 0.001) {
        await logEvent({
          type: "BILLING_REFUND_REJECTED",
          status: "FAILED",
          classification: "BILLING_ERROR",
          entityId: input.paymentId ?? input.subscriptionPaymentId ?? input.libraryId,
          metadata: {
            attempted_amount: input.amount,
            library_id: input.libraryId,
            processed_amount: processedAmount,
            severity: "CRITICAL",
            source_amount: source.amount,
          },
          message: "Refund amount exceeds the captured payment total.",
        }, {
          skipConsole: true,
        });
        return buildApiFailure("Refund amount exceeds the captured payment total.", "INVALID_REQUEST");
      }
    }

    const startedAt = Date.now();
    const refund = await readMaybeSingle<RefundRow>(
      client
        .from("billing_refunds")
        .insert({
          amount: input.amount,
          created_by: actor.actorUserId,
          invoice_id: input.invoiceId ?? null,
          library_id: input.libraryId,
          payment_id: input.paymentId ?? null,
          reason: input.reason,
          status: "processed",
          subscription_payment_id: input.subscriptionPaymentId ?? null,
          processed_at: nowIso(),
          processed_by: actor.actorUserId,
        })
        .select("id, library_id, amount, reason, status, created_at, processed_at, payment_id, subscription_payment_id, invoice_id")
        .maybeSingle(),
    );
    recordRuntimeLatency("billing_mutation_latency_ms", Date.now() - startedAt, {
      mutation: "process_refund",
      outcome: "success",
    });
    incrementRuntimeMetric("billing_mutations_total", 1, {
      mutation: "process_refund",
      outcome: "success",
    });

    await createInvoiceRecord({
      actor,
      client,
      env,
      input: {
        invoiceType: "refund",
        libraryId: input.libraryId,
        metadata: {
          refund_id: normalizeText(refund?.id),
        },
        subtotal: input.amount,
      },
    });

    await recordAdminAction(client, actor, {
      action: "refund_processed",
      activityMessage: `Processed refund for library ${input.libraryId}.`,
      activityType: "refund_processed",
      libraryId: input.libraryId,
      metadata: {
        amount: input.amount,
        operator_reason: guard.reason,
        reason: input.reason,
      },
      operatorActionId: "refund_process",
      targetDisplay: input.libraryId,
      targetId: normalizeText(refund?.id),
      targetType: "billing_refund",
    });

    return buildApiSuccess("Refund processed.", {
      refund,
    });
  } finally {
    await lock.release();
  }
};

export const createInvoiceData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminInvoiceInput,
) => {
  const client = buildServiceClient(env);
  if (!normalizeText(input.libraryId) || !Number.isFinite(Number(input.subtotal)) || Number(input.subtotal) <= 0) {
    return buildApiFailure("Library and subtotal are required.", "INVALID_REQUEST");
  }

  const guard = await enforceOperatorActionGuard({
    actionId: "invoice_create",
    actor,
    client,
    confirmationText: input.confirmationText,
    dryRun: input.dryRun,
    fingerprint: buildOperatorFingerprint({
      invoiceType: input.invoiceType ?? "subscription",
      libraryId: input.libraryId,
      periodEnd: input.periodEnd ?? null,
      periodStart: input.periodStart ?? null,
      subtotal: input.subtotal,
    }),
    previewBuilder: () => ({
      actionId: "invoice_create",
      confirmationLabel: getActionConfirmationLabel("invoice_create"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: "medium",
      existingCaptureLineage: [],
      idempotencyKey: normalizeNullableText(input.libraryId),
      impacts: [
        {
          after: formatOperatorImpactValue(input.subtotal),
          before: "0",
          detail: input.invoiceType ?? "subscription",
          label: "invoice_subtotal",
        },
      ],
      requiresReason: true,
      reversible: false,
      retryHistory: [],
      severity: getActionDefinition("invoice_create").severity,
      summary: "Invoice generation will create a new billing artifact for the selected library.",
      targetDisplay: input.libraryId,
      title: getActionDefinition("invoice_create").label,
      token: null,
      traceLineage: [],
      warnings: [],
    }),
    reason:
      typeof input.metadata?.operator_reason === "string"
        ? String(input.metadata.operator_reason)
        : typeof input.metadata?.reason === "string"
          ? String(input.metadata.reason)
          : null,
    targetDisplay: input.libraryId,
    targetId: input.libraryId,
    targetType: "platform_invoice",
    token: input.actionToken,
  });

  if (guard.response) {
    return guard.response;
  }

  let invoice: InvoiceRow | null;
  try {
    invoice = await createInvoiceRecord({
      actor,
      client,
      env,
      input,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate the invoice.";
    incrementRuntimeMetric("billing_mutations_total", 1, {
      mutation: "create_invoice",
      outcome: "failed",
    });
    return buildApiFailure(message, "INVALID_REQUEST");
  }

  await recordAdminAction(client, actor, {
    action: "invoice_created",
    activityMessage: `Created invoice for library ${input.libraryId}.`,
    activityType: "invoice_created",
    libraryId: input.libraryId,
    metadata: {
      invoice_type: input.invoiceType ?? "subscription",
      operator_reason: guard.reason,
      subtotal: input.subtotal,
    },
    operatorActionId: "invoice_create",
    targetDisplay: input.libraryId,
    targetId: normalizeText(invoice?.id),
    targetType: "platform_invoice",
  });

  return buildApiSuccess("Invoice generated.", {
    invoice,
  });
};

export const handleJobActionData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminJobActionInput,
  options: {
    safetyAlreadyConfirmed?: boolean;
  } = {},
) => {
  const client = buildServiceClient(env);

  if (input.action !== "cancel" && !(await isPlatformToggleEnabled(env, "ops_queue_processing_enabled", true))) {
    return buildApiFailure("Queue processing is currently disabled by the platform kill switch.", "ACCESS_DENIED");
  }

  if (input.action === "enqueue") {
    if (!normalizeText(input.jobType)) {
      return buildApiFailure("Job type is required.", "INVALID_REQUEST");
    }

    const enqueueReason = normalizeNullableText(toRecord(input.payload).operator_reason ?? toRecord(input.payload).reason);
    const enqueueGuard = options.safetyAlreadyConfirmed
      ? { reason: enqueueReason, response: null }
      : await enforceOperatorActionGuard({
          actionId: "job_enqueue",
          actor,
          client,
          confirmationText: input.confirmationText,
          dryRun: input.dryRun,
          fingerprint: buildOperatorFingerprint({
            jobType: input.jobType,
            payload: input.payload ?? {},
            scheduledFor: input.scheduledFor ?? null,
          }),
          reason: enqueueReason,
          targetDisplay: input.jobType,
          targetId: normalizeNullableText(input.jobType),
          targetType: "platform_job",
          token: input.actionToken,
        });

    if (enqueueGuard.response) {
      return enqueueGuard.response;
    }

    const row = await enqueueOrReuseJob({
      actor,
      client,
      input,
    });

    await recordAdminAction(client, actor, {
      action: "job_enqueued",
      activityMessage: `Enqueued ${input.jobType} job.`,
      activityType: "job_enqueued",
      metadata: {
        job_type: input.jobType,
        operator_reason: enqueueGuard.reason,
      },
      operatorActionId: "job_enqueue",
      targetDisplay: input.jobType,
      targetId: normalizeText(row?.id),
      targetType: "platform_job",
    });

    return buildApiSuccess("Job enqueued.", {
      job: row ? mapJobs([row])[0] : null,
    });
  }

  if (input.action === "retry") {
    const jobId = normalizeText(input.jobId);
    if (!jobId) {
      return buildApiFailure("Job ID is required.", "INVALID_REQUEST");
    }

    const existing = await readMaybeSingle<JobQueueRow>(
      client
        .from("platform_job_queue")
        .select(JOB_QUEUE_SELECT_FIELDS)
        .eq("id", jobId)
        .maybeSingle(),
    );
    if (!existing) {
      return buildApiFailure("Job not found.", "NOT_FOUND");
    }

    const mappedExisting = mapJobRow(existing);
    if (mappedExisting.status === "running") {
      return buildApiFailure("Running jobs must be cancelled or allowed to finish before retrying.", "INVALID_REQUEST");
    }

    const retryGuard = options.safetyAlreadyConfirmed
      ? { reason: normalizeNullableText(input.replayReason), response: null }
      : await enforceOperatorActionGuard({
          actionId: "job_retry",
          actor,
          client,
          confirmationText: input.confirmationText,
          dryRun: input.dryRun,
          fingerprint: buildOperatorFingerprint({
            attempts: mappedExisting.attempts,
            deduplicationKey: mappedExisting.deduplicationKey,
            jobId,
            jobType: mappedExisting.jobType,
            replayReason: input.replayReason ?? null,
            status: mappedExisting.status,
          }),
          previewBuilder: () => ({
        actionId: "job_retry",
        confirmationLabel: getActionConfirmationLabel("job_retry"),
        cooldownUntil: null,
        dryRun: true,
        duplicateRisk: mappedExisting.status === "queued" ? "high" : "medium",
        existingCaptureLineage: [
          mappedExisting.trace.originRequestId ?? "",
          mappedExisting.trace.correlationId ?? "",
          mappedExisting.trace.traceId ?? "",
        ].filter(Boolean),
        idempotencyKey: normalizeNullableText(
          mappedExisting.payload.idempotencyKey ??
            mappedExisting.payload.idempotency_key ??
            mappedExisting.deduplicationKey,
        ),
        impacts: [
          {
            after: "queued",
            before: mappedExisting.status,
            detail: input.replayReason ?? null,
            label: "job_status",
          },
          {
            after: String(mappedExisting.retryHistory.length + 1),
            before: String(mappedExisting.retryHistory.length),
            label: "retry_history_entries",
          },
        ],
        requiresReason: true,
        reversible: false,
        retryHistory: mappedExisting.retryHistory,
        severity: getActionDefinition("job_retry").severity,
        summary: "Retrying a failed job will clear stale lease state and place the job back into the queue.",
        targetDisplay: mappedExisting.jobType,
        title: getActionDefinition("job_retry").label,
        token: null,
        traceLineage: mappedExisting.traceLineage,
        warnings:
          mappedExisting.status === "queued"
            ? ["This job is already queued. Retrying again could create duplicate operator intent."]
            : [],
          }),
          reason: input.replayReason,
          targetDisplay: mappedExisting.jobType,
          targetId: jobId,
          targetType: "platform_job",
          token: input.actionToken,
        });

    if (retryGuard.response) {
      return retryGuard.response;
    }

    if (mappedExisting.status === "queued" && !mappedExisting.deadLetteredAt) {
      return buildApiSuccess("Job is already queued.", {
        job: mappedExisting,
      });
    }

    const retriedAt = nowIso();
    const retryHistory = [
      ...mappedExisting.retryHistory.map((entry) => entry.metadata),
      {
        at: retriedAt,
        attempt: mappedExisting.attempts + 1,
        by: actor.actorUserId,
        reason: normalizeNullableText(input.replayReason),
        state: "operator_retry",
      },
    ].slice(-10);

    const row = await readMaybeSingle<JobQueueRow>(
      client
        .from("platform_job_queue")
        .update({
          claim_token: null,
          claimed_by: null,
          finished_at: null,
          last_heartbeat_at: null,
          last_error: null,
          payload: writeJobQueuePayload(existing.payload, {
            claimToken: null,
            claimedBy: null,
            cancellationReason: null,
            cancelledAt: null,
            cancelRequestedAt: null,
            cancelRequestedBy: null,
            deadLetterReason: null,
            deadLetteredAt: null,
            lastHeartbeatAt: null,
            retryHistory,
            visibilityTimeoutAt: null,
          }),
          scheduled_for: nowIso(),
          started_at: null,
          status: "queued",
          visibility_timeout_at: null,
        })
        .eq("id", jobId)
        .select(JOB_QUEUE_SELECT_FIELDS)
        .maybeSingle(),
    );

    await recordAdminAction(client, actor, {
      action: "job_retried",
      activityMessage: `Queued retry for job ${jobId}.`,
      activityType: "job_retried",
      metadata: {
        job_id: jobId,
        operator_reason: retryGuard.reason,
        retry_reason: input.replayReason ?? null,
      },
      operatorActionId: "job_retry",
      targetDisplay: normalizeText(row?.job_type) || jobId,
      targetId: jobId,
      targetType: "platform_job",
    });

    return buildApiSuccess("Job queued for retry.", {
      job: row ? mapJobs([row])[0] : null,
    });
  }

  if (input.action === "replay_dead_letter") {
    const jobId = normalizeText(input.jobId);
    if (!jobId) {
      return buildApiFailure("Job ID is required.", "INVALID_REQUEST");
    }

    const [existingJob, deadLetter] = await Promise.all([
      readMaybeSingle<JobQueueRow>(
        client
          .from("platform_job_queue")
          .select(JOB_QUEUE_SELECT_FIELDS)
          .eq("id", jobId)
          .maybeSingle(),
      ),
      readMaybeSingle<DeadLetterRow>(
        client
          .from("platform_job_dead_letters")
          .select("id, job_id, job_type, job_payload, error_message, attempts, max_attempts, dead_lettered_at, source_request_id, source_correlation_id, source_trace_id, created_at")
          .eq("job_id", jobId)
          .order("dead_lettered_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ),
    ]);

    if (!deadLetter) {
      return buildApiFailure("Dead-letter record not found for that job.", "NOT_FOUND");
    }

    const previewCore = await loadCoreAdminData(env, client);
    const previewOperational = buildOperationalContext({
      core: previewCore,
      loginSummary: buildLoginAttemptSummary(previewCore.loginRows),
      settingsMap: new Map(previewCore.settings.map((setting) => [setting.key, setting] as const)),
      statusData: await buildStatusSignals({
        client,
        env,
      }),
    });
    const previewDeadLetter = previewOperational.deadLetters.find((row) => row.jobId === jobId);
    const previewJob = previewOperational.jobs.find((row) => row.id === jobId);
    const replayedAt = nowIso();
    const replayPayload = buildReplayedJobPayload(
      deadLetter.job_payload ?? existingJob?.payload ?? {},
      {
        actorUserId: actor.actorUserId,
        correlationId: actor.correlationId,
        replayReason: normalizeNullableText(input.replayReason) ?? "Operator replay from dead-letter queue.",
        replayedAt,
        replayedFromJobId: jobId,
        requestId: actor.requestId,
        requestSource: actor.requestSource,
        route: actor.requestPath,
        traceId: actor.traceId,
      },
    );
    const replayDeduplicationKey = buildQueueDeduplicationKey(
      normalizeText(deadLetter.job_type) || normalizeText(existingJob?.job_type),
      replayPayload,
    );
    const conflictingReplay = replayDeduplicationKey
      ? await readMaybeSingle<JobQueueRow>(
          client
            .from("platform_job_queue")
            .select(JOB_QUEUE_SELECT_FIELDS)
            .eq("deduplication_key", replayDeduplicationKey)
            .in("status", ["queued", "running"])
            .neq("id", jobId)
            .limit(1)
            .maybeSingle(),
        )
      : null;
    const replayGuard = options.safetyAlreadyConfirmed
      ? { reason: normalizeNullableText(input.replayReason), response: null }
      : await enforceOperatorActionGuard({
          actionId: "dead_letter_replay",
          actor,
          client,
          confirmationText: input.confirmationText,
          dryRun: input.dryRun,
          fingerprint: buildOperatorFingerprint({
            deadLetterId: normalizeText(deadLetter.id),
            jobId,
            replayReason: input.replayReason ?? null,
            traceId: normalizeNullableText(deadLetter.source_trace_id),
          }),
          previewBuilder: () => ({
        actionId: "dead_letter_replay",
        confirmationLabel: getActionConfirmationLabel("dead_letter_replay"),
        cooldownUntil: null,
        dryRun: true,
        duplicateRisk: conflictingReplay ? "high" : previewJob?.deduplicationKey ? "medium" : "low",
        existingCaptureLineage: [
          previewDeadLetter?.sourceRequestId ?? "",
          previewDeadLetter?.sourceCorrelationId ?? "",
          previewDeadLetter?.sourceTraceId ?? "",
        ].filter(Boolean),
        idempotencyKey: normalizeNullableText(
          replayPayload.idempotencyKey ??
            replayPayload.idempotency_key ??
            toRecord(replayPayload.metadata).idempotency_key ??
            toRecord(replayPayload.metadata).idempotencyKey,
        ),
        impacts: [
          {
            after: "queued",
            before: previewJob?.status ?? "dead_lettered",
            detail: input.replayReason ?? "Operator replay from dead-letter queue.",
            label: "job_status",
          },
          {
            after: formatOperatorImpactValue(previewDeadLetter?.attempts),
            before: formatOperatorImpactValue(previewDeadLetter?.attempts),
            detail: previewDeadLetter?.errorMessage ?? "No dead-letter error captured.",
            label: "retry_attempts_before_replay",
          },
        ],
        requiresReason: true,
        reversible: false,
        retryHistory: previewJob?.retryHistory ?? [],
        severity: getActionDefinition("dead_letter_replay").severity,
        summary: "Dead-letter replay will reconstruct the job payload, preserve lineage, and queue a new execution attempt.",
        targetDisplay: previewDeadLetter?.jobType ?? (normalizeText(deadLetter.job_type) || jobId),
        title: getActionDefinition("dead_letter_replay").label,
        token: null,
        traceLineage: previewDeadLetter?.traceLineage ?? previewJob?.traceLineage ?? [],
        warnings: [
          conflictingReplay ? `A matching replay is already ${normalizeText(conflictingReplay.status)}.` : null,
        ].filter((value): value is string => Boolean(value)),
          }),
          reason: input.replayReason,
          targetDisplay: previewDeadLetter?.jobType ?? (normalizeText(deadLetter.job_type) || jobId),
          targetId: jobId,
          targetType: "platform_job",
          token: input.actionToken,
        });

    if (replayGuard.response) {
      return replayGuard.response;
    }

    if (conflictingReplay) {
      return buildApiFailure("A matching replay is already queued or running for this dead-letter job.", "INVALID_REQUEST");
    }

    const row = await enqueueOrReuseJob({
      actor,
      client,
      input: {
        action: "enqueue",
        jobType: normalizeText(deadLetter.job_type) || normalizeText(existingJob?.job_type),
        payload: replayPayload,
        scheduledFor: replayedAt,
      },
    });

    await recordAdminAction(client, actor, {
      action: "job_replayed_from_dead_letter",
      activityMessage: `Replayed dead-letter job ${jobId}.`,
      activityType: "job_replayed_from_dead_letter",
      metadata: {
        dead_letter_id: normalizeText(deadLetter.id),
        job_id: jobId,
        operator_reason: replayGuard.reason,
        replay_reason: input.replayReason ?? null,
        replayed_job_id: normalizeText(row?.id),
      },
      operatorActionId: "dead_letter_replay",
      targetDisplay: normalizeText(deadLetter.job_type) || jobId,
      targetId: normalizeText(row?.id) || jobId,
      targetType: "platform_job",
    });

    return buildApiSuccess("Dead-letter job replay queued.", {
      deadLetterId: normalizeText(deadLetter.id),
      job: row ? mapJobs([row])[0] : null,
      sourceJobId: jobId,
    });
  }

  if (input.action === "cancel") {
    const jobId = normalizeText(input.jobId);
    if (!jobId) {
      return buildApiFailure("Job ID is required.", "INVALID_REQUEST");
    }

    const existing = await readMaybeSingle<JobQueueRow>(
      client
        .from("platform_job_queue")
        .select(JOB_QUEUE_SELECT_FIELDS)
        .eq("id", jobId)
        .maybeSingle(),
    );
    if (!existing) {
      return buildApiFailure("Job not found.", "NOT_FOUND");
    }

    const mappedExisting = mapJobRow(existing);
    if (!["queued", "running"].includes(mappedExisting.status)) {
      return buildApiFailure("Only queued or running jobs can be cancelled.", "INVALID_REQUEST");
    }

    const cancelGuard = options.safetyAlreadyConfirmed
      ? { reason: normalizeNullableText(input.cancelReason), response: null }
      : await enforceOperatorActionGuard({
          actionId: "queue_cancel",
          actor,
          client,
          confirmationText: input.confirmationText,
          dryRun: input.dryRun,
          fingerprint: buildOperatorFingerprint({
            claimedBy: mappedExisting.claimedBy,
            jobId,
            jobType: mappedExisting.jobType,
            reason: input.cancelReason ?? null,
            status: mappedExisting.status,
          }),
          previewBuilder: () => ({
        actionId: "queue_cancel",
        confirmationLabel: getActionConfirmationLabel("queue_cancel"),
        cooldownUntil: null,
        dryRun: true,
        duplicateRisk: "low",
        existingCaptureLineage: [
          mappedExisting.trace.originRequestId ?? "",
          mappedExisting.trace.correlationId ?? "",
          mappedExisting.trace.traceId ?? "",
        ].filter(Boolean),
        idempotencyKey: normalizeNullableText(mappedExisting.deduplicationKey ?? mappedExisting.claimToken),
        impacts: [
          {
            after: mappedExisting.status === "queued" ? "cancelled" : "cancel_requested",
            before: mappedExisting.status,
            detail: input.cancelReason ?? "Cancelled by operator.",
            label: "job_status",
          },
          {
            after: mappedExisting.status === "queued" ? "none" : mappedExisting.claimedBy || "worker",
            before: mappedExisting.claimedBy || "unclaimed",
            label: "claim_owner",
          },
        ],
        requiresReason: true,
        reversible: false,
        retryHistory: mappedExisting.retryHistory,
        severity: getActionDefinition("queue_cancel").severity,
        summary: "Cancelling a queued job is immediate. Cancelling a running job records a cancellation request for the worker to honor.",
        targetDisplay: mappedExisting.jobType,
        title: getActionDefinition("queue_cancel").label,
        token: null,
        traceLineage: mappedExisting.traceLineage,
        warnings:
          mappedExisting.status === "running"
            ? ["The job is already running, so the worker must still observe the cancellation marker."]
            : [],
          }),
          reason: input.cancelReason,
          targetDisplay: mappedExisting.jobType,
          targetId: jobId,
          targetType: "platform_job",
          token: input.actionToken,
        });

    if (cancelGuard.response) {
      return cancelGuard.response;
    }

    const cancelledAt = nowIso();
    const cancelReason = normalizeNullableText(input.cancelReason) ?? "Cancelled by operator.";
    const nextPayload = writeJobQueuePayload(existing.payload, {
      cancellationReason: cancelReason,
      cancelledAt: mappedExisting.status === "queued" ? cancelledAt : normalizeNullableText(readJobQueueMetadata(existing.payload).cancelledAt),
      cancelRequestedAt: cancelledAt,
      cancelRequestedBy: actor.actorUserId,
      claimToken: mappedExisting.status === "queued" ? null : normalizeNullableText(readJobQueueMetadata(existing.payload).claimToken),
      claimedBy: mappedExisting.status === "queued" ? null : normalizeNullableText(readJobQueueMetadata(existing.payload).claimedBy),
      lastHeartbeatAt:
        mappedExisting.status === "queued" ? cancelledAt : normalizeNullableText(readJobQueueMetadata(existing.payload).lastHeartbeatAt),
      visibilityTimeoutAt: mappedExisting.status === "queued" ? null : readJobVisibilityTimeoutAt(mappedExisting),
    });
    const updateValues: Record<string, unknown> = {
      cancellation_reason: cancelReason,
      cancel_requested_at: cancelledAt,
      cancel_requested_by: actor.actorUserId,
      payload: nextPayload,
    };

    if (mappedExisting.status === "queued") {
      updateValues.cancelled_at = cancelledAt;
      updateValues.claim_token = null;
      updateValues.claimed_by = null;
      updateValues.finished_at = cancelledAt;
      updateValues.last_heartbeat_at = cancelledAt;
      updateValues.status = "cancelled";
      updateValues.visibility_timeout_at = null;
    }

    const row = await readMaybeSingle<JobQueueRow>(
      client
        .from("platform_job_queue")
        .update(updateValues)
        .eq("id", jobId)
        .select(JOB_QUEUE_SELECT_FIELDS)
        .maybeSingle(),
    );

    await recordAdminAction(client, actor, {
      action: "job_cancel_requested",
      activityMessage:
        mappedExisting.status === "queued"
          ? `Cancelled queued job ${jobId}.`
          : `Requested cancellation for running job ${jobId}.`,
      activityType: "job_cancel_requested",
      metadata: {
        cancel_reason: cancelReason,
        job_id: jobId,
        operator_reason: cancelGuard.reason,
      },
      operatorActionId: "queue_cancel",
      targetDisplay: normalizeText(row?.job_type) || jobId,
      targetId: jobId,
      targetType: "platform_job",
    });

    return buildApiSuccess(
      mappedExisting.status === "queued" ? "Job cancelled." : "Job cancellation requested.",
      {
        job: row ? mapJobs([row])[0] : null,
      },
    );
  }

  const queuedJobs = await readOptionalRows<JobQueueRow>(
    client
      .from("platform_job_queue")
      .select(JOB_QUEUE_SELECT_FIELDS)
      .lte("scheduled_for", nowIso())
      .eq("status", "queued")
      .order("scheduled_for", { ascending: true })
      .limit(12),
  );
  const staleRunningJobs = await readOptionalRows<JobQueueRow>(
    client
      .from("platform_job_queue")
      .select(JOB_QUEUE_SELECT_FIELDS)
      .eq("status", "running")
      .order("started_at", { ascending: true })
      .limit(20),
  );
  const dueJobs = mapJobs([...queuedJobs, ...staleRunningJobs]).filter((job) => {
    if (isDeadLetteredJob(job.payload)) {
      return false;
    }

    if (job.status === "running") {
      return shouldRecoverRunningJob({
        payload: job.payload,
        startedAt: job.startedAt,
        visibilityTimeoutAt: readJobVisibilityTimeoutAt(job),
      });
    }

    return true;
  });

  const runDueGuard = options.safetyAlreadyConfirmed
    ? { reason: normalizeNullableText(input.replayReason), response: null }
    : await enforceOperatorActionGuard({
        actionId: "run_due_jobs",
        actor,
        client,
        confirmationText: input.confirmationText,
        dryRun: input.dryRun,
        fingerprint: buildOperatorFingerprint({
          dueJobIds: dueJobs.map((job) => job.id),
          queuedJobs: queuedJobs.length,
          staleRunningJobs: staleRunningJobs.length,
        }),
        previewBuilder: () => ({
      actionId: "run_due_jobs",
      confirmationLabel: getActionConfirmationLabel("run_due_jobs"),
      cooldownUntil: null,
      dryRun: true,
      duplicateRisk: dueJobs.length > 0 ? "medium" : "low",
      existingCaptureLineage: dueJobs.map((job) => job.trace.originRequestId || "").filter(Boolean),
      idempotencyKey: null,
      impacts: [
        {
          after: String(dueJobs.length),
          before: "0",
          detail: `${queuedJobs.length} queued and ${staleRunningJobs.length} stale-running jobs are eligible.`,
          label: "jobs_to_execute",
        },
      ],
      requiresReason: true,
      reversible: false,
      retryHistory: [],
      severity: getActionDefinition("run_due_jobs").severity,
      summary: "Running due jobs now can recover stale work but may amplify load on downstream dependencies.",
      targetDisplay: "background_jobs",
      title: getActionDefinition("run_due_jobs").label,
      token: null,
      traceLineage: [],
      warnings: dueJobs.length === 0 ? ["No due jobs are currently eligible for execution."] : [],
        }),
        reason: input.replayReason,
        targetDisplay: "background_jobs",
        targetId: "background_jobs",
        targetType: "platform_job",
        token: input.actionToken,
      });

  if (runDueGuard.response) {
    return runDueGuard.response;
  }

  const results = [] as Array<{ id: string; result: JsonRecord }>;
  for (const job of dueJobs) {
    try {
      const result = await executeJob({
        actor,
        client,
        env,
        job,
      });
      results.push({
        id: job.id,
        result,
      });
    } catch (error) {
      results.push({
        id: job.id,
        result: {
          error: error instanceof Error ? error.message : "Job execution failed.",
        },
      });
    }
  }

  await recordAdminAction(client, actor, {
    action: "jobs_run_due_now",
    activityMessage: `Ran ${results.length} due background jobs.`,
    activityType: "jobs_run_due_now",
    metadata: {
      count: results.length,
      operator_reason: runDueGuard.reason,
    },
    operatorActionId: "run_due_jobs",
    targetDisplay: "background_jobs",
    targetType: "platform_job",
  });

  return buildApiSuccess("Due jobs processed.", {
    results,
  });
};

export const createImpersonationData = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  input: AdminImpersonationInput,
) => {
  const client = buildServiceClient(env);
  const targetUserId = normalizeText(input.targetUserId);
  if (!targetUserId) {
    return buildApiFailure("Target user ID is required.", "INVALID_REQUEST");
  }

  const profile = await readMaybeSingle<ProfileRow>(
    client
      .from("profiles")
      .select("user_id, email, full_name")
      .eq("user_id", targetUserId)
      .maybeSingle(),
  );

  const email = normalizeText(profile?.email);
  if (!email) {
    return buildApiFailure("The target user does not have an email address for impersonation.", "EMAIL_REQUIRED");
  }

  const generated = await client.auth.admin.generateLink({
    email,
    options: {
      redirectTo: buildImpersonationRedirect(env),
    },
    type: "magiclink",
  });

  if (generated.error || !generated.data.properties?.action_link) {
    return buildApiFailure(
      generated.error?.message || "Unable to generate impersonation access.",
      "IMPERSONATION_FAILED",
    );
  }

  const session = await readMaybeSingle<Record<string, unknown>>(
    client
      .from("super_admin_impersonation_sessions")
      .insert({
        metadata: {
          generated_by: actor.actorUserId,
        },
        reason: input.reason ?? null,
        super_admin_user_id: actor.actorUserId,
        target_library_id: input.libraryId ?? null,
        target_user_id: targetUserId,
      })
      .select("id")
      .maybeSingle(),
  );

  await recordAdminAction(client, actor, {
    action: "impersonation_started",
    activityMessage: `Started impersonation for ${normalizeText(profile?.full_name) || email}.`,
    activityType: "impersonation_started",
    libraryId: input.libraryId ?? null,
    metadata: {
      reason: input.reason ?? null,
      target_user_id: targetUserId,
    },
    targetDisplay: normalizeText(profile?.full_name) || email,
    targetId: targetUserId,
    targetType: "impersonation_session",
    userId: targetUserId,
  });

  return buildApiSuccess("Impersonation link generated.", {
    impersonationLink: generated.data.properties.action_link,
    sessionId: normalizeText(session?.id),
  });
};
