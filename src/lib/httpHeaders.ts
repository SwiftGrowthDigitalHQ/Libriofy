type HeaderInputValue = string | null | undefined;
type HeaderValueMode = "sanitize" | "strict";

export type UserHeaderSanitizationInfo = {
  becameEmpty: boolean;
  changed: boolean;
  changeTypes: Array<"control_chars" | "non_ascii" | "whitespace">;
  originalLength: number;
  sanitizedLength: number;
  value: string;
};

type SanitizeHeadersOptions = {
  allowedHeaders?: readonly string[];
  valueModes?: Partial<Record<string, HeaderValueMode>>;
};

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const INVALID_SYSTEM_HEADER_VALUE_PATTERN = /[^\x20-\x7E]/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]+/g;
const NON_ASCII_CHARACTER_PATTERN = /[^\x20-\x7E]+/g;
const WHITESPACE_PATTERN = /\s+/g;

const normalizeHeaderName = (value: string) => value.trim().toLowerCase();

const validateHeaderName = (value: string) => {
  const normalized = value.trim();
  if (!normalized || !HEADER_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid header name: ${value}`);
  }

  return normalized;
};

export const getUserHeaderSanitizationInfo = (value: HeaderInputValue): UserHeaderSanitizationInfo => {
  const rawValue = String(value ?? "");
  const normalizedValue = rawValue.normalize("NFKC");
  const hadControlChars = /[\u0000-\u001F\u007F-\u009F]/.test(normalizedValue);
  const withoutControlChars = normalizedValue.replace(CONTROL_CHARACTER_PATTERN, " ");
  const hadNonAscii = /[^\x20-\x7E]/.test(withoutControlChars);
  const withoutNonAscii = withoutControlChars.replace(NON_ASCII_CHARACTER_PATTERN, " ");
  const collapsedWhitespace = withoutNonAscii.replace(WHITESPACE_PATTERN, " ").trim();
  const originalTrimmed = normalizedValue.trim();
  const changeTypes: UserHeaderSanitizationInfo["changeTypes"] = [];

  if (hadControlChars) {
    changeTypes.push("control_chars");
  }

  if (hadNonAscii) {
    changeTypes.push("non_ascii");
  }

  if (collapsedWhitespace !== withoutNonAscii || originalTrimmed !== collapsedWhitespace) {
    changeTypes.push("whitespace");
  }

  return {
    becameEmpty: !collapsedWhitespace,
    changed: collapsedWhitespace !== originalTrimmed,
    changeTypes,
    originalLength: originalTrimmed.length,
    sanitizedLength: collapsedWhitespace.length,
    value: collapsedWhitespace,
  };
};

export const sanitizeUserHeaderValue = (value: HeaderInputValue) => getUserHeaderSanitizationInfo(value).value;

export const validateSystemHeaderValue = (value: HeaderInputValue) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }

  if (INVALID_SYSTEM_HEADER_VALUE_PATTERN.test(normalized)) {
    throw new Error("System header values must contain printable ASCII characters only.");
  }

  return normalized;
};

export const sanitizeHeaders = (
  headers: Record<string, HeaderInputValue>,
  options: SanitizeHeadersOptions = {},
) => {
  const allowedHeaderNames = options.allowedHeaders
    ? new Set(options.allowedHeaders.map((headerName) => normalizeHeaderName(validateHeaderName(headerName))))
    : null;
  const valueModes = new Map(
    Object.entries(options.valueModes ?? {}).map(([headerName, mode]) => [
      normalizeHeaderName(validateHeaderName(headerName)),
      mode,
    ]),
  );

  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => {
      const validatedKey = validateHeaderName(key);
      const normalizedHeaderName = normalizeHeaderName(validatedKey);

      const valueMode = valueModes.get(normalizedHeaderName) ?? "strict";
      const sanitizedValue =
        valueMode === "sanitize" ? sanitizeUserHeaderValue(value) : validateSystemHeaderValue(value);
      if (!sanitizedValue) {
        return [];
      }

      if (allowedHeaderNames && !allowedHeaderNames.has(normalizedHeaderName)) {
        throw new Error(`Header is not allowed: ${validatedKey}`);
      }

      return [[validatedKey, sanitizedValue]];
    }),
  ) as Record<string, string>;
};

export const buildBearerAuthorizationHeader = (token: HeaderInputValue, errorMessage: string) => {
  const sanitizedToken = validateSystemHeaderValue(token);
  if (!sanitizedToken) {
    throw new Error(errorMessage);
  }

  return `Bearer ${sanitizedToken}`;
};
