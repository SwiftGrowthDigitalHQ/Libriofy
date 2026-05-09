import { describe, expect, it } from "vitest";

import { buildOperationalIntelligenceSnapshot } from "@/lib/superAdmin/operationalIntelligence";
import type {
  AdminDeadLetterRow,
  AdminIncidentGroup,
  AdminJobQueueRow,
  AdminOperatorGovernanceSnapshot,
  AdminRuntimeGovernanceState,
  AdminRuntimeVisibility,
} from "@/lib/superAdmin/types";

const generatedAt = "2026-05-08T10:20:00.000Z";

const runtimeGovernance: AdminRuntimeGovernanceState = {
  automationInactiveLibraryAlertEnabled: true,
  automationPaymentReminderEnabled: true,
  automationSubscriptionRenewalEnabled: true,
  billingMutationsEnabled: true,
  maintenanceEscalationActive: false,
  maintenanceMode: false,
  notificationDeliveryEnabled: true,
  queueProcessingEnabled: true,
  stripeDependencyEnabled: true,
};

const runtimeVisibility: AdminRuntimeVisibility = {
  activeWorkers: 3,
  apiLatencyP95Ms: 940,
  deadLetterJobs: 1,
  emailFailureRate: 4,
  incidentSeverityCounts: {
    critical: 1,
    error: 0,
    info: 0,
    warning: 0,
  },
  otpDeliveryFailures: 1,
  paymentRetryRate: 12,
  queueLagMs: 90_000,
  queueLatencyP95Ms: 450,
  redisDegraded: false,
  retryCount: 4,
  slowRequests: 0,
};

const buildIncident = (overrides: Partial<AdminIncidentGroup> = {}): AdminIncidentGroup => ({
  acknowledgedAt: null,
  acknowledgedBy: null,
  afterHoursEscalated: false,
  approvalLinkedRequestIds: [],
  backupOwnerEmail: null,
  crossTeamEscalation: false,
  delegatedRemediatorEmail: null,
  escalationLevel: 0,
  eventType: "QUEUE_FAILURE",
  firstSeenAt: "2026-05-08T09:55:00.000Z",
  governanceActionIds: [],
  incidentKey: "incident-1",
  lastSeenAt: "2026-05-08T10:15:00.000Z",
  latestMessage: "Queue backlog detected.",
  latestNote: null,
  linkedCorrelationIds: [],
  linkedJobIds: ["job-1"],
  linkedPaymentReferences: [],
  linkedRequestIds: [],
  linkedTraceIds: [],
  noteCount: 0,
  operationalNotes: [],
  organizationLabel: "North Operations",
  ownerEmail: null,
  ownerUserId: null,
  ownershipTransitions: [],
  regionLabel: "EMEA",
  regionalFailoverEvents: [],
  remediationActions: [],
  retryableJobId: "job-1",
  severity: "CRITICAL",
  severityApprovalRequired: false,
  severityApprovedAt: null,
  severityApprovedBy: null,
  slaBreached: true,
  slaTargetAt: "2026-05-08T10:00:00.000Z",
  teamLabel: "Billing Team",
  tenantId: "tenant-1",
  tenantLabel: "Tenant 1",
  totalOccurrences: 3,
  traceLineage: [],
  unresolvedCount: 2,
  unresolvedOwnership: true,
  ...overrides,
});

const buildJob = (overrides: Partial<AdminJobQueueRow> = {}): AdminJobQueueRow => ({
  attempts: 1,
  cancelRequestedAt: null,
  cancelRequestedBy: null,
  cancellationReason: null,
  cancelledAt: null,
  claimToken: null,
  claimedBy: null,
  concurrencyKey: "billing",
  createdAt: "2026-05-08T09:58:00.000Z",
  deadLetterReason: null,
  deadLetteredAt: null,
  deduplicationKey: "dedupe-1",
  finishedAt: null,
  id: "job-1",
  jobType: "invoice_generation",
  lastError: null,
  lastHeartbeatAt: "2026-05-08T10:02:00.000Z",
  maxAttempts: 3,
  maxConcurrency: 1,
  payload: { invoiceId: "inv-1" },
  recoveredAt: null,
  relatedIncidentKeys: ["incident-1"],
  retryHistory: [],
  scheduledFor: "2026-05-08T09:59:00.000Z",
  startedAt: null,
  status: "queued",
  trace: {
    correlationId: "corr-1",
    originRequestId: "req-1",
    parentRequestId: null,
    requestSource: "super_admin_console",
    route: "/admin/automation",
    traceId: "trace-1",
  },
  traceLineage: [],
  visibilityTimeoutAt: null,
  ...overrides,
});

