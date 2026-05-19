import type {
  AdminOperatorActionId,
  AdminOperatorAvailabilityProfile,
  AdminOperatorApprovalPolicy,
  AdminOperatorGovernanceDomain,
  AdminOperatorGrantMode,
  AdminOperatorGrantRestrictions,
  AdminOperatorPage,
  AdminOperatorPermission,
  AdminOperatorPermissionExplanation,
  AdminOperatorRole,
  AdminOperatorScope,
  AdminOperatorScopeBoundary,
  AdminOperatorScopeType,
} from "./governance.js";

export type StructuredApiResponse<T> = {
  success: boolean;
  message: string;
  data: T | null;
  errorCode: string | null;
};

export type AdminOperatorContext = {
  activeGrantCount?: number;
  activeGrants?: AdminOperatorRoleGrant[];
  actorEmail: string | null;
  actorUserId: string;
  allowedPages: AdminOperatorPage[];
  emergencyAccessActive?: boolean;
  legacyFallbackAccess: boolean;
  permissions: AdminOperatorPermission[];
  policyVersion: string;
  readOnlyActive?: boolean;
  roles: AdminOperatorRole[];
  temporaryElevationActive?: boolean;
};

export type AdminOperatorImpactLine = {
  after: string | null;
  before: string | null;
  detail?: string | null;
  label: string;
};

export type AdminOperatorPlaybook = {
  guidance: string;
  key: string;
  severity: "critical" | "info" | "warning";
  title: string;
};

export type AdminOperatorAffectedEntity = {
  id: string;
  kind: string;
  label: string;
  status?: string | null;
};

export type AdminOperatorFinancialImpact = {
  amount: number | null;
  currency: string;
  summary: string;
};

export type AdminOperatorBlastRadius = {
  affectedCount: number;
  scope: "bulk" | "limited" | "single";
  summary: string;
};

export type AdminOperatorRecentAction = {
  action: string;
  actorEmail: string | null;
  id: string;
  occurredAt: string;
  summary: string;
};

export type AdminOperatorRelatedIncident = {
  incidentKey: string;
  lastSeenAt: string | null;
  latestMessage: string | null;
  severity: AdminIncidentGroup["severity"];
  status: "acknowledged" | "open" | "resolved";
};

export type AdminOperatorGovernanceReview = {
  approvalExpiresAt?: string | null;
  approvalChainMode?: "chained" | "emergency_bypass" | "quorum" | "single";
  approvedCount?: number;
  approvalPolicy?: AdminOperatorApprovalPolicy;
  approvalRequestId?: string | null;
  approvalStageCount?: number;
  approvalStatus?: "approved" | "expired" | "not_required" | "pending" | "rejected";
  confirmationRequired: boolean;
  cooldownSeconds: number;
  emergencyBypassEligible?: boolean;
  governanceVersion?: string | null;
  linkedIncidentKey?: string | null;
  partialApprovalCount?: number;
  reasonRequired: boolean;
  secondApproverOptional: boolean;
  typedConfirmationLabel: string | null;
  consistencyAt?: string | null;
};

export type AdminOperatorGrantStatus = "active" | "expired" | "revoked" | "scheduled";

export type AdminOperatorDelegationRecord = {
  approvalRequestId: string | null;
  at: string | null;
  delegatedBy: string | null;
  delegatedTo: string | null;
  mode: "delegated" | "escalated" | "fallback" | "out_of_office";
  note: string | null;
  scopeSummary: string[];
};

export type AdminOperatorEscalationHop = {
  at: string | null;
  from: string | null;
  reason: string | null;
  scopeSummary: string[];
  status: "completed" | "pending";
  to: string | null;
};

export type AdminOperatorRoleGrant = {
  availability: AdminOperatorAvailabilityProfile | null;
  boundary: AdminOperatorScopeBoundary;
  conflictWarnings: string[];
  createdAt: string | null;
  email: string | null;
  effectivePermissions: AdminOperatorPermission[];
  expiresAt: string | null;
  grantId: string;
  grantMode: AdminOperatorGrantMode;
  inheritedRoles: AdminOperatorRole[];
  reason: string | null;
  restrictions: AdminOperatorGrantRestrictions;
  revokedAt: string | null;
  role: AdminOperatorRole;
  roleLabel: string;
  scopeId: string | null;
  scopeLabel: string | null;
  scopeType: AdminOperatorScopeType;
  startsAt: string | null;
  status: AdminOperatorGrantStatus;
  userId: string | null;
};

export type AdminOperatorApprovalDecision = {
  actorEmail: string | null;
  actorUserId: string | null;
  at: string;
  chainStep?: number | null;
  decision: "approved" | "commented" | "rejected";
  delegatedBy?: string | null;
  governanceVersion?: string | null;
  id: string;
  isDelegated?: boolean;
  lineageNote?: string | null;
  note: string | null;
};

export type AdminOperatorApprovalState = {
  actorEmail: string | null;
  actorUserId: string | null;
  at: string | null;
  label: string;
  note: string | null;
  optional: boolean;
  roleLabel: string | null;
  state: "approved" | "bypassed" | "expired" | "pending" | "rejected";
  step: number;
};

export type AdminOperatorApprovalRequest = {
  actionId: AdminOperatorActionId;
  actionLabel: string;
  authorityScopes: AdminOperatorScope[];
  approvals: AdminOperatorApprovalDecision[];
  approvalChainMode?: "chained" | "emergency_bypass" | "quorum" | "single";
  approvalStates?: AdminOperatorApprovalState[];
  approvedAt: string | null;
  boundary: AdminOperatorScopeBoundary;
  cooldownUntil: string | null;
  consistencyAt?: string | null;
  createdAt: string;
  delegationHistory: AdminOperatorDelegationRecord[];
  delegatedApprover?: string | null;
  emergencyBypassEligible?: boolean;
  emergencyBypassUsed?: boolean;
  escalationChain: AdminOperatorEscalationHop[];
  escalationRule: string | null;
  escalatedAt?: string | null;
  executedAt: string | null;
  expiresAt: string | null;
  fallbackApprover?: string | null;
  fingerprint: string;
  governanceVersion?: string | null;
  id: string;
  lineageSummary?: string[];
  linkedIncidentKey?: string | null;
  optionalSecondApprover: boolean;
  organizationScopeSummary: string[];
  outOfOfficeDelegate?: string | null;
  partialApprovals?: number;
  previewSummary: string | null;
  rejectedLineage?: string[];
  reason: string | null;
  rejectedAt: string | null;
  requesterEmail: string | null;
  requesterUserId: string | null;
  requiredApprovals: number;
  severity: "critical" | "high" | "medium";
  stale?: boolean;
  status: "approved" | "cancelled" | "executed" | "expired" | "pending" | "rejected";
  targetDisplay: string | null;
  targetId: string | null;
  targetType: string;
};

export type AdminOperatorGovernanceConsistency = {
  approvalVersion: string;
  cacheInvalidationKey: string;
  consistencyAt: string;
  generatedAt: string;
  governanceVersion: string;
  grantVersion: string;
  recentActionVersion: string;
};

