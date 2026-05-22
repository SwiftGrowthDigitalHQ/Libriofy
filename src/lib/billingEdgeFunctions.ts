import { supabase } from "@/integrations/supabase/client";
import { getStoredAccessToken } from "@/lib/authSession";
import { buildBearerAuthorizationHeader, sanitizeHeaders } from "@/lib/httpHeaders";
import { evaluateSubscriptionAccess, type LibrarySubscriptionRecord } from "@/lib/subscription";

type FunctionErrorLike = Error | { message: string; context?: Response };
type BillingFunctionFailure = {
  code: string | null;
  detail: string | null;
  diagnostics: Record<string, unknown> | null;
  hint: string | null;
  layer: string | null;
  message: string | null;
  requestId: string | null;
  retryable: boolean;
  status: number | null;
};

const EDGE_FUNCTION_SEND_FAILURE = "Failed to send a request to the Edge Function";
const EDGE_FUNCTION_AUTH_ALLOWED_HEADERS = [
  "Authorization",
  "x-correlation-id",
  "x-request-id",
  "x-trace-id",
] as const;

const normalizeFunctionErrorBody = async (context?: Response) => {
  if (!context) {
    return {
      code: null as string | null,
      detail: null as string | null,
      diagnostics: null as Record<string, unknown> | null,
      error: null as string | null,
      hint: null as string | null,
      layer: null as string | null,
      message: null as string | null,
      requestId: null as string | null,
      retryable: false,
      status: null as number | null,
    };
  }

  try {
    const body = await context.clone().json();
    return {
      code: body?.code ? String(body.code) : null,
      error: body?.error ? String(body.error) : null,
      detail: body?.detail ? String(body.detail) : null,
      diagnostics:
        body?.diagnostics && typeof body.diagnostics === "object" && !Array.isArray(body.diagnostics)
          ? (body.diagnostics as Record<string, unknown>)
          : null,
      hint: body?.hint ? String(body.hint) : null,
      layer: body?.layer ? String(body.layer) : null,
      message: body?.message ? String(body.message) : null,
      requestId: body?.requestId ? String(body.requestId) : null,
      retryable: Boolean(body?.retryable),
      status: typeof body?.status === "number" ? body.status : context.status,
    };
  } catch {
    return {
      code: null,
      detail: null,
      diagnostics: null,
      error: null,
      hint: null,
      layer: null,
      message: null,
      requestId: null,
      retryable: false,
      status: context.status,
    };
  }
};

const createBillingTraceHeaders = () => {
  const requestId = crypto.randomUUID();
  return {
    "x-correlation-id": requestId,
    "x-request-id": requestId,
    "x-trace-id": crypto.randomUUID(),
  };
};

const getUnavailableFunctionMessage = (functionName?: string) => {
  const projectId = String(import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "").trim();
  const label = functionName ? `The ${functionName} Edge Function` : "The required Edge Function";
  return projectId
    ? `${label} is not deployed or reachable for Supabase project ${projectId}. Deploy it, then try again.`
    : `${label} is not deployed or reachable. Deploy it, then try again.`;
};

export const isFunctionUnavailableError = (error: { message?: string; context?: Response }) => {
  const message = String(error.message ?? "");
  return error.context?.status === 404 || message.includes(EDGE_FUNCTION_SEND_FAILURE);
};

export const readBillingFunctionFailure = async (
  error: FunctionErrorLike,
  functionName?: string,
): Promise<BillingFunctionFailure> => {
  const context = (error as { context?: Response }).context;
  const body = await normalizeFunctionErrorBody(context);
  const fallbackMessage = String(error.message ?? "Edge Function request failed.");

  return {
    code: body.code,
    detail: body.detail,
    diagnostics: body.diagnostics,
    hint: body.hint,
    layer: body.layer,
    message: body.error ?? body.message ?? fallbackMessage,
    requestId: body.requestId,
    retryable: body.retryable,
    status: body.status ?? context?.status ?? null,
  };
};

export const readFunctionErrorMessage = async (error: FunctionErrorLike, functionName?: string) => {
  const context = (error as { context?: Response }).context;
  const failure = await readBillingFunctionFailure(error, functionName);
  let message = failure.message ?? "Edge Function request failed.";

  if (failure.layer || failure.code) {
    const label = functionName ? `${functionName} failed` : "Billing request failed";
    const layerLabel = failure.layer ? ` at ${failure.layer}` : "";
    const codeLabel = failure.code ? ` [${failure.code}]` : "";
    message = `${label}${layerLabel}${codeLabel}. ${message}`;
  }

  if (failure.detail && failure.detail !== failure.message) {
    message = `${message} Details: ${failure.detail}`;
  }
  if (failure.hint) {
    message = `${message} Hint: ${failure.hint}`;
  }
  if (failure.requestId) {
    message = `${message} Request ID: ${failure.requestId}`;
  }

  if (isFunctionUnavailableError({ message, context })) {
    return getUnavailableFunctionMessage(functionName);
  }

  if (context?.status === 401 && message === "Missing authorization header") {
    return functionName
      ? `${functionName} rejected the request because the auth token was not forwarded. Refresh the page, sign in again, and make sure the function accepts authenticated requests.`
      : "The Edge Function rejected the request because the auth token was not forwarded. Refresh the page and sign in again.";
  }

  return message;
};

export const getEdgeFunctionAuthHeaders = async () => {
  const accessToken = await getStoredAccessToken();
  return accessToken
    ? sanitizeHeaders({
        Authorization: buildBearerAuthorizationHeader(accessToken, "Missing access token."),
        ...createBillingTraceHeaders(),
      }, {
        allowedHeaders: EDGE_FUNCTION_AUTH_ALLOWED_HEADERS,
      })
    : undefined;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const fetchLibrarySubscription = async (libraryId: string) => {
  const { data, error } = await supabase
    .from("library_subscriptions")
    .select("*, libraries(enabled, name)")
    .eq("library_id", libraryId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const normalized = data as unknown as LibrarySubscriptionRecord & {
    libraries?: { enabled: boolean; name: string | null } | Array<{ enabled: boolean; name: string | null }> | null;
  };

  return {
    ...normalized,
    libraries: Array.isArray(normalized.libraries) ? normalized.libraries[0] ?? null : normalized.libraries ?? null,
  } satisfies LibrarySubscriptionRecord;
};

export const waitForActiveLibrarySubscription = async (
  libraryId: string,
  { attempts = 5, intervalMs = 2_000 }: { attempts?: number; intervalMs?: number } = {},
) => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const subscription = await fetchLibrarySubscription(libraryId);
      if (evaluateSubscriptionAccess(subscription).isPlanActive) {
        return subscription;
      }
    } catch (error) {
      lastError = error;
      console.warn("[billing] waitForActiveLibrarySubscription attempt failed", {
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
        libraryId,
      });
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  if (lastError) {
    console.warn("[billing] waitForActiveLibrarySubscription exhausted retries", {
      attempts,
      error: lastError instanceof Error ? lastError.message : String(lastError),
      libraryId,
    });
  }

  return null;
};
