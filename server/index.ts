import compression from "compression";
import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveDeviceHeartbeatRequest } from "../src/lib/deviceHeartbeat.server.js";
import { validateAndBindScannerDevice } from "../src/lib/deviceSetup.server.js";
import { parseBooleanSetting } from "../src/lib/maintenance.js";
import { updateMaintenanceSettings } from "../src/lib/maintenance.server.js";
import { readSafeMaintenanceStatus } from "../src/lib/maintenanceRuntime.server.js";
import { sendAdminAlert } from "../src/lib/observability/alertService.js";
import { getCriticalDatabaseHealth, warmCriticalDatabaseHealth } from "../src/lib/observability/databaseHealth.server.js";
import { logEvent } from "../src/lib/observability/eventLogger.js";
import { buildServerReadiness } from "../src/lib/observability/serverHealth.js";
import { captureServerError, initializeServerMonitoring } from "../src/lib/observability/serverMonitoring.js";
import { isDatabaseCriticalError } from "../src/lib/observability/store.server.js";
import { assertServerStartupEnv } from "../src/lib/observability/startupValidation.js";
import {
  ensureOtpAuthWorkerStarted,
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
import { resolveStudentQrSigningRequest } from "../src/lib/studentQr.server.js";
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
  const requestId = randomUUID();
  res.setHeader("x-request-id", requestId);
  res.locals.requestId = requestId;
  next();
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
  return typeof acceptHeader === "string" && (acceptHeader.includes("text/html") || acceptHeader.includes("*/*"));
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
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - serverStartedAt) / 1000),
  });
});

app.get("/health/ready", async (_req, res) => {
  const readiness = await buildServerReadiness(process.env, { hasDist: existsSync(distDirectory) });
  res.setHeader("Cache-Control", "no-store");
  res.status(readiness.ok ? 200 : 503).json({
    ...readiness,
    appEnv: process.env.APP_ENV || process.env.NODE_ENV || "development",
    service: "libriofy-auth-attendance-api",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health/ops", async (_req, res) => {
  const readiness = await buildServerReadiness(process.env, { hasDist: existsSync(distDirectory) });
  res.setHeader("Cache-Control", "no-store");
  res.status(readiness.ok ? 200 : 503).json({
    appEnv: process.env.APP_ENV || process.env.NODE_ENV || "development",
    nodeVersion: process.version,
    readiness,
    release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || null,
    requestId: res.locals.requestId,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - serverStartedAt) / 1000),
  });
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

app.get("/api/settings", async (_req, res) => {
  try {
    const status = await readSafeMaintenanceStatus();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(buildMaintenancePayload(status));
  } catch (error) {
    sendServerError(_req, res, error, "Unexpected settings lookup failure", { source: "api_settings" });
  }
});

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

app.get("/api/admin/settings", async (req, res) => {
  try {
    const activeSession = await resolveSuperAdminSessionRequest(process.env, readRequestContext(req));
    if (!activeSession) {
      res.status(401).json({
        success: false,
        message: "Super admin verification is required.",
      });
      return;
    }

    const status = await readSafeMaintenanceStatus();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(buildMaintenancePayload(status));
  } catch (error) {
    sendServerError(req, res, error, "Unexpected admin settings lookup failure", { source: "api_admin_settings" });
  }
});

app.post("/api/admin/settings", async (req, res) => {
  try {
    const activeSession = await resolveSuperAdminSessionRequest(process.env, readRequestContext(req));
    if (!activeSession) {
      res.status(401).json({
        success: false,
        message: "Super admin verification is required.",
      });
      return;
    }

    const nextMaintenanceMode = parseBooleanSetting(
      req.body?.maintenanceMode ?? req.body?.maintenance ?? req.body?.enabled ?? req.body?.value,
    );

    if (nextMaintenanceMode === null) {
      res.status(400).json({
        success: false,
        message: "maintenanceMode must be provided as a boolean-compatible value.",
      });
      return;
    }

    const updatedStatus = await updateMaintenanceSettings(nextMaintenanceMode, process.env, activeSession.user.id);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      ...buildMaintenancePayload(updatedStatus),
    });
  } catch (error) {
    sendServerError(req, res, error, "Unexpected admin settings update failure", { source: "api_admin_settings" });
  }
});

