import type {
  ClientAuthSession,
  LoginEmailResponse,
  RefreshSessionResponse,
  SendOtpResponse,
  SuperAdminLoginResponse,
  SuperAdminVerifyOtpResponse,
  VerifyOtpResponse,
} from "@/lib/auth.shared";
import { getDeviceFingerprint, getDeviceLabel } from "@/lib/deviceFingerprint";
import { buildBearerAuthorizationHeader, sanitizeHeaders } from "@/lib/httpHeaders";

type ApiErrorPayload = {
  code?: string;
  message?: string;
  remainingAttempts?: number;
  retryAfter?: number;
  success?: boolean;
};

type JsonRequestOptions = {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
};

const AUTH_API_PREFIX = "/api/auth";
const AUTH_API_ALLOWED_HEADERS = ["Authorization", "Content-Type", "x-device-fingerprint", "x-device-label"] as const;
const AUTH_API_VALUE_MODES = {
  "x-device-label": "sanitize",
} as const;

const normalizeAuthApiBase = (rawBase: string | undefined) => {
  const trimmed = typeof rawBase === "string" ? rawBase.trim() : "";
  if (!trimmed) {
    return "";
  }

  const normalizedBase = trimmed.replace(/\/(?:api\/)?auth\/?$/i, "").replace(/\/+$/, "");

  if (typeof window !== "undefined") {
    const currentOrigin = window.location.origin.replace(/\/+$/, "");
    if (normalizedBase === currentOrigin) {
      return "";
    }
  }

  return normalizedBase;
};

const AUTH_API_BASE = normalizeAuthApiBase(import.meta.env.VITE_AUTH_API_BASE);

const toApiUrl = (path: string) => `${AUTH_API_BASE}${AUTH_API_PREFIX}${path}`;

const buildRequestHeaders = async (headers?: Record<string, string>) => {
  const nextHeaders = sanitizeHeaders({
    "Content-Type": "application/json",
    "x-device-fingerprint": await getDeviceFingerprint(),
    "x-device-label": getDeviceLabel(),
    ...(headers ?? {}),
  }, {
    allowedHeaders: AUTH_API_ALLOWED_HEADERS,
    valueModes: AUTH_API_VALUE_MODES,
  });

  return nextHeaders;
};

const readJsonResponse = async <T>(response: Response): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
};

const toError = async (response: Response) => {
  const payload = await readJsonResponse<ApiErrorPayload>(response);
  const error = new Error(payload.message || "Authentication request failed.") as Error & ApiErrorPayload;
  error.code = payload.code;
  error.remainingAttempts = payload.remainingAttempts;
  error.retryAfter = payload.retryAfter;
  return error;
};

const sendJsonRequest = async <T>(path: string, options: JsonRequestOptions = {}) => {
  const response = await fetch(toApiUrl(path), {
    method: options.method ?? "POST",
    headers: await buildRequestHeaders(options.headers),
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });

  if (!response.ok) {
    throw await toError(response);
  }

  return readJsonResponse<T>(response);
};

export const sendOtp = async (phone: string) =>
  sendJsonRequest<SendOtpResponse>("/send-otp", {
    body: { phone },
  });

export const verifyOtp = async (phone: string, otp: string) =>
  sendJsonRequest<VerifyOtpResponse>("/verify-otp", {
    body: { otp, phone },
  });

export const loginWithEmail = async (email: string, password: string) =>
  sendJsonRequest<LoginEmailResponse>("/login-email", {
    body: { email, password },
  });

export const startSuperAdminLogin = async (email: string) =>
  sendJsonRequest<SuperAdminLoginResponse>("/super-admin/login", {
    body: { email },
  });

export const verifySuperAdminOtp = async (email: string, otp: string) =>
  sendJsonRequest<SuperAdminVerifyOtpResponse>("/super-admin/verify-otp", {
    body: { email, otp },
  });

export const refreshAuthSession = async () =>
  sendJsonRequest<RefreshSessionResponse>("/refresh");

export const logoutCurrentSession = async () =>
  sendJsonRequest<{ message: string; success: true }>("/logout");

export const logoutAllSessions = async (accessToken?: string | null) =>
  sendJsonRequest<{ message: string; success: true }>("/logout-all", {
    headers: accessToken
      ? { Authorization: buildBearerAuthorizationHeader(accessToken, "Missing access token.") }
      : undefined,
  });

export const extractSessionFromResponse = (response: { session: ClientAuthSession }) => response.session;
