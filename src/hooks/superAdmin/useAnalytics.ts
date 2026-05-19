import { adminClient } from "@/lib/superAdmin/client";
import { useControlPlaneRealtime } from "./useControlPlaneRealtime";
import { useAdminQuery } from "./useAdminQuery";

type UseAnalyticsOptions = {
  city?: string;
  enabled?: boolean;
  refetchIntervalMs?: number | false;
};

export const useAnalytics = (
  options: UseAnalyticsOptions | string = "",
  legacyRefetchIntervalMs: number | false = false,
) => {
  const normalizedOptions =
    typeof options === "string"
      ? {
          city: options,
          refetchIntervalMs: legacyRefetchIntervalMs,
        }
      : options;
  const {
    city = "",
    enabled = true,
    refetchIntervalMs = false,
  } = normalizedOptions;
  const query = useAdminQuery({
    enabled,
    queryFn: () => adminClient.getAnalytics(city ? { city } : undefined),
    queryKey: ["admin-analytics", city],
    refetchInterval: refetchIntervalMs,
    staleTime: 20_000,
  });

  useControlPlaneRealtime({
    enabled,
    queryKeys: [["admin-analytics"]],
  });

  return query;
};
