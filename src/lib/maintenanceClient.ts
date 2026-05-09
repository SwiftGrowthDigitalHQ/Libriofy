import { normalizeMaintenanceStatusPayload, parseBooleanSetting, type MaintenanceStatus } from "@/lib/maintenance";
const DEFAULT_TIMEOUT_MS = 3500;
const MAINTENANCE_SETTINGS_KEY = "maintenance_mode";

const readApiErrorMessage = (payload: unknown, fallbackMessage: string) => {
  if (!payload || typeof payload !== "object") {
    return fallbackMessage;
  }

  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : fallbackMessage;
};

const readEnvMaintenanceMode = (): MaintenanceStatus | null => {
  const raw = import.meta.env.VITE_MAINTENANCE_MODE;
  const maintenanceMode = parseBooleanSetting(raw);

  if (maintenanceMode === null) {
    return null;
  }

  return {
    maintenanceMode,
    source: "environment",
    updatedAt: null,
  };
};

const fetchApiMaintenanceStatus = async (timeoutMs: number): Promise<MaintenanceStatus | null> => {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timeoutId =
    controller && timeoutMs > 0
      ? window.setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  try {
    const response = await fetch("/api/settings", {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal: controller?.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null);
    return normalizeMaintenanceStatusPayload(payload, "api");
  } catch {
    return null;
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};

export const loadMaintenanceStatus = async ({
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  timeoutMs?: number;
} = {}): Promise<MaintenanceStatus> => {
  const apiStatus = await fetchApiMaintenanceStatus(timeoutMs);
  if (apiStatus) {
    return apiStatus;
  }

  const envStatus = readEnvMaintenanceMode();
  if (envStatus) {
    return envStatus;
  }

  return {
    maintenanceMode: false,
    source: "fallback",
    updatedAt: null,
  };
};

export const setMaintenanceMode = async (enabled: boolean): Promise<MaintenanceStatus> => {
  const response = await fetch("/api/admin/platform", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      settings: {
        [MAINTENANCE_SETTINGS_KEY]: enabled,
      },
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readApiErrorMessage(payload, "Unable to update maintenance mode."));
  }

  const updatedSetting =
    ((payload as {
      data?: {
        settings?: Array<{
          key?: unknown;
          updatedAt?: unknown;
          value?: unknown;
        }>;
      };
    } | null)?.data?.settings ?? []).find((setting) => setting?.key === MAINTENANCE_SETTINGS_KEY) ?? null;

  const normalized = normalizeMaintenanceStatusPayload({
    maintenanceMode: updatedSetting?.value ?? enabled,
    source: "database",
    updatedAt: typeof updatedSetting?.updatedAt === "string" ? updatedSetting.updatedAt : null,
  }, "database");
  if (normalized) {
    return normalized;
  }

  return {
    maintenanceMode:
      parseBooleanSetting(updatedSetting?.value) ??
      parseBooleanSetting((payload as { maintenanceMode?: unknown } | null)?.maintenanceMode) ??
      enabled,
    source: "database",
    updatedAt: null,
  };
};
