import { adminDownload, adminGet, adminPost } from "./fetch";
import type {
  AdminActivityLog,
  AdminAnalyticsCenterData,
  AdminBillingCreateInvoiceMutation,
  AdminBillingDeletePlanMutation,
  AdminBillingListResponse,
  AdminBillingPaymentRow,
  AdminBillingRefundMutation,
  AdminBillingScope,
  AdminBillingUpsertPlanMutation,
  AdminBroadcastCreateInput,
  AdminBroadcastDeleteTemplateInput,
  AdminBroadcastListResponse,
  AdminBroadcastOverviewResponse,
  AdminBroadcastRow,
  AdminBroadcastScope,
  AdminBroadcastTemplateInput,
  AdminDownloadsMutation,
  AdminFeatureFlag,
  AdminFeatureFlagsResponse,
  AdminFeatureFlagMutation,
  AdminIncidentGroup,
  AdminIncidentListResponse,
  AdminIncidentOverviewResponse,
  AdminIncidentScope,
  AdminIncidentSnapshot,
  AdminIncidentWorkflowMutation,
  AdminInvoiceRow,
  AdminJobQueueRow,
  AdminJobsListResponse,
  AdminJobsOverviewResponse,
  AdminJobWorkflowMutation,
  AdminLibrariesListResponse,
  AdminLibrariesWorkflowMutation,
  AdminListQuery,
  AdminRevenueAdjustmentMutation,
  AdminRevenueListResponse,
  AdminRevenueOverviewResponse,
  AdminRevenuePayoutActionInput,
  AdminRevenueScope,
  AdminRevenueCommissionUpdateInput,
  AdminSecurityAuditLog,
  AdminSecurityListResponse,
  AdminSecurityMutation,
  AdminSecurityOverviewResponse,
  AdminSecurityScope,
  AdminUserWorkflowMutation,
  AdminUsersListResponse,
  SuperAdminAutomationCenterData,
  SuperAdminBillingCenterData,
  SuperAdminCommunicationCenterData,
  SuperAdminControlCenterData,
  SuperAdminRevenueCenterData,
  AdminPlatformSettingsMutation,
  AdminPlatformSetting,
  AdminRefundRow,
} from "./types";

