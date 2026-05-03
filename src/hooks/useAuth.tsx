/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  extractSessionFromResponse,
  logoutAllSessions,
  logoutCurrentSession,
  refreshAuthSession,
  sendOtp as requestOtp,
  startSuperAdminLogin as requestSuperAdminLogin,
  verifyOtp as requestOtpVerification,
  verifySuperAdminOtp as requestSuperAdminOtpVerification,
} from "@/lib/authApi";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
} from "@/lib/authSession";
import { readBrowserStorageItem, writeBrowserStorageItem } from "@/lib/browserStorage";
import {
  isAuthSessionExpired,
  type AuthUser,
  type ClientAuthSession,
  type SendOtpResponse,
  type SuperAdminLoginResponse,
  type SuperAdminVerifyOtpResponse,
  type VerifyOtpResponse,
} from "@/lib/auth.shared";
import { resolveLibriofyAppUrl } from "@/lib/libriofyConfig";
import { normalizeBasePath } from "@/lib/maintenance";
import { supabase, supabaseAuth } from "@/integrations/supabase/client";

interface AuthContextType {
  getCurrentSession: () => Promise<ClientAuthSession | null>;
  loading: boolean;
  logoutAllDevices: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  sendOtp: (phone: string) => Promise<SendOtpResponse>;
  session: ClientAuthSession | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    phoneNumber?: string,
    options?: {
      referralCode?: string;
      affiliateCode?: string;
      accountType?: "library" | "partner" | "affiliate";
      partnerProfile?: {
        bankDetails?: Record<string, unknown>;
        city?: string;
        experience?: string;
        payoutMethod?: string;
        upiId?: string;
      };
    },
  ) => Promise<void>;
  startSuperAdminLogin: (email: string) => Promise<SuperAdminLoginResponse>;
  updatePassword: (password: string) => Promise<void>;
  user: AuthUser | null;
  verifyOtp: (phone: string, otp: string) => Promise<VerifyOtpResponse>;
  verifySuperAdminOtp: (email: string, otp: string) => Promise<SuperAdminVerifyOtpResponse>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AUTH_ACTIVITY_STORAGE_KEY = "libriofy.auth.last-activity";

const toAuthUserFromSupabaseSession = (session: Session): AuthUser => ({
  id: session.user.id,
  email: session.user.email ?? null,
  fullName: (session.user.user_metadata?.full_name as string | undefined) ?? null,
  phone:
    session.user.phone ??
    (session.user.user_metadata?.phone_number as string | undefined) ??
    null,
  roles: [],
});

const buildAppRedirectUrl = (route: string) => {
  const origin = resolveLibriofyAppUrl(
    import.meta.env.VITE_PUBLIC_APP_URL as string | undefined,
    import.meta.env.VITE_APP_URL as string | undefined,
    import.meta.env.NEXT_PUBLIC_SITE_URL as string | undefined,
  );
  const basePath = normalizeBasePath(import.meta.env.BASE_URL);
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  const resolvedBasePath = basePath === "/" ? "" : basePath;

  if (import.meta.env.VITE_USE_HASH_ROUTER === "true") {
    return `${origin}${resolvedBasePath}/#${normalizedRoute}`;
  }

  return `${origin}${resolvedBasePath}${normalizedRoute}`;
};