export type AdminOperatorGovernanceSynchronization = {
  driftAlertCount: number;
  governanceVersion: string;
  invalidatedSnapshots: number;
  propagationHealth: "critical" | "healthy" | "warning";
  propagationHealthSummary: string;
  staleApprovalCount: number;
  tenantConsistencyGaps: number;
};

export type AdminOperatorGovernanceConflict = {
  actionIds: AdminOperatorActionId[];
  actors: string[];
  conflictId: string;
  detectedAt: string;
  grantIds: string[];
  kind:
    | "billing_override_collision"
    | "concurrent_approval"
    | "emergency_collision"
    | "governance_drift"
    | "grant_overlap"
    | "incident_resolution_collision"
    | "maintenance_collision"
    | "queue_collision"
    | "replay_collision"
    | "tenant_isolation_violation";
  lineage: string[];
  requestIds: string[];
  severity: "critical" | "high" | "medium";
  summary: string;
  targetDisplay: string | null;
  targetId: string | null;
  targetType: string;
};

export type AdminOperatorGovernanceAlert = {
  alertId: string;
  category:
    | "approval_bottleneck"
    | "emergency_toggle_storm"
    | "excessive_override"
    | "governance_drift"
    | "operator_overload"
    | "policy_sync_degraded"
    | "privilege_escalation_anomaly"
    | "repeated_denied_actions"
    | "suspicious_elevation_spike"
    | "tenant_isolation_violation"
    | "unowned_incident_risk";
  detail: string;
  detectedAt: string;
  severity: "critical" | "high" | "medium";
  summary: string;
};

export type AdminOperatorActiveElevation = {
  approvalRequestId: string | null;
  boundary: AdminOperatorScopeBoundary;
  countdownLabel: string;
  countdownSeconds: number | null;
  expiresAt: string | null;
  grantId: string;
  historySummary: string[];
  principal: string;
  roleLabel: string;
  scopeLabel: string;
  sessionBound: boolean;
};

export type AdminOperatorGovernanceVisibility = {
  activeElevations: number;
  afterHoursEscalations: number;
  conflictingActions: number;
  crossTeamEscalations: number;
  delegatedApprovals: number;
  emergencyStates: number;
  governanceDrift: number;
  overloadedOperators: number;
  pendingApprovals: number;
  policyPropagationHealth: "critical" | "healthy" | "warning";
  roleAssignmentHealth: "critical" | "healthy" | "warning";
  scopedOperators: number;
  staleApprovalCount: number;
  tenantIsolations: number;
  tenantIsolationViolations: number;
  unresolvedOwnership: number;
};

export type AdminOperatorGovernanceDirectoryOperator = {
  activeElevationCount: number;
  activeGrantCount: number;
  availability: AdminOperatorAvailabilityProfile | null;
  boundarySummary: string[];
  delegatedRoleCount: number;
  departments: string[];
  governanceDomains: AdminOperatorGovernanceDomain[];
  organizations: string[];
  operationalGroups: string[];
  pendingApprovalCount: number;
  principal: string;
  roles: string[];
  teams: string[];
  tenantIds: string[];
};

export type AdminOperatorGovernanceDirectoryOwnership = {
  kind: "department" | "governance_domain" | "operational_group" | "organization" | "team" | "tenant";
  key: string;
  label: string;
  principalCount: number;
  principals: string[];
  scopeSummary: string[];
};

export type AdminOperatorGovernanceDirectoryDelegation = {
  approvalRequestId: string | null;
  delegatedBy: string | null;
  delegatedTo: string | null;
  fallbackApprover: string | null;
  id: string;
  outOfOfficeDelegate: string | null;
  scopeSummary: string[];
  status: "active" | "historical";
};

export type AdminOperatorGovernanceDirectoryPendingApproval = {
  actionLabel: string;
  delegatedApprover: string | null;
  fallbackApprover: string | null;
  requestId: string;
  requester: string;
  scopeSummary: string[];
  status: AdminOperatorApprovalRequest["status"];
};

export type AdminOperatorGovernanceDirectoryEscalationChain = {
  requestId: string;
  scopeSummary: string[];
  status: AdminOperatorApprovalRequest["status"];
  steps: string[];
};

export type AdminOperatorGovernanceDirectory = {
  activeOperators: AdminOperatorGovernanceDirectoryOperator[];
  activeElevations: AdminOperatorActiveElevation[];
  delegatedRoles: AdminOperatorGovernanceDirectoryDelegation[];
  escalationChains: AdminOperatorGovernanceDirectoryEscalationChain[];
  pendingApprovals: AdminOperatorGovernanceDirectoryPendingApproval[];
  teamOwnership: AdminOperatorGovernanceDirectoryOwnership[];
};

export type AdminOperatorGovernanceForensicRecord = {
  actors: string[];
  category:
    | "cross_team_escalation"
    | "delegated_approval"
    | "delegated_remediation"
    | "organization_incident"
    | "ownership_transition"
    | "regional_failover"
    | "scoped_impersonation"
    | "tenant_override";
  occurredAt: string;
  requestId: string | null;
  scopeSummary: string[];
  summary: string;
  tenantId: string | null;
  trace: string[];
};

export type AdminOperatorGovernanceForensics = {
  records: AdminOperatorGovernanceForensicRecord[];
  summary: {
    crossTeamEscalations: number;
    delegatedApprovals: number;
    delegatedRemediations: number;
    organizationIncidents: number;
    ownershipTransitions: number;
    regionalFailovers: number;
    scopedImpersonations: number;
    tenantOverrides: number;
  };
};

export type AdminOperatorCoordinationHandoff = {
  actorEmail: string | null;
  at: string;
  from: string | null;
  incidentKey: string;
  note: string | null;
  requestId: string | null;
  scopeSummary: string[];
  to: string | null;
  type: "assignment" | "follow_the_sun" | "handoff" | "shift_change";
};

export type AdminOperatorCoordinationOwnershipGap = {
  incidentKey: string;
  reason: string;
  scopeSummary: string[];
  severity: "critical" | "high" | "medium";
};

export type AdminOperatorCoordinationRoute = {
  afterHours: boolean;
  incidentKey: string | null;
  requestId: string | null;
  route: string[];
  scopeSummary: string[];
  tenantId: string | null;
};

export type AdminOperatorCoordinationOperatorLoad = {
  activeIncidents: number;
  backupOperator: string | null;
  capacity: number;
  delegatedRemediations: number;
  overloaded: boolean;
  pendingApprovals: number;
  principal: string;
  regions: string[];
  shiftState: AdminOperatorAvailabilityProfile["status"] | "unknown";
  utilizationPercent: number;
};

export type AdminOperatorCoordinationHeatmapCell = {
  activeIncidents: number;
  availableOperators: number;
  key: string;
  label: string;
  pendingApprovals: number;
  utilizationPercent: number;
};

