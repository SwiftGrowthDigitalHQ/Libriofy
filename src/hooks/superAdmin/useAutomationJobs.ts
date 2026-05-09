import type { AdminListQuery, AdminJobsScope } from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
import { useAdminMutation } from "./useAdminMutation";
import { useAdminQuery } from "./useAdminQuery";

type UseAutomationJobsOptions<TScope extends AdminJobsScope> = {
  enabled?: boolean;
  query?: AdminListQuery & { scope?: TScope };
  refetchIntervalMs?: number | false;
};

export const useAutomationJobs = <TScope extends AdminJobsScope = "overview">({
  enabled = true,
  query,
  refetchIntervalMs = false,
}: UseAutomationJobsOptions<TScope> = {}) =>
  useAdminQuery({
    enabled,
    queryFn: () => adminClient.getAutomationJobs(query),
    queryKey: ["admin-jobs", query?.scope ?? "overview", query ?? {}],
    refetchInterval: refetchIntervalMs,
    staleTime: 15_000,
  });

export const useAutomationJobMutation = () =>
  useAdminMutation({
    invalidateQueryKeys: [["admin-jobs"], ["admin-analytics"], ["admin-platform"]],
    mutationFn: adminClient.mutateAutomationJob,
  });
