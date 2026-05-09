export const OPERATOR_POLICY_VERSION = "2026-05-08-enterprise-governance-runtime-v2";

export const OPERATOR_ROLE_VALUES = [
  "super_admin",
  "read_only_ops",
  "support_ops",
  "billing_ops",
  "incident_ops",
  "platform_admin",
  "emergency_ops",
] as const;

export type AdminOperatorRole = (typeof OPERATOR_ROLE_VALUES)[number];

export const OPERATOR_SCOPE_TYPE_VALUES = [
  "global",
  "platform",
  "tenant",
  "organization",
  "department",
  "team",
  "operational_group",
  "region",
  "governance_domain",
  "library",
  "user",
  "billing",
  "incident",
  "job",
  "queue",
  "feature_flag",
  "approval_request",
] as const;

export type AdminOperatorScopeType = (typeof OPERATOR_SCOPE_TYPE_VALUES)[number];

export const OPERATOR_GOVERNANCE_DOMAIN_VALUES = [
  "billing",
  "incident",
  "infrastructure",
  "support",
  "emergency",
  "platform",
] as const;

export type AdminOperatorGovernanceDomain = (typeof OPERATOR_GOVERNANCE_DOMAIN_VALUES)[number];

export const OPERATOR_DELEGATED_SCOPE_TYPE_VALUES = [
  "tenant",
  "organization",
  "department",
  "team",
  "operational_group",
  "region",
  "library",
  "billing",
  "incident",
  "support",
  "infrastructure",
  "emergency",
] as const;

export type AdminOperatorDelegatedScopeType = (typeof OPERATOR_DELEGATED_SCOPE_TYPE_VALUES)[number];

export const OPERATOR_GRANT_MODE_VALUES = [
  "direct",
  "temporary",
  "elevated",
  "emergency_override",
  "legacy_migrated",
] as const;

export type AdminOperatorGrantMode = (typeof OPERATOR_GRANT_MODE_VALUES)[number];

export const CONTROL_PLANE_PAGE_VALUES = [
  "dashboard",
  "libraries",
  "revenue",
  "billing",
  "incidents",
  "analytics",
  "broadcasts",
  "automation",
  "feature_flags",
  "observability",
  "settings",
] as const;

export type AdminOperatorPage = (typeof CONTROL_PLANE_PAGE_VALUES)[number];

export const OPERATOR_PERMISSION_VALUES = [
  "dashboard.read",
  "libraries.read",
  "libraries.manage",
  "users.manage",
  "revenue.read",
  "revenue.manage",
  "payouts.manage",
  "billing.read",
  "billing.manage",
  "incidents.read",
  "incidents.manage",
  "incidents.severity_approve",
  "analytics.read",
  "broadcasts.read",
  "broadcasts.manage",
  "automation.read",
  "automation.manage",
  "feature_flags.read",
  "feature_flags.manage",
  "observability.read",
  "settings.read",
  "settings.manage",
  "access.read",
  "access.manage",
  "governance.approve",
  "governance.override",
  "emergency.manage",
  "impersonation.manage",
] as const;

export type AdminOperatorPermission = (typeof OPERATOR_PERMISSION_VALUES)[number];

export const OPERATOR_ACTION_VALUES = [
  "governance_toggle",
  "emergency_control",
  "feature_flag_update",
  "library_control",
  "user_control",
  "session_clear",
  "password_reset",
  "revenue_adjustment",
  "commission_override",
  "payout_override",
  "invoice_create",
  "refund_process",
  "incident_acknowledge",
  "incident_assign",
  "incident_escalate",
  "incident_note",
  "incident_resolve",
  "incident_retry",
  "incident_severity_approve",
  "job_enqueue",
  "job_retry",
  "dead_letter_replay",
  "queue_cancel",
  "run_due_jobs",
  "broadcast_manage",
  "impersonation_start",
  "role_assignment",
  "role_revocation",
  "temporary_access_grant",
  "governance_approval",
  "governance_override",
] as const;

export type AdminOperatorActionId = (typeof OPERATOR_ACTION_VALUES)[number];
export type AdminOperatorActionSeverity = "medium" | "high" | "critical";

export type AdminOperatorScopeBoundary = {
  delegatedScopeId: string | null;
  delegatedScopeLabel: string | null;
  delegatedScopeType: AdminOperatorDelegatedScopeType | null;
  departmentId: string | null;
  departmentLabel: string | null;
  governanceDomain: AdminOperatorGovernanceDomain | null;
  operationalGroupId: string | null;
  operationalGroupLabel: string | null;
  organizationId: string | null;
  organizationLabel: string | null;
  regionId: string | null;
  regionLabel: string | null;
  teamId: string | null;
  teamLabel: string | null;
  tenantId: string | null;
  tenantLabel: string | null;
  visibilityTags: string[];
};

export const EMPTY_OPERATOR_SCOPE_BOUNDARY: AdminOperatorScopeBoundary = {
  delegatedScopeId: null,
  delegatedScopeLabel: null,
  delegatedScopeType: null,
  departmentId: null,
  departmentLabel: null,
  governanceDomain: null,
  operationalGroupId: null,
  operationalGroupLabel: null,
  organizationId: null,
  organizationLabel: null,
  regionId: null,
  regionLabel: null,
  teamId: null,
  teamLabel: null,
  tenantId: null,
  tenantLabel: null,
  visibilityTags: [],
};

