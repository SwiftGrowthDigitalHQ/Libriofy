import type { AdminFeatureFlagsResponse, AdminFeatureFlagMutation } from "@/lib/superAdmin/client";
import { adminClient } from "@/lib/superAdmin/client";
import { useAdminMutation } from "./useAdminMutation";
import { useAdminQuery } from "./useAdminQuery";

export const useFeatureFlags = () => {
  const flagsQuery = useAdminQuery({
    queryFn: () => adminClient.getFeatureFlags(),
    queryKey: ["admin-feature-flags"],
    staleTime: 20_000,
  });

  const saveFlag = useAdminMutation<
    { featureFlag: AdminFeatureFlagsResponse["featureFlags"][number] },
    AdminFeatureFlagMutation,
    AdminFeatureFlagsResponse
  >({
    invalidateQueryKeys: [["admin-feature-flags"], ["admin-platform"]],
    mutationFn: adminClient.mutateFeatureFlag,
    optimistic: {
      filters: { queryKey: ["admin-feature-flags"] },
      updater: (current, variables) => ({
        ...current,
        featureFlags: current.featureFlags.map((flag) =>
          flag.key === (variables as AdminFeatureFlagMutation).key
            ? {
                ...flag,
                config: (variables as AdminFeatureFlagMutation).config ?? flag.config,
                enabled: (variables as AdminFeatureFlagMutation).enabled ?? flag.enabled,
                rolloutPercentage:
                  (variables as AdminFeatureFlagMutation).rolloutPercentage ?? flag.rolloutPercentage,
                variants: (variables as AdminFeatureFlagMutation).variants ?? flag.variants,
              }
            : flag,
        ),
      }),
    },
  });

  return {
    ...flagsQuery,
    featureFlags: flagsQuery.data?.featureFlags ?? [],
    saveFlag,
    settings: flagsQuery.data?.settings ?? [],
  };
};
