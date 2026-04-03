import { resolveStudentQrSigningRequest } from "../src/lib/studentQr.server";

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
  req: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  },
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string) => void },
) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { status: "error", message: "Method not allowed" });
    return;
  }

  try {
    const body =
      typeof req.body === "string"
        ? (JSON.parse(req.body) as Record<string, unknown>)
        : typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};

    const authorizationHeader = req.headers?.authorization;
    const authorization =
      (Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader)?.trim() || "";

    const result = await resolveStudentQrSigningRequest(process.env, body, { authorization });
    sendJson(res, result.statusCode, result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected QR signing failure";
    sendJson(res, 500, { status: "error", message });
  }
}
