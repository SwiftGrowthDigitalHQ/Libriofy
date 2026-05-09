import { afterEach, describe, expect, it, vi } from "vitest";

type MockAdminApiRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
};

type MockAdminApiResponse = {
  body: string | Uint8Array;
  end: (body?: string | Uint8Array) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

const createMockResponse = () => {
  const headers = new Map<string, string | string[]>();

  const response: MockAdminApiResponse = {
    body: "",
    end(body?: string | Uint8Array) {
      this.body = body ?? "";
    },
    setHeader(name: string, value: string | string[]) {
      headers.set(name, value);
    },
    statusCode: 0,
  };

  return {
    headers,
    response,
  };
};

const parseBody = (body: string | Uint8Array) =>
  JSON.parse(typeof body === "string" ? body : Buffer.from(body).toString("utf8")) as Record<string, unknown>;

const buildRequest = (overrides: Partial<MockAdminApiRequest> = {}): MockAdminApiRequest => ({
  headers: {
    "content-type": "application/json",
    "x-forwarded-for": "198.51.100.77",
  },
  method: "GET",
  url: "/api/admin/platform",
  ...overrides,
});

const buildControlCenterResponse = () => ({
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
  success: true as const,
});

const loadAdminApiRoute = async ({
  expire,
  incr,
  ttl,
}: {
  expire?: ReturnType<typeof vi.fn>;
  incr?: ReturnType<typeof vi.fn>;
  ttl?: ReturnType<typeof vi.fn>;
} = {}) => {
  vi.resetModules();

  const mockedGetControlCenterData = vi.fn().mockResolvedValue(buildControlCenterResponse());
  const mockedResolveSuperAdminOperatorAccessData = vi.fn().mockResolvedValue({
    allowedPages: ["dashboard"],
    legacyFallbackAccess: false,
    permissions: ["dashboard.read"],
    roles: ["read_only_ops"],
  });
  const redisState = {
    disconnect: vi.fn(),
    expire: expire ?? vi.fn().mockResolvedValue(1),
    incr: incr ?? vi.fn().mockResolvedValue(1),
    ttl: ttl ?? vi.fn().mockResolvedValue(60),
  };

  vi.doMock("@/lib/maintenanceGuard.server", () => ({
    buildMaintenanceApiError: vi.fn((requestId?: string | null) => ({
      success: false,
      ...(requestId ? { requestId } : {}),
    })),
    evaluateMaintenanceRequest: vi.fn().mockResolvedValue({
      allow: true,
      maintenanceMode: false,
      pathname: "/api/admin/platform",
      reason: "maintenance_disabled",
    }),
    readMaintenanceContextFromHeaders: vi.fn(({ pathname }) => ({ pathname })),
  }));

  vi.doMock("@/lib/otpAuth.server", () => ({
    resolveSuperAdminSessionRequest: vi.fn().mockResolvedValue({
      realUser: {
        email: "admin@libriofy.com",
        id: "super-admin-user",
        roles: ["super_admin"],
      },
      user: {
        email: "admin@libriofy.com",
        id: "super-admin-user",
        roles: ["super_admin"],
      },
    }),
  }));

  vi.doMock("@/lib/platformSettings.server", () => ({
    isSuperAdminIpAllowed: vi.fn().mockResolvedValue(true),
  }));

  vi.doMock("@/lib/superAdmin/service.server", () => ({
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
    getControlCenterData: mockedGetControlCenterData,
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
    resolveSuperAdminOperatorAccessData: mockedResolveSuperAdminOperatorAccessData,
    resolveIncidentData: vi.fn(),
    updateCommissionData: vi.fn(),
    updateFeatureFlagData: vi.fn(),
    updatePlatformSettingsData: vi.fn(),
    upsertPlanData: vi.fn(),
    upsertTemplateData: vi.fn(),
  }));

  vi.doMock("ioredis", () => ({
    default: class MockRedis {
      disconnect() {
        return redisState.disconnect();
      }

      expire(key: string, seconds: number) {
        return redisState.expire(key, seconds);
      }

      incr(key: string) {
        return redisState.incr(key);
      }

      ttl(key: string) {
        return redisState.ttl(key);
      }
    },
  }));

  const module = await import("@/lib/superAdmin/apiRoute.server");
  return {
    handleAdminApiRequest: module.handleAdminApiRequest,
    mocks: {
      getControlCenterData: mockedGetControlCenterData,
      redisState,
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("super admin API rate-limit resilience", () => {
  it("serves requests when Redis rate limiting times out", async () => {
    const { handleAdminApiRequest, mocks } = await loadAdminApiRoute({
      incr: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")),
    });
    const { response } = createMockResponse();

    await handleAdminApiRequest(
      buildRequest(),
      response,
      {
        REDIS_URL: "redis://example.test:6379",
      },
    );

    expect(response.statusCode).toBe(200);
    expect(parseBody(response.body)).toMatchObject({
      message: "Control center loaded.",
      success: true,
    });
    expect(mocks.getControlCenterData).toHaveBeenCalledTimes(1);
    expect(mocks.redisState.disconnect).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("falls back to memory rate limiting when Redis keeps failing", async () => {
    const { handleAdminApiRequest, mocks } = await loadAdminApiRoute({
      incr: vi.fn().mockRejectedValue(new Error("redis unavailable")),
    });
    let lastResponse = createMockResponse();

    for (let index = 0; index < 181; index += 1) {
      lastResponse = createMockResponse();
      await handleAdminApiRequest(
        buildRequest(),
        lastResponse.response,
        {
          REDIS_URL: "redis://example.test:6379",
        },
      );
    }

    expect(lastResponse.response.statusCode).toBe(429);
    expect(parseBody(lastResponse.response.body)).toMatchObject({
      errorCode: "RATE_LIMITED",
      message: "Too many admin requests. Please slow down.",
      success: false,
    });
    expect(lastResponse.headers.get("Retry-After")).toBeTruthy();
    expect(mocks.getControlCenterData).toHaveBeenCalledTimes(180);
  }, 15_000);
});
