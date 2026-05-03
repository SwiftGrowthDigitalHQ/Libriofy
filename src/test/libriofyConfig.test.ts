import { describe, expect, it } from "vitest";

import {
  LIBRIOFY_AUTH_EMAIL_FROM,
  LIBRIOFY_PUBLIC_APP_URL,
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
});