export type AdminOperatorGovernanceCoordination = {
  escalationLineage: AdminOperatorCoordinationRoute[];
  followTheSun: {
    activeTimezones: string[];
    afterHoursEscalations: number;
    backupRoutings: number;
    regionalOperators: number;
    standbyOperators: number;
  };
  handoffs: AdminOperatorCoordinationHandoff[];
  loadBalancing: {
    approvalQueueBalanceScore: number;
    escalationOverloadDetected: boolean;
    heatmap: AdminOperatorCoordinationHeatmapCell[];
    incidentBalanceScore: number;
    operatorLoads: AdminOperatorCoordinationOperatorLoad[];
  };
  ownershipGaps: AdminOperatorCoordinationOwnershipGap[];
  regionalFailovers: Array<{
    at: string;
    fromRegion: string | null;
    incidentKey: string;
    note: string | null;
    toRegion: string | null;
  }>;
};

export type AdminOperatorGovernanceAnalytics = {
  approvalLatencyMinutes: {
    average: number;
    p95: number;
  };
  delegationUtilizationRate: number;
  emergencyOverrideFrequency: number;
  escalationBottlenecks: number;
  governanceDriftAlerts: number;
  operatorWorkload: {
    overloaded: number;
    totalOperators: number;
  };
  tenantIsolationViolations: number;
  unresolvedOwnershipIncidents: number;
};

export type AdminOperatorGovernanceSnapshot = {
  activeElevations: AdminOperatorActiveElevation[];
  analytics: AdminOperatorGovernanceAnalytics;
  alerts: AdminOperatorGovernanceAlert[];
  approvalRequests: AdminOperatorApprovalRequest[];
  conflicts: AdminOperatorGovernanceConflict[];
  consistency: AdminOperatorGovernanceConsistency;
  coordination: AdminOperatorGovernanceCoordination;
  directory: AdminOperatorGovernanceDirectory;
  forensics: AdminOperatorGovernanceForensics;
  grants: AdminOperatorRoleGrant[];
  migration: {
    fallbackAccessActive: boolean;
    legacyAssignmentCount: number;
    needsMigration: boolean;
    roleGrantCount: number;
  };
  synchronization: AdminOperatorGovernanceSynchronization;
  visibility: AdminOperatorGovernanceVisibility;
};

export type AdminOperatorPreviewGovernance = {
  authoritySummary: string;
  cacheInvalidationKey: string | null;
  conflictIds: string[];
  conflictSummary: string[];
  consistencyAt: string | null;
  governanceVersion: string | null;
};

export type AdminOperatorActionPreview = {
  actionId: AdminOperatorActionId;
  affectedEntities?: AdminOperatorAffectedEntity[];
  blastRadius?: AdminOperatorBlastRadius | null;
  confirmationLabel: string;
  cooldownUntil: string | null;
  dependencyStatus?: AdminStatusSignal[];
  dryRun: boolean;
  duplicateRisk: "high" | "low" | "medium";
  existingCaptureLineage: string[];
  financialImpact?: AdminOperatorFinancialImpact | null;
  governance?: AdminOperatorPreviewGovernance;
  idempotencyKey: string | null;
  idempotencyState?: "duplicate_detected" | "duplicate_risk" | "guarded" | "not_available";
  impacts: AdminOperatorImpactLine[];
  playbooks?: AdminOperatorPlaybook[];
  permissionExplanation?: AdminOperatorPermissionExplanation;
  previewExpiresAt?: string | null;
  priorOperatorActions?: AdminOperatorRecentAction[];
  requiresReason: boolean;
  review?: AdminOperatorGovernanceReview;
  relatedIncidents?: AdminOperatorRelatedIncident[];
  reversible: boolean;
  riskLevel?: "critical" | "high" | "low" | "medium";
  rollbackSummary?: string | null;
  severity: "critical" | "high" | "medium";
  summary: string;
  targetDisplay: string | null;
  title: string;
  token: string | null;
  traceLineage: AdminRuntimeTraceEvent[];
  retryHistory: AdminJobRetryHistoryEntry[];
  warnings: string[];
};

export type AdminOperatorTimelineEntry = {
  action: string;
  actorEmail: string | null;
  actorUserId: string | null;
  correlationId: string | null;
  id: string;
  incidentKey: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  paymentReference: string | null;
  queueJobId: string | null;
  requestId: string | null;
  severity: AdminRuntimeTraceEvent["severity"];
  source: "audit_log" | "event_log" | "incident" | "job" | "payment";
  targetDisplay: string | null;
  targetType: string | null;
  traceId: string | null;
};

export type AdminFeatureFlag = {
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  cacheTtlSeconds: number;
  config: Record<string, unknown>;
  rollout: AdminFeatureFlagRolloutGovernance;
  variants: Array<Record<string, unknown>>;
  source: "cache" | "database" | "fallback";
  updatedAt: string | null;
};

export type AdminPlatformSetting = {
  key: string;
  value: unknown;
  updatedAt: string | null;
};

export type AdminStatusSignal = {
  label: string;
  status: "green" | "yellow" | "red";
  value: string;
  detail?: string | null;
};

export type AdminTimeSeriesPoint = {
  date: string;
  label: string;
  activeLibraries: number;
  activeStudents: number;
  paymentRevenue: number;
  subscriptionRevenue: number;
  adjustmentRevenue: number;
  totalRevenue: number;
  newLibraries: number;
};

export type AdminRevenueCityPoint = {
  state: string;
  city: string;
  libraries: number;
  transactionCount: number;
  totalRevenue: number;
};

export type AdminIncidentOwnershipTransition = {
  actorEmail: string | null;
  at: string;
  from: string | null;
  note: string | null;
  regionLabel: string | null;
  teamLabel: string | null;
  to: string | null;
  type: "assignment" | "delegated_remediation" | "follow_the_sun" | "handoff" | "shift_change";
};

export type AdminIncidentRegionalFailoverEvent = {
  actorEmail: string | null;
  at: string;
  fromRegion: string | null;
  note: string | null;
  toRegion: string | null;
};

export type AdminIncidentGroup = {
  incidentKey: string;
  eventType: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  unresolvedCount: number;
  totalOccurrences: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  latestMessage: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  ownerEmail: string | null;
  ownerUserId: string | null;
  escalationLevel: number;
  latestNote: string | null;
  noteCount: number;
  linkedJobIds: string[];
  linkedRequestIds: string[];
  linkedTraceIds: string[];
  linkedCorrelationIds: string[];
  linkedPaymentReferences: string[];
  retryableJobId: string | null;
  operationalNotes: AdminOperationalNote[];
  traceLineage: AdminRuntimeTraceEvent[];
  remediationActions?: AdminRuntimeTraceEvent[];
  afterHoursEscalated?: boolean;
  approvalLinkedRequestIds?: string[];
  backupOwnerEmail?: string | null;
  crossTeamEscalation?: boolean;
  delegatedRemediatorEmail?: string | null;
  governanceActionIds?: string[];
  organizationLabel?: string | null;
  ownershipTransitions?: AdminIncidentOwnershipTransition[];
  regionLabel?: string | null;
  regionalFailoverEvents?: AdminIncidentRegionalFailoverEvent[];
  severityApprovalRequired?: boolean;
  severityApprovedAt?: string | null;
  severityApprovedBy?: string | null;
  slaBreached?: boolean;
  slaTargetAt?: string | null;
  teamLabel?: string | null;
  tenantId?: string | null;
  tenantLabel?: string | null;
  unresolvedOwnership?: boolean;
};

