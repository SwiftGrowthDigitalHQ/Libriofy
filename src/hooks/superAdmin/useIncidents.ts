import type { AdminIncidentScope, AdminListQuery } from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
import { useAdminMutation } from "./useAdminMutation";
import { useAdminQuery } from "./useAdminQuery";

type UseIncidentsOptions<TScope extends AdminIncidentScope> = {
  enabled?: boolean;
  query?: AdminListQuery & { scope?: TScope };
  refetchIntervalMs?: number | false;
};

export const useIncidents = <TScope extends AdminIncidentScope = "overview">({
  enabled = true,
  query,
  refetchIntervalMs = false,
}: UseIncidentsOptions<TScope> = {}) =>
  useAdminQuery({
    enabled,
    queryFn: () => adminClient.getIncidents<TScope>(query),
    queryKey: ["admin-incidents", query?.scope ?? "overview", query ?? {}],
    refetchInterval: refetchIntervalMs,
    staleTime: 15_000,
  });

export const useResolveIncident = () =>
  useAdminMutation({
    invalidateQueryKeys: [["admin-incidents"], ["admin-analytics"], ["admin-platform"], ["admin-security"]],
    mutationFn: adminClient.mutateIncident,
  });