const readLastActivityTimestamp = () => {
  const rawValue = readBrowserStorageItem("local", AUTH_ACTIVITY_STORAGE_KEY);
  const parsed = rawValue ? Number(rawValue) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const initialSession = getStoredAuthSession();
  const [session, setSession] = useState<ClientAuthSession | null>(initialSession);
  const [user, setUser] = useState<AuthUser | null>(initialSession?.user ?? null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<ClientAuthSession | null>(initialSession);
  const refreshTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(readLastActivityTimestamp());

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const clearActivityTimestamp = useCallback(() => {
    writeBrowserStorageItem("local", AUTH_ACTIVITY_STORAGE_KEY, null);
    lastActivityRef.current = Date.now();
  }, []);

  const markSessionActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    writeBrowserStorageItem("local", AUTH_ACTIVITY_STORAGE_KEY, String(now));
  }, []);

  const applySession = useCallback((nextSession: ClientAuthSession | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setStoredAuthSession(nextSession);
    void supabase.realtime.setAuth(nextSession?.accessToken ?? "");

    if (!nextSession) {
      clearRefreshTimer();
      clearIdleTimer();
    }
  }, [clearIdleTimer, clearRefreshTimer]);

  const applySupabaseSession = useCallback((nextSession: Session | null) => {
    if (!nextSession) {
      if (sessionRef.current?.provider === "supabase") {
        applySession(null);
      }
      return;
    }

    applySession({
      accessToken: nextSession.access_token,
      authLevel: 1,
      expiresAt: nextSession.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      idleTimeoutSeconds: null,
      loginMethod: "email",
      provider: "supabase",
      sessionScope: "general",
      trustedDevice: false,
      user: toAuthUserFromSupabaseSession(nextSession),
    });
  }, [applySession]);

  const restoreSession = useCallback(async () => {
    const cachedSession = getStoredAuthSession();
    const hasValidCachedSession = !!cachedSession && !isAuthSessionExpired(cachedSession);

    if (hasValidCachedSession) {
      applySession(cachedSession);
    }

    try {
      const { data, error } = await supabaseAuth.auth.getSession();
      if (error) {
        throw error;
      }

      if (data.session) {
        applySupabaseSession(data.session);
        return;
      }
    } catch {
      await supabaseAuth.auth.signOut({ scope: "local" }).catch(() => undefined);
    }

    try {
      const restored = await refreshAuthSession();
      applySession(extractSessionFromResponse(restored));
    } catch {
      if (!hasValidCachedSession) {
        applySession(null);
      }
    }
  }, [applySession, applySupabaseSession]);

  const expireForInactivity = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession?.idleTimeoutSeconds) {
      return;
    }

    applySession(null);
    clearActivityTimestamp();
    await Promise.allSettled([
      logoutCurrentSession(),
      supabaseAuth.auth.signOut({ scope: "global" }),
    ]);
    clearStoredAuthSession();
  }, [applySession, clearActivityTimestamp]);

  useEffect(() => {
    let mounted = true;

    const { data } = supabaseAuth.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) {
        return;
      }

      applySupabaseSession(nextSession);
    });

    void restoreSession().finally(() => {
      if (mounted) {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      clearRefreshTimer();
      clearIdleTimer();
    };
  }, [applySupabaseSession, clearIdleTimer, clearRefreshTimer, restoreSession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_ACTIVITY_STORAGE_KEY || !event.newValue) {
        return;
      }

      const parsed = Number(event.newValue);
      if (Number.isFinite(parsed)) {
        lastActivityRef.current = parsed;
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    clearRefreshTimer();

    if (!session || session.provider !== "custom") {
      return;
    }

    const refreshDelay = Math.max(15_000, session.expiresAt * 1000 - Date.now() - 60_000);
    refreshTimerRef.current = window.setTimeout(() => {
      if (
        sessionRef.current?.idleTimeoutSeconds &&
        Date.now() - lastActivityRef.current >= sessionRef.current.idleTimeoutSeconds * 1000
      ) {
        void expireForInactivity();
        return;
      }

      void refreshAuthSession()
        .then((response) => {
          applySession(extractSessionFromResponse(response));
        })
        .catch(() => {
          if (isAuthSessionExpired(sessionRef.current)) {
            applySession(null);
          }
        });
    }, refreshDelay);

    return () => {
      clearRefreshTimer();
    };
  }, [applySession, clearRefreshTimer, expireForInactivity, session]);

  useEffect(() => {
    clearIdleTimer();

    if (!session?.idleTimeoutSeconds || typeof window === "undefined") {
      return;
    }

    const scheduleIdleTimeout = (activityTimestamp: number) => {
      const remainingMs = Math.max(
        1_000,
        session.idleTimeoutSeconds * 1000 - (Date.now() - activityTimestamp),
      );

      clearIdleTimer();
      idleTimerRef.current = window.setTimeout(() => {
        void expireForInactivity();
      }, remainingMs);
    };

    const handleActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      writeBrowserStorageItem("local", AUTH_ACTIVITY_STORAGE_KEY, String(now));
      scheduleIdleTimeout(now);
    };

    const handleStorageActivity = (event: StorageEvent) => {
      if (event.key !== AUTH_ACTIVITY_STORAGE_KEY || !event.newValue) {
        return;
      }

      const parsed = Number(event.newValue);
      if (!Number.isFinite(parsed)) {
        return;
      }

      lastActivityRef.current = parsed;
      scheduleIdleTimeout(parsed);
    };

    scheduleIdleTimeout(lastActivityRef.current);

    window.addEventListener("keydown", handleActivity, { passive: true });
    window.addEventListener("mousedown", handleActivity, { passive: true });
    window.addEventListener("mousemove", handleActivity, { passive: true });
    window.addEventListener("touchstart", handleActivity, { passive: true });
    window.addEventListener("focus", handleActivity, { passive: true });
    window.addEventListener("storage", handleStorageActivity);

    return () => {
      clearIdleTimer();
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      window.removeEventListener("focus", handleActivity);
      window.removeEventListener("storage", handleStorageActivity);
    };
  }, [clearIdleTimer, expireForInactivity, session]);

  const signIn = async (email: string, password: string) => {
    await supabaseAuth.auth.signOut({ scope: "local" }).catch(() => undefined);

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    if (!data.session?.user?.id) {
      throw new Error("Login succeeded but no session was returned.");
    }

    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.session.user.id);

    if (rolesError) {
      await supabaseAuth.auth.signOut({ scope: "local" }).catch(() => undefined);
      throw rolesError;
    }

    if ((roles ?? []).some((role) => role.role === "super_admin")) {
      await supabaseAuth.auth.signOut({ scope: "local" }).catch(() => undefined);
      throw new Error("Use the Super Admin login page to continue with OTP verification.");
    }

    applySupabaseSession(data.session);
    markSessionActivity();
  };

  const requestPasswordReset = async (email: string) => {
    const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
      redirectTo: buildAppRedirectUrl("/reset-password"),
    });

    if (error) {
      throw error;
    }
  };

  const sendOtp = async (phone: string) => requestOtp(phone);

  const verifyOtp = async (phone: string, otp: string) => {
    const response = await requestOtpVerification(phone, otp);
    await supabaseAuth.auth.signOut({ scope: "local" }).catch(() => undefined);
    applySession(response.session);
    markSessionActivity();
    return response;
  };

  const startSuperAdminLogin = async (email: string) =>
    requestSuperAdminLogin(email);

  const verifySuperAdminOtp = async (email: string, otp: string) => {
    const response = await requestSuperAdminOtpVerification(email, otp);
    await supabaseAuth.auth.signOut({ scope: "local" }).catch(() => undefined);
    applySession(response.session);
    markSessionActivity();
    return response;
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    phoneNumber?: string,
    options?: {
      referralCode?: string;
      affiliateCode?: string;
      accountType?: "library" | "partner" | "affiliate";
      partnerProfile?: {
        bankDetails?: Record<string, unknown>;
        city?: string;
        experience?: string;
        payoutMethod?: string;
        upiId?: string;
      };
    },
  ) => {
    const { data, error } = await supabaseAuth.auth.signUp({
      email,
      password,
      options: {
        data: {
          account_type: options?.accountType ?? null,
          affiliate_code: options?.affiliateCode ?? null,
          bank_details: options?.partnerProfile?.bankDetails ?? {},
          city: options?.partnerProfile?.city ?? null,
          experience: options?.partnerProfile?.experience ?? null,
          full_name: fullName,
          payout_method: options?.partnerProfile?.payoutMethod ?? null,
          phone_number: phoneNumber ?? null,
          referral_code: options?.referralCode ?? null,
          upi_id: options?.partnerProfile?.upiId ?? null,
        },
        emailRedirectTo: buildAppRedirectUrl("/"),
      },
    });

    if (error) {
      throw error;
    }

    if (data.session) {
      applySupabaseSession(data.session);
    }
  };

  const updatePassword = async (password: string) => {
    const { data, error } = await supabaseAuth.auth.updateUser({ password });
    if (error) {
      throw error;
    }

    if (data.user) {
      const { data: sessionData, error: sessionError } = await supabaseAuth.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }

      applySupabaseSession(sessionData.session);
      return;
    }

    applySupabaseSession(null);
  };

  const signOut = async () => {
    applySession(null);
    clearActivityTimestamp();
    await Promise.allSettled([
      logoutCurrentSession(),
      supabaseAuth.auth.signOut({ scope: "global" }),
    ]);
    clearStoredAuthSession();
  };

  const logoutAllDevices = async () => {
    const accessToken = sessionRef.current?.accessToken ?? null;
    applySession(null);
    clearActivityTimestamp();
    await Promise.allSettled([
      logoutAllSessions(accessToken),
      supabaseAuth.auth.signOut({ scope: "global" }),
    ]);
    clearStoredAuthSession();
  };

  const getCurrentSession = async () => sessionRef.current;

  return (
    <AuthContext.Provider
      value={{
        getCurrentSession,
        loading,
        logoutAllDevices,
        requestPasswordReset,
        sendOtp,
        session,
        signIn,
        signOut,
        signUp,
        startSuperAdminLogin,
        updatePassword,
        user,
        verifyOtp,
        verifySuperAdminOtp,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
