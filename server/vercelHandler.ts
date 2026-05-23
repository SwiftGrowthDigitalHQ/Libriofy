import { createClient } from "@supabase/supabase-js";

import { handleAuthApiRequest, isSupportedAuthApiPath, type AuthApiRoutePath } from "../src/lib/authApiRoute.server.js";
import { logAttendanceFailure } from "../src/lib/attendanceFailureLogger.js";
import { resolveDeviceHeartbeatRequest } from "../src/lib/deviceHeartbeat.server.js";
import { validateAndBindScannerDevice } from "../src/lib/deviceSetup.server.js";
import { extractClientIp, extractUserAgent, normalizeParsedRequestBody } from "../src/lib/httpRequest.server.js";
import { buildMaintenanceApiError, evaluateMaintenanceRequest, readMaintenanceContextFromHeaders } from "../src/lib/maintenanceGuard.server.js";
import { parseBooleanSetting } from "../src/lib/maintenance.js";
import { updateMaintenanceSettings } from "../src/lib/maintenance.server.js";
import { readSafeMaintenanceStatus } from "../src/lib/maintenanceRuntime.server.js";
import {
  applyTraceResponseHeaders,
  createRequestTraceContext,
  runWithRequestTraceContext,
} from "../src/lib/observability/requestContext.server.js";
import {
  buildRuntimeLivenessReport,
  buildRuntimeReadinessReport,
} from "../src/lib/observability/serverHealth.server.js";
import { createInstrumentedServerSupabaseFetch } from "../src/lib/observability/serverSupabaseFetch.server.js";
import {
  resolveEmailLoginRequest,
  resolveLogoutAllRequest,
  resolveLogoutRequest,
  resolveRefreshSessionRequest,
  resolveSendOtpRequest,
  resolveSuperAdminLoginRequest,
  resolveSuperAdminSessionRequest,
  resolveSuperAdminVerifyOtpRequest,
  resolveTwilioStatusCallbackRequest,
  resolveVerifyOtpRequest,
} from "../src/lib/otpAuth.server.js";
import { resolveScanAttendanceRequest } from "../src/lib/scanAttendance.server.js";
import { handleStudentApiRequest, isSupportedStudentApiPath } from "../src/lib/studentApiRoute.server.js";
import { resolveStudentQrSigningRequest } from "../src/lib/studentQr.server.js";
import { handleAdminApiRequest, isSupportedAdminApiPath } from "../src/lib/superAdmin/apiRoute.server.js";

type ApiHeaders = Record<string, string | string[] | undefined>;

type ApiRequest = {
  body?: unknown;
  headers?: ApiHeaders;
  method?: string;
  url?: string;
};

type ApiResponse = {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

type ResolverResult = {
  body: unknown;
  cookies?: string[];
  statusCode: number;
};

type AuthContext = {
  authorization?: string;
  cookieHeader?: string;
  deviceFingerprint?: string;
  deviceLabel?: string;
  host?: string;
  ip?: string;
  origin?: string;
  referer?: string;
  userAgent?: string;
};

type AuthResolver = (body: Record<string, unknown>, context: AuthContext) => Promise<ResolverResult>;

type OpenAIResponsesPayload = {
  output?: Array<{
    content?: Array<{
      content?: unknown;
      text?: unknown;
    }>;
  }>;
  output_text?: unknown;
};

const SERVERLESS_SERVICE_NAME = "libriofy-vercel-api";
const SERVER_STARTED_AT = Date.now();
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const sendJson = (res: ApiResponse, statusCode: number, body: unknown, extraHeaders?: Record<string, string | string[]>) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (extraHeaders) {
    for (const [name, value] of Object.entries(extraHeaders)) {
      res.setHeader(name, value);
    }
  }

  res.end(JSON.stringify(body));
};

const sendMethodNotAllowed = (res: ApiResponse, allowedMethod: string) => {
  sendJson(res, 405, {
    success: false,
    code: "METHOD_NOT_ALLOWED",
    error: "Method not allowed.",
    message: "Method not allowed.",
  }, { Allow: allowedMethod });
};

const buildMaintenancePayload = (status: {
  maintenance?: boolean;
  maintenanceMode?: boolean;
  source?: string;
  updatedAt?: string | null;
  updated_at?: string | null;
}) => {
  const maintenanceMode = parseBooleanSetting(status.maintenanceMode ?? status.maintenance) ?? false;
  const updatedAt = status.updatedAt ?? status.updated_at ?? null;

  return {
    maintenance: maintenanceMode,
    maintenanceMode,
    maintenance_mode: maintenanceMode,
    source: status.source ?? "fallback",
    updatedAt,
    updated_at: updatedAt,
  };
};

