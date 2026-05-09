import { buildRuntimeLivenessReport, buildRuntimeReadinessReport, validateRuntimeConfiguration } from "./runtimeGovernance.server.js";

export { buildRuntimeLivenessReport, buildRuntimeReadinessReport, validateRuntimeConfiguration };

export const buildServerReadiness = async (
  env: NodeJS.ProcessEnv,
  options: {
    hasDist: boolean;
    phase?: string;
    requestId?: string | null;
    service?: string;
    startedAt?: number;
    target?: "express" | "operational_intelligence" | "observability" | "queue_worker" | "serverless";
  },
) =>
  buildRuntimeReadinessReport(env, {
    hasDist: options.hasDist,
    phase: options.phase,
    requestId: options.requestId,
    service: options.service ?? "libriofy-auth-attendance-api",
    startedAt: options.startedAt,
    target: options.target ?? "express",
  });
