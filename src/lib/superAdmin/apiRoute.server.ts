import { createClient } from "@supabase/supabase-js";
import IORedis from "ioredis";
import { jsPDF } from "jspdf";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { evaluateMaintenanceRequest, readMaintenanceContextFromHeaders, buildMaintenanceApiError } from "../maintenanceGuard.server.js";
import { extractClientIp, extractUserAgent, normalizeParsedRequestBody } from "../httpRequest.server.js";
import { logEvent } from "../observability/eventLogger.server.js";
import {
  applyTraceResponseHeaders,
  createRequestTraceContext,
  getRequestTraceContext,
  runWithRequestTraceContext,
} from "../observability/requestContext.server.js";
import {
  getRuntimeCounterTotal,
  incrementRuntimeMetric,
  recordRuntimeLatency,
} from "../observability/runtimeMetrics.server.js";
import { resolveSupabaseAdminConfig } from "../observability/supabaseAdminConfig.server.js";
import { resolveSuperAdminSessionRequest } from "../otpAuth.server.js";
import { createInstrumentedServerSupabaseFetch } from "../observability/serverSupabaseFetch.server.js";
import { isSuperAdminIpAllowed } from "../platformSettings.server.js";
import {
  buildServiceClient,
  createBroadcastData,
  createInvoiceData,
  createRefundData,
  createRevenueAdjustmentData,
  deletePlanData,
  deleteTemplateData,
  getAutomationCenterData,
  getBillingCenterData,
  getCommunicationCenterData,
  getControlCenterData,
  getIncidentCenterData,
  getLibraryCenterData,
  getPlatformSettingsData,
  getRevenueCenterData,
  getSecurityCenterData,
  handleJobActionData,
  manageOperatorRoleGrantData,
  performLibraryActionData,
  performUserActionData,
  reviewGovernanceRequestData,
  resolveIncidentData,
  resolveSuperAdminOperatorAccessData,
  type SuperAdminActorContext,
  updateCommissionData,
  updateFeatureFlagData,
  updatePlatformSettingsData,
  upsertPlanData,
  upsertTemplateData,
} from "./service.server.js";
import { canAccessControlPlanePage, EMPTY_OPERATOR_SCOPE_BOUNDARY, expandOperatorPermissions, resolveOperatorPages, type AdminOperatorGrant } from "./governance.js";
import { buildOperationalIntelligenceSnapshot } from "./operationalIntelligence.js";
import type {
  AdminBillingPaymentRow,
  AdminBroadcastInput,
  AdminFeatureFlagInput,
  AdminIncidentResolutionInput,
  AdminInvoiceInput,
  AdminJobActionInput,
  AdminLibraryActionInput,
  AdminRuntimeTraceEvent,
  AdminPlanUpsertInput,
  AdminRefundInput,
  AdminRevenueAdjustmentInput,
  AdminUserActionInput,
  StructuredApiResponse,
  SuperAdminAutomationCenterData,
  SuperAdminBillingCenterData,
  SuperAdminCommunicationCenterData,
  SuperAdminControlCenterData,
  SuperAdminIncidentCenterData,
  SuperAdminLibraryCenterData,
  SuperAdminRevenueCenterData,
  SuperAdminSecurityCenterData,
} from "./types.js";

type EnvLike = Record<string, string | undefined>;

export type AdminApiHeaders = Record<string, string | string[] | undefined>;

export type AdminApiRequest = {
  body?: unknown;
  headers?: AdminApiHeaders;
  method?: string;
  url?: string;
};

