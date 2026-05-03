import { logEvent } from "./observability/eventLogger.js";
import type { ObservabilityMetadata } from "./observability/types.js";
import { resolveLibriofyEmailFrom } from "./libriofyConfig.js";

type EnvLike = Record<string, string | undefined>;

type SendEmailInput = {
  env?: EnvLike;
  from: string;
  html?: string;
  metadata?: ObservabilityMetadata;
  subject: string;
  suppressFailureAlert?: boolean;
  text: string;
  to: string[];
  user?: string | null;
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const sendViaResend = async (input: SendEmailInput, env: EnvLike) => {
  const apiKey = readEnv(env, "RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
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
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const recipients = input.to.map((value) => value.trim()).filter(Boolean);
  const from = resolveLibriofyEmailFrom(input.from);

  if (!from || recipients.length === 0) {
    throw new Error("Email sender or recipient list is missing.");
  }

  try {
    await sendViaResend({
      ...input,
      from,
    }, env);

    await logEvent({
      type: "EMAIL_SENT",
      status: "SUCCESS",
      user: normalizeText(input.user) || recipients.join(", "),
      metadata: {
        email_from: from,
        email_subject: input.subject,
        recipient_count: recipients.length,
        recipients,
        severity: "INFO",
        ...(input.metadata ?? {}),
      },
      message: input.subject,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logEvent({
      type: "EMAIL_FAILED",
      status: "FAILED",
      user: normalizeText(input.user) || recipients.join(", "),
      metadata: {
        email_from: from || normalizeText(input.from),
        email_subject: input.subject,
        errorMessage,
        recipient_count: recipients.length,
        recipients,
        severity: "ERROR",
        ...(input.metadata ?? {}),
      },
      message: errorMessage,
    });

    if (!input.suppressFailureAlert) {
      const { sendAdminAlert } = await import("./observability/alertService.js");
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
    }

    throw error;
  }
};
