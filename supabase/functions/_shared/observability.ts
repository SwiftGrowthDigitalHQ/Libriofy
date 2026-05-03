import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

type EventLogStatus = "START" | "SUCCESS" | "FAILED";
type AlertSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

type EventLogInput = {
  type: string;
  status: EventLogStatus;
  user?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  message?: string | null;
};

type AdminAlertInput = {
  type: string;
  severity: AlertSeverity;
  user?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
};

const DEFAULT_ALERT_TTL_MS = 5 * 60_000;
const CRITICAL_ALERT_TTL_MS = 10 * 60_000;
const alertDeduplicationCache = new Map<string, number>();
const LIBRIOFY_AUTH_EMAIL = "hello@libriofy.com";
const LIBRIOFY_AUTH_EMAIL_FROM = `Libriofy <${LIBRIOFY_AUTH_EMAIL}>`;

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const resolveLibriofyEmailFrom = (value: string | null | undefined) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const matched = normalized.match(/<([^>]+)>/);
  const address = (matched?.[1] ?? normalized).trim().toLowerCase();
  return address === LIBRIOFY_AUTH_EMAIL ? LIBRIOFY_AUTH_EMAIL_FROM : "";
};

const sanitizeJsonValue = (value: unknown, depth = 0): unknown => {
  if (depth > 5) {
    return "[truncated]";
  }

  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeJsonValue(entry, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50);
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, sanitizeJsonValue(entryValue, depth + 1)]));
  }

  return String(value);
};

const normalizeMetadata = (metadata: unknown) => {
  const sanitized = sanitizeJsonValue(metadata);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }

  return sanitized as Record<string, unknown>;
};

const normalizeEvent = (input: EventLogInput): EventLogInput => ({
  type: normalizeText(input.type) || "UNKNOWN_EVENT",
  status: input.status,
  user: normalizeText(input.user) || null,
  entityId: normalizeText(input.entityId) || null,
  metadata: normalizeMetadata(input.metadata),
  message: normalizeText(input.message) || null,
});

const normalizeAlert = (input: AdminAlertInput): AdminAlertInput => ({
  type: normalizeText(input.type) || "UNKNOWN_ALERT",
  severity: input.severity,
  user: normalizeText(input.user) || null,
  message: normalizeText(input.message) || "Unknown alert reason",
  metadata: normalizeMetadata(input.metadata),
});

const buildAlertSubject = (input: AdminAlertInput) => `[${input.severity}] ${input.type}`;

const buildAlertText = (input: AdminAlertInput) =>
  [
    `Event: ${input.type}`,
    `Severity: ${input.severity}`,
    `User: ${input.user || "Unknown"}`,
    `Reason: ${input.message}`,
    `Time: ${new Date().toISOString()}`,
    `Metadata: ${JSON.stringify(input.metadata ?? {}, null, 2)}`,
  ].join("\n");

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

const sendAlertEmail = async (input: AdminAlertInput) => {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = resolveLibriofyEmailFrom(Deno.env.get("OPS_ALERT_EMAIL_FROM") ?? Deno.env.get("AUTH_EMAIL_FROM"));
  const to = (Deno.env.get("OPS_ALERT_EMAIL_TO") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!apiKey || !from || to.length === 0) {
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      html: buildAlertHtml(input),
      subject: buildAlertSubject(input),
      text: buildAlertText(input),
      to,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Alert email delivery failed.");
  }

  return true;
};

const sendAlertWebhook = async (input: AdminAlertInput) => {
  const webhookUrl = (Deno.env.get("OPS_ALERT_WEBHOOK_URL") ?? "").trim();
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

export const logEdgeEvent = async (
  supabase: ReturnType<typeof createClient>,
  rawInput: EventLogInput,
) => {
  const input = normalizeEvent(rawInput);
  const consoleMethod = input.status === "FAILED" ? console.error : console.info;

  consoleMethod(`[event] ${input.type}`, {
    entityId: input.entityId,
    message: input.message,
    metadata: input.metadata,
    status: input.status,
    user: input.user,
  });

  try {
    await supabase.from("app_event_logs").insert({
      event_type: input.type,
      status: input.status,
      user_identifier: input.user,
      entity_id: input.entityId,
      metadata: input.metadata ?? {},
      message: input.message ?? null,
    });
  } catch (error) {
    console.error("[observability] Failed to persist edge event", error);
  }
};

export const sendEdgeAdminAlert = async (rawInput: AdminAlertInput) => {
  const input = normalizeAlert(rawInput);

  if (shouldSuppressAlert(input)) {
    return { deduped: true, delivered: false, via: [] as Array<"email" | "webhook"> };
  }

  const deliveredVia: Array<"email" | "webhook"> = [];
  let lastDeliveryError: Error | null = null;

  try {
    if (await sendAlertEmail(input)) {
      deliveredVia.push("email");
    }
  } catch (error) {
    lastDeliveryError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    if (await sendAlertWebhook(input)) {
      deliveredVia.push("webhook");
    }
  } catch (error) {
    lastDeliveryError = error instanceof Error ? error : new Error(String(error));
  }

  if (deliveredVia.length === 0) {
    console.error("[observability] Edge alert delivery failed", lastDeliveryError ?? input);
  }

  return {
    deduped: false,
    delivered: deliveredVia.length > 0,
    via: deliveredVia,
  };
};
