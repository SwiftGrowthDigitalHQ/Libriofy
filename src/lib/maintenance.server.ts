import { MAINTENANCE_SETTINGS_KEY, parseBooleanSetting, normalizeMaintenanceStatusPayload, type MaintenanceStatus } from "./maintenance";

type EnvLike = Record<string, string | undefined>;

const readEnv = (env: EnvLike, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const readEnvMaintenanceMode = (env: EnvLike): MaintenanceStatus | null => {
  const raw = readEnv(env, "MAINTENANCE_MODE", "VITE_MAINTENANCE_MODE");
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
      headers: {
        Accept: "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      method: "GET",
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

export const resolveMaintenanceStatus = async (env: EnvLike = process.env): Promise<MaintenanceStatus> => {
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