export type AdminOperatorScope = {
  boundary: AdminOperatorScopeBoundary;
  scopeId: string | null;
  scopeLabel: string | null;
  scopeType: AdminOperatorScopeType;
};

export type AdminOperatorAvailabilityStatus =
  | "active"
  | "after_hours"
  | "away"
  | "backup"
  | "offline"
  | "standby";

export type AdminOperatorAvailabilityProfile = {
  backupOperator: string | null;
  fallbackChain: string[];
  regions: string[];
  shiftActive: boolean;
  shiftEndHourLocal: number | null;
  shiftLabel: string | null;
  shiftStartHourLocal: number | null;
  standby: boolean;
  status: AdminOperatorAvailabilityStatus;
  timezone: string | null;
  workloadCapacity: number | null;
};

export type AdminOperatorGrantRestrictions = {
  deniedActions?: AdminOperatorActionId[];
  deniedPermissions?: AdminOperatorPermission[];
  note?: string | null;
  readOnlyMode?: boolean;
};

export type AdminOperatorGrant = AdminOperatorScope & {
  email: string | null;
  expiresAt: string | null;
  grantId: string;
  grantMode: AdminOperatorGrantMode;
  metadata?: Record<string, unknown> | null;
  reason: string | null;
  restrictions: AdminOperatorGrantRestrictions;
  revokedAt: string | null;
  role: AdminOperatorRole;
  startsAt: string | null;
  userId: string | null;
};

export type AdminOperatorPermissionSource = AdminOperatorScope & {
  grantId: string;
  grantMode: AdminOperatorGrantMode;
  grantRole: AdminOperatorRole;
  inheritedFromRole: AdminOperatorRole | null;
  permission: AdminOperatorPermission;
  permissionRole: AdminOperatorRole;
};

export type AdminOperatorApprovalPolicy = {
  allowSelfApproval: boolean;
  approvalRequired: boolean;
  escalationRole: AdminOperatorRole | null;
  expiryMinutes: number;
  optionalSecondApprover: boolean;
  requiredApprovals: number;
};

export type AdminOperatorPermissionExplanation = {
  allowed: boolean;
  deniedByDefault: boolean;
  emergencyOverrideActive: boolean;
  grantedBy: string[];
  matchingSourceGrants: AdminOperatorPermissionSource[];
  permission: AdminOperatorPermission;
  readOnlyActive: boolean;
  restrictionBoundaries: string[];
  roleChain: string[];
  scopeChain: string[];
  summary: string;
};

export type AdminOperatorActionAccessDecision = AdminOperatorPermissionExplanation & {
  actionId: AdminOperatorActionId;
  approvalPolicy: AdminOperatorApprovalPolicy;
};

type AdminRoleDefinition = {
  inherits?: AdminOperatorRole[];
  label: string;
  permissions: AdminOperatorPermission[];
};

type AdminActionDefinition = {
  approvalPolicy?: Partial<AdminOperatorApprovalPolicy>;
  confirmationLabel: string;
  cooldownSeconds: number;
  label: string;
  permission: AdminOperatorPermission;
  requiresConfirmation: boolean;
  requiresReason: boolean;
  reversible: boolean;
  severity: AdminOperatorActionSeverity;
  supportsDryRun: boolean;
};

const READ_ONLY_PERMISSIONS: AdminOperatorPermission[] = [
  "dashboard.read",
  "libraries.read",
  "revenue.read",
  "billing.read",
  "incidents.read",
  "analytics.read",
  "broadcasts.read",
  "automation.read",
  "feature_flags.read",
  "observability.read",
  "settings.read",
  "access.read",
];

const ROLE_DEFINITIONS: Record<AdminOperatorRole, AdminRoleDefinition> = {
  super_admin: {
    inherits: ["emergency_ops"],
    label: "Super Admin",
    permissions: [
      "access.manage",
      "governance.approve",
      "governance.override",
    ],
  },
  read_only_ops: {
    label: "Read-only Ops",
    permissions: READ_ONLY_PERMISSIONS,
  },
  support_ops: {
    inherits: ["read_only_ops"],
    label: "Support Ops",
    permissions: [
      "users.manage",
    ],
  },
  billing_ops: {
    inherits: ["read_only_ops"],
    label: "Billing Ops",
    permissions: [
      "billing.manage",
      "revenue.manage",
      "payouts.manage",
    ],
  },
  incident_ops: {
    inherits: ["read_only_ops"],
    label: "Incident Ops",
    permissions: [
      "automation.manage",
      "incidents.manage",
    ],
  },
  platform_admin: {
    inherits: ["billing_ops", "incident_ops", "support_ops"],
    label: "Platform Admin",
    permissions: [
      "access.manage",
      "broadcasts.manage",
      "feature_flags.manage",
      "governance.approve",
      "impersonation.manage",
      "libraries.manage",
      "settings.manage",
    ],
  },
  emergency_ops: {
    inherits: ["platform_admin"],
    label: "Emergency Ops",
    permissions: [
      "emergency.manage",
      "governance.override",
      "incidents.severity_approve",
    ],
  },
};