const buildDeadLetter = (overrides: Partial<AdminDeadLetterRow> = {}): AdminDeadLetterRow => ({
  attempts: 3,
  deadLetteredAt: "2026-05-08T10:05:00.000Z",
  errorMessage: "retry exhausted",
  id: "dead-letter-1",
  jobId: "job-1",
  jobType: "invoice_generation",
  maxAttempts: 3,
  payload: { invoiceId: "inv-1" },
  sourceCorrelationId: "corr-1",
  sourceRequestId: "req-1",
  sourceTraceId: "trace-1",
  traceLineage: [],
  ...overrides,
});

const buildGovernanceSnapshot = (
  overrides: Partial<AdminOperatorGovernanceSnapshot> = {},
): AdminOperatorGovernanceSnapshot =>
  ({
    activeElevations: [],
    analytics: {
      approvalLatencyMinutes: { average: 10, p95: 18 },
      delegationUtilizationRate: 12,
      emergencyOverrideFrequency: 0,
      escalationBottlenecks: 1,
      governanceDriftAlerts: 0,
      operatorWorkload: {
        overloaded: 1,
        totalOperators: 2,
      },
      tenantIsolationViolations: 0,
      unresolvedOwnershipIncidents: 1,
    },
    conflicts: [],
    consistency: {
      approvalVersion: "approval-v1",
      cacheInvalidationKey: "cache-v1",
      consistencyAt: generatedAt,
      generatedAt,
      governanceVersion: "gov-v1",
      grantVersion: "grant-v1",
      recentActionVersion: "audit-v1",
    },
    coordination: {
      escalationLineage: [],
      followTheSun: {
        activeTimezones: ["Europe/London", "Asia/Kolkata"],
        afterHoursEscalations: 0,
        backupRoutings: 1,
        regionalOperators: 2,
        standbyOperators: 1,
      },
      handoffs: [],
      loadBalancing: {
        approvalQueueBalanceScore: 82,
        escalationOverloadDetected: true,
        heatmap: [
          {
            activeIncidents: 1,
            availableOperators: 1,
            key: "region:EMEA",
            label: "EMEA",
            pendingApprovals: 0,
            utilizationPercent: 34,
          },
          {
            activeIncidents: 3,
            availableOperators: 1,
            key: "region:APAC",
            label: "APAC",
            pendingApprovals: 2,
            utilizationPercent: 92,
          },
        ],
        incidentBalanceScore: 61,
        operatorLoads: [
          {
            activeIncidents: 3,
            backupOperator: "backup-apac@libriofy.com",
            capacity: 2,
            delegatedRemediations: 1,
            overloaded: true,
            pendingApprovals: 2,
            principal: "apac-ops@libriofy.com",
            regions: ["APAC"],
            shiftState: "after_hours",
            utilizationPercent: 125,
          },
          {
            activeIncidents: 1,
            backupOperator: "emea-backup@libriofy.com",
            capacity: 4,
            delegatedRemediations: 2,
            overloaded: false,
            pendingApprovals: 0,
            principal: "emea-ops@libriofy.com",
            regions: ["EMEA"],
            shiftState: "active",
            utilizationPercent: 35,
          },
        ],
      },
      ownershipGaps: [
        {
          incidentKey: "incident-1",
          reason: "Incident is unresolved without a clear owner.",
          scopeSummary: ["Tenant 1", "EMEA"],
          severity: "critical",
        },
      ],
      regionalFailovers: [],
    },
    synchronization: {
      driftAlertCount: 0,
      governanceVersion: "gov-v1",
      invalidatedSnapshots: 0,
      propagationHealth: "healthy",
      propagationHealthSummary: "Propagation healthy.",
      staleApprovalCount: 0,
      tenantConsistencyGaps: 0,
    },
    ...overrides,
  }) as unknown as AdminOperatorGovernanceSnapshot;

