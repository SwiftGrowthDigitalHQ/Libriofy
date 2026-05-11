import type { RecentObservabilitySignal } from "./types.js";

export const CRITICAL_DB_ENTITIES = ["recovery_queue", "payments", "students"] as const;

export type DatabaseHealthStatus = "ok" | "degraded" | "failed";

export type AuthRuntimeFailureCategory =
  | "AUTH_GRANT_FAILURE"
  | "AUTH_REDIS_FAILURE"
  | "AUTH_RESEND_FAILURE"
  | "AUTH_RLS_FAILURE"
  | "AUTH_RPC_FAILURE"
  | "AUTH_RUNTIME_FAILURE"
  | "AUTH_SCHEMA_FAILURE";

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
  failing_checks?: AuthRuntimeContractCheck[];
  failure_category?: AuthRuntimeFailureCategory | null;
  missing_contracts: string[];
  service: string;
  source: "live" | "cache";
  status: DatabaseHealthStatus;
};

export type DatabaseHealthPayload = {
  auth_runtime_checks?: AuthRuntimeContractCheck[];
  auth_runtime_failure_category?: AuthRuntimeFailureCategory | null;
  auth_runtime_failing_checks?: AuthRuntimeContractCheck[];
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

const normalizeContractNames = (missingContracts: string[]) =>
  missingContracts
    .map((contract) => contract.trim().toLowerCase())
    .filter(Boolean);

export const classifyAuthRuntimeFailure = (
  detail: string | null | undefined,
  missingContracts: string[],
): AuthRuntimeFailureCategory => {
  const normalizedDetail = String(detail ?? "").trim().toLowerCase();
  const normalizedContracts = normalizeContractNames(missingContracts);

  if (
    normalizedDetail.includes("get_auth_runtime_status") ||
    normalizedDetail.includes("could not find the function") ||
    normalizedDetail.includes("schema cache") ||
    normalizedDetail.includes("pgrst202")
  ) {
    return "AUTH_RPC_FAILURE";
  }

  if (normalizedContracts.some((contract) => contract.startsWith("grant:"))) {
    return "AUTH_GRANT_FAILURE";
  }

  if (normalizedContracts.some((contract) => contract.startsWith("policy:") || contract.startsWith("rls:"))) {
    return "AUTH_RLS_FAILURE";
  }

  if (normalizedContracts.some((contract) => contract.startsWith("function:"))) {
    return "AUTH_RPC_FAILURE";
  }

  if (
    normalizedContracts.some(
      (contract) =>
        contract.startsWith("table:")
        || contract.startsWith("column:")
        || contract.startsWith("column_definition:")
        || contract.startsWith("index:"),
    )
  ) {
    return "AUTH_SCHEMA_FAILURE";
  }

  if (
    normalizedDetail.includes("row level security") ||
    normalizedDetail.includes("new row violates") ||
    normalizedDetail.includes("rls policy")
  ) {
    return "AUTH_RLS_FAILURE";
  }

  if (
    normalizedDetail.includes("permission denied") ||
    normalizedDetail.includes("42501") ||
    normalizedDetail.includes("not authorized")
  ) {
    return "AUTH_GRANT_FAILURE";
  }

  if (
    normalizedDetail.includes("invalid api key") ||
    normalizedDetail.includes("invalid jwt") ||
    normalizedDetail.includes("service role key") ||
    normalizedDetail.includes("status 401") ||
    normalizedDetail.includes("status 403")
  ) {
    return "AUTH_RUNTIME_FAILURE";
  }

  return "AUTH_RUNTIME_FAILURE";
};

export const resolveMissingDatabaseEntities = (
  health: Pick<DatabaseHealthPayload, "missing" | "missing_entities"> | null | undefined,
) => health?.missing ?? health?.missing_entities ?? [];

export const resolveMissingDatabaseContracts = (
  health: Pick<DatabaseHealthPayload, "missing_contracts"> | null | undefined,
) => health?.missing_contracts ?? [];