const ACTION_DEFINITIONS: Record<AdminOperatorActionId, AdminActionDefinition> = {
  governance_toggle: {
    confirmationLabel: "APPLY GOVERNANCE CHANGE",
    cooldownSeconds: 300,
    label: "Governance toggle",
    permission: "settings.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: true,
  },
  emergency_control: {
    approvalPolicy: {
      approvalRequired: true,
      escalationRole: "emergency_ops",
      expiryMinutes: 15,
      optionalSecondApprover: true,
      requiredApprovals: 2,
    },
    confirmationLabel: "ENGAGE EMERGENCY CONTROL",
    cooldownSeconds: 300,
    label: "Emergency control",
    permission: "emergency.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "critical",
    supportsDryRun: true,
  },
  feature_flag_update: {
    confirmationLabel: "UPDATE FEATURE FLAG",
    cooldownSeconds: 60,
    label: "Feature flag update",
    permission: "feature_flags.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: true,
  },
  library_control: {
    confirmationLabel: "APPLY LIBRARY CONTROL",
    cooldownSeconds: 120,
    label: "Library control",
    permission: "libraries.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: false,
  },
  user_control: {
    confirmationLabel: "APPLY USER CONTROL",
    cooldownSeconds: 120,
    label: "User control",
    permission: "users.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: false,
  },
  session_clear: {
    confirmationLabel: "CLEAR USER SESSIONS",
    cooldownSeconds: 120,
    label: "Session clear",
    permission: "users.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "high",
    supportsDryRun: false,
  },
  password_reset: {
    confirmationLabel: "RESET USER PASSWORD",
    cooldownSeconds: 300,
    label: "Password reset",
    permission: "users.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "high",
    supportsDryRun: false,
  },
  revenue_adjustment: {
    confirmationLabel: "RECORD REVENUE ADJUSTMENT",
    cooldownSeconds: 300,
    label: "Revenue adjustment",
    permission: "revenue.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "high",
    supportsDryRun: true,
  },
  commission_override: {
    confirmationLabel: "OVERRIDE COMMISSION",
    cooldownSeconds: 300,
    label: "Commission override",
    permission: "revenue.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: true,
  },
  payout_override: {
    approvalPolicy: {
      approvalRequired: true,
      escalationRole: "billing_ops",
      expiryMinutes: 30,
      optionalSecondApprover: true,
      requiredApprovals: 2,
    },
    confirmationLabel: "OVERRIDE PAYOUT",
    cooldownSeconds: 300,
    label: "Payout override",
    permission: "payouts.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "critical",
    supportsDryRun: true,
  },
  invoice_create: {
    confirmationLabel: "CREATE INVOICE",
    cooldownSeconds: 300,
    label: "Invoice create",
    permission: "billing.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "medium",
    supportsDryRun: true,
  },
  refund_process: {
    approvalPolicy: {
      approvalRequired: true,
      escalationRole: "billing_ops",
      expiryMinutes: 30,
      optionalSecondApprover: true,
      requiredApprovals: 2,
    },
    confirmationLabel: "PROCESS REFUND",
    cooldownSeconds: 300,
    label: "Refund process",
    permission: "billing.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "critical",
    supportsDryRun: true,
  },
  incident_acknowledge: {
    confirmationLabel: "ACKNOWLEDGE INCIDENT",
    cooldownSeconds: 0,
    label: "Incident acknowledge",
    permission: "incidents.manage",
    requiresConfirmation: false,
    requiresReason: false,
    reversible: true,
    severity: "medium",
    supportsDryRun: false,
  },
  incident_assign: {
    confirmationLabel: "ASSIGN INCIDENT",
    cooldownSeconds: 0,
    label: "Incident assignment",
    permission: "incidents.manage",
    requiresConfirmation: false,
    requiresReason: false,
    reversible: true,
    severity: "medium",
    supportsDryRun: false,
  },
  incident_escalate: {
    confirmationLabel: "ESCALATE INCIDENT",
    cooldownSeconds: 120,
    label: "Incident escalation",
    permission: "incidents.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: true,
  },
  incident_note: {
    confirmationLabel: "SAVE INCIDENT NOTE",
    cooldownSeconds: 0,
    label: "Incident note",
    permission: "incidents.manage",
    requiresConfirmation: false,
    requiresReason: false,
    reversible: true,
    severity: "medium",
    supportsDryRun: false,
  },
  incident_resolve: {
    confirmationLabel: "RESOLVE INCIDENT",
    cooldownSeconds: 120,
    label: "Incident resolution",
    permission: "incidents.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: true,
  },
  incident_retry: {
    approvalPolicy: {
      approvalRequired: true,
      escalationRole: "incident_ops",
      expiryMinutes: 20,
      optionalSecondApprover: false,
      requiredApprovals: 2,
    },
    confirmationLabel: "RETRY INCIDENT JOB",
    cooldownSeconds: 300,
    label: "Incident retry",
    permission: "incidents.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "critical",
    supportsDryRun: true,
  },
  incident_severity_approve: {
    confirmationLabel: "APPROVE INCIDENT SEVERITY",
    cooldownSeconds: 300,
    label: "Incident severity approval",
    permission: "incidents.severity_approve",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "critical",
    supportsDryRun: true,
  },
  job_enqueue: {
    confirmationLabel: "ENQUEUE JOB",
    cooldownSeconds: 60,
    label: "Job enqueue",
    permission: "automation.manage",
    requiresConfirmation: false,
    requiresReason: false,
    reversible: false,
    severity: "medium",
    supportsDryRun: false,
  },
  job_retry: {
    confirmationLabel: "RETRY JOB",
    cooldownSeconds: 300,
    label: "Job retry",
    permission: "automation.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "high",
    supportsDryRun: true,
  },
  dead_letter_replay: {
    confirmationLabel: "REPLAY JOB",
    cooldownSeconds: 300,
    label: "Dead-letter replay",
    permission: "automation.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "critical",
    supportsDryRun: true,
  },
  queue_cancel: {
    approvalPolicy: {
      approvalRequired: true,
      escalationRole: "incident_ops",
      expiryMinutes: 20,
      optionalSecondApprover: false,
      requiredApprovals: 1,
    },
    confirmationLabel: "CANCEL JOB",
    cooldownSeconds: 120,
    label: "Queue cancellation",
    permission: "automation.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "high",
    supportsDryRun: true,
  },
  run_due_jobs: {
    approvalPolicy: {
      approvalRequired: true,
      escalationRole: "incident_ops",
      expiryMinutes: 20,
      optionalSecondApprover: false,
      requiredApprovals: 1,
    },
    confirmationLabel: "RUN DUE JOBS",
    cooldownSeconds: 120,
    label: "Run due jobs",
    permission: "automation.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "high",
    supportsDryRun: true,
  },
  broadcast_manage: {
    confirmationLabel: "SEND BROADCAST",
    cooldownSeconds: 300,
    label: "Broadcast management",
    permission: "broadcasts.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: false,
    severity: "high",
    supportsDryRun: true,
  },
  impersonation_start: {
    confirmationLabel: "START IMPERSONATION",
    cooldownSeconds: 300,
    label: "Impersonation",
    permission: "impersonation.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "critical",
    supportsDryRun: false,
  },
  role_assignment: {
    confirmationLabel: "ASSIGN OPERATOR ROLE",
    cooldownSeconds: 60,
    label: "Role assignment",
    permission: "access.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: true,
  },
  role_revocation: {
    confirmationLabel: "REVOKE OPERATOR ROLE",
    cooldownSeconds: 60,
    label: "Role revocation",
    permission: "access.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: true,
  },
  temporary_access_grant: {
    approvalPolicy: {
      approvalRequired: true,
      escalationRole: "platform_admin",
      expiryMinutes: 20,
      optionalSecondApprover: true,
      requiredApprovals: 2,
    },
    confirmationLabel: "GRANT TEMPORARY ACCESS",
    cooldownSeconds: 120,
    label: "Temporary access grant",
    permission: "access.manage",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "critical",
    supportsDryRun: true,
  },
  governance_approval: {
    confirmationLabel: "APPROVE GOVERNANCE REQUEST",
    cooldownSeconds: 0,
    label: "Governance approval",
    permission: "governance.approve",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "high",
    supportsDryRun: true,
  },
  governance_override: {
    confirmationLabel: "EXECUTE GOVERNANCE OVERRIDE",
    cooldownSeconds: 300,
    label: "Governance override",
    permission: "governance.override",
    requiresConfirmation: true,
    requiresReason: true,
    reversible: true,
    severity: "critical",
    supportsDryRun: true,
  },
};

