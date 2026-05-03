import { describe, expect, it } from "vitest";

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