export type AdminApiResponse = {
  end: (body?: string | Uint8Array) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

type RequestContext = {
  authorization?: string;
  cookieHeader?: string;
  deviceFingerprint?: string;
  deviceLabel?: string;
  host?: string;
  ip?: string;
  origin?: string;
  pathname: string;
  requestSource?: string;
  referer?: string;
  userAgent?: string;
};

type Pagination = {
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
};

type PaginatedItems<T> = {
  items: T[];
  pagination: Pagination;
};

type PdfInvoiceRow = {
  id: string;
  invoiceNumber: string;
  invoiceType: string;
  issuedAt: string;
  libraryId: string;
  libraryName: string | null;
  periodEnd: string | null;
  periodStart: string | null;
  status: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
};

type ActiveSessionRow = {
  auth_level?: number | null;
  expires_at?: string | null;
  id?: string | null;
  session_scope?: string | null;
  user_id?: string | null;
};

type ErrorBody = {
  details?: Record<string, string[]>;
  errorCode: string;
  message: string;
  requestId: string;
  success: false;
};

const ADMIN_API_ROUTE_PATHS = [
  "/api/admin/platform",
  "/api/admin/feature-flags",
  "/api/admin/libraries",
  "/api/admin/users",
  "/api/admin/revenue",
  "/api/admin/broadcasts",
  "/api/admin/security",
  "/api/admin/incidents",
  "/api/admin/analytics",
  "/api/admin/billing",
  "/api/admin/jobs",
] as const;

type AdminApiRoutePath = (typeof ADMIN_API_ROUTE_PATHS)[number];

const ADMIN_API_ROUTE_SET = new Set<string>(ADMIN_API_ROUTE_PATHS);
const RATE_LIMIT_WINDOW_SECONDS = 60;
const GET_RATE_LIMIT = 180;
const MUTATION_RATE_LIMIT = 90;
const memoryRateLimitStore = new Map<string, { count: number; resetAt: number }>();
const redisClients = new Map<string, IORedis>();

const listQuerySchema = z.object({
  channel: z.string().trim().optional().default(""),
  format: z.enum(["json", "csv", "pdf"]).optional().default("json"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  scope: z.string().trim().optional().default("overview"),
  search: z.string().trim().optional().default(""),
  severity: z.string().trim().optional().default(""),
  status: z.string().trim().optional().default(""),
  invoiceId: z.string().trim().optional().default(""),
});

const actionSafetySchema = {
  actionToken: z.string().trim().optional().nullable(),
  confirmationText: z.string().trim().optional().nullable(),
  dryRun: z.boolean().optional(),
};

const featureFlagInputSchema = z.object({
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean(),
  key: z.string().trim().min(1),
  rolloutPercentage: z.number().int().min(0).max(100).optional(),
  variants: z.array(z.record(z.unknown())).optional(),
}).extend(actionSafetySchema) satisfies z.ZodType<AdminFeatureFlagInput>;

const platformSettingsUpdateSchema = z.object({
  actionToken: z.string().trim().optional().nullable(),
  confirmationText: z.string().trim().optional().nullable(),
  dryRun: z.boolean().optional(),
  operatorReason: z.string().trim().optional().nullable(),
  settings: z.record(z.unknown()),
});

const libraryActionSchema = z.union([
  z.object({
    action: z.enum(["enable", "disable", "suspend", "ban", "clear_control", "approve_payout", "reject_payout", "mark_payout_paid"]),
    amount: z.number().optional(),
    libraryId: z.string().trim().min(1),
    note: z.string().trim().optional(),
    payoutId: z.string().trim().optional(),
    untilAt: z.string().trim().nullable().optional(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("impersonate_admin"),
    confirmationText: z.string().trim().optional().nullable(),
    dryRun: z.boolean().optional(),
    libraryId: z.string().trim().optional().nullable(),
    reason: z.string().trim().optional().nullable(),
    targetUserId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("force_logout_all"),
    libraryId: z.string().trim().min(1),
    note: z.string().trim().optional(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("reset_account"),
    libraryId: z.string().trim().min(1),
    note: z.string().trim().optional(),
  }).extend(actionSafetySchema),
]);

const userActionSchema = z.object({
  action: z.enum(["force_logout", "suspend", "ban", "clear_control", "reset_password", "clear_sessions"]),
  libraryId: z.string().trim().optional().nullable(),
  note: z.string().trim().optional(),
  untilAt: z.string().trim().nullable().optional(),
  userId: z.string().trim().min(1),
}).extend(actionSafetySchema) satisfies z.ZodType<AdminUserActionInput>;

const revenueActionSchema = z.union([
  z.object({
    action: z.literal("revenue_adjustment"),
    amountDelta: z.number(),
    libraryId: z.string().trim().min(1),
    paymentId: z.string().trim().optional().nullable(),
    reason: z.string().trim().min(1),
    subscriptionPaymentId: z.string().trim().optional().nullable(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("commission_update"),
    commissionPercent: z.number().min(0).max(100).optional(),
    defaultCommissionPercent: z.number().min(0).max(100).optional(),
    libraryId: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("payout_action"),
    libraryId: z.string().trim().min(1),
    note: z.string().trim().optional(),
    payoutId: z.string().trim().min(1),
    payoutAction: z.enum(["approve_payout", "reject_payout", "mark_payout_paid"]),
  }).extend(actionSafetySchema),
]);

const broadcastActionSchema = z.union([
  z.object({
    action: z.literal("create_broadcast"),
    audience: z.string().trim().optional(),
    channel: z.enum(["email", "in_app", "whatsapp", "telegram"]),
    message: z.string().trim().min(1),
    templateId: z.string().trim().optional().nullable(),
    title: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("upsert_template"),
    body: z.string().trim().min(1),
    channel: z.enum(["email", "in_app", "whatsapp", "telegram"]),
    id: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    key: z.string().trim().min(1),
    name: z.string().trim().min(1),
    subject: z.string().trim().optional().nullable(),
    variables: z.array(z.string().trim()).optional(),
  }),
  z.object({
    action: z.literal("delete_template"),
    templateId: z.string().trim().min(1),
  }),
]);

const scopeBoundarySchema = z.object({
  delegatedScopeId: z.string().trim().optional().nullable(),
  delegatedScopeLabel: z.string().trim().optional().nullable(),
  delegatedScopeType: z.string().trim().optional().nullable(),
  departmentId: z.string().trim().optional().nullable(),
  departmentLabel: z.string().trim().optional().nullable(),
  governanceDomain: z.string().trim().optional().nullable(),
  operationalGroupId: z.string().trim().optional().nullable(),
  operationalGroupLabel: z.string().trim().optional().nullable(),
  organizationId: z.string().trim().optional().nullable(),
  organizationLabel: z.string().trim().optional().nullable(),
  regionId: z.string().trim().optional().nullable(),
  regionLabel: z.string().trim().optional().nullable(),
  teamId: z.string().trim().optional().nullable(),
  teamLabel: z.string().trim().optional().nullable(),
  tenantId: z.string().trim().optional().nullable(),
  tenantLabel: z.string().trim().optional().nullable(),
  visibilityTags: z.array(z.string().trim()).optional(),
});

const securityActionSchema = z.union([
  z.object({
    action: z.literal("update_ip_whitelist"),
    enabled: z.boolean(),
    whitelist: z.array(z.string().trim()).default([]),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("assign_operator_role"),
    availabilityStatus: z.enum(["active", "after_hours", "away", "backup", "offline", "standby"]).optional().nullable(),
    backupOperator: z.string().trim().optional().nullable(),
    deniedActions: z.array(z.string().trim()).optional(),
    deniedPermissions: z.array(z.string().trim()).optional(),
    email: z.string().trim().email().optional().nullable(),
    expiresAt: z.string().trim().optional().nullable(),
    fallbackChain: z.array(z.string().trim()).optional(),
    grantMode: z.string().trim().optional().nullable(),
    regions: z.array(z.string().trim()).optional(),
    readOnlyMode: z.boolean().optional(),
    reason: z.string().trim().min(1),
    role: z.string().trim().min(1),
    boundary: scopeBoundarySchema.optional().nullable(),
    scopeId: z.string().trim().optional().nullable(),
    scopeLabel: z.string().trim().optional().nullable(),
    scopeType: z.string().trim().optional().nullable(),
    shiftEndHourLocal: z.number().int().min(0).max(24).optional().nullable(),
    shiftLabel: z.string().trim().optional().nullable(),
    shiftStartHourLocal: z.number().int().min(0).max(24).optional().nullable(),
    standby: z.boolean().optional(),
    startsAt: z.string().trim().optional().nullable(),
    timezone: z.string().trim().optional().nullable(),
    userId: z.string().trim().optional().nullable(),
    workloadCapacity: z.number().int().positive().optional().nullable(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("revoke_operator_role"),
    grantId: z.string().trim().min(1),
    reason: z.string().trim().optional().nullable(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.enum(["approve_governance_request", "reject_governance_request"]),
    note: z.string().trim().optional().nullable(),
    requestId: z.string().trim().min(1),
  }).extend(actionSafetySchema),
]);

const incidentActionSchema = z.union([
  z.object({
    action: z.literal("resolve_incident"),
    incidentKey: z.string().trim().min(1),
    resolutionNote: z.string().trim().optional(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("acknowledge_incident"),
    incidentKey: z.string().trim().min(1),
    note: z.string().trim().optional(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("assign_incident"),
    assigneeEmail: z.string().trim().email(),
    assigneeUserId: z.string().trim().optional().nullable(),
    assigneeRegion: z.string().trim().optional().nullable(),
    assigneeTeam: z.string().trim().optional().nullable(),
    backupAssigneeEmail: z.string().trim().email().optional().nullable(),
    handoffType: z.enum(["assignment", "follow_the_sun", "handoff", "shift_change"]).optional(),
    incidentKey: z.string().trim().min(1),
    note: z.string().trim().optional(),
    shiftLabel: z.string().trim().optional().nullable(),
    shiftTimezone: z.string().trim().optional().nullable(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("escalate_incident"),
    afterHours: z.boolean().optional(),
    backupOperatorEmail: z.string().trim().email().optional().nullable(),
    escalationLevel: z.number().int().min(1).optional(),
    incidentKey: z.string().trim().min(1),
    note: z.string().trim().optional(),
    regionalFailoverFrom: z.string().trim().optional().nullable(),
    regionalFailoverTo: z.string().trim().optional().nullable(),
    routeToRegion: z.string().trim().optional().nullable(),
    routeToRole: z.string().trim().optional().nullable(),
    routeToTeam: z.string().trim().optional().nullable(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("add_incident_note"),
    coordinationCategory: z.string().trim().optional().nullable(),
    delegatedRemediatorEmail: z.string().trim().email().optional().nullable(),
    incidentKey: z.string().trim().min(1),
    linkedApprovalRequestId: z.string().trim().optional().nullable(),
    linkedGovernanceActionId: z.string().trim().optional().nullable(),
    note: z.string().trim().min(1),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("retry_from_incident"),
    delegatedRemediatorEmail: z.string().trim().email().optional().nullable(),
    incidentKey: z.string().trim().min(1),
    linkedApprovalRequestId: z.string().trim().optional().nullable(),
    note: z.string().trim().optional(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("approve_incident_severity"),
    incidentKey: z.string().trim().min(1),
    note: z.string().trim().optional(),
  }).extend(actionSafetySchema),
]) satisfies z.ZodType<AdminIncidentResolutionInput>;

const billingActionSchema = z.union([
  z.object({
    action: z.literal("create_invoice"),
    invoiceType: z.enum(["subscription", "refund", "manual_adjustment"]).optional(),
    libraryId: z.string().trim().min(1),
    metadata: z.record(z.unknown()).optional(),
    periodEnd: z.string().trim().optional().nullable(),
    periodStart: z.string().trim().optional().nullable(),
    subtotal: z.number(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("process_refund"),
    amount: z.number(),
    invoiceId: z.string().trim().optional().nullable(),
    libraryId: z.string().trim().min(1),
    paymentId: z.string().trim().optional().nullable(),
    reason: z.string().trim().min(1),
    subscriptionPaymentId: z.string().trim().optional().nullable(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("upsert_plan"),
    code: z.string().trim().min(1),
    description: z.string().trim().optional().nullable(),
    features: z.array(z.string().trim()).optional(),
    id: z.string().trim().optional(),
    isActive: z.boolean().optional(),
    lockersLimit: z.number().int().positive().optional().nullable(),
    name: z.string().trim().min(1),
    price: z.number().min(0),
    seatsLimit: z.number().int().positive().optional().nullable(),
    sortOrder: z.number().int().optional(),
  }).extend(actionSafetySchema),
  z.object({
    action: z.literal("delete_plan"),
    planId: z.string().trim().min(1),
  }).extend(actionSafetySchema),
]);

const jobActionSchema = z.object({
  action: z.enum(["enqueue", "retry", "cancel", "run_due_now", "replay_dead_letter"]),
  cancelReason: z.string().trim().optional().nullable(),
  jobId: z.string().trim().optional(),
  jobType: z.string().trim().optional(),
  payload: z.record(z.unknown()).optional(),
  replayReason: z.string().trim().optional().nullable(),
  scheduledFor: z.string().trim().optional().nullable(),
}).extend(actionSafetySchema) satisfies z.ZodType<AdminJobActionInput>;

const analyticsFiltersSchema = z.object({
  city: z.string().trim().optional().default(""),
});

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const createAdminServiceClient = (env: EnvLike) => {
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
      fetch: createInstrumentedServerSupabaseFetch("super_admin_api"),
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
  redisClients.set(redisUrl, client);
  return client;
};

const readHeaderValue = (headers: AdminApiHeaders | undefined, name: string) => {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

const readRequestPath = (req: AdminApiRequest) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

const readRequestContext = (req: AdminApiRequest): RequestContext => {
  const headers = req.headers ?? {};
  return {
    authorization: readHeaderValue(headers, "authorization"),
    cookieHeader: readHeaderValue(headers, "cookie"),
    deviceFingerprint: readHeaderValue(headers, "x-device-fingerprint"),
    deviceLabel: readHeaderValue(headers, "x-device-label"),
    host: readHeaderValue(headers, "host") || readHeaderValue(headers, "x-forwarded-host"),
    ip: extractClientIp(headers),
    origin: readHeaderValue(headers, "origin"),
    pathname: readRequestPath(req),
    requestSource: readHeaderValue(headers, "x-control-plane-source"),
    referer: readHeaderValue(headers, "referer"),
    userAgent: extractUserAgent(headers),
  };
};

const readParsedBody = (req: AdminApiRequest) =>
  normalizeParsedRequestBody(req.body, readHeaderValue(req.headers, "content-type"));

const readQuery = (req: AdminApiRequest) => {
  const url = new URL(req.url || "/", "http://localhost");
  return Object.fromEntries(url.searchParams.entries());
};

const buildSuccessBody = <T>(requestId: string, message: string, data: T) => ({
  data,
  message,
  requestId,
  success: true as const,
});

const buildFallbackControlCenterData = () => ({
  analytics: {
    activeStudentsToday: 0,
    conversionRate: 0,
    dailyActiveLibraries: 0,
    revenueByCity: [],
    revenueThisMonth: 0,
    revenuePreviousMonth: 0,
    series: [],
  },
  automation: { failedJobs: 0, inactiveLibraries: [], queuedJobs: 0 },
  featureFlags: [],
  incidents: [],
  libraries: [],
  operator: null,
  releaseGovernance: null,
  runtimeGovernance: null,
  security: { ipWhitelistEnabled: false, suspiciousIps: [], whitelist: [] },
  settings: [],
  statusSignals: [],
  systemStatus: "yellow",
});

const buildFallbackAnalyticsData = () => ({
  healthCenter: [],
  incidents: { critical: 0, error: 0, info: 0, warning: 0 },
  operationalIntelligence: null,
});

const extractNumericValue = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const findStatusSignal = (
  control: SuperAdminControlCenterData,
  label: string,
) => control.statusSignals.find((signal) => signal.label.toLowerCase() === label.toLowerCase());

const mergeStatusSignals = (
  baseSignals: SuperAdminControlCenterData["statusSignals"],
  overrides: SuperAdminControlCenterData["statusSignals"],
) => {
  const merged = new Map(baseSignals.map((signal) => [signal.label.toLowerCase(), signal] as const));

  for (const signal of overrides) {
    merged.set(signal.label.toLowerCase(), signal);
  }

  return [...merged.values()];
};

const readControlSettingNumber = (
  control: SuperAdminControlCenterData,
  key: string,
  fallback: number,
) => {
  const setting = control.settings.find((candidate) => candidate.key === key);
  const parsed =
    typeof setting?.value === "number"
      ? setting.value
      : typeof setting?.value === "string"
        ? Number(setting.value)
        : null;

  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildDerivedRuntimeVisibility = (
  control: SuperAdminControlCenterData,
): SuperAdminSecurityCenterData["runtimeVisibility"] => {
  const emailSignal = findStatusSignal(control, "Email");
  const latencySignal = findStatusSignal(control, "Latency");
  const redisSignal = findStatusSignal(control, "Redis");

  return {
    activeWorkers: 0,
    apiLatencyP95Ms: extractNumericValue(latencySignal?.value) ?? 0,
    deadLetterJobs: 0,
    emailFailureRate: Math.max(0, 100 - (extractNumericValue(emailSignal?.value) ?? 0)),
    incidentSeverityCounts: {
      critical: control.incidents.filter((incident) => incident.severity === "CRITICAL").length,
      error: control.incidents.filter((incident) => incident.severity === "ERROR").length,
      info: control.incidents.filter((incident) => incident.severity === "INFO").length,
      warning: control.incidents.filter((incident) => incident.severity === "WARNING").length,
    },
    otpDeliveryFailures: 0,
    paymentRetryRate: 0,
    queueLagMs: 0,
    queueLatencyP95Ms: 0,
    redisDegraded: redisSignal ? redisSignal.status !== "green" : false,
    retryCount: 0,
    slowRequests: 0,
  };
};

const buildDerivedCommunicationHealth = (
  control: SuperAdminControlCenterData,
): SuperAdminCommunicationCenterData["deliveryHealth"] => ({
  emailSuccessRate: extractNumericValue(findStatusSignal(control, "Email")?.value) ?? 0,
  failedNotifications: 0,
  queuedNotifications: 0,
});

const buildDerivedIncidentCenter = (
  control: SuperAdminControlCenterData,
): SuperAdminIncidentCenterData => ({
  analytics: {
    afterHoursEscalations: 0,
    crossTeamEscalations: 0,
    delegatedRemediations: 0,
    regionalFailovers: 0,
    unresolvedOwnership: 0,
  },
  coordination: {
    escalationLineage: [],
    followTheSun: {
      afterHoursEscalations: 0,
      regions: [],
      transitions: [],
    },
    handoffs: [],
    ownershipGaps: [],
    regionalFailovers: [],
  },
  generatedAt: control.generatedAt,
  groups: control.incidents,
  snapshots: [],
  summary: {
    acknowledged: control.incidents.filter((incident) => Boolean(incident.acknowledgedAt)).length,
    critical: control.incidents.filter((incident) => incident.severity === "CRITICAL").length,
    error: control.incidents.filter((incident) => incident.severity === "ERROR").length,
    escalated: control.incidents.filter((incident) => incident.escalationLevel > 0).length,
    info: control.incidents.filter((incident) => incident.severity === "INFO").length,
    unresolved: control.incidents.reduce((sum, incident) => sum + incident.unresolvedCount, 0),
    warning: control.incidents.filter((incident) => incident.severity === "WARNING").length,
  },
});

const buildDerivedSecurityCenter = (
  control: SuperAdminControlCenterData,
): SuperAdminSecurityCenterData => ({
  accessLogs: [],
  auditLogs: [],
  eventLogs: [],
  generatedAt: control.generatedAt,
  ipWhitelistEnabled: control.security.ipWhitelistEnabled,
  suspiciousIps: control.security.suspiciousIps,
  runtimeVisibility: buildDerivedRuntimeVisibility(control),
  whitelist: control.security.whitelist,
});

const buildDerivedAutomationCenter = (
  control: SuperAdminControlCenterData,
): SuperAdminAutomationCenterData => ({
  deadLetters: [],
  generatedAt: control.generatedAt,
  jobs: [],
  settings: {
    automationInactiveLibraryAlertEnabled: control.runtimeGovernance.automationInactiveLibraryAlertEnabled,
    automationPaymentReminderEnabled: control.runtimeGovernance.automationPaymentReminderEnabled,
    automationSubscriptionRenewalEnabled: control.runtimeGovernance.automationSubscriptionRenewalEnabled,
    inactiveLibraryDays: readControlSettingNumber(control, "inactive_library_days", 14),
  },
  summary: {
    activeWorkers: 0,
    deadLetterJobs: 0,
    paused: !control.runtimeGovernance.queueProcessingEnabled,
    queueLagMs: 0,
    queueLatencyP95Ms: 0,
    queuedJobs: control.automation.queuedJobs,
    redisDegraded: findStatusSignal(control, "Redis")?.status !== "green",
    retryCount: 0,
    runningJobs: 0,
  },
});

const buildDerivedBillingCenter = (
  control: SuperAdminControlCenterData,
): SuperAdminBillingCenterData => ({
  generatedAt: control.generatedAt,
  gstRatePercent: readControlSettingNumber(control, "gst_rate_percent", 18),
  invoices: [],
  operations: {
    billingMutationsEnabled: control.runtimeGovernance.billingMutationsEnabled,
    duplicatePayments: 0,
    manualReviewPayments: 0,
    paymentRetryRate: 0,
    reconciledPayments: 0,
    stuckPayments: 0,
    verificationRetries: 0,
    webhookRetries: 0,
  },
  paymentHistory: [] as AdminBillingPaymentRow[],
  refunds: [],
});

const buildFallbackSecurityData = () => ({
  auditLogs: [],
  ipWhitelistEnabled: false,
  operatorGovernance: null,
  operatorTimeline: [],
  runtimeVisibility: null,
  whitelist: [],
});

const buildApiSuccess = <T>(message: string, data: T) => ({
  success: true as const,
  message,
  data,
  errorCode: null,
});

const buildErrorBody = (
  requestId: string,
  message: string,
  errorCode: string,
  details?: Record<string, string[]>,
): ErrorBody => ({
  ...(details ? { details } : {}),
  errorCode,
  message,
  requestId,
  success: false,
});

const sendJson = (res: AdminApiResponse, statusCode: number, body: unknown, extraHeaders?: Record<string, string | string[]>) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      res.setHeader(name, value);
    }
  }

  res.end(JSON.stringify(body));
};

const sendContent = (
  res: AdminApiResponse,
  statusCode: number,
  body: string | Uint8Array,
  contentType: string,
  extraHeaders?: Record<string, string | string[]>,
) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");

  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      res.setHeader(name, value);
    }
  }

  res.end(body);
};

const recordAdminRouteMetrics = ({
  durationMs,
  method,
  pathname,
  statusCode,
}: {
  durationMs: number;
  method: string;
  pathname: string;
  statusCode: number;
}) => {
  const outcome = statusCode >= 400 ? "error" : "success";

  incrementRuntimeMetric("http_requests_total", 1, {
    area: "admin",
    method,
    outcome,
    route: pathname,
  });
  incrementRuntimeMetric("admin_requests_total", 1, {
    method,
    outcome,
    route: pathname,
    status_code: statusCode,
  });
  recordRuntimeLatency("http_request_latency_ms", durationMs, {
    area: "admin",
    method,
    outcome,
    route: pathname,
  });

  if (durationMs >= 1500) {
    void logEvent({
      type: "ADMIN_ROUTE_SLOW",
      status: "FAILED",
      classification: "PERFORMANCE_EVENT",
      entityId: pathname,
      metadata: {
        area: "admin",
        duration_ms: durationMs,
        method,
        route: pathname,
        severity: durationMs >= 3000 ? "ERROR" : "WARNING",
        status_code: statusCode,
      },
      message: `Admin route ${pathname} completed in ${durationMs}ms.`,
    }, {
      skipConsole: true,
    });
  }
};

const sendMethodNotAllowed = (res: AdminApiResponse, requestId: string, allowedMethod: string) => {
  sendJson(
    res,
    405,
    buildErrorBody(requestId, "Method not allowed.", "METHOD_NOT_ALLOWED"),
    { Allow: allowedMethod },
  );
};

const buildValidationDetails = (issues: z.ZodIssue[]) =>
  issues.reduce<Record<string, string[]>>((accumulator, issue) => {
    const path = issue.path.join(".") || "_root";
    const current = accumulator[path] ?? [];
    current.push(issue.message);
    accumulator[path] = current;
    return accumulator;
  }, {});

const mapErrorCodeToStatus = (errorCode: string | null | undefined) => {
  switch (errorCode) {
    case "ACCESS_DENIED":
      return 403;
    case "EMAIL_REQUIRED":
    case "IMPERSONATION_FAILED":
    case "INVALID_REQUEST":
    case "PASSWORD_RESET_FAILED":
      return 400;
    case "NOT_FOUND":
      return 404;
    default:
      return 200;
  }
};

const sendServiceResponse = <T>(
  res: AdminApiResponse,
  requestId: string,
  result: StructuredApiResponse<T>,
) => {
  if (result.success) {
    sendJson(res, 200, buildSuccessBody(requestId, result.message, result.data));
    return;
  }

  sendJson(
    res,
    mapErrorCodeToStatus(result.errorCode),
    buildErrorBody(requestId, result.message, result.errorCode || "ADMIN_ACTION_FAILED"),
  );
};

const paginateItems = <T>(items: T[], page: number, pageSize: number): PaginatedItems<T> => {
  const totalCount = items.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const normalizedPage = Math.min(page, pageCount);
  const start = (normalizedPage - 1) * pageSize;

  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page: normalizedPage,
      pageCount,
      pageSize,
      totalCount,
    },
  };
};

const matchesSearch = (search: string, values: Array<string | null | undefined>) => {
  const normalizedSearch = normalizeText(search).toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return values.some((value) => normalizeText(value).toLowerCase().includes(normalizedSearch));
};

const serializeCsv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0] ?? {});
  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          const normalized = value == null ? "" : String(value);
          return `"${normalized.replace(/"/g, '""')}"`;
        })
        .join(","),
    ),
  ].join("\n");
};

const buildInvoicePdf = (invoice: PdfInvoiceRow) => {
  const pdf = new jsPDF({
    format: "a4",
    unit: "pt",
  });

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.text("Libriofy Invoice", 48, 56);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(`Invoice No: ${invoice.invoiceNumber}`, 48, 88);
  pdf.text(`Issued: ${new Date(invoice.issuedAt).toLocaleString("en-IN")}`, 48, 106);
  pdf.text(`Library: ${invoice.libraryName || invoice.libraryId}`, 48, 124);
  pdf.text(`Type: ${invoice.invoiceType}`, 48, 142);
  pdf.text(`Status: ${invoice.status}`, 48, 160);

  if (invoice.periodStart || invoice.periodEnd) {
    pdf.text(
      `Period: ${invoice.periodStart || "-"} to ${invoice.periodEnd || "-"}`,
      48,
      178,
    );
  }

  pdf.setFont("helvetica", "bold");
  pdf.text("Summary", 48, 224);
  pdf.setFont("helvetica", "normal");
  pdf.text(`Subtotal: INR ${invoice.subtotal.toFixed(2)}`, 48, 248);
  pdf.text(`GST: INR ${invoice.taxAmount.toFixed(2)}`, 48, 266);
  pdf.text(`Total: INR ${invoice.totalAmount.toFixed(2)}`, 48, 284);

  pdf.setFontSize(10);
  pdf.text("Generated by Libriofy Control Plane", 48, 760);

  return Buffer.from(pdf.output("arraybuffer"));
};

const applyMemoryRateLimit = (key: string, maxRequests: number) => {
  const current = memoryRateLimitStore.get(key);
  const now = Date.now();
  if (!current || current.resetAt <= now) {
    memoryRateLimitStore.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_SECONDS * 1000,
    });
    return null;
  }

  current.count += 1;
  memoryRateLimitStore.set(key, current);
  if (current.count > maxRequests) {
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  }

  return null;
};

