import { describe, expect, it } from "vitest";

import { EMPTY_OPERATOR_SCOPE_BOUNDARY } from "@/lib/superAdmin/governance";
import {
  buildActiveElevationFeed,
  buildGovernanceAnalytics,
  buildGovernanceCoordination,
  buildGovernanceDirectory,
  buildGovernanceForensics,
  buildGovernanceSynchronization,
  buildGovernanceAlerts,
  buildGovernanceVisibility,
  detectGovernanceConflicts,
  enrichApprovalRequestRuntime,
} from "@/lib/superAdmin/governanceRuntime";
import type { AdminOperatorApprovalRequest, AdminOperatorRoleGrant } from "@/lib/superAdmin/types";

const buildGrant = (overrides: Partial<AdminOperatorRoleGrant> = {}): AdminOperatorRoleGrant => ({
  availability: {
    backupOperator: "backup@libriofy.com",
    fallbackChain: ["backup@libriofy.com"],
    regions: ["APAC"],
    shiftActive: true,
    shiftEndHourLocal: 18,
    shiftLabel: "APAC primary",
    shiftStartHourLocal: 9,
    standby: false,
    status: "active",
    timezone: "Asia/Kolkata",
    workloadCapacity: 2,
  },
  boundary: {
    ...EMPTY_OPERATOR_SCOPE_BOUNDARY,
    governanceDomain: "billing",
    organizationId: "org-1",
    organizationLabel: "North Operations",
    teamId: "team-1",
    teamLabel: "Billing Team",
    tenantId: "tenant-1",
    tenantLabel: "Tenant 1",
  },
  conflictWarnings: [],
  createdAt: "2026-05-08T10:00:00.000Z",
  email: "ops@libriofy.com",
  effectivePermissions: ["access.manage"],
  expiresAt: "2026-05-08T11:00:00.000Z",
  grantId: "grant-1",
  grantMode: "temporary",
  inheritedRoles: ["read_only_ops"],
  reason: "Temporary access",
  restrictions: {},
  revokedAt: null,
  role: "platform_admin",
  roleLabel: "Platform Admin",
  scopeId: "library-1",
  scopeLabel: "Library 1",
  scopeType: "library",
  startsAt: "2026-05-08T10:00:00.000Z",
  status: "active",
  userId: "user-1",
  ...overrides,
});

const buildApprovalRequest = (
  overrides: Partial<AdminOperatorApprovalRequest> = {},
): AdminOperatorApprovalRequest => ({
  actionId: "refund_process",
  actionLabel: "Refund process",
  authorityScopes: [
    {
      boundary: {
        ...EMPTY_OPERATOR_SCOPE_BOUNDARY,
        governanceDomain: "billing",
        organizationId: "org-1",
        organizationLabel: "North Operations",
        teamId: "team-1",
        teamLabel: "Billing Team",
        tenantId: "tenant-1",
        tenantLabel: "Tenant 1",
      },
      scopeId: "tenant-1",
      scopeLabel: "Tenant 1",
      scopeType: "tenant",
    },
  ],
  approvalChainMode: "quorum",
  approvalStates: [],
  approvals: [],
  approvedAt: null,
  boundary: {
    ...EMPTY_OPERATOR_SCOPE_BOUNDARY,
    governanceDomain: "billing",
    organizationId: "org-1",
    organizationLabel: "North Operations",
    teamId: "team-1",
    teamLabel: "Billing Team",
    tenantId: "tenant-1",
    tenantLabel: "Tenant 1",
  },
  consistencyAt: "2026-05-08T10:00:00.000Z",
  cooldownUntil: null,
  createdAt: "2026-05-08T10:00:00.000Z",
  delegationHistory: [],
  delegatedApprover: "Billing Ops",
  emergencyBypassEligible: true,
  emergencyBypassUsed: false,
  escalationChain: [],
  escalationRule: "Escalate to Billing Ops.",
  escalatedAt: "2026-05-08T10:10:00.000Z",
  executedAt: null,
  expiresAt: "2026-05-08T10:30:00.000Z",
  fallbackApprover: "Finance Director",
  fingerprint: "fp-1",
  governanceVersion: "gov-1",
  id: "approval-1",
  lineageSummary: [],
  linkedIncidentKey: "incident-1",
  optionalSecondApprover: true,
  organizationScopeSummary: ["Tenant Tenant 1", "Org North Operations", "Team Billing Team", "Domain billing"],
  outOfOfficeDelegate: null,
  partialApprovals: 0,
  previewSummary: "Refund override for invoice-1",
  reason: "Refund requires billing review.",
  rejectedAt: null,
  rejectedLineage: [],
  requesterEmail: "requester@libriofy.com",
  requesterUserId: "requester-1",
  requiredApprovals: 2,
  severity: "critical",
  stale: false,
  status: "pending",
  targetDisplay: "invoice-1",
  targetId: "invoice-1",
  targetType: "billing_refund",
  ...overrides,
});

