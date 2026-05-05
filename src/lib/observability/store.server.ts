import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../integrations/supabase/types.js";
import { sanitizeObservabilityMetadata } from "./logSanitizer.js";
import { SUPABASE_OBSERVABILITY_SKIP_HEADER, SUPABASE_OBSERVABILITY_SKIP_VALUE } from "./supabaseRequestDetails.js";
import type { AlertSeverity, EventLogInput, RecentObservabilitySignal } from "./types.js";

type EnvLike = Record<string, string | undefined>;

type AppEventLogRow = Database["public"]["Tables"]["app_event_logs"]["Row"];
type AppEventLogInsert = Database["public"]["Tables"]["app_event_logs"]["Insert"];

const ALERT_SEVERITIES = new Set<AlertSeverity>(["INFO", "WARNING", "ERROR", "CRITICAL"]);

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeMetadata = (metadata: unknown) => sanitizeObservabilityMetadata(metadata);

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return "";
};

const resolveEventSeverity = (
  status: string,
  metadata: Record<string, unknown>,
): AlertSeverity => {
  const rawSeverity = normalizeText(metadata.alert_severity ?? metadata.severity).toUpperCase();
  if (ALERT_SEVERITIES.has(rawSeverity as AlertSeverity)) {
    return rawSeverity as AlertSeverity;
  }

  return status === "FAILED" ? "ERROR" : "INFO";
};

export const createObservabilityServiceClient = (env: EnvLike = process.env) => {
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        [SUPABASE_OBSERVABILITY_SKIP_HEADER]: SUPABASE_OBSERVABILITY_SKIP_VALUE,
      },
    },
  });
};

export const buildAppEventLogInsert = (input: EventLogInput): AppEventLogInsert => ({
  event_type: normalizeText(input.type) || "UNKNOWN_EVENT",
  status: input.status,
  user_identifier: normalizeText(input.user) || null,
  entity_id: normalizeText(input.entityId) || null,
  metadata: normalizeMetadata(input.metadata),
  message: normalizeText(input.message) || null,
});

export const insertAppEventLog = async (input: EventLogInput, env: EnvLike = process.env) => {
  const client = createObservabilityServiceClient(env);
  if (!client) {
    return false;
  }

  const { error } = await client.from("app_event_logs").insert(buildAppEventLogInsert(input));
  if (error) {
    throw error;
  }

  return true;
};

const toRecentSignal = (row: AppEventLogRow): RecentObservabilitySignal => {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  return {
    created_at: row.created_at,
    entity_id: row.entity_id,
    event_type: row.event_type,
    message: row.message,
    severity: resolveEventSeverity(row.status, metadata),
    status: row.status,
    user_identifier: row.user_identifier,
  };
};

export const listRecentObservabilitySignals = async (
  env: EnvLike = process.env,
  limit = 25,
): Promise<{
  recentCriticalErrors: RecentObservabilitySignal[];
  systemWarnings: RecentObservabilitySignal[];
}> => {
  const client = createObservabilityServiceClient(env);
  if (!client) {
    return {
      recentCriticalErrors: [],
      systemWarnings: [],
    };
  }

  const { data, error } = await client
    .from("app_event_logs")
    .select("created_at, entity_id, event_type, message, metadata, status, user_identifier")
    .order("created_at", { ascending: false })
    .limit(Math.max(5, limit));

  if (error) {
    throw error;
  }

  const signals = ((data ?? []) as AppEventLogRow[]).map(toRecentSignal);

  return {
    recentCriticalErrors: signals.filter((signal) => signal.severity === "CRITICAL" || signal.severity === "ERROR").slice(0, 3),
    systemWarnings: signals.filter((signal) => signal.severity === "WARNING").slice(0, 3),
  };
};

const DATABASE_ERROR_PATTERNS = [
  "database",
  "postgres",
  "supabase",
  "schema",
  "relation",
  "column",
  "foreign key",
  "constraint",
  "rpc",
  "rest/v1",
  "connection",
  "timeout",
];

export const isDatabaseCriticalError = (error: unknown, context?: Record<string, unknown>) => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error && "message" in error && typeof error.message === "string"
          ? error.message
          : "";

  const normalized = rawMessage.toLowerCase();
  if (DATABASE_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  const source = normalizeText(context?.source).toLowerCase();
  const path = normalizeText(context?.path).toLowerCase();

  return source.includes("database") || source.includes("supabase") || path.includes("/health/db");
};
