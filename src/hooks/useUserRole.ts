import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type AppRole = "super_admin" | "library_owner" | "staff" | "partner" | "student";
export type UserRoleRecord = { role: AppRole; library_id: string | null };

export const isSupabaseUnauthorizedError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; status?: number; message?: string };
  if (maybeError.status === 401) return true;

  const message = (maybeError.message ?? "").toLowerCase();
  return message.includes("unauthorized") || message.includes("jwt") || message.includes("auth");
};

export const isUserRolesSchemaError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; status?: number; message?: string };
  if (maybeError.code === "PGRST205" || maybeError.status === 404) return true;
  return (maybeError.message ?? "").toLowerCase().includes("user_roles");
};

export const useUserRole = () => {
  const { user, signOut } = useAuth();

  return useQuery({
    queryKey: ["user-roles", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, library_id")
        .eq("user_id", user.id);
      if (error) {
        if (isSupabaseUnauthorizedError(error)) {
          await signOut();
        }
        throw error;
      }

      const roles = (data as UserRoleRecord[]) ?? [];
      if (roles.some((role) => role.role === "partner")) {
        return roles;
      }

      const { data: affiliate, error: affiliateError } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("affiliates" as any)
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (affiliateError) {
        throw affiliateError;
      }

      if (affiliate) {
        return [...roles, { role: "partner", library_id: null }];
      }

      return roles;
    },
    enabled: !!user,
    retry: (failureCount, error) => {
      if (isSupabaseUnauthorizedError(error)) return false;
      if (isUserRolesSchemaError(error)) return false;
      return failureCount < 2;
    },
  });
};

export const useIsSuperAdmin = () => {
  const { data: roles, isLoading } = useUserRole();
  return {
    isSuperAdmin: roles?.some((r) => r.role === "super_admin") ?? false,
    isLoading,
  };
};

export const getPrimaryRole = (roles: UserRoleRecord[] | null | undefined): AppRole | null => {
  if (!roles?.length) return null;
  if (roles.some((r) => r.role === "super_admin")) return "super_admin";
  if (roles.some((r) => r.role === "partner")) return "partner";
  if (roles.some((r) => r.role === "library_owner")) return "library_owner";
  if (roles.some((r) => r.role === "staff")) return "staff";
  if (roles.some((r) => r.role === "student")) return "student";
  return null;
};

export const getRoleHomeRoute = (roles: UserRoleRecord[] | null | undefined): string => {
  const primary = getPrimaryRole(roles);
  if (primary === "super_admin") return "/admin";
  if (primary === "library_owner" || primary === "staff") return "/dashboard";
  if (primary === "partner") return "/partner/dashboard";
  return "/auth";
};
