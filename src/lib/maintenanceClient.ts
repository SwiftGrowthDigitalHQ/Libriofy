import { supabase } from "@/integrations/supabase/client";
import { MAINTENANCE_SETTINGS_KEY, parseBooleanSetting, normalizeMaintenanceStatusPayload, type MaintenanceStatus } from "@/lib/maintenance";

type ApiStatusPayload = {
  maintenanceMode?: unknown;
  maintenance_mode?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
  source?: unknown;
  value?: unknown;
};

type ApiMaintenanceStatusResult = {
  allowDatabaseFallback: boolean;
  status: MaintenanceStatus | null;
};

const DEFAULT_TIMEOUT_MS = 3500;

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

const fetchApiMaintenanceStatus = async (
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ApiMaintenanceStatusResult> => {
  if (typeof window === "undefined") {
    return {
      allowDatabaseFallback: true,
      status: null,
    };
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(new URL("/api/settings", window.location.origin), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        allowDatabaseFallback: response.status === 404,
        status: null,
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) {
      return {
        allowDatabaseFallback: false,
        status: null,
      };
    }

    const payload = (await response.json().catch(() => null)) as ApiStatusPayload | null;
    return {
      allowDatabaseFallback: true,
      status: normalizeMaintenanceStatusPayload(payload, "api"),
    };
  } catch {
    return {
      allowDatabaseFallback: false,
      status: null,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const fetchDatabaseMaintenanceStatus = async (): Promise<MaintenanceStatus | null> => {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("key, value, updated_at")
    .eq("key", MAINTENANCE_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    return null;
  }

  if (!data) {
    return {
      maintenanceMode: false,
      source: "database",
      updatedAt: null,
    };
  }

  const maintenanceMode = parseBooleanSetting((data as { value?: unknown }).value) ?? false;

  return {
    maintenanceMode,
    source: "database",
    updatedAt: (data as { updated_at?: string | null }).updated_at ?? null,
  };
};

export const loadMaintenanceStatus = async ({
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  timeoutMs?: number;
} = {}): Promise<MaintenanceStatus> => {
  const apiStatus = await fetchApiMaintenanceStatus(timeoutMs);
  if (apiStatus.status) {
    return apiStatus.status;
  }

  if (apiStatus.allowDatabaseFallback) {
    const databaseStatus = await fetchDatabaseMaintenanceStatus();
    if (databaseStatus) {
      return databaseStatus;
    }
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
  const { data, error } = await supabase
    .from("platform_settings")
    .upsert(
      {
        key: MAINTENANCE_SETTINGS_KEY,
        value: enabled,
      },
      { onConflict: "key" },
    )
    .select("key, value, updated_at")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    maintenanceMode: parseBooleanSetting(data?.value) ?? enabled,
    source: "database",
    updatedAt: data?.updated_at ?? null,
  };
};
