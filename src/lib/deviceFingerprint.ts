const textEncoder = new TextEncoder();

let fingerprintPromise: Promise<string> | null = null;

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
    return "Unknown device";
  }

  const platform = navigator.platform || "Unknown platform";
  const language = navigator.language || "Unknown locale";
  return `${platform} • ${language}`;
};
