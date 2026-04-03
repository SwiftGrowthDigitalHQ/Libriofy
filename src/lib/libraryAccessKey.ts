export const LIBRARY_ACCESS_KEY_PREFIX = "LIB-";
export const LIBRARY_ACCESS_KEY_BODY_LENGTH = 6;
export const LIBRARY_ACCESS_KEY_PATTERN = /^LIB-[A-Z0-9]{6}$/;

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const normalizeLibraryAccessKey = (value: unknown) =>
  trimText(value)
    .toUpperCase()
    .replace(/\s+/g, "");

export const isLibraryAccessKey = (value: unknown) =>
  LIBRARY_ACCESS_KEY_PATTERN.test(normalizeLibraryAccessKey(value));

export const getLibraryAccessKeySuffix = (value: unknown) => {
  const normalized = normalizeLibraryAccessKey(value);
  return normalized ? normalized.slice(-4) : "";
};

export const maskLibraryAccessKey = (value: unknown) => {
  const normalized = normalizeLibraryAccessKey(value);
  if (!normalized) {
    return `${LIBRARY_ACCESS_KEY_PREFIX}****`;
  }

  const suffix = getLibraryAccessKeySuffix(normalized);
  return `${LIBRARY_ACCESS_KEY_PREFIX}****${suffix}`;
};