app.post("/auth/send-otp", async (req, res) => {
  try {
    const result = await resolveSendOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to send OTP right now.", { source: "auth_send_otp" });
  }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const result = await resolveVerifyOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to verify OTP right now.", { source: "auth_verify_otp" });
  }
});

app.post("/auth/login-email", async (req, res) => {
  try {
    const result = await resolveEmailLoginRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to sign in right now.", { source: "auth_login_email" });
  }
});

app.post("/auth/super-admin/login", async (req, res) => {
  try {
    const result = await resolveSuperAdminLoginRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to start Super Admin login right now.", { source: "super_admin_login" });
  }
});

app.post(["/auth/super-admin/verify", "/auth/super-admin/verify-otp"], async (req, res) => {
  try {
    const result = await resolveSuperAdminVerifyOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to verify the Super Admin OTP right now.", {
      source: "super_admin_verify_otp",
    });
  }
});

app.post("/auth/refresh", async (req, res) => {
  try {
    const result = await resolveRefreshSessionRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to refresh the session right now. Please sign in again.", {
      source: "auth_refresh",
    }, "AUTH_REFRESH_ERROR");
  }
});

app.post("/auth/logout", async (req, res) => {
  try {
    const result = await resolveLogoutRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to log out right now.", { source: "auth_logout" });
  }
});

app.post("/auth/logout-all", async (req, res) => {
  try {
    const result = await resolveLogoutAllRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to log out of all devices right now.", {
      source: "auth_logout_all",
    });
  }
});

app.post("/auth/twilio-status", async (req, res) => {
  try {
    const result = await resolveTwilioStatusCallbackRequest(process.env, req.body);
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to process the OTP status callback right now.", {
      source: "twilio_status",
    });
  }
});

app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const result = await resolveSendOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to send OTP right now.", { source: "api_auth_send_otp" });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const result = await resolveVerifyOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to verify OTP right now.", { source: "api_auth_verify_otp" });
  }
});

app.post("/api/auth/login-email", async (req, res) => {
  try {
    const result = await resolveEmailLoginRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to sign in right now.", { source: "api_auth_login_email" });
  }
});

app.post("/api/auth/super-admin/login", async (req, res) => {
  try {
    const result = await resolveSuperAdminLoginRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to start Super Admin login right now.", {
      source: "api_super_admin_login",
    });
  }
});

app.post(["/api/auth/super-admin/verify", "/api/auth/super-admin/verify-otp"], async (req, res) => {
  try {
    const result = await resolveSuperAdminVerifyOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to verify the Super Admin OTP right now.", {
      source: "api_super_admin_verify_otp",
    });
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  try {
    const result = await resolveRefreshSessionRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to refresh the session right now. Please sign in again.", {
      source: "api_auth_refresh",
    }, "AUTH_REFRESH_ERROR");
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const result = await resolveLogoutRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to log out right now.", { source: "api_auth_logout" });
  }
});

app.post("/api/auth/logout-all", async (req, res) => {
  try {
    const result = await resolveLogoutAllRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to log out of all devices right now.", {
      source: "api_auth_logout_all",
    });
  }
});

app.post("/api/auth/twilio-status", async (req, res) => {
  try {
    const result = await resolveTwilioStatusCallbackRequest(process.env, req.body);
    sendAuthResponse(res, result);
  } catch (error) {
    sendAuthServerError(req, res, error, "Unable to process the OTP status callback right now.", {
      source: "api_twilio_status",
    });
  }
});

app.post("/api/attendance/scan", handleAttendanceScan);
app.post("/api/scan-attendance", handleAttendanceScan);

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
