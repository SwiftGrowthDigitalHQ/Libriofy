import compression from "compression";
import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleAuthApiRequest, isSupportedAuthApiPath, type AuthApiRoutePath } from "../src/lib/authApiRoute.server.js";
import { resolveDeviceHeartbeatRequest } from "../src/lib/deviceHeartbeat.server.js";
import { validateAndBindScannerDevice } from "../src/lib/deviceSetup.server.js";
import { buildMaintenanceApiError, evaluateMaintenanceRequest, readMaintenanceContextFromHeaders } from "../src/lib/maintenanceGuard.server.js";
import { parseBooleanSetting } from "../src/lib/maintenance.js";
import { readSafeMaintenanceStatus } from "../src/lib/maintenanceRuntime.server.js";
import { sendAdminAlert } from "../src/lib/observability/alertService.server.js";
import { getCriticalDatabaseHealth, warmCriticalDatabaseHealth } from "../src/lib/observability/databaseHealth.server.js";
import { logEvent } from "../src/lib/observability/eventLogger.server.js";
import {
  applyTraceResponseHeaders,
  createRequestTraceContext,
  runWithRequestTraceContext,
} from "../src/lib/observability/requestContext.server.js";
import { buildRuntimeLivenessReport, buildServerReadiness } from "../src/lib/observability/serverHealth.server.js";
import { captureServerError, initializeServerMonitoring } from "../src/lib/observability/serverMonitoring.js";
import { isDatabaseCriticalError } from "../src/lib/observability/store.server.js";
import { assertServerStartupEnv } from "../src/lib/observability/startupValidation.js";
import { assertAuthSchemaIntegrity } from "../src/lib/authRuntimeIntegrity.server.js";
import { ensureOtpAuthWorkerStarted, resolveSuperAdminSessionRequest } from "../src/lib/otpAuth.server.js";
import {
  resolveScanAttendanceDebugRequest,
  resolveScanAttendanceRequest,
} from "../src/lib/scanAttendance.server.js";
import { handleStudentApiRequest, isSupportedStudentApiPath } from "../src/lib/studentApiRoute.server.js";
import { resolveStudentQrSigningRequest } from "../src/lib/studentQr.server.js";
import { handleAdminApiRequest, isSupportedAdminApiPath } from "../src/lib/superAdmin/apiRoute.server.js";
import {
  SUPER_ADMIN_DASHBOARD_ROUTE,
  SUPER_ADMIN_LOGIN_ROUTE,
  isSuperAdminDashboardPath,
  sanitizeSuperAdminRedirectPath,
} from "../src/lib/superAdminPaths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const distDirectory = path.join(workspaceRoot, "dist");
const assetsDirectory = path.join(distDirectory, "assets");
const port = Number(process.env.PORT || 3001);
const serverStartedAt = Date.now();

assertServerStartupEnv(process.env);
await assertAuthSchemaIntegrity(process.env, {
  flow: "startup",
});

const app = express();
initializeServerMonitoring(process.env);
warmCriticalDatabaseHealth(process.env);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(compression());
app.use((req, res, next) => {
  const traceContext = createRequestTraceContext({
    correlationId:
      (typeof req.headers["x-correlation-id"] === "string" ? req.headers["x-correlation-id"] : undefined) ||
      (typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined),
    ipAddress: req.ip,
    method: req.method,
    requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined,
    route: req.originalUrl || req.path,
    source: "express_server",
    traceId: typeof req.headers["x-trace-id"] === "string" ? req.headers["x-trace-id"] : undefined,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
  });

  applyTraceResponseHeaders(res, traceContext);
  res.locals.requestId = traceContext.requestId;
  res.locals.correlationId = traceContext.correlationId;
  res.locals.traceId = traceContext.traceId;

  void runWithRequestTraceContext(traceContext, async () => {
    next();
  });
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

type OpenAIResponsesPayload = {
  output?: Array<{
    content?: Array<{
      content?: unknown;
      text?: unknown;
    }>;
  }>;
  output_text?: unknown;
};

const extractOutputText = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return "";

  const candidate = payload as OpenAIResponsesPayload;
  if (typeof candidate.output_text === "string") return candidate.output_text;

  const output = Array.isArray(candidate.output) ? candidate.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      if (typeof chunk?.text === "string") return chunk.text;
      if (typeof chunk?.content === "string") return chunk.content;
    }
  }

  return "";
};

