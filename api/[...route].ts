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

const getFallbackMaintenance = (): MaintenanceStatus => ({
  maintenance: false,
  maintenanceMode: false,
  source: "fallback",
  updatedAt: null,
});

const normalizeMaintenanceStatus = (value: unknown): MaintenanceStatus => {
  if (!value || typeof value !== "object") {
    return getFallbackMaintenance();
  }

  const record = value as Record<string, unknown>;
  const maintenance = Boolean(record.maintenance ?? record.maintenanceMode ?? record.maintenance_mode);
  const updatedAt =
    typeof record.updatedAt === "string"
      ? record.updatedAt
      : typeof record.updated_at === "string"
        ? record.updated_at
        : null;

  return {
    maintenance,
    maintenanceMode: maintenance,
    source: typeof record.source === "string" && record.source.trim() ? record.source : "fallback",
    updatedAt,
  };
};

const getMaintenanceSafe = async (): Promise<MaintenanceStatus> => {
  try {
    const maintenanceModule = await import("../src/lib/maintenance.server.js");

    if (typeof maintenanceModule.getMaintenance === "function") {
      return normalizeMaintenanceStatus(await maintenanceModule.getMaintenance());
    }

    if (typeof maintenanceModule.resolveMaintenanceStatus === "function") {
      return normalizeMaintenanceStatus(await maintenanceModule.resolveMaintenanceStatus(process.env));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Maintenance load failed:", message);
  }

  return getFallbackMaintenance();
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

    const status = await getMaintenanceSafe();

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
