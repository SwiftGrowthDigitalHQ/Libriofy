import type { AdminListQuery, AdminRevenueScope } from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
import { SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS } from "@/lib/superAdmin/lightweightMode";
import { useAdminMutation } from "./useAdminMutation";
import { useAdminQuery } from "./useAdminQuery";

type UseRevenueOptions<TScope extends AdminRevenueScope> = {
  enabled?: boolean;
  query?: AdminListQuery & { scope?: TScope };
};

export const useRevenue = <TScope extends AdminRevenueScope = "overview">({
  enabled = true,
  query,
}: UseRevenueOptions<TScope> = {}) =>
  useAdminQuery({
    enabled,
    queryFn: () => adminClient.getRevenue<TScope>(query),
    queryKey: ["admin-revenue", query?.scope ?? "overview", query ?? {}],
    staleTime: SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS,
  });

export const useRevenueMutations = () => ({
  approveOrRejectPayout: useAdminMutation({
    invalidateQueryKeys: [["admin-revenue"], ["admin-billing"]],
    mutationFn: adminClient.mutateRevenuePayoutAction,
  }),
  saveCommission: useAdminMutation({
    invalidateQueryKeys: [["admin-revenue"], ["admin-platform"]],
    mutationFn: adminClient.mutateRevenueCommission,
  }),
  saveRevenueAdjustment: useAdminMutation({
    invalidateQueryKeys: [["admin-revenue"], ["admin-billing"], ["admin-platform"]],
    mutationFn: adminClient.mutateRevenueAdjustment,
  }),
});
