import type { ClientAuthSession } from "@/lib/auth.shared";
import { isAuthSessionExpired } from "@/lib/auth.shared";
import { readBrowserStorageItem, writeBrowserStorageItem } from "@/lib/browserStorage";

const AUTH_SESSION_STORAGE_KEY = "libriofy.auth.session";

let cachedSession: ClientAuthSession | null | undefined;
const listeners = new Set<(session: ClientAuthSession | null) => void>();

const isSessionUserRecord = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ClientAuthSession["user"]>;
  return (
    typeof candidate.id === "string" &&
    (typeof candidate.email === "string" || candidate.email === null || typeof candidate.email === "undefined") &&
    (typeof candidate.fullName === "string" || candidate.fullName === null || typeof candidate.fullName === "undefined") &&
    (typeof candidate.phone === "string" || candidate.phone === null || typeof candidate.phone === "undefined") &&
    (Array.isArray(candidate.roles) || typeof candidate.roles === "undefined")
  );
};

const normalizeSessionUser = (value: unknown) => {
  if (!isSessionUserRecord(value)) {
    return null;
  }

  const candidate = value as Partial<ClientAuthSession["user"]>;
  return {
    email: typeof candidate.email === "string" ? candidate.email : null,
    fullName: typeof candidate.fullName === "string" ? candidate.fullName : null,
    id: candidate.id as string,
    phone: typeof candidate.phone === "string" ? candidate.phone : null,
    roles: Array.isArray(candidate.roles) ? candidate.roles.filter((role): role is string => typeof role === "string") : [],
  } satisfies ClientAuthSession["user"];
};

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
      !isSessionUserRecord(parsed.user)
    ) {
      return null;
    }

    const effectiveUser =
      normalizeSessionUser(parsed.effectiveUser) ??
      normalizeSessionUser((parsed.impersonation as { effectiveUser?: unknown } | undefined)?.effectiveUser) ??
      normalizeSessionUser(parsed.user);
    const realUser =
      normalizeSessionUser(parsed.realUser) ??
      normalizeSessionUser((parsed.impersonation as { realUser?: unknown } | undefined)?.realUser);
    const rawImpersonation = parsed.impersonation;
    const impersonation =
      rawImpersonation &&
      typeof rawImpersonation === "object" &&
      typeof (rawImpersonation as { impersonationId?: unknown }).impersonationId === "string" &&
      typeof (rawImpersonation as { startedAt?: unknown }).startedAt === "string" &&
      typeof (rawImpersonation as { expiresAt?: unknown }).expiresAt === "string" &&
      effectiveUser &&
      realUser
        ? {
            effectiveUser,
            expiresAt: (rawImpersonation as { expiresAt: string }).expiresAt,
            impersonationId: (rawImpersonation as { impersonationId: string }).impersonationId,
            realUser,
            startedAt: (rawImpersonation as { startedAt: string }).startedAt,
          }
        : null;

    return {
      ...parsed,
      effectiveUser: effectiveUser ?? normalizeSessionUser(parsed.user),
      authLevel: typeof parsed.authLevel === "number" ? parsed.authLevel : 1,
      idleTimeoutSeconds: typeof parsed.idleTimeoutSeconds === "number" ? parsed.idleTimeoutSeconds : null,
      impersonation,
      realUser,
      sessionScope:
        parsed.sessionScope === "super_admin" || parsed.sessionScope === "impersonation"
          ? parsed.sessionScope
          : "general",
      user: effectiveUser ?? normalizeSessionUser(parsed.user) ?? (parsed.user as ClientAuthSession["user"]),
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
