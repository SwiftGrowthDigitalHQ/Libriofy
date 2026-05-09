import { getStoredAuthSession, getStoredAuthUser } from "@/lib/authSession";
import { auditImpersonationActivity } from "@/lib/authApi";
import { captureClientError } from "@/lib/observability/clientMonitoring";
import { getSupabaseRequestDetails, parseSupabaseErrorResponse } from "@/lib/observability/supabaseRequestDetails";

const resolveClientUserId = () => {
  try {
    return getStoredAuthUser()?.id ?? null;
  } catch {
    return null;
  }
};

const buildClientQueryFailureMessage = (
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

const queueImpersonationAudit = (
  details: ReturnType<typeof getSupabaseRequestDetails>,
  {
    outcome,
    status,
  }: {
    outcome: "failed" | "succeeded";
    status: number | "network_error";
  },
) => {
  const session = getStoredAuthSession();
  if (!session?.impersonation || details.skipLogging || details.queryType === "other") {
    return;
  }

  void auditImpersonationActivity({
    action: "supabase_request",
    metadata: {
      method: details.method,
      outcome,
      path: details.path,
      queryName: details.queryName,
      queryType: details.queryType,
      status,
      url: details.url,
    },
    requestPath: typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/",
    requestSource: "supabase_browser_client",
  }).catch(() => undefined);
};

export const createInstrumentedBrowserSupabaseFetch = (): typeof fetch => {
  const baseFetch = globalThis.fetch.bind(globalThis);

  return async (input, init) => {
    const details = getSupabaseRequestDetails(input, init);

    try {
      const response = await baseFetch(input, init);
      queueImpersonationAudit(details, {
        outcome: response.ok ? "succeeded" : "failed",
        status: response.status,
      });

      if (!details.skipLogging && details.queryType !== "other" && !response.ok) {
        const payload = await parseSupabaseErrorResponse(response);
        const userId = resolveClientUserId();
        const context = {
          endpoint: details.url,
          errorCode: payload.code,
          method: details.method,
          path: details.path,
          queryName: details.queryName,
          queryType: details.queryType,
          route: typeof window !== "undefined" ? window.location.pathname : "/",
          source: "supabase_browser_client",
          status: response.status,
          userContext: userId ? `user:${userId}` : "anonymous",
          userId,
        };

        console.error("[supabase] query failed", {
          ...context,
          detail: payload.message || payload.raw,
        });

        captureClientError(
          new Error(buildClientQueryFailureMessage(details.queryName, details.queryType, response.status, payload.message)),
          context,
        );
      }

      return response;
    } catch (error) {
      queueImpersonationAudit(details, {
        outcome: "failed",
        status: "network_error",
      });

      if (!details.skipLogging && details.queryType !== "other") {
        const userId = resolveClientUserId();
        const context = {
          endpoint: details.url,
          method: details.method,
          path: details.path,
          queryName: details.queryName,
          queryType: details.queryType,
          route: typeof window !== "undefined" ? window.location.pathname : "/",
          source: "supabase_browser_client",
          status: "network_error",
          userContext: userId ? `user:${userId}` : "anonymous",
          userId,
        };

        console.error("[supabase] query request crashed", {
          ...context,
          detail: error instanceof Error ? error.message : String(error),
        });

        captureClientError(error, context);
      }

      throw error;
    }
  };
};
