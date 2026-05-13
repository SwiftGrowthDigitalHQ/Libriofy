import { useQuery, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";

type AdminQueryOptions<TData> = Omit<
  UseQueryOptions<TData, Error, TData, QueryKey>,
  "queryFn" | "queryKey"
> & {
  queryFn: () => Promise<TData>;
  queryKey: QueryKey;
};

export const useAdminQuery = <TData>({
  staleTime = 30_000,
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
