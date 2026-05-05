import type { AlertSeverity, EventClassification, EventLogInput, ObservabilityMetadata } from "./types.js";

export type ObservabilityThresholdPolicy = {
  failureThreshold: number;
  severity: AlertSeverity;
  windowSeconds: number;
};

const EVENT_CLASSIFICATIONS = new Set<EventClassification>([
  "AUTH_ERROR",
  "EMAIL_ERROR",
  "RATE_LIMIT",
  "SECURITY_EVENT",
]);

const THRESHOLD_POLICIES: Record<EventClassification, ObservabilityThresholdPolicy> = {
  AUTH_ERROR: {
    failureThreshold: 10,
    severity: "ERROR",
    windowSeconds: 60,
  },
  EMAIL_ERROR: {
    failureThreshold: 5,
    severity: "ERROR",
    windowSeconds: 60,
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

  if (eventType.includes("RATE_LIMIT")) {
    return "RATE_LIMIT";
  }

  if (
    eventType.includes("SECURITY") ||
    eventType.includes("ORIGIN_REJECTED") ||
    eventType.includes("DEVICE_MISMATCH")
  ) {
    return "SECURITY_EVENT";
  }

  const looksLikeFailure =
    input.status === "FAILED" ||
    FAILURE_KEYWORDS.some((keyword) => eventType.includes(keyword)) ||
    input.metadata?.counts_as_failure === true ||
    input.metadata?.countsAsFailure === true;

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
