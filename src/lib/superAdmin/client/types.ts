import type {
  AdminActivityLog,
  AdminOperatorActionId,
  AdminOperatorActionPreview,
  AdminOperatorApprovalRequest,
  AdminBillingPaymentRow,
  AdminBroadcastInput,
  AdminBroadcastRow,
  AdminLibraryCenterSummary,
  AdminFeatureFlag,
  AdminFeatureFlagInput,
  AdminIncidentGroup,
  AdminIncidentResolutionInput,
  AdminInvoiceInput,
  AdminInvoiceRow,
  AdminJobActionInput,
  AdminDeadLetterRow,
  AdminJobQueueRow,
  AdminLibraryActionInput,
  AdminLibraryControlRow,
  AdminOperatorContext,
  AdminOperatorGovernanceSnapshot,
  AdminOperationalIntelligenceSnapshot,
  AdminOperatorPermission,
  AdminOperatorRole,
  AdminOperatorRoleGrant,
  AdminOperatorScopeType,
  AdminOperatorTimelineEntry,
  AdminPlanUpsertInput,
  AdminPlatformSetting,
  AdminRefundInput,
  AdminRefundRow,
  AdminRuntimeTraceEvent,
  AdminRuntimeVisibility,
  AdminRevenueAdjustmentInput,
  AdminUserActionInput,
  AdminUserControlRow,
  SuperAdminAutomationCenterData,
  SuperAdminBillingCenterData,
  SuperAdminCommunicationCenterData,
  SuperAdminControlCenterData,
  SuperAdminIncidentCenterData,
  SuperAdminLibraryCenterData,
  SuperAdminRevenueCenterData,
  SuperAdminSecurityCenterData,
} from "@/lib/superAdmin/types";
import type {
  AdminOperatorAvailabilityStatus,
  AdminOperatorScopeBoundary,
} from "@/lib/superAdmin/governance";

export type AdminApiPath =
  | "/api/admin/platform"
  | "/api/admin/feature-flags"
  | "/api/admin/libraries"
  | "/api/admin/users"
  | "/api/admin/revenue"
  | "/api/admin/broadcasts"
  | "/api/admin/security"
  | "/api/admin/incidents"
  | "/api/admin/analytics"
  | "/api/admin/billing"
  | "/api/admin/jobs";

export type AdminApiSuccess<T> = {
  data: T;
  message: string;
  requestId: string;
  success: true;
};

export type AdminApiFailure = {
  details?: Record<string, string[]>;
  errorCode: string;
  message: string;
  requestId: string;
  success: false;
};

export type AdminApiResponse<T> = AdminApiSuccess<T> | AdminApiFailure;

export type AdminPagination = {
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
};

export type AdminPaginatedItems<T> = {
  items: T[];
  pagination: AdminPagination;
};

export type AdminListQuery = {
  channel?: string;
  city?: string;
  format?: "json" | "csv" | "pdf";
  invoiceId?: string;
  page?: number;
  pageSize?: number;
  scope?: string;
  search?: string;
  severity?: string;
  status?: string;
};

export type AdminSecurityAuditLog = {
  action: string;
  actorEmail: string | null;
  createdAt: string;
  id: string;
  ipAddress: string | null;
  metadata?: Record<string, unknown>;
  targetDisplay: string | null;
  targetType: string;
};

export type AdminAnalyticsCenterData = {
  automation: SuperAdminControlCenterData["automation"];
  billing: {
    gstRatePercent: number;
    invoices: number;
    refunds: number;
  };
  cityMetrics: SuperAdminControlCenterData["analytics"]["revenueByCity"];
  communication: SuperAdminCommunicationCenterData["deliveryHealth"];
  generatedAt: string;
  healthCenter: SuperAdminControlCenterData["statusSignals"];
  governanceAnalytics?: AdminOperatorGovernanceSnapshot["analytics"];
  incidents: {
    critical: number;
    unresolved: number;
  };
  incidentCoordination?: SuperAdminIncidentCenterData["analytics"];
  operationalIntelligence?: AdminOperationalIntelligenceSnapshot;
  runtimeVisibility: AdminRuntimeVisibility;
  overview: SuperAdminControlCenterData["analytics"];
  security: SuperAdminControlCenterData["security"];
  systemStatus: SuperAdminControlCenterData["systemStatus"];
  governance: SuperAdminControlCenterData["runtimeGovernance"];
};

export type AdminLibrariesListResponse = {
  generatedAt: string;
  libraries: AdminPaginatedItems<AdminLibraryControlRow>;
  recentActivity: AdminActivityLog[];
  summary: AdminLibraryCenterSummary;
};

export type AdminUsersListResponse = {
  generatedAt: string;
  summary: AdminLibraryCenterSummary;
  users: AdminPaginatedItems<AdminUserControlRow>;
};

export type AdminRevenueScope =
  | "overview"
  | "payouts"
  | "adjustments"
  | "payments"
  | "commissions"
  | "plans";

export type AdminRevenueOverviewResponse = {
  data: SuperAdminRevenueCenterData;
  scope: "overview";
};

