export type {
  RuntimeCapabilityReport,
  RuntimeConfigReport,
  RuntimeContractReport,
  RuntimeDeploymentReport,
  RuntimeGovernanceStatus,
  RuntimeLivenessReport,
  RuntimeMaintenanceReport,
  RuntimeReadinessReport,
  RuntimeTarget,
  ServerHealthCheck,
} from "./runtimeGovernance.shared.js";

export const buildServerReadiness = async (_env: NodeJS.ProcessEnv, _options: { hasDist: boolean }) => {
  throw new Error("buildServerReadiness is server-only. Import '@/lib/observability/serverHealth.server' from server runtimes.");
};
