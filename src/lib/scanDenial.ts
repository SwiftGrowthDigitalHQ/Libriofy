export type PublicScanDenialCode =
  | "INVALID_QR"
  | "USER_NOT_FOUND"
  | "ACCESS_DENIED"
  | "ALREADY_CHECKED_IN"
  | "SUBSCRIPTION_EXPIRED"
  | "DEVICE_MISMATCH"
  | "LIBRARY_MISMATCH"
  | "RATE_LIMITED"
  | "ENTRY_CONFLICT"
  | "DUPLICATE_SCAN"
  | "TOKEN_EXPIRED"
  | "INTERNAL_ERROR";

type ResolvePublicScanDenialInput = {
  code?: string | null;
  message?: string | null;
  duplicate?: boolean;
};

export type PublicScanDenialPresentation = {
  activityLabel: "Access Denied";
  code: PublicScanDenialCode;
  message: string;
  title: "ACCESS DENIED";
};

const PUBLIC_SCAN_DENIAL_MESSAGES: Record<PublicScanDenialCode, string> = {
  INVALID_QR: "Invalid Library Pass",
  USER_NOT_FOUND: "Student Not Found",
  ACCESS_DENIED: "Access Denied",
  ALREADY_CHECKED_IN: "Already Checked In",
  SUBSCRIPTION_EXPIRED: "Subscription Expired",
  DEVICE_MISMATCH: "Unauthorized Device",
  LIBRARY_MISMATCH: "Wrong Library Access",
  RATE_LIMITED: "Scanning Too Fast",
  ENTRY_CONFLICT: "Entry Conflict Detected",
  DUPLICATE_SCAN: "Duplicate Scan",
  TOKEN_EXPIRED: "Pass Expired",
  INTERNAL_ERROR: "Verification Failed",
};

