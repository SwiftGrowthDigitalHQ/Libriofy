import { captureServerError } from "./serverMonitoring.js";
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

  return async (input, init) => {
    const details = getSupabaseRequestDetails(input, init);

    try {
      const response = await baseFetch(input, init);

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
      }

      return response;
    } catch (error) {
      if (!details.skipLogging && details.queryType !== "other") {
        const context = {
          endpoint: details.url,
          method: details.method,
          path: details.path,
          queryName: details.queryName,
          queryType: details.queryType,
          source: "supabase_server_client",
          status: "network_error",
          supabaseClientSource: source,
          userContext: source,
        };

        console.error("[supabase] query request crashed", {
          ...context,
          detail: error instanceof Error ? error.message : String(error),
        });

        captureServerError(error, context);
      }

      throw error;
    }
  };
};
