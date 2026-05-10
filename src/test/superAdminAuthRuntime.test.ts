import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthRuntimeHealthMock = vi.fn();

vi.mock("@/lib/observability/databaseHealth.server", () => ({
  getAuthRuntimeHealth: (...args: unknown[]) => getAuthRuntimeHealthMock(...args),
}));

import {
  resolveSendOtpRequest,
  resolveSuperAdminLoginRequest,
  resolveSuperAdminVerifyOtpRequest,
} from "@/lib/otpAuth.server";

const buildEnv = (overrides: Record<string, string | undefined> = {}) => ({
  APP_URL: "https://www.libriofy.com",
  APP_ENV: "test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  SUPABASE_URL: "https://example.supabase.co",
  STUDENT_QR_PRIVATE_KEY: "qr-private-key",
  ...overrides,
});

describe("Super Admin auth runtime safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthRuntimeHealthMock.mockResolvedValue({
      checked_at: "2026-05-10T00:00:00.000Z",
      checks: [],
      connectivity: "pass",
      detail: "Auth runtime contracts verified.",
      missing_contracts: [],
      service: "supabase-database-health",
      source: "live",
      status: "ok",
    });
  });

  it("fails fast with a structured 503 when Redis is missing", async () => {
    const result = await resolveSuperAdminLoginRequest(
      buildEnv({
        AUTH_EMAIL_FROM: "hello@libriofy.com",
        RESEND_API_KEY: "resend-key",
        SUPABASE_JWT_SECRET: "jwt-secret",
      }),
      { email: "admin@example.com" },
      { ip: "127.0.0.1" },
    );

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      code: "AUTH_INFRA_UNAVAILABLE",
      message: "Session and OTP challenge storage is not configured.",
      success: false,
    });
  });

  it("fails fast with a structured 503 when Super Admin email OTP delivery is not configured", async () => {
    const result = await resolveSuperAdminLoginRequest(
      buildEnv({
        REDIS_URL: "redis://example.test:6379",
        SUPABASE_JWT_SECRET: "jwt-secret",
      }),
      { email: "admin@example.com" },
      { ip: "127.0.0.1" },
    );

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      code: "OTP_DELIVERY_UNAVAILABLE",
      message: "Super admin email OTP delivery must use hello@libriofy.com via Resend.",
      success: false,
    });
  });

  it("accepts RESEND_FROM_EMAIL as the production sender alias", async () => {
    const result = await resolveSuperAdminLoginRequest(
      buildEnv({
        REDIS_URL: undefined,
        RESEND_API_KEY: "resend-key",
        RESEND_FROM_EMAIL: "hello@libriofy.com",
        SUPABASE_JWT_SECRET: "jwt-secret",
      }),
      { email: "admin@example.com" },
      { ip: "127.0.0.1" },
    );

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      code: "AUTH_INFRA_UNAVAILABLE",
      message: "Session and OTP challenge storage is not configured.",
      success: false,
    });
  });

  it("blocks Super Admin OTP delivery when auth runtime contracts are degraded", async () => {
    getAuthRuntimeHealthMock.mockResolvedValue({
      checked_at: "2026-05-10T00:00:00.000Z",
      checks: [
        {
          check_name: "column:auth_trusted_devices.auth_level",
          detail: "public.auth_trusted_devices.auth_level is missing.",
          ok: false,
        },
      ],
      connectivity: "pass",
      detail: "Missing auth runtime contracts: column:auth_trusted_devices.auth_level.",
      missing_contracts: ["column:auth_trusted_devices.auth_level"],
      service: "supabase-database-health",
      source: "live",
      status: "degraded",
    });

    const result = await resolveSuperAdminLoginRequest(
      buildEnv({
        AUTH_EMAIL_FROM: "hello@libriofy.com",
        REDIS_URL: "redis://example.test:6379",
        RESEND_API_KEY: "resend-key",
        SUPABASE_JWT_SECRET: "jwt-secret",
      }),
      { email: "admin@example.com" },
      { ip: "127.0.0.1" },
    );

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      code: "AUTH_SESSION_STORE_SCHEMA_MISMATCH",
      message: "Super admin sign-in is temporarily unavailable. Please try again shortly.",
      success: false,
    });
  });

  it("blocks OTP verification before touching Redis when signing config is missing", async () => {
    const result = await resolveSuperAdminVerifyOtpRequest(
      buildEnv({
        REDIS_URL: "redis://example.test:6379",
      }),
      { email: "admin@example.com", otp: "123456" },
      { ip: "127.0.0.1" },
    );

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({
      code: "AUTH_INFRA_UNAVAILABLE",
      message: "Custom auth token signing is not configured.",
      success: false,
    });
  });

  it("rejects phone OTP requests from unapproved origins before touching Redis", async () => {
    const result = await resolveSendOtpRequest(
      buildEnv({
        APP_ENV: "production",
      }),
      { phone: "+919876543210" },
      {
        ip: "127.0.0.1",
        origin: "https://evil.example",
      },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({
      code: "ORIGIN_NOT_ALLOWED",
      message: "This request origin is not allowed.",
      success: false,
    });
  });
});
