import type { EventLogInput, ObservabilityMetadata } from "./types";
import { sanitizeObservabilityMetadata } from "./logSanitizer";

const OBSERVABILITY_EVENTS_ENDPOINT = "/api/observability/events";

type LogEventOptions = {
  skipConsole?: boolean;
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeMetadata = (metadata: unknown): ObservabilityMetadata => sanitizeObservabilityMetadata(metadata);

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

export const logEvent = async (input: EventLogInput, options: LogEventOptions = {}) => {
  const event = normalizeEventInput(input);

  if (!options.skipConsole) {
    const consoleMethod = event.status === "FAILED" ? console.error : console.info;

    consoleMethod(`[event] ${event.type}`, {
      entityId: event.entityId,
      message: event.message,
      metadata: event.metadata,
      status: event.status,
      user: event.user,
    });
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
    if (!options.skipConsole) {
      console.error("[observability] Failed to persist event log", {
        eventType: event.type,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
