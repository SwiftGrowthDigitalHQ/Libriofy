import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/maintenanceRuntime.server", () => ({
  readSafeMaintenanceStatus: vi.fn(),
}));

vi.mock("@/lib/otpAuth.server", () => ({
  resolveSuperAdminSessionRequest: vi.fn(),
}));

import { isMaintenanceBypassApiPath, isMaintenanceBypassUiPath } from "@/lib/maintenanceAccess";
import { evaluateMaintenanceRequest } from "@/lib/maintenanceGuard.server";
import { readSafeMaintenanceStatus } from "@/lib/maintenanceRuntime.server";
import { resolveSuperAdminSessionRequest } from "@/lib/otpAuth.server";

const mockedReadSafeMaintenanceStatus = vi.mocked(readSafeMaintenanceStatus);
const mockedResolveSuperAdminSessionRequest = vi.mocked(resolveSuperAdminSessionRequest);

describe("maintenance access enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadSafeMaintenanceStatus.mockResolvedValue({
      maintenanceMode: true,
      source: "database",
      updatedAt: null,
    });
    mockedResolveSuperAdminSessionRequest.mockResolvedValue(null);
  });

  it("keeps only explicit control-plane and operational routes on the bypass allow-list", () => {
    expect(isMaintenanceBypassUiPath("/super-admin-login")).toBe(true);
    expect(isMaintenanceBypassUiPath("/admin/settings")).toBe(true);
    expect(isMaintenanceBypassApiPath("/api/admin/platform")).toBe(true);
    expect(isMaintenanceBypassApiPath("/api/auth/logout")).toBe(true);
    expect(isMaintenanceBypassApiPath("/api/auth/refresh")).toBe(false);
    expect(isMaintenanceBypassApiPath("/api/attendance/scan")).toBe(false);
  });

  it("allows a verified super admin session to refresh during maintenance", async () => {
    mockedResolveSuperAdminSessionRequest.mockResolvedValue({
      user: {
        id: "super-admin-user",
        roles: ["super_admin"],
      },
    } as never);

    const result = await evaluateMaintenanceRequest(
      {},
      {
        cookieHeader: "libriofy_refresh=token",
        ip: "203.0.113.10",
        pathname: "/api/auth/refresh",
        userAgent: "vitest",
      },
    );

    expect(result).toMatchObject({
      allow: true,
      maintenanceMode: true,
      pathname: "/api/auth/refresh",
      reason: "super_admin_session",
    });
  });

  it("blocks regular app routes during maintenance", async () => {
    const result = await evaluateMaintenanceRequest(
      {},
      {
        ip: "203.0.113.20",
        pathname: "/dashboard",
        userAgent: "vitest",
      },
    );

    expect(result).toMatchObject({
      allow: false,
      maintenanceMode: true,
      pathname: "/dashboard",
      reason: "maintenance_blocked",
    });
    expect(mockedResolveSuperAdminSessionRequest).toHaveBeenCalledTimes(1);
  });

  it("short-circuits when maintenance is disabled", async () => {
    mockedReadSafeMaintenanceStatus.mockResolvedValue({
      maintenanceMode: false,
      source: "database",
      updatedAt: null,
    });

    const result = await evaluateMaintenanceRequest(
      {},
      {
        pathname: "/dashboard",
      },
    );

    expect(result).toMatchObject({
      allow: true,
      maintenanceMode: false,
      pathname: "/dashboard",
      reason: "maintenance_disabled",
    });
    expect(mockedResolveSuperAdminSessionRequest).not.toHaveBeenCalled();
  });
});
