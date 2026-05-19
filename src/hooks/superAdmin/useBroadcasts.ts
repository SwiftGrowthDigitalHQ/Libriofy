import type { AdminBroadcastScope, AdminListQuery } from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
import { SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS } from "@/lib/superAdmin/lightweightMode";
import { useAdminMutation } from "./useAdminMutation";
import { useAdminQuery } from "./useAdminQuery";

type UseBroadcastsOptions<TScope extends AdminBroadcastScope> = {
  enabled?: boolean;
  query?: AdminListQuery & { channel?: string; scope?: TScope };
  refetchIntervalMs?: number | false;
};

export const useBroadcasts = <TScope extends AdminBroadcastScope = "overview">({
  enabled = true,
  query,
  refetchIntervalMs = false,
}: UseBroadcastsOptions<TScope> = {}) =>
  useAdminQuery({
    enabled,
    queryFn: () => adminClient.getBroadcasts<TScope>(query),
    queryKey: ["admin-broadcasts", query?.scope ?? "overview", query ?? {}],
    refetchInterval: refetchIntervalMs,
    staleTime: SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS,
  });

export const useBroadcastMutations = () => ({
  createBroadcast: useAdminMutation({
    invalidateQueryKeys: [["admin-broadcasts"], ["admin-analytics"]],
    mutationFn: (body: Parameters<typeof adminClient.mutateBroadcastCreate>[0]) =>
      adminClient.mutateBroadcastCreate(body),
  }),
  deleteTemplate: useAdminMutation({
    invalidateQueryKeys: [["admin-broadcasts"]],
    mutationFn: adminClient.mutateBroadcastDeleteTemplate,
  }),
  saveTemplate: useAdminMutation({
    invalidateQueryKeys: [["admin-broadcasts"]],
    mutationFn: (body: Parameters<typeof adminClient.mutateBroadcastTemplate>[0]) =>
      adminClient.mutateBroadcastTemplate(body),
  }),
});
