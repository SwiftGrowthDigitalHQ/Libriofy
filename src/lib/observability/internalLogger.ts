import { logEvent } from "./eventLogger.js";
import type { ObservabilityMetadata } from "./types.js";

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

const runInternalLog = (
  input: InternalLogInput,
  severity: "INFO" | "WARNING" | "ERROR",
  status: "FAILED" | "SUCCESS",
) => {
  try {
    return Promise.resolve(logEvent({
      type: input.type,
      status,
      user: input.user,
      entityId: input.entityId,
      metadata: withSeverity(severity, input.metadata),
      message: input.message,
    }, {
      skipConsole: true,
    })).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
};

export const logInternalInfo = (input: InternalLogInput) =>
  runInternalLog(input, "INFO", "SUCCESS");

export const logInternalWarning = (input: InternalLogInput) =>
  runInternalLog(input, "WARNING", "SUCCESS");

export const logInternalError = (input: InternalLogInput) =>
  runInternalLog(input, "ERROR", "FAILED");
