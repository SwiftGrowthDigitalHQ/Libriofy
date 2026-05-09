import { MAINTENANCE_ROUTE } from "./maintenance.js";
import { isSuperAdminDashboardPath } from "./superAdminPaths.js";

const normalizePath = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "/";
  }

  const pathname = trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
  if (pathname === "/") {
    return "/";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
};

export const isSuperAdminMaintenancePath = (pathname: string) => {
  const normalizedPath = normalizePath(pathname);
  return normalizedPath.startsWith("/super-admin") || isSuperAdminDashboardPath(normalizedPath);
};

export const isMaintenanceBypassUiPath = (pathname: string) => {
  const normalizedPath = normalizePath(pathname);
  return normalizedPath === MAINTENANCE_ROUTE || isSuperAdminMaintenancePath(normalizedPath);
};

export const isMaintenanceBypassApiPath = (pathname: string) => {
  const normalizedPath = normalizePath(pathname);

  return (
    normalizedPath === "/api/settings" ||
    normalizedPath.startsWith("/api/admin") ||
    normalizedPath === "/api/auth/logout" ||
    normalizedPath === "/api/auth/logout-all" ||
    normalizedPath === "/api/auth/twilio-status" ||
    normalizedPath === "/auth/logout" ||
    normalizedPath === "/auth/logout-all" ||
    normalizedPath === "/auth/twilio-status" ||
    normalizedPath.startsWith("/api/health") ||
    normalizedPath.startsWith("/api/observability") ||
    normalizedPath.startsWith("/api/auth/super-admin") ||
    normalizedPath.startsWith("/auth/super-admin")
  );
};

export const isMaintenanceBypassPath = (pathname: string) =>
  isMaintenanceBypassUiPath(pathname) || isMaintenanceBypassApiPath(pathname);

export const normalizeMaintenancePath = normalizePath;