const PAGE_TO_PERMISSION: Record<AdminOperatorPage, AdminOperatorPermission> = {
  dashboard: "dashboard.read",
  libraries: "libraries.read",
  revenue: "revenue.read",
  billing: "billing.read",
  incidents: "incidents.read",
  analytics: "analytics.read",
  broadcasts: "broadcasts.read",
  automation: "automation.read",
  feature_flags: "feature_flags.read",
  observability: "observability.read",
  settings: "settings.read",
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeRole = (value: unknown): AdminOperatorRole | null => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "emergency_admin") {
    return "emergency_ops";
  }

  return OPERATOR_ROLE_VALUES.includes(normalized as AdminOperatorRole)
    ? (normalized as AdminOperatorRole)
    : null;
};

const normalizeScopeType = (value: unknown): AdminOperatorScopeType =>
  OPERATOR_SCOPE_TYPE_VALUES.includes(value as AdminOperatorScopeType)
    ? (value as AdminOperatorScopeType)
    : "global";

const normalizeGovernanceDomain = (value: unknown): AdminOperatorGovernanceDomain | null =>
  OPERATOR_GOVERNANCE_DOMAIN_VALUES.includes(value as AdminOperatorGovernanceDomain)
    ? (value as AdminOperatorGovernanceDomain)
    : null;

const normalizeDelegatedScopeType = (value: unknown): AdminOperatorDelegatedScopeType | null =>
  OPERATOR_DELEGATED_SCOPE_TYPE_VALUES.includes(value as AdminOperatorDelegatedScopeType)
    ? (value as AdminOperatorDelegatedScopeType)
    : null;

const normalizeGrantMode = (value: unknown): AdminOperatorGrantMode =>
  OPERATOR_GRANT_MODE_VALUES.includes(value as AdminOperatorGrantMode)
    ? (value as AdminOperatorGrantMode)
    : "direct";

