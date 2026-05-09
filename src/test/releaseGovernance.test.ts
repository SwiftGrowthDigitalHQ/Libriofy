import { describe, expect, it } from "vitest";

import {
  buildReleaseGovernanceSnapshot,
  deriveFeatureFlagRolloutGovernance,
  evaluateFeatureFlagExposure,
} from "@/lib/superAdmin/releaseGovernance";
import type { AdminFeatureFlag, AdminRuntimeGovernanceState, AdminRuntimeVisibility } from "@/lib/superAdmin/types";

const runtimeGovernance: AdminRuntimeGovernanceState = {
  automationInactiveLibraryAlertEnabled: true,
  automationPaymentReminderEnabled: true,
  automationSubscriptionRenewalEnabled: true,
  billingMutationsEnabled: true,
  maintenanceMode: false,
  queueProcessingEnabled: true,
};

const runtimeVisibility: AdminRuntimeVisibility = {
  activeWorkers: 2,
  apiLatencyP95Ms: 420,
  deadLetterJobs: 1,
  emailFailureRate: 2,
  incidentSeverityCounts: {
    critical: 0,
    error: 0,
    info: 0,
    warning: 0,
  },
  otpDeliveryFailures: 0,
  paymentRetryRate: 1.5,
  queueLagMs: 2_500,
  queueLatencyP95Ms: 240,
  redisDegraded: false,
  retryCount: 3,
  slowRequests: 0,
};

const buildFlag = (
  overrides: Partial<Omit<AdminFeatureFlag, "rollout">> = {},
): AdminFeatureFlag => {
  const base = {
    cacheTtlSeconds: 60,
    config: {},
    description: "Test flag",
    enabled: true,
    key: "payments",
    name: "Payments",
    rolloutPercentage: 100,
    source: "database" as const,
    updatedAt: "2026-05-09T10:00:00.000Z",
    variants: [],
    ...overrides,
  };

  return {
    ...base,
    rollout: deriveFeatureFlagRolloutGovernance(base),
  };
};

