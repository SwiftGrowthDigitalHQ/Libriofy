import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentLibraryId } from "./useCurrentLibraryId";

export const useLibraryNotifications = (limit = 10) => {
  const { libraryId } = useCurrentLibraryId();

  return useQuery({
    queryKey: ["library-notifications", libraryId, limit],
    queryFn: async () => {
      if (!libraryId) return [];
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("library_id", libraryId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },
    enabled: !!libraryId,
  });
};
