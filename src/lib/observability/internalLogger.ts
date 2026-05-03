import { logEvent } from "./eventLogger";
import type { ObservabilityMetadata } from "./types";

type InternalLogInput = {
  entityId?: string | null;
  message: string;
  metadata?: ObservabilityMetadata;
  type: string;
  user?: string | null;
};

const withSeverity = (severity: "INFO" | "WARNING" | "ERROR", metadata?: ObservabilityMetadata) => ({
  severity,
  ...(metadata ?? {}),
});

export const logInternalInfo = (input: InternalLogInput) =>
  logEvent({
    type: input.type,
    status: "SUCCESS",
    user: input.user,
    entityId: input.entityId,
    metadata: withSeverity("INFO", input.metadata),
    message: input.message,
  }, {
    skipConsole: true,
  });

export const logInternalWarning = (input: InternalLogInput) =>
  logEvent({
    type: input.type,
    status: "SUCCESS",
    user: input.user,
    entityId: input.entityId,
    metadata: withSeverity("WARNING", input.metadata),
    message: input.message,
  }, {
    skipConsole: true,
  });

export const logInternalError = (input: InternalLogInput) =>
  logEvent({
    type: input.type,
    status: "FAILED",
    user: input.user,
    entityId: input.entityId,
    metadata: withSeverity("ERROR", input.metadata),
    message: input.message,
  }, {
    skipConsole: true,
  });
