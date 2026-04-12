import { describe, expect, it } from "vitest";

import { normalizeCameraStartupError } from "./cameraStartup";

describe("normalizeCameraStartupError", () => {
  const context = {
    isSecureContext: true,
    supportsMediaDevices: true,
  };

  it("maps html5-qrcode permission strings to permission_denied", () => {
    const result = normalizeCameraStartupError(
      "Error getting userMedia, error = NotAllowedError: Permission denied",
      context,
    );

    expect(result.kind).toBe("permission_denied");
    expect(result.title).toBe("Camera permission denied");
    expect(result.retryable).toBe(false);
  });

  it("maps html5-qrcode busy-camera strings to camera_busy", () => {
    const result = normalizeCameraStartupError(
      "Error getting userMedia, error = NotReadableError: Could not start video source",
      context,
    );

    expect(result.kind).toBe("camera_busy");
    expect(result.title).toBe("Camera already in use");
    expect(result.retryable).toBe(true);
  });

  it("maps constraint failures to constraint_failed", () => {
    const result = normalizeCameraStartupError(
      "Error getting userMedia, error = OverconstrainedError: Cannot satisfy constraints",
      context,
    );

    expect(result.kind).toBe("constraint_failed");
    expect(result.retryable).toBe(true);
  });

  it("uses secure-context failure before inspecting the error", () => {
    const result = normalizeCameraStartupError("NotAllowedError: Permission denied", {
      isSecureContext: false,
      supportsMediaDevices: true,
    });

    expect(result.kind).toBe("insecure_context");
    expect(result.retryable).toBe(false);
  });
});
