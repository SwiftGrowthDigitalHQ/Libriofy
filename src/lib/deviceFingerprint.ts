import { getUserHeaderSanitizationInfo } from "./httpHeaders.js";
import { logInternalWarning } from "./observability/internalLogger.js";

const textEncoder = new TextEncoder();

let fingerprintPromise: Promise<string> | null = null;
const reportedDeviceLabelSanitizations = new Set<string>();

const digestToHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const readDeviceSource = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "server";
  }

  const screenDetails =
    typeof window.screen === "undefined"
      ? "unknown-screen"
      : `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`;

  const timezone =
    typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function"
      ? "unknown-timezone"
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown-timezone";

  return [
    navigator.userAgent || "unknown-ua",
    navigator.language || "unknown-language",
    navigator.platform || "unknown-platform",
    String(navigator.hardwareConcurrency || 0),
    String((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0),
    timezone,
    screenDetails,
  ].join("|");
};

export const getDeviceFingerprint = () => {
  if (!fingerprintPromise) {
    if (!globalThis.crypto?.subtle) {
      fingerprintPromise = Promise.resolve("fallback-device-fingerprint");
      return fingerprintPromise;
    }

    fingerprintPromise = globalThis.crypto.subtle
      .digest("SHA-256", textEncoder.encode(readDeviceSource()))
      .then(digestToHex)
      .catch(() => "fallback-device-fingerprint");
  }

  return fingerprintPromise;
};

export const getDeviceLabel = () => {
  if (typeof navigator === "undefined") {
    return "Unknown Device";
  }

  const labelParts = [navigator.platform, navigator.language]
    .map((value) => getUserHeaderSanitizationInfo(value))
    .filter((entry) => {
      if (!entry.changed) {
        return Boolean(entry.value);
      }

      const dedupeKey = `${entry.changeTypes.join(",")}:${entry.becameEmpty}`;
      if (!reportedDeviceLabelSanitizations.has(dedupeKey)) {
        reportedDeviceLabelSanitizations.add(dedupeKey);
        void logInternalWarning({
          type: "USER_HEADER_SANITIZED",
          entityId: "x-device-label",
          message: "A user-generated auth header value was sanitized before request dispatch.",
          metadata: {
            became_empty: entry.becameEmpty,
            change_types: entry.changeTypes,
            header_name: "x-device-label",
            original_length: entry.originalLength,
            sanitized_length: entry.sanitizedLength,
            source: "device_label",
          },
        });
      }

      return Boolean(entry.value);
    })
    .map((entry) => entry.value);

  return labelParts.length > 0 ? labelParts.join(" | ") : "Unknown Device";
};
