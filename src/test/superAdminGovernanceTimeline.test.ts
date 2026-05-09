import { describe, expect, it } from "vitest";

import { buildOperatorTimelineEntry } from "@/lib/superAdmin/apiRoute.server";

describe("super admin governance timeline", () => {
  it("includes permission grants and approval actions in timeline entries", () => {
    const granted = buildOperatorTimelineEntry({
      action: "operator_role_granted",
      actorEmail: "admin@libriofy.com",
      createdAt: "2026-05-08T10:00:00.000Z",
      id: "audit-1",
      ipAddress: "203.0.113.10",
      metadata: {
        actor_user_id: "actor-1",
        operator_action_id: "role_assignment",
        scope_type: "library",
        target_email: "ops@libriofy.com",
        trace_id: "trace-1",
      },
      targetDisplay: "ops@libriofy.com - Billing Ops - Library 1",
      targetType: "operator_role_grant",
    });

    const approved = buildOperatorTimelineEntry({
      action: "governance_request_reviewed",
      actorEmail: "approver@libriofy.com",
      createdAt: "2026-05-08T10:05:00.000Z",
      id: "audit-2",
      ipAddress: "203.0.113.11",
      metadata: {
        actor_user_id: "actor-2",
        approval_request_id: "approval-1",
        operator_action_id: "governance_approval",
        request_id: "req-1",
      },
      targetDisplay: "Refund override for invoice-1",
      targetType: "governance_request",
    });

    expect(granted.action).toBe("operator_role_granted");
    expect(granted.targetType).toBe("operator_role_grant");
    expect(granted.traceId).toBe("trace-1");

    expect(approved.action).toBe("governance_request_reviewed");
    expect(approved.requestId).toBe("req-1");
    expect(approved.targetType).toBe("governance_request");
  });
});
