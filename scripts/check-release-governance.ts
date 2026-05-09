import { buildReleaseGovernanceSnapshot, validateReleaseGovernanceSnapshot } from "../src/lib/superAdmin/releaseGovernance.js";

const runtimeGovernance = {
  automationInactiveLibraryAlertEnabled: true,
  automationPaymentReminderEnabled: true,
  automationSubscriptionRenewalEnabled: true,
  billingMutationsEnabled: process.env.OPS_BILLING_MUTATIONS_ENABLED !== "false",
  maintenanceMode: process.env.MAINTENANCE_MODE === "true",
  queueProcessingEnabled: process.env.OPS_QUEUE_PROCESSING_ENABLED !== "false",
};

const runtimeVisibility = {
  activeWorkers: 0,
  apiLatencyP95Ms: 0,
  deadLetterJobs: 0,
  emailFailureRate: 0,
  incidentSeverityCounts: {
    critical: 0,
    error: 0,
    info: 0,
    warning: 0,
  },
  otpDeliveryFailures: 0,
  paymentRetryRate: 0,
  queueLagMs: 0,
  queueLatencyP95Ms: 0,
  redisDegraded: process.env.REDIS_DEGRADED === "true",
  retryCount: 0,
  slowRequests: 0,
};

const snapshot = buildReleaseGovernanceSnapshot({
  env: process.env,
  runtimeGovernance,
  runtimeVisibility,
});
const validation = validateReleaseGovernanceSnapshot(snapshot);

console.log(`Release Governance: ${validation.ok ? "PASS" : "FAIL"}`);
console.log(`- release: ${snapshot.lineage.releaseId ?? "missing"}`);
console.log(`- phase: ${snapshot.lineage.phase}`);
console.log(`- health: ${snapshot.health.score} (${snapshot.health.status})`);
console.log(`- schema: ${snapshot.schema.readiness}`);
console.log(`- rollback: ${snapshot.rollback.ready ? "ready" : "blocked"}`);
console.log(`- active releases: ${snapshot.evolution.activeReleases.length}`);
console.log(`- stale runtimes: ${snapshot.evolution.staleRuntimeCount}`);
console.log(`- tenant rollout: ${snapshot.evolution.tenants.activeTenants} active / ${snapshot.evolution.tenants.blockedTenants} blocked`);
console.log(`- tenant scores: compatibility ${snapshot.evolution.tenants.averageCompatibilityScore} / readiness ${snapshot.evolution.tenants.averageReadinessScore}`);
console.log(`- canary: ${snapshot.evolution.canary.lifecycle} (${snapshot.evolution.canary.healthScore})`);
console.log(`- guardrails: ${snapshot.evolution.guardrails.blockedRules} blocked / ${snapshot.evolution.guardrails.warningRules} warning`);
console.log(`- simulations: ${snapshot.simulations.map((simulation) => `${simulation.kind}:${simulation.readiness}`).join(", ") || "none"}`);

if (snapshot.warnings.length > 0) {
  console.log("- warnings:");
  snapshot.warnings.slice(0, 10).forEach((warning) => {
    console.log(`  - ${warning}`);
  });
}

if (!validation.ok) {
  console.error("- blockers:");
  validation.blockers.forEach((blocker) => {
    console.error(`  - ${blocker}`);
  });
  process.exit(1);
}
