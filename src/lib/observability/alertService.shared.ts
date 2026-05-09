import { sanitizeObservabilityMetadata } from "./logSanitizer.js";
import type { AdminAlertInput, ObservabilityMetadata } from "./types.js";

export const OBSERVABILITY_ALERTS_ENDPOINT = "/api/observability/alerts";
const DEFAULT_ALERT_TTL_MS = 5 * 60_000;
const CRITICAL_ALERT_TTL_MS = 10 * 60_000;
const alertDeduplicationCache = new Map<string, number>();

export type AlertDeliveryResult = {
  deduped: boolean;
  delivered: boolean;
  via: Array<"email" | "webhook" | "telegram">;
};

export type EnvLike = Record<string, string | undefined>;

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const getAlertErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const normalizeMetadata = (metadata: unknown): ObservabilityMetadata => {
  try {
    return sanitizeObservabilityMetadata(metadata);
  } catch {
    return {};
  }
};

export const emptyAlertDeliveryResult = (): AlertDeliveryResult => ({
  deduped: false,
  delivered: false,
  via: [],
});

export const normalizeAlertInput = (input: AdminAlertInput): AdminAlertInput => ({
  classification: input.classification ?? null,
  message: normalizeText(input.message) || "Unknown alert reason",
  metadata: normalizeMetadata(input.metadata),
  metricKey: normalizeText(input.metricKey) || null,
  severity: input.severity,
  type: normalizeText(input.type) || "UNKNOWN_ALERT",
  user: normalizeText(input.user) || null,
});

export const buildAlertSubject = (input: AdminAlertInput) => `[${input.severity}] ${input.type}`;

export const buildAlertText = (input: AdminAlertInput) => {
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

export const buildAlertHtml = (input: AdminAlertInput) => {
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

export const readAlertEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

export const shouldSuppressAlert = (input: AdminAlertInput) => {
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

export const reportAlertFailure = (
  error: unknown,
  input: Pick<AdminAlertInput, "severity" | "type">,
) => {
  try {
    console.error("[observability] Failed to deliver admin alert", {
      alertType: normalizeText(input.type) || "UNKNOWN_ALERT",
      message: getAlertErrorMessage(error),
      severity: input.severity,
    });
  } catch {
    // Observability must never fail the caller.
  }
};