export type AdminLibraryControlRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  enabled: boolean;
  subscriptionStatus: string | null;
  paymentStatus: string | null;
  ownerId: string;
  ownerEmail: string | null;
  ownerName: string | null;
  activeStudents: number;
  totalSeats: number;
  monthlyRevenue: number;
  lastActivityAt: string | null;
  controlStatus: "active" | "suspended" | "banned";
  controlUntilAt: string | null;
  controlReason: string | null;
};

export type AdminLibraryCenterSummary = {
  activeImpersonationCount: number;
  activeLibraryCount: number;
  controlledLibraryCount: number;
  controlledUserCount: number;
  disabledLibraryCount: number;
  forcedLogoutCount: number;
  passwordResetCount: number;
  pendingLibraryCount: number;
  totalLibraryCount: number;
  trialLibraryCount: number;
  verificationRequiredCount: number;
};

export type AdminUserControlRow = {
  userId: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  primaryRole: string | null;
  roles: string[];
  libraryId: string | null;
  libraryName: string | null;
  lastLoginAt: string | null;
  loginFailures24h: number;
  controlStatus: "active" | "suspended" | "banned";
  controlUntilAt: string | null;
  controlReason: string | null;
  clearSessionsAfter: string | null;
  passwordResetRequired: boolean;
  activeImpersonationId: string | null;
  activeImpersonationStartedAt: string | null;
};

export type AdminActivityLog = {
  id: string;
  createdAt: string;
  activityType: string;
  message: string;
  libraryId: string | null;
  userId: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown>;
};

export type AdminRevenueAdjustment = {
  id: string;
  libraryId: string;
  libraryName: string | null;
  paymentId: string | null;
  subscriptionPaymentId: string | null;
  amountDelta: number;
  reason: string;
  createdAt: string;
  createdBy: string | null;
};

export type AdminPayoutQueueRow = {
  id: string;
  libraryId: string;
  libraryName: string | null;
  amount: number;
  currency: string;
  status: "queued" | "approved" | "rejected" | "paid";
  note: string | null;
  requestedAt: string;
  approvedAt: string | null;
  processedAt: string | null;
};

export type AdminCommissionOverride = {
  libraryId: string;
  libraryName: string | null;
  commissionPercent: number;
  notes: string | null;
  updatedAt: string | null;
};

export type AdminRuntimeTraceEvent = {
  id: string;
  source: "audit_log" | "event_log" | "incident" | "job" | "payment";
  type: string;
  status: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | null;
  message: string | null;
  occurredAt: string;
  entityId: string | null;
  actorEmail: string | null;
  requestId: string | null;
  correlationId: string | null;
  traceId: string | null;
  queueJobId: string | null;
  paymentReference: string | null;
  incidentKey: string | null;
  metadata: Record<string, unknown>;
};

export type AdminFeatureFlagRolloutStage =
  | "disabled"
  | "paused"
  | "canary"
  | "tenant_scoped"
  | "runtime_targeted"
  | "staged"
  | "full"
  | "rolled_back";

export type AdminReleaseHealthStatus = "healthy" | "warning" | "critical";

export type AdminReleaseCompatibilityStatus = "compatible" | "warning" | "incompatible";

export type AdminReleasePhase =
  | "planned"
  | "validating"
  | "canary"
  | "rolling"
  | "paused"
  | "degraded"
  | "maintenance"
  | "rollback"
  | "completed";

export type AdminReleaseChannel = "development" | "staging" | "production";

export type AdminReleaseEvolutionRole =
  | "current"
  | "canary"
  | "rollback"
  | "migration_in_progress"
  | "stale_runtime";

export type AdminTenantEvolutionStage =
  | "pending"
  | "canary"
  | "phased"
  | "stable"
  | "rolling_back"
  | "blocked";

export type AdminTenantEvolutionReadiness = "blocked" | "caution" | "ready";

export type AdminTenantEvolutionProgressStatus =
  | "blocked"
  | "holding"
  | "progressing"
  | "ready_for_promotion";

export type AdminReleaseCanaryLifecycle =
  | "idle"
  | "warming"
  | "observing"
  | "progressing"
  | "holding"
  | "rollback_recommended"
  | "rolled_back";

export type AdminReleaseForecastType =
  | "compatibility_drift"
  | "migration_risk"
  | "rollout_bottleneck"
  | "dependency_mismatch"
  | "stale_runtime_risk"
  | "queue_runtime_incompatibility";

export type AdminReleaseSimulationKind =
  | "deployment"
  | "rollback"
  | "migration"
  | "tenant_rollout";

export type AdminReleaseSafetyRuleKey =
  | "unsafe_rollout_progression"
  | "incompatible_migration"
  | "stale_runtime_activation"
  | "unsafe_rollback"
  | "schema_runtime_mismatch";

export type AdminFeatureFlagRolloutGovernance = {
  canaryPercentage: number;
  emergencyRollbackReady: boolean;
  healthStatus: AdminReleaseHealthStatus;
  paused: boolean;
  releaseTargets: string[];
  runtimeTargets: string[];
  stage: AdminFeatureFlagRolloutStage;
  summary: string;
  tenantTargets: string[];
  warnings: string[];
};

export type AdminOperationalNote = {
  id: string;
  action: string;
  actorEmail: string | null;
  category?: string | null;
  createdAt: string;
  linkedApprovalRequestId?: string | null;
  linkedGovernanceActionId?: string | null;
  note: string;
  metadata: Record<string, unknown>;
};

export type AdminJobRetryHistoryEntry = {
  at: string | null;
  attempt: number;
  error: string | null;
  scheduledFor: string | null;
  state: string | null;
  metadata: Record<string, unknown>;
};

export type AdminDeadLetterRow = {
  id: string;
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  deadLetteredAt: string;
  sourceRequestId: string | null;
  sourceCorrelationId: string | null;
  sourceTraceId: string | null;
  traceLineage: AdminRuntimeTraceEvent[];
};

export type AdminSubscriptionPlanRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  seatsLimit: number | null;
  lockersLimit: number | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  updatedAt: string | null;
};

export type AdminBillingPaymentRow = {
  id: string;
  paymentType: "student_payment" | "subscription_payment";
  libraryId: string;
  libraryName: string | null;
  amount: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
  reference: string | null;
  currency: string | null;
  orderId: string | null;
  paymentId: string | null;
  idempotencyKey: string | null;
  captureSource: string | null;
  captureRequestId: string | null;
  captureCorrelationId: string | null;
  captureTraceId: string | null;
  captureProcessedAt: string | null;
  lastProcessingError: string | null;
  duplicateDetected: boolean;
  duplicateCount: number;
  reconciliationStatus: "manual_review" | "pending" | "reconciled" | "retrying" | "stuck";
  retryCount: number;
  stuckReason: string | null;
  webhookAttempts: number;
  verificationAttempts: number;
  linkedIncidentKeys: string[];
  lifecycleTimeline: AdminRuntimeTraceEvent[];
};

