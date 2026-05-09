import {
  buildScopeBoundarySummary,
  EMPTY_OPERATOR_SCOPE_BOUNDARY,
  type AdminOperatorActionId,
  type AdminOperatorScope,
  type AdminOperatorScopeBoundary,
} from "./governance.js";
import type {
  AdminIncidentGroup,
  AdminOperatorActiveElevation,
  AdminOperatorApprovalRequest,
  AdminOperatorApprovalState,
  AdminOperatorGovernanceAnalytics,
  AdminOperatorGovernanceAlert,
  AdminOperatorGovernanceConflict,
  AdminOperatorGovernanceCoordination,
  AdminOperatorGovernanceDirectory,
  AdminOperatorGovernanceForensics,
  AdminOperatorGovernanceSynchronization,
  AdminOperatorGovernanceVisibility,
  AdminOperatorRoleGrant,
} from "./types.js";

const ELEVATION_MODES = new Set(["temporary", "elevated", "emergency_override"]);

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeLower = (value: unknown) => normalizeText(value).toLowerCase();

const uniqueStrings = (values: Array<string | null | undefined>) => [...new Set(values.map(normalizeText).filter(Boolean))];

const mergeStringList = (current: string[], next: string | null | undefined) => uniqueStrings([...current, next]);

const buildPrincipalLabel = (grant: Pick<AdminOperatorRoleGrant, "email" | "userId">) =>
  normalizeText(grant.email) || normalizeText(grant.userId) || "operator";

const readBoundary = (
  value: { boundary?: AdminOperatorScopeBoundary | null } | null | undefined,
): AdminOperatorScopeBoundary => value?.boundary ?? EMPTY_OPERATOR_SCOPE_BOUNDARY;

const buildBoundaryKey = (boundary: AdminOperatorScopeBoundary) =>
  [
    boundary.tenantId,
    boundary.organizationId,
    boundary.departmentId,
    boundary.teamId,
    boundary.operationalGroupId,
    boundary.regionId,
    boundary.governanceDomain,
    boundary.delegatedScopeType,
    boundary.delegatedScopeId,
    boundary.visibilityTags.join(","),
  ].map(normalizeText).join("|");

const buildScopeSummary = (
  scope: Pick<AdminOperatorScope, "boundary" | "scopeId" | "scopeLabel" | "scopeType">,
) => {
  const labels = uniqueStrings([
    normalizeText(scope.scopeLabel) || normalizeText(scope.scopeId) || scope.scopeType,
    buildScopeBoundarySummary({ boundary: readBoundary(scope) }),
  ]);

  return labels.filter((label) => label !== "Global boundary");
};

const buildRequestScopeSummary = (request: AdminOperatorApprovalRequest) => {
  if (request.organizationScopeSummary.length) {
    return request.organizationScopeSummary;
  }

  const scopeSummaries = request.authorityScopes.flatMap((scope) => buildScopeSummary(scope));
  if (scopeSummaries.length) {
    return uniqueStrings(scopeSummaries);
  }

  return uniqueStrings([
    normalizeText(request.targetDisplay) || normalizeText(request.targetType),
    buildScopeBoundarySummary({ boundary: readBoundary(request) }),
  ]).filter((label) => label !== "Global boundary");
};

const buildScopeLabel = (
  grant: Pick<AdminOperatorRoleGrant, "boundary" | "scopeId" | "scopeLabel" | "scopeType">,
) => uniqueStrings([
  normalizeText(grant.scopeLabel) || normalizeText(grant.scopeId) || grant.scopeType,
  buildScopeBoundarySummary({ boundary: readBoundary(grant) }),
]).filter((value) => value !== "Global boundary").join(" / ");

const buildGrantConflictKey = (grant: Pick<AdminOperatorRoleGrant, "boundary" | "email" | "role" | "scopeId" | "scopeType" | "userId">) =>
  [
    buildPrincipalLabel(grant),
    normalizeText(grant.role),
    normalizeText(grant.scopeType),
    normalizeText(grant.scopeId),
    buildBoundaryKey(readBoundary(grant)),
  ].join("|");

const buildConflictId = (kind: AdminOperatorGovernanceConflict["kind"], key: string) =>
  `${kind}:${key}`.replace(/\s+/g, "_").toLowerCase();

const buildActionFamily = (actionId: AdminOperatorActionId) => {
  if (["refund_process", "payout_override", "commission_override", "revenue_adjustment"].includes(actionId)) {
    return "billing";
  }

  if (["dead_letter_replay", "job_retry"].includes(actionId)) {
    return "replay";
  }

  if (["queue_cancel", "run_due_jobs", "job_enqueue"].includes(actionId)) {
    return "queue";
  }

  if (["incident_resolve", "incident_retry", "incident_escalate"].includes(actionId)) {
    return "incident";
  }

  if (["governance_toggle", "emergency_control"].includes(actionId)) {
    return "maintenance";
  }

  return "approval";
};

const buildApprovalGroupKey = (
  request: Pick<AdminOperatorApprovalRequest, "actionId" | "boundary" | "targetId" | "targetType">,
) =>
  [
    buildActionFamily(request.actionId),
    normalizeText(request.targetType),
    normalizeText(request.targetId),
    buildBoundaryKey(readBoundary(request)),
  ].join("|");

const buildApprovalGroupKind = (
  request: Pick<AdminOperatorApprovalRequest, "actionId">,
): AdminOperatorGovernanceConflict["kind"] => {
  const family = buildActionFamily(request.actionId);
  if (family === "billing") {
    return "billing_override_collision";
  }

  if (family === "replay") {
    return "replay_collision";
  }

  if (family === "queue") {
    return "queue_collision";
  }

  if (family === "incident") {
    return "incident_resolution_collision";
  }

  if (family === "maintenance") {
    return "maintenance_collision";
  }

  return "concurrent_approval";
};

const buildApprovalGroupSeverity = (
  kind: AdminOperatorGovernanceConflict["kind"],
  size: number,
): AdminOperatorGovernanceConflict["severity"] => {
  if (["billing_override_collision", "emergency_collision", "replay_collision"].includes(kind)) {
    return "critical";
  }

  if (size > 2 || ["grant_overlap", "maintenance_collision", "queue_collision"].includes(kind)) {
    return "high";
  }

  return "medium";
};

const buildRequestTenantIds = (request: Pick<AdminOperatorApprovalRequest, "authorityScopes" | "boundary">) =>
  uniqueStrings([
    readBoundary(request).tenantId,
    ...request.authorityScopes.map((scope) => readBoundary(scope).tenantId),
  ]);

const hasTenantIsolationViolation = (
  request: Pick<AdminOperatorApprovalRequest, "authorityScopes" | "boundary">,
) => {
  const tenantIds = buildRequestTenantIds(request);
  if (tenantIds.length > 1) {
    return true;
  }

  const boundaryTenantId = normalizeText(readBoundary(request).tenantId);
  return Boolean(boundaryTenantId && tenantIds.length === 1 && tenantIds[0] !== boundaryTenantId);
};

const average = (values: number[]) =>
  values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0;

const percentile = (values: number[], fraction: number) => {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return Number(sorted[index].toFixed(2));
};