const normalizePermission = (value: unknown): AdminOperatorPermission | null =>
  OPERATOR_PERMISSION_VALUES.includes(value as AdminOperatorPermission)
    ? (value as AdminOperatorPermission)
    : null;

const normalizeAction = (value: unknown): AdminOperatorActionId | null =>
  OPERATOR_ACTION_VALUES.includes(value as AdminOperatorActionId)
    ? (value as AdminOperatorActionId)
    : null;

const toBoundaryRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizeVisibilityTags = (value: unknown) =>
  [...new Set((Array.isArray(value) ? value : []).map((entry) => normalizeText(entry)).filter(Boolean))];

const normalizeScopeBoundary = (
  value: unknown,
  metadataValue: unknown = null,
): AdminOperatorScopeBoundary => {
  const metadataBoundaryRecord = toBoundaryRecord(toBoundaryRecord(metadataValue)?.boundary);
  const directBoundaryRecord = toBoundaryRecord(toBoundaryRecord(value)?.boundary);
  const record = metadataBoundaryRecord ?? directBoundaryRecord ?? toBoundaryRecord(value) ?? EMPTY_OPERATOR_SCOPE_BOUNDARY;

  return {
    delegatedScopeId: normalizeText(record.delegatedScopeId ?? record.delegated_scope_id) || null,
    delegatedScopeLabel: normalizeText(record.delegatedScopeLabel ?? record.delegated_scope_label) || null,
    delegatedScopeType: normalizeDelegatedScopeType(record.delegatedScopeType ?? record.delegated_scope_type),
    departmentId: normalizeText(record.departmentId ?? record.department_id) || null,
    departmentLabel: normalizeText(record.departmentLabel ?? record.department_label) || null,
    governanceDomain: normalizeGovernanceDomain(record.governanceDomain ?? record.governance_domain),
    operationalGroupId: normalizeText(record.operationalGroupId ?? record.operational_group_id) || null,
    operationalGroupLabel: normalizeText(record.operationalGroupLabel ?? record.operational_group_label) || null,
    organizationId: normalizeText(record.organizationId ?? record.organization_id) || null,
    organizationLabel: normalizeText(record.organizationLabel ?? record.organization_label) || null,
    regionId: normalizeText(record.regionId ?? record.region_id) || null,
    regionLabel: normalizeText(record.regionLabel ?? record.region_label) || null,
    teamId: normalizeText(record.teamId ?? record.team_id) || null,
    teamLabel: normalizeText(record.teamLabel ?? record.team_label) || null,
    tenantId: normalizeText(record.tenantId ?? record.tenant_id) || null,
    tenantLabel: normalizeText(record.tenantLabel ?? record.tenant_label) || null,
    visibilityTags: normalizeVisibilityTags(record.visibilityTags ?? record.visibility_tags),
  };
};

const resolveScopeMatchToken = (scope: Pick<AdminOperatorScope, "boundary" | "scopeId" | "scopeType">) => {
  switch (scope.scopeType) {
    case "tenant":
      return scope.boundary.tenantId ?? scope.scopeId;
    case "organization":
      return scope.boundary.organizationId ?? scope.scopeId;
    case "department":
      return scope.boundary.departmentId ?? scope.scopeId;
    case "team":
      return scope.boundary.teamId ?? scope.scopeId;
    case "operational_group":
      return scope.boundary.operationalGroupId ?? scope.scopeId;
    case "region":
      return scope.boundary.regionId ?? scope.scopeId;
    case "governance_domain":
      return scope.boundary.governanceDomain ?? scope.scopeId;
    default:
      return scope.scopeId;
  }
};

const collectScopeBoundaryLabels = (
  scope: Pick<AdminOperatorScope, "boundary"> | null | undefined,
) => {
  const boundary = scope?.boundary ?? EMPTY_OPERATOR_SCOPE_BOUNDARY;
  return [
    boundary.tenantLabel || boundary.tenantId ? `Tenant ${boundary.tenantLabel || boundary.tenantId}` : null,
    boundary.organizationLabel || boundary.organizationId ? `Org ${boundary.organizationLabel || boundary.organizationId}` : null,
    boundary.departmentLabel || boundary.departmentId ? `Dept ${boundary.departmentLabel || boundary.departmentId}` : null,
    boundary.teamLabel || boundary.teamId ? `Team ${boundary.teamLabel || boundary.teamId}` : null,
    boundary.operationalGroupLabel || boundary.operationalGroupId
      ? `Ops ${boundary.operationalGroupLabel || boundary.operationalGroupId}`
      : null,
    boundary.regionLabel || boundary.regionId ? `Region ${boundary.regionLabel || boundary.regionId}` : null,
    boundary.governanceDomain ? `Domain ${boundary.governanceDomain}` : null,
    boundary.delegatedScopeLabel || boundary.delegatedScopeId
      ? `Delegated ${boundary.delegatedScopeType || "scope"} ${boundary.delegatedScopeLabel || boundary.delegatedScopeId}`
      : null,
  ].filter((entry): entry is string => Boolean(entry));
};

