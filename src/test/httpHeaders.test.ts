import { describe, expect, it } from "vitest";

import {
  buildBearerAuthorizationHeader,
  sanitizeHeaders,
  sanitizeUserHeaderValue,
  validateSystemHeaderValue,
} from "@/lib/httpHeaders";

describe("httpHeaders", () => {
  it("sanitizes user-generated header values instead of throwing", () => {
    expect(sanitizeUserHeaderValue("  Caf\u00e9\tDevice\n  ")).toBe("Caf Device");
  });

  it("throws when a strict system header contains non-ASCII characters", () => {
    expect(() => validateSystemHeaderValue("Caf\u00e9")).toThrow("ASCII");
  });

  it("throws when a strict system header contains control characters", () => {
    expect(() => validateSystemHeaderValue("line1\nline2")).toThrow("ASCII");
  });

  it("rejects headers outside the provided allow-list", () => {
    expect(() =>
      sanitizeHeaders(
        {
          Authorization: "Bearer resend-key",
          "X-Api-Key": "secret",
        },
        {
          allowedHeaders: ["Authorization"],
        },
      ),
    ).toThrow("not allowed");
  });

  it("sanitizes only the headers explicitly marked as user-generated", () => {
    expect(
      sanitizeHeaders(
        {
          Authorization: "Bearer resend-key",
          "x-device-label": "  Libriofy\tTabl\u00e9t\n ",
        },
        {
          allowedHeaders: ["Authorization", "x-device-label"],
          valueModes: {
            "x-device-label": "sanitize",
          },
        },
      ),
    ).toEqual({
      Authorization: "Bearer resend-key",
      "x-device-label": "Libriofy Tabl t",
    });
  });

  it("builds bearer authorization headers from validated tokens", () => {
    expect(buildBearerAuthorizationHeader(" resend-key ", "Missing token.")).toBe("Bearer resend-key");
  });
});
