import { useEffect, useMemo, useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { OperatorActionDialog, type OperatorActionDialogConfig } from "@/components/superAdmin/OperatorActionDialog";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAdminMutation, useControlPlane, useSecurity, useSecurityMutation } from "@/hooks/superAdmin";
import { adminClient } from "@/lib/superAdmin/client";
import {
  buildPriorOperatorActions,
  buildRuntimeDependencyStatus,
  hydrateOperatorPreview,
} from "@/lib/superAdmin/operatorPreview";
import {
  extractOperatorActionPreview,
  resolveOperatorPlaybooks,
  type OperatorActionContextSection,
} from "@/lib/superAdmin/operatorSafety";
import { formatDateTime } from "@/lib/superAdmin/presentation";
import {
  buildScopeBoundarySummary,
  type AdminOperatorGovernanceDomain,
  expandInheritedOperatorRoles,
  expandOperatorPermissions,
  getOperatorRoleLabel,
  type AdminOperatorScopeBoundary,
  type AdminOperatorRole,
} from "@/lib/superAdmin/governance";
import type {
  AdminOperatorApprovalRequest,
  AdminOperatorRoleGrant,
} from "@/lib/superAdmin/types";

const OPERATOR_ROLE_OPTIONS: AdminOperatorRole[] = [
  "read_only_ops",
  "support_ops",
  "billing_ops",
  "incident_ops",
  "platform_admin",
  "emergency_ops",
  "super_admin",
] as const;

const GRANT_MODE_OPTIONS = [
  { label: "Direct", value: "direct" },
  { label: "Temporary", value: "temporary" },
  { label: "Elevated", value: "elevated" },
  { label: "Emergency Override", value: "emergency_override" },
] as const;

const SCOPE_TYPE_OPTIONS = [
  { label: "Global", value: "global" },
  { label: "Platform", value: "platform" },
  { label: "Tenant", value: "tenant" },
  { label: "Organization", value: "organization" },
  { label: "Department", value: "department" },
  { label: "Team", value: "team" },
  { label: "Operational Group", value: "operational_group" },
  { label: "Region", value: "region" },
  { label: "Governance Domain", value: "governance_domain" },
  { label: "Library", value: "library" },
  { label: "User", value: "user" },
  { label: "Billing", value: "billing" },
  { label: "Incident", value: "incident" },
  { label: "Queue", value: "queue" },
  { label: "Job", value: "job" },
  { label: "Feature Flag", value: "feature_flag" },
  { label: "Approval Request", value: "approval_request" },
] as const;

const GOVERNANCE_DOMAIN_OPTIONS: Array<{ label: string; value: AdminOperatorGovernanceDomain }> = [
  { label: "Billing", value: "billing" },
  { label: "Incident", value: "incident" },
  { label: "Infrastructure", value: "infrastructure" },
  { label: "Support", value: "support" },
  { label: "Emergency", value: "emergency" },
  { label: "Platform", value: "platform" },
];

const AUTO_REFRESH_MS = 30_000;

const findSettingValue = (settings: Array<{ key: string; value: unknown }>, key: string) =>
  settings.find((setting) => setting.key === key)?.value;

const toLocalDateTimeInput = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const pad = (input: number) => String(input).padStart(2, "0");
  return [
    parsed.getFullYear(),
    "-",
    pad(parsed.getMonth() + 1),
    "-",
    pad(parsed.getDate()),
    "T",
    pad(parsed.getHours()),
    ":",
    pad(parsed.getMinutes()),
  ].join("");
};

const toIsoOrNull = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const toIntegerOrNull = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.min(24, Math.trunc(parsed)));
};

const parseCommaSeparatedList = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const buildGrantModeLabel = (value: string) =>
  GRANT_MODE_OPTIONS.find((option) => option.value === value)?.label ?? value;

const buildGrantSummary = (grant: AdminOperatorRoleGrant) =>
  `${grant.email || grant.userId || "operator"} - ${grant.roleLabel} - ${grant.scopeLabel || grant.scopeId || grant.scopeType}`;

const createEmptyBoundary = (): AdminOperatorScopeBoundary => ({
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
});

const normalizeBoundaryInput = (boundary: AdminOperatorScopeBoundary): Partial<AdminOperatorScopeBoundary> | null => {
  const nextBoundary: Partial<AdminOperatorScopeBoundary> = {
    delegatedScopeId: boundary.delegatedScopeId?.trim() || null,
    delegatedScopeLabel: boundary.delegatedScopeLabel?.trim() || null,
    delegatedScopeType: boundary.delegatedScopeType || null,
    departmentId: boundary.departmentId?.trim() || null,
    departmentLabel: boundary.departmentLabel?.trim() || null,
    governanceDomain: boundary.governanceDomain || null,
    operationalGroupId: boundary.operationalGroupId?.trim() || null,
    operationalGroupLabel: boundary.operationalGroupLabel?.trim() || null,
    organizationId: boundary.organizationId?.trim() || null,
    organizationLabel: boundary.organizationLabel?.trim() || null,
    regionId: boundary.regionId?.trim() || null,
    regionLabel: boundary.regionLabel?.trim() || null,
    teamId: boundary.teamId?.trim() || null,
    teamLabel: boundary.teamLabel?.trim() || null,
    tenantId: boundary.tenantId?.trim() || null,
    tenantLabel: boundary.tenantLabel?.trim() || null,
    visibilityTags: boundary.visibilityTags.filter(Boolean),
  };

  return Object.values(nextBoundary).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value))
    ? nextBoundary
    : null;
};

const matchesGovernanceSearch = (search: string, values: Array<string | null | undefined>) => {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return values.some((value) => String(value ?? "").toLowerCase().includes(normalized));
};

const SettingsSelect = ({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
}) => (
  <select
    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
    onChange={(event) => onChange(event.target.value)}
    value={value}
  >
    {options.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))}
  </select>
);

