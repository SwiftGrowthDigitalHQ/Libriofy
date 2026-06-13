import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../integrations/supabase/types.js";
import { withRequestTraceMetadata } from "./requestContext.server.js";
import { sanitizeObservabilityMetadata } from "./logSanitizer.js";
import { createInstrumentedServerSupabaseFetch } from "./serverSupabaseFetch.server.js";
import { SUPABASE_OBSERVABILITY_SKIP_HEADER, SUPABASE_OBSERVABILITY_SKIP_VALUE } from "./supabaseRequestDetails.js";
import { resolveSupabaseAdminConfig } from "./supabaseAdminConfig.server.js";
import type { AlertSeverity, EventLogInput, EventLogStatus, ObservabilityMetadata, RecentObservabilitySignal } from "./types.js";
import {
  resolveEventClassification,
  resolveFingerprint,
  resolveGroupKey,
  resolveMetricKey,
  resolveOccurredAt,
  resolveSeverity,
} from "./eventModel.js";

type EnvLike = Record<string, string | undefined>;

type AppEventLogRow = Database["public"]["Tables"]["app_event_logs"]["Row"];
type AppEventLogInsert = Database["public"]["Tables"]["app_event_logs"]["Insert"];
type AppEventLogInsertRecord = AppEventLogInsert & {
  classification?: string | null;
  fingerprint?: string | null;
  group_key?: string | null;
  metric_key?: string | null;
  occurred_at?: string;
  occurrence_count?: number;
  severity?: AlertSeverity;
};
type AppEventLogDuplicateRow = {
  created_at?: string | null;
  fingerprint?: string | null;
  group_key?: string | null;
  id?: string | null;
  message?: string | null;
  metric_key?: string | null;
  occurrence_count?: number | null;
  resolved_at?: string | null;
  status?: string | null;
};

const ALERT_SEVERITIES = new Set<AlertSeverity>(["INFO", "WARNING", "ERROR", "CRITICAL"]);
const INCIDENT_DEDUP_WINDOW_MS = 5 * 60_000;

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeMetadata = (metadata: unknown) => sanitizeObservabilityMetadata(metadata);

export const createObservabilityServiceClient = (env: EnvLike = process.env) => {
  const adminConfig = resolveSupabaseAdminConfig(env);
  if (!adminConfig.ok) {
    return null;
  }

  return createClient<Database>(adminConfig.config.supabaseUrl, adminConfig.config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("observability_service"),
      headers: {
        [SUPABASE_OBSERVABILITY_SKIP_HEADER]: SUPABASE_OBSERVABILITY_SKIP_VALUE,
      },
    },
  });
};

export const buildAppEventLogInsert = (input: EventLogInput): AppEventLogInsertRecord => {
  const metadata = withRequestTraceMetadata(normalizeMetadata(input.metadata)) as ObservabilityMetadata;
  const classification = resolveEventClassification({
    classification: input.classification,
    metadata,
    status: input.status,
    type: input.type,
  });
  const metricKey = resolveMetricKey({
    classification: classification ?? input.classification ?? null,
    metadata,
    metricKey: input.metricKey,
    status: input.status,
    type: input.type,
  });
  const groupKey = resolveGroupKey({
    classification: classification ?? input.classification ?? null,
    groupKey: input.groupKey,
    metadata,
    metricKey,
    status: input.status,
    type: input.type,
  });
  const fingerprint = resolveFingerprint({
    classification: classification ?? input.classification ?? null,
    fingerprint: input.fingerprint,
    groupKey,
    metadata,
    metricKey,
    status: input.status,
    type: input.type,
  });
  const severity = resolveSeverity({
    classification: classification ?? input.classification ?? null,
    metadata,
    severity: input.severity,
    status: input.status,
    type: input.type,
  });

  return {
    classification,
    entity_id: normalizeText(input.entityId) || null,
    event_type: normalizeText(input.type) || "UNKNOWN_EVENT",
    fingerprint,
    group_key: groupKey,
    message: normalizeText(input.message) || null,
    metadata: metadata as unknown as AppEventLogInsertRecord["metadata"],
    metric_key: metricKey,
    occurred_at: resolveOccurredAt(input.occurredAt ?? metadata.occurred_at ?? metadata.timestamp) ?? new Date().toISOString(),
    occurrence_count: 1,
    severity: ALERT_SEVERITIES.has(severity) ? severity : "INFO",
    status: input.status,
    user_identifier: normalizeText(input.user) || null,
  };
};