describe("release governance", () => {
  it("derives staged rollout governance from feature-flag config", () => {
    const flag = buildFlag({
      config: {
        rollout: {
          canaryPercentage: 10,
          runtimeTargets: ["serverless"],
          tenantTargets: ["tenant-1"],
        },
      },
      rolloutPercentage: 25,
    });

    expect(flag.rollout.stage).toBe("canary");
    expect(flag.rollout.canaryPercentage).toBe(10);
    expect(flag.rollout.runtimeTargets).toEqual(["serverless"]);
    expect(flag.rollout.tenantTargets).toEqual(["tenant-1"]);
  });

  it("evaluates canary, tenant, and runtime targeting deterministically", () => {
    const flag = buildFlag({
      config: {
        rollout: {
          canaryPercentage: 100,
          runtimeTargets: ["serverless"],
          tenantTargets: ["tenant-1"],
        },
      },
      rolloutPercentage: 100,
    });

    const allowed = evaluateFeatureFlagExposure(flag, {
      releaseId: "release-2026-05-09",
      runtimeTarget: "serverless",
      subjectId: "user-1",
      tenantId: "tenant-1",
    });
    const blocked = evaluateFeatureFlagExposure(flag, {
      runtimeTarget: "queue_worker",
      subjectId: "user-1",
      tenantId: "tenant-2",
    });

    expect(allowed.enabled).toBe(true);
    expect(allowed.matchedTargets).toEqual(expect.arrayContaining(["runtime:serverless", "tenant:tenant-1"]));
    expect(blocked.enabled).toBe(false);
    expect(blocked.reasons[0]).toContain("Runtime target");
  });

  it("blocks schema evolution when the applied schema falls below the minimum compatibility floor", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      env: {
        APP_ENV: "production",
        RELEASE_SHA: "release-2026-05-09",
      },
      migrationVersions: ["20260507143000", "20260508120000"],
      runtimeGovernance,
      runtimeVisibility,
      settingsMap: new Map([
        ["release_governance_policy", {
          value: {
            appliedSchemaVersion: "20260507143000",
            compatibility: {
              schema: {
                minimumVersion: "20260508120000",
                targetVersion: "20260508120000",
              },
            },
            migration: {
              queueDrainRequired: true,
            },
            releaseId: "release-2026-05-09",
            rollback: {
              targetReleaseId: "release-2026-05-08",
            },
          },
        }],
      ]),
    });

    expect(snapshot.schema.readiness).toBe("blocked");
    expect(snapshot.compatibility.find((entry) => entry.contract === "schema")?.status).toBe("incompatible");
    expect(snapshot.rollback.ready).toBe(false);
  });

  it("tracks rollout sequencing and emergency rollback readiness across staged flags", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      env: {
        APP_ENV: "production",
        RELEASE_SHA: "release-2026-05-09",
      },
      featureFlags: [
        buildFlag({
          config: {
            rollout: {
              canaryPercentage: 15,
              emergencyRollbackReady: true,
            },
          },
          key: "payments",
          rolloutPercentage: 30,
        }),
        buildFlag({
          config: {
            rollout: {
              paused: true,
              runtimeTargets: ["queue_worker"],
              emergencyRollbackReady: false,
            },
          },
          key: "notifications",
          rolloutPercentage: 50,
        }),
      ],
      runtimeGovernance,
      runtimeVisibility,
    });

    expect(snapshot.rollouts.canaryFlags).toBe(1);
    expect(snapshot.rollouts.pausedFlags).toBe(1);
    expect(snapshot.rollouts.runtimeTargetedFlags).toBe(1);
    expect(snapshot.rollouts.emergencyRollbackReady).toBe(false);
    expect(snapshot.health.status).toBe("critical");
  });

  it("surfaces runtime contract compatibility warnings and degraded deployment orchestration", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      env: {
        APP_ENV: "production",
        RELEASE_GOVERNANCE_CONTRACT_VERSION: "legacy-contract",
        RELEASE_QUEUE_WORKER_VERSION: "release-2026-05-08",
        RELEASE_SHA: "release-2026-05-09",
      },
      runtimeGovernance: {
        ...runtimeGovernance,
        maintenanceMode: true,
        queueProcessingEnabled: false,
      },
      runtimeVisibility: {
        ...runtimeVisibility,
        activeWorkers: 0,
        queueLagMs: 0,
        redisDegraded: true,
      },
      settingsMap: new Map([
        ["release_governance_policy", {
          value: {
            compatibility: {
              governanceContract: {
                minimumVersion: "2026-05-09-release-governance-v1",
                targetVersion: "2026-05-09-release-governance-v1",
              },
              queueWorker: {
                targetVersion: "release-2026-05-09",
              },
            },
            migration: {
              maintenanceRequired: true,
              queueDrainRequired: true,
            },
            releaseId: "release-2026-05-09",
            rollback: {
              safeDegradationRequired: true,
              targetReleaseId: "release-2026-05-08",
            },
          },
        }],
      ]),
    });

    expect(snapshot.compatibility.find((entry) => entry.contract === "governance_contract")?.status).toBe("incompatible");
    expect(snapshot.compatibility.find((entry) => entry.contract === "queue_worker")?.status).toBe("warning");
    expect(snapshot.orchestration.degradedModeActive).toBe(true);
    expect(snapshot.orchestration.queueDrainReady).toBe(true);
  });

  it("builds release forensics from audit, rollout, and incident signals", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      auditLogs: [
        {
          action: "feature_flag_updated",
          createdAt: "2026-05-09T10:10:00.000Z",
          targetDisplay: "payments",
          targetType: "feature_flag",
        },
        {
          action: "platform_settings_updated",
          createdAt: "2026-05-09T10:15:00.000Z",
          targetDisplay: "release_governance_policy",
          targetType: "platform_setting",
        },
      ],
      env: {
        APP_ENV: "production",
        RELEASE_SHA: "release-2026-05-09",
      },
      incidents: [
        {
          incidentKey: "incident-1",
          lastSeenAt: "2026-05-09T10:20:00.000Z",
          latestMessage: "Release pressure is increasing.",
          severity: "CRITICAL",
        },
      ],
      runtimeGovernance,
      runtimeVisibility,
      settingsMap: new Map([
        ["release_governance_policy", {
          value: {
            releaseId: "release-2026-05-09",
            startedAt: "2026-05-09T10:00:00.000Z",
          },
        }],
      ]),
      traceEvents: [
        {
          actorEmail: null,
          correlationId: "corr-1",
          entityId: null,
          id: "trace-1",
          incidentKey: null,
          message: "Rollback rehearsal completed.",
          metadata: {},
          occurredAt: "2026-05-09T10:25:00.000Z",
          paymentReference: null,
          queueJobId: null,
          requestId: "req-1",
          severity: "WARNING",
          source: "event_log",
          status: "ACTIVE",
          traceId: "trace-1",
          type: "RELEASE_ROLLBACK_REHEARSAL",
        },
      ],
    });

    expect(snapshot.forensics.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["deployment", "incident", "rollback", "rollout"]),
    );
    expect(snapshot.forensics.rollbackChain).toContain("release-2026-05-09");
  });
});
