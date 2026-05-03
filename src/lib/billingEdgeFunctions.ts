import { supabase } from "@/integrations/supabase/client";
import { getStoredAccessToken } from "@/lib/authSession";
import { buildBearerAuthorizationHeader, sanitizeHeaders } from "@/lib/httpHeaders";
import { evaluateSubscriptionAccess, type LibrarySubscriptionRecord } from "@/lib/subscription";

type FunctionErrorLike = Error | { message: string; context?: Response };

const EDGE_FUNCTION_SEND_FAILURE = "Failed to send a request to the Edge Function";
const EDGE_FUNCTION_AUTH_ALLOWED_HEADERS = ["Authorization"] as const;

const normalizeFunctionErrorBody = async (context?: Response) => {
  if (!context) {
    return {
      code: null as number | null,
      detail: null as string | null,
      error: null as string | null,
      hint: null as string | null,
      message: null as string | null,
    };
  }

  try {
    const body = await context.clone().json();
    return {
      code: typeof body?.code === "number" ? body.code : null,
      error: body?.error ? String(body.error) : null,
      detail: body?.detail ? String(body.detail) : null,
      hint: body?.hint ? String(body.hint) : null,
      message: body?.message ? String(body.message) : null,
    };
  } catch {
    return { code: null, detail: null, error: null, hint: null, message: null };
  }
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

export const readFunctionErrorMessage = async (error: FunctionErrorLike, functionName?: string) => {
  const context = (error as { context?: Response }).context;
  let message = String(error.message ?? "Edge Function request failed.");

  const body = await normalizeFunctionErrorBody(context);
  if (body.error) message = body.error;
  if (!body.error && body.message) message = body.message;
  if (body.detail) message = `${message}: ${body.detail}`;
  if (body.hint) message = `${message} Hint: ${body.hint}`;

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
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const subscription = await fetchLibrarySubscription(libraryId);
      if (evaluateSubscriptionAccess(subscription).isPlanActive) {
        return subscription;
      }
    } catch {
      // Best-effort polling after payment. Keep retrying a few times before giving up.
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  return null;
};
