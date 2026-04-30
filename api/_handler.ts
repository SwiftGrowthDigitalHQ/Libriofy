import { normalizeParsedRequestBody } from "../src/lib/httpRequest.server";
import { readSafeMaintenanceStatus } from "../src/lib/maintenanceRuntime.server.js";
import {
  resolveEmailLoginRequest,
  resolveLogoutAllRequest,
  resolveLogoutRequest,
  resolveRefreshSessionRequest,
  resolveSendOtpRequest,
  resolveSuperAdminLoginRequest,
  resolveSuperAdminVerifyOtpRequest,
  resolveTwilioStatusCallbackRequest,
  resolveVerifyOtpRequest,
} from "../src/lib/otpAuth.server";

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
  ip?: string;
  userAgent?: string;
};

type AuthResolver = (body: Record<string, unknown>, context: AuthContext) => Promise<ResolverResult>;

const SERVERLESS_SERVICE_NAME = "libriofy-vercel-api";
const SERVER_STARTED_AT = Date.now();

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
  sendJson(res, 405, { success: false, message: "Method not allowed" }, { Allow: allowedMethod });
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
    ip: String(forwardedFor || "").split(",")[0]?.trim() || "",
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
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Unexpected auth failure",
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

  const status = await readSafeMaintenanceStatus();

  sendJson(res, 200, {
    maintenance: status.maintenance,
    maintenanceMode: status.maintenanceMode,
    maintenance_mode: status.maintenanceMode,
    source: status.source,
    updatedAt: status.updatedAt,
    updated_at: status.updatedAt,
  });
};

const handleHealthRoute = async (req: ApiRequest, res: ApiResponse, pathname: string) => {
  const method = (req.method || "GET").toUpperCase();

  if (method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return;
  }

  if (pathname === "/api/health/ready" || pathname === "/api/health/ops") {
    const maintenance = await readSafeMaintenanceStatus();

    sendJson(res, 200, {
      appEnv: process.env.APP_ENV || process.env.NODE_ENV || "production",
      maintenanceMode: maintenance.maintenanceMode,
      nodeVersion: process.version,
      release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || null,
      service: SERVERLESS_SERVICE_NAME,
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
    });
    return;
  }

  sendJson(res, 200, {
    appEnv: process.env.APP_ENV || process.env.NODE_ENV || "production",
    release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || null,
    service: SERVERLESS_SERVICE_NAME,
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
  });
};

const handleApiRoute = async (req: ApiRequest, res: ApiResponse, pathname: string) => {
  switch (pathname) {
    case "/api/settings":
      await handleSettingsRoute(req, res);
      return;
    case "/api/health":
    case "/api/health/live":
    case "/api/health/ready":
    case "/api/health/ops":
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
    case "/api/auth/super-admin/login": {
      await handleAuthRoute(req, res, (body, context) => resolveSuperAdminLoginRequest(process.env, body, context));
      return;
    }
    case "/api/auth/super-admin/verify-otp": {
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
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Unexpected serverless API failure",
    });
  }
}
