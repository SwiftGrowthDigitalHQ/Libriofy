import { normalizeParsedRequestBody } from "./httpRequest.server.js";
import { logEvent } from "./observability/eventLogger.server.js";
import {
  applyTraceResponseHeaders,
  createRequestTraceContext,
  runWithRequestTraceContext,
} from "./observability/requestContext.server.js";
import { incrementRuntimeMetric, recordRuntimeLatency } from "./observability/runtimeMetrics.server.js";
import {
  resolveImpersonationAuditRequest,
  resolveEmailLoginRequest,
  resolveLogoutAllRequest,
  resolveLogoutRequest,
  resolveRefreshSessionRequest,
  resolveSendOtpRequest,
  resolveStartImpersonationRequest,
  resolveStopImpersonationRequest,
  resolveSuperAdminLoginRequest,
  resolveSuperAdminVerifyOtpRequest,
  resolveTwilioStatusCallbackRequest,
  resolveVerifyOtpRequest,
} from "./otpAuth.server.js";

export type ApiHeaders = Record<string, string | string[] | undefined>;

export type ApiRequest = {
  body?: unknown;
  headers?: ApiHeaders;
  method?: string;
  url?: string;
};

export type ApiResponse = {
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
  correlationId?: string;
  deviceFingerprint?: string;
  deviceLabel?: string;
  host?: string;
  ip?: string;
  origin?: string;
  requestId?: string;
  referer?: string;
  traceId?: string;
  userAgent?: string;
};

type AuthResolver = (body: Record<string, unknown>, context: AuthContext) => Promise<ResolverResult>;

export const AUTH_API_ROUTE_PATHS = [
  "/api/auth/send-otp",
  "/api/auth/verify-otp",
  "/api/auth/login-email",
  "/api/auth/super-admin/login",
  "/api/auth/super-admin/verify",
  "/api/auth/super-admin/verify-otp",
  "/api/auth/impersonation/start",
  "/api/auth/impersonation/stop",
  "/api/auth/impersonation/audit",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/logout-all",
  "/api/auth/twilio-status",
] as const;

export type AuthApiRoutePath = (typeof AUTH_API_ROUTE_PATHS)[number];

const AUTH_API_ROUTE_SET = new Set<string>(AUTH_API_ROUTE_PATHS);

const buildErrorBody = (
  message: string,
  code = "AUTH_ERROR",
  extras?: Record<string, number | string | boolean | null | undefined>,
) => ({
  success: false,
  code,
  error: message,
  message,
  ...(extras ?? {}),
});

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
  sendJson(
    res,
    405,
    buildErrorBody("Method not allowed.", "METHOD_NOT_ALLOWED"),
    { Allow: allowedMethod },
  );
};

const readHeaderValue = (headers: ApiHeaders | undefined, headerName: string) => {
  const value = headers?.[headerName];
  return Array.isArray(value) ? value[0] : value;
};

