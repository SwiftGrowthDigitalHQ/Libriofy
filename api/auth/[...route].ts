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

type EnvLike = Record<string, string | undefined>;

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

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const readHeaderValue = (headers: ApiHeaders | undefined, name: string) => {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

const normalizeApiBase = (rawBase: string | undefined) => {
  const trimmed = normalizeString(rawBase);
  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/\/(?:api\/)?auth\/?$/i, "").replace(/\/+$/, "");
};

const resolveAuthProxyBase = (env: EnvLike) =>
  normalizeApiBase(readEnv(env, "AUTH_API_BASE", "VITE_AUTH_API_BASE", "API_BASE_URL", "VITE_API_BASE_URL"));

const serializeRequestBody = (body: unknown) => {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body);
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if (pathname !== "/api/auth/login-email") {
    sendJson(res, 503, {
      ok: false,
      diagnostic: true,
      pathname,
      method,
      entrypoint: "api/auth/[...route].ts",
    });
    return;
  }

  if (method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed" }, { Allow: "POST" });
    return;
  }

  const authApiBase = resolveAuthProxyBase(process.env);
  if (!authApiBase) {
    sendJson(res, 503, {
      success: false,
      message: "Auth API base is not configured.",
    });
    return;
  }

  const upstream = await fetch(`${authApiBase}/api/auth/login-email`, {
    method: "POST",
    headers: {
      "Content-Type": readHeaderValue(req.headers, "content-type") || "application/json",
      Accept: readHeaderValue(req.headers, "accept") || "application/json",
      ...(readHeaderValue(req.headers, "authorization")
        ? { Authorization: readHeaderValue(req.headers, "authorization") as string }
        : {}),
      ...(readHeaderValue(req.headers, "cookie") ? { Cookie: readHeaderValue(req.headers, "cookie") as string } : {}),
      ...(readHeaderValue(req.headers, "user-agent")
        ? { "User-Agent": readHeaderValue(req.headers, "user-agent") as string }
        : {}),
      ...(readHeaderValue(req.headers, "x-device-fingerprint")
        ? { "x-device-fingerprint": readHeaderValue(req.headers, "x-device-fingerprint") as string }
        : {}),
      ...(readHeaderValue(req.headers, "x-device-label")
        ? { "x-device-label": readHeaderValue(req.headers, "x-device-label") as string }
        : {}),
      ...(readHeaderValue(req.headers, "x-forwarded-for")
        ? { "x-forwarded-for": readHeaderValue(req.headers, "x-forwarded-for") as string }
        : {}),
    },
    body: serializeRequestBody(req.body),
  });

  res.statusCode = upstream.status;
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  const setCookieHeaders = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  if (setCookieHeaders.length > 0) {
    res.setHeader("Set-Cookie", setCookieHeaders);
  } else {
    const setCookieHeader = upstream.headers.get("set-cookie");
    if (setCookieHeader) {
      res.setHeader("Set-Cookie", setCookieHeader);
    }
  }

  res.end(await upstream.text());
}
