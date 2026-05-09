import type {
  AdminAlertInput,
  AlertSeverity,
} from "../observability/types.js";
import type {
  AdminIncidentGroup,
  AdminRuntimeTraceEvent,
  AdminStatusSignal,
  AdminTimeSeriesPoint,
} from "./types.js";

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

type EventGroupRow = {
  event_type?: string | null;
  first_seen_at?: string | null;
  incident_key?: string | null;
  last_seen_at?: string | null;
  latest_message?: string | null;
  severity?: string | null;
  total_occurrences?: number | null;
  unresolved_count?: number | null;
};

type SuccessFailureRow = {
  status?: string | null;
  total_count?: number | null;
};

type LoginAttemptRow = {
  ip_address?: string | null;
  login_step?: string | null;
  reason?: string | null;
  status?: string | null;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeSeverity = (value: unknown): AdminIncidentGroup["severity"] => {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === "CRITICAL" || normalized === "ERROR" || normalized === "WARNING") {
    return normalized;
  }

  return "INFO";
};

export const buildStructuredResponse = <T>(
  success: boolean,
  message: string,
  data: T | null,
  errorCode: string | null = null,
) => ({
  success,
  message,
  data,
  errorCode,
});

export const calculateConversionRate = ({
  paidLibraries,
  totalLibraries,
}: {
  paidLibraries: number;
  totalLibraries: number;
}) => {
  if (totalLibraries <= 0) {
    return 0;
  }

  return Number(((paidLibraries / totalLibraries) * 100).toFixed(2));
};

export const buildTimeSeries = (rows: DailyMetricRow[]): AdminTimeSeriesPoint[] =>
  [...rows]
    .map((row) => {
      const date = normalizeText(row.day);
      const parsedDate = date ? new Date(date) : null;
      const label =
        parsedDate && !Number.isNaN(parsedDate.getTime())
          ? parsedDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
          : "Unknown";

      return {
        date,
        label,
        activeLibraries: toNumber(row.active_libraries),
        activeStudents: toNumber(row.active_students),
        adjustmentRevenue: toNumber(row.adjustment_revenue),
        newLibraries: toNumber(row.new_libraries),
        paymentRevenue: toNumber(row.payment_revenue),
        subscriptionRevenue: toNumber(row.subscription_revenue),
        totalRevenue: toNumber(row.total_revenue),
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date));

export const buildIncidentGroups = (rows: EventGroupRow[]): AdminIncidentGroup[] =>
  rows
    .map((row) => ({
      incidentKey: normalizeText(row.incident_key) || normalizeText(row.event_type) || "unknown_incident",
      eventType: normalizeText(row.event_type) || "UNKNOWN_EVENT",
      severity: normalizeSeverity(row.severity),
      unresolvedCount: toNumber(row.unresolved_count),
      totalOccurrences: toNumber(row.total_occurrences),
      firstSeenAt: normalizeText(row.first_seen_at) || null,
      lastSeenAt: normalizeText(row.last_seen_at) || null,
      latestMessage: normalizeText(row.latest_message) || null,
      acknowledgedAt: null,
      acknowledgedBy: null,
      ownerEmail: null,
      ownerUserId: null,
      escalationLevel: 0,
      latestNote: null,
      noteCount: 0,
      linkedJobIds: [],
      linkedRequestIds: [],
      linkedTraceIds: [],
      linkedCorrelationIds: [],
      linkedPaymentReferences: [],
      retryableJobId: null,
      operationalNotes: [],
      traceLineage: [],
    }))
    .sort((left, right) => {
      const severityRank = (severity: AdminIncidentGroup["severity"]) =>
        severity === "CRITICAL" ? 4 : severity === "ERROR" ? 3 : severity === "WARNING" ? 2 : 1;

      return (
        severityRank(right.severity) - severityRank(left.severity) ||
        right.unresolvedCount - left.unresolvedCount ||
        String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || ""))
      );
    });

export const buildSuccessRate = (rows: SuccessFailureRow[]) => {
  const totals = rows.reduce(
    (accumulator, row) => {
      const count = toNumber(row.total_count);
      const status = normalizeText(row.status).toUpperCase();
      accumulator.total += count;

      if (status === "SUCCESS") {
        accumulator.success += count;
      }

      return accumulator;
    },
    { success: 0, total: 0 },
  );

  if (totals.total <= 0) {
    return 100;
  }

  return Number(((totals.success / totals.total) * 100).toFixed(2));
};

export const resolveSystemStatus = (signals: AdminStatusSignal[]) => {
  if (signals.some((signal) => signal.status === "red")) {
    return "red" as const;
  }

  if (signals.some((signal) => signal.status === "yellow")) {
    return "yellow" as const;
  }

  return "green" as const;
};

