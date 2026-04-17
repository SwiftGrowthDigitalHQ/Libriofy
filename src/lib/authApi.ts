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

const AUTH_API_BASE = (import.meta.env.VITE_AUTH_API_BASE ?? "/api/auth").replace(/\/+$/, "");

const toApiUrl = (path: string) => `${AUTH_API_BASE}${path}`;

const buildRequestHeaders = async (headers?: Record<string, string>) => ({
  "Content-Type": "application/json",
  "x-device-fingerprint": await getDeviceFingerprint(),
  "x-device-label": getDeviceLabel(),
  ...(headers ?? {}),
});

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

export const startSuperAdminLogin = async (email: string, password: string) =>
  sendJsonRequest<SuperAdminLoginResponse>("/super-admin/login", {
    body: { email, password },
  });

export const verifySuperAdminOtp = async (challengeId: string, otp: string) =>
  sendJsonRequest<SuperAdminVerifyOtpResponse>("/super-admin/verify-otp", {
    body: { challengeId, otp },
  });

export const refreshAuthSession = async () =>
  sendJsonRequest<RefreshSessionResponse>("/refresh");

export const logoutCurrentSession = async () =>
  sendJsonRequest<{ message: string; success: true }>("/logout");

export const logoutAllSessions = async (accessToken?: string | null) =>
  sendJsonRequest<{ message: string; success: true }>("/logout-all", {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });

export const extractSessionFromResponse = (response: { session: ClientAuthSession }) => response.session;
