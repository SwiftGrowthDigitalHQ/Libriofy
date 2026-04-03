import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const MAINTENANCE_SETTINGS_KEY = "maintenance_mode";

const readEnv = (names: string[]) => {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();
    if (value) {
      return value;
    }
  }

  return "";
};

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
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return parseBooleanSetting(
      record.value ??
        record.maintenanceMode ??
        record.maintenance_mode ??
        record.enabled ??
        record.isEnabled,
    );
  }

  return null;
};

const readMaintenanceModeFromEnv = (): boolean | null => {
  const maintenanceMode = parseBooleanSetting(readEnv(["MAINTENANCE_MODE", "VITE_MAINTENANCE_MODE"]));
  return maintenanceMode;
};

const readMaintenanceModeFromDatabase = async (): Promise<boolean | null> => {
  const supabaseUrl = readEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const supabaseKey = readEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
  ]);

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", MAINTENANCE_SETTINGS_KEY)
      .maybeSingle();

    if (error) {
      return null;
    }

    return parseBooleanSetting(data?.value);
  } catch {
    return null;
  }
};

export const isMaintenanceModeEnabled = async (): Promise<boolean> => {
  const envMode = readMaintenanceModeFromEnv();
  if (envMode !== null) {
    return envMode;
  }

  const databaseMode = await readMaintenanceModeFromDatabase();
  if (databaseMode !== null) {
    return databaseMode;
  }

  return false;
};

export const blockIfMaintenanceMode = async (corsHeaders: HeadersInit) => {
  if (!(await isMaintenanceModeEnabled())) {
    return null;
  }

  return new Response(
    JSON.stringify({
      error: "Maintenance mode active",
      message: "System Update in Progress",
    }),
    {
      status: 503,
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": "3600",
      },
    },
  );
};

