import type { EventLogInput } from "./types.js";
import {
  normalizeEventInput,
  normalizeEventType,
  postEventToApi,
  reportEventLoggerFailure,
  writeEventConsole,
  type LogEventOptions,
} from "./eventLogger.shared.js";

export const logEvent = async (input: EventLogInput, options: LogEventOptions = {}) => {
  let event: EventLogInput;
  try {
    event = normalizeEventInput(input);
  } catch (error) {
    reportEventLoggerFailure(error, "normalize", normalizeEventType(input.type), options);
    return;
  }

  try {
    writeEventConsole(event, options);
  } catch (error) {
    reportEventLoggerFailure(error, "console", event.type, options);
  }

  if (typeof fetch !== "function") {
    return;
  }

  try {
    await postEventToApi(event);
  } catch (error) {
    reportEventLoggerFailure(error, "persist_client", event.type, options);
  }
};