const buildBalanceScore = (values: number[]) => {
  if (values.length <= 1) {
    return 100;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = average(values);
  if (avg <= 0) {
    return 100;
  }

  return Number(Math.max(0, 100 - (((max - min) / avg) * 20)).toFixed(2));
};

const buildCountdownLabel = (expiresAt: string | null, nowMs = Date.now()) => {
  if (!expiresAt) {
    return "No expiry";
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return "Expiry unavailable";
  }

  const deltaSeconds = Math.max(0, Math.round((expiresAtMs - nowMs) / 1000));
  if (deltaSeconds <= 0) {
    return "Expired";
  }

  if (deltaSeconds < 60) {
    return `${deltaSeconds}s remaining`;
  }

  if (deltaSeconds < 3600) {
    return `${Math.ceil(deltaSeconds / 60)}m remaining`;
  }

  return `${Math.ceil(deltaSeconds / 3600)}h remaining`;
};

export const resolveApprovalChainMode = (
  request: Pick<
    AdminOperatorApprovalRequest,
    "emergencyBypassUsed" | "escalationRule" | "optionalSecondApprover" | "requiredApprovals"
  >,
): NonNullable<AdminOperatorApprovalRequest["approvalChainMode"]> => {
  if (request.emergencyBypassUsed) {
    return "emergency_bypass";
  }

  if ((request.requiredApprovals ?? 0) > 1) {
    return "quorum";
  }

  if (normalizeText(request.escalationRule)) {
    return "chained";
  }

  if (request.optionalSecondApprover) {
    return "quorum";
  }

  return "single";
};

export const buildApprovalStates = (
  request: Pick<
    AdminOperatorApprovalRequest,
    | "approvals"
    | "approvalChainMode"
    | "emergencyBypassUsed"
    | "escalationRule"
    | "optionalSecondApprover"
    | "requiredApprovals"
    | "status"
  >,
): AdminOperatorApprovalState[] => {
  const mode = request.approvalChainMode ?? resolveApprovalChainMode(request);
  const approvedDecisions = request.approvals.filter((decision) => decision.decision === "approved");
  const rejectedDecision = request.approvals.find((decision) => decision.decision === "rejected") ?? null;
  const requiredApprovals = Math.max(1, request.requiredApprovals);
  const stageCount = Math.max(requiredApprovals, request.optionalSecondApprover ? 2 : 1);

  return Array.from({ length: stageCount }, (_, index) => {
    const approvedDecision = approvedDecisions[index] ?? null;
    const rejectionApplies = !approvedDecision && rejectedDecision && index === Math.min(approvedDecisions.length, stageCount - 1);
    const optional = index >= requiredApprovals;
    const label =
      mode === "chained" && index === 0
        ? normalizeText(request.escalationRule) || "Escalation approver"
        : mode === "quorum"
          ? index === 0
            ? "Primary approver"
            : optional
              ? "Optional approver"
              : `Quorum approver ${index + 1}`
          : optional
            ? "Optional approver"
            : "Primary approver";

    let state: AdminOperatorApprovalState["state"] = "pending";
    if (approvedDecision) {
      state = "approved";
    } else if (request.emergencyBypassUsed && index === 0) {
      state = "bypassed";
    } else if (request.status === "expired") {
      state = "expired";
    } else if (rejectionApplies) {
      state = "rejected";
    }

    const actorEmail = approvedDecision?.actorEmail ?? (rejectionApplies ? rejectedDecision?.actorEmail ?? null : null);
    const actorUserId = approvedDecision?.actorUserId ?? (rejectionApplies ? rejectedDecision?.actorUserId ?? null : null);
    const at = approvedDecision?.at ?? (rejectionApplies ? rejectedDecision?.at ?? null : null);
    const note = approvedDecision?.note ?? (rejectionApplies ? rejectedDecision?.note ?? null : null);

    return {
      actorEmail,
      actorUserId,
      at,
      label,
      note,
      optional,
      roleLabel: mode === "chained" && index === 0 ? normalizeText(request.escalationRule) || null : null,
      state,
      step: index + 1,
    };
  });
};

export const enrichApprovalRequestRuntime = (
  request: AdminOperatorApprovalRequest,
): AdminOperatorApprovalRequest => {
  const approvalChainMode = request.approvalChainMode ?? resolveApprovalChainMode(request);
  const approvedCount = request.approvals.filter((decision) => decision.decision === "approved").length;
  const rejectedLineage = request.approvals
    .filter((decision) => decision.decision === "rejected")
    .map((decision) => `${decision.actorEmail || decision.actorUserId || "operator"} rejected at ${decision.at}`);
  const lineageSummary = request.approvals.map(
    (decision) => `${decision.actorEmail || decision.actorUserId || "operator"} ${decision.decision} at ${decision.at}`,
  );

  return {
    ...request,
    approvalChainMode,
    approvalStates: request.approvalStates?.length ? request.approvalStates : buildApprovalStates({ ...request, approvalChainMode }),
    authorityScopes: request.authorityScopes ?? [],
    boundary: readBoundary(request),
    delegationHistory: request.delegationHistory ?? [],
    escalationChain: request.escalationChain ?? [],
    fallbackApprover: request.fallbackApprover ?? null,
    lineageSummary: request.lineageSummary?.length ? request.lineageSummary : lineageSummary,
    organizationScopeSummary: request.organizationScopeSummary?.length ? request.organizationScopeSummary : buildRequestScopeSummary(request),
    outOfOfficeDelegate: request.outOfOfficeDelegate ?? null,
    partialApprovals: request.status === "pending" ? approvedCount : 0,
    rejectedLineage: request.rejectedLineage?.length ? request.rejectedLineage : rejectedLineage,
  };
};

export const buildActiveElevationFeed = (
  grants: AdminOperatorRoleGrant[],
  approvalRequests: AdminOperatorApprovalRequest[],
  nowMs = Date.now(),
): AdminOperatorActiveElevation[] =>
  grants
    .filter((grant) => grant.status === "active" && ELEVATION_MODES.has(grant.grantMode))
    .map((grant) => {
      const expiresAtMs = grant.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN;
      const linkedApprovalRequest =
        approvalRequests.find((request) => request.targetType === "operator_role_grant" && normalizeText(request.targetId) === grant.grantId) ??
        null;

      return {
        approvalRequestId: linkedApprovalRequest?.id ?? null,
        boundary: readBoundary(grant),
        countdownLabel: buildCountdownLabel(grant.expiresAt, nowMs),
        countdownSeconds:
          Number.isFinite(expiresAtMs) && expiresAtMs > nowMs ? Math.round((expiresAtMs - nowMs) / 1000) : null,
        expiresAt: grant.expiresAt,
        grantId: grant.grantId,
        historySummary: uniqueStrings([
          `${grant.grantMode.replaceAll("_", " ")} grant`,
          linkedApprovalRequest ? `Approval ${linkedApprovalRequest.id}` : null,
          grant.restrictions.readOnlyMode ? "Read-only boundary active" : null,
        ]),
        principal: buildPrincipalLabel(grant),
        roleLabel: grant.roleLabel,
        scopeLabel: buildScopeLabel(grant),
        sessionBound: false,
      };
    })
    .sort((left, right) => {
      const leftValue = left.countdownSeconds ?? Number.MAX_SAFE_INTEGER;
      const rightValue = right.countdownSeconds ?? Number.MAX_SAFE_INTEGER;
      return leftValue - rightValue;
    });

export const detectGovernanceConflicts = ({
  grants,
  migrationNeedsMigration,
  now,
  requests,
}: {
  grants: AdminOperatorRoleGrant[];
  migrationNeedsMigration?: boolean;
  now: string;
  requests: AdminOperatorApprovalRequest[];
}): AdminOperatorGovernanceConflict[] => {
  const conflicts: AdminOperatorGovernanceConflict[] = [];

  const activeGrantGroups = grants
    .filter((grant) => grant.status === "active")
    .reduce<Map<string, AdminOperatorRoleGrant[]>>((accumulator, grant) => {
      const key = buildGrantConflictKey(grant);
      const current = accumulator.get(key) ?? [];
      current.push(grant);
      accumulator.set(key, current);
      return accumulator;
    }, new Map());

  for (const [key, groupedGrants] of activeGrantGroups.entries()) {
    if (groupedGrants.length < 2) {
      continue;
    }

    conflicts.push({
      actionIds: [],
      actors: uniqueStrings(groupedGrants.map((grant) => buildPrincipalLabel(grant))),
      conflictId: buildConflictId("grant_overlap", key),
      detectedAt: now,
      grantIds: groupedGrants.map((grant) => grant.grantId),
      kind: "grant_overlap",
      lineage: groupedGrants.map((grant) => `${grant.roleLabel} on ${buildScopeLabel(grant)}`),
      requestIds: [],
      severity: groupedGrants.some((grant) => grant.grantMode === "emergency_override") ? "critical" : "high",
      summary: `Multiple active grants overlap for ${buildPrincipalLabel(groupedGrants[0])} on ${buildScopeLabel(groupedGrants[0])}.`,
      targetDisplay: groupedGrants[0] ? `${buildPrincipalLabel(groupedGrants[0])} - ${buildScopeLabel(groupedGrants[0])}` : null,
      targetId: groupedGrants[0]?.scopeId ?? null,
      targetType: "operator_role_grant",
    });
  }

  const emergencyGrantGroups = grants
    .filter((grant) => grant.status === "active" && (grant.grantMode === "emergency_override" || grant.role === "emergency_ops"))
    .reduce<Map<string, AdminOperatorRoleGrant[]>>((accumulator, grant) => {
      const key = [buildPrincipalLabel(grant), normalizeText(grant.scopeType), normalizeText(grant.scopeId)].join("|");
      const current = accumulator.get(key) ?? [];
      current.push(grant);
      accumulator.set(key, current);
      return accumulator;
    }, new Map());

  for (const [key, groupedGrants] of emergencyGrantGroups.entries()) {
    if (groupedGrants.length < 2) {
      continue;
    }

    conflicts.push({
      actionIds: [],
      actors: uniqueStrings(groupedGrants.map((grant) => buildPrincipalLabel(grant))),
      conflictId: buildConflictId("emergency_collision", key),
      detectedAt: now,
      grantIds: groupedGrants.map((grant) => grant.grantId),
      kind: "emergency_collision",
      lineage: groupedGrants.map((grant) => `${grant.roleLabel} ${grant.grantMode}`),
      requestIds: [],
      severity: "critical",
      summary: `Emergency access overlaps on ${buildScopeLabel(groupedGrants[0])}.`,
      targetDisplay: groupedGrants[0] ? `${buildPrincipalLabel(groupedGrants[0])} - ${buildScopeLabel(groupedGrants[0])}` : null,
      targetId: groupedGrants[0]?.scopeId ?? null,
      targetType: "operator_role_grant",
    });
  }

  const pendingApprovalGroups = requests
    .filter((request) => request.status === "pending" || request.status === "approved")
    .reduce<Map<string, AdminOperatorApprovalRequest[]>>((accumulator, request) => {
      const key = buildApprovalGroupKey(request);
      const current = accumulator.get(key) ?? [];
      current.push(request);
      accumulator.set(key, current);
      return accumulator;
    }, new Map());

  for (const [key, groupedRequests] of pendingApprovalGroups.entries()) {
    if (groupedRequests.length < 2) {
      continue;
    }

    const kind = buildApprovalGroupKind(groupedRequests[0]);
    conflicts.push({
      actionIds: uniqueStrings(groupedRequests.map((request) => request.actionId)) as AdminOperatorActionId[],
      actors: uniqueStrings(
        groupedRequests.map((request) => request.requesterEmail || request.requesterUserId || "operator"),
      ),
      conflictId: buildConflictId(kind, key),
      detectedAt: now,
      grantIds: [],
      kind,
      lineage: groupedRequests.map(
        (request) => `${request.actionLabel} ${request.status} (${request.requesterEmail || request.requesterUserId || "operator"})`,
      ),
      requestIds: groupedRequests.map((request) => request.id),
      severity: buildApprovalGroupSeverity(kind, groupedRequests.length),
      summary: `Multiple governed actions are targeting ${groupedRequests[0].targetDisplay || groupedRequests[0].targetType} at the same time.`,
      targetDisplay: groupedRequests[0]?.targetDisplay ?? null,
      targetId: groupedRequests[0]?.targetId ?? null,
      targetType: groupedRequests[0]?.targetType ?? "governance_request",
    });
  }

  const tenantViolations = requests.filter((request) => hasTenantIsolationViolation(request));
  for (const request of tenantViolations) {
    const tenantIds = buildRequestTenantIds(request);
    conflicts.push({
      actionIds: [request.actionId],
      actors: uniqueStrings([request.requesterEmail, request.requesterUserId, request.delegatedApprover]),
      conflictId: buildConflictId("tenant_isolation_violation", request.id),
      detectedAt: now,
      grantIds: [],
      kind: "tenant_isolation_violation",
      lineage: uniqueStrings([
        `Boundary tenant ${readBoundary(request).tenantId || "global"}`,
        ...tenantIds.map((tenantId) => `Authority scope tenant ${tenantId}`),
      ]),
      requestIds: [request.id],
      severity: "critical",
      summary: `Tenant isolation mismatch detected for ${request.actionLabel}.`,
      targetDisplay: request.targetDisplay ?? request.id,
      targetId: request.targetId ?? request.id,
      targetType: request.targetType,
    });
  }

  if (migrationNeedsMigration || requests.some((request) => request.stale)) {
    conflicts.push({
      actionIds: [],
      actors: [],
      conflictId: buildConflictId("governance_drift", "global"),
      detectedAt: now,
      grantIds: [],
      kind: "governance_drift",
      lineage: [
        migrationNeedsMigration ? "Legacy assignments still require migration." : null,
        requests.some((request) => request.stale) ? "At least one approval request changed after submission." : null,
      ].filter((value): value is string => Boolean(value)),
      requestIds: requests.filter((request) => request.stale).map((request) => request.id),
      severity: migrationNeedsMigration ? "critical" : "high",
      summary: migrationNeedsMigration
        ? "Governance drift detected between legacy assignments and durable role grants."
        : "Approval drift detected because one or more requests changed after submission.",
      targetDisplay: "Governance runtime",
      targetId: null,
      targetType: "governance_runtime",
    });
  }

  return conflicts;
};

export const buildGovernanceSynchronization = ({
  consistency,
  conflicts,
  requests,
}: {
  consistency: Pick<AdminOperatorGovernanceSynchronization, "governanceVersion">;
  conflicts: AdminOperatorGovernanceConflict[];
  requests: AdminOperatorApprovalRequest[];
}): AdminOperatorGovernanceSynchronization => {
  const staleApprovalCount = requests.filter((request) => request.stale).length;
  const tenantConsistencyGaps = requests.filter((request) => hasTenantIsolationViolation(request)).length;
  const driftAlertCount =
    conflicts.filter((conflict) => conflict.kind === "governance_drift").length + staleApprovalCount;
  const invalidatedSnapshots = staleApprovalCount + conflicts.filter((conflict) => conflict.kind === "governance_drift").length;
  const propagationHealth =
    tenantConsistencyGaps > 0 || driftAlertCount > 2
      ? "critical"
      : staleApprovalCount > 0 || driftAlertCount > 0
        ? "warning"
        : "healthy";

  return {
    driftAlertCount,
    governanceVersion: consistency.governanceVersion,
    invalidatedSnapshots,
    propagationHealth,
    propagationHealthSummary:
      propagationHealth === "critical"
        ? "Policy propagation needs intervention before more delegated actions execute."
        : propagationHealth === "warning"
          ? "Policy propagation is degraded and should be watched for stale snapshots."
          : "Policy propagation is healthy across the current approval set.",
    staleApprovalCount,
    tenantConsistencyGaps,
  };
};

export const buildGovernanceCoordination = ({
  grants,
  incidents = [],
  requests,
}: {
  grants: AdminOperatorRoleGrant[];
  incidents?: AdminIncidentGroup[];
  requests: AdminOperatorApprovalRequest[];
}): AdminOperatorGovernanceCoordination => {
  const activeGrants = grants.filter((grant) => grant.status === "active");
  const operatorState = new Map<
    string,
    {
      availability: AdminOperatorRoleGrant["availability"];
      backupOperator: string | null;
      capacity: number;
      regions: string[];
    }
  >();

  for (const grant of activeGrants) {
    const principal = buildPrincipalLabel(grant);
      const current = operatorState.get(principal) ?? {
        availability: null,
        backupOperator: null,
        capacity: 0,
        regions: [],
      };

      current.availability = current.availability ?? grant.availability ?? null;
      current.backupOperator = current.backupOperator ?? grant.availability?.backupOperator ?? null;
      current.capacity = Math.max(current.capacity, grant.availability?.workloadCapacity ?? 0);
    current.regions = uniqueStrings([
      ...current.regions,
      ...(grant.availability?.regions ?? []),
      readBoundary(grant).regionLabel,
      readBoundary(grant).regionId,
    ]);
    operatorState.set(principal, current);
  }

  const handoffs = incidents
    .flatMap((incident) =>
      (incident.ownershipTransitions ?? []).map((transition) => ({
        actorEmail: transition.actorEmail,
        at: transition.at,
        from: transition.from,
        incidentKey: incident.incidentKey,
        note: transition.note,
        requestId: incident.approvalLinkedRequestIds?.[0] ?? null,
        scopeSummary: uniqueStrings([
          incident.tenantLabel || incident.tenantId,
          incident.organizationLabel,
          incident.teamLabel,
          incident.regionLabel,
        ]),
        to: transition.to,
        type: transition.type === "assignment" ? "assignment" : transition.type,
      })),
    )
    .sort((left, right) => right.at.localeCompare(left.at));

  const escalationLineage = requests
    .filter((request) => request.escalationChain.length > 0)
    .map((request) => ({
      afterHours: request.escalationChain.some((step) => normalizeLower(step.reason).includes("after hours")),
      incidentKey: request.linkedIncidentKey ?? null,
      requestId: request.id,
      route: request.escalationChain.map((step) =>
        [step.from || "origin", step.to || "reviewer", step.reason || step.status].filter(Boolean).join(" -> "),
      ),
      scopeSummary: buildRequestScopeSummary(request),
      tenantId: readBoundary(request).tenantId,
    }));

  const ownershipGaps = incidents
    .filter((incident) => incident.unresolvedOwnership)
    .map((incident) => ({
      incidentKey: incident.incidentKey,
      reason: incident.ownerEmail
        ? "Ownership is transitioning and needs confirmation."
        : "Incident is unresolved without a clear owner.",
      scopeSummary: uniqueStrings([
        incident.tenantLabel || incident.tenantId,
        incident.organizationLabel,
        incident.teamLabel,
        incident.regionLabel,
      ]),
      severity: incident.severity === "CRITICAL" ? "critical" : incident.escalationLevel > 0 ? "high" : "medium",
    }));

  const regionalFailovers = incidents
    .flatMap((incident) =>
      (incident.regionalFailoverEvents ?? []).map((event) => ({
        at: event.at,
        fromRegion: event.fromRegion,
        incidentKey: incident.incidentKey,
        note: event.note,
        toRegion: event.toRegion,
      })),
    )
    .sort((left, right) => right.at.localeCompare(left.at));

  const ownedIncidentCounts = new Map<string, number>();
  const delegatedRemediationCounts = new Map<string, number>();
  const pendingApprovalCounts = new Map<string, number>();

  for (const incident of incidents) {
    if (incident.ownerEmail) {
      ownedIncidentCounts.set(incident.ownerEmail, (ownedIncidentCounts.get(incident.ownerEmail) ?? 0) + 1);
    }

    if (incident.delegatedRemediatorEmail) {
      delegatedRemediationCounts.set(
        incident.delegatedRemediatorEmail,
        (delegatedRemediationCounts.get(incident.delegatedRemediatorEmail) ?? 0) + 1,
      );
    }
  }

  for (const request of requests.filter((request) => request.status === "pending")) {
    const assignees = uniqueStrings([
      request.delegatedApprover,
      request.fallbackApprover,
      request.outOfOfficeDelegate,
      request.requesterEmail,
      ...request.delegationHistory.map((entry) => entry.delegatedTo),
    ]);

    for (const principal of assignees) {
      pendingApprovalCounts.set(principal, (pendingApprovalCounts.get(principal) ?? 0) + 1);
    }
  }

  const knownPrincipals = new Set<string>([
    ...operatorState.keys(),
    ...ownedIncidentCounts.keys(),
    ...delegatedRemediationCounts.keys(),
    ...pendingApprovalCounts.keys(),
  ]);

  const operatorLoads = [...knownPrincipals]
    .map((principal) => {
      const base = operatorState.get(principal) ?? {
        availability: null,
        backupOperator: null,
        capacity: 0,
        regions: [],
      };
      const activeIncidents = ownedIncidentCounts.get(principal) ?? 0;
      const delegatedRemediations = delegatedRemediationCounts.get(principal) ?? 0;
      const pendingApprovals = pendingApprovalCounts.get(principal) ?? 0;
      const totalLoad = activeIncidents + delegatedRemediations + pendingApprovals;
      const capacity = Math.max(1, base.capacity || 6);
      const utilizationPercent = Number(((totalLoad / capacity) * 100).toFixed(2));

      return {
        activeIncidents,
        backupOperator: base.backupOperator,
        capacity,
        delegatedRemediations,
        overloaded: utilizationPercent >= 100 || pendingApprovals >= 3,
        pendingApprovals,
        principal,
        regions: base.regions,
        shiftState: base.availability?.status ?? "unknown",
        utilizationPercent,
      };
    })
    .sort((left, right) => right.utilizationPercent - left.utilizationPercent || left.principal.localeCompare(right.principal));

  const heatmapSource = new Map<string, AdminOperatorGovernanceCoordination["loadBalancing"]["heatmap"][number]>();
  for (const load of operatorLoads) {
    const label = load.regions[0] || "Global";
    const key = `region:${label}`;
    const current = heatmapSource.get(key) ?? {
      activeIncidents: 0,
      availableOperators: 0,
      key,
      label,
      pendingApprovals: 0,
      utilizationPercent: 0,
    };
    current.activeIncidents += load.activeIncidents;
    current.pendingApprovals += load.pendingApprovals;
    current.availableOperators += load.shiftState === "away" || load.shiftState === "offline" ? 0 : 1;
    current.utilizationPercent = Number(
      (
        (current.utilizationPercent * Math.max(current.availableOperators - 1, 0) + load.utilizationPercent) /
        Math.max(current.availableOperators, 1)
      ).toFixed(2),
    );
    heatmapSource.set(key, current);
  }

  const afterHoursEscalations =
    incidents.filter((incident) => incident.afterHoursEscalated).length +
    escalationLineage.filter((route) => route.afterHours).length;

  return {
    escalationLineage,
    followTheSun: {
      activeTimezones: uniqueStrings(
        activeGrants.map((grant) => grant.availability?.timezone ?? null),
      ),
      afterHoursEscalations,
      backupRoutings:
        requests.filter((request) => request.fallbackApprover || request.outOfOfficeDelegate).length +
        incidents.filter((incident) => incident.backupOwnerEmail).length,
      regionalOperators: new Set(
        activeGrants
          .map((grant) => grant.availability?.regions?.[0] ?? readBoundary(grant).regionId ?? readBoundary(grant).regionLabel)
          .filter((value): value is string => Boolean(value)),
      ).size,
      standbyOperators: activeGrants.filter((grant) => grant.availability?.standby).length,
    },
    handoffs,
    loadBalancing: {
      approvalQueueBalanceScore: buildBalanceScore(operatorLoads.map((load) => load.pendingApprovals)),
      escalationOverloadDetected: operatorLoads.some((load) => load.overloaded) || afterHoursEscalations > 0,
      heatmap: [...heatmapSource.values()].sort((left, right) => left.label.localeCompare(right.label)),
      incidentBalanceScore: buildBalanceScore(operatorLoads.map((load) => load.activeIncidents)),
      operatorLoads,
    },
    ownershipGaps,
    regionalFailovers,
  };
};

export const buildGovernanceAnalytics = ({
  activeElevations,
  conflicts,
  coordination,
  requests,
  synchronization,
}: {
  activeElevations: AdminOperatorActiveElevation[];
  conflicts: AdminOperatorGovernanceConflict[];
  coordination: AdminOperatorGovernanceCoordination;
  requests: AdminOperatorApprovalRequest[];
  synchronization: AdminOperatorGovernanceSynchronization;
}): AdminOperatorGovernanceAnalytics => {
  const approvalLatencies = requests
    .map((request) => {
      if (!request.approvedAt) {
        return Number.NaN;
      }

      const createdAtMs = Date.parse(request.createdAt);
      const approvedAtMs = Date.parse(request.approvedAt);
      if (!Number.isFinite(createdAtMs) || !Number.isFinite(approvedAtMs) || approvedAtMs < createdAtMs) {
        return Number.NaN;
      }

      return (approvedAtMs - createdAtMs) / 60_000;
    })
    .filter(Number.isFinite);
  const delegatedRequestCount = requests.filter((request) =>
    request.delegationHistory.length > 0 || request.approvals.some((decision) => decision.isDelegated),
  ).length;
  const emergencyCount =
    requests.filter((request) => request.emergencyBypassUsed).length +
    activeElevations.filter((elevation) =>
      elevation.historySummary.some((entry) => normalizeLower(entry).includes("emergency")),
    ).length;

  return {
    approvalLatencyMinutes: {
      average: average(approvalLatencies),
      p95: percentile(approvalLatencies, 0.95),
    },
    delegationUtilizationRate:
      requests.length > 0 ? Number(((delegatedRequestCount / requests.length) * 100).toFixed(2)) : 0,
    emergencyOverrideFrequency:
      requests.length + activeElevations.length > 0
        ? Number(((emergencyCount / Math.max(1, requests.length + activeElevations.length)) * 100).toFixed(2))
        : 0,
    escalationBottlenecks: requests.filter((request) => request.status === "pending" && (request.partialApprovals || request.escalationChain.length > 0)).length,
    governanceDriftAlerts: synchronization.driftAlertCount,
    operatorWorkload: {
      overloaded: coordination.loadBalancing.operatorLoads.filter((load) => load.overloaded).length,
      totalOperators: coordination.loadBalancing.operatorLoads.length,
    },
    tenantIsolationViolations: conflicts.filter((conflict) => conflict.kind === "tenant_isolation_violation").length,
    unresolvedOwnershipIncidents: coordination.ownershipGaps.length,
  };
};

export const buildGovernanceAlerts = ({
  activeElevations,
  coordination,
  conflicts,
  migrationNeedsMigration,
  now,
  requests,
  synchronization,
}: {
  activeElevations: AdminOperatorActiveElevation[];
  coordination?: AdminOperatorGovernanceCoordination;
  conflicts: AdminOperatorGovernanceConflict[];
  migrationNeedsMigration?: boolean;
  now: string;
  requests: AdminOperatorApprovalRequest[];
  synchronization?: AdminOperatorGovernanceSynchronization;
}): AdminOperatorGovernanceAlert[] => {
  const alerts: AdminOperatorGovernanceAlert[] = [];
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const emergencyConflicts = conflicts.filter(
    (conflict) => conflict.kind === "emergency_collision" || conflict.kind === "maintenance_collision",
  );

  if (activeElevations.length >= 3) {
    alerts.push({
      alertId: "suspicious-elevation-spike",
      category: "suspicious_elevation_spike",
      detail: `${activeElevations.length} temporary or emergency grants are active at once.`,
      detectedAt: now,
      severity: activeElevations.length >= 5 ? "critical" : "high",
      summary: "Temporary access volume is elevated.",
    });
  }

  if (pendingRequests.some((request) => request.partialApprovals)) {
    alerts.push({
      alertId: "approval-bottleneck",
      category: "approval_bottleneck",
      detail: "Pending approvals have already collected at least one decision and now need coordinated follow-through.",
      detectedAt: now,
      severity: "medium",
      summary: "Approval workflow bottlenecks are forming.",
    });
  }

  if (requests.some((request) => request.emergencyBypassUsed) || activeElevations.some((elevation) => elevation.historySummary.some((entry) => entry.includes("emergency")))) {
    alerts.push({
      alertId: "excessive-override",
      category: "excessive_override",
      detail: "Emergency or override pathways are active and should be reviewed for coordinated rollback.",
      detectedAt: now,
      severity: "high",
      summary: "Override pressure is elevated.",
    });
  }

  if (emergencyConflicts.length) {
    alerts.push({
      alertId: "emergency-toggle-storm",
      category: "emergency_toggle_storm",
      detail: `${emergencyConflicts.length} emergency or maintenance conflicts were detected in the active governance set.`,
      detectedAt: now,
      severity: "critical",
      summary: "Emergency controls are competing with each other.",
    });
  }

  if (migrationNeedsMigration || conflicts.some((conflict) => conflict.kind === "governance_drift")) {
    alerts.push({
      alertId: "governance-drift",
      category: "governance_drift",
      detail: "Durable grants and live review state need reconciliation before more authority changes land.",
      detectedAt: now,
      severity: migrationNeedsMigration ? "critical" : "high",
      summary: "Governance drift needs operator attention.",
    });
  }

  if (activeElevations.some((elevation) => elevation.countdownSeconds == null)) {
    alerts.push({
      alertId: "privilege-escalation-anomaly",
      category: "privilege_escalation_anomaly",
      detail: "At least one elevated grant has no clear expiry boundary.",
      detectedAt: now,
      severity: "critical",
      summary: "An elevation is missing a reliable revoke boundary.",
    });
  }

  if (coordination?.loadBalancing.operatorLoads.some((load) => load.overloaded)) {
    alerts.push({
      alertId: "operator-overload",
      category: "operator_overload",
      detail: "One or more operators own more incident or approval work than their declared capacity.",
      detectedAt: now,
      severity: "high",
      summary: "Operator workload is imbalanced.",
    });
  }

  if (coordination?.ownershipGaps.length) {
    alerts.push({
      alertId: "unowned-incident-risk",
      category: "unowned_incident_risk",
      detail: `${coordination.ownershipGaps.length} unresolved incidents do not have a clear owner.`,
      detectedAt: now,
      severity: coordination.ownershipGaps.some((gap) => gap.severity === "critical") ? "critical" : "high",
      summary: "Incident ownership needs immediate coordination.",
    });
  }

  if (synchronization && synchronization.propagationHealth !== "healthy") {
    alerts.push({
      alertId: "policy-sync-degraded",
      category: "policy_sync_degraded",
      detail: synchronization.propagationHealthSummary,
      detectedAt: now,
      severity: synchronization.propagationHealth === "critical" ? "critical" : "high",
      summary: "Governance policy synchronization is degraded.",
    });
  }

  if (conflicts.some((conflict) => conflict.kind === "tenant_isolation_violation")) {
    alerts.push({
      alertId: "tenant-isolation-violation",
      category: "tenant_isolation_violation",
      detail: "At least one governed workflow spans mismatched tenant boundaries.",
      detectedAt: now,
      severity: "critical",
      summary: "Tenant isolation leakage was detected.",
    });
  }

  return alerts;
};

export const buildGovernanceVisibility = ({
  activeElevations,
  alerts,
  coordination,
  conflicts,
  requests,
  synchronization,
}: {
  activeElevations: AdminOperatorActiveElevation[];
  alerts: AdminOperatorGovernanceAlert[];
  coordination?: AdminOperatorGovernanceCoordination;
  conflicts: AdminOperatorGovernanceConflict[];
  requests: AdminOperatorApprovalRequest[];
  synchronization?: AdminOperatorGovernanceSynchronization;
}): AdminOperatorGovernanceVisibility => {
  const staleApprovalCount = requests.filter((request) => request.stale).length;
  const criticalConflictCount = conflicts.filter((conflict) => conflict.severity === "critical").length;
  const delegatedApprovals = requests.filter((request) =>
    request.delegationHistory.length > 0 || request.approvals.some((decision) => decision.isDelegated),
  ).length;
  const crossTeamEscalations = coordination?.escalationLineage.length ?? requests.filter((request) => {
    const scopeSummary = buildRequestScopeSummary(request).join(" ");
    return request.escalationChain.length > 0 || /team\s+/i.test(scopeSummary);
  }).length;
  const scopedOperators = new Set(
    activeElevations
      .filter((elevation) => buildScopeBoundarySummary({ boundary: readBoundary(elevation) }) !== "Global boundary")
      .map((elevation) => `${elevation.principal}|${buildBoundaryKey(readBoundary(elevation))}`),
  ).size;
  const tenantIsolations = new Set(
    requests
      .map((request) => readBoundary(request).tenantId)
      .filter((value): value is string => Boolean(value)),
  ).size;

  return {
    activeElevations: activeElevations.length,
    afterHoursEscalations: coordination?.followTheSun.afterHoursEscalations ?? 0,
    conflictingActions: conflicts.length,
    crossTeamEscalations,
    delegatedApprovals,
    emergencyStates: activeElevations.filter((elevation) =>
      elevation.historySummary.some((entry) => normalizeLower(entry).includes("emergency")),
    ).length,
    governanceDrift: conflicts.filter((conflict) => conflict.kind === "governance_drift").length,
    overloadedOperators: coordination?.loadBalancing.operatorLoads.filter((load) => load.overloaded).length ?? 0,
    pendingApprovals: requests.filter((request) => request.status === "pending").length,
    policyPropagationHealth: synchronization?.propagationHealth ?? "healthy",
    roleAssignmentHealth:
      criticalConflictCount > 0
        ? "critical"
        : alerts.some((alert) =>
            [
              "approval_bottleneck",
              "governance_drift",
              "operator_overload",
              "policy_sync_degraded",
              "unowned_incident_risk",
            ].includes(alert.category),
          )
        ? "warning"
        : "healthy",
    scopedOperators,
    staleApprovalCount,
    tenantIsolations,
    tenantIsolationViolations: conflicts.filter((conflict) => conflict.kind === "tenant_isolation_violation").length,
    unresolvedOwnership: coordination?.ownershipGaps.length ?? 0,
  };
};

export const buildGovernanceDirectory = ({
  activeElevations,
  grants,
  requests,
}: {
  activeElevations: AdminOperatorActiveElevation[];
  grants: AdminOperatorRoleGrant[];
  requests: AdminOperatorApprovalRequest[];
}): AdminOperatorGovernanceDirectory => {
  const activeGrantSet = grants.filter((grant) => grant.status === "active");
  const operatorMap = activeGrantSet.reduce<Map<string, AdminOperatorGovernanceDirectory["activeOperators"][number]>>(
    (accumulator, grant) => {
      const principal = buildPrincipalLabel(grant);
      const current = accumulator.get(principal) ?? {
        activeElevationCount: 0,
        activeGrantCount: 0,
        availability: null,
        boundarySummary: [],
        delegatedRoleCount: 0,
        departments: [],
        governanceDomains: [],
        organizations: [],
        operationalGroups: [],
        pendingApprovalCount: 0,
        principal,
        roles: [],
        teams: [],
        tenantIds: [],
      };

      current.activeGrantCount += 1;
      current.availability = current.availability ?? grant.availability ?? null;
      current.boundarySummary = uniqueStrings([...current.boundarySummary, ...buildScopeSummary(grant)]);
      current.departments = mergeStringList(
        current.departments,
        readBoundary(grant).departmentLabel || readBoundary(grant).departmentId,
      );
      current.organizations = mergeStringList(
        current.organizations,
        readBoundary(grant).organizationLabel || readBoundary(grant).organizationId,
      );
      current.operationalGroups = mergeStringList(
        current.operationalGroups,
        readBoundary(grant).operationalGroupLabel || readBoundary(grant).operationalGroupId,
      );
      current.roles = uniqueStrings([...current.roles, grant.roleLabel]);
      current.teams = mergeStringList(current.teams, readBoundary(grant).teamLabel || readBoundary(grant).teamId);
      current.tenantIds = mergeStringList(current.tenantIds, readBoundary(grant).tenantLabel || readBoundary(grant).tenantId);
      if (readBoundary(grant).governanceDomain) {
        current.governanceDomains = [...new Set([...current.governanceDomains, readBoundary(grant).governanceDomain])];
      }

      accumulator.set(principal, current);
      return accumulator;
    },
    new Map(),
  );

  for (const elevation of activeElevations) {
    const current = operatorMap.get(elevation.principal);
    if (!current) {
      continue;
    }

    current.activeElevationCount += 1;
  }

  for (const request of requests.filter((entry) => entry.status === "pending")) {
    const principal = normalizeText(request.requesterEmail) || normalizeText(request.requesterUserId) || "operator";
    const current = operatorMap.get(principal);
    if (current) {
      current.pendingApprovalCount += 1;
    }

    for (const delegation of request.delegationHistory) {
      const delegatedPrincipal = normalizeText(delegation.delegatedTo);
      if (!delegatedPrincipal) {
        continue;
      }

      const delegatedOperator = operatorMap.get(delegatedPrincipal);
      if (!delegatedOperator) {
        continue;
      }

      delegatedOperator.delegatedRoleCount += 1;
    }
  }

  const ownershipKinds = [
    ["tenant", "tenantLabel", "tenantId"],
    ["organization", "organizationLabel", "organizationId"],
    ["department", "departmentLabel", "departmentId"],
    ["team", "teamLabel", "teamId"],
    ["operational_group", "operationalGroupLabel", "operationalGroupId"],
    ["governance_domain", "governanceDomain", "governanceDomain"],
  ] as const;

  const ownershipMap = new Map<string, AdminOperatorGovernanceDirectory["teamOwnership"][number]>();
  for (const grant of activeGrantSet) {
    const principal = buildPrincipalLabel(grant);
    const boundary = readBoundary(grant);
    for (const [kind, labelKey, idKey] of ownershipKinds) {
      const rawLabel = normalizeText(boundary[labelKey]);
      const rawId = normalizeText(boundary[idKey]);
      const label = rawLabel || rawId;
      if (!label) {
        continue;
      }

      const key = `${kind}:${label}`;
      const current = ownershipMap.get(key) ?? {
        kind,
        key,
        label,
        principalCount: 0,
        principals: [],
        scopeSummary: [],
      };

      current.principals = uniqueStrings([...current.principals, principal]);
      current.principalCount = current.principals.length;
      current.scopeSummary = uniqueStrings([...current.scopeSummary, ...buildScopeSummary(grant)]);
      ownershipMap.set(key, current);
    }
  }

  const delegatedRoles = requests
    .flatMap((request) => {
      const history = request.delegationHistory.length
        ? request.delegationHistory
        : request.delegatedApprover || request.fallbackApprover || request.outOfOfficeDelegate
          ? [{
              approvalRequestId: request.id,
              at: request.escalatedAt ?? request.createdAt,
              delegatedBy: request.requesterEmail || request.requesterUserId || "operator",
              delegatedTo: request.delegatedApprover ?? null,
              mode:
                request.outOfOfficeDelegate
                  ? "out_of_office"
                  : request.fallbackApprover
                    ? "fallback"
                    : "delegated",
              note: request.reason,
              scopeSummary: buildRequestScopeSummary(request),
            }]
          : [];

      return history.map((entry, index) => ({
        approvalRequestId: entry.approvalRequestId ?? request.id,
        delegatedBy: entry.delegatedBy,
        delegatedTo: entry.delegatedTo,
        fallbackApprover: request.fallbackApprover ?? null,
        id: `${request.id}:delegation:${index + 1}`,
        outOfOfficeDelegate: request.outOfOfficeDelegate ?? null,
        scopeSummary: entry.scopeSummary.length ? entry.scopeSummary : buildRequestScopeSummary(request),
        status: request.status === "pending" ? "active" : "historical",
      }));
    })
    .filter((entry) => entry.delegatedBy || entry.delegatedTo || entry.fallbackApprover || entry.outOfOfficeDelegate);

  const pendingApprovals = requests
    .filter((request) => request.status === "pending")
    .map((request) => ({
      actionLabel: request.actionLabel,
      delegatedApprover: request.delegatedApprover ?? null,
      fallbackApprover: request.fallbackApprover ?? null,
      requestId: request.id,
      requester: request.requesterEmail || request.requesterUserId || "operator",
      scopeSummary: buildRequestScopeSummary(request),
      status: request.status,
    }));

  const escalationChains = requests
    .filter((request) => request.escalationChain.length > 0 || request.escalationRule)
    .map((request) => ({
      requestId: request.id,
      scopeSummary: buildRequestScopeSummary(request),
      status: request.status,
      steps: request.escalationChain.length
        ? request.escalationChain.map((step) =>
            [step.from || "origin", step.to || "reviewer", step.reason || step.status].filter(Boolean).join(" -> "),
          )
        : [request.escalationRule || "Escalation configured"],
    }));

  return {
    activeOperators: [...operatorMap.values()].sort((left, right) => left.principal.localeCompare(right.principal)),
    activeElevations,
    delegatedRoles,
    escalationChains,
    pendingApprovals,
    teamOwnership: [...ownershipMap.values()].sort((left, right) => left.label.localeCompare(right.label)),
  };
};

export const buildGovernanceForensics = ({
  auditEvents = [],
  incidents = [],
  requests,
}: {
  auditEvents?: Array<{
    action?: string | null;
    actorEmail?: string | null;
    createdAt?: string | null;
    metadata?: Record<string, unknown> | null;
    targetType?: string | null;
  }>;
  incidents?: AdminIncidentGroup[];
  requests: AdminOperatorApprovalRequest[];
}): AdminOperatorGovernanceForensics => {
  const records = [
    ...requests
      .filter((request) => request.delegationHistory.length > 0 || request.approvals.some((decision) => decision.isDelegated))
      .map((request) => ({
        actors: uniqueStrings([
          request.requesterEmail,
          ...request.delegationHistory.flatMap((entry) => [entry.delegatedBy, entry.delegatedTo]),
          ...request.approvals.flatMap((decision) => [decision.actorEmail, decision.delegatedBy]),
        ]),
        category: "delegated_approval" as const,
        occurredAt: request.escalatedAt ?? request.createdAt,
        requestId: request.id,
        scopeSummary: buildRequestScopeSummary(request),
        summary: `Delegated approval recorded for ${request.actionLabel}.`,
        tenantId: readBoundary(request).tenantId,
        trace: uniqueStrings([
          request.reason,
          ...request.delegationHistory.map((entry) => entry.note),
          ...request.lineageSummary ?? [],
        ]),
      })),
    ...requests
      .filter((request) => request.escalationChain.length > 0)
      .map((request) => ({
        actors: uniqueStrings([
          request.requesterEmail,
          ...request.escalationChain.flatMap((step) => [step.from, step.to]),
        ]),
        category: "cross_team_escalation" as const,
        occurredAt: request.escalatedAt ?? request.createdAt,
        requestId: request.id,
        scopeSummary: buildRequestScopeSummary(request),
        summary: `Cross-team escalation tracked for ${request.actionLabel}.`,
        tenantId: readBoundary(request).tenantId,
        trace: request.escalationChain.map((step) =>
          [step.from || "origin", step.to || "reviewer", step.reason || step.status].filter(Boolean).join(" -> "),
        ),
      })),
    ...requests
      .filter((request) => request.emergencyBypassUsed && readBoundary(request).tenantId)
      .map((request) => ({
        actors: uniqueStrings([request.requesterEmail, request.delegatedApprover, request.fallbackApprover]),
        category: "tenant_override" as const,
        occurredAt: request.approvedAt ?? request.createdAt,
        requestId: request.id,
        scopeSummary: buildRequestScopeSummary(request),
        summary: `Tenant-scoped override executed for ${request.actionLabel}.`,
        tenantId: readBoundary(request).tenantId,
        trace: uniqueStrings([request.reason, ...request.lineageSummary ?? []]),
      })),
    ...requests
      .filter((request) => request.linkedIncidentKey && Boolean(readBoundary(request).organizationId || readBoundary(request).teamId))
      .map((request) => ({
        actors: uniqueStrings([request.requesterEmail, request.delegatedApprover, request.fallbackApprover]),
        category: "organization_incident" as const,
        occurredAt: request.createdAt,
        requestId: request.id,
        scopeSummary: buildRequestScopeSummary(request),
        summary: `Organization-scoped incident workflow linked to ${request.linkedIncidentKey}.`,
        tenantId: readBoundary(request).tenantId,
        trace: uniqueStrings([request.linkedIncidentKey, request.reason]),
      })),
    ...incidents
      .flatMap((incident) =>
        (incident.ownershipTransitions ?? []).map((transition) => ({
          actors: uniqueStrings([transition.actorEmail, transition.from, transition.to]),
          category: "ownership_transition" as const,
          occurredAt: transition.at,
          requestId: incident.approvalLinkedRequestIds?.[0] ?? null,
          scopeSummary: uniqueStrings([
            incident.tenantLabel || incident.tenantId,
            incident.organizationLabel,
            incident.teamLabel,
            incident.regionLabel,
          ]),
          summary: `Ownership transitioned for incident ${incident.incidentKey}.`,
          tenantId: incident.tenantId ?? null,
          trace: uniqueStrings([transition.type, transition.note, transition.from, transition.to]),
        })),
      ),
    ...incidents
      .filter((incident) => Boolean(incident.delegatedRemediatorEmail))
      .map((incident) => ({
        actors: uniqueStrings([incident.ownerEmail, incident.delegatedRemediatorEmail]),
        category: "delegated_remediation" as const,
        occurredAt: incident.lastSeenAt ?? incident.firstSeenAt ?? new Date().toISOString(),
        requestId: incident.approvalLinkedRequestIds?.[0] ?? null,
        scopeSummary: uniqueStrings([
          incident.tenantLabel || incident.tenantId,
          incident.organizationLabel,
          incident.teamLabel,
          incident.regionLabel,
        ]),
        summary: `Delegated remediation was linked to incident ${incident.incidentKey}.`,
        tenantId: incident.tenantId ?? null,
        trace: uniqueStrings([
          incident.delegatedRemediatorEmail,
          ...(incident.governanceActionIds ?? []),
          ...(incident.approvalLinkedRequestIds ?? []),
        ]),
      })),
    ...incidents
      .flatMap((incident) =>
        (incident.regionalFailoverEvents ?? []).map((event) => ({
          actors: uniqueStrings([event.actorEmail, incident.ownerEmail, incident.backupOwnerEmail]),
          category: "regional_failover" as const,
          occurredAt: event.at,
          requestId: incident.approvalLinkedRequestIds?.[0] ?? null,
          scopeSummary: uniqueStrings([
            incident.tenantLabel || incident.tenantId,
            incident.organizationLabel,
            incident.teamLabel,
            event.fromRegion,
            event.toRegion,
          ]),
          summary: `Regional failover was recorded for incident ${incident.incidentKey}.`,
          tenantId: incident.tenantId ?? null,
          trace: uniqueStrings([event.fromRegion, event.toRegion, event.note]),
        })),
      ),
    ...auditEvents
      .filter((event) =>
        normalizeLower(event.action).includes("impersonation") ||
        normalizeLower(event.targetType).includes("impersonation"),
      )
      .map((event) => {
        const metadata = event.metadata ?? {};
        return {
          actors: uniqueStrings([event.actorEmail, String(metadata.real_user_email ?? ""), String(metadata.actor_email ?? "")]),
          category: "scoped_impersonation" as const,
          occurredAt: normalizeText(event.createdAt) || new Date().toISOString(),
          requestId: normalizeText(String(metadata.approval_request_id ?? "")) || null,
          scopeSummary: uniqueStrings([
            normalizeText(String(metadata.target_library_id ?? "")),
            normalizeText(String(metadata.request_path ?? "")),
            normalizeText(String(metadata.tenant_label ?? metadata.tenant_id ?? "")),
          ]),
          summary: "Scoped impersonation activity was recorded in the governance audit trail.",
          tenantId: normalizeText(String(metadata.tenant_id ?? "")) || null,
          trace: uniqueStrings([
            normalizeText(event.action),
            normalizeText(String(metadata.request_path ?? "")),
            normalizeText(String(metadata.reason ?? "")),
          ]),
        };
      }),
  ];

  return {
    records,
    summary: {
      crossTeamEscalations: records.filter((record) => record.category === "cross_team_escalation").length,
      delegatedApprovals: records.filter((record) => record.category === "delegated_approval").length,
      delegatedRemediations: records.filter((record) => record.category === "delegated_remediation").length,
      organizationIncidents: records.filter((record) => record.category === "organization_incident").length,
      ownershipTransitions: records.filter((record) => record.category === "ownership_transition").length,
      regionalFailovers: records.filter((record) => record.category === "regional_failover").length,
      scopedImpersonations: records.filter((record) => record.category === "scoped_impersonation").length,
      tenantOverrides: records.filter((record) => record.category === "tenant_override").length,
    },
  };
};
