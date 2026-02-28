import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type AppRole = "super_admin" | "library_owner" | "staff" | "student";

export const useUserRole = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-roles", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, library_id")
        .eq("user_id", user.id);
      if (error) throw error;
      return data as { role: AppRole; library_id: string | null }[];
    },
    enabled: !!user,
  });
};

export const useIsSuperAdmin = () => {
  const { data: roles, isLoading } = useUserRole();
  return {
    isSuperAdmin: roles?.some((r) => r.role === "super_admin") ?? false,
    isLoading,
  };
};
