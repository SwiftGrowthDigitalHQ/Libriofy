import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useUserRole } from "./useUserRole";

export const useCurrentLibraryId = () => {
  const { user } = useAuth();
  const { data: roles, isLoading: rolesLoading } = useUserRole();
  const { data: ownedLibraries = [], isLoading: ownedLibrariesLoading } = useQuery({
    queryKey: ["current-user-owned-libraries", user?.id],
    queryFn: async (): Promise<Array<{ id: string }>> => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("libraries")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        throw error;
      }

      return data ?? [];
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const libraryId = useMemo(() => {
    return (
      ownedLibraries[0]?.id ??
      roles?.find((r) => r.role === "library_owner")?.library_id ??
      roles?.find((r) => r.role === "staff")?.library_id ??
      null
    );
  }, [ownedLibraries, roles]);

  return { libraryId, isLoading: rolesLoading || ownedLibrariesLoading };
};
