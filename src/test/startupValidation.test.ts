import { describe, expect, it } from "vitest";

import { validateServerStartupEnv } from "@/lib/observability/startupValidation";

describe("validateServerStartupEnv", () => {
  it("surfaces the auth requirements needed for Super Admin login", () => {
    const result = validateServerStartupEnv({
      APP_ENV: "test",
      APP_URL: "https://www.libriofy.com",
      STUDENT_QR_PRIVATE_KEY: "qr-private-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://example.supabase.co",
    } as NodeJS.ProcessEnv);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("REDIS_URL");
    expect(result.missing).toContain("SUPABASE_JWT_SECRET|JWT_SECRET|APP_JWT_SECRET");
    expect(result.missing).toContain("RESEND_API_KEY+AUTH_EMAIL_FROM=hello@libriofy.com");
  });
});
