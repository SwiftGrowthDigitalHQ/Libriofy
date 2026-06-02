import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SuperAdminAnalytics from "@/pages/SuperAdminAnalytics";
import SuperAdminAutomation from "@/pages/SuperAdminAutomation";
import SuperAdminDashboard from "@/pages/SuperAdminDashboard";
import SuperAdminObservability from "@/pages/SuperAdminObservability";
import SuperAdminSettings from "@/pages/SuperAdminSettings";

const mockUseAnalytics = vi.fn();
const mockUseAutomationJobs = vi.fn();
const mockUseAutomationJobMutation = vi.fn();
const mockUseSecurity = vi.fn();
const mockUseSecurityMutation = vi.fn();
const mockUseAdminMutation = vi.fn();
const mockUseControlPlane = vi.fn();
const mockToast = vi.fn();
const mockJobMutateAsync = vi.fn();
const mockPlatformMutateAsync = vi.fn();
const mockSecurityMutateAsync = vi.fn();

const governanceBoundary = {
  delegatedScopeId: null,
  delegatedScopeLabel: null,
  delegatedScopeType: null,
  departmentId: "dept-1",
  departmentLabel: "Billing",
  governanceDomain: "billing" as const,
  operationalGroupId: "ops-1",
  operationalGroupLabel: "Regional Operators",
  organizationId: "org-1",
  organizationLabel: "North Operations",
  regionId: "region-1",
  regionLabel: "APAC",
  teamId: "team-1",
  teamLabel: "Billing Team",
  tenantId: "tenant-1",
  tenantLabel: "Tenant 1",
  visibilityTags: ["tenant:tenant-1", "team:billing"],
};

