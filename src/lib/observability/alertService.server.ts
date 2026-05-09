import { resolveLibriofyEmailFrom } from "../libriofyConfig.js";
import { sendEmail } from "../email.server.js";
import { logEvent } from "./eventLogger.server.js";
import type { AdminAlertInput } from "./types.js";
import {
  buildAlertHtml,
  buildAlertSubject,
  buildAlertText,
  emptyAlertDeliveryResult,
  getAlertErrorMessage,
  normalizeAlertInput,
  readAlertEnv,
  reportAlertFailure,
  shouldSuppressAlert,
  type AlertDeliveryResult,
  type EnvLike,
} from "./alertService.shared.js";

const deliverAlertWebhook = async (input: AdminAlertInput, env: EnvLike) => {
  const webhookUrl = readAlertEnv(env, "OPS_ALERT_WEBHOOK_URL");
  if (!webhookUrl) {
    return false;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      alert: input,
      body: buildAlertText(input),
      subject: buildAlertSubject(input),
    }),
  });

  if (!response.ok) {
    throw new Error(`Alert webhook failed with status ${response.status}.`);
  }

  return true;
};

const deliverAlertEmail = async (input: AdminAlertInput, env: EnvLike) => {
  const to = readAlertEnv(env, "OPS_ALERT_EMAIL_TO");
  if (!to) {
    return false;
  }

  const from = resolveLibriofyEmailFrom(readAlertEnv(env, "OPS_ALERT_EMAIL_FROM", "AUTH_EMAIL_FROM"));
  const recipients = to
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!from || recipients.length === 0) {
    return false;
  }

  await sendEmail({
    env,
    from,
    html: buildAlertHtml(input),
    metadata: {
      alert_type: input.type,
      delivery_channel: "admin_alert",
      ...input.metadata,
    },
    subject: buildAlertSubject(input),
    suppressFailureAlert: true,
    text: buildAlertText(input),
    to: recipients,
    user: input.user,
  });

  return true;
};

const deliverAlertTelegram = async (input: AdminAlertInput, env: EnvLike) => {
  const botToken = readAlertEnv(env, "OPS_ALERT_TELEGRAM_BOT_TOKEN");
  const chatId = readAlertEnv(env, "OPS_ALERT_TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) {
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      disable_web_page_preview: true,
      text: buildAlertText(input),
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram alert failed with status ${response.status}.`);
  }

  return true;
};

const deliverAlertOnServer = async (input: AdminAlertInput): Promise<AlertDeliveryResult> => {
  if (shouldSuppressAlert(input)) {
    return {
      deduped: true,
      delivered: false,
      via: [],
    };
  }

  const env = process.env as EnvLike;
  const deliveredVia: Array<"email" | "webhook" | "telegram"> = [];
  let lastDeliveryError: Error | null = null;

  try {
    if (await deliverAlertEmail(input, env)) {
      deliveredVia.push("email");
    }
  } catch (error) {
    lastDeliveryError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    if (await deliverAlertWebhook(input, env)) {
      deliveredVia.push("webhook");
    }
  } catch (error) {
    lastDeliveryError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    if (await deliverAlertTelegram(input, env)) {
      deliveredVia.push("telegram");
    }
  } catch (error) {
    lastDeliveryError = error instanceof Error ? error : new Error(String(error));
  }

  if (deliveredVia.length === 0) {
    throw lastDeliveryError ?? new Error("No admin alert transport is configured.");
  }

  return {
    deduped: false,
    delivered: true,
    via: deliveredVia,
  };
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
    return await deliverAlertOnServer(input);
  } catch (error) {
    await logAlertDeliveryFailure(input, error);
    reportAlertFailure(error, input);
    return emptyAlertDeliveryResult();
  }
};
