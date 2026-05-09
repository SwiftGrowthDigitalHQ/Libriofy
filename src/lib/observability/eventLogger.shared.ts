import { sanitizeObservabilityMetadata } from "./logSanitizer.js";
import type { EventLogInput, ObservabilityMetadata } from "./types.js";

export const OBSERVABILITY_EVENTS_ENDPOINT = "/api/observability/events";

export type LogEventOptions = {
  skipConsole?: boolean;
};

export type EventLogFailureStage = "console" | "normalize" | "persist_client" | "persist_server";

export type EventMetadataEnricher = (metadata: ObservabilityMetadata) => ObservabilityMetadata;

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const normalizeMetadata = (metadata: unknown): ObservabilityMetadata => {
  try {
    return sanitizeObservabilityMetadata(metadata);
  } catch {
    return {};
  }
};

export const normalizeEventType = (value: unknown) => normalizeText(value) || "UNKNOWN_EVENT";

export const normalizeEventInput = (
  input: EventLogInput,
  enrichMetadata?: EventMetadataEnricher,
): EventLogInput => {
  const baseMetadata = normalizeMetadata(input.metadata);
  const metadata = enrichMetadata ? enrichMetadata(baseMetadata) : baseMetadata;

  if (typeof window !== "undefined") {
    metadata.route ??= window.location.pathname;
  }

  return {
    classification: input.classification ?? null,
    entityId: normalizeText(input.entityId) || null,
    fingerprint: normalizeText(input.fingerprint) || null,
    groupKey: normalizeText(input.groupKey) || null,
    message: normalizeText(input.message) || null,
    metadata,
    metricKey: normalizeText(input.metricKey) || null,
    occurredAt: normalizeText(input.occurredAt) || null,
    severity: input.severity ?? null,
    status: input.status,
    type: normalizeEventType(input.type),
    user: normalizeText(input.user) || null,
  };
};

export const postEventToApi = async (event: EventLogInput) => {
  const response = await fetch(OBSERVABILITY_EVENTS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
    keepalive: true,
  });

  if (!response.ok) {
    throw new Error(`Observability event route failed with status ${response.status}.`);
  }
};

export const reportEventLoggerFailure = (
  error: unknown,
  stage: EventLogFailureStage,
  eventType: string,
  options: LogEventOptions,
) => {
  if (options.skipConsole) {
    return;
  }

  try {
    console.error("[observability] Failed to capture event log", {
      eventType: eventType || "UNKNOWN_EVENT",
      message: getErrorMessage(error),
      stage,
    });
  } catch {
    // Observability must never fail the caller.
  }
};

export const writeEventConsole = (event: EventLogInput, options: LogEventOptions) => {
  if (options.skipConsole) {
    return;
  }

  const consoleMethod = event.status === "FAILED" ? console.error : console.info;
  consoleMethod(`[event] ${event.type}`, {
    entityId: event.entityId,
    message: event.message,
    metadata: event.metadata,
    status: event.status,
    user: event.user,
  });
};
