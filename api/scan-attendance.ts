import { resolveScanAttendanceRequest } from "../src/lib/scanAttendance.server";
import { logAttendanceFailure } from "../src/lib/attendanceFailureLogger";
import { createClient } from "@supabase/supabase-js";

const sendJson = (
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void },
  statusCode: number,
  body: unknown,
) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.end(JSON.stringify(body));
};

export default async function handler(
  req: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  },
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void },
) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { status: "error", message: "Method not allowed" });
    return;
  }

  try {
    const deviceTokenHeader = req.headers?.["x-device-token"];
    const authorizationHeader = req.headers?.authorization;
    const deviceToken =
      (Array.isArray(deviceTokenHeader) ? deviceTokenHeader[0] : deviceTokenHeader)?.trim() ||
      (Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader)
        ?.replace(/^Bearer\s+/i, "")
        .trim() ||
      "";

    const body =
      typeof req.body === "string"
        ? (JSON.parse(req.body) as Record<string, unknown>)
        : typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};

    const result = await resolveScanAttendanceRequest(process.env, body, { deviceToken });
    sendJson(res, result.statusCode, result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected scan failure";

    try {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

      if (supabaseUrl && serviceRoleKey) {
        const supabase = createClient(supabaseUrl, serviceRoleKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });

        await logAttendanceFailure({
          client: supabase,
          route: "/api/scan-attendance",
          message,
          code: "SERVER_ERROR",
          source: "scan-attendance-api",
          metadata: {
            stage: "unexpected_exception",
          },
        });
      }
    } catch {
      // Best effort logging only.
    }

    sendJson(res, 500, { status: "error", message });
  }
}
