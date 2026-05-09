import type { AlertSeverity, EventClassification, EventLogInput, ObservabilityMetadata } from "./types.js";

export type ObservabilityThresholdPolicy = {
  failureThreshold: number;
  severity: AlertSeverity;
  windowSeconds: number;
};

const EVENT_CLASSIFICATIONS = new Set<EventClassification>([
  "AUTH_ERROR",
  "BILLING_ERROR",
  "EMAIL_ERROR",
  "IMPERSONATION_EVENT",
  "OBSERVABILITY_ERROR",
  "PERFORMANCE_EVENT",
  "QUEUE_ERROR",
  "RATE_LIMIT",
  "SECURITY_EVENT",
]);

const THRESHOLD_POLICIES: Record<EventClassification, ObservabilityThresholdPolicy> = {
  AUTH_ERROR: {
    failureThreshold: 10,
    severity: "ERROR",
    windowSeconds: 60,
  },
  BILLING_ERROR: {
    failureThreshold: 1,
    severity: "CRITICAL",
    windowSeconds: 15 * 60,
  },
  EMAIL_ERROR: {
    failureThreshold: 5,
    severity: "ERROR",
    windowSeconds: 60,
  },
  IMPERSONATION_EVENT: {
    failureThreshold: 3,
    severity: "WARNING",
    windowSeconds: 15 * 60,
  },
  OBSERVABILITY_ERROR: {
    failureThreshold: 5,
    severity: "WARNING",
    windowSeconds: 15 * 60,
  },
  PERFORMANCE_EVENT: {
    failureThreshold: 3,
    severity: "WARNING",
    windowSeconds: 5 * 60,
  },
  QUEUE_ERROR: {
    failureThreshold: 3,
    severity: "ERROR",
    windowSeconds: 15 * 60,
  },
  RATE_LIMIT: {
    failureThreshold: 2,
    severity: "WARNING",
    windowSeconds: 60,
  },
  SECURITY_EVENT: {
    failureThreshold: 2,
    severity: "CRITICAL",
    windowSeconds: 15 * 60,
  },
};

const FAILURE_KEYWORDS = ["FAILED", "ERROR", "DENIED", "EXPIRED", "INVALID", "BLOCKED", "UNAVAILABLE"];

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeMetricSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const readMetadataText = (metadata: ObservabilityMetadata | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const value = normalizeText(metadata?.[key]);
    if (value) {
      return value;
    }
  }

  return "";
};