const applyRateLimit = async (
  env: EnvLike,
  key: string,
  maxRequests: number,
): Promise<number | null> => {
  const redisUrl = readEnv(env, "REDIS_URL");
  const redis = getRedisClient(env);
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
      }

      incrementRuntimeMetric("admin_rate_limit_backend_total", 1, {
        backend: "redis",
        outcome: "success",
      });

      if (count > maxRequests) {
        return Math.max(1, await redis.ttl(key));
      }

      return null;
    } catch {
      if (redisUrl) {
        redisClients.delete(redisUrl);
      }

      try {
        redis.disconnect();
      } catch {
        // Best-effort cleanup only; requests should continue via memory fallback.
      }

      incrementRuntimeMetric("admin_rate_limit_backend_total", 1, {
        backend: "memory",
        outcome: "redis_fallback",
      });
      return applyMemoryRateLimit(key, maxRequests);
    }
  }

  incrementRuntimeMetric("admin_rate_limit_backend_total", 1, {
    backend: "memory",
    outcome: "memory_only",
  });
  return applyMemoryRateLimit(key, maxRequests);
};

const buildActorContext = async (
  env: EnvLike,
  requestId: string,
  context: RequestContext,
) => {
  const requestTrace = getRequestTraceContext();
  const hasCookie = Boolean(context.cookieHeader?.includes("libriofy_refresh"));

  const activeSession = await resolveSuperAdminSessionRequest(env, {
    authorization: context.authorization,
    cookieHeader: context.cookieHeader,
    deviceFingerprint: context.deviceFingerprint,
    deviceLabel: context.deviceLabel,
    host: context.host,
    ip: context.ip,
    origin: context.origin,
    referer: context.referer,
    userAgent: context.userAgent,
  });

  if (!activeSession) {
    const diagnosticMessage = !hasCookie
      ? "No session cookie present. Please sign in."
      : "Session expired or invalid. Please sign in again.";
    console.warn("[admin-auth] Session validation failed:", {
      hasCookie,
      ip: context.ip ?? "unknown",
      pathname: context.pathname,
      requestId,
    });
    return {
      actor: null,
      error: buildErrorBody(requestId, diagnosticMessage, "UNAUTHORIZED"),
      statusCode: 401,
    };
  }

  if (activeSession.impersonation) {
    return {
      actor: null,
      error: buildErrorBody(
        requestId,
        "Stop impersonation before accessing control-plane APIs.",
        "IMPERSONATION_BOUNDARY",
      ),
      statusCode: 403,
    };
  }

  const actorUser = activeSession.realUser ?? activeSession.user;
  let operatorAccess: Awaited<ReturnType<typeof resolveSuperAdminOperatorAccessData>>;
  try {
    operatorAccess = await resolveSuperAdminOperatorAccessData(
      env,
      actorUser.id,
      actorUser.email ?? null,
    );
  } catch (err) {
    console.error("[admin-auth] resolveSuperAdminOperatorAccessData failed:", err instanceof Error ? err.message : String(err));
    // Fall back to full super_admin access so the request can proceed
    const fallbackGrant: AdminOperatorGrant = {
      boundary: EMPTY_OPERATOR_SCOPE_BOUNDARY,
      email: actorUser.email ?? null,
      expiresAt: null,
      grantId: "fallback",
      grantMode: "direct",
      metadata: {},
      reason: "Fallback grant due to governance query failure",
      restrictions: {},
      revokedAt: null,
      role: "super_admin",
      scopeId: null,
      scopeLabel: "Fallback",
      scopeType: "global",
      startsAt: null,
      userId: actorUser.id,
    };
    const fallbackPermissions = expandOperatorPermissions([fallbackGrant]);
    operatorAccess = {
      allowedPages: resolveOperatorPages(fallbackPermissions),
      emergencyAccessActive: true,
      grants: [fallbackGrant],
      legacyFallbackAccess: true,
      permissions: fallbackPermissions,
      readOnlyActive: false,
      roles: ["super_admin"],
      temporaryElevationActive: false,
    };
  }

  const ipAllowed = await isSuperAdminIpAllowed(env, context.ip).catch((err) => {
    console.warn("[admin-auth] isSuperAdminIpAllowed failed (allowing by default):", err instanceof Error ? err.message : String(err));
    return true;
  });
  if (!ipAllowed) {
    return {
      actor: null,
      error: buildErrorBody(requestId, "Your IP address is not allowed for super admin access.", "IP_NOT_ALLOWED"),
      statusCode: 403,
    };
  }

  if (!operatorAccess.roles.length && !operatorAccess.legacyFallbackAccess) {
    return {
      actor: null,
      error: buildErrorBody(
        requestId,
        "No control-plane operator assignment is active for this account.",
        "ACCESS_DENIED",
      ),
      statusCode: 403,
    };
  }

  const actor: SuperAdminActorContext = {
    actorEmail: actorUser.email,
    actorUserId: actorUser.id,
    allowedPages: operatorAccess.allowedPages,
    correlationId: requestTrace?.correlationId ?? requestId,
    emergencyAccessActive: operatorAccess.emergencyAccessActive,
    ipAddress: context.ip ?? null,
    impersonationActive: false,
    legacyFallbackAccess: operatorAccess.legacyFallbackAccess,
    operatorGrants: operatorAccess.grants,
    operatorPermissions: operatorAccess.permissions,
    operatorRoles: operatorAccess.roles,
    readOnlyActive: operatorAccess.readOnlyActive,
    requestPath: context.pathname ?? null,
    requestId,
    requestSource: context.requestSource || context.referer || context.origin || "browser_super_admin",
    temporaryElevationActive: operatorAccess.temporaryElevationActive,
    traceId: requestTrace?.traceId ?? null,
    userAgent: context.userAgent ?? null,
  };

  return {
    actor,
    error: null,
    statusCode: 200,
  };
};

