// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthRuntimeHealthMock = vi.fn();

vi.mock("@/lib/observability/databaseHealth.server", () => ({
  getAuthRuntimeHealth: (...args: unknown[]) => getAuthRuntimeHealthMock(...args),
}));

import {
  clearAuthRuntimeIntegrityCacheForTest,
  getAuthRuntimeIntegrity,
} from "@/lib/authRuntimeIntegrity.server";

const buildSupabaseJwt = (projectRef: string, role: "anon" | "service_role") => {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iat: 1, iss: "supabase", ref: projectRef, role }),
    "signature",
  ].join(".");
};

const buildEnv = (overrides: Record<string, string | undefined> = {}) => ({
  APP_ENV: "test",
  APP_URL: "https://www.libriofy.com",
  AUTH_EMAIL_FROM: "hello@libriofy.com",
  REDIS_URL: "redis://example.test:6379",
  RESEND_API_KEY: "resend-key",
  SUPABASE_JWT_SECRET: "jwt-secret",
  ...overrides,
});

describe("auth runtime integrity Supabase admin config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthRuntimeIntegrityCacheForTest();
    getAuthRuntimeHealthMock.mockResolvedValue({
      checked_at: "2026-05-21T00:00:00.000Z",
      checks: [],
      connectivity: "pass",
      detail: "Auth runtime contracts verified.",
      missing_contracts: [],
      service: "supabase-database-health",
      source: "live",
      status: "ok",
    });
  });

  it("accepts a valid VITE-only Supabase admin pair for super-admin login", async () => {
    const report = await getAuthRuntimeIntegrity(
      buildEnv({
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        SUPABASE_URL: undefined,
        VITE_SUPABASE_SERVICE_ROLE_KEY: buildSupabaseJwt("new-project", "service_role"),
        VITE_SUPABASE_URL: "https://new-project.supabase.co",
      }),
      {
        flow: "super_admin_login",
        forceRefresh: true,
      },
    );

    expect(report.status).toBe("ok");
    expect(report.failedCodes).toEqual([]);
    expect(report.checks.find((check) => check.name === "supabase_url")?.status).toBe("pass");
    expect(report.checks.find((check) => check.name === "supabase_service_role_key")?.status).toBe("pass");
  });

  it("accepts a matching fallback Supabase URL when the canonical URL is stale", async () => {
    const report = await getAuthRuntimeIntegrity(
      buildEnv({
        SUPABASE_SERVICE_ROLE_KEY: buildSupabaseJwt("new-project", "service_role"),
        SUPABASE_URL: "https://old-project.supabase.co",
        VITE_SUPABASE_URL: "https://new-project.supabase.co",
      }),
      {
        flow: "super_admin_login",
        forceRefresh: true,
      },
    );

    expect(report.status).toBe("ok");
    expect(report.failedCodes).toEqual([]);
  });

  it("fails cleanly when the resolved admin key is anon-scoped", async () => {
    const report = await getAuthRuntimeIntegrity(
      buildEnv({
        SUPABASE_SERVICE_ROLE_KEY: buildSupabaseJwt("new-project", "anon"),
        SUPABASE_URL: "https://new-project.supabase.co",
      }),
      {
        flow: "super_admin_login",
        forceRefresh: true,
      },
    );

    expect(report.status).toBe("failed");
    expect(report.primaryCode).toBe("AUTH_RUNTIME_FAILURE");
    expect(report.detail).toContain("anon or publishable key");
    expect(report.checks.find((check) => check.name === "supabase_service_role_key")?.status).toBe("fail");
  });
});