ensureOtpAuthWorkerStarted(process.env);

const readDeviceToken = (headers: Record<string, string | string[] | undefined>) => {
  const deviceTokenHeader = headers["x-device-token"];
  const authorizationHeader = headers.authorization;

  return (
    (Array.isArray(deviceTokenHeader) ? deviceTokenHeader[0] : deviceTokenHeader)?.trim() ||
    (Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader)
      ?.replace(/^Bearer\s+/i, "")
      .trim() ||
    ""
  );
};

const readRequestContext = (req: Request) => ({
  authorization: req.headers.authorization,
  cookieHeader: req.headers.cookie,
  deviceFingerprint:
    typeof req.headers["x-device-fingerprint"] === "string"
      ? req.headers["x-device-fingerprint"]
      : Array.isArray(req.headers["x-device-fingerprint"])
        ? req.headers["x-device-fingerprint"][0]
        : undefined,
  deviceLabel:
    typeof req.headers["x-device-label"] === "string"
      ? req.headers["x-device-label"]
      : Array.isArray(req.headers["x-device-label"])
        ? req.headers["x-device-label"][0]
        : undefined,
  host: req.headers.host,
  ip: req.ip,
  origin: req.headers.origin,
  referer: req.headers.referer,
  userAgent: req.headers["user-agent"],
});

const isHtmlNavigationRequest = (req: Request) => {
  if (req.method !== "GET") {
    return false;
  }

  const acceptHeader = req.headers.accept ?? "";
  const fetchDestination = typeof req.headers["sec-fetch-dest"] === "string" ? req.headers["sec-fetch-dest"] : "";
  const requestsDocument = fetchDestination === "document";
  const acceptsHtml = typeof acceptHeader === "string" && acceptHeader.includes("text/html");
  const looksLikeAssetRequest = /\.[a-z0-9]+$/i.test(req.path);

  return !looksLikeAssetRequest && (requestsDocument || acceptsHtml);
};

const buildSuperAdminLoginRedirect = (requestedPath: string) =>
  `${SUPER_ADMIN_LOGIN_ROUTE}?redirect=${encodeURIComponent(requestedPath)}`;

const sendAuthResponse = (
  res: Response,
  result: {
    body: unknown;
    cookies?: string[];
    statusCode: number;
  },
) => {
  if (result.cookies?.length) {
    res.setHeader("Set-Cookie", result.cookies);
  }

  res.status(result.statusCode).json(result.body);
};

const sendServerError = (
  req: Request,
  res: Response,
  error: unknown,
  fallbackMessage: string,
  extraContext?: Record<string, unknown>,
  responseOverrides?: {
    code?: string;
    statusCode?: number;
  },
) => {
  const context = {
    method: req.method,
    path: req.originalUrl || req.path,
    requestId: res.locals.requestId,
    ...extraContext,
  };

  captureServerError(error, {
    ...context,
  });

  const rawMessage = error instanceof Error ? error.message : fallbackMessage;

  if (isDatabaseCriticalError(error, context)) {
    void logEvent({
      type: "DATABASE_CRITICAL_ERROR",
      status: "FAILED",
      user: String(res.locals.requestId ?? ""),
      entityId: String(context.path ?? ""),
      metadata: {
        ...context,
        severity: "CRITICAL",
      },
      message: rawMessage,
    });

    void sendAdminAlert({
      type: "DATABASE_CRITICAL_ERROR",
      severity: "CRITICAL",
      user: String(res.locals.requestId ?? ""),
      message: rawMessage,
      metadata: context,
    });
  }

  res.status(responseOverrides?.statusCode ?? 500).json({
    requestId: res.locals.requestId,
    success: false,
    code: responseOverrides?.code ?? "SERVER_ERROR",
    error: fallbackMessage,
    message: fallbackMessage,
  });
};

