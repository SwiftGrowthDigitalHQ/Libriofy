import { supabase } from "@/integrations/supabase/client";
import { getStoredAuthUser } from "@/lib/authSession";
import { classifyAppError, extractErrorMessage } from "@/lib/errorHandling";
import { captureClientError, isClientMonitoringEnabled } from "@/lib/observability/clientMonitoring";

type LogAppErrorInput = {
  error: unknown;
  metadata?: Record<string, unknown>;
  route: string;
  source: "query" | "react_boundary" | "unhandled_rejection" | "window_error";
  userId?: string | null;
};

const resolveUserId = async (userId?: string | null) => {
  if (userId !== undefined) {
    return userId;
  }

  try {
    return getStoredAuthUser()?.id ?? null;
  } catch {
    return null;
  }
};

export const logAppError = async ({
  error,
  metadata,
  route,
  source,
  userId,
}: LogAppErrorInput) => {
  const resolvedUserId = await resolveUserId(userId);
  const { kind } = classifyAppError(error);
  const rawMessage = extractErrorMessage(error) || "Unexpected client error";

  if (isClientMonitoringEnabled()) {
    captureClientError(error, {
      errorType: kind,
      route: route || "/",
      source,
      userId: resolvedUserId,
      ...(metadata ?? {}),
    });
  }

  try {
    const { error: insertError } = await supabase.from("app_error_logs").insert({
      error_message: rawMessage.slice(0, 1200),
      error_type: kind,
      metadata: {
        ...(metadata ?? {}),
        timestamp: new Date().toISOString(),
      },
      route: route || "/",
      source,
      user_id: resolvedUserId,
    });

    if (insertError) {
      const insertMessage = (insertError.message || "").toLowerCase();
      if (insertMessage.includes("app_error_logs") || insertMessage.includes("not found") || insertMessage.includes("404")) {
        return;
      }

      console.warn("[error-monitoring] Failed to store error log", insertError);
    }
  } catch (loggingError) {
    console.warn("[error-monitoring] Unexpected logging failure", loggingError);
  }
};
