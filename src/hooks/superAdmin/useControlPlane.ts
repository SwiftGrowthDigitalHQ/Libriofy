import { adminClient } from "@/lib/superAdmin/client";
import { useControlPlaneRealtime } from "./useControlPlaneRealtime";
import { useAdminQuery } from "./useAdminQuery";

type UseControlPlaneOptions = {
  enabled?: boolean;
  refetchIntervalMs?: number | false;
};

export const useControlPlane = (
  options: UseControlPlaneOptions | number | false = {},
) => {
  const normalizedOptions =
    typeof options === "object" && options !== null
      ? options
      : { refetchIntervalMs: options };
  const { enabled = true, refetchIntervalMs = false } = normalizedOptions;
  const query = useAdminQuery({
    enabled,
    queryFn: () => adminClient.getPlatform(),
    queryKey: ["admin-platform"],
    refetchInterval: refetchIntervalMs,
    staleTime: 20_000,
  });

  useControlPlaneRealtime({
    enabled,
    queryKeys: [["admin-platform"]],
  });

  return query;
};