export const adminClient = {
  getAnalytics: (query?: { city?: string }) =>
    adminGet<AdminAnalyticsCenterData>("/api/admin/analytics", { query }),

  getAutomationJobs: (query?: AdminListQuery & { scope?: "overview" | "jobs" }) =>
    adminGet<AdminJobsOverviewResponse | AdminJobsListResponse>("/api/admin/jobs", { query }),

  getBilling: <TScope extends AdminBillingScope>(
    query?: AdminListQuery & { scope?: TScope },
  ) =>
    adminGet<
      TScope extends "refunds"
        ? AdminBillingListResponse<"refunds", AdminRefundRow>
        : TScope extends "payments"
          ? AdminBillingListResponse<"payments", AdminBillingPaymentRow>
          : AdminBillingListResponse<"invoices", AdminInvoiceRow>
    >("/api/admin/billing", { query }),

  getBroadcasts: <TScope extends AdminBroadcastScope>(
    query?: AdminListQuery & { scope?: TScope; channel?: string },
  ) =>
    adminGet<
      TScope extends "templates"
        ? AdminBroadcastListResponse<"templates", SuperAdminCommunicationCenterData["templates"][number]>
        : TScope extends "broadcasts"
          ? AdminBroadcastListResponse<"broadcasts", AdminBroadcastRow>
          : AdminBroadcastOverviewResponse
    >("/api/admin/broadcasts", { query }),

  getFeatureFlags: () =>
    adminGet<AdminFeatureFlagsResponse>("/api/admin/feature-flags"),

  getIncidents: <TScope extends AdminIncidentScope>(
    query?: AdminListQuery & { scope?: TScope },
  ) =>
    adminGet<
      TScope extends "snapshots"
        ? AdminIncidentListResponse<"snapshots", AdminIncidentSnapshot>
        : TScope extends "groups"
          ? AdminIncidentListResponse<"groups", AdminIncidentGroup>
          : AdminIncidentOverviewResponse
    >("/api/admin/incidents", { query }),

  getLibraries: (query?: AdminListQuery) =>
    adminGet<AdminLibrariesListResponse>("/api/admin/libraries", { query }),

  getPlatform: () =>
    adminGet<SuperAdminControlCenterData>("/api/admin/platform"),

  getRevenue: <TScope extends AdminRevenueScope>(
    query?: AdminListQuery & { scope?: TScope },
  ) =>
    adminGet<
      TScope extends "payouts"
        ? AdminRevenueListResponse<"payouts", SuperAdminRevenueCenterData["payouts"][number]>
        : TScope extends "adjustments"
          ? AdminRevenueListResponse<"adjustments", SuperAdminRevenueCenterData["adjustments"][number]>
          : TScope extends "payments"
            ? AdminRevenueListResponse<"payments", SuperAdminRevenueCenterData["paymentHistory"][number]>
            : TScope extends "commissions"
              ? AdminRevenueListResponse<"commissions", SuperAdminRevenueCenterData["commissionOverrides"][number]>
              : TScope extends "plans"
                ? AdminRevenueListResponse<"plans", SuperAdminRevenueCenterData["plans"][number]>
                : AdminRevenueOverviewResponse
    >("/api/admin/revenue", { query }),

  getSecurity: <TScope extends AdminSecurityScope>(
    query?: AdminListQuery & { scope?: TScope },
  ) =>
    adminGet<
      TScope extends "audit_logs"
        ? AdminSecurityListResponse<"audit_logs", AdminSecurityAuditLog>
        : TScope extends "access_logs"
          ? AdminSecurityListResponse<"access_logs", AdminActivityLog>
          : AdminSecurityOverviewResponse
    >("/api/admin/security", { query }),

  getUsers: (query?: AdminListQuery) =>
    adminGet<AdminUsersListResponse>("/api/admin/users", { query }),

  mutateAutomationJob: (body: AdminJobWorkflowMutation) =>
    adminPost<Record<string, unknown>, AdminJobWorkflowMutation>("/api/admin/jobs", body),

  mutateBillingCreateInvoice: (body: AdminBillingCreateInvoiceMutation) =>
    adminPost<Record<string, unknown>, AdminBillingCreateInvoiceMutation>("/api/admin/billing", body),

  mutateBillingDeletePlan: (body: AdminBillingDeletePlanMutation) =>
    adminPost<Record<string, unknown>, AdminBillingDeletePlanMutation>("/api/admin/billing", body),

  mutateBillingRefund: (body: AdminBillingRefundMutation) =>
    adminPost<Record<string, unknown>, AdminBillingRefundMutation>("/api/admin/billing", body),

  mutateBillingUpsertPlan: (body: AdminBillingUpsertPlanMutation) =>
    adminPost<Record<string, unknown>, AdminBillingUpsertPlanMutation>("/api/admin/billing", body),

  mutateBroadcastCreate: (body: AdminBroadcastCreateInput & { action: "create_broadcast" }) =>
    adminPost<Record<string, unknown>, AdminBroadcastCreateInput & { action: "create_broadcast" }>("/api/admin/broadcasts", body),

  mutateBroadcastDeleteTemplate: (body: AdminBroadcastDeleteTemplateInput) =>
    adminPost<Record<string, unknown>, AdminBroadcastDeleteTemplateInput>("/api/admin/broadcasts", body),

  mutateBroadcastTemplate: (body: AdminBroadcastTemplateInput & { action: "upsert_template" }) =>
    adminPost<Record<string, unknown>, AdminBroadcastTemplateInput & { action: "upsert_template" }>("/api/admin/broadcasts", body),

  mutateFeatureFlag: (body: AdminFeatureFlagMutation) =>
    adminPost<{ featureFlag: AdminFeatureFlag }, AdminFeatureFlagMutation>("/api/admin/feature-flags", body),

  mutateIncident: (body: AdminIncidentWorkflowMutation) =>
    adminPost<Record<string, unknown>, AdminIncidentWorkflowMutation>("/api/admin/incidents", body),

  mutateLibrary: (body: AdminLibrariesWorkflowMutation) =>
    adminPost<Record<string, unknown>, AdminLibrariesWorkflowMutation>("/api/admin/libraries", body),

  mutatePlatformSettings: (body: AdminPlatformSettingsMutation) =>
    adminPost<{ settings: AdminPlatformSetting[] }, AdminPlatformSettingsMutation>("/api/admin/platform", body),

  mutateRevenueAdjustment: (body: AdminRevenueAdjustmentMutation) =>
    adminPost<Record<string, unknown>, AdminRevenueAdjustmentMutation>("/api/admin/revenue", body),

  mutateRevenueCommission: (body: AdminRevenueCommissionUpdateInput) =>
    adminPost<Record<string, unknown>, AdminRevenueCommissionUpdateInput>("/api/admin/revenue", body),

  mutateRevenuePayoutAction: (body: AdminRevenuePayoutActionInput) =>
    adminPost<Record<string, unknown>, AdminRevenuePayoutActionInput>("/api/admin/revenue", body),

  mutateSecurity: (body: AdminSecurityMutation) =>
    adminPost<{ settings: AdminPlatformSetting[] }, AdminSecurityMutation>("/api/admin/security", body),

  mutateUser: (body: AdminUserWorkflowMutation) =>
    adminPost<Record<string, unknown>, AdminUserWorkflowMutation>("/api/admin/users", body),

  downloadBillingReport: (query: AdminDownloadsMutation) =>
    adminDownload("/api/admin/billing", query),
};
