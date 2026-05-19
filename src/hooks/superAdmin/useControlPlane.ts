import { adminClient } from "@/lib/superAdmin/client";
import { SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS } from "@/lib/superAdmin/lightweightMode";
import { useControlPlaneRealtime } from "./useControlPlaneRealtime";
import { useAdminQuery } from "./useAdminQuery";

type UseControlPlaneOptions = {
  enabled?: boolean;
  refetchIntervalMs?: number | false;
};

export const useControlPlane = (
  options: UseControlPlaneOptions | number | false = {},
) => {
  const normalizedOptions: UseControlPlaneOptions =
    typeof options === "number" || options === false
      ? { refetchIntervalMs: options }
      : options;
  const { enabled = true, refetchIntervalMs = false } = normalizedOptions;
  const query = useAdminQuery({
    enabled,
    queryFn: () => adminClient.getPlatform(),
    queryKey: ["admin-platform"],
    refetchInterval: refetchIntervalMs,
    staleTime: SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS,
  });

  useControlPlaneRealtime({
    enabled,
    queryKeys: [["admin-platform"]],
  });

  return query;
};
