import type { ObservabilityMetadata } from "./types.js";

const REDACTED_VALUE = "[redacted]";
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|api[_-]?key|jwt|bearer|basic|hashed_?otp|access[_-]?token|refresh[_-]?token|(^|[_-])token($|[_-])|otp(?!length))/i;
const AUTH_SCHEME_PATTERN = /^(Bearer|Basic)\s+/i;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const normalizeKey = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();

const isSensitiveKey = (key: string) => SENSITIVE_KEY_PATTERN.test(normalizeKey(key));

const shouldRedactStringValue = (value: string) => {
  const normalized = value.trim();
  return AUTH_SCHEME_PATTERN.test(normalized) || JWT_PATTERN.test(normalized);
};

export const sanitizeObservabilityValue = (value: unknown, depth = 0, key = ""): unknown => {
  if (depth > 5) {
    return "[truncated]";
  }

  if (isSensitiveKey(key)) {
    return REDACTED_VALUE;
  }

  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    if (shouldRedactStringValue(value)) {
      return REDACTED_VALUE;
    }

    return value.length > 2_000 ? `${value.slice(0, 2_000)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizeObservabilityValue(entry, depth + 1, key));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50);
    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [entryKey, sanitizeObservabilityValue(entryValue, depth + 1, entryKey)]),
    );
  }

  return String(value);
};

export const sanitizeObservabilityMetadata = (metadata: unknown): ObservabilityMetadata => {
  const sanitized = sanitizeObservabilityValue(metadata);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }

  return sanitized as ObservabilityMetadata;
};
