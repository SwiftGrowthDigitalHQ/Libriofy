import { ReactNode, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppRole, getRoleHomeRoute, isUserRolesSchemaError, useUserRole } from "@/hooks/useUserRole";
import { isSubscriptionActive, useLibrarySubscription } from "@/hooks/useLibrarySubscription";

interface ProtectedRouteProps {
  children: ReactNode;
  allowRoles?: AppRole[];
  requireActiveSubscription?: boolean;
}

const ProtectedRoute = ({
  children,
  allowRoles,
  requireActiveSubscription = false,
}: ProtectedRouteProps) => {
  const location = useLocation();
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading, error: rolesError } = useUserRole();
  const roleHome = useMemo(() => getRoleHomeRoute(roles), [roles]);

  const { data: subscription, isLoading: subLoading } = useLibrarySubscription();

  if (loading || rolesLoading || (requireActiveSubscription && subLoading)) {
    return null;
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  if (rolesError) {
    if (isUserRolesSchemaError(rolesError)) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-lg text-center space-y-3">
            <h1 className="text-xl font-semibold text-foreground">Database setup incomplete</h1>
            <p className="text-sm text-muted-foreground">
              Supabase table <code>public.user_roles</code> was not found for this project.
            </p>
            <p className="text-sm text-muted-foreground">
              Run project migrations on the same Supabase project used in <code>.env</code>, then refresh.
            </p>
          </div>
        </div>
      );
    }
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  if (allowRoles?.length) {
    const hasRequiredRole = roles?.some((r) => allowRoles.includes(r.role)) ?? false;
    if (!hasRequiredRole) {
      return <Navigate to={roleHome === "/auth" ? "/" : roleHome} replace />;
    }
  }

  if (requireActiveSubscription && !isSubscriptionActive(subscription)) {
    return <Navigate to="/dashboard/support" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