const boundaryMatches = (
  source: AdminOperatorScopeBoundary,
  target: AdminOperatorScopeBoundary,
) => {
  const comparableFields = [
    ["tenantId", source.tenantId, target.tenantId],
    ["organizationId", source.organizationId, target.organizationId],
    ["departmentId", source.departmentId, target.departmentId],
    ["teamId", source.teamId, target.teamId],
    ["operationalGroupId", source.operationalGroupId, target.operationalGroupId],
    ["regionId", source.regionId, target.regionId],
    ["governanceDomain", source.governanceDomain, target.governanceDomain],
    ["delegatedScopeType", source.delegatedScopeType, target.delegatedScopeType],
    ["delegatedScopeId", source.delegatedScopeId, target.delegatedScopeId],
  ] as const;

  if (comparableFields.some(([, left, right]) => left && right && left !== right)) {
    return false;
  }

  if (
    source.visibilityTags.length &&
    target.visibilityTags.length &&
    !source.visibilityTags.some((tag) => target.visibilityTags.includes(tag))
  ) {
    return false;
  }

  return true;
};

export const buildScopeBoundarySummary = (
  scope: Pick<AdminOperatorScope, "boundary"> | null | undefined,
) => {
  const labels = collectScopeBoundaryLabels(scope);
  return labels.length ? labels.join(" / ") : "Global boundary";
};

const collectRolePermissions = (
  role: AdminOperatorRole,
  visited = new Set<AdminOperatorRole>(),
): AdminOperatorPermission[] => {
  if (visited.has(role)) {
    return [];
  }

  visited.add(role);
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) {
    return [];
  }

  const inherited = (definition.inherits ?? []).flatMap((parent) => collectRolePermissions(parent, visited));
  return [...inherited, ...definition.permissions];
};

const collectRoleChain = (
  role: AdminOperatorRole,
  visited = new Set<AdminOperatorRole>(),
): AdminOperatorRole[] => {
  if (visited.has(role)) {
    return [];
  }

  visited.add(role);
  const definition = ROLE_DEFINITIONS[role];
  if (!definition) {
    return [];
  }

  const inherited = (definition.inherits ?? []).flatMap((parent) => collectRoleChain(parent, visited));
  return [...inherited, role];
};

const collectPermissionSourcesForGrant = (
  grant: AdminOperatorGrant,
): AdminOperatorPermissionSource[] =>
  collectRoleChain(grant.role).flatMap((permissionRole) =>
    collectRolePermissions(permissionRole)
      .filter((permission, index, permissions) => permissions.indexOf(permission) === index)
      .filter((permission) => ROLE_DEFINITIONS[permissionRole].permissions.includes(permission))
      .map((permission) => ({
        grantId: grant.grantId,
        grantMode: grant.grantMode,
        grantRole: grant.role,
        inheritedFromRole: permissionRole === grant.role ? null : grant.role,
        permission,
        permissionRole,
        boundary: grant.boundary,
        scopeId: grant.scopeId,
        scopeLabel: grant.scopeLabel,
        scopeType: grant.scopeType,
      })),
  );

const isWriteLikePermission = (permission: AdminOperatorPermission) =>
  permission.endsWith(".manage") ||
  permission.endsWith(".approve") ||
  permission.endsWith(".override");

const normalizeRestrictions = (value: unknown): AdminOperatorGrantRestrictions => {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  return {
    deniedActions: (Array.isArray(record.deniedActions) ? record.deniedActions : record.denied_actions)
      ?.map((entry) => normalizeAction(entry))
      .filter((entry): entry is AdminOperatorActionId => Boolean(entry)),
    deniedPermissions: (Array.isArray(record.deniedPermissions) ? record.deniedPermissions : record.denied_permissions)
      ?.map((entry) => normalizePermission(entry))
      .filter((entry): entry is AdminOperatorPermission => Boolean(entry)),
    note: normalizeText(record.note) || null,
    readOnlyMode: record.readOnlyMode === true || record.read_only_mode === true,
  };
};

const normalizeGrant = (value: unknown): AdminOperatorGrant | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const role = normalizeRole(record.role);
  if (!role) {
    return null;
  }

  return {
    boundary: normalizeScopeBoundary(record, record.metadata),
    email: normalizeText(record.email) || null,
    expiresAt: normalizeText(record.expiresAt ?? record.expires_at) || null,
    grantId: normalizeText(record.grantId ?? record.id) || `${role}:${normalizeText(record.userId ?? record.user_id ?? record.email) || "anonymous"}`,
    grantMode: normalizeGrantMode(record.grantMode ?? record.grant_mode),
    metadata: toBoundaryRecord(record.metadata),
    reason: normalizeText(record.reason) || null,
    restrictions: normalizeRestrictions(record.restrictions),
    revokedAt: normalizeText(record.revokedAt ?? record.revoked_at) || null,
    role,
    scopeId: normalizeText(record.scopeId ?? record.scope_id) || null,
    scopeLabel: normalizeText(record.scopeLabel ?? record.scope_label) || null,
    scopeType: normalizeScopeType(record.scopeType ?? record.scope_type),
    startsAt: normalizeText(record.startsAt ?? record.starts_at) || null,
    userId: normalizeText(record.userId ?? record.user_id) || null,
  };
};