const readHeaderValue = (headers: ApiHeaders, headerName: string) => {
  const value = headers[headerName];
  return Array.isArray(value) ? value[0] : value;
};

const readRequestPath = (req: ApiRequest) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

const normalizeLegacyAuthApiPath = (pathname: string): AuthApiRoutePath | null => {
  const candidate = pathname.startsWith("/auth/") ? `/api${pathname}` : pathname;
  return isSupportedAuthApiPath(candidate) ? candidate : null;
};

const readRequestContext = (req: ApiRequest): AuthContext => {
  const headers = req.headers ?? {};

  return {
    authorization: readHeaderValue(headers, "authorization"),
    cookieHeader: readHeaderValue(headers, "cookie"),
    deviceFingerprint: readHeaderValue(headers, "x-device-fingerprint"),
    deviceLabel: readHeaderValue(headers, "x-device-label"),
    host: readHeaderValue(headers, "host") || readHeaderValue(headers, "x-forwarded-host"),
    ip: extractClientIp(headers),
    origin: readHeaderValue(headers, "origin"),
    referer: readHeaderValue(headers, "referer"),
    userAgent: extractUserAgent(headers),
  };
};

const readParsedBody = (req: ApiRequest) =>
  normalizeParsedRequestBody(req.body, readHeaderValue(req.headers ?? {}, "content-type"));

const readDeviceToken = (headers: ApiHeaders) => {
  const deviceTokenHeader = readHeaderValue(headers, "x-device-token");
  const authorizationHeader = readHeaderValue(headers, "authorization");

  return deviceTokenHeader?.trim() || authorizationHeader?.replace(/^Bearer\s+/i, "").trim() || "";
};

const readEnv = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const createServiceClient = () => {
  const supabaseUrl = readEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("serverless_attendance"),
    },
  });
};

const logServerlessAttendanceFailure = async (route: string, source: string, error: unknown) => {
  try {
    const supabase = createServiceClient();
    if (!supabase) {
      return;
    }

    await logAttendanceFailure({
      client: supabase,
      route,
      message: error instanceof Error ? error.message : "Unexpected serverless failure",
      code: "SERVER_ERROR",
      source,
      metadata: {
        stage: "unexpected_exception",
      },
    });
  } catch {
    // Best-effort logging only.
  }
};

const sendAuthResponse = (res: ApiResponse, result: ResolverResult) => {
  sendJson(res, result.statusCode, result.body, result.cookies?.length ? { "Set-Cookie": result.cookies } : undefined);
};

const handleAuthRoute = async (req: ApiRequest, res: ApiResponse, resolver: AuthResolver) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if ((req.method || "").toUpperCase() !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return;
  }

  try {
    const result = await resolver(readParsedBody(req), readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    const message = "Authentication service is temporarily unavailable.";
    sendJson(res, 503, {
      success: false,
      code: "AUTH_ERROR",
      error: message,
      message,
    });
  }
};

const extractOutputText = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidate = payload as OpenAIResponsesPayload;
  if (typeof candidate.output_text === "string") {
    return candidate.output_text;
  }

  const output = Array.isArray(candidate.output) ? candidate.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      if (typeof chunk?.text === "string") {
        return chunk.text;
      }

      if (typeof chunk?.content === "string") {
        return chunk.content;
      }
    }
  }

  return "";
};

const handlePartnerAiRoute = async (req: ApiRequest, res: ApiResponse) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return;
  }

  if (!OPENAI_API_KEY) {
    sendJson(res, 500, {
      success: false,
      message: "OPENAI_API_KEY is not configured on the server.",
    });
    return;
  }

  const body = readParsedBody(req);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "text",
                text:
                  "You are a sales assistant for Libriofy partners. Provide crisp, high-conversion WhatsApp messages, call scripts, objection handling, and demo pitches. Keep it short, friendly, and action-oriented. Avoid making any false claims. Output should be ready-to-send.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    task: body.task ?? "message",
                    customerType: body.customerType ?? "library_owner",
                    objection: body.objection ?? null,
                    goal: body.goal ?? "schedule_demo",
                    context: body.context ?? null,
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      sendJson(res, 500, {
        success: false,
        message: "OpenAI request failed.",
        details: errorBody,
      });
      return;
    }

    const payload = await response.json();
    sendJson(res, 200, {
      success: true,
      output: extractOutputText(payload) || "Unable to generate response. Try again.",
      model: OPENAI_MODEL,
    });
  } catch (error) {
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "AI request failed.",
    });
  }
};