const canReadAdminPath = (pathname: AdminApiRoutePath, actor: SuperAdminActorContext) => {
  switch (pathname) {
    case "/api/admin/platform":
      return canAccessControlPlanePage(actor.operatorPermissions, "dashboard");
    case "/api/admin/feature-flags":
      return canAccessControlPlanePage(actor.operatorPermissions, "feature_flags");
    case "/api/admin/libraries":
    case "/api/admin/users":
      return canAccessControlPlanePage(actor.operatorPermissions, "libraries");
    case "/api/admin/revenue":
      return canAccessControlPlanePage(actor.operatorPermissions, "revenue");
    case "/api/admin/broadcasts":
      return canAccessControlPlanePage(actor.operatorPermissions, "broadcasts");
    case "/api/admin/security":
      return (
        canAccessControlPlanePage(actor.operatorPermissions, "observability") ||
        canAccessControlPlanePage(actor.operatorPermissions, "settings")
      );
    case "/api/admin/incidents":
      return canAccessControlPlanePage(actor.operatorPermissions, "incidents");
    case "/api/admin/analytics":
      return canAccessControlPlanePage(actor.operatorPermissions, "analytics");
    case "/api/admin/billing":
      return canAccessControlPlanePage(actor.operatorPermissions, "billing");
    case "/api/admin/jobs":
      return canAccessControlPlanePage(actor.operatorPermissions, "automation");
    default:
      return false;
  }
};