const isGrantActive = (grant: AdminOperatorGrant, atMs = Date.now()) => {
  if (grant.revokedAt) {
    return false;
  }

  if (grant.startsAt) {
    const startsAtMs = Date.parse(grant.startsAt);
    if (Number.isFinite(startsAtMs) && startsAtMs > atMs) {
      return false;
    }
  }

  if (grant.expiresAt) {
    const expiresAtMs = Date.parse(grant.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= atMs) {
      return false;
    }
  }

  return true;
};

const buildScopeDescriptor = ({ boundary, scopeId, scopeLabel, scopeType }: AdminOperatorScope) => {
  const boundarySummary = buildScopeBoundarySummary({ boundary });
  if (scopeType === "global" || scopeType === "platform") {
    return boundarySummary === "Global boundary" ? "Global scope" : `Global scope @ ${boundarySummary}`;
  }

  const scopedLabel = scopeLabel && scopeId
    ? `${scopeType}:${scopeLabel} (${scopeId})`
    : scopeLabel
      ? `${scopeType}:${scopeLabel}`
      : scopeId
        ? `${scopeType}:${scopeId}`
        : `${scopeType}:${resolveScopeMatchToken({ boundary, scopeId, scopeType }) ?? "unbounded"}`;

  return boundarySummary === "Global boundary" ? scopedLabel : `${scopedLabel} @ ${boundarySummary}`;
};

const scopeMatches = (source: AdminOperatorScope, targets: AdminOperatorScope[]) => {
  if (!targets.length) {
    return true;
  }

  return targets.some((target) => {
    if (!boundaryMatches(source.boundary, target.boundary)) {
      return false;
    }

    if (target.scopeType === "global" || target.scopeType === "platform") {
      return true;
    }

    if (source.scopeType === "global" || source.scopeType === "platform") {
      return true;
    }

    if (source.scopeType !== target.scopeType) {
      return false;
    }

    const sourceToken = resolveScopeMatchToken(source);
    const targetToken = resolveScopeMatchToken(target);
    if (!sourceToken || !targetToken) {
      return false;
    }

    return sourceToken === targetToken;
  });
};

const uniqueStrings = (values: string[]) => [...new Set(values.filter(Boolean))];

export const getOperatorRoleLabel = (role: AdminOperatorRole) => ROLE_DEFINITIONS[role]?.label ?? role;

export const normalizeOperatorRoles = (values: Array<unknown> | null | undefined): AdminOperatorRole[] => {
  const roles = (values ?? [])
    .map((value) => normalizeRole(value))
    .filter((value): value is AdminOperatorRole => Boolean(value));

  return [...new Set(roles)];
};

export const normalizeOperatorGrants = (values: Array<unknown> | null | undefined): AdminOperatorGrant[] => {
  const grants = (values ?? [])
    .map((value) => normalizeGrant(value))
    .filter((value): value is AdminOperatorGrant => Boolean(value));

  return [...new Map(grants.map((grant) => [grant.grantId, grant])).values()];
};

export const expandInheritedOperatorRoles = (
  values: Array<unknown> | null | undefined,
): AdminOperatorRole[] => {
  const roles = normalizeOperatorRoles(values);
  return [...new Set(roles.flatMap((role) => collectRoleChain(role)))];
};

export const expandOperatorPermissions = (
  rolesOrGrants: Array<unknown> | null | undefined,
): AdminOperatorPermission[] => {
  const grants = normalizeOperatorGrants(rolesOrGrants);
  const roles = grants.length
    ? grants.filter((grant) => isGrantActive(grant)).map((grant) => grant.role)
    : normalizeOperatorRoles(rolesOrGrants);

  const permissions = roles.flatMap((role) => collectRolePermissions(role));
  return [...new Set(permissions)].sort();
};

export const buildPermissionSources = (
  grants: Array<unknown> | null | undefined,
): AdminOperatorPermissionSource[] =>
  normalizeOperatorGrants(grants)
    .filter((grant) => isGrantActive(grant))
    .flatMap((grant) => collectPermissionSourcesForGrant(grant));

export const resolveOperatorPages = (permissions: Array<unknown> | null | undefined): AdminOperatorPage[] => {
  const normalizedPermissions = new Set(
    (permissions ?? []).filter((value): value is AdminOperatorPermission =>
      OPERATOR_PERMISSION_VALUES.includes(value as AdminOperatorPermission),
    ),
  );

  return CONTROL_PLANE_PAGE_VALUES.filter((page) => normalizedPermissions.has(PAGE_TO_PERMISSION[page]));
};

export const hasOperatorPermission = (
  permissions: Array<unknown> | null | undefined,
  permission: AdminOperatorPermission,
) =>
  (permissions ?? []).some((value) => value === permission);

export const canAccessControlPlanePage = (
  permissions: Array<unknown> | null | undefined,
  page: AdminOperatorPage,
) => hasOperatorPermission(permissions, PAGE_TO_PERMISSION[page]);

export const getActionDefinition = (actionId: AdminOperatorActionId) => ACTION_DEFINITIONS[actionId];

export const getActionConfirmationLabel = (actionId: AdminOperatorActionId) =>
  ACTION_DEFINITIONS[actionId]?.confirmationLabel ?? "CONFIRM ACTION";

