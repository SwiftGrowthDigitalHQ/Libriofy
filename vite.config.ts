import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { extractClientIp, extractUserAgent, parseRequestBody, readRequestBody } from "./src/lib/httpRequest.server";
import { resolveMaintenanceStatus } from "./src/lib/maintenance.server";
import { validateAndBindScannerDevice } from "./src/lib/deviceSetup.server";
import { resolveDeviceHeartbeatRequest } from "./src/lib/deviceHeartbeat.server";
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
} from "./src/lib/otpAuth.server";
import { resolveStudentQrSigningRequest } from "./src/lib/studentQr.server";
import { resolveScanAttendanceRequest } from "./src/lib/scanAttendance.server";
import {
  SUPER_ADMIN_DASHBOARD_ROUTE,
  SUPER_ADMIN_LOGIN_ROUTE,
  isSuperAdminDashboardPath,
  sanitizeSuperAdminRedirectPath,
} from "./src/lib/superAdminPaths";

type OpenAIResponsesPayload = {
  output?: Array<{
    content?: Array<{
      text?: unknown;
    }>;
  }>;
  output_text?: unknown;
};

const releaseManifestPlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-release-manifest",
  generateBundle() {
    const payload = {
      appEnv: env.VITE_APP_ENV || env.APP_ENV || "development",
      generated_at_utc: new Date().toISOString(),
      release: env.VITE_RELEASE_SHA || env.RELEASE_SHA || null,
    };

    this.emitFile({
      fileName: "release.json",
      source: JSON.stringify(payload, null, 2),
      type: "asset",
    });
  },
});

const extractPartnerAiOutput = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidate = payload as OpenAIResponsesPayload;
  if (typeof candidate.output_text === "string") {
    return candidate.output_text;
  }

  return Array.isArray(candidate.output) && typeof candidate.output[0]?.content?.[0]?.text === "string"
    ? candidate.output[0].content[0].text
    : "";
};

const partnerAiPlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-partner-ai",
  configureServer(server) {
    server.middlewares.use("/api/ai/partner", async (req, res, next) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ success: false, message: "Method not allowed" }));
        return;
      }

      try {
        const apiKey = env.OPENAI_API_KEY || "";
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ success: false, message: "OPENAI_API_KEY is not configured." }));
          return;
        }

        const rawBody = await readRequestBody(req);
        const contentType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
        const body = parseRequestBody(rawBody, contentType);

        const response = await fetch(`${env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: env.OPENAI_MODEL || "gpt-4o-mini",
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
                content: [{ type: "text", text: JSON.stringify(body ?? {}, null, 2) }],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ success: false, message: "OpenAI request failed.", details: errorBody }));
          return;
        }

        const payload = await response.json();
        const outputText = extractPartnerAiOutput(payload) || "Unable to generate response.";

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ success: true, output: outputText }));
      } catch (error) {
        next(error);
      }
    });
  },
});

const maintenanceSettingsPlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-maintenance-settings",
  configureServer(server) {
    server.middlewares.use("/api/settings", async (req, res, next) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "GET") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      try {
        const status = await resolveMaintenanceStatus(env);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          JSON.stringify({
            maintenanceMode: status.maintenanceMode,
            maintenance_mode: status.maintenanceMode,
            source: status.source,
            updatedAt: status.updatedAt,
            updated_at: status.updatedAt,
          }),
        );
      } catch (error) {
        next(error);
      }
    });
  },
});

const deviceSetupPlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-device-setup",
  configureServer(server) {
    server.middlewares.use("/api/device-setup", async (req, res, next) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ valid: false, message: "Method not allowed" }));
        return;
      }

      try {
        const rawBody = await readRequestBody(req);
        const contentType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
        const body = parseRequestBody(rawBody, contentType);
        const libraryAccessKey = String(body.library_id ?? body.libraryId ?? "").trim();
        const deviceId = String(body.device_id ?? body.deviceId ?? "").trim();
        const result = await validateAndBindScannerDevice(env, libraryAccessKey, deviceId);

        res.statusCode = result.valid ? 200 : result.code === "DEVICE_SETUP_LOCKED" ? 429 : 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(result));
      } catch (error) {
        next(error);
      }
    });
  },
});

const deviceHeartbeatPlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-device-heartbeat",
  configureServer(server) {
    server.middlewares.use("/api/device-heartbeat", async (req, res, next) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ valid: false, message: "Method not allowed" }));
        return;
      }

      try {
        const rawBody = await readRequestBody(req);
        const contentType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
        const body = parseRequestBody(rawBody, contentType);
        const result = await resolveDeviceHeartbeatRequest(env, body);

        res.statusCode = result.statusCode;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(result.body));
      } catch (error) {
        next(error);
      }
    });
  },
});

const studentQrPlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-student-qr",
  configureServer(server) {
    server.middlewares.use("/api/student-qr", async (req, res, next) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ status: "error", message: "Method not allowed" }));
        return;
      }

      try {
        const rawBody = await readRequestBody(req);
        const contentType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
        const body = parseRequestBody(rawBody, contentType);
        const authorizationHeader = req.headers.authorization;
        const authorization =
          (Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader)?.trim() || "";
        const result = await resolveStudentQrSigningRequest(env, body, { authorization });

        res.statusCode = result.statusCode;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(result.body));
      } catch (error) {
        next(error);
      }
    });
  },
});

const scanAttendancePlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-scan-attendance",
  configureServer(server) {
    const handleScanAttendance = async (
      req: {
        method?: string;
        headers: Record<string, string | string[] | undefined>;
        on: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
      },
      res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void },
      next: (error?: unknown) => void,
    ) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ status: "error", message: "Method not allowed" }));
        return;
      }

      try {
        const rawBody = await readRequestBody(req);
        const contentType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
        const body = parseRequestBody(rawBody, contentType);
        const deviceTokenHeader = req.headers["x-device-token"];
        const authorizationHeader = req.headers.authorization;
        const deviceToken =
          (Array.isArray(deviceTokenHeader) ? deviceTokenHeader[0] : deviceTokenHeader)?.trim() ||
          (Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader)
            ?.replace(/^Bearer\s+/i, "")
            .trim() ||
          "";
        const result = await resolveScanAttendanceRequest(env, body, { deviceToken });

        res.statusCode = result.statusCode;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(result.body));
      } catch (error) {
        next(error);
      }
    };

    server.middlewares.use("/api/attendance/scan", handleScanAttendance);
    server.middlewares.use("/api/scan-attendance", handleScanAttendance);
  },
});

const superAdminPageGuardPlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-super-admin-page-guard",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const requestUrl = req.url || "/";
      const parsedUrl = new URL(requestUrl, "http://localhost");
      const pathname = parsedUrl.pathname;
      const acceptHeader = Array.isArray(req.headers.accept) ? req.headers.accept[0] : req.headers.accept;

      if (
        req.method !== "GET" ||
        pathname.startsWith("/api/") ||
        pathname.startsWith("/auth/") ||
        typeof acceptHeader !== "string" ||
        (!acceptHeader.includes("text/html") && !acceptHeader.includes("*/*"))
      ) {
        next();
        return;
      }

      const requestContext = {
        authorization: Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization,
        cookieHeader: Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie,
        deviceFingerprint: Array.isArray(req.headers["x-device-fingerprint"])
          ? req.headers["x-device-fingerprint"][0]
          : req.headers["x-device-fingerprint"],
        deviceLabel: Array.isArray(req.headers["x-device-label"]) ? req.headers["x-device-label"][0] : req.headers["x-device-label"],
        ip: extractClientIp(req.headers),
        userAgent: extractUserAgent(req.headers),
      };

      if (isSuperAdminDashboardPath(pathname)) {
        try {
          const activeSession = await resolveSuperAdminSessionRequest(env, requestContext);
          if (!activeSession) {
            res.statusCode = 302;
            res.setHeader("Location", `${SUPER_ADMIN_LOGIN_ROUTE}?redirect=${encodeURIComponent(requestUrl)}`);
            res.end();
            return;
          }
        } catch (error) {
          next(error);
          return;
        }
      }

      if (pathname === SUPER_ADMIN_LOGIN_ROUTE) {
        try {
          const activeSession = await resolveSuperAdminSessionRequest(env, requestContext);
          if (activeSession) {
            res.statusCode = 302;
            res.setHeader(
              "Location",
              sanitizeSuperAdminRedirectPath(parsedUrl.searchParams.get("redirect")) ?? SUPER_ADMIN_DASHBOARD_ROUTE,
            );
            res.end();
            return;
          }
        } catch (error) {
          next(error);
          return;
        }
      }

      next();
    });
  },
});

const authPlugin = (env: Record<string, string>): Plugin => ({
  name: "libriofy-auth",
  configureServer(server) {
    ensureOtpAuthWorkerStarted(env);

    const createHandler = (
      resolver: (
        body: Record<string, unknown>,
        context: {
          authorization?: string;
          cookieHeader?: string;
          deviceFingerprint?: string;
          deviceLabel?: string;
          ip?: string;
          userAgent?: string;
        },
      ) => Promise<{ body: unknown; cookies?: string[]; statusCode: number }>,
    ) => async (
      req: {
        method?: string;
        headers: Record<string, string | string[] | undefined>;
        on: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
      },
      res: { statusCode: number; setHeader: (name: string, value: string | string[]) => void; end: (body?: string) => void },
      next: (error?: unknown) => void,
    ) => {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Cache-Control", "no-store");
        res.end();
        return;
      }

      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ success: false, message: "Method not allowed" }));
        return;
      }

      try {
        const rawBody = await readRequestBody(req);
        const contentType = Array.isArray(req.headers["content-type"]) ? req.headers["content-type"][0] : req.headers["content-type"];
        const body = parseRequestBody(rawBody, contentType);
        const result = await resolver(body, {
          authorization: Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization,
          cookieHeader: Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie,
          deviceFingerprint: Array.isArray(req.headers["x-device-fingerprint"])
            ? req.headers["x-device-fingerprint"][0]
            : req.headers["x-device-fingerprint"],
          deviceLabel: Array.isArray(req.headers["x-device-label"]) ? req.headers["x-device-label"][0] : req.headers["x-device-label"],
          ip: extractClientIp(req.headers),
          userAgent: extractUserAgent(req.headers),
        });

        res.statusCode = result.statusCode;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        if (result.cookies?.length) {
          res.setHeader("Set-Cookie", result.cookies);
        }
        res.end(JSON.stringify(result.body));
      } catch (error) {
        next(error);
      }
    };

    const handleSendOtp = createHandler((body, context) => resolveSendOtpRequest(env, body, context));
    const handleVerifyOtp = createHandler((body, context) => resolveVerifyOtpRequest(env, body, context));
    const handleEmailLogin = createHandler((body, context) => resolveEmailLoginRequest(env, body, context));
    const handleSuperAdminLogin = createHandler((body, context) => resolveSuperAdminLoginRequest(env, body, context));
    const handleSuperAdminVerifyOtp = createHandler((body, context) => resolveSuperAdminVerifyOtpRequest(env, body, context));
    const handleRefresh = createHandler((body, context) => resolveRefreshSessionRequest(env, body, context));
    const handleLogout = createHandler((body, context) => resolveLogoutRequest(env, body, context));
    const handleLogoutAll = createHandler((body, context) => resolveLogoutAllRequest(env, body, context));
    const handleTwilioStatus = createHandler((body) => resolveTwilioStatusCallbackRequest(env, body));

    server.middlewares.use("/auth/send-otp", handleSendOtp);
    server.middlewares.use("/auth/verify-otp", handleVerifyOtp);
    server.middlewares.use("/auth/login-email", handleEmailLogin);
    server.middlewares.use("/auth/super-admin/login", handleSuperAdminLogin);
    server.middlewares.use("/auth/super-admin/verify-otp", handleSuperAdminVerifyOtp);
    server.middlewares.use("/auth/refresh", handleRefresh);
    server.middlewares.use("/auth/logout", handleLogout);
    server.middlewares.use("/auth/logout-all", handleLogoutAll);
    server.middlewares.use("/auth/twilio-status", handleTwilioStatus);
    server.middlewares.use("/api/auth/send-otp", handleSendOtp);
    server.middlewares.use("/api/auth/verify-otp", handleVerifyOtp);
    server.middlewares.use("/api/auth/login-email", handleEmailLogin);
    server.middlewares.use("/api/auth/super-admin/login", handleSuperAdminLogin);
    server.middlewares.use("/api/auth/super-admin/verify-otp", handleSuperAdminVerifyOtp);
    server.middlewares.use("/api/auth/refresh", handleRefresh);
    server.middlewares.use("/api/auth/logout", handleLogout);
    server.middlewares.use("/api/auth/logout-all", handleLogoutAll);
    server.middlewares.use("/api/auth/twilio-status", handleTwilioStatus);
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH || "/";

  return {
    base,
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
    },
    },
    plugins: [
      react(),
      releaseManifestPlugin(env),
      maintenanceSettingsPlugin(env),
      deviceSetupPlugin(env),
      deviceHeartbeatPlugin(env),
      authPlugin(env),
      superAdminPageGuardPlugin(env),
      studentQrPlugin(env),
      scanAttendancePlugin(env),
      partnerAiPlugin(env),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (id.includes("@supabase")) {
              return "vendor-supabase";
            }

            if (id.includes("recharts")) {
              return "vendor-charts";
            }

            if (id.includes("framer-motion")) {
              return "vendor-motion";
            }

            if (
              id.includes("@radix-ui") ||
              id.includes("cmdk") ||
              id.includes("vaul") ||
              id.includes("embla-carousel-react")
            ) {
              return "vendor-ui";
            }

            if (id.includes("react-router") || id.includes("@tanstack/react-query")) {
              return "vendor-routing";
            }

            if (
              id.includes("date-fns") ||
              id.includes("zod") ||
              id.includes("lucide-react") ||
              id.includes("qrcode.react") ||
              id.includes("react-day-picker") ||
              id.includes("react-simple-maps") ||
              id.includes("topojson-client")
            ) {
              return "vendor-utils";
            }

            if (
              id.includes("html5-qrcode") ||
              id.includes("jsqr") ||
              id.includes("jspdf") ||
              id.includes("jszip") ||
              id.includes("html-to-image") ||
              id.includes("browser-image-compression")
            ) {
              return "vendor-heavy";
            }

            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "scheduler"],
    },
  };
});