describe("super admin operational intelligence runtime", () => {
  it("builds predictive routing recommendations that prioritize the healthiest regional responder", () => {
    const snapshot = buildOperationalIntelligenceSnapshot({
      billingOperations: {
        duplicatePayments: 0,
        manualReviewPayments: 0,
        paymentRetryRate: 12,
        stuckPayments: 0,
        verificationRetries: 1,
        webhookRetries: 1,
      },
      deadLetters: [buildDeadLetter()],
      failedLoginCount: 2,
      generatedAt,
      incidents: [buildIncident()],
      jobs: [buildJob()],
      operatorGovernance: buildGovernanceSnapshot(),
      runtimeGovernance,
      runtimeVisibility,
      suspiciousIps: [],
    });

    expect(snapshot.routingRecommendations[0]?.recommendedResponder).toBe("emea-ops@libriofy.com");
    expect(snapshot.routingRecommendations[0]?.recommendedRegion).toBe("EMEA");
    expect(snapshot.predictions.map((prediction) => prediction.type)).toContain("incident_escalation");
  });

  it("detects overload pressure and favors standby-capable follow-the-sun routing", () => {
    const snapshot = buildOperationalIntelligenceSnapshot({
      billingOperations: {
        duplicatePayments: 0,
        manualReviewPayments: 0,
        paymentRetryRate: 10,
        stuckPayments: 0,
        verificationRetries: 1,
        webhookRetries: 1,
      },
      deadLetters: [],
      failedLoginCount: 2,
      generatedAt,
      incidents: [
        buildIncident({
          afterHoursEscalated: true,
          regionLabel: "EMEA",
        }),
      ],
      jobs: [buildJob()],
      operatorGovernance: buildGovernanceSnapshot(),
      runtimeGovernance,
      runtimeVisibility,
      suspiciousIps: [],
    });

    const overloadPrediction = snapshot.predictions.find((prediction) => prediction.type === "operator_overload");
    expect(overloadPrediction?.impactedEntityId).toBe("apac-ops@libriofy.com");
    expect(snapshot.routingRecommendations[0]?.recommendedRoute).toContain("emea-backup@libriofy.com");
    expect(snapshot.recommendations.map((recommendation) => recommendation.kind)).toContain("routing");
  });

  it("builds guarded remediation plans with preview, rollback, audit, and escalation controls", () => {
    const snapshot = buildOperationalIntelligenceSnapshot({
      billingOperations: {
        duplicatePayments: 0,
        manualReviewPayments: 0,
        paymentRetryRate: 12,
        stuckPayments: 0,
        verificationRetries: 1,
        webhookRetries: 1,
      },
      deadLetters: [buildDeadLetter()],
      failedLoginCount: 1,
      generatedAt,
      incidents: [buildIncident({ severity: "WARNING", slaBreached: false, unresolvedOwnership: false })],
      jobs: [
        buildJob({
          lastHeartbeatAt: "2026-05-08T09:58:00.000Z",
          startedAt: "2026-05-08T09:59:00.000Z",
          status: "running",
          visibilityTimeoutAt: "2026-05-08T10:05:00.000Z",
        }),
      ],
      operatorGovernance: buildGovernanceSnapshot(),
      runtimeGovernance,
      runtimeVisibility,
      suspiciousIps: [],
    });

    const replayPlan = snapshot.remediationPlans.find((plan) => plan.kind === "queue_replay");
    const recoveryPlan = snapshot.remediationPlans.find((plan) => plan.kind === "stuck_job_recovery");

    expect(replayPlan?.previewSummary).toContain("Simulate replay ordering");
    expect(replayPlan?.rollbackSummary).toContain("Cancel replayed jobs");
    expect(replayPlan?.auditTrail.length).toBeGreaterThan(0);
    expect(replayPlan?.escalateOnFailure).toBe(true);
    expect(recoveryPlan?.safeToAutoRun).toBe(true);
  });

  it("scores governance reconciliation risk when drift and stale approvals accumulate", () => {
    const snapshot = buildOperationalIntelligenceSnapshot({
      billingOperations: {
        duplicatePayments: 1,
        manualReviewPayments: 2,
        paymentRetryRate: 28,
        stuckPayments: 1,
        verificationRetries: 4,
        webhookRetries: 8,
      },
      deadLetters: [buildDeadLetter()],
      failedLoginCount: 6,
      generatedAt,
      incidents: [buildIncident()],
      jobs: [buildJob()],
      operatorGovernance: buildGovernanceSnapshot({
        analytics: {
          approvalLatencyMinutes: { average: 38, p95: 72 },
          delegationUtilizationRate: 30,
          emergencyOverrideFrequency: 10,
          escalationBottlenecks: 3,
          governanceDriftAlerts: 3,
          operatorWorkload: { overloaded: 2, totalOperators: 2 },
          tenantIsolationViolations: 1,
          unresolvedOwnershipIncidents: 1,
        },
        synchronization: {
          driftAlertCount: 3,
          governanceVersion: "gov-v2",
          invalidatedSnapshots: 2,
          propagationHealth: "critical",
          propagationHealthSummary: "Propagation is degraded and tenant snapshots are stale.",
          staleApprovalCount: 2,
          tenantConsistencyGaps: 1,
        },
      }),
      runtimeGovernance,
      runtimeVisibility: {
        ...runtimeVisibility,
        paymentRetryRate: 28,
        redisDegraded: true,
      },
      suspiciousIps: [{ failures: 4, ip: "10.0.0.1" }],
    });

    const driftHealth = snapshot.governanceHealth.find((score) => score.key === "operational_drift");
    const reconciliationPlan = snapshot.remediationPlans.find(
      (plan) => plan.kind === "governance_drift_reconciliation",
    );

    expect(driftHealth?.status).toBe("critical");
    expect((driftHealth?.score ?? 100) < 45).toBe(true);
    expect(reconciliationPlan?.automationLevel).toBe("manual");
    expect(reconciliationPlan?.safeToAutoRun).toBe(false);
  });

  it("produces failover-ready simulations when regional standby coverage exists", () => {
    const snapshot = buildOperationalIntelligenceSnapshot({
      billingOperations: {
        duplicatePayments: 0,
        manualReviewPayments: 0,
        paymentRetryRate: 10,
        stuckPayments: 0,
        verificationRetries: 1,
        webhookRetries: 1,
      },
      deadLetters: [],
      failedLoginCount: 1,
      generatedAt,
      incidents: [
        buildIncident({
          afterHoursEscalated: true,
          regionalFailoverEvents: [
            {
              actorEmail: "apac-ops@libriofy.com",
              at: "2026-05-08T10:02:00.000Z",
              fromRegion: "APAC",
              note: "Failing over to EMEA standby.",
              toRegion: "EMEA",
            },
          ],
        }),
      ],
      jobs: [buildJob()],
      operatorGovernance: buildGovernanceSnapshot({
        coordination: {
          ...buildGovernanceSnapshot().coordination,
          regionalFailovers: [
            {
              at: "2026-05-08T10:02:00.000Z",
              fromRegion: "APAC",
              incidentKey: "incident-1",
              note: "Failing over to EMEA standby.",
              toRegion: "EMEA",
            },
          ],
        },
      }),
      runtimeGovernance,
      runtimeVisibility,
      suspiciousIps: [],
    });

    const failoverSimulation = snapshot.simulations.find((simulation) => simulation.kind === "failover");
    expect(failoverSimulation?.readiness).toBe("ready");
    expect(failoverSimulation?.summary).toContain("regional failover");
  });

  it("keeps simulation and recommendation outputs deterministic for the same inputs", () => {
    const input = {
      billingOperations: {
        duplicatePayments: 0,
        manualReviewPayments: 1,
        paymentRetryRate: 12,
        stuckPayments: 0,
        verificationRetries: 1,
        webhookRetries: 2,
      },
      deadLetters: [buildDeadLetter()],
      failedLoginCount: 3,
      generatedAt,
      incidents: [buildIncident()],
      jobs: [buildJob()],
      operatorGovernance: buildGovernanceSnapshot(),
      runtimeGovernance,
      runtimeVisibility,
      suspiciousIps: [{ failures: 2, ip: "10.0.0.5" }],
    };

    const left = buildOperationalIntelligenceSnapshot(input);
    const right = buildOperationalIntelligenceSnapshot(input);

    expect(left).toEqual(right);
  });
});