export type AdminBroadcastRow = {
  id: string;
  title: string;
  message: string;
  channel: "email" | "in_app" | "whatsapp" | "telegram";
  audience: string;
  status: "draft" | "queued" | "sent" | "failed";
  sentAt: string | null;
  createdAt: string;
};

export type AdminCommunicationTemplateRow = {
  id: string;
  key: string;
  name: string;
  channel: "email" | "in_app" | "whatsapp" | "telegram";
  subject: string | null;
  body: string;
  variables: string[];
  isActive: boolean;
  updatedAt: string | null;
};

export type AdminInvoiceRow = {
  id: string;
  invoiceNumber: string;
  libraryId: string;
  libraryName: string | null;
  invoiceType: "subscription" | "refund" | "manual_adjustment";
  status: "generated" | "paid" | "refunded" | "void";
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  issuedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
};

export type AdminRefundRow = {
  id: string;
  libraryId: string;
  libraryName: string | null;
  amount: number;
  reason: string;
  status: "pending" | "processed" | "failed";
  createdAt: string;
  processedAt: string | null;
};

export type AdminJobQueueRow = {
  id: string;
  jobType: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string | null;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  payload: Record<string, unknown>;
  claimToken: string | null;
  claimedBy: string | null;
  concurrencyKey: string | null;
  deduplicationKey: string | null;
  deadLetteredAt: string | null;
  deadLetterReason: string | null;
  lastHeartbeatAt: string | null;
  maxConcurrency: number;
  recoveredAt: string | null;
  visibilityTimeoutAt: string | null;
  cancelRequestedAt: string | null;
  cancelRequestedBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  retryHistory: AdminJobRetryHistoryEntry[];
  trace: {
    correlationId: string | null;
    originRequestId: string | null;
    parentRequestId: string | null;
    requestSource: string | null;
    route: string | null;
    traceId: string | null;
  };
  traceLineage: AdminRuntimeTraceEvent[];
  relatedIncidentKeys: string[];
};

export type AdminRuntimeGovernanceState = {
  maintenanceMode: boolean;
  queueProcessingEnabled: boolean;
  billingMutationsEnabled: boolean;
  automationSubscriptionRenewalEnabled: boolean;
  automationPaymentReminderEnabled: boolean;
  automationInactiveLibraryAlertEnabled: boolean;
  maintenanceEscalationActive?: boolean;
  notificationDeliveryEnabled?: boolean;
  stripeDependencyEnabled?: boolean;
};

export type AdminReleaseCompatibilityMatrixEntry = {
  actualVersion: string | null;
  contract:
    | "browser_runtime"
    | "api_version"
    | "queue_worker"
    | "operational_intelligence"
    | "governance_contract"
    | "observability_payload"
    | "schema";
  detail: string;
  expectedVersion: string | null;
  maximumVersion: string | null;
  minimumVersion: string | null;
  status: AdminReleaseCompatibilityStatus;
};

export type AdminReleaseHealthScore = {
  drivers: string[];
  score: number;
  status: AdminReleaseHealthStatus;
  summary: string;
};

export type AdminReleaseVersionRange = {
  maximumVersion: string | null;
  minimumVersion: string | null;
  targetVersion: string | null;
};

export type AdminReleaseCompatibilityWindow = {
  maximumRuntimeVersion: string | null;
  maximumSchemaVersion: string | null;
  minimumRuntimeVersion: string | null;
  minimumSchemaVersion: string | null;
};

export type AdminReleaseLineage = {
  channel: AdminReleaseChannel;
  commitSha: string | null;
  completedAt: string | null;
  deploymentId: string | null;
  fingerprint: string;
  phase: AdminReleasePhase;
  previousReleaseId: string | null;
  releaseId: string | null;
  rollbackTargetReleaseId: string | null;
  startedAt: string | null;
};

export type AdminReleaseSchemaGovernance = {
  appliedVersion: string | null;
  driftWarnings: string[];
  latestLocalVersion: string | null;
  maintenanceRequired: boolean;
  minimumCompatibleVersion: string | null;
  pendingMigrations: string[];
  queueDrainRequired: boolean;
  readiness: "blocked" | "caution" | "ready";
  safeWindowActive: boolean;
  sequencing: string[];
  strategy: "breaking" | "expand_contract" | "online" | "unknown";
  targetVersion: string | null;
};

export type AdminReleaseRolloutGovernance = {
  activeFlagCount: number;
  canaryFlags: number;
  emergencyRollbackReady: boolean;
  healthStatus: AdminReleaseHealthStatus;
  issues: string[];
  pausedFlags: number;
  progressPercentage: number;
  runtimeTargetedFlags: number;
  stagedFlags: number;
  tenantScopedFlags: number;
};

export type AdminReleaseRollbackSafety = {
  blockers: string[];
  ready: boolean;
  safeDegradationActive: boolean;
  summary: string;
  targetReleaseId: string | null;
};

export type AdminReleaseDeploymentOrchestration = {
  capabilityNegotiationWarnings: string[];
  degradedModeActive: boolean;
  dependencySequencing: string[];
  maintenanceReady: boolean;
  maintenanceRequired: boolean;
  migrationAwareRolloutReady: boolean;
  partialRollbackActive: boolean;
  phase: AdminReleasePhase;
  queueDrainReady: boolean;
  queueDrainRequired: boolean;
  runtimeActivationOrder: string[];
  rolloutPaused: boolean;
  steps: string[];
};

export type AdminReleaseForensicsEvent = {
  detail: string;
  occurredAt: string;
  releaseId: string | null;
  severity: "critical" | "high" | "info" | "medium";
  summary: string;
  type: "compatibility" | "deployment" | "incident" | "migration" | "rollback" | "rollout";
};