vi.mock("@/components/dashboard/SuperAdminLayout", () => ({
  default: ({ children }: { children: import("react").ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/hooks/superAdmin", () => ({
  useAdminMutation: (...args: unknown[]) => mockUseAdminMutation(...args),
  useAnalytics: (...args: unknown[]) => mockUseAnalytics(...args),
  useAutomationJobMutation: (...args: unknown[]) => mockUseAutomationJobMutation(...args),
  useAutomationJobs: (...args: unknown[]) => mockUseAutomationJobs(...args),
  useControlPlane: (...args: unknown[]) => mockUseControlPlane(...args),
  useSecurity: (...args: unknown[]) => mockUseSecurity(...args),
  useSecurityMutation: (...args: unknown[]) => mockUseSecurityMutation(...args),
}));

describe("super admin operations pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAnalytics.mockReturnValue({
      data: {
        automation: { failedJobs: 1, inactiveLibraries: [], queuedJobs: 4 },
        billing: { gstRatePercent: 18, invoices: 3, refunds: 1 },
        cityMetrics: [],
        communication: { emailSuccessRate: 96, failedNotifications: 1, queuedNotifications: 0 },
        generatedAt: "2026-05-07T10:00:00.000Z",
        governance: {
          automationInactiveLibraryAlertEnabled: true,
          automationPaymentReminderEnabled: true,
          automationSubscriptionRenewalEnabled: true,
          billingMutationsEnabled: true,
          maintenanceMode: false,
          queueProcessingEnabled: true,
        },
        healthCenter: [],
        incidents: { critical: 1, unresolved: 2 },
        operationalIntelligence: {
          generatedAt: "2026-05-07T10:00:00.000Z",
          governanceHealth: [
            {
              drivers: ["0 tenant isolation violations."],
              key: "tenant_governance_health",
              label: "Tenant governance health",
              score: 88,
              status: "healthy",
              summary: "Measures how safely governance remains segmented and synchronized across tenants.",
            },
          ],
          predictions: [
            {
              confidencePercent: 82,
              evidence: ["Ownership is unresolved.", "SLA target is breached."],
              horizonMinutes: 30,
              id: "incident:incident-key",
              impactedEntityId: "incident-key",
              impactedEntityType: "incident",
              recommendedActions: ["Assign a responder before escalating automation."],
              severity: "high",
              signal: "action",
              summary: "Queue failure is likely to escalate further without proactive routing.",
              title: "Escalation risk for incident-key",
              type: "incident_escalation",
            },
          ],
          recommendations: [
            {
              id: "recommendation:responder:route-1",
              kind: "responder",
              primaryAction: "Route to emea-ops@libriofy.com",
              rationale: ["Regional affinity matches EMEA."],
              severity: "high",
              summary: "Best-fit responder is emea-ops@libriofy.com with safe workload headroom.",
              targetId: "incident-key",
              targetType: "incident",
              title: "Recommended responder",
            },
          ],
          remediationPlans: [
            {
              auditTrail: ["Record replay preview."],
              automationLevel: "guarded_auto",
              escalateOnFailure: true,
              guardrails: ["Require dry-run preview before replaying any dead-letter job."],
              id: "remediation:queue_replay",
              kind: "queue_replay",
              linkedTargets: [{ id: "job-1", kind: "job" }],
              previewSummary: "Simulate replay ordering for 1 dead-letter job before enqueue.",
              rollbackSummary: "Cancel replayed jobs and preserve dead-letter lineage if downstream failures appear.",
              safeToAutoRun: true,
              severity: "medium",
              summary: "1 dead-letter job can be replayed safely only behind preview, audit, and rollback controls.",
              title: "Queue replay remediation",
            },
          ],
          routingRecommendations: [
            {
              confidencePercent: 79,
              dependencyHealthScore: 84,
              id: "route:incident-key",
              incidentKey: "incident-key",
              rationale: ["Regional affinity matches EMEA.", "emea-ops@libriofy.com still has safe headroom."],
              recommendedRegion: "EMEA",
              recommendedResponder: "emea-ops@libriofy.com",
              recommendedRoute: ["apac-owner@libriofy.com", "emea-ops@libriofy.com", "emea-backup@libriofy.com"],
              regionHealthScore: 82,
              responseQualityScore: 78,
              safeAutoAssign: false,
              severity: "high",
              targetId: "incident-key",
              targetType: "incident",
              timezoneScore: 86,
              workloadScore: 74,
            },
          ],
          simulations: [
            {
              estimatedRisk: "medium",
              expectedOutcome: "Validate replay ordering, dependency safety, and duplicate-risk before any dead-letter recovery.",
              guardrails: ["Require previewed replay batches."],
              id: "simulation:replay",
              kind: "replay",
              readiness: "ready",
              summary: "Dry-run queue replay and observe projected pressure on runtime dependencies.",
              title: "Replay simulation",
            },
          ],
        },
        overview: {
          activeStudentsToday: 0,
          conversionRate: 0,
          dailyActiveLibraries: 0,
          revenueByCity: [],
          revenuePreviousMonth: 0,
          revenueThisMonth: 0,
          series: [],
        },
        runtimeVisibility: {
          activeWorkers: 3,
          apiLatencyP95Ms: 820,
          deadLetterJobs: 2,
          emailFailureRate: 4,
          incidentSeverityCounts: { critical: 1, error: 1, info: 0, warning: 0 },
          otpDeliveryFailures: 2,
          paymentRetryRate: 18,
          queueLagMs: 2600,
          queueLatencyP95Ms: 410,
          redisDegraded: false,
          retryCount: 6,
          slowRequests: 1,
        },
        security: { failedLoginAttempts24h: 2, ipWhitelistEnabled: false, suspiciousIps: [], whitelist: [] },
        systemStatus: "yellow",
      },
      refetch: vi.fn(),
    });

    mockUseSecurity.mockReturnValue({
      data: {
        activeSessions: 2,
        alerts: [
          {
            actorEmail: null,
            correlationId: "corr-1",
            entityId: null,
            id: "alert-1",
            incidentKey: "incident-key",
            message: "Queue backlog is elevated.",
            metadata: { queued_jobs: 61 },
            occurredAt: "2026-05-07T10:01:00.000Z",
            paymentReference: null,
            queueJobId: "job-1",
            requestId: "req-1",
            severity: "ERROR",
            source: "event_log",
            status: "ACTIVE",
            traceId: "trace-1",
            type: "QUEUE_BACKLOG_ALERT",
          },
        ],
        auditLogs: [],
        blockedIps: 0,
        cacheMetrics: { hits: 7, invalidations: 1, misses: 2, writes: 3 },
        failedLogins: 2,
        generatedAt: "2026-05-07T10:00:00.000Z",
        ipWhitelistEnabled: false,
        operatorActions: [],
        operatorGovernance: {
          activeElevations: [
            {
              approvalRequestId: "approval-1",
              boundary: governanceBoundary,
              countdownLabel: "25m remaining",
              countdownSeconds: 1500,
              expiresAt: "2026-05-07T10:30:00.000Z",
              grantId: "grant-1",
              historySummary: ["temporary grant", "Approval approval-1"],
              principal: "ops@libriofy.com",
              roleLabel: "Platform Admin",
              scopeLabel: "Library 1",
              sessionBound: false,
            },
          ],
          alerts: [
            {
              alertId: "alert-governance-1",
              category: "approval_bottleneck",
              detail: "A second approver is still needed.",
              detectedAt: "2026-05-07T10:06:00.000Z",
              severity: "medium",
              summary: "Approval workflow bottlenecks are forming.",
            },
          ],
          approvalRequests: [
            {
              actionId: "temporary_access_grant",
              actionLabel: "Temporary access grant",
              authorityScopes: [
                {
                  boundary: governanceBoundary,
                  scopeId: "tenant-1",
                  scopeLabel: "Tenant 1",
                  scopeType: "tenant",
                },
              ],
              approvalChainMode: "quorum",
              approvalStates: [
                {
                  actorEmail: "approver@libriofy.com",
                  actorUserId: "approver-1",
                  at: "2026-05-07T10:04:00.000Z",
                  label: "Primary approver",
                  note: "Reviewed.",
                  optional: false,
                  roleLabel: null,
                  state: "approved",
                  step: 1,
                },
                {
                  actorEmail: null,
                  actorUserId: null,
                  at: null,
                  label: "Quorum approver 2",
                  note: null,
                  optional: false,
                  roleLabel: null,
                  state: "pending",
                  step: 2,
                },
              ],
              approvals: [
                {
                  actorEmail: "approver@libriofy.com",
                  actorUserId: "approver-1",
                  at: "2026-05-07T10:04:00.000Z",
                  decision: "approved",
                  id: "decision-1",
                  note: "Reviewed.",
                },
              ],
              approvedAt: null,
              boundary: governanceBoundary,
              consistencyAt: "2026-05-07T10:00:00.000Z",
              cooldownUntil: null,
              createdAt: "2026-05-07T10:00:00.000Z",
              delegationHistory: [],
              delegatedApprover: "Platform Admin",
              emergencyBypassEligible: true,
              emergencyBypassUsed: false,
              escalationChain: [],
              escalationRule: "Escalate to Platform Admin.",
              escalatedAt: "2026-05-07T10:10:00.000Z",
              executedAt: null,
              expiresAt: "2026-05-07T10:30:00.000Z",
              fallbackApprover: "Billing Director",
              fingerprint: "fp-1",
              governanceVersion: "gov-1",
              id: "approval-1",
              lineageSummary: ["approver@libriofy.com approved at 2026-05-07T10:04:00.000Z"],
              linkedIncidentKey: "incident-key",
              optionalSecondApprover: true,
              organizationScopeSummary: ["Tenant Tenant 1", "Org North Operations", "Team Billing Team", "Domain billing"],
              outOfOfficeDelegate: null,
              partialApprovals: 1,
              previewSummary: "Temporary access for Library 1",
              reason: "Need emergency access for the incident.",
              rejectedAt: null,
              rejectedLineage: [],
              requesterEmail: "requester@libriofy.com",
              requesterUserId: "requester-1",
              requiredApprovals: 2,
              severity: "critical",
              stale: false,
              status: "pending",
              targetDisplay: "ops@libriofy.com - Platform Admin - Library 1",
              targetId: "grant-1",
              targetType: "operator_role_grant",
            },
          ],
          conflicts: [
            {
              actionIds: ["queue_cancel"],
              actors: ["ops-1@libriofy.com", "ops-2@libriofy.com"],
              conflictId: "queue-conflict-1",
              detectedAt: "2026-05-07T10:06:00.000Z",
              grantIds: [],
              kind: "queue_collision",
              lineage: ["Queue cancellation pending", "Run due jobs pending"],
              requestIds: ["approval-queue-1", "approval-queue-2"],
              severity: "high",
              summary: "Multiple governed actions are targeting the queue at the same time.",
              targetDisplay: "job-1",
              targetId: "job-1",
              targetType: "queue_job",
            },
          ],
          consistency: {
            approvalVersion: "approval-v1",
            cacheInvalidationKey: "gov-cache-1",
            consistencyAt: "2026-05-07T10:00:00.000Z",
            generatedAt: "2026-05-07T10:00:00.000Z",
            governanceVersion: "gov-v1",
            grantVersion: "grant-v1",
            recentActionVersion: "audit-v1",
          },
          grants: [
            {
              boundary: governanceBoundary,
              conflictWarnings: [],
              createdAt: "2026-05-07T09:55:00.000Z",
              email: "ops@libriofy.com",
              effectivePermissions: ["access.manage"],
              expiresAt: "2026-05-07T10:30:00.000Z",
              grantId: "grant-1",
              grantMode: "temporary",
              inheritedRoles: ["read_only_ops"],
              reason: "Incident response.",
              restrictions: {},
              revokedAt: null,
              role: "platform_admin",
              roleLabel: "Platform Admin",
              scopeId: "library-1",
              scopeLabel: "Library 1",
              scopeType: "library",
              startsAt: "2026-05-07T09:55:00.000Z",
              status: "active",
              userId: "ops-user-1",
            },
          ],
          directory: {
            activeElevations: [
              {
                approvalRequestId: "approval-1",
                boundary: governanceBoundary,
                countdownLabel: "25m remaining",
                countdownSeconds: 1500,
                expiresAt: "2026-05-07T10:30:00.000Z",
                grantId: "grant-1",
                historySummary: ["temporary grant", "Approval approval-1"],
                principal: "ops@libriofy.com",
                roleLabel: "Platform Admin",
                scopeLabel: "Library 1",
                sessionBound: false,
              },
            ],
            activeOperators: [
              {
                activeElevationCount: 1,
                activeGrantCount: 1,
                boundarySummary: ["Tenant Tenant 1", "Org North Operations", "Team Billing Team"],
                delegatedRoleCount: 0,
                departments: ["Billing"],
                governanceDomains: ["billing"],
                organizations: ["North Operations"],
                operationalGroups: ["Regional Operators"],
                pendingApprovalCount: 1,
                principal: "ops@libriofy.com",
                roles: ["Platform Admin"],
                teams: ["Billing Team"],
                tenantIds: ["Tenant 1"],
              },
            ],
            delegatedRoles: [],
            escalationChains: [],
            pendingApprovals: [
              {
                actionLabel: "Temporary access grant",
                delegatedApprover: "Platform Admin",
                fallbackApprover: "Billing Director",
                requestId: "approval-1",
                requester: "requester@libriofy.com",
                scopeSummary: ["Tenant Tenant 1", "Org North Operations", "Team Billing Team", "Domain billing"],
                status: "pending",
              },
            ],
            teamOwnership: [
              {
                kind: "team",
                key: "team:Billing Team",
                label: "Billing Team",
                principalCount: 1,
                principals: ["ops@libriofy.com"],
                scopeSummary: ["Tenant Tenant 1", "Org North Operations", "Team Billing Team"],
              },
            ],
          },
          forensics: {
            records: [
              {
                actors: ["ops@libriofy.com"],
                category: "delegated_approval",
                occurredAt: "2026-05-07T10:04:00.000Z",
                requestId: "approval-1",
                scopeSummary: ["Tenant Tenant 1", "Org North Operations", "Team Billing Team"],
                summary: "Delegated approval recorded for Temporary access grant.",
                tenantId: "tenant-1",
                trace: ["approver@libriofy.com approved at 2026-05-07T10:04:00.000Z"],
              },
            ],
            summary: {
              crossTeamEscalations: 0,
              delegatedApprovals: 1,
              organizationIncidents: 0,
              scopedImpersonations: 0,
              tenantOverrides: 0,
            },
          },
          migration: {
            fallbackAccessActive: false,
            legacyAssignmentCount: 0,
            needsMigration: false,
            roleGrantCount: 1,
          },
          visibility: {
            activeElevations: 1,
            conflictingActions: 1,
            crossTeamEscalations: 0,
            delegatedApprovals: 1,
            emergencyStates: 0,
            governanceDrift: 0,
            pendingApprovals: 1,
            roleAssignmentHealth: "warning",
            scopedOperators: 1,
            staleApprovalCount: 0,
            tenantIsolations: 1,
          },
        },
        otpFailures: 2,
        recentAccessLogs: [
          {
            activityType: "super_admin_access",
            actorUserId: "user-1",
            createdAt: "2026-05-07T10:02:00.000Z",
            id: "access-1",
            libraryId: null,
            message: "failed login from 198.51.100.10.",
            metadata: { email: "admin@libriofy.com", reason: "otp_invalid" },
            userId: "user-1",
          },
        ],
        runtimeVisibility: {
          activeWorkers: 3,
          apiLatencyP95Ms: 820,
          deadLetterJobs: 2,
          emailFailureRate: 4,
          incidentSeverityCounts: { critical: 1, error: 1, info: 0, warning: 0 },
          otpDeliveryFailures: 2,
          paymentRetryRate: 18,
          queueLagMs: 2600,
          queueLatencyP95Ms: 410,
          redisDegraded: false,
          retryCount: 6,
          slowRequests: 1,
        },
        slowRequests: [
          {
            actorEmail: null,
            correlationId: "corr-1",
            entityId: "/api/admin/jobs",
            id: "slow-1",
            incidentKey: null,
            message: "Admin route /api/admin/jobs completed in 1840ms.",
            metadata: { duration_ms: 1840, route: "/api/admin/jobs" },
            occurredAt: "2026-05-07T10:03:00.000Z",
            paymentReference: null,
            queueJobId: null,
            requestId: "req-slow",
            severity: "WARNING",
            source: "event_log",
            status: "FAILED",
            traceId: "trace-slow",
            type: "ADMIN_ROUTE_SLOW",
          },
        ],
        suspiciousIps: [],
        traceFeed: [
          {
            actorEmail: null,
            correlationId: "corr-1",
            entityId: "job-1",
            id: "trace-1",
            incidentKey: "incident-key",
            message: "Dead-letter replay queued.",
            metadata: { job_id: "job-1" },
            occurredAt: "2026-05-07T10:04:00.000Z",
            paymentReference: null,
            queueJobId: "job-1",
            requestId: "req-trace",
            severity: "INFO",
            source: "audit_log",
            status: "SUCCESS",
            traceId: "trace-1",
            type: "job_replayed_from_dead_letter",
          },
        ],
        whitelist: [],
      },
      refetch: vi.fn(),
    });

    mockUseAutomationJobs.mockReturnValue({
      data: {
        data: {
          deadLetters: [
            {
              attempts: 3,
              deadLetteredAt: "2026-05-07T10:05:00.000Z",
              errorMessage: "worker crashed mid-flight",
              id: "dead-1",
              jobId: "job-1",
              jobType: "invoice_generation",
              maxAttempts: 3,
              payload: { invoiceId: "inv-1" },
              sourceCorrelationId: "corr-1",
              sourceRequestId: "req-1",
              sourceTraceId: "trace-1",
              traceLineage: [],
            },
          ],
          jobs: [
            {
              attempts: 3,
              cancelRequestedAt: null,
              cancelRequestedBy: null,
              cancellationReason: null,
              cancelledAt: null,
              claimToken: "claim-1",
              claimedBy: "worker-1",
              concurrencyKey: "library-1",
              createdAt: "2026-05-07T09:58:00.000Z",
              deadLetterReason: "retry_exhausted",
              deadLetteredAt: "2026-05-07T10:05:00.000Z",
              deduplicationKey: "dedupe-1",
              finishedAt: "2026-05-07T10:05:00.000Z",
              id: "job-1",
              jobType: "invoice_generation",
              lastError: "worker crashed mid-flight",
              lastHeartbeatAt: "2026-05-07T10:04:55.000Z",
              maxAttempts: 3,
              maxConcurrency: 1,
              payload: { invoiceId: "inv-1" },
              recoveredAt: null,
              relatedIncidentKeys: ["incident-key"],
              retryHistory: [{ at: "2026-05-07T10:04:00.000Z", attempt: 3, error: "timeout", metadata: {}, scheduledFor: null, state: "dead_lettered" }],
              scheduledFor: "2026-05-07T09:59:00.000Z",
              startedAt: "2026-05-07T10:00:00.000Z",
              status: "failed",
              trace: {
                correlationId: "corr-1",
                originRequestId: "req-1",
                parentRequestId: null,
                requestSource: "admin",
                route: "/admin/automation",
                traceId: "trace-1",
              },
              traceLineage: [],
              visibilityTimeoutAt: null,
            },
          ],
          settings: {
            automationInactiveLibraryAlertEnabled: true,
            automationPaymentReminderEnabled: true,
            automationSubscriptionRenewalEnabled: true,
            inactiveLibraryDays: 14,
          },
          summary: {
            activeWorkers: 1,
            deadLetterJobs: 1,
            paused: false,
            queueLagMs: 2600,
            queueLatencyP95Ms: 410,
            queuedJobs: 4,
            redisDegraded: false,
            retryCount: 6,
            runningJobs: 1,
          },
        },
        scope: "overview",
      },
      refetch: vi.fn(),
    });

    mockUseAutomationJobMutation.mockReturnValue({
      isPending: false,
      mutateAsync: mockJobMutateAsync,
    });

    mockJobMutateAsync.mockImplementation(async (input: Record<string, unknown>) => {
      if (input.dryRun) {
        return {
          preview: {
            actionId: input.action === "replay_dead_letter" ? "dead_letter_replay" : "queue_cancel",
            confirmationLabel: "CONFIRM ACTION",
            cooldownUntil: null,
            dryRun: true,
            duplicateRisk: "low",
            existingCaptureLineage: [],
            idempotencyKey: null,
            impacts: [],
            requiresReason: true,
            reversible: false,
            retryHistory: [],
            severity: "critical",
            summary: "Preview generated.",
            targetDisplay: "invoice_generation",
            title: "Preview",
            token: "preview-token",
            traceLineage: [],
            warnings: [],
          },
        };
      }

      return {};
    });

    mockUseControlPlane.mockReturnValue({
      data: {
        analytics: {
          activeStudentsToday: 0,
          conversionRate: 0,
          dailyActiveLibraries: 0,
          revenueByCity: [],
          revenuePreviousMonth: 0,
          revenueThisMonth: 0,
          series: [],
        },
        automation: {
          failedJobs: 1,
          inactiveLibraries: [],
          queuedJobs: 4,
        },
        featureFlags: [
          {
            cacheTtlSeconds: 60,
            config: {
              rollout: {
                canaryPercentage: 10,
                runtimeTargets: ["serverless"],
              },
            },
            description: "Controls payment collection.",
            enabled: true,
            key: "payments",
            name: "Payments",
            rollout: {
              canaryPercentage: 10,
              emergencyRollbackReady: true,
              healthStatus: "healthy",
              paused: false,
              releaseTargets: [],
              runtimeTargets: ["serverless"],
              stage: "canary",
              summary: "1 runtime targets | 10% canary",
              tenantTargets: [],
              warnings: [],
            },
            rolloutPercentage: 25,
            source: "database",
            updatedAt: "2026-05-07T10:00:00.000Z",
            variants: [],
          },
        ],
        generatedAt: "2026-05-07T10:00:00.000Z",
        incidents: [],
        libraries: [],
        maintenanceMode: false,
        runtimeGovernance: {
          automationInactiveLibraryAlertEnabled: true,
          automationPaymentReminderEnabled: true,
          automationSubscriptionRenewalEnabled: true,
          billingMutationsEnabled: true,
          maintenanceMode: false,
          queueProcessingEnabled: true,
        },
        releaseGovernance: {
          compatibility: [
            {
              actualVersion: "release-2026-05-09",
              contract: "api_version",
              detail: "API release version is inside the declared compatibility window.",
              expectedVersion: "release-2026-05-09",
              maximumVersion: null,
              minimumVersion: "release-2026-05-09",
              status: "compatible",
            },
            {
              actualVersion: "20260508120000",
              contract: "schema",
              detail: "Applied schema version is inside the declared compatibility window.",
              expectedVersion: "20260508120000",
              maximumVersion: null,
              minimumVersion: "20260507143000",
              status: "compatible",
            },
          ],
          evolution: {
            activeReleases: [
              {
                compatibilityWindow: {
                  maximumRuntimeVersion: null,
                  maximumSchemaVersion: null,
                  minimumRuntimeVersion: "release-2026-05-09",
                  minimumSchemaVersion: "20260507143000",
                },
                healthStatus: "healthy",
                interoperabilityReleaseIds: ["release-2026-05-08"],
                issues: [],
                phase: "rolling",
                releaseId: "release-2026-05-09",
                rollbackReady: true,
                role: "current",
                runtimeTargets: ["api", "queue_worker"],
                runtimeVersion: "release-2026-05-09",
                schemaVersion: "20260508120000",
                stableRuntime: true,
                startedAt: "2026-05-07T10:00:00.000Z",
                status: "compatible",
                summary: "current track is operating inside the declared compatibility window.",
                supportedRange: {
                  maximumVersion: "release-2026-05-09",
                  minimumVersion: "release-2026-05-08",
                  targetVersion: "release-2026-05-09",
                },
              },
            ],
            canary: {
              active: true,
              anomalyCount: 0,
              canaryFlags: 1,
              canaryTenants: 1,
              healthScore: 92,
              healthStatus: "healthy",
              issues: [],
              lifecycle: "progressing",
              progressiveThresholds: [10, 25, 50, 100],
              releaseId: "release-2026-05-09",
              rollbackRecommended: false,
              summary: "Canary is operating inside the configured progression thresholds.",
            },
            forecasting: {
              forecasts: [
                {
                  confidencePercent: 71,
                  evidence: ["queue_lag_ms=2600"],
                  id: "rollout-bottleneck",
                  recommendedActions: ["Resolve queue pressure before advancing rollout."],
                  severity: "medium",
                  summary: "Rollout progression is likely to bottleneck on queue pressure or paused stages.",
                  title: "Rollout bottleneck",
                  type: "rollout_bottleneck",
                },
              ],
              healthStatus: "warning",
            },
            guardrails: {
              blockedRules: 0,
              rules: [
                {
                  detail: "Rollout progression prerequisites are satisfied.",
                  key: "unsafe_rollout_progression",
                  severity: "critical",
                  status: "pass",
                  summary: "Block unsafe rollout progression",
                },
                {
                  detail: "Schema/runtime compatibility is aligned for active contracts.",
                  key: "schema_runtime_mismatch",
                  severity: "critical",
                  status: "warn",
                  summary: "Block schema/runtime mismatch",
                },
              ],
              warningRules: 1,
            },
            healthStatus: "warning",
            staleRuntimeCount: 0,
            tenants: {
              activeTenants: 1,
              averageCompatibilityScore: 96,
              averageReadinessScore: 94,
              blockedTenants: 0,
              canaryTenants: 1,
              healthStatus: "warning",
              issues: ["Tenant sequencing is still being monitored."],
              phasedTenants: 1,
              promotionReadyTenants: 1,
              records: [
                {
                  auditLineage: ["tenant:tenant-1", "release:release-2026-05-09", "progression:ready_for_promotion"],
                  canary: true,
                  canaryGroup: "north",
                  compatibilityScore: 96,
                  compatibilityStatus: "compatible",
                  healthStatus: "healthy",
                  issues: [],
                  lastActivityAt: "2026-05-07T09:55:00.000Z",
                  migrationReadiness: "ready",
                  migrationReadinessReasons: [],
                  progressionStatus: "ready_for_promotion",
                  region: "Bihar",
                  readinessScore: 94,
                  releaseId: "release-2026-05-09",
                  rollbackIsolated: true,
                  rollbackReleaseId: "release-2026-05-08",
                  rolloutPercentage: 25,
                  stage: "canary",
                  summary: "Tenant One is ready for promotion in canary evolution for release-2026-05-09.",
                  tenantId: "tenant-1",
                  tenantLabel: "Tenant One",
                },
              ],
              regionalSequence: ["Bihar"],
            },
          },
          forensics: {
            compatibilityRegressions: [],
            events: [
              {
                detail: "Fingerprint rel-1.",
                occurredAt: "2026-05-07T10:00:00.000Z",
                releaseId: "release-2026-05-09",
                severity: "info",
                summary: "Release release-2026-05-09 entered rolling phase.",
                type: "deployment",
              },
            ],
            incidentCount: 0,
            migrationConflicts: [],
            releaseIncidentKeys: [],
            rollbackChain: ["release-2026-05-09", "release-2026-05-08"],
            rolloutChain: ["release-2026-05-08", "release-2026-05-09"],
            staleRuntimeConflicts: [],
          },
          health: {
            drivers: [],
            score: 91,
            status: "healthy",
            summary: "Release is operating inside the declared compatibility and rollback guardrails.",
          },
          lineage: {
            channel: "production",
            commitSha: "commit-1",
            completedAt: null,
            deploymentId: "deployment-1",
            fingerprint: "fp-release",
            phase: "rolling",
            previousReleaseId: "release-2026-05-08",
            releaseId: "release-2026-05-09",
            rollbackTargetReleaseId: "release-2026-05-08",
            startedAt: "2026-05-07T10:00:00.000Z",
          },
          orchestration: {
            degradedModeActive: false,
            maintenanceReady: true,
            maintenanceRequired: false,
            partialRollbackActive: false,
            phase: "rolling",
            queueDrainReady: true,
            queueDrainRequired: false,
            rolloutPaused: false,
            steps: ["Rollback target is armed and safe if release health regresses."],
          },
          policy: {
            channel: "production",
            phase: "rolling",
            previousReleaseId: "release-2026-05-08",
            releaseId: "release-2026-05-09",
          },
          rollback: {
            blockers: [],
            ready: true,
            safeDegradationActive: false,
            summary: "Rollback can proceed with the recorded release target and current degradation posture.",
            targetReleaseId: "release-2026-05-08",
          },
          rollouts: {
            activeFlagCount: 2,
            canaryFlags: 1,
            emergencyRollbackReady: true,
            healthStatus: "healthy",
            issues: [],
            pausedFlags: 0,
            progressPercentage: 72,
            runtimeTargetedFlags: 1,
            stagedFlags: 2,
            tenantScopedFlags: 1,
          },
          schema: {
            appliedVersion: "20260508120000",
            driftWarnings: [],
            latestLocalVersion: "20260508120000",
            maintenanceRequired: false,
            minimumCompatibleVersion: "20260507143000",
            pendingMigrations: [],
            queueDrainRequired: false,
            readiness: "ready",
            safeWindowActive: true,
            sequencing: ["Runtime and schema are aligned for the current release target."],
            strategy: "expand_contract",
            targetVersion: "20260508120000",
          },
          simulations: [
            {
              blastRadius: {
                impactedReleases: 1,
                impactedRuntimes: 2,
                impactedTenants: 1,
                scope: "tenant",
                summary: "1 tenant(s) | 2 runtime(s) | 1 release track(s)",
              },
              dryRunSupported: true,
              guardrails: ["Monitor rollout thresholds."],
              id: "simulation:deployment",
              kind: "deployment",
              readiness: "ready",
              recommendedActions: ["Promote the next canary wave."],
              rollbackViabilityScore: 90,
              safetyScore: 92,
              summary: "Deployment dry-run is inside the current compatibility and rollout windows.",
              title: "Deployment simulation",
            },
            {
              blastRadius: {
                impactedReleases: 1,
                impactedRuntimes: 2,
                impactedTenants: 1,
                scope: "tenant",
                summary: "1 tenant(s) | 2 runtime(s) | 1 release track(s)",
              },
              dryRunSupported: true,
              guardrails: ["Tenant rollout sequencing is active."],
              id: "simulation:tenant_rollout",
              kind: "tenant_rollout",
              readiness: "caution",
              recommendedActions: ["Promote the next tenant-scoped rollout."],
              rollbackViabilityScore: 88,
              safetyScore: 86,
              summary: "Tenant rollout dry-run can promote the next wave without crossing declared safety gates.",
              title: "Tenant rollout simulation",
            },
          ],
          warnings: [],
        },
        security: {
          failedLoginAttempts24h: 2,
          ipWhitelistEnabled: false,
          suspiciousIps: [],
          whitelist: [],
        },
        statusSignals: [],
        systemStatus: "yellow",
        settings: [
          { key: "maintenance_mode", updatedAt: "2026-05-07T10:00:00.000Z", value: false },
          { key: "inactive_library_days", updatedAt: "2026-05-07T10:00:00.000Z", value: 14 },
          { key: "ops_queue_processing_enabled", updatedAt: "2026-05-07T10:00:00.000Z", value: true },
          { key: "ops_billing_mutations_enabled", updatedAt: "2026-05-07T10:00:00.000Z", value: true },
          { key: "automation_subscription_renewal_enabled", updatedAt: "2026-05-07T10:00:00.000Z", value: true },
          { key: "automation_payment_reminder_enabled", updatedAt: "2026-05-07T10:00:00.000Z", value: true },
          { key: "automation_inactive_library_alert_enabled", updatedAt: "2026-05-07T10:00:00.000Z", value: true },
        ],
      },
    });

    mockUseAdminMutation.mockReturnValue({
      isPending: false,
      mutateAsync: mockPlatformMutateAsync,
    });

    mockPlatformMutateAsync.mockImplementation(async (input: Record<string, unknown>) => {
      if (input.dryRun) {
        return {
          preview: {
            actionId: "governance_toggle",
            confirmationLabel: "APPLY GOVERNANCE CHANGE",
            cooldownUntil: null,
            dryRun: true,
            duplicateRisk: "low",
            existingCaptureLineage: [],
            idempotencyKey: null,
            impacts: [],
            requiresReason: true,
            reversible: true,
            retryHistory: [],
            severity: "high",
            summary: "Preview generated.",
            targetDisplay: "ops_queue_processing_enabled, ops_billing_mutations_enabled",
            title: "Governance toggle",
            token: "platform-preview-token",
            traceLineage: [],
            warnings: [],
          },
        };
      }

      return { settings: [] };
    });

    mockUseSecurityMutation.mockReturnValue({
      isPending: false,
      mutateAsync: mockSecurityMutateAsync,
    });
  });

  it("renders observability runtime cards and opens trace drill-down details", async () => {
    render(<SuperAdminObservability />);

    expect(screen.getByText("Queue lag")).toBeInTheDocument();
    expect(screen.getByText("2,600 ms")).toBeInTheDocument();
    expect(screen.getByText("Tenant rollout simulation")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Drill down" }));

    await waitFor(() => {
      expect(screen.getByText("Trace detail")).toBeInTheDocument();
      expect(screen.getAllByText("QUEUE_BACKLOG_ALERT")).toHaveLength(2);
      expect(screen.getByText("req-1")).toBeInTheDocument();
    });
  });

  it("renders the current dashboard summary cards", () => {
    render(<SuperAdminDashboard />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Platform overview")).toBeInTheDocument();
    expect(screen.getByText("Total Libraries")).toBeInTheDocument();
    expect(screen.getByText("Active Libraries")).toBeInTheDocument();
    expect(screen.getByText("Total Students")).toBeInTheDocument();
    expect(screen.getByText("Monthly Revenue")).toBeInTheDocument();
    expect(screen.getByText("Pending Jobs")).toBeInTheDocument();
    expect(screen.getByText("Platform Status")).toBeInTheDocument();
  });

  it("renders the analytics overview cards in lightweight mode", () => {
    render(<SuperAdminAnalytics />);

    expect(screen.getByText("Operational analytics running in lightweight mode.")).toBeInTheDocument();
    expect(screen.getByText("Daily active libraries")).toBeInTheDocument();
    expect(screen.getByText("Students today")).toBeInTheDocument();
    expect(screen.getByText("Conversion rate")).toBeInTheDocument();
    expect(screen.getByText("System status")).toBeInTheDocument();
    expect(screen.getByText("Revenue by city")).toBeInTheDocument();
    expect(screen.getByText("Health center")).toBeInTheDocument();
    expect(screen.getByText("Communication")).toBeInTheDocument();
    expect(screen.getByText("Billing pulse")).toBeInTheDocument();
    expect(screen.getByText("Security pulse")).toBeInTheDocument();
    expect(screen.getByText("Governance flow")).toBeInTheDocument();
  });

  it("renders the current dashboard status and metrics", () => {
    mockUseControlPlane.mockReturnValue({
      data: {
        analytics: {
          activeStudentsToday: 7,
          conversionRate: 12.5,
          dailyActiveLibraries: 3,
          revenueByCity: [],
          revenuePreviousMonth: 12000,
          revenueThisMonth: 18000,
          series: [],
        },
        automation: {
          failedJobs: 1,
          inactiveLibraries: [],
          queuedJobs: 4,
        },
        featureFlags: [],
        generatedAt: "2026-05-07T10:00:00.000Z",
        incidents: [],
        libraries: [],
        maintenanceMode: false,
        releaseGovernance: null,
        runtimeGovernance: {
          automationInactiveLibraryAlertEnabled: true,
          automationPaymentReminderEnabled: true,
          automationSubscriptionRenewalEnabled: true,
          billingMutationsEnabled: true,
          maintenanceMode: false,
          queueProcessingEnabled: true,
        },
        security: {
          failedLoginAttempts24h: 1,
          ipWhitelistEnabled: false,
          suspiciousIps: [],
          whitelist: [],
        },
        settings: [],
        statusSignals: [
          {
            detail: "Primary region healthy.",
            label: "Storage",
            status: "green",
            value: "Online",
          },
        ],
        systemStatus: "green",
      },
      error: undefined,
      refetch: vi.fn(),
    });

    render(<SuperAdminDashboard />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Platform overview")).toBeInTheDocument();
    expect(screen.getAllByText("Healthy").length).toBeGreaterThan(0);
    expect(screen.getByText("Total Libraries")).toBeInTheDocument();
    expect(screen.getByText("Active Libraries")).toBeInTheDocument();
    expect(screen.getByText("Total Students")).toBeInTheDocument();
    expect(screen.getByText("Pending Jobs")).toBeInTheDocument();
    expect(screen.getByText("Platform Status")).toBeInTheDocument();
  });

  it("shows fallback copy when control-plane analytics are unavailable", () => {
    mockUseControlPlane.mockReturnValue({
      data: undefined,
      error: new Error("Analytics center is temporarily unavailable."),
      refetch: vi.fn(),
    });

    render(<SuperAdminAnalytics />);

    expect(screen.getByText("Analytics aggregation is temporarily degraded")).toBeInTheDocument();
    expect(
      screen.getByText("Revenue analytics will appear here after the first approved transactions land."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Telemetry is reconnecting. Database, queue, deployment, and auth health will populate automatically after the next successful sync."),
    ).toBeInTheDocument();
  });

  it("uses live dashboard counts on the dashboard", () => {
    mockUseControlPlane.mockReturnValue({
      data: {
        analytics: {
          activeStudentsToday: 0,
          activeStudentsYesterday: 11,
          attendanceLibrariesYesterday: 1,
          conversionRate: 12.5,
          dailyActiveLibraries: 0,
          lastAttendanceAt: "2026-05-18T05:41:27.245Z",
          revenueByCity: [],
          revenuePreviousMonth: 12000,
          revenueThisMonth: 18000,
          series: [],
        },
        automation: {
          failedJobs: 0,
          inactiveLibraries: [],
          queuedJobs: 4,
        },
        featureFlags: [],
        generatedAt: "2026-05-19T10:00:00.000Z",
        incidents: [],
        libraries: Array.from({ length: 6 }, (_, index) => ({ id: `lib-${index + 1}` })),
        maintenanceMode: false,
        releaseGovernance: null,
        runtimeGovernance: {
          automationInactiveLibraryAlertEnabled: true,
          automationPaymentReminderEnabled: true,
          automationSubscriptionRenewalEnabled: true,
          billingMutationsEnabled: true,
          maintenanceMode: false,
          queueProcessingEnabled: true,
        },
        security: {
          failedLoginAttempts24h: 0,
          ipWhitelistEnabled: false,
          suspiciousIps: [],
          whitelist: [],
        },
        settings: [],
        statusSignals: [],
        systemStatus: "green",
      },
      error: undefined,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<SuperAdminDashboard />);

    expect(screen.getByText("Total Libraries")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("Pending Jobs")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("replays dead-letter jobs from the automation operations table", async () => {
    render(<SuperAdminAutomation />);

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replay job" }));

    await waitFor(() => {
      expect(mockJobMutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: "replay_dead_letter",
          actionToken: "preview-token",
          confirmationText: "",
          jobId: "job-1",
          replayReason: "Operator replay from dead-letter queue.",
        }),
      );
    });
  });

  it("shows remediation and recommendation guidance in lightweight mode", () => {
    render(<SuperAdminAutomation />);

    expect(screen.getByText("Remediation planner")).toBeInTheDocument();
    expect(
      screen.getByText("Remediation planning snapshots are paused on this dashboard to reduce control-plane load."),
    ).toBeInTheDocument();
    expect(screen.getByText("Recommendation engine")).toBeInTheDocument();
    expect(
      screen.getByText("Recommendation synthesis is temporarily reduced. Refresh manually when operator review is needed."),
    ).toBeInTheDocument();
  });

  it("saves queue and billing governance toggles from the settings console", async () => {
    render(<SuperAdminSettings />);

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]);
    fireEvent.click(switches[2]);
    fireEvent.click(screen.getByRole("button", { name: "Save runtime governance" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply governance change" }));

    await waitFor(() => {
      expect(mockPlatformMutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actionToken: "platform-preview-token",
          confirmationText: "",
          settings: expect.objectContaining({
            ops_billing_mutations_enabled: false,
            ops_queue_processing_enabled: false,
          }),
        }),
      );
    });
  });

  it("renders governance runtime visibility in the settings console", () => {
    render(<SuperAdminSettings />);

    fireEvent.click(screen.getByRole("button", { name: "RBAC & Access" }));
    expect(screen.getByText("Governance runtime")).toBeInTheDocument();
    expect(screen.getAllByText("Active elevations").length).toBeGreaterThan(0);
    expect(screen.getByText("25m remaining")).toBeInTheDocument();
    expect(screen.getByText("Version gov-cache-1")).toBeInTheDocument();
    expect(screen.getByText("Approval workflow bottlenecks are forming.")).toBeInTheDocument();
  });
});
