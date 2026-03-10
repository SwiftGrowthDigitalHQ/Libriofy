import { ReactNode, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppRole, getRoleHomeRoute, isUserRolesSchemaError, useUserRole } from "@/hooks/useUserRole";
import { evaluateSubscriptionAccess, useLibrarySubscription } from "@/hooks/useLibrarySubscription";

interface ProtectedRouteProps {
  children: ReactNode;
  allowRoles?: AppRole[];
}

const getProjectRefFromEnv = (): string | null => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const projectRef = host.split(".")[0];
    return projectRef || null;
  } catch {
    return null;
  }
};

const ProtectedRoute = ({
  children,
  allowRoles,
}: ProtectedRouteProps) => {
  const location = useLocation();
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading, error: rolesError } = useUserRole();
  const roleHome = useMemo(() => getRoleHomeRoute(roles), [roles]);
  const projectRef = useMemo(() => getProjectRefFromEnv(), []);
  const { data: subscription, isLoading: subLoading } = useLibrarySubscription();
  const isLibraryDashboardRoute = allowRoles?.some((role) => role === "library_owner" || role === "staff") ?? false;
  const isBillingRoute = location.pathname === "/dashboard/billing";
  const subscriptionAccess = evaluateSubscriptionAccess(subscription);

  if (loading || rolesLoading) {
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
            {projectRef ? (
              <div className="text-left rounded-md border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground mb-2">Run these commands in project terminal:</p>
                <pre className="text-xs overflow-auto">
{`npx supabase login
npx supabase link --project-ref ${projectRef}
npx supabase db push`}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      );
    }
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
  }

  const isSuperAdmin = roles?.some((r) => r.role === "super_admin") ?? false;
  if (isLibraryDashboardRoute && isSuperAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (isLibraryDashboardRoute && subLoading) {
    return null;
  }

  if (allowRoles?.length) {
    const hasRequiredRole = roles?.some((r) => allowRoles.includes(r.role)) ?? false;
    if (!hasRequiredRole) {
      return <Navigate to={roleHome === "/auth" ? "/" : roleHome} replace />;
    }
  }

  if (isLibraryDashboardRoute && !isBillingRoute && !subscriptionAccess.isAllowed) {
    return <Navigate to="/dashboard/billing" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