export type AdminReleaseGovernancePolicy = {
  appliedSchemaVersion?: string | null;
  canary?: {
    anomalyThreshold?: number | null;
    longLived?: boolean | null;
    progressiveThresholds?: number[] | null;
  } | null;
  channel?: AdminReleaseChannel | null;
  compatibility?: Partial<
    Record<
      | "apiVersion"
      | "browserRuntime"
      | "governanceContract"
      | "observabilityPayload"
      | "operationalIntelligence"
      | "queueWorker"
      | "schema",
      {
        currentVersion?: string | null;
        maximumVersion?: string | null;
        minimumVersion?: string | null;
        targetVersion?: string | null;
      }
    >
  >;
  completedAt?: string | null;
  dependencies?: Array<{
    currentVersion?: string | null;
    maximumVersion?: string | null;
    minimumVersion?: string | null;
    name: string;
    requiredCapabilities?: string[] | null;
    targetVersion?: string | null;
  }> | null;
  migration?: {
    maintenanceRequired?: boolean | null;
    queueDrainRequired?: boolean | null;
    safeWindowEndHourUtc?: number | null;
    safeWindowStartHourUtc?: number | null;
    strategy?: "breaking" | "expand_contract" | "online" | "unknown" | null;
  } | null;
  phase?: AdminReleasePhase | null;
  previousReleaseId?: string | null;
  releaseId?: string | null;
  releases?: Array<{
    compatibilityWindow?: {
      maximumRuntimeVersion?: string | null;
      maximumSchemaVersion?: string | null;
      minimumRuntimeVersion?: string | null;
      minimumSchemaVersion?: string | null;
    } | null;
    healthStatus?: AdminReleaseHealthStatus | null;
    interoperableWith?: string[] | null;
    phase?: AdminReleasePhase | null;
    releaseId?: string | null;
    role?: AdminReleaseEvolutionRole | null;
    runtimeTargets?: string[] | null;
    runtimeVersion?: string | null;
    schemaVersion?: string | null;
    startedAt?: string | null;
    supportedRange?: {
      maximumVersion?: string | null;
      minimumVersion?: string | null;
      targetVersion?: string | null;
    } | null;
  }> | null;
  rollback?: {
    safeDegradationRequired?: boolean | null;
    targetReleaseId?: string | null;
  } | null;
  rollout?: {
    regionalSequence?: string[] | null;
    paused?: boolean | null;
  } | null;
  runtime?: {
    activationOrder?: string[] | null;
    capabilities?: Record<string, string[] | null> | null;
    requirements?: Record<string, string[] | null> | null;
    staleRuntimeReleaseIds?: string[] | null;
  } | null;
  startedAt?: string | null;
  tenants?: Array<{
    canary?: boolean | null;
    canaryGroup?: string | null;
    healthStatus?: AdminReleaseHealthStatus | null;
    issues?: string[] | null;
    region?: string | null;
    releaseId?: string | null;
    rollbackIsolated?: boolean | null;
    rollbackReleaseId?: string | null;
    rolloutPercentage?: number | null;
    stage?: AdminTenantEvolutionStage | null;
    tenantId?: string | null;
    tenantLabel?: string | null;
  }> | null;
};

export type AdminReleaseEvolutionTrack = {
  compatibilityWindow: AdminReleaseCompatibilityWindow;
  healthStatus: AdminReleaseHealthStatus;
  interoperabilityReleaseIds: string[];
  issues: string[];
  phase: AdminReleasePhase;
  releaseId: string | null;
  rollbackReady: boolean;
  role: AdminReleaseEvolutionRole;
  runtimeTargets: string[];
  runtimeVersion: string | null;
  schemaVersion: string | null;
  stableRuntime: boolean;
  startedAt: string | null;
  status: AdminReleaseCompatibilityStatus;
  summary: string;
  supportedRange: AdminReleaseVersionRange;
};

export type AdminTenantEvolutionRecord = {
  auditLineage: string[];
  compatibilityScore: number;
  canary: boolean;
  canaryGroup: string | null;
  compatibilityStatus: AdminReleaseCompatibilityStatus;
  healthStatus: AdminReleaseHealthStatus;
  issues: string[];
  lastActivityAt: string | null;
  migrationReadiness: AdminTenantEvolutionReadiness;
  migrationReadinessReasons: string[];
  progressionStatus: AdminTenantEvolutionProgressStatus;
  region: string | null;
  readinessScore: number;
  releaseId: string | null;
  rollbackIsolated: boolean;
  rollbackReleaseId: string | null;
  rolloutPercentage: number;
  stage: AdminTenantEvolutionStage;
  summary: string;
  tenantId: string;
  tenantLabel: string;
};

export type AdminTenantEvolutionGovernance = {
  activeTenants: number;
  averageCompatibilityScore: number;
  averageReadinessScore: number;
  blockedTenants: number;
  canaryTenants: number;
  healthStatus: AdminReleaseHealthStatus;
  issues: string[];
  phasedTenants: number;
  promotionReadyTenants: number;
  records: AdminTenantEvolutionRecord[];
  regionalSequence: string[];
};

export type AdminReleaseEvolutionForecast = {
  confidencePercent: number;
  evidence: string[];
  id: string;
  recommendedActions: string[];
  severity: "critical" | "high" | "low" | "medium";
  summary: string;
  title: string;
  type: AdminReleaseForecastType;
};

export type AdminReleaseEvolutionForecasting = {
  forecasts: AdminReleaseEvolutionForecast[];
  healthStatus: AdminReleaseHealthStatus;
};

export type AdminReleaseCanaryGovernance = {
  active: boolean;
  anomalyCount: number;
  canaryFlags: number;
  canaryTenants: number;
  healthScore: number;
  healthStatus: AdminReleaseHealthStatus;
  issues: string[];
  lifecycle: AdminReleaseCanaryLifecycle;
  progressiveThresholds: number[];
  releaseId: string | null;
  rollbackRecommended: boolean;
  summary: string;
};

export type AdminReleaseSafetyRule = {
  detail: string;
  key: AdminReleaseSafetyRuleKey;
  severity: "critical" | "warning";
  status: "block" | "pass" | "warn";
  summary: string;
};

export type AdminReleaseSafetyGuardrails = {
  blockedRules: number;
  rules: AdminReleaseSafetyRule[];
  warningRules: number;
};

export type AdminReleaseBlastRadiusEstimate = {
  impactedReleases: number;
  impactedRuntimes: number;
  impactedTenants: number;
  scope: "platform" | "regional" | "runtime" | "tenant";
  summary: string;
};

export type AdminReleaseSimulation = {
  blastRadius: AdminReleaseBlastRadiusEstimate;
  dryRunSupported: boolean;
  guardrails: string[];
  id: string;
  kind: AdminReleaseSimulationKind;
  readiness: "blocked" | "caution" | "ready";
  recommendedActions: string[];
  rollbackViabilityScore: number;
  safetyScore: number;
  summary: string;
  title: string;
};

export type AdminReleaseEvolutionGovernance = {
  activeReleases: AdminReleaseEvolutionTrack[];
  canary: AdminReleaseCanaryGovernance;
  forecasting: AdminReleaseEvolutionForecasting;
  guardrails: AdminReleaseSafetyGuardrails;
  healthStatus: AdminReleaseHealthStatus;
  staleRuntimeCount: number;
  tenants: AdminTenantEvolutionGovernance;
};

export type AdminReleaseGovernanceSnapshot = {
  compatibility: AdminReleaseCompatibilityMatrixEntry[];
  evolution: AdminReleaseEvolutionGovernance;
  forensics: {
    compatibilityRegressions: string[];
    events: AdminReleaseForensicsEvent[];
    incidentCount: number;
    migrationConflicts: string[];
    releaseIncidentKeys: string[];
    rollbackChain: string[];
    rolloutChain: string[];
    staleRuntimeConflicts: string[];
  };
  health: AdminReleaseHealthScore;
  lineage: AdminReleaseLineage;
  orchestration: AdminReleaseDeploymentOrchestration;
  policy: AdminReleaseGovernancePolicy;
  rollback: AdminReleaseRollbackSafety;
  rollouts: AdminReleaseRolloutGovernance;
  schema: AdminReleaseSchemaGovernance;
  simulations: AdminReleaseSimulation[];
  warnings: string[];
};

