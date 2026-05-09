import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { isVerifiedSuperAdminSession } from "@/lib/auth.shared";
import {
  SUPER_ADMIN_LOGIN_ROUTE,
  sanitizeSuperAdminRedirectPath,
} from "@/lib/superAdminPaths";
import {
  getRoleHomeRoute,
  getRoleHomeRouteFromRoleNames,
  isSupabaseUnauthorizedError,
  useUserRole,
} from "@/hooks/useUserRole";

const AuthRoute = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { session, user, loading } = useAuth();
  const isSuperAdminLoginRoute = location.pathname === SUPER_ADMIN_LOGIN_ROUTE;
  const sessionRoleNames = session?.user.roles ?? [];
  const shouldFetchRoles = !isSuperAdminLoginRoute;
  const { data: roles, error: rolesError, isLoading: rolesLoading } = useUserRole({ enabled: shouldFetchRoles });

  if (loading || (user && shouldFetchRoles && rolesLoading)) return null;

  if (user && shouldFetchRoles && rolesError && isSupabaseUnauthorizedError(rolesError)) {
    return null;
  }

  if (user) {
    const hasSuperAdminRole = shouldFetchRoles
      ? roles?.some((role) => role.role === "super_admin") ?? false
      : sessionRoleNames.includes("super_admin");
    if (isSuperAdminLoginRoute && hasSuperAdminRole && !isVerifiedSuperAdminSession(session)) {
      return <>{children}</>;
    }

    const destination = shouldFetchRoles
      ? getRoleHomeRoute(roles)
      : getRoleHomeRouteFromRoleNames(sessionRoleNames);
    const requestedRedirect = hasSuperAdminRole
      ? sanitizeSuperAdminRedirectPath(new URLSearchParams(location.search).get("redirect"))
      : null;
    return <Navigate to={requestedRedirect ?? (destination === "/auth" ? "/dashboard" : destination)} replace />;
  }

  return <>{children}</>;
};

export default AuthRoute;