const buildFilteredLibrariesResponse = (
  payload: SuperAdminLibraryCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  const filtered = payload.libraries.filter((library) => {
    const matchesStatus =
      !query.status ||
      library.controlStatus === query.status ||
      library.subscriptionStatus === query.status ||
      (query.status === "enabled" && library.enabled) ||
      (query.status === "disabled" && !library.enabled);

    return (
      matchesStatus &&
      matchesSearch(query.search, [
        library.name,
        library.city,
        library.state,
        library.ownerEmail,
        library.ownerName,
      ])
    );
  });

  return {
    generatedAt: payload.generatedAt,
    libraries: paginateItems(filtered, query.page, query.pageSize),
    recentActivity: payload.activityLogs.slice(0, 20),
    summary: payload.summary,
  };
};

const buildFilteredUsersResponse = (
  payload: SuperAdminLibraryCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  const filtered = payload.users.filter((user) => {
    const matchesStatus = !query.status || user.controlStatus === query.status || user.primaryRole === query.status;
    return (
      matchesStatus &&
      matchesSearch(query.search, [
        user.email,
        user.fullName,
        user.phone,
        user.libraryName,
        user.primaryRole,
      ])
    );
  });

  return {
    generatedAt: payload.generatedAt,
    summary: payload.summary,
    users: paginateItems(filtered, query.page, query.pageSize),
  };
};

const buildRevenueScopedResponse = (
  payload: SuperAdminRevenueCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  const scope = query.scope || "overview";

  if (scope === "payouts") {
    const filtered = payload.payouts.filter((row) =>
      (!query.status || row.status === query.status) &&
      matchesSearch(query.search, [row.libraryName, row.libraryId, row.note]),
    );
    return {
      defaultCommissionPercent: payload.defaultCommissionPercent,
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope,
      summary: payload.summary,
    };
  }

  if (scope === "adjustments") {
    const filtered = payload.adjustments.filter((row) =>
      matchesSearch(query.search, [row.libraryName, row.libraryId, row.reason]),
    );
    return {
      defaultCommissionPercent: payload.defaultCommissionPercent,
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope,
      summary: payload.summary,
    };
  }

  if (scope === "payments") {
    const filtered = payload.paymentHistory.filter((row) =>
      (!query.status || row.status === query.status) &&
      matchesSearch(query.search, [row.libraryName, row.libraryId, row.reference]),
    );
    return {
      defaultCommissionPercent: payload.defaultCommissionPercent,
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope,
      summary: payload.summary,
    };
  }

  if (scope === "commissions") {
    const filtered = payload.commissionOverrides.filter((row) =>
      matchesSearch(query.search, [row.libraryName, row.libraryId, row.notes]),
    );
    return {
      defaultCommissionPercent: payload.defaultCommissionPercent,
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope,
      summary: payload.summary,
    };
  }

  if (scope === "plans") {
    const filtered = payload.plans.filter((row) =>
      matchesSearch(query.search, [row.code, row.name, row.description]),
    );
    return {
      defaultCommissionPercent: payload.defaultCommissionPercent,
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope,
      summary: payload.summary,
    };
  }

  return {
    data: payload,
    scope: "overview",
  };
};

const buildBroadcastsScopedResponse = (
  payload: SuperAdminCommunicationCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  if (query.scope === "templates") {
    const filtered = payload.templates.filter((template) =>
      (!query.channel || template.channel === query.channel) &&
      matchesSearch(query.search, [template.key, template.name, template.subject]),
    );

    return {
      deliveryHealth: payload.deliveryHealth,
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope: "templates",
    };
  }

  if (query.scope === "broadcasts") {
    const filtered = payload.broadcasts.filter((broadcast) =>
      (!query.channel || broadcast.channel === query.channel) &&
      (!query.status || broadcast.status === query.status) &&
      matchesSearch(query.search, [broadcast.title, broadcast.message, broadcast.audience]),
    );

    return {
      deliveryHealth: payload.deliveryHealth,
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope: "broadcasts",
    };
  }

  return {
    data: payload,
    scope: "overview",
  };
};

const buildIncidentScopedResponse = (
  payload: SuperAdminIncidentCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  if (query.scope === "snapshots") {
    const filtered = payload.snapshots.filter((snapshot) =>
      matchesSearch(query.search, [snapshot.metricKey, snapshot.metricWindow]),
    );

    return {
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope: "snapshots",
      summary: payload.summary,
    };
  }

  if (query.scope === "groups") {
    const filtered = payload.groups.filter((group) =>
      (!query.severity || group.severity === query.severity) &&
      matchesSearch(query.search, [group.incidentKey, group.eventType, group.latestMessage]),
    );

    return {
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope: "groups",
      summary: payload.summary,
    };
  }

  return {
    data: payload,
    scope: "overview",
  };
};

const buildAuditLogTraceEvent = (log: SuperAdminSecurityCenterData["auditLogs"][number]) => ({
  actorEmail: log.actorEmail,
  correlationId:
    typeof log.metadata?.correlation_id === "string"
      ? log.metadata.correlation_id
      : typeof log.metadata?.correlationId === "string"
        ? log.metadata.correlationId
        : null,
  entityId: log.targetDisplay,
  id: log.id,
  incidentKey:
    typeof log.metadata?.incident_key === "string"
      ? log.metadata.incident_key
      : typeof log.metadata?.incidentKey === "string"
        ? log.metadata.incidentKey
        : null,
  message:
    typeof log.metadata?.note === "string" && log.metadata.note.trim()
      ? log.metadata.note
      : log.targetDisplay ?? log.action,
  metadata: log.metadata ?? {},
  occurredAt: log.createdAt,
  paymentReference:
    typeof log.metadata?.paymentReference === "string"
      ? log.metadata.paymentReference
      : typeof log.metadata?.payment_id === "string"
        ? log.metadata.payment_id
        : null,
  queueJobId:
    typeof log.metadata?.job_id === "string"
      ? log.metadata.job_id
      : typeof log.metadata?.jobId === "string"
        ? log.metadata.jobId
        : null,
  requestId:
    typeof log.metadata?.request_id === "string"
      ? log.metadata.request_id
      : typeof log.metadata?.requestId === "string"
        ? log.metadata.requestId
        : null,
  severity:
    typeof log.metadata?.severity === "string" &&
    ["INFO", "WARNING", "ERROR", "CRITICAL"].includes(log.metadata.severity)
      ? (log.metadata.severity as AdminRuntimeTraceEvent["severity"])
      : null,
  source: "audit_log" as const,
  status: "SUCCESS",
  traceId:
    typeof log.metadata?.trace_id === "string"
      ? log.metadata.trace_id
      : typeof log.metadata?.traceId === "string"
        ? log.metadata.traceId
        : null,
  type: log.action,
});

export const buildOperatorTimelineEntry = (
  log: SuperAdminSecurityCenterData["auditLogs"][number],
) => {
  const traceEvent = buildAuditLogTraceEvent(log);

  return {
    action: log.action,
    actorEmail: log.actorEmail,
    actorUserId:
      typeof log.metadata?.actor_user_id === "string"
        ? log.metadata.actor_user_id
        : null,
    correlationId: traceEvent.correlationId,
    id: log.id,
    incidentKey: traceEvent.incidentKey,
    metadata: log.metadata ?? {},
    occurredAt: log.createdAt,
    paymentReference: traceEvent.paymentReference,
    queueJobId: traceEvent.queueJobId,
    requestId: traceEvent.requestId,
    severity: traceEvent.severity,
    source: "audit_log" as const,
    targetDisplay: log.targetDisplay,
    targetType: log.targetType,
    traceId: traceEvent.traceId,
  };
};

const buildSecurityScopedResponse = async (
  env: EnvLike,
  payload: SuperAdminSecurityCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  const client = createAdminServiceClient(env);
  const sessionRows =
    ((
      await client
        .from("auth_trusted_devices")
        .select("id, user_id, session_scope, auth_level, expires_at")
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
    ).data ?? []) as ActiveSessionRow[];

  const activeSessions = sessionRows.filter((row) => normalizeText(row.session_scope) === "super_admin").length;

  if (query.scope === "audit_logs") {
    const filtered = payload.auditLogs.filter((row) =>
      matchesSearch(query.search, [
        row.actorEmail,
        row.action,
        row.targetType,
        row.targetDisplay,
        row.ipAddress,
        JSON.stringify(row.metadata ?? {}),
      ]),
    );

    return {
      activeSessions,
      generatedAt: payload.generatedAt,
      ipWhitelistEnabled: payload.ipWhitelistEnabled,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope: "audit_logs",
      suspiciousIps: payload.suspiciousIps,
      whitelist: payload.whitelist,
    };
  }

  if (query.scope === "access_logs") {
    const filtered = payload.accessLogs.filter((row) =>
      (!query.status || row.message.toLowerCase().includes(query.status.toLowerCase())) &&
      matchesSearch(query.search, [row.message, row.metadata.email as string | undefined, row.metadata.reason as string | undefined]),
    );

    return {
      activeSessions,
      generatedAt: payload.generatedAt,
      ipWhitelistEnabled: payload.ipWhitelistEnabled,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope: "access_logs",
      suspiciousIps: payload.suspiciousIps,
      whitelist: payload.whitelist,
    };
  }

  const failedLogins = payload.accessLogs.filter((row) => row.message.toLowerCase().includes("failed")).length;
  const otpFailures = payload.accessLogs.filter((row) =>
    String(row.metadata.reason || "").toLowerCase().includes("otp"),
  ).length;
  const operatorActions = payload.auditLogs.map(buildAuditLogTraceEvent).slice(0, 50);
  const operatorTimeline = payload.auditLogs.map(buildOperatorTimelineEntry).slice(0, 100);
  const traceFeed = [...payload.eventLogs].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const alerts = traceFeed.filter((event) => event.type.endsWith("ALERT")).slice(0, 20);
  const slowRequests = traceFeed.filter((event) => event.type === "ADMIN_ROUTE_SLOW").slice(0, 20);

  return {
    activeSessions,
    alerts,
    auditLogs: payload.auditLogs.slice(0, 20),
    blockedIps: payload.suspiciousIps.length,
    cacheMetrics: {
      hits: getRuntimeCounterTotal("cache_operations_total", { outcome: "hit" }),
      invalidations: getRuntimeCounterTotal("cache_operations_total", { outcome: "invalidate" }),
      misses: getRuntimeCounterTotal("cache_operations_total", { outcome: "miss" }),
      writes: getRuntimeCounterTotal("cache_operations_total", { outcome: "write" }),
    },
    failedLogins,
    generatedAt: payload.generatedAt,
    ipWhitelistEnabled: payload.ipWhitelistEnabled,
    operatorActions,
    operatorGovernance: payload.operatorGovernance,
    operatorTimeline,
    otpFailures,
    recentAccessLogs: payload.accessLogs.slice(0, 20),
    runtimeVisibility: payload.runtimeVisibility,
    slowRequests,
    suspiciousIps: payload.suspiciousIps,
    traceFeed: traceFeed.slice(0, 50),
    whitelist: payload.whitelist,
  };
};

