import type { RecentObservabilitySignal } from "./types.js";

export const CRITICAL_DB_ENTITIES = ["recovery_queue", "payments", "students"] as const;

export type DatabaseHealthStatus = "ok" | "degraded" | "failed";

export type DatabaseSchemaEntityCheck = {
  entity_name: string;
  exists_in_schema: boolean;
  relation_name: string | null;
};

export type DatabaseHealthPayload = {
  checked_at: string;
  connectivity: "pass" | "fail";
  detail: string | null;
  entities: DatabaseSchemaEntityCheck[];
  missing: string[];
  missing_entities: string[];
  recent_critical_errors?: RecentObservabilitySignal[];
  service: string;
  source: "live" | "cache";
  status: DatabaseHealthStatus;
  system_warnings?: RecentObservabilitySignal[];
};

export const resolveMissingDatabaseEntities = (
  health: Pick<DatabaseHealthPayload, "missing" | "missing_entities"> | null | undefined,
) => health?.missing ?? health?.missing_entities ?? [];