export type AdminRevenueListResponse<TScope extends Exclude<AdminRevenueScope, "overview">, TItem> = {
  defaultCommissionPercent: number;
  generatedAt: string;
  items: AdminPaginatedItems<TItem>;
  scope: TScope;
  summary: SuperAdminRevenueCenterData["summary"];
};

export type AdminBroadcastScope = "overview" | "templates" | "broadcasts";

export type AdminBroadcastOverviewResponse = {
  data: SuperAdminCommunicationCenterData;
  scope: "overview";
};

export type AdminBroadcastListResponse<
  TScope extends Exclude<AdminBroadcastScope, "overview">,
  TItem,
> = {
  deliveryHealth: SuperAdminCommunicationCenterData["deliveryHealth"];
  generatedAt: string;
  items: AdminPaginatedItems<TItem>;
  scope: TScope;
};

export type AdminIncidentScope = "overview" | "groups" | "snapshots";

export type AdminIncidentSnapshot = SuperAdminIncidentCenterData["snapshots"][number];

export type AdminIncidentOverviewResponse = {
  data: SuperAdminIncidentCenterData;
  scope: "overview";
};

export type AdminIncidentListResponse<
  TScope extends Exclude<AdminIncidentScope, "overview">,
  TItem,
> = {
  generatedAt: string;
  items: AdminPaginatedItems<TItem>;
  scope: TScope;
  summary: SuperAdminIncidentCenterData["summary"];
};

export type AdminSecurityScope = "overview" | "audit_logs" | "access_logs";

export type AdminSecurityOverviewResponse = {
  activeSessions: number;
  alerts: AdminRuntimeTraceEvent[];
  auditLogs: AdminSecurityAuditLog[];
  blockedIps: number;
  cacheMetrics: {
    hits: number;
    invalidations: number;
    misses: number;
    writes: number;
  };
  failedLogins: number;
  generatedAt: string;
  ipWhitelistEnabled: boolean;
  operatorActions: AdminRuntimeTraceEvent[];
  operatorGovernance?: AdminOperatorGovernanceSnapshot;
  operatorTimeline?: AdminOperatorTimelineEntry[];
  otpFailures: number;
  recentAccessLogs: AdminActivityLog[];
  runtimeVisibility: AdminRuntimeVisibility;
  slowRequests: AdminRuntimeTraceEvent[];
  suspiciousIps: SuperAdminSecurityCenterData["suspiciousIps"];
  traceFeed: AdminRuntimeTraceEvent[];
  whitelist: string[];
};

export type AdminSecurityListResponse<TScope extends Exclude<AdminSecurityScope, "overview">, TItem> = {
  activeSessions: number;
  generatedAt: string;
  ipWhitelistEnabled: boolean;
  items: AdminPaginatedItems<TItem>;
  scope: TScope;
  suspiciousIps: SuperAdminSecurityCenterData["suspiciousIps"];
  whitelist: string[];
};

export type AdminBillingScope = "invoices" | "refunds" | "payments";

export type AdminBillingListResponse<TScope extends AdminBillingScope, TItem> = {
  generatedAt: string;
  gstRatePercent: number;
  items: AdminPaginatedItems<TItem>;
  operations: SuperAdminBillingCenterData["operations"];
  scope: TScope;
};

export type AdminJobsScope = "overview" | "jobs";

export type AdminJobsOverviewResponse = {
  data: SuperAdminAutomationCenterData;
  scope: "overview";
};

export type AdminJobsListResponse = {
  deadLetters: AdminDeadLetterRow[];
  generatedAt: string;
  items: AdminPaginatedItems<AdminJobQueueRow>;
  scope: "jobs";
  settings: SuperAdminAutomationCenterData["settings"];
  summary: SuperAdminAutomationCenterData["summary"];
};

export type AdminFeatureFlagsResponse = {
  featureFlags: AdminFeatureFlag[];
  settings: AdminPlatformSetting[];
};

export type AdminFeatureFlagMutation = AdminFeatureFlagInput;
export type AdminPlatformSettingsMutation = {
  settings: Record<string, unknown>;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
  operatorReason?: string | null;
};
export type AdminSecurityMutation =
  | {
      action: "update_ip_whitelist";
      enabled: boolean;
      whitelist: string[];
    }
  | {
      action: "assign_operator_role";
      actionToken?: string | null;
      confirmationText?: string | null;
      deniedActions?: AdminOperatorActionId[];
      deniedPermissions?: AdminOperatorPermission[];
      dryRun?: boolean;
      email?: string | null;
      expiresAt?: string | null;
      fallbackChain?: string[];
      grantMode?: AdminOperatorRoleGrant["grantMode"];
      regions?: string[];
      readOnlyMode?: boolean;
      reason: string;
      role: AdminOperatorRole;
      backupOperator?: string | null;
      boundary?: Partial<AdminOperatorScopeBoundary> | null;
      scopeId?: string | null;
      scopeLabel?: string | null;
      scopeType?: AdminOperatorScopeType;
      shiftEndHourLocal?: number | null;
      shiftLabel?: string | null;
      shiftStartHourLocal?: number | null;
      standby?: boolean;
      startsAt?: string | null;
      timezone?: string | null;
      userId?: string | null;
      availabilityStatus?: AdminOperatorAvailabilityStatus | null;
      workloadCapacity?: number | null;
    }
  | {
      action: "revoke_operator_role";
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
      grantId: string;
      reason?: string | null;
    }
  | {
      action: "approve_governance_request" | "reject_governance_request";
      actionToken?: string | null;
      confirmationText?: string | null;
      dryRun?: boolean;
      note?: string | null;
      requestId: string;
    };

