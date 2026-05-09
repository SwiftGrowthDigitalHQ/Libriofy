import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLibraryId } from "./useCurrentLibraryId";
import {
  evaluateSubscriptionAccess,
  isSubscriptionActive,
  type LibrarySubscriptionRecord,
  type SubscriptionPlanCatalogRecord,
} from "@/lib/subscription";

type UseLibrarySubscriptionOptions = { enabled?: boolean };

export const useLibrarySubscription = (
  libraryIdOverride?: string | null,
  options?: UseLibrarySubscriptionOptions,
) => {
  const isEnabled = options?.enabled ?? true;
  const { libraryId } = useCurrentLibraryId({ enabled: isEnabled });
  const resolvedLibraryId = libraryIdOverride === undefined ? libraryId : libraryIdOverride;

  return useQuery({
    queryKey: ["library-subscription", resolvedLibraryId],
    queryFn: async () => {
      if (!resolvedLibraryId) return null;
      const { data, error } = await supabase
        .from("library_subscriptions")
        .select("*, libraries(enabled, name)")
        .eq("library_id", resolvedLibraryId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const normalizedPlanCode = String(data.plan_name ?? "").trim().toLowerCase();
      let currentPlan: SubscriptionPlanCatalogRecord | null = null;

      if (normalizedPlanCode) {
        const { data: planData, error: planError } = await supabase
          .from("subscription_plans")
          .select("code, name, price, seats_limit, lockers_limit")
          .eq("code", normalizedPlanCode)
          .returns<SubscriptionPlanCatalogRecord[]>()
          .maybeSingle();

        if (planError) throw planError;

        if (planData) {
          currentPlan = {
            code: planData.code ?? normalizedPlanCode,
            name: planData.name ?? null,
            price: planData.price ?? null,
            seats_limit: planData.seats_limit ?? null,
            lockers_limit: planData.lockers_limit ?? null,
          };
        }
      }

      const normalized = data as unknown as LibrarySubscriptionRecord & {
        libraries?: { enabled: boolean; name: string | null } | Array<{ enabled: boolean; name: string | null }> | null;
      };
      return {
        ...normalized,
        current_plan: currentPlan,
        libraries: Array.isArray(normalized.libraries) ? normalized.libraries[0] ?? null : normalized.libraries ?? null,
      } satisfies LibrarySubscriptionRecord;
    },
    enabled: isEnabled && !!resolvedLibraryId,
  });
};

export { evaluateSubscriptionAccess, isSubscriptionActive };