const handleHealthRoute = async (req: ApiRequest, res: ApiResponse, pathname: string) => {
  if (req.method && req.method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return;
  }

  if (pathname === "/api/health/ready" || pathname === "/api/health/ops") {
    const readiness = await buildRuntimeReadinessReport(process.env, {
      phase: pathname === "/api/health/ops" ? "vercel_health_ops" : "vercel_health_ready",
      requestId: readHeaderValue(req.headers ?? {}, "x-request-id") || null,
      service: SERVERLESS_SERVICE_NAME,
      startedAt: SERVER_STARTED_AT,
      target: "serverless",
    });
    sendJson(res, readiness.ok ? 200 : 503, readiness);
    return;
  }

  sendJson(
    res,
    200,
    buildRuntimeLivenessReport(process.env, {
      service: SERVERLESS_SERVICE_NAME,
      startedAt: SERVER_STARTED_AT,
      target: "serverless",
    }),
  );
};

const handleAdminSettingsRoute = async (req: ApiRequest, res: ApiResponse) => {
  const method = (req.method || "").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (method !== "GET" && method !== "POST") {
    sendMethodNotAllowed(res, "GET, POST");
    return;
  }

  const activeSession = await resolveSuperAdminSessionRequest(process.env, readRequestContext(req));
  if (!activeSession) {
    sendJson(res, 401, {
      success: false,
      message: "Super admin verification is required.",
    });
    return;
  }

  if (method === "GET") {
    sendJson(res, 200, buildMaintenancePayload(await readSafeMaintenanceStatus()));
    return;
  }

  const body = readParsedBody(req);
  const nextMaintenanceMode = parseBooleanSetting(
    body.maintenanceMode ?? body.maintenance ?? body.enabled ?? body.value,
  );

  if (nextMaintenanceMode === null) {
    sendJson(res, 400, {
      success: false,
      message: "maintenanceMode must be provided as a boolean-compatible value.",
    });
    return;
  }

  const updatedStatus = await updateMaintenanceSettings(nextMaintenanceMode, process.env, activeSession.user.id);
  sendJson(res, 200, {
    success: true,
    ...buildMaintenancePayload(updatedStatus),
  });
};

