import { resolveMaintenanceStatus } from "../../src/lib/maintenance.server";

type ApiRequest = {
  method?: string;
  url?: string;
};

type ApiResponse = {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

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

const readRequestPath = (req: ApiRequest) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const pathname = readRequestPath(req);
  const method = (req.method || "GET").toUpperCase();

  if (method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return;
  }

  if (pathname === "/api/health/ready" || pathname === "/api/health/ops") {
    const maintenance = await resolveMaintenanceStatus(process.env).catch(() => ({
      maintenanceMode: false,
      source: "fallback" as const,
      updatedAt: null,
    }));

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
}