const SuperAdminSettings = () => {
  const { toast } = useToast();
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [actionDialog, setActionDialog] = useState<OperatorActionDialogConfig | null>(null);
  const [governanceSearch, setGovernanceSearch] = useState("");
  const [approvalSearch, setApprovalSearch] = useState("");
  const [assignmentForm, setAssignmentForm] = useState({
    availabilityStatus: "active",
    backupOperator: "",
    boundary: createEmptyBoundary(),
    email: "",
    expiresAt: "",
    fallbackChain: "",
    grantMode: "direct",
    regions: "",
    readOnlyMode: false,
    reason: "",
    role: "support_ops" as AdminOperatorRole,
    scopeId: "",
    scopeLabel: "",
    scopeType: "global",
    shiftEndHourLocal: "",
    shiftLabel: "",
    shiftStartHourLocal: "",
    standby: false,
    startsAt: "",
    timezone: "",
    userId: "",
    workloadCapacity: "",
  });
  const refetchIntervalMs = autoRefreshEnabled ? AUTO_REFRESH_MS : false;
  const platformQuery = useControlPlane(refetchIntervalMs);
  const securityQuery = useSecurity({ refetchIntervalMs });
  const saveSecurity = useSecurityMutation();
  const savePlatform = useAdminMutation({
    invalidateQueryKeys: [["admin-platform"], ["admin-analytics"], ["admin-jobs"]],
    mutationFn: adminClient.mutatePlatformSettings,
  });

  const settings = platformQuery.data?.settings ?? [];
  const maintenanceMode = Boolean(findSettingValue(settings, "maintenance_mode"));
  const [inactiveLibraryDays, setInactiveLibraryDays] = useState(
    String(findSettingValue(settings, "inactive_library_days") ?? 14),
  );
  const [queueProcessingEnabled, setQueueProcessingEnabled] = useState(
    Boolean(findSettingValue(settings, "ops_queue_processing_enabled") ?? true),
  );
  const [billingMutationsEnabled, setBillingMutationsEnabled] = useState(
    Boolean(findSettingValue(settings, "ops_billing_mutations_enabled") ?? true),
  );
  const [automationRenewalEnabled, setAutomationRenewalEnabled] = useState(
    Boolean(findSettingValue(settings, "automation_subscription_renewal_enabled") ?? true),
  );
  const [automationReminderEnabled, setAutomationReminderEnabled] = useState(
    Boolean(findSettingValue(settings, "automation_payment_reminder_enabled") ?? true),
  );
  const [automationInactiveAlertEnabled, setAutomationInactiveAlertEnabled] = useState(
    Boolean(findSettingValue(settings, "automation_inactive_library_alert_enabled") ?? true),
  );
  const [whitelistText, setWhitelistText] = useState(
    (securityQuery.data?.whitelist ?? []).join("\n"),
  );

  useEffect(() => {
    setInactiveLibraryDays(String(findSettingValue(settings, "inactive_library_days") ?? 14));
    setQueueProcessingEnabled(Boolean(findSettingValue(settings, "ops_queue_processing_enabled") ?? true));
    setBillingMutationsEnabled(Boolean(findSettingValue(settings, "ops_billing_mutations_enabled") ?? true));
    setAutomationRenewalEnabled(Boolean(findSettingValue(settings, "automation_subscription_renewal_enabled") ?? true));
    setAutomationReminderEnabled(Boolean(findSettingValue(settings, "automation_payment_reminder_enabled") ?? true));
    setAutomationInactiveAlertEnabled(Boolean(findSettingValue(settings, "automation_inactive_library_alert_enabled") ?? true));
  }, [settings]);

  useEffect(() => {
    setWhitelistText((securityQuery.data?.whitelist ?? []).join("\n"));
  }, [securityQuery.data?.whitelist]);

  const whitelistPreview = useMemo(
    () =>
      whitelistText
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    [whitelistText],
  );

  const runtimeGovernance = platformQuery.data?.runtimeGovernance;
  const releaseGovernance = platformQuery.data?.releaseGovernance;
  const runtimeVisibility = securityQuery.data?.runtimeVisibility;
  const operatorGovernance = securityQuery.data?.operatorGovernance;
  const governanceConsistency = operatorGovernance?.consistency;
  const governanceVisibility = operatorGovernance?.visibility;
  const activeElevations = operatorGovernance?.activeElevations ?? [];
  const governanceConflicts = operatorGovernance?.conflicts ?? [];
  const governanceAlerts = operatorGovernance?.alerts ?? [];
  const grants = operatorGovernance?.grants ?? [];
  const approvalRequests = operatorGovernance?.approvalRequests ?? [];
  const governanceDirectory = operatorGovernance?.directory;
  const governanceForensics = operatorGovernance?.forensics;
  const actorContext = platformQuery.data?.operator;
  const updateBoundaryField = <TKey extends keyof AdminOperatorScopeBoundary>(
    key: TKey,
    value: AdminOperatorScopeBoundary[TKey],
  ) =>
    setAssignmentForm((current) => ({
      ...current,
      boundary: {
        ...current.boundary,
        [key]: value,
      },
    }));

  const rolePreview = useMemo(() => {
    const inheritedRoles = expandInheritedOperatorRoles([assignmentForm.role]);
    return {
      inheritedRoles,
      permissions: expandOperatorPermissions([assignmentForm.role]),
    };
  }, [assignmentForm.role]);

  const filteredGrants = useMemo(
    () =>
      grants.filter((grant) =>
        matchesGovernanceSearch(governanceSearch, [
          grant.email,
          grant.userId,
          grant.role,
          grant.roleLabel,
          grant.scopeId,
          grant.scopeLabel,
          grant.status,
          grant.grantMode,
          grant.reason,
          grant.inheritedRoles.join(", "),
          grant.conflictWarnings.join(", "),
        ]),
      ),
    [governanceSearch, grants],
  );

  const filteredApprovalRequests = useMemo(
    () =>
      approvalRequests.filter((request) =>
        matchesGovernanceSearch(approvalSearch, [
          request.id,
          request.actionId,
          request.actionLabel,
          request.requesterEmail,
          request.targetDisplay,
          request.targetId,
          request.targetType,
          request.status,
          request.approvalChainMode,
          request.delegatedApprover,
          request.linkedIncidentKey,
          request.reason,
          request.stale ? "stale" : "fresh",
        ]),
      ),
    [approvalRequests, approvalSearch],
  );

  const openPlatformSettingsDialog = ({
    confirmButtonLabel,
    description,
    initialReason,
    settings: nextSettings,
    successTitle,
    title,
  }: {
    confirmButtonLabel: string;
    description: string;
    initialReason: string;
    settings: Record<string, unknown>;
    successTitle: string;
    title: string;
  }) => {
    const settingEntries = Object.entries(nextSettings);
    const sections: OperatorActionContextSection[] = [
      {
        items: settingEntries.map(([key, value]) => ({
          label: key,
          tone: value === false ? "warning" : "default",
          value: `${String(findSettingValue(platformQuery.data?.settings ?? [], key) ?? "n/a")} -> ${String(value)}`,
        })),
        title: "Requested changes",
      },
      {
        items: [
          {
            label: "Queue processing",
            tone: runtimeGovernance?.queueProcessingEnabled === false ? "critical" : "default",
            value: runtimeGovernance?.queueProcessingEnabled === false ? "Paused" : "Running",
          },
          {
            label: "Billing mutations",
            tone: runtimeGovernance?.billingMutationsEnabled === false ? "critical" : "default",
            value: runtimeGovernance?.billingMutationsEnabled === false ? "Stopped" : "Enabled",
          },
          {
            label: "Critical incidents",
            tone: (runtimeVisibility?.incidentSeverityCounts.critical ?? 0) > 0 ? "critical" : "default",
            value: String(runtimeVisibility?.incidentSeverityCounts.critical ?? 0),
          },
        ],
        title: "Runtime state",
      },
    ];

    setActionDialog({
      actionLabel: "Applying governance change",
      confirmButtonLabel,
      description,
      id: `${title}-${settingEntries.map(([key]) => key).join("-")}`,
      initialReason,
      requestPreview: async (reason) => {
        const response = await savePlatform.mutateAsync({
          dryRun: true,
          operatorReason: reason || initialReason,
          settings: nextSettings,
        });
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error("Impact preview unavailable for the governance change.");
        }

        return hydrateOperatorPreview(preview, {
          blastRadius: {
            affectedCount: settingEntries.length,
            scope: settingEntries.length > 2 ? "limited" : "single",
            summary: `${settingEntries.length} platform setting${settingEntries.length === 1 ? "" : "s"}`,
          },
          dependencyStatus: buildRuntimeDependencyStatus({
            runtimeGovernance,
            runtimeVisibility,
          }),
          playbooks: resolveOperatorPlaybooks({
            actionId: preview.actionId,
            preview,
            runtimeGovernance,
            runtimeVisibility,
          }),
          priorOperatorActions: buildPriorOperatorActions(
            securityQuery.data?.operatorTimeline,
            (entry) => entry.targetType === "platform_setting",
          ),
        });
      },
      sections,
      title,
      onConfirm: async ({ confirmationText, reason, token }) => {
        await savePlatform.mutateAsync({
          actionToken: token,
          confirmationText,
          operatorReason: reason || initialReason,
          settings: nextSettings,
        });
        toast({ title: successTitle });
      },
    });
  };

  const openRoleAssignmentDialog = () => {
    const targetEmail = assignmentForm.email.trim();
    const targetUserId = assignmentForm.userId.trim();
    const scopeId = assignmentForm.scopeId.trim();
    const scopeLabel = assignmentForm.scopeLabel.trim();
    const boundary = normalizeBoundaryInput(assignmentForm.boundary);
    const resolvedBoundary = {
      ...createEmptyBoundary(),
      ...(boundary ?? {}),
    };
    const expiresAt = toIsoOrNull(assignmentForm.expiresAt);
    const startsAt = toIsoOrNull(assignmentForm.startsAt);
    const shiftStartHourLocal = toIntegerOrNull(assignmentForm.shiftStartHourLocal);
    const shiftEndHourLocal = toIntegerOrNull(assignmentForm.shiftEndHourLocal);
    const fallbackChain = parseCommaSeparatedList(assignmentForm.fallbackChain);
    const regions = parseCommaSeparatedList(assignmentForm.regions);
    const reason = assignmentForm.reason.trim() || "Operator updating enterprise RBAC access.";
    const targetLabel = targetEmail || targetUserId || "operator";
    const sections: OperatorActionContextSection[] = [
      {
        items: [
          { label: "Principal", value: targetLabel },
          { label: "Role", value: getOperatorRoleLabel(assignmentForm.role) },
          { label: "Grant mode", value: buildGrantModeLabel(assignmentForm.grantMode) },
          { label: "Scope", value: scopeLabel || scopeId || assignmentForm.scopeType },
          { label: "Boundary", value: buildScopeBoundarySummary({ boundary: resolvedBoundary }) },
          { label: "Expiry", value: expiresAt ? formatDateTime(expiresAt) : "None" },
          { label: "Timezone", value: assignmentForm.timezone.trim() || "Not set" },
          { label: "Shift", value: assignmentForm.shiftLabel.trim() || "Not set" },
          { label: "Read-only lock", tone: assignmentForm.readOnlyMode ? "warning" : "default", value: assignmentForm.readOnlyMode ? "Enabled" : "Disabled" },
        ],
        title: "Requested grant",
      },
      {
        items: [
          { label: "Inherited roles", value: rolePreview.inheritedRoles.map(getOperatorRoleLabel).join(", ") },
          { label: "Permission count", value: String(rolePreview.permissions.length) },
          { label: "Permission preview", value: rolePreview.permissions.slice(0, 5).join(", ") || "No permissions" },
        ],
        title: "Role inheritance",
      },
    ];

    setActionDialog({
      actionLabel: "Granting operator access",
      confirmButtonLabel: "Grant role",
      description:
        "Role grants now run through governed previews so inherited permissions, scope boundaries, and temporary access windows are explicit before authority changes.",
      id: `assign-role-${assignmentForm.role}-${targetLabel}-${assignmentForm.scopeType}-${scopeId}`,
      initialReason: reason,
      requestPreview: async (previewReason) => {
        const response = await saveSecurity.mutateAsync({
          action: "assign_operator_role",
          dryRun: true,
          boundary,
          availabilityStatus: assignmentForm.availabilityStatus || null,
          backupOperator: assignmentForm.backupOperator.trim() || null,
          email: targetEmail || null,
          expiresAt,
          fallbackChain,
          grantMode: assignmentForm.grantMode,
          regions,
          readOnlyMode: assignmentForm.readOnlyMode,
          reason: previewReason || reason,
          role: assignmentForm.role,
          scopeId: scopeId || null,
          scopeLabel: scopeLabel || null,
          scopeType: assignmentForm.scopeType,
          shiftEndHourLocal,
          shiftLabel: assignmentForm.shiftLabel.trim() || null,
          shiftStartHourLocal,
          standby: assignmentForm.standby,
          startsAt,
          timezone: assignmentForm.timezone.trim() || null,
          userId: targetUserId || null,
          workloadCapacity: toIntegerOrNull(assignmentForm.workloadCapacity),
        });
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error("Impact preview unavailable for the operator role grant.");
        }

        return hydrateOperatorPreview(preview, {
          priorOperatorActions: buildPriorOperatorActions(
            securityQuery.data?.operatorTimeline,
            (entry) => entry.targetType === "operator_role_grant",
          ),
        });
      },
      sections,
      title: "Review operator role grant",
      onConfirm: async ({ confirmationText, reason: confirmedReason, token }) => {
        await saveSecurity.mutateAsync({
          action: "assign_operator_role",
          actionToken: token,
          availabilityStatus: assignmentForm.availabilityStatus || null,
          backupOperator: assignmentForm.backupOperator.trim() || null,
          boundary,
          confirmationText,
          email: targetEmail || null,
          expiresAt,
          fallbackChain,
          grantMode: assignmentForm.grantMode,
          regions,
          readOnlyMode: assignmentForm.readOnlyMode,
          reason: confirmedReason || reason,
          role: assignmentForm.role,
          scopeId: scopeId || null,
          scopeLabel: scopeLabel || null,
          scopeType: assignmentForm.scopeType,
          shiftEndHourLocal,
          shiftLabel: assignmentForm.shiftLabel.trim() || null,
          shiftStartHourLocal,
          standby: assignmentForm.standby,
          startsAt,
          timezone: assignmentForm.timezone.trim() || null,
          userId: targetUserId || null,
          workloadCapacity: toIntegerOrNull(assignmentForm.workloadCapacity),
        });
        toast({ title: "Operator role granted" });
      },
    });
  };

  const openGrantRevocationDialog = (grant: AdminOperatorRoleGrant) => {
    const sections: OperatorActionContextSection[] = [
      {
        items: [
          { label: "Principal", value: grant.email || grant.userId || "operator" },
          { label: "Role", value: grant.roleLabel },
          { label: "Scope", value: grant.scopeLabel || grant.scopeId || grant.scopeType },
          { label: "Grant mode", value: buildGrantModeLabel(grant.grantMode) },
          { label: "Status", value: grant.status },
        ],
        title: "Grant being revoked",
      },
      {
        items: [
          { label: "Inherited roles", value: grant.inheritedRoles.map(getOperatorRoleLabel).join(", ") || "None" },
          { label: "Permission count", value: String(grant.effectivePermissions.length) },
          { label: "Conflict warnings", tone: grant.conflictWarnings.length ? "warning" : "default", value: grant.conflictWarnings.join(" | ") || "None" },
        ],
        title: "Governance context",
      },
    ];

    setActionDialog({
      actionLabel: "Revoking operator access",
      confirmButtonLabel: "Revoke role",
      description:
        "Role revocation is previewed first so inherited permissions, temporary elevation impact, and recent governance activity remain visible before the grant is removed.",
      id: `revoke-role-${grant.grantId}`,
      initialReason: "Operator revoking access after governance review.",
      requestPreview: async (reason) => {
        const response = await saveSecurity.mutateAsync({
          action: "revoke_operator_role",
          dryRun: true,
          grantId: grant.grantId,
          reason: reason || "Operator revoking access after governance review.",
        });
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error("Impact preview unavailable for revoking the role grant.");
        }

        return hydrateOperatorPreview(preview, {
          priorOperatorActions: buildPriorOperatorActions(
            securityQuery.data?.operatorTimeline,
            (entry) => entry.targetType === "operator_role_grant",
          ),
        });
      },
      sections,
      title: "Review role revocation",
      onConfirm: async ({ confirmationText, reason, token }) => {
        await saveSecurity.mutateAsync({
          action: "revoke_operator_role",
          actionToken: token,
          confirmationText,
          grantId: grant.grantId,
          reason: reason || "Operator revoking access after governance review.",
        });
        toast({ title: "Operator role revoked" });
      },
    });
  };

  const openApprovalReviewDialog = (
    request: AdminOperatorApprovalRequest,
    decision: "approve_governance_request" | "reject_governance_request",
  ) => {
    const sections: OperatorActionContextSection[] = [
      {
        items: [
          { label: "Request", value: request.id },
          { label: "Action", value: request.actionLabel },
          { label: "Requester", value: request.requesterEmail || request.requesterUserId || "operator" },
          { label: "Target", value: request.targetDisplay || request.targetType },
          { label: "Status", value: request.status },
        ],
        title: "Approval request",
      },
      {
        items: [
          { label: "Approvals", value: `${request.approvals.length}/${request.requiredApprovals}` },
          { label: "Workflow", value: request.approvalChainMode || "single" },
          { label: "Expires", value: formatDateTime(request.expiresAt) },
          { label: "Cooldown", value: formatDateTime(request.cooldownUntil) },
          { label: "Escalation", tone: request.escalationRule ? "warning" : "default", value: request.escalationRule || "None" },
          { label: "Drift", tone: request.stale ? "critical" : "default", value: request.stale ? "Changed since submission" : "Current" },
        ],
        title: "Workflow state",
      },
    ];

    const confirmButtonLabel = decision === "approve_governance_request" ? "Approve request" : "Reject request";

    setActionDialog({
      actionLabel: decision === "approve_governance_request" ? "Approving governance request" : "Rejecting governance request",
      confirmButtonLabel,
      description:
        "Governance approval decisions are recorded on the operator timeline so reviewer lineage, escalation paths, and execution boundaries remain reconstructable.",
      id: `${decision}-${request.id}`,
      initialReason:
        decision === "approve_governance_request"
          ? "Operator approving the governed action after reviewing the blast radius and controls."
          : "Operator rejecting the governed action because the approval conditions were not met.",
      requestPreview: async (reason) => {
        const response = await saveSecurity.mutateAsync({
          action: decision,
          dryRun: true,
          note: reason,
          requestId: request.id,
        });
        const preview = extractOperatorActionPreview(response);
        if (!preview) {
          throw new Error("Impact preview unavailable for the governance review.");
        }

        return hydrateOperatorPreview(preview, {
          priorOperatorActions: buildPriorOperatorActions(
            securityQuery.data?.operatorTimeline,
            (entry) => entry.targetType === "governance_request",
          ),
        });
      },
      sections,
      title: decision === "approve_governance_request" ? "Review approval decision" : "Review rejection decision",
      onConfirm: async ({ confirmationText, reason, token }) => {
        await saveSecurity.mutateAsync({
          action: decision,
          actionToken: token,
          confirmationText,
          note: reason,
          requestId: request.id,
        });
        toast({
          title: decision === "approve_governance_request" ? "Governance request approved" : "Governance request rejected",
        });
      },
    });
  };

  const handleMaintenanceToggle = async () => {
    try {
      await savePlatform.mutateAsync({
        settings: { maintenance_mode: !maintenanceMode },
        operatorReason: maintenanceMode
          ? "Operator disabling maintenance mode."
          : "Operator enabling maintenance mode.",
      });
      toast({ title: maintenanceMode ? "Maintenance mode disabled" : "Maintenance mode enabled" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to update maintenance mode.",
        title: "Maintenance toggle failed",
        variant: "destructive",
      });
    }
  };

  const handleAutomationSave = () => {
    openPlatformSettingsDialog({
      confirmButtonLabel: "Apply governance change",
      description:
        "Queue, billing, and automation toggles are governed controls. Generate the preview before saving so blast radius and runtime warnings are explicit.",
      initialReason: "Operator updating runtime governance after control-plane review.",
      settings: {
        automation_inactive_library_alert_enabled: automationInactiveAlertEnabled,
        automation_payment_reminder_enabled: automationReminderEnabled,
        automation_subscription_renewal_enabled: automationRenewalEnabled,
        inactive_library_days: Number(inactiveLibraryDays),
        ops_billing_mutations_enabled: billingMutationsEnabled,
        ops_queue_processing_enabled: queueProcessingEnabled,
      },
      successTitle: "Platform runtime settings updated",
      title: "Review runtime governance update",
    });
  };

  const handleWhitelistSave = async () => {
    try {
      await saveSecurity.mutateAsync({
        action: "update_ip_whitelist",
        enabled: securityQuery.data?.ipWhitelistEnabled ?? false,
        whitelist: whitelistPreview,
      });
      toast({ title: "IP whitelist saved" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to save the IP whitelist.",
        title: "Save failed",
        variant: "destructive",
      });
    }
  };

  const handleWhitelistEnabledChange = async (enabled: boolean) => {
    try {
      await saveSecurity.mutateAsync({
        action: "update_ip_whitelist",
        enabled,
        whitelist: whitelistPreview,
      });
      toast({ title: "IP whitelist mode updated" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to update whitelist mode.",
        title: "Save failed",
        variant: "destructive",
      });
    }
  };

  const [activeSettingsTab, setActiveSettingsTab] = useState<"platform" | "automation" | "rbac" | "governance">("platform");

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          actions={(
            <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Auto-refresh</span>
              <Switch checked={autoRefreshEnabled} onCheckedChange={setAutoRefreshEnabled} />
            </div>
          )}
          description="Auditable runtime governance, enterprise RBAC, approval workflows, temporary elevation, and IP protections in one control-plane console."
          title="Settings"
        />

        {/* Tab Navigation */}
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {([
            { key: "platform", label: "Platform Controls" },
            { key: "automation", label: "Automation" },
            { key: "rbac", label: "RBAC & Access" },
            { key: "governance", label: "Governance" },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${activeSettingsTab === tab.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setActiveSettingsTab(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Platform Controls Tab */}
        {activeSettingsTab === "platform" && (<>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ControlPlaneCard title="Maintenance mode">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant={maintenanceMode ? "destructive" : "default"}>
                  {maintenanceMode ? "Enabled" : "Disabled"}
                </Badge>
                <Button disabled={savePlatform.isPending} onClick={handleMaintenanceToggle}>
                  {savePlatform.isPending
                    ? "Updating..."
                    : maintenanceMode
                      ? "Disable maintenance"
                      : "Enable maintenance"}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Instantly toggles maintenance mode. Normal users will see the maintenance page. Super admins always bypass.
              </p>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Governance runtime">
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Queue processing</p>
                  <p className="text-xs text-muted-foreground">Pause worker claims and due-job execution.</p>
                </div>
                <Switch checked={queueProcessingEnabled} onCheckedChange={setQueueProcessingEnabled} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Billing mutations</p>
                  <p className="text-xs text-muted-foreground">Emergency stop for invoice and refund mutations.</p>
                </div>
                <Switch checked={billingMutationsEnabled} onCheckedChange={setBillingMutationsEnabled} />
              </div>
              <Button disabled={savePlatform.isPending} onClick={handleAutomationSave}>
                Save runtime governance
              </Button>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Super-admin IP whitelist">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Whitelist enabled</p>
                  <p className="text-xs text-muted-foreground">
                    Restrict control-plane access to the configured IP addresses.
                  </p>
                </div>
                <Switch
                  checked={securityQuery.data?.ipWhitelistEnabled ?? false}
                  onCheckedChange={handleWhitelistEnabledChange}
                />
              </div>
              <Textarea
                onChange={(event) => setWhitelistText(event.target.value)}
                placeholder="One IP per line"
                rows={5}
                value={whitelistText}
              />
              <Button disabled={saveSecurity.isPending} onClick={handleWhitelistSave}>
                Save whitelist
              </Button>
            </div>
          </ControlPlaneCard>
        </div>
        </>)}

        {/* Automation Tab */}
        {activeSettingsTab === "automation" && (<>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.9fr]">
          <ControlPlaneCard title="Automation settings">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inactive-library-days">Inactive library threshold (days)</Label>
                <Input
                  id="inactive-library-days"
                  onChange={(event) => setInactiveLibraryDays(event.target.value)}
                  value={inactiveLibraryDays}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Subscription automation</p>
                  <p className="text-xs text-muted-foreground">Run platform renewal jobs through the shared job queue.</p>
                </div>
                <Switch checked={automationRenewalEnabled} onCheckedChange={setAutomationRenewalEnabled} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Payment reminders</p>
                  <p className="text-xs text-muted-foreground">Trigger automated payment reminder workflows.</p>
                </div>
                <Switch checked={automationReminderEnabled} onCheckedChange={setAutomationReminderEnabled} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Inactive library alerts</p>
                  <p className="text-xs text-muted-foreground">Auto-enqueue alerts for inactive libraries.</p>
                </div>
                <Switch checked={automationInactiveAlertEnabled} onCheckedChange={setAutomationInactiveAlertEnabled} />
              </div>
              <Button disabled={savePlatform.isPending} onClick={handleAutomationSave} variant="outline">
                Save automation settings
              </Button>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Current platform settings">
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={releaseGovernance?.health.status === "critical" ? "destructive" : releaseGovernance?.health.status === "warning" ? "secondary" : "outline"}>
                    Release health: {releaseGovernance?.health.status ?? "unknown"}
                  </Badge>
                  <Badge variant="outline">{releaseGovernance?.lineage.releaseId ?? "Untracked release"}</Badge>
                  <Badge variant="outline">{releaseGovernance?.lineage.phase ?? "rolling"}</Badge>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Schema readiness</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{releaseGovernance?.schema.readiness ?? "unknown"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pending migrations: {releaseGovernance?.schema.pendingMigrations.length ?? 0}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Rollback readiness</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">
                      {releaseGovernance?.rollback.ready ? "Ready" : "Blocked"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Target {releaseGovernance?.rollback.targetReleaseId ?? "not set"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Queue drain</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">
                      {releaseGovernance?.orchestration.queueDrainReady ? "Ready" : releaseGovernance?.orchestration.queueDrainRequired ? "Required" : "Not required"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Active workers {runtimeVisibility?.activeWorkers ?? 0} • Lag {runtimeVisibility?.queueLagMs ?? 0}ms
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Rollout posture</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">
                      {releaseGovernance?.rollouts.healthStatus ?? "unknown"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {releaseGovernance?.rollouts.stagedFlags ?? 0} staged flags • {releaseGovernance?.rollouts.pausedFlags ?? 0} paused
                    </p>
                  </div>
                </div>
                {(releaseGovernance?.warnings.length ?? 0) > 0 ? (
                  <div className="mt-3 space-y-2">
                    {(releaseGovernance?.warnings ?? []).slice(0, 4).map((warning) => (
                      <div key={warning} className="rounded-lg border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">{warning}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {settings.map((setting) => (
                <div key={setting.key} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{setting.key}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(setting.updatedAt)}</p>
                  </div>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                    {JSON.stringify(setting.value, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </ControlPlaneCard>
        </div>
        </>)}

        {/* RBAC & Access Tab */}
        {activeSettingsTab === "rbac" && (<>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.9fr]">
          <ControlPlaneCard title="Enterprise RBAC">
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Current operator context</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(actorContext?.roles ?? []).map((role) => (
                    <Badge key={role} variant="outline">{getOperatorRoleLabel(role)}</Badge>
                  ))}
                  {actorContext?.readOnlyActive ? <Badge variant="secondary">Read-only lock</Badge> : null}
                  {actorContext?.temporaryElevationActive ? <Badge variant="secondary">Temporary elevation</Badge> : null}
                  {actorContext?.emergencyAccessActive ? <Badge variant="destructive">Emergency access</Badge> : null}
                  {actorContext?.legacyFallbackAccess ? <Badge variant="destructive">Legacy fallback active</Badge> : null}
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Migration safety</p>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  <p>Legacy assignments: {operatorGovernance?.migration.legacyAssignmentCount ?? 0}</p>
                  <p>Role grants: {operatorGovernance?.migration.roleGrantCount ?? 0}</p>
                  <p>
                    Status:{" "}
                    {operatorGovernance?.migration.needsMigration
                      ? "Legacy assignments still need migration into durable role grants."
                      : operatorGovernance?.migration.fallbackAccessActive
                        ? "Bootstrap fallback is active because no grants or legacy assignments were found."
                        : "Grant-backed governance is active."}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Governance runtime</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Active elevations</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{governanceVisibility?.activeElevations ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Pending approvals</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{governanceVisibility?.pendingApprovals ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Conflicting actions</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{governanceVisibility?.conflictingActions ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Governance drift</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{governanceVisibility?.governanceDrift ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">After-hours escalations</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{governanceVisibility?.afterHoursEscalations ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Unresolved ownership</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">{governanceVisibility?.unresolvedOwnership ?? 0}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge
                    variant={
                      governanceVisibility?.roleAssignmentHealth === "critical"
                        ? "destructive"
                        : governanceVisibility?.roleAssignmentHealth === "warning"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    Role assignment health: {governanceVisibility?.roleAssignmentHealth ?? "healthy"}
                  </Badge>
                  <Badge variant={governanceVisibility?.policyPropagationHealth === "critical" ? "destructive" : governanceVisibility?.policyPropagationHealth === "warning" ? "secondary" : "outline"}>
                    Propagation: {governanceVisibility?.policyPropagationHealth ?? "healthy"}
                  </Badge>
                  <Badge variant="outline">Consistency {formatDateTime(governanceConsistency?.consistencyAt)}</Badge>
                  <Badge variant="outline">Version {governanceConsistency?.cacheInvalidationKey || "n/a"}</Badge>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Active elevations</p>
                {activeElevations.length ? (
                  <div className="mt-3 space-y-3">
                    {activeElevations.slice(0, 3).map((elevation) => (
                      <div key={elevation.grantId} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {elevation.principal} - {elevation.roleLabel}
                          </p>
                          <Badge variant={elevation.countdownSeconds != null && elevation.countdownSeconds < 900 ? "destructive" : "secondary"}>
                            {elevation.countdownLabel}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{elevation.scopeLabel}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{buildScopeBoundarySummary({ boundary: elevation.boundary })}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{elevation.historySummary.join(" | ")}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No temporary elevations are active right now.
                  </p>
                )}
              </div>

              {governanceAlerts.length || governanceConflicts.length ? (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Alerts and conflicts</p>
                  <div className="mt-3 space-y-3">
                    {governanceAlerts.slice(0, 2).map((alert) => (
                      <div key={alert.alertId} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{alert.summary}</p>
                          <Badge variant={alert.severity === "critical" ? "destructive" : "secondary"}>{alert.severity}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{alert.detail}</p>
                      </div>
                    ))}
                    {governanceConflicts.slice(0, 2).map((conflict) => (
                      <div key={conflict.conflictId} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-amber-900">{conflict.summary}</p>
                          <Badge variant={conflict.severity === "critical" ? "destructive" : "secondary"}>{conflict.severity}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-amber-900">{conflict.lineage.join(" | ")}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {governanceDirectory ? (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Governance directory</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Active operators</p>
                      <div className="mt-3 space-y-3">
                        {governanceDirectory.activeOperators.slice(0, 3).map((entry) => (
                          <div key={entry.principal} className="rounded-lg border border-border bg-background p-3">
                            <p className="text-sm font-medium text-foreground">{entry.principal}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{entry.roles.join(", ") || "No roles"}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {entry.availability?.timezone || "Timezone not set"} | {entry.availability?.shiftLabel || entry.availability?.status || "No shift"}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">{entry.boundarySummary.join(" | ") || "Global boundary"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Team ownership</p>
                      <div className="mt-3 space-y-3">
                        {governanceDirectory.teamOwnership.slice(0, 3).map((entry) => (
                          <div key={entry.key} className="rounded-lg border border-border bg-background p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground">{entry.label}</p>
                              <Badge variant="outline">{entry.kind.replaceAll("_", " ")}</Badge>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">{entry.principals.join(" | ") || "No owners"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Delegated roles</p>
                      <div className="mt-3 space-y-3">
                        {governanceDirectory.delegatedRoles.slice(0, 3).map((entry) => (
                          <div key={entry.id} className="rounded-lg border border-border bg-background p-3">
                            <p className="text-sm font-medium text-foreground">
                              {entry.delegatedBy || "Operator"} {"->"} {entry.delegatedTo || entry.fallbackApprover || "Fallback"}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">{entry.scopeSummary.join(" | ") || "Scope unavailable"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Escalation chains</p>
                      <div className="mt-3 space-y-3">
                        {governanceDirectory.escalationChains.slice(0, 3).map((entry) => (
                          <div key={entry.requestId} className="rounded-lg border border-border bg-background p-3">
                            <p className="text-sm font-medium text-foreground">{entry.steps[0] || "Escalation configured"}</p>
                            <p className="mt-2 text-xs text-muted-foreground">{entry.scopeSummary.join(" | ") || "Scope unavailable"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {governanceForensics?.records.length ? (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Governance forensics</p>
                  <div className="mt-3 space-y-3">
                    {governanceForensics.records.slice(0, 3).map((record, index) => (
                      <div key={`${record.category}-${record.requestId || index}`} className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{record.summary}</p>
                          <Badge variant="outline">{record.category.replaceAll("_", " ")}</Badge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">{record.scopeSummary.join(" | ") || "Scope unavailable"}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{record.trace.join(" | ") || "Trace unavailable"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Target email</Label>
                <Input
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="ops@libriofy.com"
                  value={assignmentForm.email}
                />
              </div>

              <div className="space-y-2">
                <Label>Target user ID</Label>
                <Input
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, userId: event.target.value }))}
                  placeholder="Optional explicit auth user ID"
                  value={assignmentForm.userId}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Role</Label>
                  <SettingsSelect
                    onChange={(value) => setAssignmentForm((current) => ({ ...current, role: value as AdminOperatorRole }))}
                    options={OPERATOR_ROLE_OPTIONS.map((role) => ({ label: getOperatorRoleLabel(role), value: role }))}
                    value={assignmentForm.role}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Grant mode</Label>
                  <SettingsSelect
                    onChange={(value) => setAssignmentForm((current) => ({ ...current, grantMode: value }))}
                    options={GRANT_MODE_OPTIONS}
                    value={assignmentForm.grantMode}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Scope type</Label>
                  <SettingsSelect
                    onChange={(value) => setAssignmentForm((current) => ({ ...current, scopeType: value }))}
                    options={SCOPE_TYPE_OPTIONS}
                    value={assignmentForm.scopeType}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Scope ID</Label>
                  <Input
                    onChange={(event) => setAssignmentForm((current) => ({ ...current, scopeId: event.target.value }))}
                    placeholder="Optional for global/platform grants"
                    value={assignmentForm.scopeId}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Scope label</Label>
                <Input
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, scopeLabel: event.target.value }))}
                  placeholder="Human-friendly scope label"
                  value={assignmentForm.scopeLabel}
                />
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Organizational boundary</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Bind the grant to a tenant, org, team, region, and governance domain so delegated authority stays isolated.
                </p>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tenant ID</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("tenantId", event.target.value || null)}
                      placeholder="tenant-acme"
                      value={assignmentForm.boundary.tenantId ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tenant label</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("tenantLabel", event.target.value || null)}
                      placeholder="Acme Tenant"
                      value={assignmentForm.boundary.tenantLabel ?? ""}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Organization ID</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("organizationId", event.target.value || null)}
                      placeholder="org-north-ops"
                      value={assignmentForm.boundary.organizationId ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Organization label</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("organizationLabel", event.target.value || null)}
                      placeholder="North Operations"
                      value={assignmentForm.boundary.organizationLabel ?? ""}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("departmentLabel", event.target.value || null)}
                      placeholder="Billing"
                      value={assignmentForm.boundary.departmentLabel ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Team</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("teamLabel", event.target.value || null)}
                      placeholder="Incident Response"
                      value={assignmentForm.boundary.teamLabel ?? ""}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Operational group</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("operationalGroupLabel", event.target.value || null)}
                      placeholder="Regional Operators"
                      value={assignmentForm.boundary.operationalGroupLabel ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Region</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("regionLabel", event.target.value || null)}
                      placeholder="APAC"
                      value={assignmentForm.boundary.regionLabel ?? ""}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Governance domain</Label>
                    <SettingsSelect
                      onChange={(value) => updateBoundaryField("governanceDomain", value ? (value as AdminOperatorGovernanceDomain) : null)}
                      options={[
                        { label: "Unscoped", value: "" },
                        ...GOVERNANCE_DOMAIN_OPTIONS,
                      ]}
                      value={assignmentForm.boundary.governanceDomain ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Delegated scope type</Label>
                    <SettingsSelect
                      onChange={(value) => updateBoundaryField("delegatedScopeType", value || null)}
                      options={[
                        { label: "None", value: "" },
                        { label: "Tenant", value: "tenant" },
                        { label: "Organization", value: "organization" },
                        { label: "Department", value: "department" },
                        { label: "Team", value: "team" },
                        { label: "Operational Group", value: "operational_group" },
                        { label: "Region", value: "region" },
                        { label: "Library", value: "library" },
                        { label: "Billing", value: "billing" },
                        { label: "Incident", value: "incident" },
                        { label: "Support", value: "support" },
                        { label: "Infrastructure", value: "infrastructure" },
                        { label: "Emergency", value: "emergency" },
                      ]}
                      value={assignmentForm.boundary.delegatedScopeType ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Delegated scope label</Label>
                    <Input
                      onChange={(event) => updateBoundaryField("delegatedScopeLabel", event.target.value || null)}
                      placeholder="Emergency library ownership"
                      value={assignmentForm.boundary.delegatedScopeLabel ?? ""}
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <Label>Visibility tags</Label>
                  <Input
                    onChange={(event) =>
                      updateBoundaryField(
                        "visibilityTags",
                        event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      )}
                    placeholder="tenant:acme, team:billing, region:apac"
                    value={assignmentForm.boundary.visibilityTags.join(", ")}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Starts at</Label>
                  <Input
                    onChange={(event) => setAssignmentForm((current) => ({ ...current, startsAt: event.target.value }))}
                    type="datetime-local"
                    value={assignmentForm.startsAt}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Expires at</Label>
                  <Input
                    onChange={(event) => setAssignmentForm((current) => ({ ...current, expiresAt: event.target.value }))}
                    type="datetime-local"
                    value={assignmentForm.expiresAt}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Follow-the-sun availability</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Capture timezone, shift windows, regional coverage, and fallback routing so enterprise escalation can rebalance safely.
                </p>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Availability status</Label>
                    <SettingsSelect
                      onChange={(value) => setAssignmentForm((current) => ({ ...current, availabilityStatus: value }))}
                      options={[
                        { label: "Active", value: "active" },
                        { label: "After hours", value: "after_hours" },
                        { label: "Away", value: "away" },
                        { label: "Backup", value: "backup" },
                        { label: "Offline", value: "offline" },
                        { label: "Standby", value: "standby" },
                      ]}
                      value={assignmentForm.availabilityStatus}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Input
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, timezone: event.target.value }))}
                      placeholder="Asia/Kolkata"
                      value={assignmentForm.timezone}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Shift label</Label>
                    <Input
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, shiftLabel: event.target.value }))}
                      placeholder="APAC primary"
                      value={assignmentForm.shiftLabel}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Shift start hour</Label>
                    <Input
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, shiftStartHourLocal: event.target.value }))}
                      placeholder="9"
                      value={assignmentForm.shiftStartHourLocal}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Shift end hour</Label>
                    <Input
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, shiftEndHourLocal: event.target.value }))}
                      placeholder="18"
                      value={assignmentForm.shiftEndHourLocal}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Regional coverage</Label>
                    <Input
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, regions: event.target.value }))}
                      placeholder="APAC, EMEA"
                      value={assignmentForm.regions}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Backup operator</Label>
                    <Input
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, backupOperator: event.target.value }))}
                      placeholder="backup@libriofy.com"
                      value={assignmentForm.backupOperator}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Fallback chain</Label>
                    <Input
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, fallbackChain: event.target.value }))}
                      placeholder="backup@libriofy.com, director@libriofy.com"
                      value={assignmentForm.fallbackChain}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Workload capacity</Label>
                    <Input
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, workloadCapacity: event.target.value }))}
                      placeholder="6"
                      value={assignmentForm.workloadCapacity}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Read-only lock</p>
                  <p className="text-xs text-muted-foreground">
                    Keep the grant visible but block write authority unless emergency override access exists.
                  </p>
                </div>
                <Switch
                  checked={assignmentForm.readOnlyMode}
                  onCheckedChange={(checked) => setAssignmentForm((current) => ({ ...current, readOnlyMode: checked }))}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Emergency standby</p>
                  <p className="text-xs text-muted-foreground">
                    Mark this operator as standby so after-hours escalation can route here before broader overrides.
                  </p>
                </div>
                <Switch
                  checked={assignmentForm.standby}
                  onCheckedChange={(checked) => setAssignmentForm((current) => ({ ...current, standby: checked }))}
                />
              </div>

              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Permission preview</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {rolePreview.inheritedRoles.map(getOperatorRoleLabel).join(", ")}
                </p>
                <p className="mt-2 text-sm text-foreground">
                  {rolePreview.permissions.join(", ") || "No permissions"}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Reason</Label>
                <Textarea
                  onChange={(event) => setAssignmentForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="Explain why this operator needs the role, scope, and timing."
                  rows={4}
                  value={assignmentForm.reason}
                />
              </div>

              <Button disabled={saveSecurity.isPending} onClick={openRoleAssignmentDialog}>
                Assign role
              </Button>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Role grants">
            <div className="space-y-4">
              <Input
                onChange={(event) => setGovernanceSearch(event.target.value)}
                placeholder="Search role, principal, scope, mode, status, or conflict warning"
                value={governanceSearch}
              />
              <div className="space-y-3">
                {filteredGrants.map((grant) => (
                  <div key={grant.grantId} className="rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{buildGrantSummary(grant)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {grant.reason || "No grant reason recorded."}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={grant.status === "active" ? "default" : grant.status === "revoked" ? "destructive" : "secondary"}>
                          {grant.status}
                        </Badge>
                        <Badge variant="outline">{buildGrantModeLabel(grant.grantMode)}</Badge>
                        {grant.restrictions.readOnlyMode ? <Badge variant="secondary">Read-only</Badge> : null}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Inherited</p>
                        <p className="mt-1 text-sm text-foreground">
                          {grant.inheritedRoles.map(getOperatorRoleLabel).join(", ") || "None"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Scope</p>
                        <p className="mt-1 text-sm text-foreground">{grant.scopeLabel || grant.scopeId || grant.scopeType}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{buildScopeBoundarySummary({ boundary: grant.boundary })}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Expires</p>
                        <p className="mt-1 text-sm text-foreground">{formatDateTime(grant.expiresAt)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Permissions</p>
                        <p className="mt-1 text-sm text-foreground">{grant.effectivePermissions.length}</p>
                      </div>
                    </div>
                    {grant.conflictWarnings.length ? (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        {grant.conflictWarnings.join(" ")}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={() => openGrantRevocationDialog(grant)} size="sm" variant="outline">
                        Revoke
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ControlPlaneCard>
        </div>
        </>)}

        {/* Governance Tab */}
        {activeSettingsTab === "governance" && (<>
        <ControlPlaneCard title="Approval workflows">
          <div className="space-y-4">
            <Input
              onChange={(event) => setApprovalSearch(event.target.value)}
              placeholder="Search request, action, requester, target, or status"
              value={approvalSearch}
            />
            <div className="space-y-3">
              {filteredApprovalRequests.map((request) => (
                <div key={request.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{request.actionLabel}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {request.requesterEmail || request.requesterUserId || "operator"} requested {request.targetDisplay || request.targetType}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={request.status === "approved" ? "default" : request.status === "rejected" ? "destructive" : "secondary"}>
                        {request.status}
                      </Badge>
                      <Badge variant="outline">{request.severity}</Badge>
                      {request.stale ? <Badge variant="destructive">Changed since submission</Badge> : null}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Approvals</p>
                      <p className="mt-1 text-sm text-foreground">{request.approvals.length}/{request.requiredApprovals}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Workflow</p>
                      <p className="mt-1 text-sm text-foreground">{request.approvalChainMode || "single"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{request.organizationScopeSummary.join(" | ") || "Global boundary"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Expires</p>
                      <p className="mt-1 text-sm text-foreground">{formatDateTime(request.expiresAt)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Cooldown</p>
                      <p className="mt-1 text-sm text-foreground">{formatDateTime(request.cooldownUntil)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Escalation</p>
                      <p className="mt-1 text-sm text-foreground">{request.escalationRule || "None"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Linked incident</p>
                      <p className="mt-1 text-sm text-foreground">{request.linkedIncidentKey || "None"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Delegated approver</p>
                      <p className="mt-1 text-sm text-foreground">{request.delegatedApprover || "None"}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{request.reason || request.previewSummary || "No approval note recorded."}</p>
                  {request.approvalStates?.length ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {request.approvalStates.map((state) => (
                        <div key={`${request.id}-stage-${state.step}`} className="rounded-lg border border-border bg-muted/20 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">{state.label}</p>
                            <Badge
                              variant={
                                state.state === "approved"
                                  ? "default"
                                  : state.state === "rejected" || state.state === "expired"
                                    ? "destructive"
                                    : "outline"
                              }
                            >
                              {state.state}
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {state.actorEmail || state.actorUserId || "Awaiting reviewer"} {state.at ? `- ${formatDateTime(state.at)}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      disabled={request.status !== "pending"}
                      onClick={() => openApprovalReviewDialog(request, "approve_governance_request")}
                      size="sm"
                    >
                      Approve
                    </Button>
                    <Button
                      disabled={request.status !== "pending"}
                      onClick={() => openApprovalReviewDialog(request, "reject_governance_request")}
                      size="sm"
                      variant="outline"
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ControlPlaneCard>
        </>)}
      </div>

      <OperatorActionDialog
        config={actionDialog}
        onOpenChange={(open) => {
          if (!open) {
            setActionDialog(null);
          }
        }}
      />
    </SuperAdminLayout>
  );
};

export default SuperAdminSettings;
