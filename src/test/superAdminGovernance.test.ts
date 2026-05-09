import { describe, expect, it } from "vitest";

import {
  EMPTY_OPERATOR_SCOPE_BOUNDARY,
  canAccessControlPlanePage,
  evaluateOperatorActionAccess,
  expandInheritedOperatorRoles,
  expandOperatorPermissions,
  getActionConfirmationLabel,
  normalizeOperatorGrants,
  normalizeOperatorRoles,
  resolveActionApprovalPolicy,
  resolveIncidentSlaMinutes,
  resolveOperatorPages,
} from "@/lib/superAdmin/governance";

describe("super admin governance helpers", () => {
  const libraryScope = {
    boundary: EMPTY_OPERATOR_SCOPE_BOUNDARY,
    scopeId: "library-1",
    scopeLabel: "Library 1",
    scopeType: "library" as const,
  };

  it("expands inherited operator roles into permissions", () => {
    const roles = normalizeOperatorRoles(["incident_ops", "unknown", "incident_ops"]);
    const permissions = expandOperatorPermissions(roles);

    expect(roles).toEqual(["incident_ops"]);
    expect(expandInheritedOperatorRoles(["incident_ops"])).toEqual(
      expect.arrayContaining(["incident_ops", "read_only_ops"]),
    );
    expect(permissions).toEqual(
      expect.arrayContaining([
        "automation.manage",
        "automation.read",
        "incidents.manage",
        "incidents.read",
        "settings.read",
      ]),
    );
  });

  it("resolves page visibility from read permissions", () => {
    const permissions = expandOperatorPermissions(["billing_ops"]);
    const pages = resolveOperatorPages(permissions);

    expect(pages).toEqual(
      expect.arrayContaining([
        "billing",
        "dashboard",
        "observability",
        "revenue",
        "settings",
      ]),
    );
    expect(canAccessControlPlanePage(permissions, "billing")).toBe(true);
  });

  it("denies actions by default when no active scoped grant matches", () => {
    const decision = evaluateOperatorActionAccess({
      actionId: "refund_process",
      grants: [],
      targetScopes: [libraryScope],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.deniedByDefault).toBe(true);
    expect(decision.summary).toContain("Denied by default");
  });

  it("explains inherited permission grants and scope matches", () => {
    const grants = normalizeOperatorGrants([
      {
        email: "ops@libriofy.com",
        grant_mode: "temporary",
        id: "grant-1",
        role: "platform_admin",
        scope_id: "library-1",
        scope_label: "Library 1",
        scope_type: "library",
      },
    ]);

    const decision = evaluateOperatorActionAccess({
      actionId: "feature_flag_update",
      grants,
      targetScopes: [libraryScope],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.permission).toBe("feature_flags.manage");
    expect(decision.roleChain.join(" ")).toContain("Platform Admin");
    expect(decision.scopeChain.join(" ")).toContain("library:Library 1");
  });

  it("enforces read-only restrictions unless emergency access exists", () => {
    const grants = normalizeOperatorGrants([
      {
        email: "ops@libriofy.com",
        grant_mode: "direct",
        id: "grant-1",
        restrictions: { readOnlyMode: true },
        role: "billing_ops",
        scope_type: "global",
      },
    ]);

    const decision = evaluateOperatorActionAccess({
      actionId: "refund_process",
      grants,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.readOnlyActive).toBe(true);
    expect(decision.restrictionBoundaries.join(" ")).toContain("Read-only mode");
  });

  it("resolves approval policy metadata for critical governance actions", () => {
    const policy = resolveActionApprovalPolicy("refund_process");

    expect(policy.approvalRequired).toBe(true);
    expect(policy.requiredApprovals).toBe(2);
    expect(policy.optionalSecondApprover).toBe(true);
  });

  it("requires quorum review for temporary access elevation", () => {
    const policy = resolveActionApprovalPolicy("temporary_access_grant");

    expect(policy.approvalRequired).toBe(true);
    expect(policy.requiredApprovals).toBe(2);
    expect(policy.escalationRole).toBe("platform_admin");
  });

  it("publishes the correct typed confirmation phrases", () => {
    expect(getActionConfirmationLabel("refund_process")).toBe("PROCESS REFUND");
    expect(getActionConfirmationLabel("role_revocation")).toBe("REVOKE OPERATOR ROLE");
  });

  it("requires tenant-scoped authority to match tenant-scoped targets", () => {
    const grants = normalizeOperatorGrants([
      {
        boundary: {
          ...EMPTY_OPERATOR_SCOPE_BOUNDARY,
          tenantId: "tenant-1",
          tenantLabel: "Tenant 1",
        },
        email: "ops@libriofy.com",
        grant_mode: "temporary",
        id: "grant-tenant-1",
        role: "platform_admin",
        scope_id: "tenant-1",
        scope_label: "Tenant 1",
        scope_type: "tenant",
      },
    ]);

    const allowedDecision = evaluateOperatorActionAccess({
      actionId: "feature_flag_update",
      grants,
      targetScopes: [
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
      ],
    });
    const deniedDecision = evaluateOperatorActionAccess({
      actionId: "feature_flag_update",
      grants,
      targetScopes: [
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
    });

    expect(allowedDecision.allowed).toBe(true);
    expect(deniedDecision.allowed).toBe(false);
  });

  it("derives incident SLA targets from severity", () => {
    expect(resolveIncidentSlaMinutes("CRITICAL")).toBe(15);
    expect(resolveIncidentSlaMinutes("ERROR")).toBe(60);
    expect(resolveIncidentSlaMinutes("WARNING")).toBe(240);
    expect(resolveIncidentSlaMinutes("INFO")).toBe(1440);
  });
});
