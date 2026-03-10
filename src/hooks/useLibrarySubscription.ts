import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLibraryId } from "./useCurrentLibraryId";
import {
  evaluateSubscriptionAccess,
  isSubscriptionActive,
  type LibrarySubscriptionRecord,
} from "@/lib/subscription";

export const useLibrarySubscription = () => {
  const { libraryId } = useCurrentLibraryId();

  return useQuery({
    queryKey: ["library-subscription", libraryId],
    queryFn: async () => {
      if (!libraryId) return null;
      const { data, error } = await supabase
        .from("library_subscriptions")
        .select("*, libraries(enabled, name)")
        .eq("library_id", libraryId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const normalized = data as unknown as LibrarySubscriptionRecord & {
        libraries?: { enabled: boolean; name: string | null } | Array<{ enabled: boolean; name: string | null }> | null;
      };
      return {
        ...normalized,
        libraries: Array.isArray(normalized.libraries) ? normalized.libraries[0] ?? null : normalized.libraries ?? null,
      } satisfies LibrarySubscriptionRecord;
    },
    enabled: !!libraryId,
  });
};

export { evaluateSubscriptionAccess, isSubscriptionActive };