const routeRequest = async (req: ApiRequest, res: ApiResponse, pathname: string) => {
  if (pathname === "/api/admin/settings") {
    sendJson(res, 410, {
      success: false,
      code: "ROUTE_DEPRECATED",
      error: "Use /api/admin/platform for control-plane settings.",
      message: "Use /api/admin/platform for control-plane settings.",
    });
    return;
  }

  const canonicalAuthPath = normalizeLegacyAuthApiPath(pathname);
  if (canonicalAuthPath) {
    await handleAuthApiRequest(req, res, process.env, canonicalAuthPath);
    return;
  }

  if (isSupportedAdminApiPath(pathname)) {
    await handleAdminApiRequest(req, res, process.env, pathname);
    return;
  }

  if (isSupportedStudentApiPath(pathname)) {
    await handleStudentApiRequest(req, res, process.env, pathname);
    return;
  }

  switch (pathname) {
    case "/api/settings": {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "GET") {
        sendMethodNotAllowed(res, "GET");
        return;
      }

      const status = await readSafeMaintenanceStatus();
      sendJson(res, 200, buildMaintenancePayload(status));
      return;
    }

    case "/api/admin/settings": {
      await handleAdminSettingsRoute(req, res);
      return;
    }

    case "/api/device-setup": {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      const body = readParsedBody(req);
      const result = await validateAndBindScannerDevice(
        process.env,
        String(body.library_id ?? body.libraryId ?? "").trim(),
        String(body.device_id ?? body.deviceId ?? "").trim(),
      );

      sendJson(res, result.valid ? 200 : result.code === "DEVICE_SETUP_LOCKED" ? 429 : 404, result);
      return;
    }

    case "/api/device-heartbeat": {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      try {
        const result = await resolveDeviceHeartbeatRequest(process.env, readParsedBody(req));
        sendJson(res, result.statusCode, result.body);
      } catch (error) {
        await logServerlessAttendanceFailure("/api/device-heartbeat", "device-heartbeat-api", error);
        sendJson(res, 500, {
          valid: false,
          message: error instanceof Error ? error.message : "Unexpected device heartbeat failure",
        });
      }
      return;
    }

    case "/api/scan-attendance":
    case "/api/attendance/scan": {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      try {
        const result = await resolveScanAttendanceRequest(process.env, readParsedBody(req), {
          deviceToken: readDeviceToken(req.headers ?? {}),
        });
        sendJson(res, result.statusCode, result.body);
      } catch (error) {
        await logServerlessAttendanceFailure(pathname, "scan-attendance-api", error);
        sendJson(res, 500, {
          status: "error",
          message: error instanceof Error ? error.message : "Unexpected attendance scan failure",
        });
      }
      return;
    }

    case "/api/student-qr": {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        sendMethodNotAllowed(res, "POST");
        return;
      }

      const result = await resolveStudentQrSigningRequest(process.env, readParsedBody(req), {
        authorization: readHeaderValue(req.headers ?? {}, "authorization"),
      });
      sendJson(res, result.statusCode, result.body);
      return;
    }

    case "/api/auth/send-otp":
      await handleAuthRoute(req, res, (body, context) => resolveSendOtpRequest(process.env, body, context));
      return;
    case "/api/auth/verify-otp":
      await handleAuthRoute(req, res, (body, context) => resolveVerifyOtpRequest(process.env, body, context));
      return;
    case "/api/auth/login-email":
      await handleAuthRoute(req, res, (body, context) => resolveEmailLoginRequest(process.env, body, context));
      return;
    case "/api/auth/super-admin/login":
    case "/api/utils/user-admin/login":
      await handleAuthRoute(req, res, (body, context) => resolveSuperAdminLoginRequest(process.env, body, context));
      return;
    case "/api/auth/super-admin/verify-otp":
    case "/api/auth/super-admin/verify":
    case "/api/utils/user-admin/verify-otp":
    case "/api/utils/user-admin/verify":
      await handleAuthRoute(req, res, (body, context) => resolveSuperAdminVerifyOtpRequest(process.env, body, context));
      return;
    case "/api/auth/refresh":
      await handleAuthRoute(req, res, (body, context) => resolveRefreshSessionRequest(process.env, body, context));
      return;
    case "/api/auth/logout":
      await handleAuthRoute(req, res, (body, context) => resolveLogoutRequest(process.env, body, context));
      return;
    case "/api/auth/logout-all":
      await handleAuthRoute(req, res, (body, context) => resolveLogoutAllRequest(process.env, body, context));
      return;
    case "/api/auth/twilio-status":
      await handleAuthRoute(req, res, (body) => resolveTwilioStatusCallbackRequest(process.env, body));
      return;
    case "/api/ai/partner":
      await handlePartnerAiRoute(req, res);
      return;
    case "/api/health":
    case "/api/health/live":
    case "/api/health/ready":
    case "/api/health/ops":
      await handleHealthRoute(req, res, pathname);
      return;
    default:
      sendJson(res, 404, {
        success: false,
        message: "API route not found",
        path: pathname,
      });
  }
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const pathname = readRequestPath(req);
  const method = (req.method || "GET").toUpperCase();
  const baseContext = readRequestContext(req);
  const traceContext = createRequestTraceContext({
    correlationId: readHeaderValue(req.headers ?? {}, "x-correlation-id") || readHeaderValue(req.headers ?? {}, "x-request-id"),
    ipAddress: baseContext.ip,
    method,
    requestId: readHeaderValue(req.headers ?? {}, "x-request-id"),
    route: pathname,
    source: "vercel_serverless",
    traceId: readHeaderValue(req.headers ?? {}, "x-trace-id"),
    userAgent: baseContext.userAgent,
  });

  applyTraceResponseHeaders(res, traceContext);

  return runWithRequestTraceContext(traceContext, async () => {
    try {

      if (method !== "OPTIONS") {
        const maintenanceDecision = await evaluateMaintenanceRequest(
          process.env,
          readMaintenanceContextFromHeaders({
            authorization: readHeaderValue(req.headers ?? {}, "authorization"),
            headers: req.headers ?? {},
            pathname,
          }),
        );

        if (!maintenanceDecision.allow) {
          sendJson(res, 503, buildMaintenanceApiError(traceContext.requestId));
          return;
        }
      }

      await routeRequest(req, res, pathname);
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        message: error instanceof Error ? error.message : "Unexpected serverless API failure",
      });
    }
  });
}
