import type { ObservabilityMetadata } from "./observability/types.js";

export type EnvLike = Record<string, string | undefined>;

export type SendEmailInput = {
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

export const sendEmail = async (_input: SendEmailInput) => {
  throw new Error("sendEmail is server-only. Import '@/lib/email.server' from server runtimes.");
};
