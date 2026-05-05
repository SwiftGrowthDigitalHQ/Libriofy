import type { EventLogInput, ObservabilityMetadata } from "./types.js";
import { sanitizeObservabilityMetadata } from "./logSanitizer.js";

const OBSERVABILITY_EVENTS_ENDPOINT = "/api/observability/events";

type LogEventOptions = {
  skipConsole?: boolean;
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const normalizeMetadata = (metadata: unknown): ObservabilityMetadata => {
  try {
    return sanitizeObservabilityMetadata(metadata);
  } catch {
    return {};
  }
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

const reportEventLoggerFailure = (
  error: unknown,
  stage: "console" | "normalize" | "persist_client" | "persist_server",
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

export const logEvent = async (input: EventLogInput, options: LogEventOptions = {}) => {
  let event: EventLogInput;
  try {
    event = normalizeEventInput(input);
  } catch (error) {
    reportEventLoggerFailure(error, "normalize", normalizeText(input.type) || "UNKNOWN_EVENT", options);
    return;
  }

  if (!options.skipConsole) {
    try {
      const consoleMethod = event.status === "FAILED" ? console.error : console.info;

      consoleMethod(`[event] ${event.type}`, {
        entityId: event.entityId,
        message: event.message,
        metadata: event.metadata,
        status: event.status,
        user: event.user,
      });
    } catch (error) {
      reportEventLoggerFailure(error, "console", event.type, options);
    }
  }

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
    reportEventLoggerFailure(error, typeof window === "undefined" ? "persist_server" : "persist_client", event.type, options);
  }
};
