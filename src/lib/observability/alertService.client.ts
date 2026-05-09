import { logEvent } from "./eventLogger.client.js";
import type { AdminAlertInput } from "./types.js";
import {
  emptyAlertDeliveryResult,
  getAlertErrorMessage,
  normalizeAlertInput,
  OBSERVABILITY_ALERTS_ENDPOINT,
  reportAlertFailure,
  type AlertDeliveryResult,
} from "./alertService.shared.js";

const postAlertToApi = async (input: AdminAlertInput): Promise<AlertDeliveryResult> => {
  const response = await fetch(OBSERVABILITY_ALERTS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    keepalive: true,
  });

  if (!response.ok) {
    throw new Error(`Observability alert route failed with status ${response.status}.`);
  }

  return (await response.json()) as AlertDeliveryResult;
};

const logAlertDeliveryFailure = async (input: AdminAlertInput, error: unknown) => {
  try {
    await logEvent({
      type: "ADMIN_ALERT_DELIVERY_FAILED",
      status: "FAILED",
      user: input.user,
      metadata: {
        alert_type: input.type,
        errorMessage: getAlertErrorMessage(error),
        severity: "ERROR",
      },
      message: `Unable to deliver admin alert for ${input.type}.`,
    }, {
      skipConsole: true,
    });
  } catch {
    // Secondary observability must never fail the alert caller.
  }
};

export const sendAdminAlert = async (rawInput: AdminAlertInput): Promise<AlertDeliveryResult> => {
  let input: AdminAlertInput;
  try {
    input = normalizeAlertInput(rawInput);
  } catch (error) {
    reportAlertFailure(error, {
      severity: rawInput.severity,
      type: rawInput.type,
    });
    return emptyAlertDeliveryResult();
  }

  try {
    return await postAlertToApi(input);
  } catch (error) {
    await logAlertDeliveryFailure(input, error);
    reportAlertFailure(error, input);
    return emptyAlertDeliveryResult();
  }
};