export const buildLoginAttemptSummary = (rows: LoginAttemptRow[]) => {
  const suspiciousIpCounts = new Map<string, number>();
  let failedAttempts = 0;
  let otpAbuseSignals = 0;

  for (const row of rows) {
    const status = normalizeText(row.status).toLowerCase();
    const reason = normalizeText(row.reason).toLowerCase();
    const step = normalizeText(row.login_step).toLowerCase();
    const ip = normalizeText(row.ip_address);

    if (status === "failed") {
      failedAttempts += 1;

      if (ip) {
        suspiciousIpCounts.set(ip, (suspiciousIpCounts.get(ip) ?? 0) + 1);
      }
    }

    if (step === "otp" || reason.includes("otp") || reason.includes("rate")) {
      otpAbuseSignals += status === "failed" ? 1 : 0;
    }
  }

  const suspiciousIps = [...suspiciousIpCounts.entries()]
    .map(([ip, failures]) => ({ failures, ip }))
    .sort((left, right) => right.failures - left.failures || left.ip.localeCompare(right.ip))
    .slice(0, 10);

  return {
    failedAttempts,
    otpAbuseSignals,
    suspiciousIps,
  };
};

export const calculateGstBreakdown = (amount: number, gstRatePercent: number) => {
  const normalizedAmount = Math.max(0, toNumber(amount));
  const normalizedGstRate = Math.max(0, toNumber(gstRatePercent));
  const taxAmount = Number(((normalizedAmount * normalizedGstRate) / 100).toFixed(2));
  const totalAmount = Number((normalizedAmount + taxAmount).toFixed(2));

  return {
    subtotal: normalizedAmount,
    taxAmount,
    totalAmount,
  };
};

export const isControlWindowActive = (status: string | null | undefined, untilAt: string | null | undefined) => {
  const normalizedStatus = normalizeText(status).toLowerCase();
  if (!normalizedStatus || normalizedStatus === "active") {
    return false;
  }

  if (!untilAt) {
    return true;
  }

  const parsedUntilAt = new Date(untilAt);
  if (Number.isNaN(parsedUntilAt.getTime())) {
    return true;
  }

  return parsedUntilAt.getTime() > Date.now();
};

export type OperationalTraceSeed = {
  seedTokens: Array<string | null | undefined>;
  events: Array<{
    id: string;
    source: AdminRuntimeTraceEvent["source"];
    type: string;
    status: string;
    severity?: AlertSeverity | null;
    message?: string | null;
    occurredAt: string;
    entityId?: string | null;
    actorEmail?: string | null;
    requestId?: string | null;
    correlationId?: string | null;
    traceId?: string | null;
    queueJobId?: string | null;
    paymentReference?: string | null;
    incidentKey?: string | null;
    metadata?: Record<string, unknown>;
    tokens?: Array<string | null | undefined>;
  }>;
  limit?: number;
};

const collectTraceTokens = (values: Array<string | null | undefined>) =>
  values.reduce<Set<string>>((accumulator, value) => {
    const normalized = normalizeText(value);
    if (normalized) {
      accumulator.add(normalized);
    }

    return accumulator;
  }, new Set<string>());

export const buildTraceTimeline = ({
  seedTokens,
  events,
  limit = 40,
}: OperationalTraceSeed): AdminRuntimeTraceEvent[] => {
  const activeTokens = collectTraceTokens(seedTokens);
  if (activeTokens.size === 0) {
    return [];
  }

  const remaining = [...events];
  const matched = new Map<string, AdminRuntimeTraceEvent>();
  let expanded = true;

  while (expanded) {
    expanded = false;

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index];
      const candidateTokens = collectTraceTokens([
        candidate.entityId,
        candidate.requestId,
        candidate.correlationId,
        candidate.traceId,
        candidate.queueJobId,
        candidate.paymentReference,
        candidate.incidentKey,
        ...(candidate.tokens ?? []),
      ]);

      const intersects = [...candidateTokens].some((token) => activeTokens.has(token));
      if (!intersects) {
        continue;
      }

      candidateTokens.forEach((token) => activeTokens.add(token));
      matched.set(`${candidate.source}:${candidate.id}`, {
        actorEmail: candidate.actorEmail ?? null,
        correlationId: candidate.correlationId ?? null,
        entityId: candidate.entityId ?? null,
        id: candidate.id,
        incidentKey: candidate.incidentKey ?? null,
        message: candidate.message ?? null,
        metadata: candidate.metadata ?? {},
        occurredAt: normalizeText(candidate.occurredAt) || new Date().toISOString(),
        paymentReference: candidate.paymentReference ?? null,
        queueJobId: candidate.queueJobId ?? null,
        requestId: candidate.requestId ?? null,
        severity: candidate.severity ?? null,
        source: candidate.source,
        status: normalizeText(candidate.status) || "unknown",
        traceId: candidate.traceId ?? null,
        type: normalizeText(candidate.type) || "unknown",
      });
      remaining.splice(index, 1);
      expanded = true;
    }
  }

  return [...matched.values()]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .slice(-limit);
};

