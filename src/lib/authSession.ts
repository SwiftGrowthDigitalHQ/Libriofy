import type { ClientAuthSession } from "@/lib/auth.shared";
import { isAuthSessionExpired } from "@/lib/auth.shared";
import { readBrowserStorageItem, writeBrowserStorageItem } from "@/lib/browserStorage";

const AUTH_SESSION_STORAGE_KEY = "libriofy.auth.session";

let cachedSession: ClientAuthSession | null | undefined;
const listeners = new Set<(session: ClientAuthSession | null) => void>();

const parseStoredSession = (rawValue: string | null): ClientAuthSession | null => {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<ClientAuthSession> | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (
      typeof parsed.accessToken !== "string" ||
      (typeof parsed.authLevel !== "number" && typeof parsed.authLevel !== "undefined") ||
      typeof parsed.expiresAt !== "number" ||
      (typeof parsed.idleTimeoutSeconds !== "number" &&
        parsed.idleTimeoutSeconds !== null &&
        typeof parsed.idleTimeoutSeconds !== "undefined") ||
      typeof parsed.loginMethod !== "string" ||
      typeof parsed.provider !== "string" ||
      (typeof parsed.sessionScope !== "string" && typeof parsed.sessionScope !== "undefined") ||
      typeof parsed.trustedDevice !== "boolean" ||
      !parsed.user ||
      typeof parsed.user !== "object" ||
      typeof parsed.user.id !== "string"
    ) {
      return null;
    }

    return {
      ...parsed,
      authLevel: typeof parsed.authLevel === "number" ? parsed.authLevel : 1,
      idleTimeoutSeconds: typeof parsed.idleTimeoutSeconds === "number" ? parsed.idleTimeoutSeconds : null,
      sessionScope: parsed.sessionScope === "super_admin" ? "super_admin" : "general",
    } as ClientAuthSession;
  } catch {
    return null;
  }
};

const notifyListeners = (session: ClientAuthSession | null) => {
  for (const listener of listeners) {
    listener(session);
  }
};

export const getStoredAuthSession = () => {
  if (cachedSession === undefined) {
    cachedSession = parseStoredSession(readBrowserStorageItem("session", AUTH_SESSION_STORAGE_KEY));
  }

  if (isAuthSessionExpired(cachedSession)) {
    cachedSession = null;
    writeBrowserStorageItem("session", AUTH_SESSION_STORAGE_KEY, null);
  }

  return cachedSession;
};

export const getStoredAccessToken = async () => {
  const session = getStoredAuthSession();
  return session?.accessToken ?? null;
};

export const getStoredAuthUser = () => getStoredAuthSession()?.user ?? null;

export const setStoredAuthSession = (session: ClientAuthSession | null) => {
  cachedSession = session;
  writeBrowserStorageItem("session", AUTH_SESSION_STORAGE_KEY, session ? JSON.stringify(session) : null);
  notifyListeners(session);
};

export const clearStoredAuthSession = () => {
  setStoredAuthSession(null);
};

export const subscribeToStoredAuthSession = (listener: (session: ClientAuthSession | null) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