export const resolveActionApprovalPolicy = (actionId: AdminOperatorActionId): AdminOperatorApprovalPolicy => {
  const definition = ACTION_DEFINITIONS[actionId];
  const approvalPolicy = definition.approvalPolicy ?? {};

  return {
    allowSelfApproval: approvalPolicy.allowSelfApproval === true,
    approvalRequired: approvalPolicy.approvalRequired === true,
    escalationRole: approvalPolicy.escalationRole ?? null,
    expiryMinutes: approvalPolicy.expiryMinutes ?? 30,
    optionalSecondApprover: approvalPolicy.optionalSecondApprover === true,
    requiredApprovals: approvalPolicy.requiredApprovals ?? (approvalPolicy.approvalRequired ? 1 : 0),
  };
};

export const explainOperatorPermission = ({
  actionId,
  grants,
  permission,
  targetScopes,
}: {
  actionId?: AdminOperatorActionId | null;
  grants: Array<unknown> | null | undefined;
  permission: AdminOperatorPermission;
  targetScopes?: AdminOperatorScope[];
}): AdminOperatorPermissionExplanation => {
  const normalizedGrants = normalizeOperatorGrants(grants).filter((grant) => isGrantActive(grant));
  const sources = buildPermissionSources(normalizedGrants).filter((source) => source.permission === permission);
  const matchedSources = sources.filter((source) => scopeMatches(source, targetScopes ?? []));
  const readOnlyActive = normalizedGrants.some((grant) => grant.restrictions.readOnlyMode === true);
  const emergencyOverrideActive = normalizedGrants.some((grant) =>
    grant.grantMode === "emergency_override" ||
    grant.role === "emergency_ops" ||
    grant.role === "super_admin",
  );
  const restrictionBoundaries: string[] = [];
  let allowed = matchedSources.length > 0;
  const deniedByDefault = matchedSources.length === 0;

  if (readOnlyActive && isWriteLikePermission(permission) && !emergencyOverrideActive) {
    allowed = false;
    restrictionBoundaries.push("Read-only mode is active for this operator.");
  }

  for (const grant of normalizedGrants) {
    const deniedPermissions = grant.restrictions.deniedPermissions ?? [];
    const deniedActions = grant.restrictions.deniedActions ?? [];

    if (deniedPermissions.includes(permission)) {
      allowed = false;
      restrictionBoundaries.push(
        `${getOperatorRoleLabel(grant.role)} explicitly denies ${permission}.`,
      );
    }

    if (actionId && deniedActions.includes(actionId)) {
      allowed = false;
      restrictionBoundaries.push(
        `${getOperatorRoleLabel(grant.role)} explicitly blocks ${actionId}.`,
      );
    }

    if (grant.restrictions.note) {
      restrictionBoundaries.push(grant.restrictions.note);
    }
  }

  if (!matchedSources.length) {
    restrictionBoundaries.push(
      targetScopes?.length
        ? "No active grant matches the requested action scope."
        : "No active grant supplies this permission.",
    );
  }

  const roleChain = uniqueStrings(
    matchedSources.map((source) =>
      source.inheritedFromRole
        ? `${getOperatorRoleLabel(source.grantRole)} -> ${getOperatorRoleLabel(source.permissionRole)}`
        : getOperatorRoleLabel(source.permissionRole),
    ),
  );
  const scopeChain = uniqueStrings(matchedSources.map((source) => buildScopeDescriptor(source)));
  const grantedBy = uniqueStrings(matchedSources.map((source) => `${getOperatorRoleLabel(source.grantRole)} via ${buildScopeDescriptor(source)}`));

  const summary = allowed
    ? matchedSources.length
      ? `Allowed by ${grantedBy.join(", ")}.`
      : "Allowed."
    : deniedByDefault
      ? "Denied by default because no active scoped grant matches this action."
      : `Denied because ${restrictionBoundaries.join(" ")}`;

  return {
    allowed,
    deniedByDefault,
    emergencyOverrideActive,
    grantedBy,
    matchingSourceGrants: matchedSources,
    permission,
    readOnlyActive,
    restrictionBoundaries: uniqueStrings(restrictionBoundaries),
    roleChain,
    scopeChain,
    summary,
  };
};

export const evaluateOperatorActionAccess = ({
  actionId,
  grants,
  targetScopes,
}: {
  actionId: AdminOperatorActionId;
  grants: Array<unknown> | null | undefined;
  targetScopes?: AdminOperatorScope[];
}): AdminOperatorActionAccessDecision => {
  const definition = getActionDefinition(actionId);
  const explanation = explainOperatorPermission({
    actionId,
    grants,
    permission: definition.permission,
    targetScopes,
  });

  return {
    ...explanation,
    actionId,
    approvalPolicy: resolveActionApprovalPolicy(actionId),
  };
};

export const canPerformOperatorAction = (
  permissions: Array<unknown> | null | undefined,
  actionId: AdminOperatorActionId,
) => hasOperatorPermission(permissions, ACTION_DEFINITIONS[actionId].permission);

export const resolveIncidentSlaMinutes = (severity: string | null | undefined) => {
  const normalized = normalizeText(severity).toUpperCase();

  if (normalized === "CRITICAL") {
    return 15;
  }

  if (normalized === "ERROR") {
    return 60;
  }

  if (normalized === "WARNING") {
    return 4 * 60;
  }

  return 24 * 60;
};
