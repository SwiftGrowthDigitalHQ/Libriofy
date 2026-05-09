import { captureServerError } from "./serverMonitoring.js";
import { logEvent } from "./eventLogger.server.js";
import { recordRuntimeLatency, incrementRuntimeMetric } from "./runtimeMetrics.server.js";
import { getSupabaseRequestDetails, parseSupabaseErrorResponse } from "./supabaseRequestDetails.js";

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

export const createInstrumentedServerSupabaseFetch = (source: string): typeof fetch => {
  const baseFetch = globalThis.fetch.bind(globalThis);
  const slowQueryThresholdMs = Math.max(250, Number(process.env.SLOW_DB_QUERY_THRESHOLD_MS || "800"));

  return async (input, init) => {
    const details = getSupabaseRequestDetails(input, init);
    const startedAt = Date.now();

    try {
      const response = await baseFetch(input, init);
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
          detail: error instanceof Error ? error.message : String(error),
        });

        captureServerError(error, context);

        void logEvent({
          type: "SUPABASE_QUERY_FAILED",
          status: "FAILED",
          classification: "PERFORMANCE_EVENT",
          entityId: details.queryName || details.path,
          metadata: {
            detail: error instanceof Error ? error.message : String(error),
            duration_ms: durationMs,
            method: details.method,
            path: details.path,
            query_name: details.queryName,
            query_type: details.queryType,
            severity: "ERROR",
            source,
          },
          message: error instanceof Error ? error.message : "Supabase request crashed unexpectedly.",
        }, {
          skipConsole: true,
        });
      }

      throw error;
    }
  };
};
