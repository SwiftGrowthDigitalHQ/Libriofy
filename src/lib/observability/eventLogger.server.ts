import { withRequestTraceMetadata } from "./requestContext.server.js";
import { insertAppEventLog } from "./store.server.js";
import type { EventLogInput, ObservabilityMetadata } from "./types.js";
import {
  normalizeEventInput,
  normalizeEventType,
  reportEventLoggerFailure,
  writeEventConsole,
  type LogEventOptions,
} from "./eventLogger.shared.js";

const enrichRequestMetadata = (metadata: ObservabilityMetadata): ObservabilityMetadata =>
  withRequestTraceMetadata(metadata) as ObservabilityMetadata;

export const logEvent = async (input: EventLogInput, options: LogEventOptions = {}) => {
  let event: EventLogInput;
  try {
    event = normalizeEventInput(input, enrichRequestMetadata);
  } catch (error) {
    reportEventLoggerFailure(error, "normalize", normalizeEventType(input.type), options);
    return;
  }

  try {
    writeEventConsole(event, options);
  } catch (error) {
    reportEventLoggerFailure(error, "console", event.type, options);
  }

  try {
    await insertAppEventLog(event);
  } catch (error) {
    reportEventLoggerFailure(error, "persist_server", event.type, options);
  }
};
