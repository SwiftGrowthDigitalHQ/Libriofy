import { describe, expect, it } from "vitest";

import {
  LIBRIOFY_AUTH_EMAIL_FROM,
  LIBRIOFY_PUBLIC_APP_URL,
  isAllowedLibriofyRequestHost,
  isAllowedLibriofyRequestOrigin,
  isLibriofyAppUrl,
  isLibriofyAuthEmail,
  resolveLibriofyAppUrl,
  resolveLibriofyEmailFrom,
} from "@/lib/libriofyConfig";

describe("libriofyConfig", () => {
  it("accepts only the canonical Libriofy app domain for auth redirects", () => {
    expect(isLibriofyAppUrl("https://www.libriofy.com")).toBe(true);
    expect(isLibriofyAppUrl("https://libriofy.com")).toBe(true);
    expect(isLibriofyAppUrl("https://preview.invalid")).toBe(false);
    expect(resolveLibriofyAppUrl("https://preview.invalid")).toBe(LIBRIOFY_PUBLIC_APP_URL);
  });

  it("normalizes the only allowed sender to the canonical Resend from header", () => {
    expect(isLibriofyAuthEmail("hello@libriofy.com")).toBe(true);
    expect(isLibriofyAuthEmail("Libriofy <hello@libriofy.com>")).toBe(true);
    expect(isLibriofyAuthEmail("security@example.com")).toBe(false);
    expect(resolveLibriofyEmailFrom("hello@libriofy.com")).toBe(LIBRIOFY_AUTH_EMAIL_FROM);
    expect(resolveLibriofyEmailFrom("security@example.com")).toBe("");
  });

  it("accepts only approved request origins and local hosts when explicitly allowed", () => {
    expect(isAllowedLibriofyRequestOrigin("https://www.libriofy.com/login")).toBe(true);
    expect(isAllowedLibriofyRequestOrigin("https://evil.example")).toBe(false);
    expect(isAllowedLibriofyRequestOrigin("http://localhost:5173", { allowLocalhost: true })).toBe(true);
    expect(isAllowedLibriofyRequestHost("www.libriofy.com")).toBe(true);
    expect(isAllowedLibriofyRequestHost("localhost:3000", { allowLocalhost: true })).toBe(true);
    expect(isAllowedLibriofyRequestHost("evil.example")).toBe(false);
  });
});