const shouldDeduplicateEvent = (input: AppEventLogInsertRecord) =>
  input.status === "FAILED" || input.severity === "ERROR" || input.severity === "CRITICAL";

const updateMatchingIncidents = async (
  client: ReturnType<typeof createObservabilityServiceClient>,
  row: AppEventLogInsertRecord,
) => {
  if (!client || row.status !== "SUCCESS") {
    return;
  }

  let query = client
    .from("app_event_logs")
    .update({
      resolved_at: row.occurred_at ?? new Date().toISOString(),
      resolution_note: `Auto-resolved after ${row.event_type}.`,
    } as never)
    .eq("status", "FAILED")
    .is("resolved_at", null);

  if (row.fingerprint) {
    query = query.eq("fingerprint", row.fingerprint);
  } else if (row.group_key) {
    query = query.eq("group_key", row.group_key);
  } else if (row.metric_key) {
    query = query.eq("metric_key", row.metric_key);
  } else {
    query = query.eq("event_type", row.event_type);
  }

  await query;
};

const findDuplicateEvent = async (
  client: ReturnType<typeof createObservabilityServiceClient>,
  row: AppEventLogInsertRecord,
) => {
  if (!client || !shouldDeduplicateEvent(row)) {
    return null;
  }

  let query = client
    .from("app_event_logs")
    .select("id, occurrence_count, status, resolved_at, created_at, message, fingerprint, group_key, metric_key")
    .eq("status", row.status)
    .gte("created_at", new Date(Date.now() - INCIDENT_DEDUP_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (row.fingerprint) {
    query = query.eq("fingerprint", row.fingerprint);
  } else if (row.group_key) {
    query = query.eq("group_key", row.group_key);
  } else if (row.metric_key) {
    query = query.eq("metric_key", row.metric_key);
  } else {
    query = query.eq("event_type", row.event_type);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }

  return (data as AppEventLogDuplicateRow | null) ?? null;
};

export const insertAppEventLog = async (input: EventLogInput, env: EnvLike = process.env) => {
  const client = createObservabilityServiceClient(env);
  if (!client) {
    return false;
  }

  const row = buildAppEventLogInsert(input);
  const duplicate = await findDuplicateEvent(client, row);

  if (duplicate?.id && !normalizeText(duplicate.resolved_at)) {
    const { error: updateError } = await client
      .from("app_event_logs")
      .update({
        fingerprint: row.fingerprint,
        group_key: row.group_key,
        message: row.message,
        metadata: row.metadata,
        metric_key: row.metric_key,
        occurred_at: row.occurred_at,
        occurrence_count: Math.max(1, Number(duplicate.occurrence_count ?? 1) + 1),
        severity: row.severity,
      } as never)
      .eq("id", duplicate.id);

    if (updateError) {
      throw updateError;
    }

    return true;
  }

  const { error } = await client.from("app_event_logs").insert(row as never);
  if (error) {
    throw error;
  }

  await updateMatchingIncidents(client, row);

  return true;
};

const toRecentSignal = (row: AppEventLogRow): RecentObservabilitySignal => {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  return {
    created_at: row.created_at,
    classification: resolveEventClassification({
      classification: null,
      metadata,
      status: row.status as EventLogInput["status"],
      type: row.event_type,
    }),
    entity_id: row.entity_id,
    event_type: row.event_type,
    message: row.message,
    metric_key: normalizeText((row as { metric_key?: unknown }).metric_key) || null,
    severity: resolveSeverity({
      classification: null,
      metadata,
      status: row.status as EventLogInput["status"],
      type: row.event_type,
    }),
    status: row.status as EventLogStatus,
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
