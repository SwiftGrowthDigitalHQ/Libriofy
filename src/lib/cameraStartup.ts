const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const KNOWN_BROWSER_CAMERA_ERROR_NAMES = [
  "AbortError",
  "ConstraintNotSatisfiedError",
  "DevicesNotFoundError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OverconstrainedError",
  "PermissionDeniedError",
  "SecurityError",
  "SourceUnavailableError",
  "TrackStartError",
] as const;

type BrowserCameraErrorName = (typeof KNOWN_BROWSER_CAMERA_ERROR_NAMES)[number];

export type CameraStartupFailureKind =
  | "permission_denied"
  | "no_camera"
  | "camera_busy"
  | "constraint_failed"
  | "timeout"
  | "insecure_context"
  | "unsupported"
  | "aborted"
  | "unknown";

export type CameraErrorCode =
  | "PERMISSION_DENIED"
  | "NO_CAMERA"
  | "CAMERA_IN_USE"
  | "UNSUPPORTED"
  | "START_FAILED"
  | "UNKNOWN";

export type CameraStartupErrorSummary = {
  browserErrorName: BrowserCameraErrorName | null;
  code: CameraErrorCode;
  detail: string;
  kind: CameraStartupFailureKind;
  rawMessage: string;
  retryable: boolean;
  stack: string | null;
  title: string;
};

const readErrorName = (error: unknown) => {
  if (error instanceof DOMException || error instanceof Error) {
    return trimText(error.name);
  }

  if (error && typeof error === "object") {
    return trimText((error as { name?: unknown }).name);
  }

  return "";
};

const readErrorMessage = (error: unknown) => {
  if (typeof error === "string") {
    return trimText(error);
  }

  if (error instanceof DOMException || error instanceof Error) {
    return trimText(error.message);
  }

  if (error && typeof error === "object") {
    return trimText((error as { message?: unknown }).message);
  }

  return "";
};

const extractBrowserCameraErrorName = (
  error: unknown,
  rawMessage: string,
): BrowserCameraErrorName | null => {
  const directName = readErrorName(error);
  const directMatch = KNOWN_BROWSER_CAMERA_ERROR_NAMES.find((name) => name === directName);
  if (directMatch) {
    return directMatch;
  }

  const normalizedMessage = rawMessage.toLowerCase();
  return (
    KNOWN_BROWSER_CAMERA_ERROR_NAMES.find((name) => normalizedMessage.includes(name.toLowerCase())) ?? null
  );
};

export const getReadableCameraError = (
  error: unknown,
  fallback = "Unable to verify this ID right now.",
) => {
  const message = readErrorMessage(error);
  return message || fallback;
};

export const normalizeCameraStartupError = (
  error: unknown,
  context: {
    isSecureContext: boolean;
    supportsMediaDevices: boolean;
  },
): CameraStartupErrorSummary => {
  if (!context.isSecureContext) {
    return {
      browserErrorName: null,
      code: "UNSUPPORTED",
      detail: "Open this scanner on HTTPS or localhost to use the camera.",
      kind: "insecure_context",
      rawMessage: "HTTPS_REQUIRED",
      retryable: false,
      stack: null,
      title: "Camera needs a secure page",
    };
  }

  if (!context.supportsMediaDevices) {
    return {
      browserErrorName: null,
      code: "UNSUPPORTED",
      detail: "This browser does not support live camera access.",
      kind: "unsupported",
      rawMessage: "MEDIA_DEVICES_UNSUPPORTED",
      retryable: false,
      stack: null,
      title: "Camera not supported",
    };
  }

  const rawMessage = readErrorMessage(error);
  const normalizedMessage = rawMessage.toLowerCase();
  const browserErrorName = extractBrowserCameraErrorName(error, rawMessage);
  const stack = error instanceof Error && error.stack ? error.stack : null;

  if (
    browserErrorName === "NotAllowedError" ||
    browserErrorName === "PermissionDeniedError" ||
    browserErrorName === "SecurityError" ||
    normalizedMessage.includes("permission denied") ||
    normalizedMessage.includes("permission dismissed") ||
    normalizedMessage.includes("permission") ||
    normalizedMessage.includes("access denied")
  ) {
    return {
      browserErrorName,
      code: "PERMISSION_DENIED",
      detail: "Allow camera access in the browser site settings, then retry.",
      kind: "permission_denied",
      rawMessage,
      retryable: false,
      stack,
      title: "Camera permission denied",
    };
  }

  if (
    browserErrorName === "NotFoundError" ||
    browserErrorName === "DevicesNotFoundError" ||
    normalizedMessage.includes("requested device not found") ||
    normalizedMessage.includes("no camera") ||
    normalizedMessage.includes("device not found")
  ) {
    return {
      browserErrorName,
      code: "NO_CAMERA",
      detail: "No usable camera was detected on this device.",
      kind: "no_camera",
      rawMessage,
      retryable: false,
      stack,
      title: "No camera found",
    };
  }

  if (
    browserErrorName === "OverconstrainedError" ||
    browserErrorName === "ConstraintNotSatisfiedError" ||
    normalizedMessage.includes("overconstrained") ||
    normalizedMessage.includes("constraint")
  ) {
    return {
      browserErrorName,
      code: "START_FAILED",
      detail: "The selected camera or requested video profile is not supported on this device.",
      kind: "constraint_failed",
      rawMessage,
      retryable: true,
      stack,
      title: "Camera profile unsupported",
    };
  }

  if (
    browserErrorName === "NotReadableError" ||
    browserErrorName === "TrackStartError" ||
    browserErrorName === "SourceUnavailableError" ||
    normalizedMessage.includes("could not start video source") ||
    normalizedMessage.includes("camera is already in use") ||
    normalizedMessage.includes("camera already in use") ||
    normalizedMessage.includes("device in use") ||
    normalizedMessage.includes("another app") ||
    normalizedMessage.includes("notreadableerror")
  ) {
    return {
      browserErrorName,
      code: "CAMERA_IN_USE",
      detail: "Another app, tab, or OS process is already using the camera. Close it and retry.",
      kind: "camera_busy",
      rawMessage,
      retryable: true,
      stack,
      title: "Camera already in use",
    };
  }

  if (browserErrorName === "AbortError" || normalizedMessage.includes("aborterror")) {
    return {
      browserErrorName,
      code: "START_FAILED",
      detail: "The browser interrupted camera startup. Retry the camera.",
      kind: "aborted",
      rawMessage,
      retryable: true,
      stack,
      title: "Camera start was interrupted",
    };
  }

  if (
    normalizedMessage.includes("camera_start_timeout") ||
    normalizedMessage.includes("scanner_container_missing") ||
    normalizedMessage.includes("timed out")
  ) {
    return {
      browserErrorName,
      code: "START_FAILED",
      detail: "The camera did not become ready in time. Retry the camera.",
      kind: "timeout",
      rawMessage,
      retryable: true,
      stack,
      title: "Camera failed to start",
    };
  }

  if (
    normalizedMessage.includes("camera streaming not supported") ||
    normalizedMessage.includes("navigator.mediadevices not supported")
  ) {
    return {
      browserErrorName,
      code: "UNSUPPORTED",
      detail: "This browser does not support live camera access.",
      kind: "unsupported",
      rawMessage,
      retryable: false,
      stack,
      title: "Camera not supported",
    };
  }

  return {
    browserErrorName,
    code: "UNKNOWN",
    detail: rawMessage || "Unable to start the camera right now.",
    kind: "unknown",
    rawMessage,
    retryable: true,
    stack,
    title: "Camera unavailable",
  };
};
