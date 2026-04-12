import { ReactNode, useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { isVerifiedSuperAdminSession } from "@/lib/auth.shared";
import { SUPER_ADMIN_DASHBOARD_ROUTE, SUPER_ADMIN_LOGIN_ROUTE } from "@/lib/superAdminPaths";
import { AppRole, getRoleHomeRoute, isUserRolesSchemaError, useUserRole } from "@/hooks/useUserRole";
import { evaluateSubscriptionAccess, useLibrarySubscription } from "@/hooks/useLibrarySubscription";

interface ProtectedRouteProps {
  children: ReactNode;
  allowRoles?: AppRole[];
  debugLabel?: string;
  unauthenticatedRedirectTo?: string;
  unauthorizedRedirectTo?: string;
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
  debugLabel,
  unauthenticatedRedirectTo = "/auth",
  unauthorizedRedirectTo,
}: ProtectedRouteProps) => {
  const location = useLocation();
  const { session, user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading, error: rolesError } = useUserRole();
  const roleHome = useMemo(() => getRoleHomeRoute(roles), [roles]);
  const projectRef = useMemo(() => getProjectRefFromEnv(), []);
  const { data: subscription, isLoading: subLoading } = useLibrarySubscription();
  const isLibraryDashboardRoute = allowRoles?.some((role) => role === "library_owner" || role === "staff") ?? false;
  const isSuperAdminRoute = allowRoles?.includes("super_admin") ?? false;
  const isBillingRoute = location.pathname === "/dashboard/billing";
  const subscriptionAccess = evaluateSubscriptionAccess(subscription);
  const shouldDebug = debugLabel === "partner" || location.pathname === "/partner" || location.pathname.startsWith("/partner/");
  const currentUser = user ? { email: user.email, id: user.id } : null;
  const currentRoles = roles?.map((role) => role.role) ?? [];
  const logDebug = (message: string, extra?: Record<string, unknown>) => {
    if (!shouldDebug) return;

    console.log(`[ProtectedRoute:${debugLabel ?? location.pathname}] ${message}`, {
      allowRoles: allowRoles ?? [],
      currentRoute: location.pathname,
      currentUser,
      roles: currentRoles,
      ...extra,
    });
  };

  if (loading || rolesLoading) {
    logDebug("waiting for auth state", {
      authLoading: loading,
      rolesLoading,
    });
    return null;
  }

  if (!user) {
    logDebug("redirect trigger: unauthenticated user", {
      redirectTo: unauthenticatedRedirectTo,
    });
    return <Navigate to={unauthenticatedRedirectTo} replace state={{ from: location.pathname }} />;
  }

  if (rolesError) {
    if (isUserRolesSchemaError(rolesError)) {
      logDebug("blocking access because user_roles schema is missing", {
        rolesError: rolesError instanceof Error ? rolesError.message : String(rolesError),
      });
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
    logDebug("redirect trigger: roles lookup failed", {
      redirectTo: unauthenticatedRedirectTo,
      rolesError: rolesError instanceof Error ? rolesError.message : String(rolesError),
    });
    return <Navigate to={unauthenticatedRedirectTo} replace state={{ from: location.pathname }} />;
  }

  const isSuperAdmin = roles?.some((r) => r.role === "super_admin") ?? false;
  const hasVerifiedSuperAdminSession = isVerifiedSuperAdminSession(session);

  if (isSuperAdminRoute && !hasVerifiedSuperAdminSession) {
    return (
      <Navigate
        to={SUPER_ADMIN_LOGIN_ROUTE}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  if (isLibraryDashboardRoute && isSuperAdmin) {
    logDebug("redirect trigger: super admin opened a library dashboard route", {
      redirectTo: SUPER_ADMIN_DASHBOARD_ROUTE,
    });
    return <Navigate to={SUPER_ADMIN_DASHBOARD_ROUTE} replace />;
  }

  if (isLibraryDashboardRoute && subLoading) {
    logDebug("waiting for subscription state", {
      subLoading,
    });
    return null;
  }

  if (allowRoles?.length) {
    const hasRequiredRole = roles?.some((r) => allowRoles.includes(r.role)) ?? false;
    if (!hasRequiredRole) {
      const redirectTo = unauthorizedRedirectTo ?? (roleHome === "/auth" ? "/dashboard" : roleHome);
      logDebug("redirect trigger: user does not have an allowed role", {
        redirectTo,
      });
      return <Navigate to={redirectTo} replace state={{ from: location.pathname }} />;
    }
  }

  if (isLibraryDashboardRoute && !isBillingRoute && !subscriptionAccess.isAllowed) {
    logDebug("redirect trigger: subscription gate", {
      redirectTo: "/dashboard/billing",
    });
    return <Navigate to="/dashboard/billing" replace state={{ from: location.pathname }} />;
  }

  logDebug("access granted");
  return <>{children}</>;
};

export default ProtectedRoute;
