import type { DatabaseHealthPayload } from "./databaseHealth.shared.js";

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

export type RuntimeReadinessReport = {
  appEnv: string;
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
