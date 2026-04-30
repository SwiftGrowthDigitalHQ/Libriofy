import { supabase } from "@/integrations/supabase/client";
import { MAINTENANCE_SETTINGS_KEY, parseBooleanSetting, normalizeMaintenanceStatusPayload, type MaintenanceStatus } from "@/lib/maintenance";
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
  timeoutMs: _timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  timeoutMs?: number;
} = {}): Promise<MaintenanceStatus> => {
  const databaseStatus = await fetchDatabaseMaintenanceStatus();
  if (databaseStatus) {
    return normalizeMaintenanceStatusPayload(databaseStatus, "database") ?? databaseStatus;
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
