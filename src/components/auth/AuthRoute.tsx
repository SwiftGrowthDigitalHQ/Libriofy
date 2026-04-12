import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { isVerifiedSuperAdminSession } from "@/lib/auth.shared";
import { SUPER_ADMIN_LOGIN_ROUTE, sanitizeSuperAdminRedirectPath } from "@/lib/superAdminPaths";
import { getRoleHomeRoute, isSupabaseUnauthorizedError, useUserRole } from "@/hooks/useUserRole";

const AuthRoute = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { session, user, loading } = useAuth();
  const { data: roles, error: rolesError, isLoading: rolesLoading } = useUserRole();

  if (loading || (user && rolesLoading)) return null;

  if (user && rolesError && isSupabaseUnauthorizedError(rolesError)) {
    return null;
  }

  if (user) {
    const isSuperAdminLoginRoute = location.pathname === SUPER_ADMIN_LOGIN_ROUTE;
    const hasSuperAdminRole = roles?.some((role) => role.role === "super_admin") ?? false;
    if (isSuperAdminLoginRoute && hasSuperAdminRole && !isVerifiedSuperAdminSession(session)) {
      return <>{children}</>;
    }

    const destination = getRoleHomeRoute(roles);
    const requestedRedirect = hasSuperAdminRole
      ? sanitizeSuperAdminRedirectPath(new URLSearchParams(location.search).get("redirect"))
      : null;
    return <Navigate to={requestedRedirect ?? (destination === "/auth" ? "/dashboard" : destination)} replace />;
  }

  return <>{children}</>;
};

export default AuthRoute;
