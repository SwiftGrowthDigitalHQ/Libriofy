import type { AdminListQuery, AdminSecurityScope } from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
import { useAdminMutation } from "./useAdminMutation";
import { useAdminQuery } from "./useAdminQuery";

type UseSecurityOptions<TScope extends AdminSecurityScope> = {
  enabled?: boolean;
  query?: AdminListQuery & { scope?: TScope };
  refetchIntervalMs?: number | false;
};

export const useSecurity = <TScope extends AdminSecurityScope = "overview">({
  enabled = true,
  query,
  refetchIntervalMs = false,
}: UseSecurityOptions<TScope> = {}) =>
  useAdminQuery({
    enabled,
    queryFn: () => adminClient.getSecurity<TScope>(query),
    queryKey: ["admin-security", query?.scope ?? "overview", query ?? {}],
    refetchInterval: refetchIntervalMs,
    staleTime: 20_000,
  });

export const useSecurityMutation = () =>
  useAdminMutation({
    invalidateQueryKeys: [["admin-security"], ["admin-platform"], ["admin-analytics"]],
    mutationFn: adminClient.mutateSecurity,
  });
