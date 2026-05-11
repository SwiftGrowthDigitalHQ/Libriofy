import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthRuntimeHealthMock = vi.fn();

vi.mock("@/lib/observability/databaseHealth.server", () => ({
  getAuthRuntimeHealth: (...args: unknown[]) => getAuthRuntimeHealthMock(...args),
}));

import {
  handleAuthApiRequest,
  isSupportedAuthApiPath,
  type ApiRequest,
  type ApiResponse,
} from "@/lib/authApiRoute.server";
import { clearAuthRuntimeIntegrityCacheForTest } from "@/lib/authRuntimeIntegrity.server";
import { resolveRefreshSessionRequest } from "@/lib/otpAuth.server";

const buildEnv = (overrides: Record<string, string | undefined> = {}) => ({
  APP_ENV: "test",
  APP_URL: "https://www.libriofy.com",
  AUTH_EMAIL_FROM: "hello@libriofy.com",
  PUBLIC_APP_URL: "https://www.libriofy.com",
  RESEND_API_KEY: "resend-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_JWT_SECRET: "jwt-secret",
  ...overrides,
});

const createMockResponse = () => {
  const headers = new Map<string, string | string[]>();

  const response = {
    body: "",
    end(body?: string) {
      this.body = body ?? "";
    },
    setHeader(name: string, value: string | string[]) {
      headers.set(name, value);
    },
    statusCode: 0,
  } satisfies ApiResponse & { body: string };

  return {
    headers,
    response,
  };
};

const parseBody = (body: string) => JSON.parse(body) as Record<string, unknown>;

describe("auth API route handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthRuntimeIntegrityCacheForTest();
    getAuthRuntimeHealthMock.mockResolvedValue({
      checked_at: "2026-05-11T00:00:00.000Z",
      checks: [],
      connectivity: "pass",
      detail: "Auth runtime contracts verified.",
      missing_contracts: [],
      service: "supabase-database-health",
      source: "live",
      status: "ok",
    });
  });

  it("supports the canonical Super Admin auth paths", () => {
    expect(isSupportedAuthApiPath("/api/auth/super-admin/login")).toBe(true);
    expect(isSupportedAuthApiPath("/api/auth/super-admin/verify")).toBe(true);
    expect(isSupportedAuthApiPath("/api/auth/impersonation/start")).toBe(true);
    expect(isSupportedAuthApiPath("/api/auth/impersonation/stop")).toBe(true);
    expect(isSupportedAuthApiPath("/api/auth/impersonation/audit")).toBe(true);
    expect(isSupportedAuthApiPath("/api/auth/refresh")).toBe(true);
    expect(isSupportedAuthApiPath("/api/auth/super-admin/unknown")).toBe(false);
  });

  it("returns a structured response for the explicit Super Admin login route", async () => {
    const req: ApiRequest = {
      body: { email: "admin@example.com" },
      method: "POST",
      url: "/api/auth/super-admin/login",
    };
    const { headers, response } = createMockResponse();

    await handleAuthApiRequest(req, response, buildEnv({
      REDIS_URL: undefined,
    }));

    expect(response.statusCode).toBe(503);
    expect(parseBody(response.body)).toMatchObject({
      code: "AUTH_INFRA_UNAVAILABLE",
      error: "Session and OTP challenge storage is not configured.",
      message: "Session and OTP challenge storage is not configured.",
      success: false,
    });
    expect(headers.get("x-request-id")).toBeTruthy();
    expect(headers.get("x-correlation-id")).toBeTruthy();
    expect(headers.get("x-trace-id")).toBeTruthy();
  });

  it("routes /api/auth/super-admin/verify through the OTP verifier instead of returning 404", async () => {
    const req: ApiRequest = {
      body: { email: "admin@example.com", otp: "" },
      method: "POST",
      url: "/api/auth/super-admin/verify",
    };
    const { response } = createMockResponse();

    await handleAuthApiRequest(req, response, buildEnv({
      REDIS_URL: "redis://example.test:6379",
    }));

    expect(response.statusCode).toBe(400);
    expect(parseBody(response.body)).toMatchObject({
      code: "INVALID_REQUEST",
      error: "Enter the 6-digit OTP to continue.",
      message: "Enter the 6-digit OTP to continue.",
      success: false,
    });
  });
});

describe("refresh session safeguards", () => {
  it("returns a structured 401 when the refresh cookie is missing", async () => {
    const result = await resolveRefreshSessionRequest(buildEnv(), {}, {});

    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      code: "SESSION_MISSING",
      error: "Session expired. Please sign in again.",
      message: "Session expired. Please sign in again.",
      success: false,
    });
  });
});
