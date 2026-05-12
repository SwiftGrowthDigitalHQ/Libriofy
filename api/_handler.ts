import { normalizeParsedRequestBody } from "../src/lib/httpRequest.server.js";
import { parseBooleanSetting } from "../src/lib/maintenance.js";
import { updateMaintenanceSettings } from "../src/lib/maintenance.server.js";
import { readSafeMaintenanceStatus } from "../src/lib/maintenanceRuntime.server.js";
import { getCriticalDatabaseHealth, warmCriticalDatabaseHealth } from "../src/lib/observability/databaseHealth.server.js";
import {
  buildRuntimeLivenessReport,
  buildRuntimeReadinessReport,
} from "../src/lib/observability/serverHealth.server.js";
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

type MaintenanceStatus = {
  maintenance: boolean;
  maintenanceMode: boolean;
  source: string;
  updatedAt: string | null;
};

const SERVERLESS_SERVICE_NAME = "libriofy-vercel-api";
const SERVER_STARTED_AT = Date.now();

const getMaintenanceSafe = (): Promise<MaintenanceStatus> => readSafeMaintenanceStatus();
warmCriticalDatabaseHealth(process.env);

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

const readHeaderValue = (headers: ApiHeaders | undefined, headerName: string) => {
  const value = headers?.[headerName];
  return Array.isArray(value) ? value[0] : value;
};

const readRequestPath = (req: ApiRequest) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

const readRequestContext = (req: ApiRequest): AuthContext => {
  const headers = req.headers ?? {};
  const forwardedFor = readHeaderValue(headers, "x-forwarded-for");

  return {
    authorization: readHeaderValue(headers, "authorization"),
    cookieHeader: readHeaderValue(headers, "cookie"),
    deviceFingerprint: readHeaderValue(headers, "x-device-fingerprint"),
    deviceLabel: readHeaderValue(headers, "x-device-label"),
    host: readHeaderValue(headers, "host") || readHeaderValue(headers, "x-forwarded-host"),
    ip: String(forwardedFor || "").split(",")[0]?.trim() || "",
    origin: readHeaderValue(headers, "origin"),
    referer: readHeaderValue(headers, "referer"),
    userAgent: readHeaderValue(headers, "user-agent") || "",
  };
};

const readParsedBody = (req: ApiRequest) => normalizeParsedRequestBody(req.body, readHeaderValue(req.headers, "content-type"));

const sendAuthResponse = (res: ApiResponse, result: ResolverResult) => {
  sendJson(res, result.statusCode, result.body, result.cookies?.length ? { "Set-Cookie": result.cookies } : undefined);
};

const handleAuthRoute = async (req: ApiRequest, res: ApiResponse, resolver: AuthResolver) => {
  const method = (req.method || "").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (method !== "POST") {
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
      failureCategory: "AUTH_RUNTIME_FAILURE",
      message,
    });
  }
};

const handleSettingsRoute = async (req: ApiRequest, res: ApiResponse) => {
  const method = (req.method || "").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return;
  }

  const status = await getMaintenanceSafe();

  sendJson(res, 200, buildMaintenancePayload(status));
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
    sendJson(res, 200, buildMaintenancePayload(await getMaintenanceSafe()));
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

