type ApiHeaders = Record<string, string | string[] | undefined>;

type ApiRequest = {
  headers?: ApiHeaders;
  method?: string;
  url?: string;
};

type ApiResponse = {
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

const DIAGNOSTIC_BOOT_AT = new Date().toISOString();

console.log("[api/_handler] module boot", {
  bootedAt: DIAGNOSTIC_BOOT_AT,
  nodeVersion: process.version,
});

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

const readRequestPath = (req: ApiRequest) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const pathname = readRequestPath(req);
  const method = (req.method || "GET").toUpperCase();

  console.log("[api/_handler] request", {
    method,
    pathname,
    bootedAt: DIAGNOSTIC_BOOT_AT,
  });

  if (pathname === "/api/settings") {
    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Cache-Control", "no-store");
      res.end();
      return;
    }

    if (method !== "GET") {
      sendJson(res, 405, { ok: false, message: "Method not allowed" }, { Allow: "GET" });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      diagnostic: true,
      pathname,
      method,
      nodeVersion: process.version,
      bootedAt: DIAGNOSTIC_BOOT_AT,
    });
    return;
  }

  sendJson(res, 503, {
    ok: false,
    diagnostic: true,
    message: "Temporary diagnostic handler active",
    pathname,
    method,
    bootedAt: DIAGNOSTIC_BOOT_AT,
  });
}
