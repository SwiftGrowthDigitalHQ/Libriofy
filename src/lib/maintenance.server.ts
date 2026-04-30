import { createClient } from "@supabase/supabase-js";

import { MAINTENANCE_SETTINGS_KEY, parseBooleanSetting, type MaintenanceStatus } from "./maintenance.js";

type EnvLike = Record<string, string | undefined>;
type MaintenanceSettingRow = {
  key: string;
  updated_at: string | null;
  value: unknown;
};

const FALLBACK_MAINTENANCE_STATUS: MaintenanceStatus = {
  maintenanceMode: false,
  source: "fallback",
  updatedAt: null,
};

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

const createSettingsClient = (env: EnvLike) => {
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const supabaseKey = readEnv(
    env,
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  );

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

const normalizeDatabaseMaintenanceStatus = (row: MaintenanceSettingRow | null): MaintenanceStatus | null => {
  if (!row) {
    return null;
  }

  const maintenanceMode = parseBooleanSetting(row.value);
  if (maintenanceMode === null) {
    return null;
  }

  return {
    maintenanceMode,
    source: "database",
    updatedAt: typeof row.updated_at === "string" && row.updated_at.trim() ? row.updated_at : null,
  };
};

const fetchDatabaseMaintenanceStatus = async (env: EnvLike): Promise<MaintenanceStatus | null> => {
  const client = createSettingsClient(env);
  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client
      .from("platform_settings")
      .select("key, value, updated_at")
      .eq("key", MAINTENANCE_SETTINGS_KEY)
      .maybeSingle();

    if (error) {
      return null;
    }

    return normalizeDatabaseMaintenanceStatus((data as MaintenanceSettingRow | null) ?? null);
  } catch {
    return null;
  }
};

export const getMaintenanceSettings = async (env: EnvLike = process.env): Promise<MaintenanceStatus> => {
  const databaseStatus = await fetchDatabaseMaintenanceStatus(env);
  if (databaseStatus) {
    return databaseStatus;
  }

  const envStatus = readEnvMaintenanceMode(env);
  if (envStatus) {
    return envStatus;
  }

  return { ...FALLBACK_MAINTENANCE_STATUS };
};

export const updateMaintenanceSettings = async (
  enabled: boolean,
  env: EnvLike = process.env,
  updatedBy?: string,
): Promise<MaintenanceStatus> => {
  const client = createSettingsClient(env);
  if (!client) {
    throw new Error("Supabase settings configuration is missing.");
  }

  const { data, error } = await client
    .from("platform_settings")
    .upsert(
      {
        key: MAINTENANCE_SETTINGS_KEY,
        value: enabled,
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      },
      { onConflict: "key" },
    )
    .select("key, value, updated_at")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (
    normalizeDatabaseMaintenanceStatus((data as MaintenanceSettingRow | null) ?? null) ?? {
      maintenanceMode: enabled,
      source: "database",
      updatedAt: null,
    }
  );
};

export const resolveMaintenanceStatus = getMaintenanceSettings;

export const getMaintenance = async (env: EnvLike = process.env) => {
  try {
    const status = await getMaintenanceSettings(env);
    return {
      maintenance: status.maintenanceMode,
      maintenanceMode: status.maintenanceMode,
      source: status.source,
      updatedAt: status.updatedAt,
    };
  } catch {
    return {
      maintenance: false,
      maintenanceMode: false,
      source: "fallback" as const,
      updatedAt: null,
    };
  }
};
