import { describe, expect, it } from "vitest";

import {
  buildOtpMessage,
  getEffectiveSessionUser,
  getRealSessionUser,
  isImpersonationSession,
  isVerifiedSuperAdminSession,
  normalizePhoneNumber,
} from "@/lib/auth.shared";

describe("normalizePhoneNumber", () => {
  it("normalizes local Indian numbers into E.164", () => {
    expect(normalizePhoneNumber("9876543210")).toBe("+919876543210");
  });

  it("preserves valid E.164 numbers", () => {
    expect(normalizePhoneNumber("+14155552671")).toBe("+14155552671");
  });
});

describe("buildOtpMessage", () => {
  it("keeps the required OTP sentence intact", () => {
    expect(buildOtpMessage("482931")).toBe("Libriofy OTP: 482931. Valid for 2 minutes. Do not share.");
  });

  it("adds the WebOTP footer when a host is provided", () => {
    expect(buildOtpMessage("482931", "login.libriofy.com")).toBe(
      "Libriofy OTP: 482931. Valid for 2 minutes. Do not share.\n\n@login.libriofy.com #482931",
    );
  });
});

describe("impersonation session helpers", () => {
  const effectiveUser = {
    email: "owner@libriofy.test",
    fullName: "Library Owner",
    id: "library-owner-1",
    phone: null,
    roles: ["library_owner"],
  };
  const realUser = {
    email: "super-admin@libriofy.test",
    fullName: "Super Admin",
    id: "super-admin-1",
    phone: null,
    roles: ["super_admin"],
  };

  it("treats impersonation sessions as verified super admin sessions for bypass checks", () => {
    const session = {
      accessToken: "token",
      authLevel: 2,
      effectiveUser,
      expiresAt: Math.floor(Date.now() / 1000) + 120,
      idleTimeoutSeconds: 600,
      impersonation: {
        effectiveUser,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        impersonationId: "impersonation-1",
        realUser,
        startedAt: new Date().toISOString(),
      },
      loginMethod: "email" as const,
      provider: "custom" as const,
      realUser,
      sessionScope: "impersonation" as const,
      trustedDevice: true,
      user: effectiveUser,
    };

    expect(isImpersonationSession(session)).toBe(true);
    expect(isVerifiedSuperAdminSession(session)).toBe(true);
    expect(getEffectiveSessionUser(session)).toEqual(effectiveUser);
    expect(getRealSessionUser(session)).toEqual(realUser);
  });

  it("does not mark regular sessions as impersonation", () => {
    const session = {
      accessToken: "token",
      authLevel: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 120,
      idleTimeoutSeconds: null,
      impersonation: null,
      loginMethod: "email" as const,
      provider: "custom" as const,
      realUser: null,
      sessionScope: "general" as const,
      trustedDevice: true,
      user: effectiveUser,
    };

    expect(isImpersonationSession(session)).toBe(false);
    expect(isVerifiedSuperAdminSession(session)).toBe(false);
    expect(getEffectiveSessionUser(session)).toEqual(effectiveUser);
    expect(getRealSessionUser(session)).toBeNull();
  });
});
