import { adminClient } from "@/lib/superAdmin/client";
import { useAdminQuery } from "./useAdminQuery";

export const useAnalytics = (city = "Patna", refetchIntervalMs: number | false = false) =>
  useAdminQuery({
    queryFn: () => adminClient.getAnalytics({ city }),
    queryKey: ["admin-analytics", city],
    refetchInterval: refetchIntervalMs,
    staleTime: 20_000,
  });