const sendAuthServerError = (
  req: Request,
  res: Response,
  error: unknown,
  fallbackMessage: string,
  extraContext?: Record<string, unknown>,
  code = "AUTH_ERROR",
) => {
  sendServerError(req, res, error, fallbackMessage, extraContext, {
    code,
    statusCode: 503,
  });
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

const normalizeLegacyAuthApiPath = (pathname: string): AuthApiRoutePath | null => {
  const candidate = pathname.startsWith("/auth/") ? `/api${pathname}` : pathname;
  return isSupportedAuthApiPath(candidate) ? candidate : null;
};

const isMaintenanceGuardedRequest = (req: Request) =>
  req.path.startsWith("/api/") || req.path.startsWith("/auth/") || isHtmlNavigationRequest(req);

const handleAttendanceScan: Parameters<typeof app.post>[1] = async (req, res) => {
  try {
    const result = await resolveScanAttendanceRequest(process.env, req.body, {
      deviceToken: readDeviceToken(req.headers),
    });

    res.status(result.statusCode).json(result.body);
  } catch (error) {
    captureServerError(error, {
      method: req.method,
      path: req.originalUrl || req.path,
      requestId: res.locals.requestId,
      source: "attendance_scan",
    });

    res.status(500).json({
      code: "SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unexpected attendance scan failure",
      requestId: res.locals.requestId,
      status: "error",
      success: false,
    });
  }
};

app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    appEnv: process.env.APP_ENV || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || null,
    service: "libriofy-auth-attendance-api",
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - serverStartedAt) / 1000),
  });
});

app.get("/health/live", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(
    buildRuntimeLivenessReport(process.env, {
      service: "libriofy-auth-attendance-api",
      startedAt: serverStartedAt,
      target: "express",
    }),
  );
});

app.get("/health/ready", async (_req, res) => {
  const readiness = await buildServerReadiness(process.env, {
    hasDist: existsSync(distDirectory),
    phase: "express_health_ready",
    service: "libriofy-auth-attendance-api",
    startedAt: serverStartedAt,
    target: "express",
  });
  res.setHeader("Cache-Control", "no-store");
  res.status(readiness.ok ? 200 : 503).json(readiness);
});

app.get("/health/ops", async (_req, res) => {
  const readiness = await buildServerReadiness(process.env, {
    hasDist: existsSync(distDirectory),
    phase: "express_health_ops",
    requestId: typeof res.locals.requestId === "string" ? res.locals.requestId : null,
    service: "libriofy-auth-attendance-api",
    startedAt: serverStartedAt,
    target: "express",
  });
  res.setHeader("Cache-Control", "no-store");
  res.status(readiness.ok ? 200 : 503).json(readiness);
});

const handleDatabaseHealthRoute: Parameters<typeof app.get>[1] = async (_req, res) => {
  try {
    const databaseHealth = await getCriticalDatabaseHealth(process.env, {
      forceRefresh: true,
      phase: "api_health_db",
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(databaseHealth.status === "ok" ? 200 : 503).json(databaseHealth);
  } catch (error) {
    console.error("Database health handler crash:", error);
    res.setHeader("Cache-Control", "no-store");
    res.status(503).json({
      checked_at: new Date().toISOString(),
      connectivity: "fail",
      detail: error instanceof Error ? error.message : "Unexpected database health failure",
      entities: [],
      missing: ["recovery_queue", "payments", "students"],
      missing_entities: ["recovery_queue", "payments", "students"],
      recent_critical_errors: [],
      service: "supabase-database-health",
      source: "live",
      status: "failed",
      system_warnings: [],
    });
  }
};

app.get("/health/db", handleDatabaseHealthRoute);
app.get("/api/health/db", handleDatabaseHealthRoute);

app.options("/api/observability/events", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(204).end();
});

app.options("/api/observability/alerts", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(204).end();
});

app.post("/api/observability/events", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      res.setHeader("Cache-Control", "no-store");
      res.status(400).json({ success: false, message: "Invalid event payload." });
      return;
    }

    await logEvent(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ success: true });
  } catch (error) {
    sendServerError(req, res, error, "Unable to record observability event.", { source: "observability_events" });
  }
});

