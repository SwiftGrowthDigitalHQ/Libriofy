import { createClient } from "@supabase/supabase-js";

import type { Database } from "../integrations/supabase/types.js";
import { incrementRuntimeMetric } from "./observability/runtimeMetrics.server.js";
import { resolveSupabaseAdminConfig } from "./observability/supabaseAdminConfig.server.js";
import { createInstrumentedServerSupabaseFetch } from "./observability/serverSupabaseFetch.server.js";

type EnvLike = Record<string, string | undefined>;

type PlatformSettingRow = {
  key: string;
  updated_at: string | null;
  value: unknown;
};

type PlatformSettingRecord = {
  key: string;
  updatedAt: string | null;
  value: unknown;
};

type SettingsCacheEntry = {
  expiresAt: number;
  value: PlatformSettingRecord[];
};

const SETTINGS_CACHE_TTL_MS = 60_000;
const settingsCache = new Map<string, SettingsCacheEntry>();
const inflightRequests = new Map<string, Promise<PlatformSettingRecord[]>>();

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const createPlatformServiceClient = (env: EnvLike = process.env) => {
  const adminConfig = resolveSupabaseAdminConfig(env);
  if (!adminConfig.ok) {
    throw new Error(adminConfig.detail);
  }

  return createClient<Database>(adminConfig.config.supabaseUrl, adminConfig.config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("platform_settings_service"),
    },
  });
};

export const parseSettingBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
    return null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return parseSettingBoolean(record.value ?? record.enabled ?? record.isEnabled ?? record.flag);
  }

  return null;
};

export const parseSettingNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return parseSettingNumber(record.value);
  }

  return null;
};

export const parseSettingStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }

  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      return parseSettingStringArray(parsed);
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return parseSettingStringArray(record.value);
  }

  return [] as string[];
};

export const getPlatformSettings = async (env: EnvLike = process.env, keys?: string[]) => {
  const cacheKey = keys?.length ? [...keys].sort().join("|") : "*";
  const cachedEntry = settingsCache.get(cacheKey);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    incrementRuntimeMetric("cache_operations_total", 1, {
      area: "platform_settings",
      backend: "memory",
      outcome: "hit",
    });
    return cachedEntry.value;
  }

  // Deduplicate concurrent requests for the same cache key
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    incrementRuntimeMetric("cache_operations_total", 1, {
      area: "platform_settings",
      backend: "memory",
      outcome: "deduplicated",
    });
    return inflight;
  }

  incrementRuntimeMetric("cache_operations_total", 1, {
    area: "platform_settings",
    backend: "memory",
    outcome: "miss",
  });

  const fetchPromise = (async () => {
    const client = createPlatformServiceClient(env);

    let query = client
      .from("platform_settings")
      .select("key, value, updated_at")
      .order("key", { ascending: true });

    if (keys?.length) {
      query = query.in("key", keys);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const value = ((data ?? []) as PlatformSettingRow[]).map((row) => ({
      key: row.key,
      updatedAt: typeof row.updated_at === "string" && row.updated_at.trim() ? row.updated_at : null,
      value: row.value,
    }));

    settingsCache.set(cacheKey, {
      expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS,
      value,
    });
    incrementRuntimeMetric("cache_operations_total", 1, {
      area: "platform_settings",
      backend: "memory",
      outcome: "write",
    });

    return value;
  })();

  inflightRequests.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inflightRequests.delete(cacheKey);
  }
};

export const getPlatformSettingsMap = async (env: EnvLike = process.env, keys?: string[]) => {
  const settings = await getPlatformSettings(env, keys);
  return new Map(settings.map((setting) => [setting.key, setting]));
};

export const getPlatformSetting = async (
  env: EnvLike,
  key: string,
  fallbackValue?: unknown,
) => {
  const settingsMap = await getPlatformSettingsMap(env, [key]);
  return settingsMap.get(key)?.value ?? fallbackValue;
};

export const upsertPlatformSetting = async (
  env: EnvLike,
  key: string,
  value: unknown,
  updatedBy?: string | null,
) => {
  const client = createPlatformServiceClient(env);
  const { data, error } = await client
    .from("platform_settings")
    .upsert(
      {
        key,
        value,
        updated_by: normalizeText(updatedBy) || null,
      },
      { onConflict: "key" },
    )
    .select("key, value, updated_at")
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = (data as PlatformSettingRow | null) ?? null;
  settingsCache.clear();
  incrementRuntimeMetric("cache_operations_total", 1, {
    area: "platform_settings",
    backend: "memory",
    outcome: "invalidate",
  });
  return {
    key,
    updatedAt: row?.updated_at ?? null,
    value: row?.value ?? value,
  };
};

export const getSuperAdminIpWhitelistState = async (env: EnvLike = process.env) => {
  const settingsMap = await getPlatformSettingsMap(env, [
    "super_admin_ip_whitelist_enabled",
    "super_admin_ip_whitelist",
  ]);

  return {
    enabled: parseSettingBoolean(settingsMap.get("super_admin_ip_whitelist_enabled")?.value) ?? false,
    whitelist: parseSettingStringArray(settingsMap.get("super_admin_ip_whitelist")?.value),
  };
};

export const isSuperAdminIpAllowed = async (env: EnvLike, ipAddress: string | undefined) => {
  const { enabled, whitelist } = await getSuperAdminIpWhitelistState(env);
  if (!enabled) {
    return true;
  }

  const normalizedIp = normalizeText(ipAddress);
  if (!normalizedIp) {
    return false;
  }

  if (whitelist.includes(normalizedIp)) {
    return true;
  }

  return whitelist.some((candidate) => {
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedCandidate) {
      return false;
    }

    if (normalizedCandidate.endsWith("*")) {
      return normalizedIp.startsWith(normalizedCandidate.slice(0, -1));
    }

    return false;
  });
};
