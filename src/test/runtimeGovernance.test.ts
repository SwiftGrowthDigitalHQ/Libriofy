// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/maintenanceRuntime.server", () => ({
  readSafeMaintenanceStatus: vi.fn(),
}));

vi.mock("@/lib/observability/databaseHealth.server", () => ({
  getCriticalDatabaseHealth: vi.fn(),
}));

import { readSafeMaintenanceStatus } from "@/lib/maintenanceRuntime.server";
import { getCriticalDatabaseHealth } from "@/lib/observability/databaseHealth.server";
import {
  buildRuntimeReadinessReport,
  validateRuntimeConfiguration,
} from "@/lib/observability/runtimeGovernance.server";

const mockedReadSafeMaintenanceStatus = vi.mocked(readSafeMaintenanceStatus);
const mockedGetCriticalDatabaseHealth = vi.mocked(getCriticalDatabaseHealth);

const buildEnv = (overrides: Record<string, string | undefined> = {}) => ({
  APP_ENV: "production",
  APP_URL: "https://www.libriofy.com",
  AUTH_EMAIL_FROM: "hello@libriofy.com",
  REDIS_URL: "redis://runtime.test:6379",
  RELEASE_SHA: "release-2026-05-09",
  RESEND_API_KEY: "resend-key",
  SITE_URL: "https://www.libriofy.com",
  STUDENT_QR_PRIVATE_KEY: "qr-private-key",
  SUPABASE_JWT_SECRET: "jwt-secret",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_URL: "https://libriofy.supabase.co",
  SENTRY_RELEASE: "release-2026-05-09",
  ...overrides,
});

const healthyDatabase = {
  auth_runtime_checks: [],
  checked_at: "2026-05-09T00:00:00.000Z",
  connectivity: "pass" as const,
  detail: "Critical database schema and auth runtime contracts verified.",
  entities: [],
  missing: [],
  missing_contracts: [],
  missing_entities: [],
  recent_critical_errors: [],
  service: "supabase-database-health",
  source: "live" as const,
  status: "ok" as const,
  system_warnings: [],
};

describe("runtime governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadSafeMaintenanceStatus.mockResolvedValue({
      maintenance: false,
      maintenanceMode: false,
      source: "database",
      updatedAt: "2026-05-09T00:00:00.000Z",
    });
    mockedGetCriticalDatabaseHealth.mockResolvedValue(healthyDatabase);
  });

  it("keeps core runtime requirements consistent between express and serverless targets", () => {
    const expressConfig = validateRuntimeConfiguration(buildEnv(), {
      hasDist: true,
      target: "express",
    });
    const serverlessConfig = validateRuntimeConfiguration(buildEnv(), {
      target: "serverless",
    });

    const normalizeChecks = (checks: typeof expressConfig.checks) =>
      Object.fromEntries(
        checks
          .filter((check) => check.name !== "frontend_bundle")
          .map((check) => [check.name, check.status]),
      );

    expect(expressConfig.ok).toBe(true);
    expect(serverlessConfig.ok).toBe(true);
    expect(normalizeChecks(expressConfig.checks)).toEqual(normalizeChecks(serverlessConfig.checks));
  });

  it("detects deployment drift and client-secret exposure warnings", () => {
    const result = validateRuntimeConfiguration(
      buildEnv({
        APP_URL: "https://www.libriofy.com",
        PUBLIC_APP_URL: "https://www.libriofy.com/app",
        RELEASE_SHA: "release-a",
        SENTRY_RELEASE: "release-b",
        VITE_SUPABASE_SERVICE_ROLE_KEY: "unsafe-client-secret",
      }),
      {
        hasDist: true,
        target: "express",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.driftWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Public app URL drift detected"),
        expect.stringContaining("Release lineage drift detected"),
        expect.stringContaining("VITE_SUPABASE_SERVICE_ROLE_KEY"),
      ]),
    );
    expect(result.checks.find((check) => check.name === "config_drift")?.status).toBe("warn");
  });

  it("surfaces degraded startup when maintenance falls back safely", async () => {
    mockedReadSafeMaintenanceStatus.mockResolvedValue({
      maintenance: false,
      maintenanceMode: false,
      source: "fallback",
      updatedAt: null,
    });

    const report = await buildRuntimeReadinessReport(buildEnv(), {
      hasDist: true,
      phase: "test_degraded_startup",
      service: "libriofy-auth-attendance-api",
      startedAt: Date.now() - 5_000,
      target: "express",
    });

    expect(report.ok).toBe(true);
    expect(report.status).toBe("degraded");
    expect(report.degraded.active).toBe(true);
    expect(report.checks.find((check) => check.name === "maintenance_source")?.status).toBe("warn");
    expect(report.contracts.find((contract) => contract.name === "maintenance")?.status).toBe("degraded");
  });

  it("fails readiness when auth runtime contracts drift in the database layer", async () => {
    mockedGetCriticalDatabaseHealth.mockResolvedValue({
      ...healthyDatabase,
      detail: "Missing auth runtime contracts: column:auth_trusted_devices.auth_level.",
      missing_contracts: ["column:auth_trusted_devices.auth_level"],
      status: "degraded",
    });

    const report = await buildRuntimeReadinessReport(buildEnv(), {
      hasDist: true,
      phase: "test_auth_runtime_contract_drift",
      service: "libriofy-auth-attendance-api",
      startedAt: Date.now() - 5_000,
      target: "express",
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("failed");
    expect(report.checks.find((check) => check.name === "critical_database_schema")?.detail).toContain(
      "Missing auth runtime contracts: column:auth_trusted_devices.auth_level.",
    );
    expect(report.contracts.find((contract) => contract.name === "governance")?.status).toBe("failed");
  });

  it("keeps readiness semantics aligned between express and serverless runtimes", async () => {
    const expressReport = await buildRuntimeReadinessReport(buildEnv(), {
      hasDist: true,
      phase: "test_express_ready",
      service: "libriofy-auth-attendance-api",
      startedAt: Date.now() - 5_000,
      target: "express",
    });

    const serverlessReport = await buildRuntimeReadinessReport(buildEnv(), {
      phase: "test_serverless_ready",
      service: "libriofy-vercel-api",
      startedAt: Date.now() - 5_000,
      target: "serverless",
    });

    const normalizeChecks = (checks: typeof expressReport.checks) =>
      Object.fromEntries(
        checks
          .filter((check) => check.name !== "frontend_bundle")
          .map((check) => [check.name, check.status]),
      );

    expect(expressReport.ok).toBe(true);
    expect(serverlessReport.ok).toBe(true);
    expect(normalizeChecks(expressReport.checks)).toEqual(normalizeChecks(serverlessReport.checks));
    expect(expressReport.capabilities.find((capability) => capability.name === "background_workers")?.mode).toBe("native");
    expect(serverlessReport.capabilities.find((capability) => capability.name === "background_workers")?.mode).toBe("delegated");
  });

  it("blocks queue worker validation inside serverless runtimes", () => {
    const result = validateRuntimeConfiguration(
      buildEnv({
        VERCEL: "1",
      }),
      {
        target: "queue_worker",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("QUEUE_WORKER_RUNTIME=node_process");
    expect(result.checks.find((check) => check.name === "queue_worker_runtime")?.status).toBe("fail");
  });
});
