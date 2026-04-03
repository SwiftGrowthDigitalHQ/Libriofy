import type { SupabaseClient } from "@supabase/supabase-js";

type LogAttendanceFailureInput = {
  client: SupabaseClient;
  route: string;
  message: string;
  code: string;
  source: string;
  errorType?: "network" | "server" | "unknown";
  metadata?: Record<string, unknown>;
  userId?: string | null;
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const logAttendanceFailure = async ({
  client,
  route,
  message,
  code,
  source,
  errorType = "server",
  metadata,
  userId = null,
}: LogAttendanceFailureInput) => {
  try {
    const { error } = (await client.from("app_error_logs").insert({
      error_message: trimText(message).slice(0, 1200) || "Attendance scan failure",
      error_type: errorType,
      metadata: {
        ...(metadata ?? {}),
        code,
        timestamp: new Date().toISOString(),
      },
      route: trimText(route) || "/",
      source: trimText(source) || "server",
      user_id: userId,
    })) as { error?: unknown };

    if (error) {
      console.warn("[attendance-logger] Failed to store failure log", error);
    }
  } catch (loggingError) {
    console.warn("[attendance-logger] Unexpected logging failure", loggingError);
  }
};
