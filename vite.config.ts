import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { resolveMaintenanceStatus } from "./src/lib/maintenance.server";
import { validateAndBindScannerDevice } from "./src/lib/deviceSetup.server";
import { resolveDeviceHeartbeatRequest } from "./src/lib/deviceHeartbeat.server";
import { resolveStudentQrSigningRequest } from "./src/lib/studentQr.server";
import { resolveScanAttendanceRequest } from "./src/lib/scanAttendance.server";

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

const readRequestBody = async (req: { on: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void }) => {
  const chunks: string[] = [];

  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: unknown) => {
      if (typeof chunk === "string") {
        chunks.push(chunk);
        return;
      }

      if (chunk instanceof Uint8Array) {
        chunks.push(new TextDecoder().decode(chunk));
      }
    });

    req.on("end", () => resolve());
    req.on("error", (error: unknown) => reject(error));
  });

  return chunks.join("");
};

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
        const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
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
        const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
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
        const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
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
    server.middlewares.use("/api/scan-attendance", async (req, res, next) => {
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
        const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
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
    });
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
      maintenanceSettingsPlugin(env),
      deviceSetupPlugin(env),
      deviceHeartbeatPlugin(env),
      studentQrPlugin(env),
      scanAttendancePlugin(env),
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

            if (id.includes("react") || id.includes("scheduler")) {
              return "vendor-react";
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

            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