const handleHealthRoute = async (req: ApiRequest, res: ApiResponse, pathname: string) => {
  const method = (req.method || "GET").toUpperCase();

  if (method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return;
  }

  if (pathname === "/api/health/ready" || pathname === "/api/health/ops") {
    const readiness = await buildRuntimeReadinessReport(process.env, {
      phase: pathname === "/api/health/ops" ? "api_health_ops" : "api_health_ready",
      requestId: null,
      service: SERVERLESS_SERVICE_NAME,
      startedAt: SERVER_STARTED_AT,
      target: "serverless",
    });
    sendJson(res, readiness.ok ? 200 : 503, readiness);
    return;
  }

  if (pathname === "/api/health/db") {
    const databaseHealth = await getCriticalDatabaseHealth(process.env, {
      forceRefresh: true,
      phase: "api_health_db",
    });

    sendJson(res, databaseHealth.status === "ok" ? 200 : 503, databaseHealth);
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

const handleApiRoute = async (req: ApiRequest, res: ApiResponse, pathname: string) => {
  switch (pathname) {
    case "/api/settings":
      await handleSettingsRoute(req, res);
      return;
    case "/api/admin/settings":
      await handleAdminSettingsRoute(req, res);
      return;
    case "/api/health":
    case "/api/health/live":
    case "/api/health/ready":
    case "/api/health/ops":
    case "/api/health/db":
      await handleHealthRoute(req, res, pathname);
      return;
    case "/api/auth/send-otp": {
      await handleAuthRoute(req, res, (body, context) => resolveSendOtpRequest(process.env, body, context));
      return;
    }
    case "/api/auth/verify-otp": {
      await handleAuthRoute(req, res, (body, context) => resolveVerifyOtpRequest(process.env, body, context));
      return;
    }
    case "/api/auth/login-email": {
      await handleAuthRoute(req, res, (body, context) => resolveEmailLoginRequest(process.env, body, context));
      return;
    }
    case "/api/auth/super-admin/login":
    case "/api/utils/user-admin/login": {
      await handleAuthRoute(req, res, (body, context) => resolveSuperAdminLoginRequest(process.env, body, context));
      return;
    }
    case "/api/auth/super-admin/verify-otp":
    case "/api/auth/super-admin/verify":
    case "/api/utils/user-admin/verify-otp":
    case "/api/utils/user-admin/verify": {
      await handleAuthRoute(req, res, (body, context) => resolveSuperAdminVerifyOtpRequest(process.env, body, context));
      return;
    }
    case "/api/auth/refresh": {
      await handleAuthRoute(req, res, (body, context) => resolveRefreshSessionRequest(process.env, body, context));
      return;
    }
    case "/api/auth/logout": {
      await handleAuthRoute(req, res, (body, context) => resolveLogoutRequest(process.env, body, context));
      return;
    }
    case "/api/auth/logout-all": {
      await handleAuthRoute(req, res, (body, context) => resolveLogoutAllRequest(process.env, body, context));
      return;
    }
    case "/api/auth/twilio-status": {
      await handleAuthRoute(req, res, (body) => resolveTwilioStatusCallbackRequest(process.env, body));
      return;
    }
    default:
      sendJson(res, 404, {
        success: false,
        message: "API route not found",
        path: pathname,
      });
  }
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    await handleApiRoute(req, res, readRequestPath(req));
  } catch (error) {
    const pathname = readRequestPath(req);
    const message = error instanceof Error ? error.message : "Unexpected serverless API failure";

    if (pathname === "/api/settings") {
      console.error("Settings handler crash:", message);
      sendJson(res, 200, {
        maintenance: false,
        maintenanceMode: false,
        maintenance_mode: false,
        source: "emergency-fallback",
        updatedAt: null,
        updated_at: null,
      });
      return;
    }

    if (
      pathname === "/api/health" ||
      pathname === "/api/health/live" ||
      pathname === "/api/health/ready" ||
      pathname === "/api/health/ops" ||
      pathname === "/api/health/db"
    ) {
      console.error("Health handler crash:", message);
      sendJson(res, pathname === "/api/health" || pathname === "/api/health/live" ? 200 : 503, {
        appEnv: process.env.APP_ENV || process.env.NODE_ENV || "production",
        maintenanceMode: false,
        missing: pathname === "/api/health/db" ? ["recovery_queue", "payments", "students"] : undefined,
        missing_entities: pathname === "/api/health/db" ? ["recovery_queue", "payments", "students"] : undefined,
        release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || null,
        service: SERVERLESS_SERVICE_NAME,
        source: "emergency-fallback",
        status: pathname === "/api/health" || pathname === "/api/health/live" ? "ok" : "failed",
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
      });
      return;
    }

    sendJson(res, 500, {
      success: false,
      message,
    });
  }
}