const buildBillingScopedResponse = (
  payload: SuperAdminBillingCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  if (query.scope === "refunds") {
    const filtered = payload.refunds.filter((row) =>
      (!query.status || row.status === query.status) &&
      matchesSearch(query.search, [row.libraryName, row.libraryId, row.reason]),
    );

    return {
      generatedAt: payload.generatedAt,
      gstRatePercent: payload.gstRatePercent,
      items: paginateItems(filtered, query.page, query.pageSize),
      operations: payload.operations,
      scope: "refunds",
    };
  }

  if (query.scope === "payments") {
    const filtered = payload.paymentHistory.filter((row) =>
      (!query.status || row.status === query.status) &&
      matchesSearch(query.search, [row.libraryName, row.libraryId, row.reference]),
    );

    return {
      generatedAt: payload.generatedAt,
      gstRatePercent: payload.gstRatePercent,
      items: paginateItems(filtered, query.page, query.pageSize),
      operations: payload.operations,
      scope: "payments",
    };
  }

  const filtered = payload.invoices.filter((row) =>
    (!query.status || row.status === query.status) &&
    matchesSearch(query.search, [row.invoiceNumber, row.libraryName, row.libraryId, row.invoiceType]),
  );

  return {
    generatedAt: payload.generatedAt,
    gstRatePercent: payload.gstRatePercent,
    items: paginateItems(filtered, query.page, query.pageSize),
    operations: payload.operations,
    scope: "invoices",
  };
};

const buildJobsScopedResponse = (
  payload: SuperAdminAutomationCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  if (query.scope === "jobs") {
    const filtered = payload.jobs.filter((job) =>
      (!query.status || job.status === query.status) &&
      matchesSearch(query.search, [job.jobType, job.lastError]),
    );

    return {
      deadLetters: payload.deadLetters,
      generatedAt: payload.generatedAt,
      items: paginateItems(filtered, query.page, query.pageSize),
      scope: "jobs",
      settings: payload.settings,
      summary: payload.summary,
    };
  }

  return {
    data: payload,
    scope: "overview",
  };
};

const buildAnalyticsResponse = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  filters: z.infer<typeof analyticsFiltersSchema>,
) => {
  const [controlResult, communicationResult, incidentsResult, securityResult, jobsResult, billingResult] = await Promise.allSettled([
    getControlCenterData(env, actor),
    getCommunicationCenterData(env),
    getIncidentCenterData(env),
    getSecurityCenterData(env, actor),
    getAutomationCenterData(env, actor),
    getBillingCenterData(env),
  ]);

  if (controlResult.status !== "fulfilled") {
    throw controlResult.reason;
  }

  const control = controlResult.value;
  if (!control.success || !control.data) {
    return control;
  }

  const communication =
    communicationResult.status === "fulfilled" && communicationResult.value.success && communicationResult.value.data
      ? communicationResult.value.data
      : {
          broadcasts: [],
          deliveryHealth: buildDerivedCommunicationHealth(control.data),
          generatedAt: control.data.generatedAt,
          templates: [],
        } satisfies SuperAdminCommunicationCenterData;

  const incidents =
    incidentsResult.status === "fulfilled" && incidentsResult.value.success && incidentsResult.value.data
      ? incidentsResult.value.data
      : buildDerivedIncidentCenter(control.data);

  const security =
    securityResult.status === "fulfilled" && securityResult.value.success && securityResult.value.data
      ? securityResult.value.data
      : buildDerivedSecurityCenter(control.data);

  const jobs =
    jobsResult.status === "fulfilled" && jobsResult.value.success && jobsResult.value.data
      ? jobsResult.value.data
      : buildDerivedAutomationCenter(control.data);

  const billing =
    billingResult.status === "fulfilled" && billingResult.value.success && billingResult.value.data
      ? billingResult.value.data
      : buildDerivedBillingCenter(control.data);

  const targetCity = normalizeText(filters.city);
  const cityMetrics = !targetCity
    ? control.data.analytics.revenueByCity
    : control.data.analytics.revenueByCity.filter((point) => {
        const city = point.city.toLowerCase();
        const state = point.state.toLowerCase();
        const query = targetCity.toLowerCase();
        return city.includes(query) || state.includes(query);
      });

  const queueStatus =
    jobs.jobs.some((job) => job.status === "failed")
      ? "red"
      : jobs.jobs.filter((job) => job.status === "queued").length > 25
        ? "yellow"
        : "green";

  const deploymentStatus = readEnv(env, "SENTRY_RELEASE", "RELEASE_SHA") ? "green" : "yellow";
  const authStatus =
    security.suspiciousIps.length > 0 || control.data.security.failedLoginAttempts24h > 10 ? "yellow" : "green";
  const failedLogins = security.accessLogs.filter((row) => row.message.toLowerCase().includes("failed")).length;
  const healthCenter = mergeStatusSignals(control.data.statusSignals, [
    {
      detail: `${jobs.summary.queuedJobs} queued jobs, lag ${Math.round(jobs.summary.queueLagMs)}ms`,
      label: "Queue",
      status: queueStatus,
      value: jobs.jobs.some((job) => job.status === "failed") ? "Failed jobs present" : "Flowing normally",
    },
    {
      detail: readEnv(env, "SENTRY_RELEASE", "RELEASE_SHA") || "Release metadata has not been attached yet.",
      label: "Deployment",
      status: deploymentStatus,
      value: readEnv(env, "SENTRY_RELEASE", "RELEASE_SHA") || "Release metadata pending",
    },
    {
      detail: `${control.data.security.failedLoginAttempts24h} failed logins in the last 24h`,
      label: "Auth",
      status: authStatus,
      value: security.suspiciousIps.length > 0 ? `${security.suspiciousIps.length} suspicious IPs` : "No active auth threat",
    },
  ]);

  const operationalIntelligence = buildOperationalIntelligenceSnapshot({
    billingOperations: billing.operations,
    deadLetters: jobs.deadLetters,
    failedLoginCount: failedLogins,
    generatedAt: control.data.generatedAt,
    incidents: incidents.groups,
    jobs: jobs.jobs,
    operatorGovernance: security.operatorGovernance,
    runtimeGovernance: control.data.runtimeGovernance,
    runtimeVisibility: security.runtimeVisibility,
    suspiciousIps: security.suspiciousIps,
  });

  return {
    data: {
      automation: control.data.automation,
      billing: {
        gstRatePercent: billing.gstRatePercent,
        invoices: billing.invoices.length,
        refunds: billing.refunds.length,
      },
      cityMetrics,
      communication: communication.deliveryHealth,
      generatedAt: control.data.generatedAt,
      governance: control.data.runtimeGovernance,
      governanceAnalytics: security.operatorGovernance?.analytics,
      healthCenter,
      incidents: {
        critical: incidents.summary.critical,
        unresolved: incidents.summary.unresolved,
      },
      incidentCoordination: incidents.analytics,
      operationalIntelligence,
      overview: control.data.analytics,
      runtimeVisibility: security.runtimeVisibility,
      security: control.data.security,
      systemStatus: control.data.systemStatus,
    },
    errorCode: null,
    message: "Analytics center loaded.",
    success: true,
  } satisfies StructuredApiResponse<unknown>;
};

const handleLibraryWorkflow = async (
  env: EnvLike,
  actor: SuperAdminActorContext,
  body: unknown,
) => {
  const parsed = libraryActionSchema.safeParse(body);
  if (!parsed.success) {
    return {
      response: null,
      statusCode: 400,
      validationError: parsed.error,
    };
  }

  if (parsed.data.action === "impersonate_admin") {
    return {
      response: {
        data: null,
        errorCode: "IMPERSONATION_RUNTIME_REQUIRED",
        message: "Impersonation now starts through the dedicated auth runtime session flow.",
        success: false,
      } satisfies StructuredApiResponse<null>,
      statusCode: 200,
      validationError: null,
    };
  }

  if (parsed.data.action === "force_logout_all" || parsed.data.action === "reset_account") {
    const libraryCenter = await getLibraryCenterData(env);
    if (!libraryCenter.success || !libraryCenter.data) {
      return {
        response: libraryCenter,
        statusCode: 200,
        validationError: null,
      };
    }

    const targetUsers = libraryCenter.data.users.filter((user) => user.libraryId === parsed.data.libraryId);
    const owner = targetUsers.find((user) => user.primaryRole === "library_owner") ?? targetUsers[0];

    for (const user of targetUsers) {
      await performUserActionData(env, actor, {
        action: "clear_sessions",
        libraryId: parsed.data.libraryId,
        note: parsed.data.note,
        userId: user.userId,
      });
    }

    if (parsed.data.action === "reset_account" && owner) {
      const clearControlResult = await performLibraryActionData(env, actor, {
        action: "clear_control",
        libraryId: parsed.data.libraryId,
        note: parsed.data.note,
      });
      if (!clearControlResult.success) {
        return {
          response: clearControlResult,
          statusCode: 200,
          validationError: null,
        };
      }

      const enableResult = await performLibraryActionData(env, actor, {
        action: "enable",
        libraryId: parsed.data.libraryId,
        note: parsed.data.note,
      });
      if (!enableResult.success) {
        return {
          response: enableResult,
          statusCode: 200,
          validationError: null,
        };
      }

      return {
        response: await performUserActionData(env, actor, {
          action: "reset_password",
          libraryId: parsed.data.libraryId,
          note: parsed.data.note,
          userId: owner.userId,
        }),
        statusCode: 200,
        validationError: null,
      };
    }

    return {
      response: {
        data: {
          clearedUsers: targetUsers.map((user) => user.userId),
          libraryId: parsed.data.libraryId,
        },
        errorCode: null,
        message: "Library sessions cleared.",
        success: true,
      } satisfies StructuredApiResponse<{ clearedUsers: string[]; libraryId: string }>,
      statusCode: 200,
      validationError: null,
    };
  }

  return {
    response: await performLibraryActionData(env, actor, parsed.data satisfies AdminLibraryActionInput),
    statusCode: 200,
    validationError: null,
  };
};

