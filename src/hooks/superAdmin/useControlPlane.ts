import { adminClient } from "@/lib/superAdmin/client";
import { useAdminQuery } from "./useAdminQuery";

export const useControlPlane = (refetchIntervalMs: number | false = false) =>
  useAdminQuery({
    queryFn: () => adminClient.getPlatform(),
    queryKey: ["admin-platform"],
    refetchInterval: refetchIntervalMs,
    staleTime: 20_000,
  });
