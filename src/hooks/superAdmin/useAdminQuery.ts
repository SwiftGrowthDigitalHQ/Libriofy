import { useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS } from "@/lib/superAdmin/lightweightMode";

type AdminQueryOptions<TData> = Omit<
  UseQueryOptions<TData, Error, TData, QueryKey>,
  "queryFn" | "queryKey"
> & {
  queryFn: () => Promise<TData>;
  queryKey: QueryKey;
};

export const useAdminQuery = <TData>({
  staleTime = SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS,
  ...options
}: AdminQueryOptions<TData>) =>
  useQuery<TData, Error, TData, QueryKey>({
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime,
    meta: { suppressGlobalError: true },
    ...options,
  });