const handleMutations = async (
  pathname: AdminApiRoutePath,
  env: EnvLike,
  actor: SuperAdminActorContext,
  body: unknown,
) => {
  switch (pathname) {
    case "/api/admin/platform": {
      const parsed = platformSettingsUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }
      return {
        response: await updatePlatformSettingsData(env, actor, parsed.data),
        validationError: null,
      };
    }
    case "/api/admin/feature-flags": {
      const parsed = featureFlagInputSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }
      return {
        response: await updateFeatureFlagData(env, actor, parsed.data),
        validationError: null,
      };
    }
    case "/api/admin/libraries":
      return handleLibraryWorkflow(env, actor, body);
    case "/api/admin/users": {
      const parsed = userActionSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }
      return {
        response: await performUserActionData(env, actor, parsed.data),
        validationError: null,
      };
    }
    case "/api/admin/revenue": {
      const parsed = revenueActionSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }

      if (parsed.data.action === "revenue_adjustment") {
        return {
          response: await createRevenueAdjustmentData(env, actor, parsed.data satisfies AdminRevenueAdjustmentInput),
          validationError: null,
        };
      }

      if (parsed.data.action === "commission_update") {
        return {
          response: await updateCommissionData(env, actor, parsed.data),
          validationError: null,
        };
      }

      return {
        response: await performLibraryActionData(env, actor, {
          action: parsed.data.payoutAction,
          actionToken: parsed.data.actionToken,
          confirmationText: parsed.data.confirmationText,
          dryRun: parsed.data.dryRun,
          libraryId: parsed.data.libraryId,
          note: parsed.data.note,
          payoutId: parsed.data.payoutId,
        } satisfies AdminLibraryActionInput),
        validationError: null,
      };
    }
    case "/api/admin/broadcasts": {
      const parsed = broadcastActionSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }

      if (parsed.data.action === "create_broadcast") {
        return {
          response: await createBroadcastData(env, actor, parsed.data satisfies AdminBroadcastInput),
          validationError: null,
        };
      }

      if (parsed.data.action === "upsert_template") {
        return {
          response: await upsertTemplateData(env, actor, parsed.data),
          validationError: null,
        };
      }

      return {
        response: await deleteTemplateData(env, actor, parsed.data.templateId),
        validationError: null,
      };
    }
    case "/api/admin/security": {
      const parsed = securityActionSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }

      if (parsed.data.action === "update_ip_whitelist") {
        return {
          response: await updatePlatformSettingsData(env, actor, {
            actionToken: parsed.data.actionToken,
            confirmationText: parsed.data.confirmationText,
            dryRun: parsed.data.dryRun,
            operatorReason: `Updated the super-admin IP whitelist to ${parsed.data.enabled ? "enabled" : "disabled"}.`,
            settings: {
              super_admin_ip_whitelist: parsed.data.whitelist,
              super_admin_ip_whitelist_enabled: parsed.data.enabled,
            },
          }),
          validationError: null,
        };
      }

      if (parsed.data.action === "assign_operator_role" || parsed.data.action === "revoke_operator_role") {
        return {
          response: await manageOperatorRoleGrantData(env, actor, parsed.data),
          validationError: null,
        };
      }

      return {
        response: await reviewGovernanceRequestData(env, actor, parsed.data),
        validationError: null,
      };
    }
    case "/api/admin/incidents": {
      const parsed = incidentActionSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }

      return {
        response: await resolveIncidentData(env, actor, parsed.data),
        validationError: null,
      };
    }
    case "/api/admin/billing": {
      const parsed = billingActionSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }

      if (parsed.data.action === "create_invoice") {
        return {
          response: await createInvoiceData(env, actor, parsed.data satisfies AdminInvoiceInput),
          validationError: null,
        };
      }

      if (parsed.data.action === "process_refund") {
        return {
          response: await createRefundData(env, actor, parsed.data satisfies AdminRefundInput),
          validationError: null,
        };
      }

      if (parsed.data.action === "upsert_plan") {
        return {
          response: await upsertPlanData(env, actor, parsed.data satisfies AdminPlanUpsertInput),
          validationError: null,
        };
      }

      return {
        response: await deletePlanData(env, actor, parsed.data.planId),
        validationError: null,
      };
    }
    case "/api/admin/jobs": {
      const parsed = jobActionSchema.safeParse(body);
      if (!parsed.success) {
        return { response: null, validationError: parsed.error };
      }

      return {
        response: await handleJobActionData(env, actor, parsed.data satisfies AdminJobActionInput),
        validationError: null,
      };
    }
    default:
      return {
        response: {
          data: null,
          errorCode: "METHOD_NOT_ALLOWED",
          message: "This admin endpoint is read-only.",
          success: false,
        } satisfies StructuredApiResponse<null>,
        validationError: null,
      };
  }
};

const handleBillingDownload = async (
  res: AdminApiResponse,
  requestId: string,
  payload: SuperAdminBillingCenterData,
  query: z.infer<typeof listQuerySchema>,
) => {
  if (query.format === "csv") {
    const rows =
      query.scope === "refunds"
        ? payload.refunds.map((row) => ({
            amount: row.amount,
            createdAt: row.createdAt,
            libraryId: row.libraryId,
            libraryName: row.libraryName,
            processedAt: row.processedAt,
            reason: row.reason,
            refundId: row.id,
            status: row.status,
          }))
        : query.scope === "payments"
          ? payload.paymentHistory.map((row) => ({
              amount: row.amount,
              createdAt: row.createdAt,
              libraryId: row.libraryId,
              libraryName: row.libraryName,
              paidAt: row.paidAt,
              paymentType: row.paymentType,
              reference: row.reference,
              status: row.status,
            }))
          : payload.invoices.map((row) => ({
              invoiceNumber: row.invoiceNumber,
              invoiceType: row.invoiceType,
              issuedAt: row.issuedAt,
              libraryId: row.libraryId,
              libraryName: row.libraryName,
              periodEnd: row.periodEnd,
              periodStart: row.periodStart,
              status: row.status,
              subtotal: row.subtotal,
              taxAmount: row.taxAmount,
              totalAmount: row.totalAmount,
            }));

    sendContent(
      res,
      200,
      serializeCsv(rows),
      "text/csv; charset=utf-8",
      {
        "Content-Disposition": `attachment; filename="libriofy-billing-${query.scope || "invoices"}.csv"`,
        "x-request-id": requestId,
      },
    );
    return true;
  }

  if (query.format === "pdf") {
    const invoice = payload.invoices.find((row) => row.id === query.invoiceId);
    if (!invoice) {
      sendJson(res, 404, buildErrorBody(requestId, "Invoice not found.", "NOT_FOUND"));
      return true;
    }

    const buffer = buildInvoicePdf({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: invoice.invoiceType,
      issuedAt: invoice.issuedAt,
      libraryId: invoice.libraryId,
      libraryName: invoice.libraryName,
      periodEnd: invoice.periodEnd,
      periodStart: invoice.periodStart,
      status: invoice.status,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      totalAmount: invoice.totalAmount,
    });

    sendContent(
      res,
      200,
      buffer,
      "application/pdf",
      {
        "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        "x-request-id": requestId,
      },
    );
    return true;
  }

  return false;
};

export const isSupportedAdminApiPath = (pathname: string): pathname is AdminApiRoutePath =>
  ADMIN_API_ROUTE_SET.has(pathname);

