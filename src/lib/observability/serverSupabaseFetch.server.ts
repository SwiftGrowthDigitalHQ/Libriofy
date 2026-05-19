import { captureServerError } from "./serverMonitoring.js";
import { logEvent } from "./eventLogger.server.js";
import { recordRuntimeLatency, incrementRuntimeMetric } from "./runtimeMetrics.server.js";
import { getSupabaseRequestDetails, parseSupabaseErrorResponse } from "./supabaseRequestDetails.js";

const DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS = 10_000;
const OPAQUE_ABORT_MESSAGES = [
  "signal is aborted without reason",
  "the operation was aborted",
  "this operation was aborted",
];

const resolveSupabaseRequestTimeoutMs = () => {
  const parsed = Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || "");
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SUPABASE_REQUEST_TIMEOUT_MS;
};

const buildServerQueryFailureMessage = (
  queryName: string | null,
  queryType: "other" | "rest" | "rpc",
  status: number,
  message: string | null,
) => {
  if (message) {
    return message;
  }

  const target = queryName || "unknown_query";
  return `Supabase ${queryType} request failed for ${target} with status ${status}.`;
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

export const createInstrumentedServerSupabaseFetch = (source: string): typeof fetch => {
  const baseFetch = globalThis.fetch.bind(globalThis);
  const slowQueryThresholdMs = Math.max(250, Number(process.env.SLOW_DB_QUERY_THRESHOLD_MS || "800"));
  const requestTimeoutMs = resolveSupabaseRequestTimeoutMs();

  return async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const customInit = {
      ...init,
      cache: "no-store" as RequestCache,
    };
    const onAbort = () =>
      controller.abort(
        normalizeAbortReason(
          upstreamSignal?.reason,
          "Supabase request was cancelled before completion.",
        ),
      );
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        onAbort();
      } else {
        upstreamSignal.addEventListener("abort", onAbort, { once: true });
      }
    }
    const timeout = setTimeout(() => {
      controller.abort(new Error(`Supabase request timed out after ${requestTimeoutMs}ms.`));
    }, requestTimeoutMs);
    customInit.signal = controller.signal;
    const details = getSupabaseRequestDetails(input, customInit);
    const startedAt = Date.now();

    try {
      const response = await baseFetch(input, customInit);
      const durationMs = Date.now() - startedAt;

      if (!details.skipLogging && details.queryType !== "other") {
        incrementRuntimeMetric("supabase_requests_total", 1, {
          outcome: response.ok ? "success" : "failed",
          query_name: details.queryName || "unknown",
          query_type: details.queryType,
          source,
        });
        recordRuntimeLatency("supabase_request_latency_ms", durationMs, {
          query_name: details.queryName || "unknown",
          query_type: details.queryType,
          source,
        });
      }

      if (!details.skipLogging && details.queryType !== "other" && response.ok && durationMs >= slowQueryThresholdMs) {
        void logEvent({
          type: "SUPABASE_SLOW_QUERY",
          status: "FAILED",
          classification: "PERFORMANCE_EVENT",
          entityId: details.queryName || details.path,
          metadata: {
            latency_ms: durationMs,
            method: details.method,
            path: details.path,
            query_name: details.queryName,
            query_type: details.queryType,
            severity: durationMs >= slowQueryThresholdMs * 2 ? "ERROR" : "WARNING",
            source,
          },
          message: `Supabase ${details.queryType} request for ${details.queryName || details.path} took ${durationMs}ms.`,
        }, {
          skipConsole: true,
        });
      }

      if (!details.skipLogging && details.queryType !== "other" && !response.ok) {
        const payload = await parseSupabaseErrorResponse(response);
        const context = {
          endpoint: details.url,
          errorCode: payload.code,
          method: details.method,
          path: details.path,
          queryName: details.queryName,
          queryType: details.queryType,
          source,
          status: response.status,
          durationMs,
          userContext: source,
        };

        console.error("[supabase] query failed", {
          ...context,
          detail: payload.message || payload.raw,
        });

        captureServerError(
          new Error(buildServerQueryFailureMessage(details.queryName, details.queryType, response.status, payload.message)),
          {
            ...context,
            detail: payload.message || payload.raw,
            source: "supabase_server_client",
            supabaseClientSource: source,
          },
        );

        void logEvent({
          type: "SUPABASE_QUERY_FAILED",
          status: "FAILED",
          classification: "PERFORMANCE_EVENT",
          entityId: details.queryName || details.path,
          metadata: {
            detail: payload.message || payload.raw,
            duration_ms: durationMs,
            error_code: payload.code,
            http_status: response.status,
            method: details.method,
            path: details.path,
            query_name: details.queryName,
            query_type: details.queryType,
            severity: "ERROR",
            source,
          },
          message: buildServerQueryFailureMessage(details.queryName, details.queryType, response.status, payload.message),
        }, {
          skipConsole: true,
        });
      }

      return response;
    } catch (error) {
      const normalizedError = controller.signal.aborted
        ? normalizeAbortReason(
            controller.signal.reason,
            `Supabase request for ${details.queryName || details.path} was aborted.`,
          )
        : error;

      if (!details.skipLogging && details.queryType !== "other") {
        const durationMs = Date.now() - startedAt;
        incrementRuntimeMetric("supabase_requests_total", 1, {
          outcome: "network_error",
          query_name: details.queryName || "unknown",
          query_type: details.queryType,
          source,
        });
        recordRuntimeLatency("supabase_request_latency_ms", durationMs, {
          query_name: details.queryName || "unknown",
          query_type: details.queryType,
          source,
        });

        const context = {
          endpoint: details.url,
          method: details.method,
          path: details.path,
          queryName: details.queryName,
          queryType: details.queryType,
          source: "supabase_server_client",
          status: "network_error",
          supabaseClientSource: source,
          durationMs,
          userContext: source,
        };

        console.error("[supabase] query request crashed", {
          ...context,
          detail: normalizedError instanceof Error ? normalizedError.message : String(normalizedError),
        });

        captureServerError(normalizedError, context);

        void logEvent({
          type: "SUPABASE_QUERY_FAILED",
          status: "FAILED",
          classification: "PERFORMANCE_EVENT",
          entityId: details.queryName || details.path,
          metadata: {
            detail: normalizedError instanceof Error ? normalizedError.message : String(normalizedError),
            duration_ms: durationMs,
            method: details.method,
            path: details.path,
            query_name: details.queryName,
            query_type: details.queryType,
            severity: "ERROR",
            source,
          },
          message: normalizedError instanceof Error ? normalizedError.message : "Supabase request crashed unexpectedly.",
        }, {
          skipConsole: true,
        });
      }

      throw normalizedError;
    } finally {
      clearTimeout(timeout);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener("abort", onAbort);
      }
    }
  };
};
