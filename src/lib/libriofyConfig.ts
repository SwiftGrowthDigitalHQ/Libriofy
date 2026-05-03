export const LIBRIOFY_PUBLIC_APP_URL = "https://www.libriofy.com";
export const LIBRIOFY_AUTH_EMAIL = "hello@libriofy.com";
export const LIBRIOFY_AUTH_EMAIL_FROM = `Libriofy <${LIBRIOFY_AUTH_EMAIL}>`;

const ALLOWED_PUBLIC_APP_HOSTS = new Set(["libriofy.com", "www.libriofy.com"]);
const ALLOWED_LOCAL_APP_HOSTS = new Set(["localhost", "127.0.0.1", "partner.localhost"]);

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const normalizeHostname = (value: string) => value.trim().toLowerCase();

const isAllowedRequestHost = (hostname: string, allowLocalhost: boolean) =>
  ALLOWED_PUBLIC_APP_HOSTS.has(hostname) || (allowLocalhost && ALLOWED_LOCAL_APP_HOSTS.has(hostname));

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
    return url.protocol === "https:" && isAllowedRequestHost(normalizeHostname(url.hostname), false);
  } catch {
    return false;
  }
};

export const isAllowedLibriofyRequestOrigin = (
  value: unknown,
  { allowLocalhost = false }: { allowLocalhost?: boolean } = {},
) => {
  const normalized = trimText(value);
  if (!normalized) {
    return false;
  }

  try {
    const url = new URL(normalized);
    const hostname = normalizeHostname(url.hostname);
    if (url.protocol === "https:") {
      return isAllowedRequestHost(hostname, false);
    }

    return allowLocalhost && url.protocol === "http:" && isAllowedRequestHost(hostname, true);
  } catch {
    return false;
  }
};

export const isAllowedLibriofyRequestHost = (
  value: unknown,
  { allowLocalhost = false }: { allowLocalhost?: boolean } = {},
) => {
  const normalized = trimText(value);
  if (!normalized) {
    return false;
  }

  const hostValue = normalized.replace(/:\d+$/, "");
  return isAllowedRequestHost(normalizeHostname(hostValue), allowLocalhost);
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
