import { toAdminApiError } from "./errors";
import { createAdminSearchParams } from "./pagination";
import type { AdminApiPath, AdminApiResponse, AdminListQuery } from "./types";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRY_ATTEMPTS = 2;

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

const buildTimeoutSignal = (timeoutMs: number, signal?: AbortSignal) => {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timeoutId =
    controller && timeoutMs > 0
      ? window.setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  if (controller && signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
  }

  return {
    cleanup() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    },
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
    const { cleanup, signal: requestSignal } = buildTimeoutSignal(timeoutMs, signal);

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