export type OperationalAlertInput = {
  apiLatencyP95Ms: number;
  authFailureCount: number;
  criticalIncidents: number;
  deadLetterJobs: number;
  emailSuccessRate: number;
  otpFailureCount: number;
  paymentRetryRate: number;
  queuedJobs: number;
  queueLagMs: number;
  redisDegraded: boolean;
  slowRequests: number;
};

export const buildOperationalAlerts = ({
  apiLatencyP95Ms,
  authFailureCount,
  criticalIncidents,
  deadLetterJobs,
  emailSuccessRate,
  otpFailureCount,
  paymentRetryRate,
  queuedJobs,
  queueLagMs,
  redisDegraded,
  slowRequests,
}: OperationalAlertInput): AdminAlertInput[] => {
  const alerts: AdminAlertInput[] = [];

  if (queuedJobs >= 25 || queueLagMs >= 5 * 60_000) {
    alerts.push({
      message: `Queue backlog is elevated with ${queuedJobs} queued jobs and ${Math.round(queueLagMs)}ms lag.`,
      metadata: {
        queue_lag_ms: queueLagMs,
        queued_jobs: queuedJobs,
      },
      severity: queuedJobs >= 50 || queueLagMs >= 15 * 60_000 ? "ERROR" : "WARNING",
      type: "QUEUE_BACKLOG_ALERT",
    });
  }

  if (deadLetterJobs > 0) {
    alerts.push({
      message: `${deadLetterJobs} dead-letter jobs require operator replay or investigation.`,
      metadata: {
        dead_letter_jobs: deadLetterJobs,
      },
      severity: deadLetterJobs >= 5 ? "ERROR" : "WARNING",
      type: "QUEUE_DEAD_LETTER_ALERT",
    });
  }

  if (redisDegraded) {
    alerts.push({
      message: "Redis is degraded and the platform is relying on fallback behavior.",
      metadata: {
        degraded_mode: true,
      },
      severity: "ERROR",
      type: "REDIS_DEGRADATION_ALERT",
    });
  }

  if (apiLatencyP95Ms >= 1_800 || slowRequests > 0) {
    alerts.push({
      message: `Operational latency is elevated with admin API p95 at ${apiLatencyP95Ms}ms and ${slowRequests} slow requests.`,
      metadata: {
        api_latency_p95_ms: apiLatencyP95Ms,
        slow_requests: slowRequests,
      },
      severity: apiLatencyP95Ms >= 3_000 ? "ERROR" : "WARNING",
      type: "API_LATENCY_ALERT",
    });
  }

  if (paymentRetryRate >= 20) {
    alerts.push({
      message: `Payment retries are elevated at ${paymentRetryRate.toFixed(2)}%.`,
      metadata: {
        payment_retry_rate: paymentRetryRate,
      },
      severity: paymentRetryRate >= 40 ? "ERROR" : "WARNING",
      type: "PAYMENT_ANOMALY_ALERT",
    });
  }

  if (emailSuccessRate < 85) {
    alerts.push({
      message: `Email delivery degraded to ${emailSuccessRate.toFixed(2)}% success.`,
      metadata: {
        email_success_rate: emailSuccessRate,
      },
      severity: emailSuccessRate < 70 ? "ERROR" : "WARNING",
      type: "EMAIL_PROVIDER_DEGRADATION_ALERT",
    });
  }

  if (authFailureCount >= 10) {
    alerts.push({
      message: `${authFailureCount} auth failures were observed in the current runtime window.`,
      metadata: {
        auth_failures: authFailureCount,
      },
      severity: authFailureCount >= 25 ? "ERROR" : "WARNING",
      type: "AUTH_FAILURE_SPIKE_ALERT",
    });
  }

  if (otpFailureCount >= 5) {
    alerts.push({
      message: `${otpFailureCount} OTP failures were observed in the current runtime window.`,
      metadata: {
        otp_failures: otpFailureCount,
      },
      severity: otpFailureCount >= 15 ? "ERROR" : "WARNING",
      type: "OTP_FAILURE_SPIKE_ALERT",
    });
  }

  if (criticalIncidents > 0) {
    alerts.push({
      message: `${criticalIncidents} critical incident groups are unresolved.`,
      metadata: {
        critical_incidents: criticalIncidents,
      },
      severity: "CRITICAL",
      type: "INCIDENT_CRITICAL_ALERT",
    });
  }

  return alerts;
};
