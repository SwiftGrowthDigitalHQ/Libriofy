import { resolveMaintenanceStatus } from "../src/lib/maintenance.server";

const sendJson = (res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void }, statusCode: number, body: unknown) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.end(JSON.stringify(body));
};

export default async function handler(req: { method?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void }) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const status = await resolveMaintenanceStatus();

  sendJson(res, 200, {
    maintenanceMode: status.maintenanceMode,
    maintenance_mode: status.maintenanceMode,
    source: status.source,
    updatedAt: status.updatedAt,
    updated_at: status.updatedAt,
  });
}

