import { afterEach, describe, expect, it, vi } from "vitest";

type MockApiRequest = {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
};

type MockApiResponse = {
  body: string;
  end: (body?: string) => void;
  setHeader: (name: string, value: string | string[]) => void;
  statusCode: number;
};

const createMockResponse = () => {
  const headers = new Map<string, string | string[]>();

  const response: MockApiResponse = {
    body: "",
    end(body?: string) {
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

const parseBody = (body: string) => JSON.parse(body) as Record<string, unknown>;

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createOtpAuthMock = (
  overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {},
) => ({
  resolveEmailLoginRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  resolveLogoutAllRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  resolveLogoutRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  resolveRefreshSessionRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  resolveSendOtpRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  resolveSuperAdminLoginRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  resolveSuperAdminVerifyOtpRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  resolveTwilioStatusCallbackRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  resolveVerifyOtpRequest: vi.fn().mockResolvedValue({ body: { success: true }, statusCode: 200 }),
  ...overrides,
});

const loadAuthApiRouteWithFailingLogger = async (
  otpAuthOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {},
) => {
  vi.resetModules();

  const logEvent = vi.fn().mockRejectedValue(new Error("observability unavailable"));
  vi.doMock("../lib/observability/eventLogger.server.js", () => ({
    logEvent,
  }));

  vi.doMock("../lib/authRuntimeIntegrity.server.js", () => ({
    warmAuthRuntimeIntegrity: vi.fn(),
  }));

  vi.doMock("../lib/otpAuth.server.js", () => createOtpAuthMock(otpAuthOverrides));

  const module = await import("../lib/authApiRoute.server.ts");
  return {
    handleAuthApiRequest: module.handleAuthApiRequest,
    logEvent,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("auth route observability safety", () => {
  it("keeps /api/auth/super-admin/login from crashing when auth fails and logging rejects", async () => {
    const { handleAuthApiRequest, logEvent } = await loadAuthApiRouteWithFailingLogger({
      resolveSuperAdminLoginRequest: vi.fn().mockRejectedValue(new Error("redis unavailable")),
    });
    const req: MockApiRequest = {
      body: { email: "admin@example.com" },
      method: "POST",
      url: "/api/auth/super-admin/login",
    };
    const { response } = createMockResponse();

    await expect(handleAuthApiRequest(req, response, {})).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(response.statusCode).toBe(503);
    expect(parseBody(response.body)).toMatchObject({
      code: "AUTH_ERROR",
      error: "Authentication service is temporarily unavailable.",
      message: "Authentication service is temporarily unavailable.",
      success: false,
    });
    expect(logEvent).toHaveBeenCalled();
  });

  it("keeps /api/auth/refresh from crashing when auth fails and logging rejects", async () => {
    const { handleAuthApiRequest, logEvent } = await loadAuthApiRouteWithFailingLogger({
      resolveRefreshSessionRequest: vi.fn().mockRejectedValue(new Error("session lookup failed")),
    });
    const req: MockApiRequest = {
      body: {},
      method: "POST",
      url: "/api/auth/refresh",
    };
    const { response } = createMockResponse();

    await expect(handleAuthApiRequest(req, response, {})).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(response.statusCode).toBe(503);
    expect(parseBody(response.body)).toMatchObject({
      code: "AUTH_REFRESH_ERROR",
      error: "Unable to refresh the session right now. Please sign in again.",
      message: "Unable to refresh the session right now. Please sign in again.",
      success: false,
    });
    expect(logEvent).toHaveBeenCalled();
  });
});

describe("email observability safety", () => {
  it("does not fail a successful email send when post-send logging rejects", async () => {
    vi.resetModules();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    const logEvent = vi.fn().mockRejectedValue(new Error("logger offline"));
    vi.doMock("../lib/observability/eventLogger.server.js", () => ({
      logEvent,
    }));

    const { sendEmail } = await import("../lib/email.server.ts");

    await expect(sendEmail({
      env: {
        RESEND_API_KEY: "resend-key",
      },
      from: "hello@libriofy.com",
      subject: "Your Libriofy OTP",
      text: "123456",
      to: ["admin@example.com"],
      user: "admin@example.com",
    })).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });
});