app.post("/api/observability/alerts", async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      res.setHeader("Cache-Control", "no-store");
      res.status(400).json({ success: false, message: "Invalid alert payload." });
      return;
    }

    const result = await sendAdminAlert(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    sendServerError(req, res, error, "Unable to send admin alert.", { source: "observability_alerts" });
  }
});

app.use(async (req, res, next) => {
  if (req.method === "OPTIONS" || !isMaintenanceGuardedRequest(req)) {
    next();
    return;
  }

  try {
    const maintenanceDecision = await evaluateMaintenanceRequest(
      process.env,
      readMaintenanceContextFromHeaders({
        authorization: req.headers.authorization,
        headers: req.headers,
        pathname: req.path,
      }),
    );

    if (maintenanceDecision.allow) {
      next();
      return;
    }

    if (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) {
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json(buildMaintenanceApiError(res.locals.requestId));
      return;
    }

    res.redirect(302, "/maintenance");
  } catch (error) {
    sendServerError(req, res, error, "Unable to validate maintenance access right now.", {
      source: "maintenance_guard",
    });
  }
});

app.get("/api/settings", async (_req, res) => {
  try {
    const status = await readSafeMaintenanceStatus();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(buildMaintenancePayload(status));
  } catch (error) {
    sendServerError(_req, res, error, "Unexpected settings lookup failure", { source: "api_settings" });
  }
});

app.use(async (req, res, next) => {
  if (req.path === "/api/admin/settings") {
    res.setHeader("Cache-Control", "no-store");
    res.status(410).json({
      success: false,
      code: "ROUTE_DEPRECATED",
      error: "Use /api/admin/platform for control-plane settings.",
      message: "Use /api/admin/platform for control-plane settings.",
      requestId: res.locals.requestId,
    });
    return;
  }

  const canonicalAuthPath = normalizeLegacyAuthApiPath(req.path);
  if (canonicalAuthPath) {
    await handleAuthApiRequest(
      {
        body: req.body,
        headers: req.headers,
        method: req.method,
        url: req.originalUrl,
      },
      res,
      process.env,
      canonicalAuthPath,
    );
    return;
  }

  if (isSupportedAdminApiPath(req.path)) {
    await handleAdminApiRequest(
      {
        body: req.body,
        headers: req.headers,
        method: req.method,
        url: req.originalUrl,
      },
      res,
      process.env,
      req.path,
    );
    return;
  }

  if (isSupportedStudentApiPath(req.path)) {
    await handleStudentApiRequest(
      {
        body: req.body,
        headers: req.headers,
        method: req.method,
        url: req.originalUrl,
      },
      res,
      process.env,
      req.path,
    );
    return;
  }

  next();
});

app.post("/api/attendance/scan", handleAttendanceScan);
app.post("/api/scan-attendance", handleAttendanceScan);
app.post("/api/attendance/scan-debug", async (req, res) => {
  try {
    const result = await resolveScanAttendanceDebugRequest(process.env, req.body, {
      deviceToken: readDeviceToken(req.headers),
    });

    res.status(result.statusCode).json(result.body);
  } catch (error) {
    captureServerError(error, {
      method: req.method,
      path: req.originalUrl || req.path,
      requestId: res.locals.requestId,
      source: "attendance_scan_debug",
    });

    res.status(500).json({
      code: "SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unexpected attendance scan debug failure",
      requestId: res.locals.requestId,
      status: "error",
    });
  }
});

app.post("/api/device-setup", async (req, res) => {
  try {
    const libraryAccessKey = String(req.body?.library_id ?? req.body?.libraryId ?? "").trim();
    const deviceId = String(req.body?.device_id ?? req.body?.deviceId ?? "").trim();
    const result = await validateAndBindScannerDevice(process.env, libraryAccessKey, deviceId);

    res.setHeader("Cache-Control", "no-store");
    res.status(result.valid ? 200 : result.code === "DEVICE_SETUP_LOCKED" ? 429 : 404).json(result);
  } catch (error) {
    sendServerError(req, res, error, "Unexpected device setup failure", { source: "device_setup" });
  }
});

