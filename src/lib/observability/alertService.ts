import { resolveLibriofyEmailFrom } from "../libriofyConfig.js";
import { logEvent } from "./eventLogger";
import { sanitizeObservabilityMetadata } from "./logSanitizer";
import type { AdminAlertInput, AlertSeverity, ObservabilityMetadata } from "./types";

const OBSERVABILITY_ALERTS_ENDPOINT = "/api/observability/alerts";
const DEFAULT_ALERT_TTL_MS = 5 * 60_000;
const CRITICAL_ALERT_TTL_MS = 10 * 60_000;
const alertDeduplicationCache = new Map<string, number>();

type AlertDeliveryResult = {
  deduped: boolean;
  delivered: boolean;
  via: Array<"email" | "webhook">;
};

type EnvLike = Record<string, string | undefined>;

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeMetadata = (metadata: unknown): ObservabilityMetadata => sanitizeObservabilityMetadata(metadata);

const normalizeAlertInput = (input: AdminAlertInput): AdminAlertInput => ({
  type: normalizeText(input.type) || "UNKNOWN_ALERT",
  severity: input.severity,
  user: normalizeText(input.user) || null,
  message: normalizeText(input.message) || "Unknown alert reason",
  metadata: normalizeMetadata(input.metadata),
});

const buildAlertSubject = (input: AdminAlertInput) => `[${input.severity}] ${input.type}`;

const buildAlertText = (input: AdminAlertInput) => {
  const metadata = JSON.stringify(input.metadata ?? {}, null, 2);

  return [
    `Event: ${input.type}`,
    `Severity: ${input.severity}`,
    `User: ${input.user || "Unknown"}`,
    `Reason: ${input.message}`,
    `Time: ${new Date().toISOString()}`,
    `Metadata: ${metadata}`,
  ].join("\n");
};

const buildAlertHtml = (input: AdminAlertInput) => {
  const metadata = JSON.stringify(input.metadata ?? {}, null, 2);
  const user = input.user || "Unknown";
  const userMarkup = user.includes("@") ? `<a href="mailto:${user}">${user}</a>` : user;

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827;">
      <p style="margin:0 0 12px;"><strong>Event:</strong> ${input.type}</p>
      <p style="margin:0 0 12px;"><strong>Severity:</strong> ${input.severity}</p>
      <p style="margin:0 0 12px;"><strong>User:</strong> ${userMarkup}</p>
      <p style="margin:0 0 12px;"><strong>Reason:</strong> ${input.message}</p>
      <p style="margin:0 0 12px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
      <p style="margin:0 0 8px;"><strong>Metadata:</strong></p>
      <pre style="margin:0;padding:16px;border-radius:12px;background:#f3f4f6;overflow:auto;">${metadata}</pre>
    </div>
  `;
};

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const shouldSuppressAlert = (input: AdminAlertInput) => {
  const signature = JSON.stringify({
    message: input.message,
    metadata: input.metadata,
    severity: input.severity,
    type: input.type,
    user: input.user,
  });
  const ttlMs = input.severity === "CRITICAL" ? CRITICAL_ALERT_TTL_MS : DEFAULT_ALERT_TTL_MS;
  const lastSentAt = alertDeduplicationCache.get(signature) ?? 0;

  if (lastSentAt > 0 && Date.now() - lastSentAt < ttlMs) {
    return true;
  }

  alertDeduplicationCache.set(signature, Date.now());
  return false;
};

const deliverAlertWebhook = async (input: AdminAlertInput, env: EnvLike) => {
  const webhookUrl = readEnv(env, "OPS_ALERT_WEBHOOK_URL");
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
  const to = readEnv(env, "OPS_ALERT_EMAIL_TO");
  if (!to) {
    return false;
  }

  const from = resolveLibriofyEmailFrom(readEnv(env, "OPS_ALERT_EMAIL_FROM", "AUTH_EMAIL_FROM"));
  const recipients = to
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!from || recipients.length === 0) {
    return false;
  }

  const { sendEmail } = await import("../email.js");
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

const deliverAlertOnServer = async (input: AdminAlertInput): Promise<AlertDeliveryResult> => {
  if (shouldSuppressAlert(input)) {
    return {
      deduped: true,
      delivered: false,
      via: [],
    };
  }

  const env = typeof process !== "undefined" ? (process.env as EnvLike) : {};
  const deliveredVia: Array<"email" | "webhook"> = [];
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

  if (deliveredVia.length === 0) {
    throw lastDeliveryError ?? new Error("No admin alert transport is configured.");
  }

  return {
    deduped: false,
    delivered: true,
    via: deliveredVia,
  };
};

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

export const sendAdminAlert = async (rawInput: AdminAlertInput): Promise<AlertDeliveryResult> => {
  const input = normalizeAlertInput(rawInput);

  try {
    if (typeof window === "undefined") {
      return await deliverAlertOnServer(input);
    }

    return await postAlertToApi(input);
  } catch (error) {
    await logEvent({
      type: "ADMIN_ALERT_DELIVERY_FAILED",
      status: "FAILED",
      user: input.user,
      metadata: {
        alert_type: input.type,
        errorMessage: error instanceof Error ? error.message : String(error),
        severity: "ERROR",
      },
      message: `Unable to deliver admin alert for ${input.type}.`,
    }, {
      skipConsole: true,
    });

    return {
      deduped: false,
      delivered: false,
      via: [],
    };
  }
};
