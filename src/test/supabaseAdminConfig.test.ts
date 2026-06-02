// @vitest-environment node

import { describe, expect, it } from "vitest";

import { resolveSupabaseAdminConfig } from "@/lib/observability/supabaseAdminConfig.server";

const buildSupabaseJwt = (projectRef: string, role: "anon" | "service_role") => {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ iat: 1, iss: "supabase", ref: projectRef, role }),
    "signature",
  ].join(".");
};

describe("resolveSupabaseAdminConfig", () => {
  it("returns the matching env names when the canonical URL is stale", () => {
    const result = resolveSupabaseAdminConfig({
      SUPABASE_SERVICE_ROLE_KEY: buildSupabaseJwt("new-project", "service_role"),
      SUPABASE_URL: "https://old-project.supabase.co",
      VITE_SUPABASE_URL: "https://new-project.supabase.co",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.supabaseUrl).toBe("https://new-project.supabase.co");
    expect(result.config.supabaseUrlEnvName).toBe("VITE_SUPABASE_URL");
    expect(result.config.serviceRoleKeyEnvName).toBe("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("rejects anon-scoped admin keys before any Supabase query runs", () => {
    const result = resolveSupabaseAdminConfig({
      SUPABASE_SERVICE_ROLE_KEY: buildSupabaseJwt("new-project", "anon"),
      SUPABASE_URL: "https://new-project.supabase.co",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.detail).toContain("anon or publishable key");
  });
});