export type AdminRuntimeVisibility = {
  queueLagMs: number;
  activeWorkers: number;
  retryCount: number;
  deadLetterJobs: number;
  redisDegraded: boolean;
  apiLatencyP95Ms: number;
  slowRequests: number;
  paymentRetryRate: number;
  otpDeliveryFailures: number;
  emailFailureRate: number;
  incidentSeverityCounts: {
    critical: number;
    error: number;
    info: number;
    warning: number;
  };
  queueLatencyP95Ms: number;
};

export type AdminOperationalSeverity = "low" | "medium" | "high" | "critical";

export type AdminOperationalPrediction = {
  confidencePercent: number;
  evidence: string[];
  horizonMinutes: number;
  id: string;
  impactedEntityId: string | null;
  impactedEntityType: "auth" | "dependency" | "governance" | "incident" | "operator" | "payment" | "queue";
  recommendedActions: string[];
  severity: AdminOperationalSeverity;
  signal: "action" | "stable" | "watch";
  summary: string;
  title: string;
  type:
    | "auth_failure_spike"
    | "governance_drift"
    | "incident_escalation"
    | "operator_overload"
    | "payment_anomaly"
    | "queue_backlog";
};

export type AdminAdaptiveRoutingRecommendation = {
  confidencePercent: number;
  dependencyHealthScore: number;
  id: string;
  incidentKey: string | null;
  rationale: string[];
  recommendedRegion: string | null;
  recommendedResponder: string | null;
  recommendedRoute: string[];
  regionHealthScore: number;
  responseQualityScore: number;
  safeAutoAssign: boolean;
  severity: AdminOperationalSeverity;
  targetId: string | null;
  targetType: "approval_request" | "incident" | "queue";
  timezoneScore: number;
  workloadScore: number;
};

export type AdminOperationalRecommendation = {
  id: string;
  kind: "dependency_warning" | "escalation_path" | "remediation" | "responder" | "routing" | "safe_replay";
  primaryAction: string;
  rationale: string[];
  severity: AdminOperationalSeverity;
  summary: string;
  targetId: string | null;
  targetType: "approval_request" | "dependency" | "incident" | "operator" | "payment" | "queue";
  title: string;
};

export type AdminOperationalRemediationPlan = {
  auditTrail: string[];
  automationLevel: "blocked" | "guarded_auto" | "manual";
  escalateOnFailure: boolean;
  guardrails: string[];
  id: string;
  kind:
    | "abandoned_incident_reassignment"
    | "degraded_dependency_fallback"
    | "governance_drift_reconciliation"
    | "queue_replay"
    | "stale_elevation_cleanup"
    | "stuck_job_recovery";
  linkedTargets: Array<{
    id: string;
    kind: "approval_request" | "incident" | "job" | "operator" | "queue";
  }>;
  previewSummary: string;
  rollbackSummary: string;
  safeToAutoRun: boolean;
  severity: AdminOperationalSeverity;
  summary: string;
  title: string;
};

export type AdminOperationalHealthScore = {
  drivers: string[];
  key:
    | "approval_latency"
    | "escalation_efficiency"
    | "incident_aging"
    | "operational_drift"
    | "operator_saturation"
    | "replay_safety"
    | "tenant_governance_health";
  label: string;
  score: number;
  status: "critical" | "healthy" | "warning";
  summary: string;
};

export type AdminOperationalSimulation = {
  estimatedRisk: "high" | "low" | "medium";
  expectedOutcome: string;
  guardrails: string[];
  id: string;
  kind: "escalation" | "failover" | "governance" | "incident" | "replay";
  readiness: "blocked" | "caution" | "ready";
  summary: string;
  title: string;
};

export type AdminOperationalIntelligenceSnapshot = {
  generatedAt: string;
  governanceHealth: AdminOperationalHealthScore[];
  predictions: AdminOperationalPrediction[];
  recommendations: AdminOperationalRecommendation[];
  remediationPlans: AdminOperationalRemediationPlan[];
  routingRecommendations: AdminAdaptiveRoutingRecommendation[];
  simulations: AdminOperationalSimulation[];
};

export type SuperAdminControlCenterData = {
  generatedAt: string;
  maintenanceMode: boolean;
  releaseGovernance: AdminReleaseGovernanceSnapshot;
  systemStatus: "green" | "yellow" | "red";
  settings: AdminPlatformSetting[];
  featureFlags: AdminFeatureFlag[];
  analytics: {
    activeLibraryCount?: number;
    activeStudentsYesterday?: number;
    activeSubscriptionCount?: number;
    dailyActiveLibraries: number;
    attendanceLibrariesYesterday?: number;
    activeStudentsToday: number;
    approvedTransactionsThisMonth?: number;
    conversionRate: number;
    lastAttendanceAt?: string | null;
    lastPaymentAt?: string | null;
    revenueThisMonth: number;
    revenuePreviousMonth: number;
    revenueByCity: AdminRevenueCityPoint[];
    series: AdminTimeSeriesPoint[];
    trialLibraryCount?: number;
  };
  statusSignals: AdminStatusSignal[];
  incidents: AdminIncidentGroup[];
  libraries: AdminLibraryControlRow[];
  operator?: AdminOperatorContext;
  security: {
    ipWhitelistEnabled: boolean;
    whitelist: string[];
    failedLoginAttempts24h: number;
    suspiciousIps: Array<{ ip: string; failures: number }>;
  };
  automation: {
    queuedJobs: number;
    failedJobs: number;
    inactiveLibraries: Array<{ libraryId: string; libraryName: string | null; inactiveDays: number }>;
  };
  runtimeGovernance: AdminRuntimeGovernanceState;
};

export type SuperAdminRevenueCenterData = {
  generatedAt: string;
  defaultCommissionPercent: number;
  commissionOverrides: AdminCommissionOverride[];
  plans: AdminSubscriptionPlanRow[];
  payouts: AdminPayoutQueueRow[];
  adjustments: AdminRevenueAdjustment[];
  paymentHistory: AdminBillingPaymentRow[];
  summary: {
    totalRevenue: number;
    subscriptionRevenue: number;
    studentRevenue: number;
    adjustmentRevenue: number;
    queuedPayoutAmount: number;
  };
};

export type SuperAdminLibraryCenterData = {
  generatedAt: string;
  libraries: AdminLibraryControlRow[];
  users: AdminUserControlRow[];
  activityLogs: AdminActivityLog[];
  summary: AdminLibraryCenterSummary;
};

export type SuperAdminIncidentCenterData = {
  analytics: {
    afterHoursEscalations: number;
    crossTeamEscalations: number;
    delegatedRemediations: number;
    regionalFailovers: number;
    unresolvedOwnership: number;
  };
  coordination: AdminOperatorGovernanceCoordination;
  generatedAt: string;
  groups: AdminIncidentGroup[];
  snapshots: Array<{
    metricKey: string;
    metricWindow: "live" | "hourly" | "daily" | "weekly" | "monthly";
    metricValue: number;
    capturedAt: string;
  }>;
  summary: {
    acknowledged: number;
    critical: number;
    error: number;
    escalated: number;
    info: number;
    unresolved: number;
    warning: number;
  };
};

