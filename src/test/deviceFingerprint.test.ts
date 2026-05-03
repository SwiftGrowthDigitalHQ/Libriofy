import { afterEach, describe, expect, it } from "vitest";

import { getDeviceLabel } from "@/lib/deviceFingerprint";

const restoreNavigatorProperty = (key: "language" | "platform", value: string | undefined) => {
  Object.defineProperty(window.navigator, key, {
    configurable: true,
    value,
  });
};

describe("getDeviceLabel", () => {
  const originalPlatform = window.navigator.platform;
  const originalLanguage = window.navigator.language;

  afterEach(() => {
    restoreNavigatorProperty("platform", originalPlatform);
    restoreNavigatorProperty("language", originalLanguage);
  });

  it("falls back to Unknown Device when sanitized device label parts are empty", () => {
    restoreNavigatorProperty("platform", "\u2603");
    restoreNavigatorProperty("language", "\u00e9");

    expect(getDeviceLabel()).toBe("Unknown Device");
  });
});
