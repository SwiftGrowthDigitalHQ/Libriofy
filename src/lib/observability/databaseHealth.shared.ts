import type { RecentObservabilitySignal } from "./types.js";

export const CRITICAL_DB_ENTITIES = ["recovery_queue", "payments", "students"] as const;

export type DatabaseHealthStatus = "ok" | "degraded" | "failed";

export type DatabaseSchemaEntityCheck = {
  entity_name: string;
  exists_in_schema: boolean;
  relation_name: string | null;
};

export type AuthRuntimeContractCheck = {
  check_name: string;
  detail: string;
  ok: boolean;
};

export type AuthRuntimeHealthPayload = {
  checked_at: string;
  checks: AuthRuntimeContractCheck[];
  connectivity: "pass" | "fail";
  detail: string | null;
  missing_contracts: string[];
  service: string;
  source: "live" | "cache";
  status: DatabaseHealthStatus;
};

export type DatabaseHealthPayload = {
  auth_runtime_checks?: AuthRuntimeContractCheck[];
  checked_at: string;
  connectivity: "pass" | "fail";
  detail: string | null;
  entities: DatabaseSchemaEntityCheck[];
  missing: string[];
  missing_contracts?: string[];
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

export const resolveMissingDatabaseContracts = (
  health: Pick<DatabaseHealthPayload, "missing_contracts"> | null | undefined,
) => health?.missing_contracts ?? [];
