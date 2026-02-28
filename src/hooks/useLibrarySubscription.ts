import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "./useUserRole";

export interface LibrarySubscription {
  id: string;
  library_id: string;
  plan_name: string;
  price: number;
  seats_limit: number;
  features: string[];
  status: string;
  started_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export const useLibrarySubscription = () => {
  const { data: roles } = useUserRole();
  const libraryId = roles?.find((r) => r.role === "library_owner")?.library_id;

  return useQuery({
    queryKey: ["library-subscription", libraryId],
    queryFn: async () => {
      if (!libraryId) return null;
      const { data, error } = await supabase
        .from("library_subscriptions" as any)
        .select("*")
        .eq("library_id", libraryId)
        .single();
      if (error) throw error;
      return data as unknown as LibrarySubscription;
    },
    enabled: !!libraryId,
  });
};

export const isSubscriptionActive = (sub: LibrarySubscription | null | undefined): boolean => {
  if (!sub) return false;
  if (sub.status === "blocked") return false;
  if (sub.status === "expired") return false;
  if (sub.status === "active" || sub.status === "trial") {
    if (sub.expires_at && new Date(sub.expires_at) < new Date()) return false;
    return true;
  }
  return false;
};
