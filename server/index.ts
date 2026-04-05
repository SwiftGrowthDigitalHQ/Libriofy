import cors from "cors";
import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureOtpAuthWorkerStarted,
  resolveEmailLoginRequest,
  resolveLogoutAllRequest,
  resolveLogoutRequest,
  resolveRefreshSessionRequest,
  resolveSendOtpRequest,
  resolveTwilioStatusCallbackRequest,
  resolveVerifyOtpRequest,
} from "../src/lib/otpAuth.server";
import { resolveScanAttendanceRequest } from "../src/lib/scanAttendance.server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const distDirectory = path.join(workspaceRoot, "dist");
const port = Number(process.env.PORT || 3001);

const app = express();

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

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
  ip: req.ip,
  userAgent: req.headers["user-agent"],
});

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

const handleAttendanceScan: Parameters<typeof app.post>[1] = async (req, res) => {
  try {
    const result = await resolveScanAttendanceRequest(process.env, req.body, {
      deviceToken: readDeviceToken(req.headers),
    });

    res.status(result.statusCode).json(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected attendance scan failure";
    res.status(500).json({
      code: "SERVER_ERROR",
      message,
      status: "error",
      success: false,
    });
  }
};

app.get("/health", (_req, res) => {
  res.status(200).json({
    service: "libriofy-auth-attendance-api",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.post("/auth/send-otp", async (req, res) => {
  try {
    const result = await resolveSendOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected send OTP failure",
    });
  }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const result = await resolveVerifyOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected OTP verification failure",
    });
  }
});

app.post("/auth/login-email", async (req, res) => {
  try {
    const result = await resolveEmailLoginRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected email login failure",
    });
  }
});

app.post("/auth/refresh", async (req, res) => {
  try {
    const result = await resolveRefreshSessionRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected session refresh failure",
    });
  }
});

app.post("/auth/logout", async (req, res) => {
  try {
    const result = await resolveLogoutRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected logout failure",
    });
  }
});

app.post("/auth/logout-all", async (req, res) => {
  try {
    const result = await resolveLogoutAllRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected logout-all failure",
    });
  }
});

app.post("/auth/twilio-status", async (req, res) => {
  try {
    const result = await resolveTwilioStatusCallbackRequest(process.env, req.body);
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected Twilio callback failure",
    });
  }
});

app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const result = await resolveSendOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected send OTP failure",
    });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const result = await resolveVerifyOtpRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected OTP verification failure",
    });
  }
});

app.post("/api/auth/login-email", async (req, res) => {
  try {
    const result = await resolveEmailLoginRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected email login failure",
    });
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  try {
    const result = await resolveRefreshSessionRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected session refresh failure",
    });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const result = await resolveLogoutRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected logout failure",
    });
  }
});

app.post("/api/auth/logout-all", async (req, res) => {
  try {
    const result = await resolveLogoutAllRequest(process.env, req.body, readRequestContext(req));
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected logout-all failure",
    });
  }
});

app.post("/api/auth/twilio-status", async (req, res) => {
  try {
    const result = await resolveTwilioStatusCallbackRequest(process.env, req.body);
    sendAuthResponse(res, result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unexpected Twilio callback failure",
    });
  }
});

app.post("/api/attendance/scan", handleAttendanceScan);
app.post("/api/scan-attendance", handleAttendanceScan);

if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }

    res.sendFile(path.join(distDirectory, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Libriofy API listening on http://localhost:${port}`);
});
