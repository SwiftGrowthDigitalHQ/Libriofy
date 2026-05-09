import type { AdminBillingScope, AdminDownloadsMutation, AdminListQuery } from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
import { useAdminMutation } from "./useAdminMutation";
import { useAdminQuery } from "./useAdminQuery";

type UseBillingOptions<TScope extends AdminBillingScope> = {
  enabled?: boolean;
  query?: AdminListQuery & { scope?: TScope };
  refetchIntervalMs?: number | false;
};

export const useBilling = <TScope extends AdminBillingScope = "invoices">({
  enabled = true,
  query,
  refetchIntervalMs = false,
}: UseBillingOptions<TScope> = {}) =>
  useAdminQuery({
    enabled,
    queryFn: () => adminClient.getBilling<TScope>(query),
    queryKey: ["admin-billing", query?.scope ?? "invoices", query ?? {}],
    refetchInterval: refetchIntervalMs,
    staleTime: 20_000,
  });

export const useBillingMutations = () => ({
  createInvoice: useAdminMutation({
    invalidateQueryKeys: [["admin-billing"]],
    mutationFn: adminClient.mutateBillingCreateInvoice,
  }),
  deletePlan: useAdminMutation({
    invalidateQueryKeys: [["admin-billing"], ["admin-revenue"]],
    mutationFn: adminClient.mutateBillingDeletePlan,
  }),
  processRefund: useAdminMutation({
    invalidateQueryKeys: [["admin-billing"], ["admin-revenue"]],
    mutationFn: adminClient.mutateBillingRefund,
  }),
  upsertPlan: useAdminMutation({
    invalidateQueryKeys: [["admin-billing"], ["admin-revenue"]],
    mutationFn: adminClient.mutateBillingUpsertPlan,
  }),
});

export const useBillingDownload = () =>
  useAdminMutation({
    mutationFn: (query: AdminDownloadsMutation) => adminClient.downloadBillingReport(query),
  });
