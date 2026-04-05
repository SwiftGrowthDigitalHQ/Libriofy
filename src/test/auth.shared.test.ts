import { describe, expect, it } from "vitest";

import { buildOtpMessage, normalizePhoneNumber } from "@/lib/auth.shared";

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
