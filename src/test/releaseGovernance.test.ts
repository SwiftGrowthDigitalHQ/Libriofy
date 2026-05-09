import { describe, expect, it } from "vitest";

import {
  buildReleaseGovernanceSnapshot,
  deriveFeatureFlagRolloutGovernance,
  evaluateFeatureFlagExposure,
  validateReleaseGovernanceSnapshot,
} from "@/lib/superAdmin/releaseGovernance";
import type {
  AdminFeatureFlag,
  AdminLibraryControlRow,
  AdminRuntimeGovernanceState,
  AdminRuntimeVisibility,
} from "@/lib/superAdmin/types";

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

const buildLibrary = (
  overrides: Partial<AdminLibraryControlRow> = {},
): AdminLibraryControlRow => ({
  activeStudents: 120,
  city: "Patna",
  controlReason: null,
  controlStatus: "active",
  controlUntilAt: null,
  enabled: true,
  id: "tenant-1",
  lastActivityAt: "2026-05-09T10:05:00.000Z",
  monthlyRevenue: 15000,
  name: "Tenant 1",
  ownerEmail: "owner@example.com",
  ownerId: "owner-1",
  ownerName: "Owner 1",
  paymentStatus: "paid",
  state: "Bihar",
  subscriptionStatus: "active",
  totalSeats: 150,
  ...overrides,
});

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

  it("models multi-release compatibility across current, canary, rollback, migration, and stale runtime tracks", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      env: {
        APP_ENV: "production",
        RELEASE_QUEUE_WORKER_VERSION: "release-2026-05-07",
        RELEASE_SHA: "release-2026-05-09",
      },
      featureFlags: [
        buildFlag({
          config: {
            rollout: {
              canaryPercentage: 10,
              releaseTargets: ["release-2026-05-10"],
              runtimeTargets: ["queue_worker"],
            },
          },
          rolloutPercentage: 40,
        }),
      ],
      migrationVersions: ["20260508120000", "20260509110000"],
      runtimeGovernance: {
        ...runtimeGovernance,
        maintenanceMode: true,
        queueProcessingEnabled: false,
      },
      runtimeVisibility: {
        ...runtimeVisibility,
        activeWorkers: 0,
        queueLagMs: 0,
      },
      settingsMap: new Map([
        ["release_governance_policy", {
          value: {
            appliedSchemaVersion: "20260508120000",
            compatibility: {
              apiVersion: {
                minimumVersion: "release-2026-05-08",
                targetVersion: "release-2026-05-09",
              },
              queueWorker: {
                minimumVersion: "release-2026-05-09",
                targetVersion: "release-2026-05-09",
              },
              schema: {
                minimumVersion: "20260508120000",
                targetVersion: "20260509110000",
              },
            },
            releaseId: "release-2026-05-09",
            releases: [
              {
                releaseId: "release-2026-05-10",
                role: "canary",
                runtimeTargets: ["queue_worker"],
                runtimeVersion: "release-2026-05-10",
                schemaVersion: "20260509110000",
                supportedRange: {
                  maximumVersion: "release-2026-05-10",
                  minimumVersion: "release-2026-05-09",
                  targetVersion: "release-2026-05-10",
                },
              },
            ],
            rollback: {
              targetReleaseId: "release-2026-05-08",
            },
          },
        }],
      ]),
    });

    expect(snapshot.evolution.activeReleases.map((track) => track.role)).toEqual(
      expect.arrayContaining(["current", "canary", "rollback", "migration_in_progress", "stale_runtime"]),
    );
    expect(snapshot.evolution.staleRuntimeCount).toBe(1);
    expect(snapshot.evolution.activeReleases.find((track) => track.role === "stale_runtime")?.status).toBe("incompatible");
    expect(snapshot.evolution.guardrails.rules.find((rule) => rule.key === "stale_runtime_activation")?.status).toBe("block");
  });

  it("tracks tenant-scoped staged evolution, canary tenant groups, and rollback isolation", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      env: {
        APP_ENV: "production",
        RELEASE_SHA: "release-2026-05-09",
      },
      featureFlags: [
        buildFlag({
          config: {
            rollout: {
              canaryPercentage: 20,
              tenantTargets: ["tenant-1", "tenant-2"],
            },
          },
          key: "regional_rollout",
          rolloutPercentage: 50,
        }),
      ],
      libraries: [
        buildLibrary({
          id: "tenant-1",
          name: "Tenant One",
          state: "Bihar",
        }),
        buildLibrary({
          controlReason: "Regional drain required",
          controlStatus: "suspended",
          id: "tenant-2",
          name: "Tenant Two",
          state: "Jharkhand",
        }),
      ],
      runtimeGovernance,
      runtimeVisibility,
      settingsMap: new Map([
        ["release_governance_policy", {
          value: {
            releaseId: "release-2026-05-09",
            rollback: {
              targetReleaseId: "release-2026-05-08",
            },
            rollout: {
              regionalSequence: ["Bihar", "Jharkhand"],
            },
            tenants: [
              {
                canary: true,
                canaryGroup: "north",
                region: "Bihar",
                releaseId: "release-2026-05-09",
                rollbackIsolated: true,
                rolloutPercentage: 20,
                tenantId: "tenant-1",
                tenantLabel: "Tenant One",
              },
              {
                region: "Jharkhand",
                releaseId: "release-2026-05-09",
                rolloutPercentage: 50,
                tenantId: "tenant-2",
                tenantLabel: "Tenant Two",
              },
            ],
          },
        }],
      ]),
    });

    expect(snapshot.evolution.tenants.activeTenants).toBe(2);
    expect(snapshot.evolution.tenants.canaryTenants).toBe(2);
    expect(snapshot.evolution.tenants.regionalSequence).toEqual(["Bihar", "Jharkhand"]);
    expect(snapshot.evolution.tenants.records.find((tenant) => tenant.tenantId === "tenant-1")?.rollbackIsolated).toBe(true);
    expect(snapshot.evolution.tenants.records.find((tenant) => tenant.tenantId === "tenant-1")?.progressionStatus).toBe("ready_for_promotion");
    expect(snapshot.evolution.tenants.records.find((tenant) => tenant.tenantId === "tenant-1")?.auditLineage).toEqual(
      expect.arrayContaining(["tenant:tenant-1", "region:Bihar", "release:release-2026-05-09"]),
    );
    expect(snapshot.evolution.tenants.records.find((tenant) => tenant.tenantId === "tenant-2")?.healthStatus).toBe("warning");
    expect(snapshot.evolution.tenants.records.find((tenant) => tenant.tenantId === "tenant-2")?.progressionStatus).toBe("progressing");
    expect(snapshot.evolution.tenants.averageReadinessScore).toBeGreaterThan(80);
    expect(snapshot.evolution.tenants.promotionReadyTenants).toBe(1);
  });

  it("recommends rollback and blocks unsafe evolution when canary and stale runtime risks stack", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      env: {
        APP_ENV: "production",
        RELEASE_QUEUE_WORKER_VERSION: "release-2026-05-07",
        RELEASE_SHA: "release-2026-05-09",
      },
      featureFlags: [
        buildFlag({
          config: {
            rollout: {
              canaryPercentage: 25,
              emergencyRollbackReady: false,
              tenantTargets: ["tenant-1"],
            },
          },
          key: "payments_canary",
          rolloutPercentage: 35,
        }),
      ],
      libraries: [
        buildLibrary({
          id: "tenant-1",
          name: "Tenant One",
        }),
      ],
      runtimeGovernance,
      runtimeVisibility: {
        ...runtimeVisibility,
        deadLetterJobs: 4,
        queueLagMs: 9_500,
        redisDegraded: true,
      },
      settingsMap: new Map([
        ["release_governance_policy", {
          value: {
            canary: {
              anomalyThreshold: 2,
            },
            compatibility: {
              queueWorker: {
                minimumVersion: "release-2026-05-09",
                targetVersion: "release-2026-05-09",
              },
            },
            releaseId: "release-2026-05-09",
            rollback: {
              targetReleaseId: "release-2026-05-08",
            },
          },
        }],
      ]),
    });
    const validation = validateReleaseGovernanceSnapshot(snapshot);

    expect(snapshot.evolution.canary.rollbackRecommended).toBe(true);
    expect(snapshot.evolution.forecasting.forecasts.map((forecast) => forecast.type)).toEqual(
      expect.arrayContaining(["stale_runtime_risk", "queue_runtime_incompatibility"]),
    );
    expect(snapshot.evolution.guardrails.rules.find((rule) => rule.key === "stale_runtime_activation")?.status).toBe("block");
    expect(validation.ok).toBe(false);
  });

  it("builds release simulations with dry-run readiness, rollback viability, and blast-radius scoring", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      env: {
        APP_ENV: "production",
        RELEASE_QUEUE_WORKER_VERSION: "release-2026-05-07",
        RELEASE_SHA: "release-2026-05-09",
      },
      featureFlags: [
        buildFlag({
          config: {
            rollout: {
              canaryPercentage: 25,
              tenantTargets: ["tenant-1"],
            },
          },
          key: "tenant_payments",
          rolloutPercentage: 40,
        }),
      ],
      libraries: [
        buildLibrary({
          id: "tenant-1",
          name: "Tenant One",
        }),
      ],
      migrationVersions: ["20260508120000", "20260509110000"],
      runtimeGovernance: {
        ...runtimeGovernance,
        maintenanceMode: true,
        queueProcessingEnabled: false,
      },
      runtimeVisibility: {
        ...runtimeVisibility,
        activeWorkers: 0,
        deadLetterJobs: 3,
        queueLagMs: 8_400,
        redisDegraded: true,
      },
      settingsMap: new Map([
        ["release_governance_policy", {
          value: {
            appliedSchemaVersion: "20260508120000",
            compatibility: {
              queueWorker: {
                minimumVersion: "release-2026-05-09",
                targetVersion: "release-2026-05-09",
              },
              schema: {
                minimumVersion: "20260508120000",
                targetVersion: "20260509110000",
              },
            },
            migration: {
              maintenanceRequired: true,
              queueDrainRequired: true,
            },
            releaseId: "release-2026-05-09",
            rollback: {
              targetReleaseId: "release-2026-05-08",
            },
            tenants: [
              {
                canary: true,
                region: "Bihar",
                releaseId: "release-2026-05-09",
                rollbackIsolated: true,
                rolloutPercentage: 40,
                tenantId: "tenant-1",
                tenantLabel: "Tenant One",
              },
            ],
          },
        }],
      ]),
    });

    expect(snapshot.simulations.map((simulation) => simulation.kind)).toEqual(
      expect.arrayContaining(["deployment", "rollback", "migration", "tenant_rollout"]),
    );
    expect(snapshot.simulations.every((simulation) => simulation.dryRunSupported)).toBe(true);
    expect(snapshot.simulations.find((simulation) => simulation.kind === "deployment")?.readiness).toBe("blocked");
    expect(snapshot.simulations.find((simulation) => simulation.kind === "deployment")?.safetyScore).toBeLessThan(85);
    expect(snapshot.simulations.find((simulation) => simulation.kind === "rollback")?.rollbackViabilityScore).toBeGreaterThan(40);
    expect(snapshot.simulations.find((simulation) => simulation.kind === "tenant_rollout")?.blastRadius.impactedTenants).toBe(1);
  });

  it("expands release forensics with rollout chains, migration conflicts, and stale runtime conflicts", () => {
    const snapshot = buildReleaseGovernanceSnapshot({
      env: {
        APP_ENV: "production",
        RELEASE_QUEUE_WORKER_VERSION: "release-2026-05-07",
        RELEASE_SHA: "release-2026-05-09",
      },
      featureFlags: [
        buildFlag({
          config: {
            rollout: {
              releaseTargets: ["release-2026-05-10"],
              tenantTargets: ["tenant-1"],
            },
          },
          key: "tenant_release",
          rolloutPercentage: 50,
        }),
      ],
      incidents: [
        {
          incidentKey: "incident-compat-1",
          lastSeenAt: "2026-05-09T12:00:00.000Z",
          latestMessage: "Compatibility pressure is rising.",
          severity: "ERROR",
        },
      ],
      libraries: [
        buildLibrary({
          id: "tenant-1",
          name: "Tenant One",
        }),
      ],
      migrationVersions: ["20260508120000", "20260509110000"],
      runtimeGovernance,
      runtimeVisibility,
      settingsMap: new Map([
        ["release_governance_policy", {
          value: {
            compatibility: {
              queueWorker: {
                minimumVersion: "release-2026-05-09",
                targetVersion: "release-2026-05-09",
              },
              schema: {
                minimumVersion: "20260508120000",
                targetVersion: "20260509110000",
              },
            },
            releaseId: "release-2026-05-09",
            rollback: {
              targetReleaseId: "release-2026-05-08",
            },
            tenants: [
              {
                releaseId: "release-2026-05-10",
                rolloutPercentage: 50,
                tenantId: "tenant-1",
                tenantLabel: "Tenant One",
              },
            ],
          },
        }],
      ]),
      traceEvents: [
        {
          actorEmail: null,
          correlationId: "corr-rollback",
          entityId: null,
          id: "trace-rollback",
          incidentKey: null,
          message: "Migration conflict detected during staged rollout.",
          metadata: {},
          occurredAt: "2026-05-09T12:10:00.000Z",
          paymentReference: null,
          queueJobId: null,
          requestId: "req-rollback",
          severity: "WARNING",
          source: "event_log",
          status: "ACTIVE",
          traceId: "trace-rollback",
          type: "RELEASE_COMPATIBILITY_REGRESSION",
        },
      ],
    });

    expect(snapshot.forensics.rolloutChain).toEqual(expect.arrayContaining(["release-2026-05-09", "release-2026-05-10"]));
    expect(snapshot.forensics.rollbackChain).toContain("release-2026-05-08");
    expect(snapshot.forensics.migrationConflicts.some((conflict) => conflict.includes("Migration conflict"))).toBe(true);
    expect(snapshot.forensics.compatibilityRegressions.length).toBeGreaterThan(0);
    expect(snapshot.forensics.releaseIncidentKeys).toContain("incident-compat-1");
    expect(snapshot.forensics.staleRuntimeConflicts.length).toBeGreaterThan(0);
  });
});
