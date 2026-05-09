import { classifyAppError } from "@/lib/errorHandling";
import type { AdminApiFailure } from "./types";

export class AdminApiError extends Error {
  readonly details?: Record<string, string[]>;
  readonly errorCode: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly status: number;

  constructor(input: {
    details?: Record<string, string[]>;
    errorCode: string;
    message: string;
    requestId?: string;
    retryAfterSeconds?: number;
    status: number;
  }) {
    super(input.message);
    this.name = "AdminApiError";
    this.details = input.details;
    this.errorCode = input.errorCode;
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.status = input.status;
  }

  get isRetriable() {
    if (this.status === 429) {
      return true;
    }

    if (this.status >= 500) {
      return true;
    }

    return classifyAppError(this).isRetriable;
  }
}

export const isAdminApiFailure = (value: unknown): value is AdminApiFailure =>
  typeof value === "object" &&
  value !== null &&
  "success" in value &&
  (value as { success?: unknown }).success === false &&
  typeof (value as { message?: unknown }).message === "string" &&
  typeof (value as { errorCode?: unknown }).errorCode === "string";

export const toAdminApiError = ({
  fallbackMessage,
  payload,
  retryAfterSeconds,
  status,
}: {
  fallbackMessage: string;
  payload: unknown;
  retryAfterSeconds?: number;
  status: number;
}) => {
  if (isAdminApiFailure(payload)) {
    return new AdminApiError({
      details: payload.details,
      errorCode: payload.errorCode,
      message: payload.message,
      requestId: payload.requestId,
      retryAfterSeconds,
      status,
    });
  }

  return new AdminApiError({
    errorCode: "ADMIN_REQUEST_FAILED",
    message: fallbackMessage,
    retryAfterSeconds,
    status,
  });
};

export const isRetriableAdminError = (error: unknown) =>
  error instanceof AdminApiError ? error.isRetriable : classifyAppError(error).isRetriable;
