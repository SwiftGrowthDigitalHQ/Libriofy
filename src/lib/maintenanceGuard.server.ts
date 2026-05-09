import { extractClientIp, extractUserAgent } from "./httpRequest.server.js";
import { readSafeMaintenanceStatus } from "./maintenanceRuntime.server.js";
import { isMaintenanceBypassPath, normalizeMaintenancePath } from "./maintenanceAccess.js";
import { resolveSuperAdminSessionRequest } from "./otpAuth.server.js";

type EnvLike = Record<string, string | undefined>;

type RequestHeaders = Record<string, string | string[] | undefined>;

type MaintenanceRequestContext = {
  authorization?: string;
  cookieHeader?: string;
  deviceFingerprint?: string;
  deviceLabel?: string;
  host?: string;
  ip?: string;
  origin?: string;
  pathname: string;
  referer?: string;
  userAgent?: string;
};

export type MaintenanceGateDecision = {
  allow: boolean;
  maintenanceMode: boolean;
  pathname: string;
  reason:
    | "maintenance_disabled"
    | "path_bypass"
    | "super_admin_session"
    | "maintenance_blocked";
};

const readHeaderValue = (headers: RequestHeaders, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export const readMaintenanceContextFromHeaders = ({
  authorization,
  headers,
  pathname,
}: {
  authorization?: string;
  headers: RequestHeaders;
  pathname: string;
}): MaintenanceRequestContext => ({
  authorization: authorization ?? readHeaderValue(headers, "authorization"),
  cookieHeader: readHeaderValue(headers, "cookie"),
  deviceFingerprint: readHeaderValue(headers, "x-device-fingerprint"),
  deviceLabel: readHeaderValue(headers, "x-device-label"),
  host: readHeaderValue(headers, "host") || readHeaderValue(headers, "x-forwarded-host"),
  ip: extractClientIp(headers),
  origin: readHeaderValue(headers, "origin"),
  pathname: normalizeMaintenancePath(pathname),
  referer: readHeaderValue(headers, "referer"),
  userAgent: extractUserAgent(headers),
});

export const evaluateMaintenanceRequest = async (
  env: EnvLike,
  context: MaintenanceRequestContext,
): Promise<MaintenanceGateDecision> => {
  const pathname = normalizeMaintenancePath(context.pathname);
  const maintenance = await readSafeMaintenanceStatus();

  if (!maintenance.maintenanceMode) {
    return {
      allow: true,
      maintenanceMode: false,
      pathname,
      reason: "maintenance_disabled",
    };
  }

  if (isMaintenanceBypassPath(pathname)) {
    return {
      allow: true,
      maintenanceMode: true,
      pathname,
      reason: "path_bypass",
    };
  }

  const superAdminSession = await resolveSuperAdminSessionRequest(env, {
    authorization: context.authorization,
    cookieHeader: context.cookieHeader,
    deviceFingerprint: context.deviceFingerprint,
    deviceLabel: context.deviceLabel,
    host: context.host,
    ip: context.ip,
    origin: context.origin,
    referer: context.referer,
    userAgent: context.userAgent,
  }).catch(() => null);

  if (superAdminSession) {
    return {
      allow: true,
      maintenanceMode: true,
      pathname,
      reason: "super_admin_session",
    };
  }

  return {
    allow: false,
    maintenanceMode: true,
    pathname,
    reason: "maintenance_blocked",
  };
};

export const buildMaintenanceApiError = (requestId?: string | null) => ({
  success: false,
  code: "MAINTENANCE_MODE",
  error: "Libriofy is temporarily in maintenance mode.",
  message: "Libriofy is temporarily in maintenance mode.",
  ...(requestId ? { requestId } : {}),
});