export type AdminBroadcastTemplateInput = {
  body: string;
  channel: "email" | "in_app" | "whatsapp" | "telegram";
  id?: string;
  isActive?: boolean;
  key: string;
  name: string;
  subject?: string | null;
  variables?: string[];
};

export type AdminBroadcastDeleteTemplateInput = {
  action: "delete_template";
  templateId: string;
};

export type AdminBroadcastCreateInput = AdminBroadcastInput;

export type AdminRevenueCommissionUpdateInput = {
  action: "commission_update";
  commissionPercent?: number;
  defaultCommissionPercent?: number;
  libraryId?: string;
  notes?: string;
};

export type AdminRevenuePayoutActionInput = {
  action: "payout_action";
  libraryId: string;
  note?: string;
  payoutAction: "approve_payout" | "reject_payout" | "mark_payout_paid";
  payoutId: string;
  actionToken?: string | null;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminRevenueAdjustmentMutation = AdminRevenueAdjustmentInput & {
  action: "revenue_adjustment";
};

export type AdminBillingCreateInvoiceMutation = AdminInvoiceInput & {
  action: "create_invoice";
};

export type AdminBillingRefundMutation = AdminRefundInput & {
  action: "process_refund";
};

export type AdminBillingUpsertPlanMutation = AdminPlanUpsertInput & {
  action: "upsert_plan";
};

export type AdminBillingDeletePlanMutation = {
  action: "delete_plan";
  planId: string;
};

export type AdminLibrariesImpersonationMutation = {
  action: "impersonate_admin";
  libraryId?: string | null;
  reason?: string | null;
  targetUserId: string;
  confirmationText?: string | null;
  dryRun?: boolean;
};

export type AdminLibrariesWorkflowMutation =
  | AdminLibraryActionInput
  | AdminLibrariesImpersonationMutation
  | {
      action: "force_logout_all" | "reset_account";
      libraryId: string;
      note?: string;
    };

export type AdminUserWorkflowMutation = AdminUserActionInput;
export type AdminIncidentWorkflowMutation = AdminIncidentResolutionInput;
export type AdminJobWorkflowMutation = AdminJobActionInput;

export type AdminDownloadsMutation = {
  format: "csv" | "pdf";
  invoiceId?: string;
  scope?: string;
  search?: string;
  status?: string;
};

export type AdminControlPlanePage =
  | "dashboard"
  | "libraries"
  | "revenue"
  | "billing"
  | "incidents"
  | "analytics"
  | "settings"
  | "broadcasts"
  | "automation"
  | "feature-flags"
  | "observability";

export type AdminControlPlaneData =
  | SuperAdminControlCenterData
  | SuperAdminLibraryCenterData
  | SuperAdminRevenueCenterData
  | SuperAdminBillingCenterData
  | SuperAdminIncidentCenterData
  | SuperAdminAutomationCenterData
  | SuperAdminSecurityCenterData
  | AdminAnalyticsCenterData
  | AdminFeatureFlagsResponse;

export type {
  AdminActivityLog,
  AdminOperatorActionId,
  AdminOperatorActionPreview,
  AdminOperatorApprovalRequest,
  AdminBillingPaymentRow,
  AdminBroadcastInput,
  AdminBroadcastRow,
  AdminFeatureFlag,
  AdminFeatureFlagInput,
  AdminIncidentGroup,
  AdminIncidentResolutionInput,
  AdminInvoiceInput,
  AdminInvoiceRow,
  AdminJobActionInput,
  AdminJobQueueRow,
  AdminLibraryActionInput,
  AdminLibraryControlRow,
  AdminOperatorContext,
  AdminOperatorGovernanceSnapshot,
  AdminOperatorPermission,
  AdminOperatorRole,
  AdminOperatorRoleGrant,
  AdminOperatorScopeType,
  AdminOperatorTimelineEntry,
  AdminPlanUpsertInput,
  AdminPlatformSetting,
  AdminRefundInput,
  AdminRefundRow,
  AdminRevenueAdjustmentInput,
  AdminUserActionInput,
  AdminUserControlRow,
  SuperAdminAutomationCenterData,
  SuperAdminBillingCenterData,
  SuperAdminCommunicationCenterData,
  SuperAdminControlCenterData,
  SuperAdminIncidentCenterData,
  SuperAdminLibraryCenterData,
  SuperAdminRevenueCenterData,
  SuperAdminSecurityCenterData,
};
