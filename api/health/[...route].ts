import { readSafeMaintenanceStatus } from "../../src/lib/maintenanceRuntime.server.js";
import { getCriticalDatabaseHealth, warmCriticalDatabaseHealth } from "../../src/lib/observability/databaseHealth.server.js";

type ApiRequest = {
  method?: string;
  url?: string;
};

type ApiResponse = {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

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
  sendJson(res, 405, { success: false, message: "Method not allowed" }, { Allow: allowedMethod });
};

const readRequestPath = (req: ApiRequest) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const pathname = readRequestPath(req);
    const method = (req.method || "GET").toUpperCase();

    if (method !== "GET") {
      sendMethodNotAllowed(res, "GET");
      return;
    }

    if (pathname === "/api/health/ready" || pathname === "/api/health/ops") {
      const maintenance = await getMaintenanceSafe();
      const databaseHealth = await getCriticalDatabaseHealth(process.env, {
        phase: pathname === "/api/health/ops" ? "api_health_ops" : "api_health_ready",
      });

      sendJson(res, databaseHealth.status === "ok" ? 200 : 503, {
        appEnv: process.env.APP_ENV || process.env.NODE_ENV || "production",
        database: databaseHealth,
        maintenanceMode: maintenance.maintenanceMode,
        nodeVersion: process.version,
        release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || null,
        service: SERVERLESS_SERVICE_NAME,
        status: databaseHealth.status,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
      });
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

    if (pathname === "/api/health" || pathname === "/api/health/live") {
      sendJson(res, 200, {
        appEnv: process.env.APP_ENV || process.env.NODE_ENV || "production",
        release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || null,
        service: SERVERLESS_SERVICE_NAME,
        status: "ok",
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
      });
      return;
    }

    sendJson(res, 404, {
      success: false,
      message: "API route not found",
      path: pathname,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Health handler crash:", message);
    sendJson(res, 503, {
      appEnv: process.env.APP_ENV || process.env.NODE_ENV || "production",
      maintenanceMode: false,
      missing: ["recovery_queue", "payments", "students"],
      missing_entities: ["recovery_queue", "payments", "students"],
      recent_critical_errors: [],
      release: process.env.SENTRY_RELEASE || process.env.RELEASE_SHA || null,
      service: SERVERLESS_SERVICE_NAME,
      source: "emergency-fallback",
      status: "failed",
      system_warnings: [],
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
    });
  }
}