export const handleAdminApiRequest = async (
  req: AdminApiRequest,
  res: AdminApiResponse,
  env: EnvLike = process.env,
  forcedPathname?: AdminApiRoutePath,
) => {
  const requestId = normalizeText(readHeaderValue(req.headers, "x-request-id")) || randomUUID();
  const pathname = forcedPathname ?? readRequestPath(req);
  const method = (req.method || "GET").toUpperCase();
  const context = readRequestContext(req);
  const traceContext = createRequestTraceContext({
    correlationId: readHeaderValue(req.headers, "x-correlation-id") || requestId,
    ipAddress: context.ip,
    method,
    requestId,
    route: pathname,
    source: "admin_api",
    traceId: readHeaderValue(req.headers, "x-trace-id"),
    userAgent: context.userAgent,
  });

  applyTraceResponseHeaders(res, traceContext);

  return runWithRequestTraceContext(traceContext, async () => {
    const startedAt = Date.now();

    try {
    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Cache-Control", "no-store");
      res.end();
      return;
    }

    if (!isSupportedAdminApiPath(pathname)) {
      sendJson(res, 404, buildErrorBody(requestId, "API route not found.", "ROUTE_NOT_FOUND"));
      return;
    }

    const maintenanceDecision = await evaluateMaintenanceRequest(
      env,
      readMaintenanceContextFromHeaders({
        authorization: context.authorization,
        headers: req.headers ?? {},
        pathname,
      }),
    );
    if (!maintenanceDecision.allow) {
      sendJson(res, 503, {
        ...buildMaintenanceApiError(requestId),
        errorCode: "MAINTENANCE_MODE",
      });
      return;
    }

    const actorResult = await buildActorContext(env, requestId, context);
    if (!actorResult.actor || actorResult.error) {
      sendJson(res, actorResult.statusCode, actorResult.error);
      return;
    }
    const actor = actorResult.actor;

    const rateLimitKey = `admin:rate:${actor.actorUserId}:${pathname}:${method}`;
    const retryAfter = await applyRateLimit(
      env,
      rateLimitKey,
      method === "GET" ? GET_RATE_LIMIT : MUTATION_RATE_LIMIT,
    );
    if (retryAfter) {
      sendJson(
        res,
        429,
        buildErrorBody(requestId, "Too many admin requests. Please slow down.", "RATE_LIMITED"),
        {
          "Retry-After": String(retryAfter),
        },
      );
      return;
    }

    if (method === "GET") {
      if (!canReadAdminPath(pathname, actor)) {
        sendJson(
          res,
          403,
          buildErrorBody(requestId, "Your operator permissions do not allow this control-plane page.", "ACCESS_DENIED"),
        );
        return;
      }

      const queryParse = listQuerySchema.safeParse(readQuery(req));
      if (!queryParse.success) {
        sendJson(
          res,
          400,
          buildErrorBody(requestId, "Invalid query parameters.", "INVALID_REQUEST", buildValidationDetails(queryParse.error.issues)),
        );
        return;
      }

      const query = queryParse.data;

      switch (pathname) {
      case "/api/admin/platform": {
        try {
          const result = await getControlCenterData(env, actor);
          sendServiceResponse(res, requestId, result);
        } catch (error) {
          sendJson(
            res,
            503,
            buildErrorBody(requestId, "Platform control-plane data is temporarily unavailable.", "PLATFORM_DATA_UNAVAILABLE"),
          );
        }
        return;
      }
      case "/api/admin/feature-flags": {
        const result = await getPlatformSettingsData(env);
        sendServiceResponse(res, requestId, result);
        return;
      }
      case "/api/admin/libraries": {
        const result = await getLibraryCenterData(env);
        if (!result.success || !result.data) {
          sendServiceResponse(res, requestId, result);
          return;
        }

        sendJson(
          res,
          200,
          buildSuccessBody(requestId, result.message, buildFilteredLibrariesResponse(result.data, query)),
        );
        return;
      }
      case "/api/admin/users": {
        const result = await getLibraryCenterData(env);
        if (!result.success || !result.data) {
          sendServiceResponse(res, requestId, result);
          return;
        }

        sendJson(
          res,
          200,
          buildSuccessBody(requestId, "User controls loaded.", buildFilteredUsersResponse(result.data, query)),
        );
        return;
      }
      case "/api/admin/revenue": {
        // Fast path: plans scope queries subscription_plans directly without loading all admin data
        if (query.scope === "plans") {
          try {
            const client = buildServiceClient(env);
            const { data: planRows, error: planError } = await client
              .from("subscription_plans")
              .select("id, code, name, description, price, seats_limit, lockers_limit, features, is_active, sort_order, updated_at")
              .order("sort_order", { ascending: true });

            if (planError) {
              console.error("[admin-api] /api/admin/revenue plans direct query FAILED:", planError.message, planError.code);
              sendJson(res, 200, buildSuccessBody(requestId, "Plans query failed.", {
                defaultCommissionPercent: 12.5,
                generatedAt: new Date().toISOString(),
                items: paginateItems([], 1, 20),
                scope: "plans",
                summary: { adjustmentRevenue: 0, queuedPayoutAmount: 0, studentRevenue: 0, subscriptionRevenue: 0, totalRevenue: 0 },
              }));
              return;
            }

            const plans = (planRows ?? []).map((row: Record<string, unknown>) => ({
              id: String(row.id ?? ""),
              code: String(row.code ?? ""),
              name: String(row.name ?? ""),
              description: row.description != null ? String(row.description) : null,
              price: Number(row.price ?? 0),
              seatsLimit: row.seats_limit != null ? Number(row.seats_limit) : null,
              lockersLimit: row.lockers_limit != null ? Number(row.lockers_limit) : null,
              features: Array.isArray(row.features) ? (row.features as string[]) : [],
              isActive: row.is_active !== false,
              sortOrder: Number(row.sort_order ?? 0),
              updatedAt: row.updated_at != null ? String(row.updated_at) : null,
            }));

            const filtered = plans.filter((plan) =>
              matchesSearch(query.search, [plan.code, plan.name, plan.description]),
            );

            sendJson(res, 200, buildSuccessBody(requestId, "Plans loaded.", {
              defaultCommissionPercent: 12.5,
              generatedAt: new Date().toISOString(),
              items: paginateItems(filtered, query.page, query.pageSize),
              scope: "plans",
              summary: { adjustmentRevenue: 0, queuedPayoutAmount: 0, studentRevenue: 0, subscriptionRevenue: 0, totalRevenue: 0 },
            }));
          } catch (err) {
            console.error("[admin-api] /api/admin/revenue plans FAILED:", err instanceof Error ? err.message : String(err));
            sendJson(res, 500, buildErrorBody(requestId, "Failed to load subscription plans.", "PLANS_LOAD_FAILED"));
          }
          return;
        }

        const result = await getRevenueCenterData(env);
        if (!result.success || !result.data) {
          sendServiceResponse(res, requestId, result);
          return;
        }

        sendJson(
          res,
          200,
          buildSuccessBody(requestId, result.message, buildRevenueScopedResponse(result.data, query)),
        );
        return;
      }
      case "/api/admin/broadcasts": {
        const result = await getCommunicationCenterData(env);
        if (!result.success || !result.data) {
          sendServiceResponse(res, requestId, result);
          return;
        }

        sendJson(
          res,
          200,
          buildSuccessBody(requestId, result.message, buildBroadcastsScopedResponse(result.data, query)),
        );
        return;
      }
      case "/api/admin/security": {
        let result;
        try {
          result = await getSecurityCenterData(env, actor);
        } catch {
          sendJson(res, 200, buildSuccessBody(requestId, "Security data partially loaded.", buildFallbackSecurityData()));
          return;
        }
        if (!result.success || !result.data) {
          sendServiceResponse(res, requestId, result);
          return;
        }

        let scopedResponse;
        try {
          scopedResponse = await buildSecurityScopedResponse(env, result.data, query);
        } catch {
          scopedResponse = result.data;
        }

        sendJson(
          res,
          200,
          buildSuccessBody(requestId, result.message, scopedResponse),
        );
        return;
      }
      case "/api/admin/incidents": {
        const result = await getIncidentCenterData(env);
        if (!result.success || !result.data) {
          sendServiceResponse(res, requestId, result);
          return;
        }

        sendJson(
          res,
          200,
          buildSuccessBody(requestId, result.message, buildIncidentScopedResponse(result.data, query)),
        );
        return;
      }
      case "/api/admin/analytics": {
        const filtersParse = analyticsFiltersSchema.safeParse(readQuery(req));
        if (!filtersParse.success) {
          sendJson(
            res,
            400,
            buildErrorBody(
              requestId,
              "Invalid query parameters.",
              "INVALID_REQUEST",
              buildValidationDetails(filtersParse.error.issues),
            ),
          );
          return;
        }

        try {
          const result = await buildAnalyticsResponse(env, actor, filtersParse.data);
          sendServiceResponse(res, requestId, result);
        } catch (error) {
          sendJson(
            res,
            503,
            buildErrorBody(requestId, "Analytics center is temporarily unavailable.", "ANALYTICS_UNAVAILABLE"),
          );
        }
        return;
      }
      case "/api/admin/billing": {
        const result = await getBillingCenterData(env);
        if (!result.success || !result.data) {
          sendServiceResponse(res, requestId, result);
          return;
        }

        if (await handleBillingDownload(res, requestId, result.data, query)) {
          return;
        }

        sendJson(
          res,
          200,
          buildSuccessBody(requestId, result.message, buildBillingScopedResponse(result.data, query)),
        );
        return;
      }
      case "/api/admin/jobs": {
        const result = await getAutomationCenterData(env, actor);
        if (!result.success || !result.data) {
          sendServiceResponse(res, requestId, result);
          return;
        }

        sendJson(
          res,
          200,
          buildSuccessBody(requestId, result.message, buildJobsScopedResponse(result.data, query)),
        );
        return;
      }
      default:
        sendJson(res, 404, buildErrorBody(requestId, "API route not found.", "ROUTE_NOT_FOUND"));
    }

      return;
    }

    if (method !== "POST") {
      sendMethodNotAllowed(res, requestId, "GET, POST");
      return;
    }

    const body = readParsedBody(req);
    const mutationResult = await handleMutations(pathname, env, actor, body);
    if ("validationError" in mutationResult && mutationResult.validationError) {
      sendJson(
        res,
        400,
        buildErrorBody(
          requestId,
          "Invalid request body.",
          "INVALID_REQUEST",
          buildValidationDetails(mutationResult.validationError.issues),
        ),
      );
      return;
    }

    if (!("response" in mutationResult) || !mutationResult.response) {
      sendJson(res, 500, buildErrorBody(requestId, "Unexpected admin route failure.", "ADMIN_ACTION_FAILED"));
      return;
    }

    sendServiceResponse(res, requestId, mutationResult.response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unexpected admin route failure.";
      if (!res.statusCode || res.statusCode === 200) {
        sendJson(res, 500, buildErrorBody(requestId, errorMessage, "ADMIN_INTERNAL_ERROR"));
      }
    } finally {
      recordAdminRouteMetrics({
        durationMs: Date.now() - startedAt,
        method: traceContext.method,
        pathname,
        statusCode: res.statusCode || 200,
      });
    }
  });
};

export const createAdminApiHandler = (
  pathname: AdminApiRoutePath,
  env: EnvLike = process.env,
) => async (req: AdminApiRequest, res: AdminApiResponse) => handleAdminApiRequest(req, res, env, pathname);