export type SuperAdminSecurityCenterData = {
  generatedAt: string;
  ipWhitelistEnabled: boolean;
  whitelist: string[];
  accessLogs: AdminActivityLog[];
  auditLogs: Array<{
    id: string;
    createdAt: string;
    action: string;
    actorEmail: string | null;
    metadata?: Record<string, unknown>;
    targetType: string;
    targetDisplay: string | null;
    ipAddress: string | null;
  }>;
  operatorGovernance?: AdminOperatorGovernanceSnapshot;
  suspiciousIps: Array<{ ip: string; failures: number }>;
  eventLogs: AdminRuntimeTraceEvent[];
  runtimeVisibility: AdminRuntimeVisibility;
};

export type SuperAdminCommunicationCenterData = {
  generatedAt: string;
  templates: AdminCommunicationTemplateRow[];
  broadcasts: AdminBroadcastRow[];
  deliveryHealth: {
    emailSuccessRate: number;
    queuedNotifications: number;
    failedNotifications: number;
  };
};

export type SuperAdminBillingCenterData = {
  generatedAt: string;
  invoices: AdminInvoiceRow[];
  refunds: AdminRefundRow[];
  paymentHistory: AdminBillingPaymentRow[];
  gstRatePercent: number;
  operations: {
    billingMutationsEnabled: boolean;
    duplicatePayments: number;
    manualReviewPayments: number;
    paymentRetryRate: number;
    reconciledPayments: number;
    stuckPayments: number;
    verificationRetries: number;
    webhookRetries: number;
  };
};

export type SuperAdminAutomationCenterData = {
  generatedAt: string;
  jobs: AdminJobQueueRow[];
  deadLetters: AdminDeadLetterRow[];
  settings: {
    inactiveLibraryDays: number;
    automationSubscriptionRenewalEnabled: boolean;
    automationPaymentReminderEnabled: boolean;
    automationInactiveLibraryAlertEnabled: boolean;
  };
  summary: {
    activeWorkers: number;
    deadLetterJobs: number;
    paused: boolean;
    queueLagMs: number;
    queueLatencyP95Ms: number;
    queuedJobs: number;
    redisDegraded: boolean;
    retryCount: number;
    runningJobs: number;
  };
};

export type AdminLibraryActionInput = {
  action:
    | "enable"
    | "disable"
    | "suspend"
    | "ban"
    | "clear_control"
    | "approve_payout"
    | "reject_payout"
    | "mark_payout_paid";
  libraryId: string;
  note?: string;
  untilAt?: string | null;
  amount?: number;
  payoutId?: string;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminUserActionInput = {
  action:
    | "force_logout"
    | "suspend"
    | "ban"
    | "clear_control"
    | "reset_password"
    | "clear_sessions";
  userId: string;
  note?: string;
  untilAt?: string | null;
  libraryId?: string | null;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminRevenueAdjustmentInput = {
  libraryId: string;
  amountDelta: number;
  reason: string;
  paymentId?: string | null;
  subscriptionPaymentId?: string | null;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminCommissionUpdateInput = {
  defaultCommissionPercent?: number;
  libraryId?: string;
  commissionPercent?: number;
  notes?: string;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminFeatureFlagInput = {
  key: string;
  enabled: boolean;
  rolloutPercentage?: number;
  config?: Record<string, unknown>;
  variants?: Array<Record<string, unknown>>;
};

export type AdminBroadcastInput = {
  title: string;
  message: string;
  channel: "email" | "in_app" | "whatsapp" | "telegram";
  audience?: string;
  templateId?: string | null;
};

export type AdminTemplateInput = {
  key: string;
  name: string;
  channel: "email" | "in_app" | "whatsapp" | "telegram";
  subject?: string | null;
  body: string;
  variables?: string[];
  isActive?: boolean;
};

export type AdminRefundInput = {
  libraryId: string;
  amount: number;
  reason: string;
  paymentId?: string | null;
  subscriptionPaymentId?: string | null;
  invoiceId?: string | null;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminInvoiceInput = {
  libraryId: string;
  invoiceType?: "subscription" | "refund" | "manual_adjustment";
  subtotal: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  metadata?: Record<string, unknown>;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminJobActionInput = {
  action: "enqueue" | "retry" | "cancel" | "run_due_now" | "replay_dead_letter";
  jobType?: string;
  jobId?: string;
  cancelReason?: string | null;
  replayReason?: string | null;
  payload?: Record<string, unknown>;
  scheduledFor?: string | null;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminPlanUpsertInput = {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  price: number;
  seatsLimit?: number | null;
  lockersLimit?: number | null;
  features?: string[];
  isActive?: boolean;
  sortOrder?: number;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminIncidentResolutionInput =
  | {
      action: "resolve_incident";
      incidentKey: string;
      resolutionNote?: string;
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
    }
  | {
      action: "acknowledge_incident";
      incidentKey: string;
      note?: string;
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
    }
  | {
      action: "assign_incident";
      incidentKey: string;
      assigneeEmail: string;
      assigneeUserId?: string | null;
      assigneeRegion?: string | null;
      assigneeTeam?: string | null;
      backupAssigneeEmail?: string | null;
      handoffType?: "assignment" | "follow_the_sun" | "handoff" | "shift_change";
      note?: string;
      shiftLabel?: string | null;
      shiftTimezone?: string | null;
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
    }
  | {
      action: "escalate_incident";
      incidentKey: string;
      afterHours?: boolean;
      backupOperatorEmail?: string | null;
      escalationLevel?: number;
      note?: string;
      regionalFailoverFrom?: string | null;
      regionalFailoverTo?: string | null;
      routeToRegion?: string | null;
      routeToRole?: string | null;
      routeToTeam?: string | null;
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
    }
  | {
      action: "add_incident_note";
      coordinationCategory?: string | null;
      delegatedRemediatorEmail?: string | null;
      incidentKey: string;
      linkedApprovalRequestId?: string | null;
      linkedGovernanceActionId?: string | null;
      note: string;
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
    }
  | {
      action: "retry_from_incident";
      delegatedRemediatorEmail?: string | null;
      incidentKey: string;
      linkedApprovalRequestId?: string | null;
      note?: string;
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
    }
  | {
      action: "approve_incident_severity";
      incidentKey: string;
      note?: string;
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
    };

export type AdminImpersonationInput = {
  targetUserId: string;
  libraryId?: string | null;
  reason?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type {
  AdminOperatorActionId,
  AdminOperatorApprovalPolicy,
  AdminOperatorGrantMode,
  AdminOperatorGrantRestrictions,
  AdminOperatorPage,
  AdminOperatorPermission,
  AdminOperatorPermissionExplanation,
  AdminOperatorRole,
  AdminOperatorScopeType,
};
