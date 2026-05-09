import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/maintenanceGuard.server", () => ({
  buildMaintenanceApiError: vi.fn((requestId?: string | null) => ({
    success: false,
    code: "MAINTENANCE_MODE",
    error: "Libriofy is temporarily in maintenance mode.",
    message: "Libriofy is temporarily in maintenance mode.",
    ...(requestId ? { requestId } : {}),
  })),
  evaluateMaintenanceRequest: vi.fn(),
  readMaintenanceContextFromHeaders: vi.fn(({ pathname }) => ({ pathname })),
}));

vi.mock("@/lib/otpAuth.server", () => ({
  resolveSuperAdminSessionRequest: vi.fn(),
}));

vi.mock("@/lib/platformSettings.server", () => ({
  isSuperAdminIpAllowed: vi.fn(),
}));

vi.mock("@/lib/superAdmin/service.server", () => ({
  createBroadcastData: vi.fn(),
  createImpersonationData: vi.fn(),
  createInvoiceData: vi.fn(),
  createRefundData: vi.fn(),
  createRevenueAdjustmentData: vi.fn(),
  deletePlanData: vi.fn(),
  deleteTemplateData: vi.fn(),
  getAutomationCenterData: vi.fn(),
  getBillingCenterData: vi.fn(),
  getCommunicationCenterData: vi.fn(),
  getControlCenterData: vi.fn(),
  getIncidentCenterData: vi.fn(),
  getLibraryCenterData: vi.fn(),
  getPlatformSettingsData: vi.fn(),
  getRevenueCenterData: vi.fn(),
  getSecurityCenterData: vi.fn(),
  handleJobActionData: vi.fn(),
  manageOperatorRoleGrantData: vi.fn(),
  performLibraryActionData: vi.fn(),
  performUserActionData: vi.fn(),
  reviewGovernanceRequestData: vi.fn(),
  resolveSuperAdminOperatorAccessData: vi.fn(),
  resolveIncidentData: vi.fn(),
  updateCommissionData: vi.fn(),
  updateFeatureFlagData: vi.fn(),
  updatePlatformSettingsData: vi.fn(),
  upsertPlanData: vi.fn(),
  upsertTemplateData: vi.fn(),
}));

import {
  handleAdminApiRequest,
  isSupportedAdminApiPath,
  type AdminApiRequest,
  type AdminApiResponse,
} from "@/lib/superAdmin/apiRoute.server";
import { evaluateMaintenanceRequest } from "@/lib/maintenanceGuard.server";
import { resolveSuperAdminSessionRequest } from "@/lib/otpAuth.server";
import { isSuperAdminIpAllowed } from "@/lib/platformSettings.server";
import {
  getControlCenterData,
  resolveSuperAdminOperatorAccessData,
} from "@/lib/superAdmin/service.server";

const mockedEvaluateMaintenanceRequest = vi.mocked(evaluateMaintenanceRequest);
const mockedResolveSuperAdminSessionRequest = vi.mocked(resolveSuperAdminSessionRequest);
const mockedIsSuperAdminIpAllowed = vi.mocked(isSuperAdminIpAllowed);
const mockedGetControlCenterData = vi.mocked(getControlCenterData);
const mockedResolveSuperAdminOperatorAccessData = vi.mocked(resolveSuperAdminOperatorAccessData);

const createMockResponse = () => {
  const headers = new Map<string, string | string[]>();

  const response = {
    body: "" as string | Uint8Array,
    end(body?: string | Uint8Array) {
      this.body = body ?? "";
    },
    setHeader(name: string, value: string | string[]) {
      headers.set(name, value);
    },
    statusCode: 0,
  } satisfies AdminApiResponse & { body: string | Uint8Array };

  return {
    headers,
    response,
  };
};

const parseBody = (body: string | Uint8Array) =>
  JSON.parse(typeof body === "string" ? body : Buffer.from(body).toString("utf8")) as Record<string, unknown>;

const buildRequest = (
  overrides: Partial<AdminApiRequest> = {},
  forwardedFor = "198.51.100.10",
): AdminApiRequest => ({
  body: undefined,
  headers: {
    "content-type": "application/json",
    "x-forwarded-for": forwardedFor,
  },
  method: "GET",
  url: "/api/admin/platform",
  ...overrides,
});

