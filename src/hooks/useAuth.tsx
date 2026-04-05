/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import {
  extractSessionFromResponse,
  loginWithEmail,
  logoutAllSessions,
  logoutCurrentSession,
  refreshAuthSession,
  sendOtp as requestOtp,
  verifyOtp as requestOtpVerification,
} from "@/lib/authApi";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
} from "@/lib/authSession";
import {
  isAuthSessionExpired,
  type AuthUser,
  type ClientAuthSession,
  type SendOtpResponse,
  type VerifyOtpResponse,
} from "@/lib/auth.shared";
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
  updatePassword: (password: string) => Promise<void>;
  user: AuthUser | null;
  verifyOtp: (phone: string, otp: string) => Promise<VerifyOtpResponse>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const basePath = normalizeBasePath(import.meta.env.BASE_URL);
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  const resolvedBasePath = basePath === "/" ? "" : basePath;

  if (import.meta.env.VITE_USE_HASH_ROUTER === "true") {
    return `${origin}${resolvedBasePath}/#${normalizedRoute}`;
  }

  return `${origin}${resolvedBasePath}${normalizedRoute}`;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<ClientAuthSession | null>(() => getStoredAuthSession());
  const [user, setUser] = useState<AuthUser | null>(() => getStoredAuthSession()?.user ?? null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<ClientAuthSession | null>(getStoredAuthSession());
  const refreshTimerRef = useRef<number | null>(null);

  const applySession = useCallback((nextSession: ClientAuthSession | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    setStoredAuthSession(nextSession);
    void supabase.realtime.setAuth(nextSession?.accessToken ?? "");
  }, []);

  const applySupabaseSession = useCallback((nextSession: Session | null) => {
    if (!nextSession) {
      if (sessionRef.current?.provider === "supabase") {
        applySession(null);
      }
      return;
    }

    applySession({
      accessToken: nextSession.access_token,
      expiresAt: nextSession.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      loginMethod: "email",
      provider: "supabase",
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
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, [applySupabaseSession, restoreSession]);

  useEffect(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!session || session.provider !== "custom") {
      return;
    }

    const refreshDelay = Math.max(15_000, session.expiresAt * 1000 - Date.now() - 60_000);
    refreshTimerRef.current = window.setTimeout(() => {
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
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [applySession, session]);

  const signIn = async (email: string, password: string) => {
    const response = await loginWithEmail(email, password);
    await supabaseAuth.auth.signOut({ scope: "local" }).catch(() => undefined);
    applySession(extractSessionFromResponse(response));
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
        emailRedirectTo: window.location.origin,
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

    if (data.session) {
      applySupabaseSession(data.session);
      return;
    }

    const { data: sessionData, error: sessionError } = await supabaseAuth.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }

    applySupabaseSession(sessionData.session);
  };

  const signOut = async () => {
    applySession(null);
    await Promise.allSettled([
      logoutCurrentSession(),
      supabaseAuth.auth.signOut({ scope: "global" }),
    ]);
    clearStoredAuthSession();
  };

  const logoutAllDevices = async () => {
    const accessToken = sessionRef.current?.accessToken ?? null;
    applySession(null);
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
        updatePassword,
        user,
        verifyOtp,
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
