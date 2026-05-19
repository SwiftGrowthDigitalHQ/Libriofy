import { AdminApiError, toAdminApiError } from "./errors";
import { createAdminSearchParams } from "./pagination";
import type { AdminApiPath, AdminApiResponse, AdminListQuery } from "./types";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRY_ATTEMPTS = 2;
const OPAQUE_ABORT_MESSAGES = [
  "signal is aborted without reason",
  "the operation was aborted",
  "this operation was aborted",
];

type AdminRequestOptions = {
  body?: unknown;
  headers?: HeadersInit;
  query?: AdminListQuery;
  retryAttempts?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const parseRetryAfter = (value: string | null) => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
};

const hasMeaningfulAbortMessage = (value: string | null | undefined) =>
  Boolean(
    value?.trim() &&
      !OPAQUE_ABORT_MESSAGES.some((candidate) => value.toLowerCase().includes(candidate)),
  );

const normalizeAbortReason = (reason: unknown, fallbackMessage: string) => {
  if (typeof DOMException !== "undefined" && reason instanceof DOMException) {
    if (hasMeaningfulAbortMessage(reason.message)) {
      return new Error(reason.message);
    }

    return new Error(fallbackMessage);
  }

  if (reason instanceof Error) {
    if (hasMeaningfulAbortMessage(reason.message)) {
      return reason;
    }

    return new Error(fallbackMessage);
  }

  if (typeof reason === "string" && hasMeaningfulAbortMessage(reason)) {
    return new Error(reason.trim());
  }

  return new Error(fallbackMessage);
};

const buildTimeoutSignal = (timeoutMs: number, signal?: AbortSignal) => {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  let didTimeout = false;
  const upstreamAbortHandler = () =>
    controller?.abort(
      normalizeAbortReason(
        signal?.reason,
        "Admin request was cancelled before it completed.",
      ),
    );
  const timeoutId =
    controller && timeoutMs > 0
      ? window.setTimeout(() => {
          didTimeout = true;
          controller.abort(new Error(`Admin request timed out after ${timeoutMs}ms.`));
        }, timeoutMs)
      : null;

  if (controller && signal) {
    if (signal.aborted) {
      upstreamAbortHandler();
    } else {
      signal.addEventListener("abort", upstreamAbortHandler, { once: true });
    }
  }

  return {
    cleanup() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      signal?.removeEventListener("abort", upstreamAbortHandler);
    },
    didTimeout: () => didTimeout,
    signal: controller?.signal ?? signal,
  };
};

const parseResponsePayload = async (response: Response) => {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return text ? { message: text } : null;
  }

  return response.json().catch(() => null);
};

const shouldRetryResponse = (response: Response) => response.status === 429 || response.status >= 500;

const waitForRetry = async (attempt: number, retryAfterSeconds?: number) => {
  const fallbackDelayMs = Math.min(600 * 2 ** attempt, 2_500);
  const waitMs = retryAfterSeconds ? retryAfterSeconds * 1_000 : fallbackDelayMs;
  await delay(waitMs);
};

const adminRequest = async <T>(
  path: AdminApiPath,
  method: "GET" | "POST",
  options: AdminRequestOptions = {},
): Promise<T> => {
  const { body, headers, query, retryAttempts = method === "GET" ? MAX_RETRY_ATTEMPTS : 0, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const url = new URL(path, window.location.origin);
  const searchParams = createAdminSearchParams(query);
  searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    const { cleanup, didTimeout, signal: requestSignal } = buildTimeoutSignal(timeoutMs, signal);

    try {
      const response = await fetch(url.toString(), {
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-control-plane-source": "browser-super-admin",
          ...headers,
        },
        method,
        signal: requestSignal,
      });

      const payload = (await parseResponsePayload(response)) as AdminApiResponse<T> | unknown;
      const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));

      if (!response.ok) {
        const error = toAdminApiError({
          fallbackMessage: "Admin request failed.",
          payload,
          retryAfterSeconds,
          status: response.status,
        });

        if (attempt < retryAttempts && shouldRetryResponse(response)) {
          await waitForRetry(attempt, retryAfterSeconds);
          continue;
        }

        throw error;
      }

      if (!payload || typeof payload !== "object" || !("success" in payload) || payload.success !== true) {
        throw toAdminApiError({
          fallbackMessage: "Admin request returned an invalid response.",
          payload,
          status: response.status,
        });
      }

      return payload.data;
    } catch (error) {
      if (requestSignal?.aborted) {
        const timeoutMessage = `Admin request to ${path} timed out after ${Math.ceil(timeoutMs / 1000)}s.`;
        const cancelledMessage = `Admin request to ${path} was cancelled before it completed.`;
        const normalizedAbortError = normalizeAbortReason(
          requestSignal.reason,
          didTimeout() ? timeoutMessage : cancelledMessage,
        );
        const adminError = new AdminApiError({
          errorCode: didTimeout() ? "ADMIN_REQUEST_TIMEOUT" : "ADMIN_REQUEST_ABORTED",
          message: didTimeout() ? timeoutMessage : normalizedAbortError.message,
          status: didTimeout() ? 504 : 499,
        });

        if (didTimeout() && attempt < retryAttempts) {
          await waitForRetry(attempt);
          continue;
        }

        throw adminError;
      }

      if (attempt < retryAttempts) {
        await waitForRetry(attempt);
        continue;
      }

      throw error;
    } finally {
      cleanup();
    }
  }

  throw new Error("Unreachable admin request state.");
};

export const adminGet = <T>(path: AdminApiPath, options?: Omit<AdminRequestOptions, "body">) =>
  adminRequest<T>(path, "GET", options);

export const adminPost = <T, TBody = unknown>(
  path: AdminApiPath,
  body: TBody,
  options?: Omit<AdminRequestOptions, "body">,
) => adminRequest<T>(path, "POST", { ...options, body });

export const adminDownload = async (
  path: Extract<AdminApiPath, "/api/admin/billing">,
  query: AdminListQuery,
) => {
  const url = new URL(path, window.location.origin);
  const searchParams = createAdminSearchParams(query);
  searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    credentials: "include",
    headers: {
      Accept: query.format === "pdf" ? "application/pdf" : "text/csv",
      "x-control-plane-source": "browser-super-admin",
    },
  });

  if (!response.ok) {
    const payload = await parseResponsePayload(response);
    throw toAdminApiError({
      fallbackMessage: "Unable to download admin report.",
      payload,
      retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
      status: response.status,
    });
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const fileNameMatch = disposition.match(/filename=\"?([^"]+)\"?/i);

  return {
    blob,
    fileName: fileNameMatch?.[1] ?? `libriofy-admin-report.${query.format === "pdf" ? "pdf" : "csv"}`,
  };
};