describe("centralized super admin API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedEvaluateMaintenanceRequest.mockResolvedValue({
      allow: true,
      maintenanceMode: false,
      pathname: "/api/admin/platform",
      reason: "maintenance_disabled",
    });
    mockedResolveSuperAdminSessionRequest.mockImplementation(async (_env, context) => ({
      realUser: {
        email: "admin@libriofy.com",
        id: context.ip || "super-admin-user",
        roles: ["super_admin"],
      },
      user: {
        email: "admin@libriofy.com",
        id: context.ip || "super-admin-user",
        roles: ["super_admin"],
      },
    }) as never);
    mockedIsSuperAdminIpAllowed.mockResolvedValue(true);
    mockedGetControlCenterData.mockResolvedValue({
      data: {
        analytics: {
          activeStudentsToday: 0,
          conversionRate: 0,
          dailyActiveLibraries: 0,
          revenueByCity: [],
          revenuePreviousMonth: 0,
          revenueThisMonth: 0,
          series: [],
        },
        automation: {
          failedJobs: 0,
          inactiveLibraries: [],
          queuedJobs: 0,
        },
        featureFlags: [],
        generatedAt: new Date().toISOString(),
        incidents: [],
        libraries: [],
        maintenanceMode: false,
        security: {
          failedLoginAttempts24h: 0,
          ipWhitelistEnabled: false,
          suspiciousIps: [],
          whitelist: [],
        },
        settings: [],
        statusSignals: [],
        systemStatus: "green",
      },
      errorCode: null,
      message: "Control center loaded.",
      success: true,
    });
    mockedResolveSuperAdminOperatorAccessData.mockResolvedValue({
      allowedPages: ["dashboard"],
      legacyFallbackAccess: false,
      permissions: ["dashboard.read"],
      roles: ["read_only_ops"],
    });
  });

  it("supports only the centralized admin API surface", () => {
    expect(isSupportedAdminApiPath("/api/admin/platform")).toBe(true);
    expect(isSupportedAdminApiPath("/api/admin/feature-flags")).toBe(true);
    expect(isSupportedAdminApiPath("/api/admin/settings")).toBe(false);
  });

  it("requires a verified super admin session", async () => {
    mockedResolveSuperAdminSessionRequest.mockResolvedValue(null);
    const { headers, response } = createMockResponse();

    await handleAdminApiRequest(buildRequest(), response, {});

    expect(response.statusCode).toBe(401);
    expect(parseBody(response.body)).toMatchObject({
      errorCode: "UNAUTHORIZED",
      message: "Super admin verification is required.",
      success: false,
    });
    expect(headers.get("x-request-id")).toBeTruthy();
    expect(headers.get("x-correlation-id")).toBeTruthy();
    expect(headers.get("x-trace-id")).toBeTruthy();
  });

  it("enforces the super admin IP whitelist before serving data", async () => {
    mockedIsSuperAdminIpAllowed.mockResolvedValue(false);
    const { response } = createMockResponse();

    await handleAdminApiRequest(buildRequest(), response, {});

    expect(response.statusCode).toBe(403);
    expect(parseBody(response.body)).toMatchObject({
      errorCode: "IP_NOT_ALLOWED",
      message: "Your IP address is not allowed for super admin access.",
      success: false,
    });
  });

  it("blocks control-plane APIs while an impersonation session is active", async () => {
    mockedResolveSuperAdminSessionRequest.mockResolvedValue({
      impersonation: {
        effectiveUser: {
          email: "owner@libriofy.com",
          id: "owner-1",
          roles: ["library_owner"],
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        impersonationId: "imp-1",
        realUser: {
          email: "admin@libriofy.com",
          id: "super-admin-user",
          roles: ["super_admin"],
        },
        startedAt: new Date().toISOString(),
      },
      realUser: {
        email: "admin@libriofy.com",
        id: "super-admin-user",
        roles: ["super_admin"],
      },
      user: {
        email: "owner@libriofy.com",
        id: "owner-1",
        roles: ["library_owner"],
      },
    } as never);
    const { response } = createMockResponse();

    await handleAdminApiRequest(buildRequest(), response, {});

    expect(response.statusCode).toBe(403);
    expect(parseBody(response.body)).toMatchObject({
      errorCode: "IMPERSONATION_BOUNDARY",
      message: "Stop impersonation before accessing control-plane APIs.",
      success: false,
    });
  });

  it("validates admin mutation bodies with the shared contract", async () => {
    const { response } = createMockResponse();

    await handleAdminApiRequest(buildRequest({
      body: {
        settings: "invalid",
      },
      method: "POST",
    }), response, {});

    expect(response.statusCode).toBe(400);
    expect(parseBody(response.body)).toMatchObject({
      errorCode: "INVALID_REQUEST",
      message: "Invalid request body.",
      success: false,
    });
  });

  it("rate limits repeated requests through the shared control-plane guard", async () => {
    let lastResponse: ReturnType<typeof createMockResponse> | null = null;

    for (let index = 0; index < 181; index += 1) {
      lastResponse = createMockResponse();
      await handleAdminApiRequest(buildRequest({}, "198.51.100.61"), lastResponse.response, {});
    }

    expect(lastResponse?.response.statusCode).toBe(429);
    expect(parseBody(lastResponse?.response.body ?? "")).toMatchObject({
      errorCode: "RATE_LIMITED",
      message: "Too many admin requests. Please slow down.",
      success: false,
    });
  });
});
