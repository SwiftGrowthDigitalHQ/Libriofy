import { readSafeMaintenanceStatus } from "../src/lib/maintenanceRuntime.server.js";

type ApiRequest = {
  method?: string;
  url?: string;
};

type ApiResponse = {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

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

    if (pathname !== "/api/settings") {
      sendJson(res, 404, {
        success: false,
        message: "API route not found",
        path: pathname,
      });
      return;
    }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("Maintenance settings handler fallback used:", message);
    sendJson(res, 200, {
      maintenance: false,
      maintenanceMode: false,
      maintenance_mode: false,
      source: "fallback",
      updatedAt: null,
      updated_at: null,
      error: "safe fallback",
    });
  }
}
