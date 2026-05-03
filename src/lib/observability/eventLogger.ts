import type { EventLogInput, ObservabilityMetadata } from "./types";

const OBSERVABILITY_EVENTS_ENDPOINT = "/api/observability/events";

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const sanitizeJsonValue = (value: unknown, depth = 0): unknown => {
  if (depth > 5) {
    return "[truncated]";
  }

  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeJsonValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50);
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, sanitizeJsonValue(entryValue, depth + 1)]));
  }

  return String(value);
};

const normalizeMetadata = (metadata: unknown): ObservabilityMetadata => {
  const sanitized = sanitizeJsonValue(metadata);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }

  return sanitized as ObservabilityMetadata;
};

const normalizeEventInput = (input: EventLogInput): EventLogInput => {
  const metadata = normalizeMetadata(input.metadata);

  if (typeof window !== "undefined") {
    metadata.route ??= window.location.pathname;
  }

  return {
    type: normalizeText(input.type) || "UNKNOWN_EVENT",
    status: input.status,
    user: normalizeText(input.user) || null,
    entityId: normalizeText(input.entityId) || null,
    metadata,
    message: normalizeText(input.message) || null,
  };
};

const postEventToApi = async (event: EventLogInput) => {
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

export const logEvent = async (input: EventLogInput) => {
  const event = normalizeEventInput(input);
  const consoleMethod = event.status === "FAILED" ? console.error : console.info;

  consoleMethod(`[event] ${event.type}`, {
    entityId: event.entityId,
    message: event.message,
    metadata: event.metadata,
    status: event.status,
    user: event.user,
  });

  try {
    if (typeof window === "undefined") {
      const { insertAppEventLog } = await import("./store.server.js");
      await insertAppEventLog(event);
      return;
    }

    if (typeof fetch === "function") {
      await postEventToApi(event);
    }
  } catch (error) {
    console.error("[observability] Failed to persist event log", {
      eventType: event.type,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
