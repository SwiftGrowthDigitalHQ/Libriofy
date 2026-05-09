export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 2 * 60;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 3;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const SUPER_ADMIN_OTP_TTL_SECONDS = 5 * 60;
export const SUPER_ADMIN_IDLE_TIMEOUT_SECONDS = 30 * 60;
export const TRUSTED_DEVICE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const AUTH_REFRESH_COOKIE_NAME = "libriofy_refresh";
export const AUTH_DEVICE_HEADER = "x-device-fingerprint";
export const IMPERSONATION_ACCESS_TOKEN_TTL_SECONDS = 2 * 60;
export const IMPERSONATION_SESSION_TTL_SECONDS = 30 * 60;

export type AuthDeliveryChannel = "whatsapp" | "sms";
export type AuthLoginMethod = "otp" | "email";
export type AuthSessionProvider = "custom" | "supabase";
export type AuthSessionScope = "general" | "super_admin" | "impersonation";
export type SuperAdminOtpChannel = "email";

export type AuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  roles: string[];
};

export type AuthImpersonationContext = {
  effectiveUser: AuthUser;
  expiresAt: string;
  impersonationId: string;
  realUser: AuthUser;
  startedAt: string;
};

export type ClientAuthSession = {
  accessToken: string;
  authLevel: number;
  effectiveUser?: AuthUser;
  expiresAt: number;
  idleTimeoutSeconds: number | null;
  impersonation?: AuthImpersonationContext | null;
  loginMethod: AuthLoginMethod;
  provider: AuthSessionProvider;
  realUser?: AuthUser | null;
  sessionScope: AuthSessionScope;
  trustedDevice: boolean;
  user: AuthUser;
};

export type SendOtpResponse = {
  success: boolean;
  channel: AuthDeliveryChannel;
  expiresIn: number;
  message: string;
  retryAfter: number;
};

export type VerifyOtpResponse = {
  success: boolean;
  channel: AuthDeliveryChannel;
  message: string;
  session: ClientAuthSession;
};

export type LoginEmailResponse = {
  success: boolean;
  message: string;
  session: ClientAuthSession;
};

export type RefreshSessionResponse = {
  success: boolean;
  message: string;
  session: ClientAuthSession;
};

export type StartImpersonationResponse = {
  success: boolean;
  message: string;
  session: ClientAuthSession;
};

export type StopImpersonationResponse = {
  success: boolean;
  message: string;
  session: ClientAuthSession;
};

export type ImpersonationAuditResponse = {
  success: boolean;
  message: string;
};

export type AuthErrorResponse = {
  success: false;
  code?: string;
  error: string;
  message: string;
  remainingAttempts?: number;
  requestId?: string;
  retryAfter?: number;
};

export type SuperAdminLoginResponse = {
  success: boolean;
  channel: SuperAdminOtpChannel;
  email: string;
  expiresIn: number;
  maskedDestination: string;
  message: string;
  retryAfter: number;
};

export type SuperAdminVerifyOtpResponse = {
  success: boolean;
  channel: SuperAdminOtpChannel;
  message: string;
  session: ClientAuthSession;
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const cleanPhoneDigits = (value: string) => value.replace(/[^\d+]/g, "");

const normalizeDefaultCountryCode = (value: string) => {
  const trimmed = trimText(value);
  if (!trimmed) {
    return "+91";
  }

  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }

  return `+${trimmed.replace(/\D/g, "")}`;
};

export const normalizePhoneNumber = (value: unknown, defaultCountryCode = "+91") => {
  const trimmed = trimText(value);
  if (!trimmed) {
    return "";
  }

  const normalizedDefaultCountryCode = normalizeDefaultCountryCode(defaultCountryCode);
  const sanitized = cleanPhoneDigits(trimmed);

  if (!sanitized) {
    return "";
  }

  if (sanitized.startsWith("+")) {
    const digits = sanitized.slice(1).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return "";
    }

    return `+${digits}`;
  }

  if (sanitized.startsWith("00")) {
    const digits = sanitized.slice(2).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return "";
    }

    return `+${digits}`;
  }

  const digitsOnly = sanitized.replace(/\D/g, "");
  if (digitsOnly.length === 10) {
    return `${normalizedDefaultCountryCode}${digitsOnly}`;
  }

  if (digitsOnly.length >= 11 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`;
  }

  return "";
};

export const expandPhoneCandidates = (value: unknown, defaultCountryCode = "+91") => {
  const normalized = normalizePhoneNumber(value, defaultCountryCode);
  if (!normalized) {
    return [];
  }

  const digitsOnly = normalized.replace(/\D/g, "");
  const localNumber = digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
  const candidates = new Set<string>([normalized, digitsOnly]);

  if (localNumber) {
    candidates.add(localNumber);
  }

  return [...candidates];
};

export const isValidOtpCode = (value: unknown) => new RegExp(`^\\d{${OTP_LENGTH}}$`).test(trimText(value));

export const buildOtpMessage = (otp: string, webOtpHost?: string | null) => {
  const base = `Libriofy OTP: ${otp}. Valid for 2 minutes. Do not share.`;
  const host = trimText(webOtpHost)
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");

  if (!host) {
    return base;
  }

  return `${base}\n\n@${host} #${otp}`;
};

export const maskPhoneNumber = (value: string) => {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) {
    return value;
  }

  const digits = normalized.replace(/\D/g, "");
  if (digits.length <= 4) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, normalized.length - 4)).replace(/\d/g, "•")}${digits.slice(-4)}`;
};

export const isAuthSessionExpired = (session: ClientAuthSession | null | undefined, leewayMs = 5_000) => {
  if (!session) {
    return true;
  }

  return session.expiresAt * 1000 <= Date.now() + leewayMs;
};

export const isAdminFallbackRole = (role: string) =>
  role === "super_admin" || role === "library_owner" || role === "staff";

export const maskEmailAddress = (value: string) => {
  const trimmed = trimText(value).toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    return trimmed;
  }

  const [localPart, domain] = trimmed.split("@");
  if (!localPart || !domain) {
    return trimmed;
  }

  const visibleLocal = localPart.slice(0, Math.min(2, localPart.length));
  const maskedLocal = `${visibleLocal}${"*".repeat(Math.max(1, localPart.length - visibleLocal.length))}`;
  return `${maskedLocal}@${domain}`;
};

export const getEffectiveSessionUser = (session: ClientAuthSession | null | undefined) =>
  session?.effectiveUser ?? session?.impersonation?.effectiveUser ?? session?.user ?? null;

export const getRealSessionUser = (session: ClientAuthSession | null | undefined) =>
  session?.realUser ?? session?.impersonation?.realUser ?? null;

export const getSessionImpersonation = (session: ClientAuthSession | null | undefined) =>
  session?.impersonation ?? null;

export const isImpersonationSession = (session: ClientAuthSession | null | undefined) =>
  !!getSessionImpersonation(session)?.impersonationId;

export const isVerifiedSuperAdminSession = (session: ClientAuthSession | null | undefined) => {
  if (!session || session.authLevel < 2) {
    return false;
  }

  if (session.sessionScope !== "super_admin" && session.sessionScope !== "impersonation") {
    return false;
  }

  const effectiveUser = getEffectiveSessionUser(session);
  const realUser = getRealSessionUser(session);
  return [effectiveUser, realUser].some((candidate) => candidate?.roles.includes("super_admin"));
};