app.post("/api/device-heartbeat", async (req, res) => {
  try {
    const result = await resolveDeviceHeartbeatRequest(process.env, req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(result.statusCode).json(result.body);
  } catch (error) {
    sendServerError(req, res, error, "Unexpected device heartbeat failure", {
      source: "device_heartbeat",
    });
  }
});

app.post("/api/student-qr", async (req, res) => {
  try {
    const result = await resolveStudentQrSigningRequest(process.env, req.body, {
      authorization: req.headers.authorization,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(result.statusCode).json(result.body);
  } catch (error) {
    sendServerError(req, res, error, "Unexpected student QR signing failure", {
      source: "student_qr",
    });
  }
});

app.post("/api/ai/partner", async (req, res) => {
  if (!OPENAI_API_KEY) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({
      success: false,
      requestId: res.locals.requestId,
      message: "OPENAI_API_KEY is not configured on the server.",
    });
    return;
  }

  const {
    task,
    customerType,
    objection,
    goal,
    context,
  } = req.body ?? {};

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
                    task: task ?? "message",
                    customerType: customerType ?? "library_owner",
                    objection: objection ?? null,
                    goal: goal ?? "schedule_demo",
                    context: context ?? null,
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
      res.setHeader("Cache-Control", "no-store");
      res.status(500).json({
        success: false,
        message: "OpenAI request failed.",
        details: errorBody,
        requestId: res.locals.requestId,
      });
      return;
    }

    const payload = await response.json();
    const outputText = extractOutputText(payload) || "Unable to generate response. Try again.";

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      output: outputText,
      model: OPENAI_MODEL,
      requestId: res.locals.requestId,
    });
  } catch (error) {
    sendServerError(req, res, error, "AI request failed.", { source: "partner_ai" });
  }
});

if (existsSync(distDirectory)) {
  if (existsSync(assetsDirectory)) {
    app.use(
      "/assets",
      express.static(assetsDirectory, {
        immutable: true,
        index: false,
        maxAge: "1y",
      }),
    );
  }

  app.use(async (req, res, next) => {
    if (!isHtmlNavigationRequest(req)) {
      next();
      return;
    }

    const requestedPath = req.originalUrl || req.path;

    if (isSuperAdminDashboardPath(req.path)) {
      try {
        const activeSession = await resolveSuperAdminSessionRequest(process.env, readRequestContext(req));
        if (!activeSession) {
          res.redirect(302, buildSuperAdminLoginRedirect(requestedPath));
          return;
        }
      } catch (error) {
        console.warn("[auth] super admin route guard failed", error);
        res.redirect(302, buildSuperAdminLoginRedirect(requestedPath));
        return;
      }
    }

    if (req.path === SUPER_ADMIN_LOGIN_ROUTE) {
      try {
        const activeSession = await resolveSuperAdminSessionRequest(process.env, readRequestContext(req));
        if (activeSession) {
          const redirectTarget = sanitizeSuperAdminRedirectPath(
            new URL(requestedPath, "http://localhost").searchParams.get("redirect"),
          );
          res.redirect(302, redirectTarget ?? SUPER_ADMIN_DASHBOARD_ROUTE);
          return;
        }
      } catch (error) {
        console.warn("[auth] super admin login guard failed", error);
      }
    }

    next();
  });

  app.use(
    express.static(distDirectory, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("service-worker.js")) {
          res.setHeader("Cache-Control", "no-cache");
          return;
        }

        if (filePath.endsWith("release.json")) {
          res.setHeader("Cache-Control", "no-store");
          return;
        }

        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
          return;
        }

        if (/\.[a-f0-9]{8,}\./i.test(path.basename(filePath))) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }

        res.setHeader("Cache-Control", "public, max-age=300");
      },
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(distDirectory, "index.html"));
  });
}

app.use((error: unknown, req: Request, res: Response, _next: express.NextFunction) => {
  if (res.headersSent) {
    return;
  }

  sendServerError(req, res, error, "Unexpected server failure", { source: "express_error_handler" });
});

app.listen(port, () => {
  console.log(`Libriofy API listening on http://localhost:${port}`);
});
