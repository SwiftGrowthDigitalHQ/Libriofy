import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SUPER_ADMIN_DASHBOARD_ROUTE } from "@/lib/superAdminPaths";
import { useAuth } from "./useAuth";

export type AppRole = "super_admin" | "library_owner" | "staff" | "partner" | "student";
export type UserRoleRecord = { role: AppRole; library_id: string | null };
type UseUserRoleOptions = { enabled?: boolean };

const APP_ROLES: AppRole[] = ["super_admin", "library_owner", "staff", "partner", "student"];

const isAppRole = (value: string): value is AppRole => APP_ROLES.includes(value as AppRole);

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

export const toUserRoleRecords = (roles: readonly string[] | null | undefined): UserRoleRecord[] =>
  (roles ?? []).filter(isAppRole).map((role) => ({ library_id: null, role }));

export const useUserRole = (options?: UseUserRoleOptions) => {
  const { user, signOut } = useAuth();
  const isEnabled = options?.enabled ?? true;

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
        const partnerRole: UserRoleRecord = { role: "partner", library_id: null };
        return [...roles, partnerRole];
      }

      return roles;
    },
    enabled: !!user && isEnabled,
    retry: (failureCount, error) => {
      if (isSupabaseUnauthorizedError(error)) return false;
      if (isUserRolesSchemaError(error)) return false;
      return failureCount < 2;
    },
  });
};

export const useIsSuperAdmin = (options?: UseUserRoleOptions) => {
  const { data: roles, isLoading } = useUserRole(options);
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
  if (primary === "super_admin") return SUPER_ADMIN_DASHBOARD_ROUTE;
  if (primary === "library_owner" || primary === "staff") return "/dashboard";
  if (primary === "partner") return "/partner/dashboard";
  return "/auth";
};

export const getRoleHomeRouteFromRoleNames = (roles: readonly string[] | null | undefined) =>
  getRoleHomeRoute(toUserRoleRecords(roles));
