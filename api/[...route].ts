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

type MaintenanceStatus = {
  maintenanceMode: boolean;
  source: "database" | "environment" | "fallback";
  updatedAt: string | null;
};

const INLINE_BOOT_AT = new Date().toISOString();
const MAINTENANCE_SETTINGS_KEY = "maintenance_mode";

console.log("[api/[...route]] module boot", {
  bootedAt: INLINE_BOOT_AT,
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

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseBooleanSetting = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      parseBooleanSetting(record.value) ??
      parseBooleanSetting(record.maintenanceMode) ??
      parseBooleanSetting(record.maintenance_mode) ??
      parseBooleanSetting(record.enabled) ??
      parseBooleanSetting(record.isEnabled)
    );
  }

  return null;
};

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const getObjectString = (value: unknown, key: string) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const normalized = normalizeString((value as Record<string, unknown>)[key]);
  return normalized || null;
};

const normalizeMaintenanceStatusPayload = (payload: unknown, fallbackSource: MaintenanceStatus["source"]) => {
  if (Array.isArray(payload)) {
    return normalizeMaintenanceStatusPayload(payload[0], fallbackSource);
  }

  if (!payload || typeof payload !== "object") {
    const maintenanceMode = parseBooleanSetting(payload);
    if (maintenanceMode === null) {
      return null;
    }

    return {
      maintenanceMode,
      source: fallbackSource,
      updatedAt: null,
    } satisfies MaintenanceStatus;
  }

  const record = payload as Record<string, unknown>;
  const maintenanceMode = parseBooleanSetting(
    record.maintenanceMode ??
      record.maintenance_mode ??
      record.value ??
      record.enabled ??
      record.is_enabled ??
      record.isEnabled ??
      record.setting,
  );

  if (maintenanceMode === null) {
    return null;
  }

  return {
    maintenanceMode,
    source: fallbackSource,
    updatedAt:
      getObjectString(record, "updatedAt") ??
      getObjectString(record, "updated_at") ??
      getObjectString(record, "lastUpdatedAt") ??
      getObjectString(record, "last_updated_at") ??
      null,
  } satisfies MaintenanceStatus;
};

const readEnvMaintenanceMode = (env: EnvLike): MaintenanceStatus | null => {
  const maintenanceMode = parseBooleanSetting(readEnv(env, "MAINTENANCE_MODE", "VITE_MAINTENANCE_MODE"));
  if (maintenanceMode === null) {
    return null;
  }

  return {
    maintenanceMode,
    source: "environment",
    updatedAt: null,
  };
};

const fetchDatabaseMaintenanceStatus = async (env: EnvLike): Promise<MaintenanceStatus | null> => {
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const supabaseKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const endpoint = new URL("/rest/v1/platform_settings", supabaseUrl);
  endpoint.searchParams.set("select", "key,value,updated_at");
  endpoint.searchParams.set("key", `eq.${MAINTENANCE_SETTINGS_KEY}`);
  endpoint.searchParams.set("limit", "1");

  try {
    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null);
    return normalizeMaintenanceStatusPayload(payload, "database");
  } catch {
    return null;
  }
};

const resolveMaintenanceStatus = async (env: EnvLike = process.env): Promise<MaintenanceStatus> => {
  const envStatus = readEnvMaintenanceMode(env);
  if (envStatus) {
    return envStatus;
  }

  const databaseStatus = await fetchDatabaseMaintenanceStatus(env);
  if (databaseStatus) {
    return databaseStatus;
  }

  return {
    maintenanceMode: false,
    source: "fallback",
    updatedAt: null,
  };
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

const handleLoginEmailProxy = async (req: ApiRequest, res: ApiResponse) => {
  if ((req.method || "").toUpperCase() === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }

  if ((req.method || "").toUpperCase() !== "POST") {
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
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const method = (req.method || "GET").toUpperCase();

  console.log("[api/[...route]] request", {
    method,
    pathname,
    bootedAt: INLINE_BOOT_AT,
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

    const status = await resolveMaintenanceStatus(process.env).catch(() => ({
      maintenanceMode: false,
      source: "fallback" as const,
      updatedAt: null,
    }));

    sendJson(res, 200, {
      maintenanceMode: status.maintenanceMode,
      maintenance_mode: status.maintenanceMode,
      source: status.source,
      updatedAt: status.updatedAt,
      updated_at: status.updatedAt,
    });
    return;
  }

  if (pathname === "/api/auth/login-email") {
    await handleLoginEmailProxy(req, res);
    return;
  }

  sendJson(res, 503, {
    ok: false,
    diagnostic: true,
    pathname,
    method,
    bootedAt: INLINE_BOOT_AT,
    entrypoint: "api/[...route].ts",
  });
}
