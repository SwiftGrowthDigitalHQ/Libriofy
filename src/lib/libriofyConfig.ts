export const LIBRIOFY_PUBLIC_APP_URL = "https://www.libriofy.com";
export const LIBRIOFY_AUTH_EMAIL = "hello@libriofy.com";
export const LIBRIOFY_AUTH_EMAIL_FROM = `Libriofy <${LIBRIOFY_AUTH_EMAIL}>`;

const ALLOWED_PUBLIC_APP_HOSTS = new Set(["libriofy.com", "www.libriofy.com"]);

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const extractEmailAddress = (value: unknown) => {
  const normalized = trimText(value);
  if (!normalized) {
    return "";
  }

  const matched = normalized.match(/<([^>]+)>/);
  return (matched?.[1] ?? normalized).trim().toLowerCase();
};

export const isLibriofyAppUrl = (value: unknown) => {
  const normalized = trimText(value);
  if (!normalized) {
    return false;
  }

  try {
    const url = new URL(normalized);
    return url.protocol === "https:" && ALLOWED_PUBLIC_APP_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
};

export const resolveLibriofyAppUrl = (...candidates: Array<unknown>) => {
  for (const candidate of candidates) {
    if (isLibriofyAppUrl(candidate)) {
      return LIBRIOFY_PUBLIC_APP_URL;
    }
  }

  return LIBRIOFY_PUBLIC_APP_URL;
};

export const isLibriofyAuthEmail = (value: unknown) => extractEmailAddress(value) === LIBRIOFY_AUTH_EMAIL;

export const resolveLibriofyEmailFrom = (value: unknown) =>
  isLibriofyAuthEmail(value) ? LIBRIOFY_AUTH_EMAIL_FROM : "";
