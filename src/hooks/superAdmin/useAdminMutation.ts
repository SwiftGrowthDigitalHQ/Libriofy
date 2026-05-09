import { useMutation, useQueryClient, type QueryFilters, type QueryKey } from "@tanstack/react-query";
import { restoreMatchingQueries, updateMatchingQueries } from "@/lib/superAdmin/client";

type OptimisticConfig<TData> = {
  filters: QueryFilters;
  updater: (current: TData, variables: unknown) => TData;
};

type AdminMutationOptions<TResponse, TVariables, TOptimisticData = never> = {
  invalidateQueryKeys?: QueryKey[];
  mutationFn: (variables: TVariables) => Promise<TResponse>;
  onSuccess?: (response: TResponse, variables: TVariables) => void | Promise<void>;
  optimistic?: OptimisticConfig<TOptimisticData>;
};

export const useAdminMutation = <TResponse, TVariables, TOptimisticData = never>({
  invalidateQueryKeys = [],
  mutationFn,
  onSuccess,
  optimistic,
}: AdminMutationOptions<TResponse, TVariables, TOptimisticData>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onMutate: async (variables) => {
      if (!optimistic) {
        return {
          snapshots: [],
        };
      }

      await queryClient.cancelQueries(optimistic.filters);
      const snapshots = updateMatchingQueries<TOptimisticData>(
        queryClient,
        optimistic.filters,
        (current) => optimistic.updater(current, variables),
      );

      return {
        snapshots: snapshots ?? [],
      };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshots?.length) {
        restoreMatchingQueries(queryClient, context.snapshots);
      }
    },
    onSuccess: async (response, variables) => {
      if (onSuccess) {
        await onSuccess(response, variables);
      }
    },
    onSettled: async () => {
      await Promise.all(
        invalidateQueryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });
};