const PUBLIC_SCAN_CODE_ALIASES: Record<string, PublicScanDenialCode> = {
  INVALID_QR: "INVALID_QR",
  QR_TOO_LARGE: "INVALID_QR",
  INVALID_LIBRARY_ID: "LIBRARY_MISMATCH",
  WRONG_LIBRARY: "LIBRARY_MISMATCH",
  LIBRARY_MISMATCH: "LIBRARY_MISMATCH",
  DEVICE_BLOCKED: "DEVICE_MISMATCH",
  DEVICE_MISMATCH: "DEVICE_MISMATCH",
  EXPIRED: "TOKEN_EXPIRED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  ALREADY_INSIDE: "ALREADY_CHECKED_IN",
  ALREADY_CHECKED_IN: "ALREADY_CHECKED_IN",
  TOO_FREQUENT: "RATE_LIMITED",
  RATE_LIMITED: "RATE_LIMITED",
  ENTRY_CONFLICT: "ENTRY_CONFLICT",
  DUPLICATE_SCAN: "DUPLICATE_SCAN",
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED",
  ACCESS_DENIED: "ACCESS_DENIED",
  ACCESS_REVOKED: "ACCESS_DENIED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  STUDENT_NOT_FOUND: "USER_NOT_FOUND",
  SERVER_ERROR: "INTERNAL_ERROR",
  CONFIG_ERROR: "INTERNAL_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  VERIFICATION_FAILED: "INTERNAL_ERROR",
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const looksLikeUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const looksLikeOpaqueIdentifier = (value: string) => {
  if (!value) {
    return false;
  }

  if (looksLikeUuid(value)) {
    return true;
  }

  if (/[{}[\]]/.test(value)) {
    return true;
  }

  const collapsed = value.replace(/[-_]/g, "");
  if (collapsed.length >= 16 && /^[A-Za-z0-9]+$/.test(collapsed) && !/\s/.test(value)) {
    return true;
  }

  return value.length >= 24 && !/\s/.test(value);
};

const resolvePublicScanDenialCodeFromMessage = (message: string) => {
  const normalizedMessage = normalizeText(message).toLowerCase();
  if (!normalizedMessage) {
    return null;
  }

  if (normalizedMessage.includes("subscription") && normalizedMessage.includes("expired")) {
    return "SUBSCRIPTION_EXPIRED";
  }

  if (
    normalizedMessage.includes("student not found") ||
    normalizedMessage.includes("user not found") ||
    normalizedMessage.includes("account not found")
  ) {
    return "USER_NOT_FOUND";
  }

  if (
    normalizedMessage.includes("already checked in") ||
    normalizedMessage.includes("already inside") ||
    normalizedMessage.includes("already marked")
  ) {
    return "ALREADY_CHECKED_IN";
  }

  if (normalizedMessage.includes("duplicate scan") || normalizedMessage.includes("duplicate")) {
    return "DUPLICATE_SCAN";
  }

  if (
    normalizedMessage.includes("wrong library") ||
    normalizedMessage.includes("library mismatch") ||
    normalizedMessage.includes("library id invalid")
  ) {
    return "LIBRARY_MISMATCH";
  }

  if (
    normalizedMessage.includes("unauthorized device") ||
    normalizedMessage.includes("device token") ||
    normalizedMessage.includes("device blocked") ||
    normalizedMessage.includes("device not allowed") ||
    normalizedMessage.includes("device access")
  ) {
    return "DEVICE_MISMATCH";
  }

  if (
    normalizedMessage.includes("too frequent") ||
    normalizedMessage.includes("too many") ||
    normalizedMessage.includes("slow down") ||
    normalizedMessage.includes("too fast")
  ) {
    return "RATE_LIMITED";
  }

  if (normalizedMessage.includes("entry conflict") || normalizedMessage.includes("conflict")) {
    return "ENTRY_CONFLICT";
  }

  if (
    normalizedMessage.includes("expired") ||
    normalizedMessage.includes("pass expired") ||
    normalizedMessage.includes("token expired")
  ) {
    return "TOKEN_EXPIRED";
  }

  if (
    normalizedMessage.includes("invalid qr") ||
    normalizedMessage.includes("invalid id") ||
    normalizedMessage.includes("invalid pass") ||
    normalizedMessage.includes("invalid library pass")
  ) {
    return "INVALID_QR";
  }

  if (
    normalizedMessage.includes("access denied") ||
    normalizedMessage.includes("access revoked") ||
    normalizedMessage.includes("forbidden")
  ) {
    return "ACCESS_DENIED";
  }

  if (normalizedMessage.includes("not found")) {
    return "USER_NOT_FOUND";
  }

  if (
    normalizedMessage.includes("unable to verify") ||
    normalizedMessage.includes("verification failed") ||
    normalizedMessage.includes("unable to record") ||
    normalizedMessage.includes("server")
  ) {
    return "INTERNAL_ERROR";
  }

  return null;
};

export const sanitizeScanDisplayText = (value: unknown) => {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue || looksLikeOpaqueIdentifier(normalizedValue)) {
    return null;
  }

  return normalizedValue;
};

export const resolvePublicScanDenial = ({
  code,
  message,
  duplicate,
}: ResolvePublicScanDenialInput): PublicScanDenialPresentation => {
  const normalizedCode = normalizeText(code).toUpperCase();
  const normalizedMessage = normalizeText(message);

  let publicCode: PublicScanDenialCode | null = null;
  if (duplicate) {
    publicCode = "DUPLICATE_SCAN";
  } else if (normalizedCode && PUBLIC_SCAN_CODE_ALIASES[normalizedCode]) {
    publicCode = PUBLIC_SCAN_CODE_ALIASES[normalizedCode];
  } else if (normalizedMessage) {
    publicCode = resolvePublicScanDenialCodeFromMessage(normalizedMessage);
  }

  const resolvedCode = publicCode ?? "INTERNAL_ERROR";

  return {
    activityLabel: "Access Denied",
    code: resolvedCode,
    message: PUBLIC_SCAN_DENIAL_MESSAGES[resolvedCode],
    title: "ACCESS DENIED",
  };
};

export const SCAN_BINDING_RESET_CODES = new Set([
  "DEVICE_BLOCKED",
  "DEVICE_MISMATCH",
  "INVALID_LIBRARY_ID",
  "LIBRARY_MISMATCH",
  "WRONG_LIBRARY",
] as const);