const readMetadataNumber = (metadata: ObservabilityMetadata | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const value = metadata?.[key];
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

export const normalizeEventClassification = (value: unknown): EventClassification | null => {
  const normalized = normalizeText(value).toUpperCase();
  return EVENT_CLASSIFICATIONS.has(normalized as EventClassification) ? (normalized as EventClassification) : null;
};

export const resolveEventClassification = (
  input: Pick<EventLogInput, "classification" | "metadata" | "status" | "type">,
) => {
  const explicit = normalizeEventClassification(input.classification);
  if (explicit) {
    return explicit;
  }

  const metadataClassification = normalizeEventClassification(input.metadata?.classification);
  if (metadataClassification) {
    return metadataClassification;
  }

  const eventType = normalizeText(input.type).toUpperCase();
  if (!eventType) {
    return null;
  }

  const looksLikeFailure =
    input.status === "FAILED" ||
    FAILURE_KEYWORDS.some((keyword) => eventType.includes(keyword)) ||
    input.metadata?.counts_as_failure === true ||
    input.metadata?.countsAsFailure === true;

  if (eventType.includes("RATE_LIMIT")) {
    return "RATE_LIMIT";
  }

  if (eventType.includes("QUEUE") || eventType.includes("JOB")) {
    return looksLikeFailure ? "QUEUE_ERROR" : null;
  }

  if (eventType.includes("BILLING") || eventType.includes("INVOICE") || eventType.includes("REFUND")) {
    return looksLikeFailure ? "BILLING_ERROR" : null;
  }

  if (eventType.includes("IMPERSONATION")) {
    return "IMPERSONATION_EVENT";
  }

  if (eventType.includes("OBSERVABILITY")) {
    return looksLikeFailure ? "OBSERVABILITY_ERROR" : null;
  }

  if (
    eventType.includes("SLOW_QUERY") ||
    eventType.includes("LATENCY") ||
    eventType.includes("TIMEOUT") ||
    readMetadataNumber(input.metadata, "latency_ms", "latencyMs", "duration_ms", "durationMs")
  ) {
    return looksLikeFailure ? "PERFORMANCE_EVENT" : null;
  }

  if (
    eventType.includes("SECURITY") ||
    eventType.includes("ORIGIN_REJECTED") ||
    eventType.includes("DEVICE_MISMATCH")
  ) {
    return "SECURITY_EVENT";
  }

  if (!looksLikeFailure) {
    return null;
  }

  if (eventType.includes("EMAIL")) {
    return "EMAIL_ERROR";
  }

  if (eventType.includes("AUTH") || eventType.includes("LOGIN") || eventType.includes("OTP")) {
    return "AUTH_ERROR";
  }

  return null;
};

export const resolveMetricKey = (
  input: Pick<EventLogInput, "classification" | "metadata" | "metricKey" | "status" | "type">,
) => {
  const explicitMetricKey = normalizeMetricSegment(normalizeText(input.metricKey));
  if (explicitMetricKey) {
    return explicitMetricKey;
  }

  const metadataMetricKey = normalizeMetricSegment(readMetadataText(input.metadata, "metric_key", "metricKey"));
  if (metadataMetricKey) {
    return metadataMetricKey;
  }

  const classification = resolveEventClassification(input);
  const eventType = normalizeMetricSegment(normalizeText(input.type)) || "unknown_event";

  if (!classification) {
    return eventType;
  }

  return `${classification.toLowerCase()}:${eventType}`;
};

export const resolveSeverity = (
  input: Pick<EventLogInput, "classification" | "metadata" | "severity" | "status" | "type">,
): AlertSeverity => {
  const explicitSeverity = normalizeText(input.severity).toUpperCase();
  if (
    explicitSeverity === "INFO" ||
    explicitSeverity === "WARNING" ||
    explicitSeverity === "ERROR" ||
    explicitSeverity === "CRITICAL"
  ) {
    return explicitSeverity;
  }

  const metadataSeverity = normalizeText(input.metadata?.severity ?? input.metadata?.alert_severity).toUpperCase();
  if (
    metadataSeverity === "INFO" ||
    metadataSeverity === "WARNING" ||
    metadataSeverity === "ERROR" ||
    metadataSeverity === "CRITICAL"
  ) {
    return metadataSeverity;
  }

  const classification = resolveEventClassification(input);
  const thresholdPolicy = getThresholdPolicy(classification);
  if (thresholdPolicy) {
    return input.status === "FAILED" ? thresholdPolicy.severity : "INFO";
  }

  return input.status === "FAILED" ? "ERROR" : "INFO";
};

export const resolveGroupKey = (
  input: Pick<EventLogInput, "classification" | "groupKey" | "metadata" | "metricKey" | "status" | "type">,
) => {
  const explicitGroupKey = normalizeMetricSegment(normalizeText(input.groupKey));
  if (explicitGroupKey) {
    return explicitGroupKey;
  }

  const metadataGroupKey = normalizeMetricSegment(readMetadataText(input.metadata, "group_key", "groupKey"));
  if (metadataGroupKey) {
    return metadataGroupKey;
  }

  const classification = resolveEventClassification(input);
  const metricKey = resolveMetricKey(input);
  const source = normalizeMetricSegment(readMetadataText(
    input.metadata,
    "request_source",
    "requestSource",
    "source",
    "provider",
    "job_type",
    "jobType",
    "queryName",
  ));
  const route = normalizeMetricSegment(readMetadataText(input.metadata, "route", "path", "request_path", "requestPath"));

  return [classification?.toLowerCase() ?? null, metricKey, source || null, route || null].filter(Boolean).join(":") || null;
};

export const resolveFingerprint = (
  input: Pick<EventLogInput, "classification" | "fingerprint" | "groupKey" | "metadata" | "metricKey" | "status" | "type">,
) => {
  const explicitFingerprint = normalizeMetricSegment(normalizeText(input.fingerprint));
  if (explicitFingerprint) {
    return explicitFingerprint;
  }

  const metadataFingerprint = normalizeMetricSegment(readMetadataText(input.metadata, "fingerprint"));
  if (metadataFingerprint) {
    return metadataFingerprint;
  }

  const groupKey = resolveGroupKey(input);
  const errorCode = normalizeMetricSegment(readMetadataText(
    input.metadata,
    "error_code",
    "errorCode",
    "code",
    "reason",
    "status_code",
    "statusCode",
  ));
  const entityHint = normalizeMetricSegment(readMetadataText(input.metadata, "job_id", "jobId", "queryName", "provider"));

  return [groupKey, errorCode || null, entityHint || null].filter(Boolean).join(":") || null;
};

export const resolveOccurredAt = (value: unknown) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
};

export const getThresholdPolicy = (classification: EventClassification | null) =>
  classification ? THRESHOLD_POLICIES[classification] : null;

export const getMetricsWindowSeconds = (classification: EventClassification | null) =>
  getThresholdPolicy(classification)?.windowSeconds ?? 60 * 60;

export const isFailureLikeEvent = (input: Pick<EventLogInput, "classification" | "metadata" | "status" | "type">) => {
  if (input.status === "FAILED") {
    return true;
  }

  if (input.metadata?.counts_as_failure === true || input.metadata?.countsAsFailure === true) {
    return true;
  }

  const classification = resolveEventClassification(input);
  return classification === "RATE_LIMIT" || classification === "SECURITY_EVENT";
};