export const readAuthApiRequestPath = (req: ApiRequest) => {
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

const readParsedBody = (req: ApiRequest) =>
  normalizeParsedRequestBody(req.body, readHeaderValue(req.headers, "content-type"));

const sendAuthResponse = (res: ApiResponse, result: ResolverResult) => {
  sendJson(
    res,
    result.statusCode,
    result.body,
    result.cookies?.length ? { "Set-Cookie": result.cookies } : undefined,
  );
};

const recordAuthRouteMetrics = ({
  durationMs,
  method,
  pathname,
  statusCode,
}: {
  durationMs: number;
  method: string;
  pathname: string;
  statusCode: number;
}) => {
  const outcome = statusCode >= 400 ? "error" : "success";

  incrementRuntimeMetric("http_requests_total", 1, {
    area: "auth",
    method,
    outcome,
    route: pathname,
  });
  incrementRuntimeMetric("auth_requests_total", 1, {
    method,
    outcome,
    route: pathname,
    status_code: statusCode,
  });
  recordRuntimeLatency("http_request_latency_ms", durationMs, {
    area: "auth",
    method,
    outcome,
    route: pathname,
  });

  if (durationMs >= 1000) {
    runObservabilitySafely(() =>
      logEvent({
        type: "AUTH_ROUTE_SLOW",
        status: "FAILED",
        classification: "PERFORMANCE_EVENT",
        entityId: pathname,
        metadata: {
          area: "auth",
          duration_ms: durationMs,
          method,
          route: pathname,
          severity: durationMs >= 2500 ? "ERROR" : "WARNING",
          status_code: statusCode,
        },
        message: `Auth route ${pathname} completed in ${durationMs}ms.`,
      }, {
        skipConsole: true,
      }),
    );
  }
};

const runObservabilitySafely = (operation: () => Promise<unknown> | unknown) => {
  try {
    void Promise.resolve(operation()).catch(() => undefined);
  } catch {
    // Observability must never fail auth responses.
  }
};

const logUnexpectedAuthFailure = (pathname: string, error: unknown) => {
  runObservabilitySafely(() =>
    logEvent({
      type: "AUTH_ERROR",
      status: "FAILED",
      classification: "AUTH_ERROR",
      entityId: pathname,
      metadata: {
        area: "auth",
        error_message: error instanceof Error ? error.message : String(error),
        path: pathname,
        severity: "ERROR",
      },
      message: `Unexpected auth route failure for ${pathname}.`,
    }, {
      skipConsole: true,
    }),
  );
};

const createRouteResolverMap = (env: Record<string, string | undefined>): Record<AuthApiRoutePath, AuthResolver> => ({
  "/api/auth/send-otp": (body, context) => resolveSendOtpRequest(env, body, context),
  "/api/auth/verify-otp": (body, context) => resolveVerifyOtpRequest(env, body, context),
  "/api/auth/login-email": (body, context) => resolveEmailLoginRequest(env, body, context),
  "/api/auth/super-admin/login": (body, context) => resolveSuperAdminLoginRequest(env, body, context),
  "/api/auth/super-admin/verify": (body, context) => resolveSuperAdminVerifyOtpRequest(env, body, context),
  "/api/auth/super-admin/verify-otp": (body, context) => resolveSuperAdminVerifyOtpRequest(env, body, context),
  "/api/auth/impersonation/start": (body, context) => resolveStartImpersonationRequest(env, body, context),
  "/api/auth/impersonation/stop": (body, context) => resolveStopImpersonationRequest(env, body, context),
  "/api/auth/impersonation/audit": (body, context) => resolveImpersonationAuditRequest(env, body, context),
  "/api/auth/refresh": (body, context) => resolveRefreshSessionRequest(env, body, context),
  "/api/auth/logout": (body, context) => resolveLogoutRequest(env, body, context),
  "/api/auth/logout-all": (body, context) => resolveLogoutAllRequest(env, body, context),
  "/api/auth/twilio-status": (body) => resolveTwilioStatusCallbackRequest(env, body),
});

export const isSupportedAuthApiPath = (pathname: string): pathname is AuthApiRoutePath =>
  AUTH_API_ROUTE_SET.has(pathname);

export const handleAuthApiRequest = async (
  req: ApiRequest,
  res: ApiResponse,
  env: Record<string, string | undefined>,
  forcedPathname?: AuthApiRoutePath,
) => {
  const pathname = forcedPathname ?? readAuthApiRequestPath(req);
  const method = (req.method || "").toUpperCase();
  const baseContext = readRequestContext(req);
  const traceContext = createRequestTraceContext({
    correlationId: readHeaderValue(req.headers, "x-correlation-id") || readHeaderValue(req.headers, "x-request-id"),
    ipAddress: baseContext.ip,
    method,
    requestId: readHeaderValue(req.headers, "x-request-id"),
    route: pathname,
    source: "auth_api",
    traceId: readHeaderValue(req.headers, "x-trace-id"),
    userAgent: baseContext.userAgent,
  });

  applyTraceResponseHeaders(res, traceContext);

  return runWithRequestTraceContext(traceContext, async () => {
    const startedAt = Date.now();

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

    if (!isSupportedAuthApiPath(pathname)) {
      sendJson(res, 404, buildErrorBody("API route not found.", "ROUTE_NOT_FOUND", { path: pathname }));
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = readParsedBody(req);
    } catch {
      sendJson(res, 400, buildErrorBody("Invalid request body.", "INVALID_REQUEST"));
      return;
    }

    try {
      const resolver = createRouteResolverMap(env)[pathname];
      const result = await resolver(body, {
        ...baseContext,
        correlationId: traceContext.correlationId,
        requestId: traceContext.requestId,
        traceId: traceContext.traceId,
      });
      sendAuthResponse(res, result);
    } catch (error) {
      logUnexpectedAuthFailure(pathname, error);
      sendJson(
        res,
        503,
        buildErrorBody(
          pathname === "/api/auth/refresh"
            ? "Unable to refresh the session right now. Please sign in again."
            : "Authentication service is temporarily unavailable.",
          pathname === "/api/auth/refresh" ? "AUTH_REFRESH_ERROR" : "AUTH_ERROR",
        ),
      );
    } finally {
      recordAuthRouteMetrics({
        durationMs: Date.now() - startedAt,
        method: traceContext.method,
        pathname,
        statusCode: res.statusCode || 200,
      });
    }
  });
};

export const createAuthApiHandler = (
  pathname: AuthApiRoutePath,
  env: Record<string, string | undefined> = process.env,
) => async (req: ApiRequest, res: ApiResponse) => handleAuthApiRequest(req, res, env, pathname);
