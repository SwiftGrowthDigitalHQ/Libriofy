import { validateAndBindScannerDevice } from "../src/lib/deviceSetup.server";

const sendJson = (
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void },
  statusCode: number,
  body: unknown,
) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.end(JSON.stringify(body));
};

export default async function handler(
  req: { method?: string; body?: unknown },
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void },
) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { valid: false, message: "Method not allowed" });
    return;
  }

  try {
    const body =
      typeof req.body === "string"
        ? (JSON.parse(req.body) as Record<string, unknown>)
        : typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
    const libraryAccessKey = String(body.library_id ?? body.libraryId ?? "").trim();
    const deviceId = String(body.device_id ?? body.deviceId ?? "").trim();
    const result = await validateAndBindScannerDevice(process.env, libraryAccessKey, deviceId);

    if (!result.valid) {
      sendJson(res, result.code === "DEVICE_SETUP_LOCKED" ? 429 : 404, result);
      return;
    }

    sendJson(res, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected device setup failure";
    sendJson(res, 500, { valid: false, message });
  }
}
