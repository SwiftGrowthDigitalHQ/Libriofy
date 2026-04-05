export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 2 * 60;
export const OTP_COOLDOWN_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 3;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const TRUSTED_DEVICE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const AUTH_REFRESH_COOKIE_NAME = "libriofy_refresh";
export const AUTH_DEVICE_HEADER = "x-device-fingerprint";

export type AuthDeliveryChannel = "whatsapp" | "sms";
export type AuthLoginMethod = "otp" | "email";
export type AuthSessionProvider = "custom" | "supabase";

export type AuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  roles: string[];
};

export type ClientAuthSession = {
  accessToken: string;
  expiresAt: number;
  loginMethod: AuthLoginMethod;
  provider: AuthSessionProvider;
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
