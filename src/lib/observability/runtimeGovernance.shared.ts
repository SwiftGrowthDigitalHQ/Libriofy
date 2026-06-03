import type { AuthRuntimeFailureCategory, DatabaseHealthPayload } from "./databaseHealth.shared.js";

export type RuntimeTarget =
  | "express"
  | "serverless"
  | "queue_worker"
  | "operational_intelligence"
  | "observability";

export type RuntimeCheckStatus = "pass" | "warn" | "fail";

export type RuntimeGovernanceStatus = "ok" | "degraded" | "failed";

export type RuntimeCapabilityMode = "native" | "delegated" | "disabled";

export type RuntimeContractName =
  | "auth_session"
  | "observability"
  | "governance"
  | "queue"
  | "operational_intelligence"
  | "feature_flags"
  | "maintenance";

export type ServerHealthCheck = {
  category?: "capability" | "config" | "contract" | "dependency" | "deployment";
  detail?: string;
  name: string;
  requirement?: string;
  status: RuntimeCheckStatus;
};

export type RuntimeCapabilityReport = {
  detail: string;
  mode: RuntimeCapabilityMode;
  name: string;
  status: RuntimeCheckStatus;
};

export type RuntimeAuthIntegrityCheck = {
  code: AuthRuntimeFailureCategory | null;
  detail: string;
  name: string;
  requirement?: string | null;
  status: "fail" | "pass" | "warn";
};

export type RuntimeAuthIntegrityReport = {
  checkedAt: string;
  checks: RuntimeAuthIntegrityCheck[];
  detail: string;
  durationMs: number;
  failedCodes: AuthRuntimeFailureCategory[];
  flow: "auth_refresh" | "startup" | "super_admin_login" | "super_admin_verify";
  primaryCode: AuthRuntimeFailureCategory | null;
  status: "failed" | "ok";
};

export type RuntimeConfigReport = {
  checks: ServerHealthCheck[];
  driftWarnings: string[];
  missing: string[];
  ok: boolean;
  status: RuntimeGovernanceStatus;
};

export type RuntimeContractReport = {
  details: string[];
  name: RuntimeContractName;
  status: RuntimeGovernanceStatus;
  summary: string;
};

export type RuntimeMaintenanceReport = {
  maintenance: boolean;
  maintenanceMode: boolean;
  source: "api" | "database" | "environment" | "fallback";
  updatedAt: string | null;
};

export type RuntimeDeploymentReport = {
  commitSha: string | null;
  configFingerprint: string;
  deploymentId: string | null;
  driftWarnings: string[];
  lineage: string[];
  platform: "express" | "serverless" | "worker" | "node";
  release: string | null;
  runtimeFingerprint: string;
};

export type RuntimeRouteRegistrationDiagnostic = {
  entrypoint: string;
  fileExists: boolean;
  includedInBuild: boolean;
  includedInDeployment: boolean;
  path: string;
};

export type RuntimeSupabaseOpsDiagnostic = {
  hasProjectMismatch: boolean;
  linkedProjectRef: string | null;
  linkedProjectRefSource: string;
  selectedProjectRef: string | null;
  selectedServiceRoleKeyEnvName: string | null;
  selectedSupabaseUrlEnvName: string | null;
  selectionReason: string | null;
  serviceRoleKeyCandidates: Array<{
    envName: string;
    kind: string;
    matchesLinkedProjectRef: boolean;
    projectRef: string | null;
    role: string | null;
  }>;
  supabaseUrlCandidates: Array<{
    envName: string;
    matchesLinkedProjectRef: boolean;
    projectRef: string | null;
  }>;
};

export type RuntimeOpsDiagnostics = {
  activeEnvironmentSource: string;
  deploymentVersion: string | null;
  healthEndpoints: {
    live: string;
    ops: string;
    ready: string;
  };
  linkedSupabaseProjectRef: string | null;
  routes: RuntimeRouteRegistrationDiagnostic[];
  supabase: RuntimeSupabaseOpsDiagnostic;
};

export type RuntimeReadinessReport = {
  appEnv: string;
  authIntegrity: RuntimeAuthIntegrityReport;
  capabilities: RuntimeCapabilityReport[];
  checks: ServerHealthCheck[];
  config: RuntimeConfigReport;
  contracts: RuntimeContractReport[];
  database: DatabaseHealthPayload;
  degraded: {
    active: boolean;
    reasons: string[];
  };
  deployment: RuntimeDeploymentReport;
  maintenance: RuntimeMaintenanceReport;
  nodeVersion: string | null;
  ok: boolean;
  diagnostics: RuntimeOpsDiagnostics;
  requestId?: string | null;
  service: string;
  status: RuntimeGovernanceStatus;
  target: RuntimeTarget;
  timestamp: string;
  uptimeSeconds: number;
};

export type RuntimeLivenessReport = {
  appEnv: string;
  release: string | null;
  service: string;
  status: "ok";
  target: RuntimeTarget;
  timestamp: string;
  uptimeSeconds: number;
};