describe("super admin governance runtime", () => {
  it("builds approval state and partial approval lineage for quorum workflows", () => {
    const request = enrichApprovalRequestRuntime(
      buildApprovalRequest({
        approvals: [
          {
            actorEmail: "billing-approver@libriofy.com",
            actorUserId: "approver-1",
            at: "2026-05-08T10:05:00.000Z",
            decision: "approved",
            id: "decision-1",
            note: "Validated billing context.",
          },
        ],
      }),
    );

    expect(request.partialApprovals).toBe(1);
    expect(request.approvalStates?.map((state) => state.state)).toEqual(["approved", "pending"]);
    expect(request.lineageSummary?.[0]).toContain("billing-approver@libriofy.com");
  });

  it("detects overlapping grants and queue collisions across operators", () => {
    const conflicts = detectGovernanceConflicts({
      grants: [
        buildGrant(),
        buildGrant({ grantId: "grant-2", grantMode: "emergency_override" }),
      ],
      migrationNeedsMigration: false,
      now: "2026-05-08T10:15:00.000Z",
      requests: [
        buildApprovalRequest({
          actionId: "queue_cancel",
          actionLabel: "Queue cancellation",
          fingerprint: "queue-1",
          id: "approval-queue-1",
          reason: "Cancel duplicate queue item.",
          requesterEmail: "ops-1@libriofy.com",
          targetDisplay: "job-1",
          targetId: "job-1",
          targetType: "queue_job",
        }),
        buildApprovalRequest({
          actionId: "run_due_jobs",
          actionLabel: "Run due jobs",
          fingerprint: "queue-2",
          id: "approval-queue-2",
          reason: "Drain due jobs.",
          requesterEmail: "ops-2@libriofy.com",
          targetDisplay: "job-1",
          targetId: "job-1",
          targetType: "queue_job",
        }),
      ],
    });

    expect(conflicts.map((conflict) => conflict.kind)).toEqual(
      expect.arrayContaining(["grant_overlap", "queue_collision"]),
    );
  });

  it("surfaces active elevation countdowns, drift alerts, and visibility health", () => {
    const approvals = [
      enrichApprovalRequestRuntime(
        buildApprovalRequest({
          approvals: [
            {
              actorEmail: "billing-approver@libriofy.com",
              actorUserId: "approver-1",
              at: "2026-05-08T10:05:00.000Z",
              decision: "approved",
              id: "decision-1",
              note: "Primary approval recorded.",
            },
          ],
          partialApprovals: 1,
          stale: true,
        }),
      ),
    ];
    const grants = [
      buildGrant({ grantId: "grant-1", grantMode: "temporary" }),
      buildGrant({ grantId: "grant-2", email: "ops-2@libriofy.com", userId: "user-2" }),
      buildGrant({ grantId: "grant-3", email: "ops-3@libriofy.com", userId: "user-3", grantMode: "emergency_override" }),
    ];
    const activeElevations = buildActiveElevationFeed(grants, approvals, Date.parse("2026-05-08T10:20:00.000Z"));
    const conflicts = detectGovernanceConflicts({
      grants,
      migrationNeedsMigration: true,
      now: "2026-05-08T10:20:00.000Z",
      requests: approvals,
    });
    const alerts = buildGovernanceAlerts({
      activeElevations,
      conflicts,
      migrationNeedsMigration: true,
      now: "2026-05-08T10:20:00.000Z",
      requests: approvals,
    });
    const visibility = buildGovernanceVisibility({
      activeElevations,
      alerts,
      conflicts,
      requests: approvals,
    });

    expect(activeElevations[0]?.countdownLabel).toContain("remaining");
    expect(alerts.map((alert) => alert.category)).toEqual(
      expect.arrayContaining(["approval_bottleneck", "governance_drift", "suspicious_elevation_spike"]),
    );
    expect(visibility.roleAssignmentHealth).toBe("critical");
    expect(visibility.staleApprovalCount).toBe(1);
    expect(visibility.tenantIsolations).toBe(1);
    expect(visibility.delegatedApprovals).toBeGreaterThanOrEqual(0);
  });

  it("models follow-the-sun load balancing and synchronization health", () => {
    const requests = [
      enrichApprovalRequestRuntime(
        buildApprovalRequest({
          approvals: [
            {
              actorEmail: "approver@libriofy.com",
              actorUserId: "approver-1",
              at: "2026-05-08T10:05:00.000Z",
              decision: "approved",
              id: "decision-1",
              note: "Approved.",
            },
          ],
          createdAt: "2026-05-08T09:00:00.000Z",
          delegatedApprover: "ops@libriofy.com",
          fallbackApprover: "backup@libriofy.com",
          id: "approval-ops-1",
          partialApprovals: 1,
          stale: true,
          status: "pending",
        }),
      ),
      enrichApprovalRequestRuntime(
        buildApprovalRequest({
          authorityScopes: [
            {
              boundary: {
                ...EMPTY_OPERATOR_SCOPE_BOUNDARY,
                tenantId: "tenant-1",
                tenantLabel: "Tenant 1",
              },
              scopeId: "tenant-1",
              scopeLabel: "Tenant 1",
              scopeType: "tenant",
            },
            {
              boundary: {
                ...EMPTY_OPERATOR_SCOPE_BOUNDARY,
                tenantId: "tenant-2",
                tenantLabel: "Tenant 2",
              },
              scopeId: "tenant-2",
              scopeLabel: "Tenant 2",
              scopeType: "tenant",
            },
          ],
          boundary: {
            ...EMPTY_OPERATOR_SCOPE_BOUNDARY,
            tenantId: "tenant-1",
            tenantLabel: "Tenant 1",
          },
          id: "approval-ops-2",
          requesterEmail: "ops-2@libriofy.com",
          status: "approved",
        }),
      ),
    ];
    const incidents = [
      {
        acknowledgedAt: null,
        acknowledgedBy: null,
        afterHoursEscalated: true,
        approvalLinkedRequestIds: ["approval-ops-1"],
        backupOwnerEmail: "backup@libriofy.com",
        crossTeamEscalation: true,
        delegatedRemediatorEmail: "backup@libriofy.com",
        escalationLevel: 2,
        eventType: "QUEUE_FAILURE",
        firstSeenAt: "2026-05-08T08:55:00.000Z",
        governanceActionIds: ["incident_retry"],
        incidentKey: "incident-ops-1",
        lastSeenAt: "2026-05-08T10:10:00.000Z",
        latestMessage: "Regional queue backlog.",
        latestNote: "Follow-the-sun handoff to backup operator.",
        linkedCorrelationIds: [],
        linkedJobIds: ["job-1"],
        linkedPaymentReferences: [],
        linkedRequestIds: ["approval-ops-1"],
        linkedTraceIds: [],
        noteCount: 1,
        operationalNotes: [],
        organizationLabel: "North Operations",
        ownerEmail: null,
        ownerUserId: null,
        ownershipTransitions: [
          {
            actorEmail: "ops@libriofy.com",
            at: "2026-05-08T10:00:00.000Z",
            from: "ops@libriofy.com",
            note: "Shift ended in APAC.",
            regionLabel: "APAC",
            teamLabel: "Billing Team",
            to: "backup@libriofy.com",
            type: "follow_the_sun",
          },
        ],
        regionLabel: "APAC",
        regionalFailoverEvents: [
          {
            actorEmail: "ops@libriofy.com",
            at: "2026-05-08T10:02:00.000Z",
            fromRegion: "APAC",
            note: "Failing over to EMEA standby.",
            toRegion: "EMEA",
          },
        ],
        remediationActions: [],
        retryableJobId: "job-1",
        severity: "CRITICAL" as const,
        severityApprovalRequired: true,
        severityApprovedAt: null,
        severityApprovedBy: null,
        slaBreached: true,
        slaTargetAt: "2026-05-08T09:10:00.000Z",
        teamLabel: "Billing Team",
        tenantId: "tenant-1",
        tenantLabel: "Tenant 1",
        totalOccurrences: 3,
        traceLineage: [],
        unresolvedCount: 2,
        unresolvedOwnership: true,
      },
    ];

    const conflicts = detectGovernanceConflicts({
      grants: [
        buildGrant({
          availability: {
            ...buildGrant().availability!,
            workloadCapacity: 1,
          },
        }),
        buildGrant({ email: "backup@libriofy.com", grantId: "grant-2", userId: "user-2" }),
      ],
      migrationNeedsMigration: false,
      now: "2026-05-08T10:20:00.000Z",
      requests,
    });
    const synchronization = buildGovernanceSynchronization({
      consistency: { governanceVersion: "gov-2" },
      conflicts,
      requests,
    });
    const coordination = buildGovernanceCoordination({
      grants: [
        buildGrant({
          availability: {
            ...buildGrant().availability!,
            workloadCapacity: 1,
          },
        }),
        buildGrant({ email: "backup@libriofy.com", grantId: "grant-2", userId: "user-2" }),
      ],
      incidents,
      requests,
    });
    const alerts = buildGovernanceAlerts({
      activeElevations: buildActiveElevationFeed([buildGrant()], requests, Date.parse("2026-05-08T10:20:00.000Z")),
      conflicts,
      coordination,
      migrationNeedsMigration: false,
      now: "2026-05-08T10:20:00.000Z",
      requests,
      synchronization,
    });
    const analytics = buildGovernanceAnalytics({
      activeElevations: [],
      conflicts,
      coordination,
      requests,
      synchronization,
    });
    const visibility = buildGovernanceVisibility({
      activeElevations: [],
      alerts,
      coordination,
      conflicts,
      requests,
      synchronization,
    });

    expect(conflicts.map((conflict) => conflict.kind)).toContain("tenant_isolation_violation");
    expect(synchronization.propagationHealth).toBe("critical");
    expect(coordination.followTheSun.afterHoursEscalations).toBeGreaterThan(0);
    expect(coordination.loadBalancing.operatorLoads[0]?.overloaded).toBe(true);
    expect(alerts.map((alert) => alert.category)).toEqual(
      expect.arrayContaining(["operator_overload", "policy_sync_degraded", "tenant_isolation_violation", "unowned_incident_risk"]),
    );
    expect(analytics.tenantIsolationViolations).toBe(1);
    expect(visibility.unresolvedOwnership).toBe(1);
    expect(visibility.policyPropagationHealth).toBe("critical");
  });

  it("builds governance directory and forensic views for delegated enterprise workflows", () => {
    const requests = [
      enrichApprovalRequestRuntime(
        buildApprovalRequest({
          approvals: [
            {
              actorEmail: "delegate@libriofy.com",
              actorUserId: "delegate-1",
              at: "2026-05-08T10:05:00.000Z",
              decision: "approved",
              delegatedBy: "Billing Ops",
              id: "decision-1",
              isDelegated: true,
              note: "Reviewed on behalf of primary approver.",
            },
          ],
          delegationHistory: [
            {
              approvalRequestId: "approval-1",
              at: "2026-05-08T10:02:00.000Z",
              delegatedBy: "Billing Ops",
              delegatedTo: "delegate@libriofy.com",
              mode: "out_of_office",
              note: "Primary approver is away.",
              scopeSummary: ["Tenant Tenant 1", "Team Billing Team"],
            },
          ],
          escalationChain: [
            {
              at: "2026-05-08T10:03:00.000Z",
              from: "Billing Team",
              reason: "Escalated for tenant-wide refund freeze.",
              scopeSummary: ["Tenant Tenant 1", "Team Billing Team"],
              status: "completed",
              to: "Finance Director",
            },
          ],
          outOfOfficeDelegate: "delegate@libriofy.com",
        }),
      ),
    ];
    const grants = [buildGrant()];
    const activeElevations = buildActiveElevationFeed(grants, requests, Date.parse("2026-05-08T10:20:00.000Z"));
    const directory = buildGovernanceDirectory({
      activeElevations,
      grants,
      requests,
    });
    const forensics = buildGovernanceForensics({
      auditEvents: [
        {
          action: "impersonation_started",
          actorEmail: "ops@libriofy.com",
          createdAt: "2026-05-08T10:06:00.000Z",
          metadata: {
            request_path: "/api/auth/impersonation/start",
            tenant_id: "tenant-1",
            tenant_label: "Tenant 1",
          },
          targetType: "impersonation_session",
        },
      ],
      incidents: [
        {
          acknowledgedAt: null,
          acknowledgedBy: null,
          escalationLevel: 1,
          eventType: "QUEUE_FAILURE",
          firstSeenAt: "2026-05-08T10:00:00.000Z",
          incidentKey: "incident-1",
          lastSeenAt: "2026-05-08T10:08:00.000Z",
          latestMessage: "Queue backlog.",
          latestNote: "Delegated remediation started.",
          linkedCorrelationIds: [],
          linkedJobIds: [],
          linkedPaymentReferences: [],
          linkedRequestIds: [],
          linkedTraceIds: [],
          noteCount: 0,
          operationalNotes: [],
          ownerEmail: "ops@libriofy.com",
          ownerUserId: "user-1",
          ownershipTransitions: [
            {
              actorEmail: "ops@libriofy.com",
              at: "2026-05-08T10:02:00.000Z",
              from: "ops@libriofy.com",
              note: "Shift handoff to standby.",
              regionLabel: "APAC",
              teamLabel: "Billing Team",
              to: "delegate@libriofy.com",
              type: "shift_change",
            },
          ],
          regionLabel: "APAC",
          regionalFailoverEvents: [
            {
              actorEmail: "ops@libriofy.com",
              at: "2026-05-08T10:04:00.000Z",
              fromRegion: "APAC",
              note: "EMEA failover engaged.",
              toRegion: "EMEA",
            },
          ],
          retryableJobId: null,
          severity: "ERROR" as const,
          teamLabel: "Billing Team",
          tenantId: "tenant-1",
          tenantLabel: "Tenant 1",
          totalOccurrences: 1,
          traceLineage: [],
          unresolvedCount: 1,
          delegatedRemediatorEmail: "delegate@libriofy.com",
        },
      ],
      requests,
    });

    expect(directory.activeOperators[0]?.tenantIds).toContain("Tenant 1");
    expect(directory.delegatedRoles[0]?.outOfOfficeDelegate).toBe("delegate@libriofy.com");
    expect(directory.escalationChains[0]?.steps[0]).toContain("Billing Team");
    expect(forensics.summary.delegatedApprovals).toBe(1);
    expect(forensics.summary.delegatedRemediations).toBe(1);
    expect(forensics.summary.ownershipTransitions).toBe(1);
    expect(forensics.summary.regionalFailovers).toBe(1);
    expect(forensics.summary.scopedImpersonations).toBe(1);
  });
});
