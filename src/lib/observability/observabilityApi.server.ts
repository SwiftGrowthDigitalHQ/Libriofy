import { normalizeParsedRequestBody } from "../httpRequest.server.js";
import { sendAdminAlert } from "./alertService.server.js";
import { logEvent } from "./eventLogger.server.js";
import type { AdminAlertInput, EventLogInput } from "./types.js";

type ApiHeaders = Record<string, string | string[] | undefined>;

type ApiRequest = {
  body?: unknown;
  headers?: ApiHeaders;
  method?: string;
  url?: string;
};

type ApiResponse = {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

const runObservabilitySafely = async <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await operation();
  } catch {
    return fallback;
  }
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

const readHeaderValue = (headers: ApiHeaders | undefined, headerName: string) => {
  const value = headers?.[headerName];
  return Array.isArray(value) ? value[0] : value;
};

const readRequestPath = (req: ApiRequest) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

const readParsedBody = (req: ApiRequest) => normalizeParsedRequestBody(req.body, readHeaderValue(req.headers, "content-type"));

const handleEventRoute = async (req: ApiRequest, res: ApiResponse) => {
  const method = (req.method || "").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return;
  }

  const body = readParsedBody(req);
  if (!body || typeof body !== "object") {
    sendJson(res, 400, { success: false, message: "Invalid event payload." });
    return;
  }

  await runObservabilitySafely(() => logEvent(body as EventLogInput), undefined);

  sendJson(res, 200, { success: true });
};

const handleAlertRoute = async (req: ApiRequest, res: ApiResponse) => {
  const method = (req.method || "").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return;
  }

  const body = readParsedBody(req);
  if (!body || typeof body !== "object") {
    sendJson(res, 400, { success: false, message: "Invalid alert payload." });
    return;
  }

  const result = await runObservabilitySafely(() => sendAdminAlert(body as AdminAlertInput), {
    deduped: false,
    delivered: false,
    via: [] as Array<"email" | "webhook">,
  });

  sendJson(res, 200, {
    success: true,
    ...result,
  });
};

export const handleObservabilityRoute = async (req: ApiRequest, res: ApiResponse) => {
  const pathname = readRequestPath(req);

  switch (pathname) {
    case "/api/observability/events":
      await handleEventRoute(req, res);
      return;
    case "/api/observability/alerts":
      await handleAlertRoute(req, res);
      return;
    default:
      sendJson(res, 404, {
        success: false,
        message: "Observability route not found",
        path: pathname,
      });
  }
};
