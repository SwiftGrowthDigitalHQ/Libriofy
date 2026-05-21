// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability/alertService.server", () => ({
  sendAdminAlert: vi.fn(),
}));

vi.mock("@/lib/observability/eventLogger.server", () => ({
  logEvent: vi.fn(),
}));

vi.mock("@/lib/observability/serverMonitoring", () => ({
  captureServerError: vi.fn(),
}));

vi.mock("@/lib/observability/store.server", () => ({
  listRecentObservabilitySignals: vi.fn().mockResolvedValue({
    recentCriticalErrors: [],
    systemWarnings: [],
  }),
}));

import { getCriticalDatabaseHealth } from "@/lib/observability/databaseHealth.server";

const buildSupabaseJwt = (projectRef: string, role: "anon" | "service_role") => {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iat: 1, iss: "supabase", ref: projectRef, role }),
    "signature",
  ].join(".");
};

const buildEnv = (overrides: Record<string, string | undefined> = {}) => ({
  SUPABASE_SERVICE_ROLE_KEY: buildSupabaseJwt("libriofy", "service_role"),
  SUPABASE_URL: "https://libriofy.supabase.co",
  ...overrides,
});

const healthyEntities = [
  { entity_name: "recovery_queue", exists_in_schema: true, relation_name: "public.recovery_queue" },
  { entity_name: "payments", exists_in_schema: true, relation_name: "public.payments" },
  { entity_name: "students", exists_in_schema: true, relation_name: "public.students" },
];

const healthyAuthContracts = [
  {
    check_name: "table:auth_trusted_devices",
    detail: "public.auth_trusted_devices is present.",
    ok: true,
  },
  {
    check_name: "table:login_logs",
    detail: "public.login_logs is present.",
    ok: true,
  },
  {
    check_name: "function:find_super_admin_by_email(text)",
    detail: "public.find_super_admin_by_email(text) is present.",
    ok: true,
  },
];

describe("database health runtime contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports healthy schema and auth runtime contracts when both RPCs pass", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/rpc/get_schema_entity_status")) {
          return new Response(JSON.stringify(healthyEntities), { status: 200 });
        }

        if (url.includes("/rpc/get_auth_runtime_status")) {
          return new Response(JSON.stringify(healthyAuthContracts), { status: 200 });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      }),
    );

    const result = await getCriticalDatabaseHealth(buildEnv(), {
      forceRefresh: true,
      phase: "database_health_test_ok",
    });

    expect(result.status).toBe("ok");
    expect(result.connectivity).toBe("pass");
    expect(result.detail).toBe("Critical database schema and auth runtime contracts verified.");
    expect(result.missing_entities).toEqual([]);
    expect(result.missing_contracts).toEqual([]);
    expect(result.auth_runtime_failure_category).toBeNull();
    expect(result.auth_runtime_checks).toEqual(healthyAuthContracts);
  });

  it("degrades readiness when auth runtime schema contracts are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/rpc/get_schema_entity_status")) {
          return new Response(JSON.stringify(healthyEntities), { status: 200 });
        }

        if (url.includes("/rpc/get_auth_runtime_status")) {
          return new Response(
            JSON.stringify([
              ...healthyAuthContracts,
              {
                check_name: "column:auth_trusted_devices.auth_level",
                detail: "public.auth_trusted_devices.auth_level is missing.",
                ok: false,
              },
            ]),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      }),
    );

    const result = await getCriticalDatabaseHealth(buildEnv(), {
      forceRefresh: true,
      phase: "database_health_test_contract_drift",
    });

    expect(result.status).toBe("degraded");
    expect(result.connectivity).toBe("pass");
    expect(result.missing_entities).toEqual([]);
    expect(result.missing_contracts).toEqual(["column:auth_trusted_devices.auth_level"]);
    expect(result.auth_runtime_failure_category).toBe("AUTH_SCHEMA_FAILURE");
    expect(result.detail).toContain("Missing auth runtime contracts: column:auth_trusted_devices.auth_level.");
  });

  it("fails cleanly when the auth runtime health RPC is not deployed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/rpc/get_schema_entity_status")) {
          return new Response(JSON.stringify(healthyEntities), { status: 200 });
        }

        if (url.includes("/rpc/get_auth_runtime_status")) {
          return new Response(
            JSON.stringify({
              code: "PGRST202",
              message: "Could not find the function public.get_auth_runtime_status() in the schema cache",
            }),
            { status: 404 },
          );
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      }),
    );

    const result = await getCriticalDatabaseHealth(buildEnv(), {
      forceRefresh: true,
      phase: "database_health_test_missing_rpc",
    });

    expect(result.status).toBe("failed");
    expect(result.connectivity).toBe("fail");
    expect(result.missing_entities).toEqual([]);
    expect(result.missing_contracts).toEqual([]);
    expect(result.auth_runtime_failure_category).toBe("AUTH_RPC_FAILURE");
    expect(result.detail).toContain("Auth runtime health RPC failed with status 404");
  });

  it("uses a matching Supabase URL and service role key when canonical runtime envs drift", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      expect(url.startsWith("https://new-project.supabase.co")).toBe(true);

      if (url.includes("/rpc/get_schema_entity_status")) {
        return new Response(JSON.stringify(healthyEntities), { status: 200 });
      }

      if (url.includes("/rpc/get_auth_runtime_status")) {
        return new Response(JSON.stringify(healthyAuthContracts), { status: 200 });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchSpy);

    const result = await getCriticalDatabaseHealth(
      buildEnv({
        SUPABASE_SERVICE_ROLE_KEY: buildSupabaseJwt("new-project", "service_role"),
        SUPABASE_URL: "https://old-project.supabase.co",
        VITE_SUPABASE_URL: "https://new-project.supabase.co",
      }),
      {
        forceRefresh: true,
        phase: "database_health_test_env_drift_recovery",
      },
    );

    expect(result.status).toBe("ok");
    expect(result.connectivity).toBe("pass");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("fails before issuing RPCs when the configured admin key is anon-scoped", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getCriticalDatabaseHealth(
      buildEnv({
        SUPABASE_SERVICE_ROLE_KEY: buildSupabaseJwt("libriofy", "anon"),
      }),
      {
        forceRefresh: true,
        phase: "database_health_test_anon_key_rejected",
      },
    );

    expect(result.status).toBe("failed");
    expect(result.connectivity).toBe("fail");
    expect(result.detail).toContain("anon or publishable key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
