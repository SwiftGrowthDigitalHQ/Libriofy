import { normalizeBasePath } from "./maintenance.js";

const PRODUCTION_PUBLIC_APP_URL = "https://www.libriofy.com";
const VERCEL_PREVIEW_HOST_SUFFIX = ["vercel", "app"].join(".");

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeBaseUrl = (value: unknown) => trimText(value).replace(/\/+$/, "");

export const isPreviewAppUrl = (urlValue: string) => {
  try {
    return new URL(urlValue).hostname.endsWith(VERCEL_PREVIEW_HOST_SUFFIX);
  } catch {
    return false;
  }
};

export const getPublicAppBaseUrl = () => {
  const candidates = [
    import.meta.env.VITE_PUBLIC_APP_URL as string | undefined,
    import.meta.env.VITE_APP_URL as string | undefined,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized && !isPreviewAppUrl(normalized)) {
      return normalized;
    }
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    const currentOrigin = normalizeBaseUrl(window.location.origin);
    if (currentOrigin && !isPreviewAppUrl(currentOrigin)) {
      return currentOrigin;
    }
  }

  return PRODUCTION_PUBLIC_APP_URL;
};

export const buildPublicAppUrl = (path = "/") => {
  const baseUrl = getPublicAppBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = normalizeBasePath(import.meta.env.BASE_URL);
  const resolvedBasePath = basePath === "/" ? "" : basePath;
  if (!path || path === "/") {
    return `${baseUrl}${resolvedBasePath}`;
  }

  return `${baseUrl}${resolvedBasePath}${normalizedPath}`;
};
