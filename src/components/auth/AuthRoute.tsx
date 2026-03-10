import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getRoleHomeRoute, useUserRole } from "@/hooks/useUserRole";

const AuthRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading } = useUserRole();

  if (loading || (user && rolesLoading)) return null;

  if (user) {
    const destination = getRoleHomeRoute(roles);
    return <Navigate to={destination === "/auth" ? "/dashboard" : destination} replace />;
  }

  return <>{children}</>;
};

export default AuthRoute;
