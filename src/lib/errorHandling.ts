export type AppErrorKind = "network" | "server" | "unknown";

type ClassifiedError = {
  isRetriable: boolean;
  kind: AppErrorKind;
  publicMessage: string;
  recoveryMessage: string;
  statusLabel: string;
};

const NETWORK_ERROR_PATTERNS = [
  "networkerror",
  "network request failed",
  "failed to fetch",
  "fetch failed",
  "load failed",
  "connection reset",
  "connection lost",
  "internet disconnected",
  "offline",
  "timeout",
  "timed out",
  "err_network",
];

const SERVER_ERROR_PATTERNS = [
  "500",
  "502",
  "503",
  "504",
  "internal server error",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "edge function returned a non-2xx status code",
  "server error",
];

const sanitizeText = (value: string) => value.replace(/\s+/g, " ").trim();

export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return sanitizeText(error.message);
  }

  if (typeof error === "string") {
    return sanitizeText(error);
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return sanitizeText(error.message);
  }

  return "";
};

const looksUnsafeToExpose = (message: string) => {
  if (!message) return false;

  const trimmed = message.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.includes("at ") ||
    trimmed.includes("stack") ||
    trimmed.includes("syntaxerror") ||
    trimmed.includes("referenceerror")
  );
};

export const classifyAppError = (error: unknown): ClassifiedError => {
  const rawMessage = extractErrorMessage(error).toLowerCase();

  if (NETWORK_ERROR_PATTERNS.some((pattern) => rawMessage.includes(pattern))) {
    return {
      isRetriable: true,
      kind: "network",
      publicMessage: "Connection lost. Reconnecting...",
      recoveryMessage: "We're retrying in the background and will restore the dashboard as soon as the connection is back.",
      statusLabel: "Network Issue",
    };
  }

  if (SERVER_ERROR_PATTERNS.some((pattern) => rawMessage.includes(pattern))) {
    return {
      isRetriable: true,
      kind: "server",
      publicMessage: "Server is busy. Try again in a moment.",
      recoveryMessage: "The request reached the server, but it needs a moment. A safe retry is already in progress.",
      statusLabel: "Server Delay",
    };
  }

  return {
    isRetriable: false,
    kind: "unknown",
    publicMessage: "Something went wrong. Please try again.",
    recoveryMessage: "Our recovery layer is keeping your workspace safe while we reset the broken part.",
    statusLabel: "Unexpected Issue",
  };
};

export const getSafeErrorMessage = (
  error: unknown,
  fallback = "Something went wrong. Please try again.",
) => {
  const { kind, publicMessage } = classifyAppError(error);
  const rawMessage = extractErrorMessage(error);

  if (!rawMessage || looksUnsafeToExpose(rawMessage)) {
    return publicMessage || fallback;
  }

  if (kind === "unknown") {
    return fallback;
  }

  return publicMessage || fallback;
};

export const isRetriableAppError = (error: unknown) => classifyAppError(error).isRetriable;

export const formatQueryLabel = (queryKey: readonly unknown[] | unknown) => {
  const primaryKey = Array.isArray(queryKey) ? queryKey[0] : queryKey;
  if (typeof primaryKey !== "string" || !primaryKey.trim()) {
    return "Request";
  }

  const normalized = primaryKey
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const getRetryToastMessage = (queryKey: readonly unknown[] | unknown, error: unknown) => {
  const label = formatQueryLabel(queryKey);
  const { kind } = classifyAppError(error);

  if (kind === "network") {
    return `${label} failed. Reconnecting...`;
  }

  if (kind === "server") {
    return `${label} failed. Retrying in a moment...`;
  }

  return `${label} failed. Retrying...`;
};

export const buildIssueReportHref = ({
  route,
  timestamp,
  userId,
}: {
  route: string;
  timestamp: string;
  userId?: string | null;
}) => {
  const subject = "Libriofy dashboard issue report";
  const body = [
    "Hi Libriofy support,",
    "",
    "I ran into a dashboard issue and want to report it.",
    "",
    `Route: ${route || "/"}`,
    `User ID: ${userId || "Unknown"}`,
    `Timestamp: ${timestamp}`,
  ].join("\n");

  return `mailto:support@libriofy.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
