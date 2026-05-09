import { logEvent } from "./observability/eventLogger.server.js";
import { buildBearerAuthorizationHeader, sanitizeHeaders, validateSystemHeaderValue } from "./httpHeaders.js";
import { incrementRuntimeMetric, recordRuntimeLatency } from "./observability/runtimeMetrics.server.js";
import { resolveLibriofyEmailFrom } from "./libriofyConfig.js";
import type { EnvLike, SendEmailInput } from "./email.js";

const RESEND_ALLOWED_HEADERS = ["Authorization", "Content-Type"] as const;

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const runEmailObservabilitySafely = async (operation: () => Promise<unknown> | unknown) => {
  try {
    await Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // Observability must never fail email delivery.
  }
};

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = validateSystemHeaderValue(env[name]);
    if (value) {
      return value;
    }
  }

  return "";
};

const sendViaResend = async (input: SendEmailInput, env: EnvLike) => {
  const apiKey = readEnv(env, "RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const headers = sanitizeHeaders({
    Authorization: buildBearerAuthorizationHeader(apiKey, "RESEND_API_KEY is not configured."),
    "Content-Type": "application/json",
  }, {
    allowedHeaders: RESEND_ALLOWED_HEADERS,
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: input.from,
      html: input.html ?? undefined,
      subject: input.subject,
      text: input.text,
      to: input.to,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Email delivery failed.");
  }
};

export const sendEmail = async (input: SendEmailInput) => {
  const env = input.env ?? process.env;
  const recipients = input.to.map((value) => value.trim()).filter(Boolean);
  const from = resolveLibriofyEmailFrom(input.from);

  if (!from || recipients.length === 0) {
    throw new Error("Email sender or recipient list is missing.");
  }

  try {
    const startedAt = Date.now();
    await sendViaResend({
      ...input,
      from,
    }, env);
    const durationMs = Date.now() - startedAt;
    incrementRuntimeMetric("email_delivery_total", 1, {
      outcome: "success",
      provider: "resend",
    });
    recordRuntimeLatency("email_delivery_latency_ms", durationMs, {
      outcome: "success",
      provider: "resend",
    });

    await runEmailObservabilitySafely(() =>
      logEvent({
        type: "EMAIL_SENT",
        status: "SUCCESS",
        user: normalizeText(input.user) || recipients.join(", "),
        metadata: {
          email_from: from,
          email_provider: "resend",
          email_subject: input.subject,
          latency_ms: durationMs,
          recipient_count: recipients.length,
          recipients,
          severity: "INFO",
          ...(input.metadata ?? {}),
        },
        message: input.subject,
      }, {
        skipConsole: true,
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    incrementRuntimeMetric("email_delivery_total", 1, {
      outcome: "failed",
      provider: "resend",
    });

    await runEmailObservabilitySafely(() =>
      logEvent({
        type: "EMAIL_FAILED",
        status: "FAILED",
        user: normalizeText(input.user) || recipients.join(", "),
        classification: "EMAIL_ERROR",
        metadata: {
          email_from: from || normalizeText(input.from),
          email_provider: "resend",
          email_subject: input.subject,
          errorMessage,
          recipient_count: recipients.length,
          recipients,
          severity: "ERROR",
          ...(input.metadata ?? {}),
        },
        message: errorMessage,
      }, {
        skipConsole: true,
      }),
    );

    if (!input.suppressFailureAlert) {
      await runEmailObservabilitySafely(async () => {
        const { sendAdminAlert } = await import("./observability/alertService.server.js");
        await sendAdminAlert({
          type: "EMAIL_FAILED",
          severity: "ERROR",
          user: normalizeText(input.user) || recipients.join(", "),
          message: errorMessage,
          metadata: {
            email_from: from || normalizeText(input.from),
            email_subject: input.subject,
            recipients,
            ...input.metadata,
          },
        });
      });
    }

    throw error;
  }
};
