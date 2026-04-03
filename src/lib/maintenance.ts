export const MAINTENANCE_ROUTE = "/maintenance";
export const MAINTENANCE_SETTINGS_KEY = "maintenance_mode";

export type MaintenanceSource = "api" | "database" | "environment" | "fallback";

export type MaintenanceStatus = {
  maintenanceMode: boolean;
  source: MaintenanceSource;
  updatedAt: string | null;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const normalizeBasePath = (basePath: string | undefined): string => {
  const trimmed = normalizeString(basePath);
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

export const parseBooleanSetting = (value: unknown): boolean | null => {
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
    return null;
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

const getObjectString = (value: unknown, key: string): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  const normalized = normalizeString(candidate);
  return normalized ? normalized : null;
};

const getStatusSource = (value: unknown, fallback: MaintenanceSource): MaintenanceSource => {
  const source = getObjectString(value, "source");
  if (source === "api" || source === "database" || source === "environment" || source === "fallback") {
    return source;
  }

  return fallback;
};

export const normalizeMaintenanceStatusPayload = (
  payload: unknown,
  fallbackSource: MaintenanceSource = "api",
): MaintenanceStatus | null => {
  if (Array.isArray(payload)) {
    return normalizeMaintenanceStatusPayload(payload[0], fallbackSource);
  }

  if (!payload || typeof payload !== "object") {
    const simple = parseBooleanSetting(payload);
    if (simple === null) {
      return null;
    }

    return {
      maintenanceMode: simple,
      source: fallbackSource,
      updatedAt: null,
    };
  }

  const record = payload as Record<string, unknown>;
  const statusCandidate =
    record.maintenanceMode ??
    record.maintenance_mode ??
    record.value ??
    record.enabled ??
    record.is_enabled ??
    record.isEnabled ??
    record.setting;

  const maintenanceMode = parseBooleanSetting(statusCandidate);
  if (maintenanceMode === null) {
    return null;
  }

  const updatedAt =
    getObjectString(record, "updatedAt") ??
    getObjectString(record, "updated_at") ??
    getObjectString(record, "lastUpdatedAt") ??
    getObjectString(record, "last_updated_at") ??
    null;

  return {
    maintenanceMode,
    source: getStatusSource(record, fallbackSource),
    updatedAt,
  };
};

export const getCurrentRoutePath = ({
  basePath,
  isHashRouter,
  location,
}: {
  basePath: string;
  isHashRouter: boolean;
  location: Pick<Location, "pathname" | "hash">;
}): string => {
  if (isHashRouter) {
    const hashPath = location.hash.replace(/^#/, "");
    if (!hashPath) {
      return "/";
    }

    const normalizedHash = hashPath.split("?")[0] || "/";
    return normalizedHash.startsWith("/") ? normalizedHash : `/${normalizedHash}`;
  }

  const normalizedBase = normalizeBasePath(basePath);
  const pathname = location.pathname || "/";

  if (normalizedBase === "/") {
    return pathname;
  }

  if (pathname === normalizedBase) {
    return "/";
  }

  if (pathname.startsWith(`${normalizedBase}/`)) {
    const stripped = pathname.slice(normalizedBase.length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }

  return pathname;
};

export const buildMaintenanceHref = ({
  basePath,
  isHashRouter,
  location,
}: {
  basePath: string;
  isHashRouter: boolean;
  location: Pick<Location, "pathname" | "search">;
}): string => {
  if (isHashRouter) {
    return `${location.pathname}${location.search}#${MAINTENANCE_ROUTE}`;
  }

  const normalizedBase = normalizeBasePath(basePath);
  if (normalizedBase === "/") {
    return `${MAINTENANCE_ROUTE}${location.search}`;
  }

  return `${normalizedBase}${MAINTENANCE_ROUTE}${location.search}`;
};

