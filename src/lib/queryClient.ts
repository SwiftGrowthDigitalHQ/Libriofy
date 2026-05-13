import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import {
  classifyAppError,
  formatQueryLabel,
  getRetryToastMessage,
  isRetriableAppError,
} from "@/lib/errorHandling";
import { logAppError } from "@/lib/errorMonitoring";

const MAX_QUERY_RETRIES = 3;

const getRetryToastId = (queryHash: string) => `query-retry:${queryHash}`;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Admin queries handle their own error states — skip global toasts
      if (query.meta?.suppressGlobalError) {
        return;
      }

      const failureCount = query.state.fetchFailureCount;
      const shouldRetry = failureCount < MAX_QUERY_RETRIES && isRetriableAppError(error);
      const toastId = getRetryToastId(query.queryHash);

      if (shouldRetry) {
        toast.loading(getRetryToastMessage(query.queryKey, error), {
          description: "We're retrying automatically in the background.",
          duration: Infinity,
          id: toastId,
        });
        return;
      }

      toast.dismiss(toastId);

      const errorState = classifyAppError(error);
      toast.error(`${formatQueryLabel(query.queryKey)} failed`, {
        description: errorState.publicMessage,
        id: `${toastId}:final`,
      });

      void logAppError({
        error,
        metadata: {
          failureCount,
          queryKey: query.queryKey,
        },
        route: typeof window !== "undefined" ? window.location.pathname : "/",
        source: "query",
      });
    },
    onSuccess: (_data, query) => {
      toast.dismiss(getRetryToastId(query.queryHash));
    },
  }),
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      retry: (failureCount, error) => isRetriableAppError(error) && failureCount < MAX_QUERY_RETRIES,
      retryDelay: (attemptIndex) => Math.min(800 * 2 ** (attemptIndex - 1), 4000),
    },
  },
});
