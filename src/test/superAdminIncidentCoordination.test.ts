import { describe, expect, it } from "vitest";

import { buildIncidentWorkflowGroups } from "@/lib/superAdmin/service.server";
import type { AdminIncidentGroup } from "@/lib/superAdmin/types";

const buildBaseIncident = (overrides: Partial<AdminIncidentGroup> = {}): AdminIncidentGroup => ({
  acknowledgedAt: null,
  acknowledgedBy: null,
  escalationLevel: 0,
  eventType: "QUEUE_FAILURE",
  firstSeenAt: "2026-05-08T08:55:00.000Z",
  incidentKey: "incident-1",
  lastSeenAt: "2026-05-08T09:05:00.000Z",
  latestMessage: "Queue backlog detected.",
  latestNote: null,
  linkedCorrelationIds: [],
  linkedJobIds: [],
  linkedPaymentReferences: [],
  linkedRequestIds: [],
  linkedTraceIds: [],
  noteCount: 0,
  operationalNotes: [],
  ownerEmail: null,
  ownerUserId: null,
  retryableJobId: null,
  severity: "CRITICAL",
  totalOccurrences: 2,
  traceLineage: [],
  unresolvedCount: 2,
  ...overrides,
});

describe("super admin incident coordination runtime", () => {
  it("reconstructs handoffs, delegated remediation, and regional failover lineage", () => {
    const groups = buildIncidentWorkflowGroups({
      auditLogs: [
        {
          action: "incident_assigned",
          actor_email: "apac-ops@libriofy.com",
          created_at: "2026-05-08T09:00:00.000Z",
          id: "audit-1",
          metadata: {
            assignee_email: "apac-owner@libriofy.com",
            assignee_region: "APAC",
            assignee_team: "Primary Response",
            backup_assignee_email: "emea-backup@libriofy.com",
            handoff_type: "assignment",
            incident_key: "incident-1",
            tenant_id: "tenant-1",
            tenant_label: "Tenant 1",
          },
          target_id: "incident-1",
          target_type: "incident_group",
        },
        {
          action: "incident_escalated",
          actor_email: "apac-ops@libriofy.com",
          created_at: "2026-05-08T09:10:00.000Z",
          id: "audit-2",
          metadata: {
            after_hours: true,
            escalation_level: 2,
            incident_key: "incident-1",
            note: "APAC shift ended, rerouting to EMEA.",
            regional_failover_from: "APAC",
            regional_failover_to: "EMEA",
            route_to_region: "EMEA",
            route_to_team: "EMEA Response",
          },
          target_id: "incident-1",
          target_type: "incident_group",
        },
        {
          action: "incident_note_added",
          actor_email: "apac-ops@libriofy.com",
          created_at: "2026-05-08T09:12:00.000Z",
          id: "audit-3",
          metadata: {
            coordination_category: "handoff",
            delegated_remediator_email: "emea-backup@libriofy.com",
            incident_key: "incident-1",
            linked_approval_request_id: "approval-1",
            linked_governance_action_id: "incident_escalate",
            note: "Follow-the-sun handoff recorded.",
          },
          target_id: "incident-1",
          target_type: "incident_group",
        },
        {
          action: "incident_retry_requested",
          actor_email: "emea-backup@libriofy.com",
          created_at: "2026-05-08T09:15:00.000Z",
          id: "audit-4",
          metadata: {
            delegated_remediator_email: "emea-backup@libriofy.com",
            incident_key: "incident-1",
            job_id: "job-1",
            linked_approval_request_id: "approval-1",
            note: "Remediation delegated to regional standby.",
          },
          target_id: "incident-1",
          target_type: "incident_group",
        },
      ] as never,
      baseGroups: [buildBaseIncident()],
      traceEvents: [],
    });

    expect(groups[0]?.backupOwnerEmail).toBe("emea-backup@libriofy.com");
    expect(groups[0]?.crossTeamEscalation).toBe(true);
    expect(groups[0]?.afterHoursEscalated).toBe(true);
    expect(groups[0]?.delegatedRemediatorEmail).toBe("emea-backup@libriofy.com");
    expect(groups[0]?.approvalLinkedRequestIds).toContain("approval-1");
    expect(groups[0]?.governanceActionIds).toContain("incident_escalate");
    expect(groups[0]?.regionalFailoverEvents?.[0]).toMatchObject({
      fromRegion: "APAC",
      toRegion: "EMEA",
    });
    expect(groups[0]?.ownershipTransitions?.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["assignment", "delegated_remediation"]),
    );
  });

  it("flags unresolved ownership when open incidents have no assigned operator", () => {
    const groups = buildIncidentWorkflowGroups({
      auditLogs: [],
      baseGroups: [buildBaseIncident()],
      traceEvents: [],
    });

    expect(groups[0]?.unresolvedOwnership).toBe(true);
    expect(groups[0]?.ownerEmail).toBeNull();
  });
});
