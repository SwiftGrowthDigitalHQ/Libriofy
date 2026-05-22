import { adminClient } from "@/lib/superAdmin/client";
import { useAdminQuery } from "./useAdminQuery";

// Dashboard data is cached for 60s - no realtime subscriptions needed.
const PLATFORM_STALE_TIME_MS = 60_000;

export const useControlPlane = (refetchIntervalMs: number | false = false) =>
  useAdminQuery({
    queryFn: () => adminClient.getPlatform(),
    queryKey: ["admin-platform"],
    refetchInterval: refetchIntervalMs,
    staleTime: PLATFORM_STALE_TIME_MS,
  });
