import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const OAUTH_REDIRECT_URL = "http://localhost:8080";
const SUPABASE_CALLBACK_URL = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/callback`;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
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
        city?: string;
        experience?: string;
        payoutMethod?: string;
        upiId?: string;
        bankDetails?: Record<string, unknown>;
      };
    },
  ) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  getCurrentSession: () => Promise<Session | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const clearStoredSession = async () => {
      setSession(null);
      setUser(null);
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        console.info("[auth] User signed out or session expired.");
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    const initializeSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!data.session) {
          setSession(null);
          setUser(null);
          return;
        }

        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          console.warn("[auth] Stored session is invalid, clearing it.", userError);
          await clearStoredSession();
          return;
        }

        setSession(data.session);
        setUser(userData.user);
      } catch (error) {
        console.error("[auth] Failed to restore session:", error);
        await clearStoredSession();
      } finally {
        setLoading(false);
      }
    };

    initializeSession();

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("[auth] Email sign-in failed:", error);
      throw error;
    }
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
        city?: string;
        experience?: string;
        payoutMethod?: string;
        upiId?: string;
        bankDetails?: Record<string, unknown>;
      };
    },
  ) => {
    const referralCode = options?.referralCode ?? null;
    const affiliateCode = options?.affiliateCode ?? null;
    const accountType = options?.accountType ?? null;
    const partnerProfile = options?.partnerProfile ?? null;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone_number: phoneNumber ?? null,
          referral_code: referralCode,
          affiliate_code: affiliateCode,
          account_type: accountType,
          city: partnerProfile?.city ?? null,
          experience: partnerProfile?.experience ?? null,
          payout_method: partnerProfile?.payoutMethod ?? null,
          upi_id: partnerProfile?.upiId ?? null,
          bank_details: partnerProfile?.bankDetails ?? {},
        },
        emailRedirectTo: OAUTH_REDIRECT_URL,
      },
    });
    if (error) {
      console.error("[auth] Email sign-up failed:", error);
      throw error;
    }
  };

  const signInWithGoogle = async () => {
    console.log("OAuth redirect URL:", "http://localhost:8080");
    console.log("Expected Google redirect_uri (Supabase callback):", SUPABASE_CALLBACK_URL);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "http://localhost:8080",
      },
    });
    if (error) {
      console.error("[auth] Google sign-in failed:", error);
      throw error;
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("[auth] Sign-out failed:", error);
      throw error;
    }
  };

  const getCurrentSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error("[auth] Get session failed:", error);
      throw error;
    }
    return data.session;
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signInWithGoogle, signOut, getCurrentSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
