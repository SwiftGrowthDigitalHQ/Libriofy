import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLibraryId } from "./useCurrentLibraryId";
import {
  evaluateSubscriptionAccess,
  isSubscriptionActive,
  type LibrarySubscriptionRecord,
  type SubscriptionPlanCatalogRecord,
} from "@/lib/subscription";

export const useLibrarySubscription = (libraryIdOverride?: string | null) => {
  const { libraryId } = useCurrentLibraryId();
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .from("subscription_plans" as any)
          .select("code, name, price, seats_limit, lockers_limit")
          .eq("code", normalizedPlanCode)
          .maybeSingle();

        if (planError) throw planError;

        if (planData) {
          const planRecord = planData as Record<string, unknown>;
          currentPlan = {
            code: String(planRecord.code ?? normalizedPlanCode),
            name: planRecord.name == null ? null : String(planRecord.name),
            price: planRecord.price == null ? null : Number(planRecord.price),
            seats_limit: planRecord.seats_limit == null ? null : Number(planRecord.seats_limit),
            lockers_limit: planRecord.lockers_limit == null ? null : Number(planRecord.lockers_limit),
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
    enabled: !!resolvedLibraryId,
  });
};

export { evaluateSubscriptionAccess, isSubscriptionActive };
