export const SUPER_ADMIN_LOGIN_ROUTE = "/super-admin-login";
export const SUPER_ADMIN_DASHBOARD_ROUTE = "/super-admin-dashboard";
export const LEGACY_SUPER_ADMIN_DASHBOARD_ROUTE = "/admin";

export const isSuperAdminDashboardPath = (pathname: string) =>
  pathname === SUPER_ADMIN_DASHBOARD_ROUTE ||
  pathname === LEGACY_SUPER_ADMIN_DASHBOARD_ROUTE ||
  pathname.startsWith("/admin/");

export const sanitizeSuperAdminRedirectPath = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const pathname = trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
  return isSuperAdminDashboardPath(pathname) ? trimmed : null;
};
