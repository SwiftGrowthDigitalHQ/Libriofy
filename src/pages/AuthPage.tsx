import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Mail, Smartphone, TimerReset } from "lucide-react";

import InstallAppButton from "@/components/pwa/InstallAppButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { maskPhoneNumber, normalizePhoneNumber } from "@/lib/auth.shared";
import { DEFAULT_AUTH_LOGIN_VIEW, ENABLE_MOBILE_OTP_AUTH, type AuthLoginView } from "@/lib/authUiConfig";
import { SUPER_ADMIN_DASHBOARD_ROUTE } from "@/lib/superAdminPaths";
import { supabase, supabaseAuth } from "@/integrations/supabase/client";

type AuthPageProps = {
  initialMode?: "forgot-password" | "login" | "reset-password" | "signup" | "verify-phone";
};

type WebOtpCredentialLike = {
  code?: string;
};

const SHELL_GRADIENT = "radial-gradient(circle at top, rgba(56,189,248,0.18), transparent 38%), radial-gradient(circle at bottom, rgba(16,185,129,0.12), transparent 42%)";

const AuthShell = ({ children }: { children: ReactNode }) => (
  <div className="relative min-h-screen overflow-hidden bg-[#f8fafc] text-slate-950">
    <div className="absolute inset-0 opacity-80" style={{ background: SHELL_GRADIENT }} />
    <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(15,118,110,0.12),transparent_65%)]" />
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8 sm:px-6">
      <div className="relative z-10 w-full">{children}</div>
    </div>
  </div>
);

const SuccessPanel = () => (
  <motion.div
    initial={{ opacity: 0, y: 18, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    className="rounded-[1.75rem] border border-emerald-100 bg-white p-6 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
  >
    <motion.div
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 18 }}
      className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50"
    >
      <CheckCircle2 className="h-10 w-10 text-emerald-600" />
    </motion.div>
    <h2 className="mt-5 text-2xl font-semibold text-slate-950">Access granted</h2>
    <p className="mt-2 text-sm text-slate-500">Taking you to the dashboard.</p>
  </motion.div>
);

const LoginMethodButton = ({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
      active
        ? "bg-white text-slate-950 shadow-sm"
        : "text-slate-500 hover:text-slate-700"
    }`}
  >
    {icon}
    {label}
  </button>
);

const getRedirectPath = async (userId: string) => {
  const [{ data: roles }, { data: affiliate }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("affiliates" as any)
      .select("id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (roles?.some((role) => role.role === "super_admin")) {
    return SUPER_ADMIN_DASHBOARD_ROUTE;
  }

  if (roles?.some((role) => role.role === "partner") || affiliate) {
    return "/partner/dashboard";
  }

  return "/dashboard";
};

const useCountdown = (initial = 0) => {
  const [secondsLeft, setSecondsLeft] = useState(initial);

  useEffect(() => {
    if (secondsLeft <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  return { secondsLeft, setSecondsLeft };
};

const formatCountdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

type AuthMode = "forgot-password" | "login" | "reset-password" | "signup";

const AuthPage = ({ initialMode = "login" }: AuthPageProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { getCurrentSession, requestPasswordReset, sendOtp, signIn, signUp, updatePassword, verifyOtp } = useAuth();
  const routeState = location.state as { from?: string } | null;
  const initialAuthMode: AuthMode =
    initialMode === "signup"
      ? "signup"
      : initialMode === "forgot-password"
        ? "forgot-password"
        : initialMode === "reset-password"
          ? "reset-password"
          : "login";

  const [mode, setMode] = useState<AuthMode>(initialAuthMode);
  const [loginView, setLoginView] = useState<AuthLoginView>(DEFAULT_AUTH_LOGIN_VIEW);
  const [phone, setPhone] = useState(ENABLE_MOBILE_OTP_AUTH ? "+91" : "");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [deliveryChannel, setDeliveryChannel] = useState<"whatsapp" | "sms" | null>(null);
  const [busyAction, setBusyAction] = useState<"email" | "otp" | "reset-link" | "reset-password" | "send" | "signup" | null>(null);
  const [successState, setSuccessState] = useState(false);

  const [email, setEmail] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [passwordResetSentTo, setPasswordResetSentTo] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [signupName, setSignupName] = useState("");
  const [signupPhone, setSignupPhone] = useState(ENABLE_MOBILE_OTP_AUTH ? "+91" : "");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [checkingRecovery, setCheckingRecovery] = useState(initialAuthMode === "reset-password");
  const [recoveryReady, setRecoveryReady] = useState(initialAuthMode !== "reset-password");

  const otpSubmittingRef = useRef(false);
  const { secondsLeft, setSecondsLeft } = useCountdown(0);

  const affiliateRef = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("ref")?.trim() || params.get("affiliate")?.trim() || null;
  }, [location.search]);
  const showOtpChallenge = ENABLE_MOBILE_OTP_AUTH && otpSent;
  const showPhoneLogin = ENABLE_MOBILE_OTP_AUTH && loginView === "phone";

  const finishLogin = useCallback(async () => {
    const currentSession = await getCurrentSession();
    const userId = currentSession?.user.id;
    if (!userId) {
      navigate("/dashboard", { replace: true });
      return;
    }

    const requestedPath =
      typeof routeState?.from === "string" && routeState.from !== "/auth" && routeState.from !== "/login"
        ? routeState.from
        : null;
    const nextPath = requestedPath ?? await getRedirectPath(userId);

    if (import.meta.env.DEV) {
      console.log("[AuthPage] login redirect resolved", {
        currentRoute: location.pathname,
        currentUser: { email: currentSession?.user.email ?? null, id: userId },
        redirectTo: nextPath,
        requestedPath,
      });
    }

    setSuccessState(true);
    navigator.vibrate?.(45);
    window.setTimeout(() => {
      navigate(nextPath, { replace: true });
    }, 850);
  }, [getCurrentSession, location.pathname, navigate, routeState?.from]);

  const handleSendOtp = async () => {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      toast({
        title: "Invalid mobile number",
        description: "Use a number like +919876543210.",
        variant: "destructive",
      });
      return;
    }

    setBusyAction("send");
    try {
      const response = await sendOtp(normalizedPhone);
      setPhone(normalizedPhone);
      setOtp("");
      setOtpSent(true);
      setDeliveryChannel(response.channel);
      setSecondsLeft(response.retryAfter);
      toast({
        title: "OTP sent",
        description: response.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send OTP.";
      toast({
        title: "OTP send failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleVerifyOtp = useCallback(async () => {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone || otp.length < 6 || otpSubmittingRef.current) {
      return;
    }

    otpSubmittingRef.current = true;
    setBusyAction("otp");

    try {
      const response = await verifyOtp(normalizedPhone, otp);
      setDeliveryChannel(response.channel);
      toast({
        title: "Login successful",
        description: "Redirecting to your dashboard.",
      });
      await finishLogin();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify OTP.";
      toast({
        title: "OTP verification failed",
        description: message,
        variant: "destructive",
      });
      setOtp("");
    } finally {
      otpSubmittingRef.current = false;
      setBusyAction(null);
    }
  }, [finishLogin, otp, phone, toast, verifyOtp]);

  useEffect(() => {
    if (!otpSent || otp.length !== 6) {
      return;
    }

    void handleVerifyOtp();
  }, [handleVerifyOtp, otp, otpSent]);

  useEffect(() => {
    if (!otpSent || typeof window === "undefined" || !("OTPCredential" in window)) {
      return;
    }

    const controller = new AbortController();
    const credentialRequest = (navigator.credentials as CredentialsContainer & {
      get?: (options: { otp: { transport: string[] }; signal: AbortSignal }) => Promise<WebOtpCredentialLike | null>;
    }).get;

    if (!credentialRequest) {
      return () => controller.abort();
    }

    void credentialRequest.call(navigator.credentials, {
      otp: { transport: ["sms"] },
      signal: controller.signal,
    }).then((credential) => {
      if (credential?.code) {
        setOtp(credential.code.slice(0, 6));
      }
    }).catch(() => undefined);

    return () => controller.abort();
  }, [otpSent]);

  useEffect(() => {
    if (mode !== "reset-password") {
      setCheckingRecovery(false);
      setRecoveryReady(true);
      return;
    }

    let active = true;

    const syncRecoveryState = async () => {
      const { data, error } = await supabaseAuth.auth.getSession();
      if (!active) {
        return;
      }

      setRecoveryReady(!error && !!data.session);
      setCheckingRecovery(false);
    };

    const { data } = supabaseAuth.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) {
        return;
      }

      setRecoveryReady(!!nextSession);
      setCheckingRecovery(false);
    });

    void syncRecoveryState();

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [mode]);

  const openForgotPassword = () => {
    setMode("forgot-password");
    setLoginView("email");
    setForgotEmail(email.trim().toLowerCase());
    setPasswordResetSentTo("");
  };

  const handlePasswordResetRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = forgotEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      toast({
        title: "Enter your email",
        description: "Please enter the email linked to your account.",
        variant: "destructive",
      });
      return;
    }

    setBusyAction("reset-link");
    try {
      await requestPasswordReset(normalizedEmail);
      setPasswordResetSentTo(normalizedEmail);
      toast({
        title: "Reset link sent",
        description: "Check your email to set a new password.",
      });
    } catch (error) {
      toast({
        title: "Unable to send reset link",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handlePasswordUpdate = async (event: React.FormEvent) => {
    event.preventDefault();

    if (newPassword.trim().length < 6) {
      toast({
        title: "Password too short",
        description: "Use at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Enter the same password in both fields.",
        variant: "destructive",
      });
      return;
    }

    setBusyAction("reset-password");
    try {
      await updatePassword(newPassword);
      toast({
        title: "Password updated",
        description: "Redirecting to your dashboard.",
      });
      await finishLogin();
    } catch (error) {
      toast({
        title: "Unable to update password",
        description: error instanceof Error ? error.message : "Please request a new reset link.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleEmailLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusyAction("email");
    try {
      await signIn(email.trim().toLowerCase(), password);
      toast({
        title: "Login successful",
        description: "Redirecting to your dashboard.",
      });
      await finishLogin();
    } catch (error) {
      toast({
        title: "Email login failed",
        description: error instanceof Error ? error.message : "Unable to sign in.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSignup = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusyAction("signup");
    try {
      await signUp(
        signupEmail.trim().toLowerCase(),
        signupPassword,
        signupName.trim(),
        normalizePhoneNumber(signupPhone) || undefined,
        affiliateRef ? { affiliateCode: affiliateRef } : undefined,
      );

      toast({
        title: "Account created",
        description: "Check your inbox to confirm the account, then sign in.",
      });
      setMode("login");
      setLoginView(DEFAULT_AUTH_LOGIN_VIEW);
    } catch (error) {
      toast({
        title: "Signup failed",
        description: error instanceof Error ? error.message : "Unable to create your account.",
        variant: "destructive",
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (successState) {
    return (
      <AuthShell>
        <div className="flex min-h-[70vh] items-center justify-center">
          <SuccessPanel />
        </div>
      </AuthShell>
    );
  }

  if (mode === "forgot-password") {
    return (
      <AuthShell>
        <div className="mb-4 flex justify-end">
          <InstallAppButton variant="outline" size="sm" className="h-10 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            Install App
          </InstallAppButton>
        </div>
        <Card className="overflow-hidden rounded-[1.75rem] border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <CardContent className="space-y-6 p-6 sm:p-7">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setLoginView("email");
                  setPasswordResetSentTo("");
                }}
                className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </button>
              <div className="space-y-4 pt-2 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2f887a] text-white">
                  <Mail className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-3xl font-semibold text-slate-950">Forgot password</h1>
                  <p className="text-sm text-slate-500">We&apos;ll send you a reset link</p>
                </div>
              </div>
            </div>

            {passwordResetSentTo ? (
              <div className="space-y-4 rounded-[1.5rem] border border-emerald-100 bg-emerald-50 p-5 text-center">
                <p className="text-sm text-slate-700">
                  Reset link sent to <span className="font-medium text-slate-950">{passwordResetSentTo}</span>
                </p>
                <Button
                  type="button"
                  className="h-12 w-full rounded-xl bg-[#2f887a] text-white hover:bg-[#276f64]"
                  onClick={() => {
                    setMode("login");
                    setLoginView("email");
                    setEmail(passwordResetSentTo);
                    setPasswordResetSentTo("");
                  }}
                >
                  Back to sign in
                </Button>
                <button
                  type="button"
                  className="text-sm font-medium text-[#2f887a] hover:text-[#276f64]"
                  onClick={() => setPasswordResetSentTo("")}
                >
                  Use another email
                </button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handlePasswordResetRequest}>
                <div className="space-y-2">
                  <Label htmlFor="forgot-email" className="text-sm font-medium text-slate-700">Email</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    autoFocus
                    value={forgotEmail}
                    onChange={(event) => setForgotEmail(event.target.value)}
                    className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                    placeholder="Email"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="h-12 w-full rounded-xl bg-[#2f887a] text-white hover:bg-[#276f64]"
                  disabled={busyAction === "reset-link"}
                >
                  {busyAction === "reset-link" ? "Sending link..." : "Send reset link"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  if (mode === "reset-password") {
    return (
      <AuthShell>
        <div className="mb-4 flex justify-end">
          <InstallAppButton variant="outline" size="sm" className="h-10 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            Install App
          </InstallAppButton>
        </div>
        <Card className="overflow-hidden rounded-[1.75rem] border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <CardContent className="space-y-6 p-6 sm:p-7">
            <div className="space-y-4 pt-2 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2f887a] text-white">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h1 className="text-3xl font-semibold text-slate-950">Set new password</h1>
                <p className="text-sm text-slate-500">Create a fresh password for your account</p>
              </div>
            </div>

            {checkingRecovery ? (
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">
                Preparing your reset link...
              </div>
            ) : recoveryReady ? (
              <form className="space-y-4" onSubmit={handlePasswordUpdate}>
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="text-sm font-medium text-slate-700">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoFocus
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                    placeholder="New password"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-sm font-medium text-slate-700">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                    placeholder="Confirm password"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  className="h-12 w-full rounded-xl bg-[#2f887a] text-white hover:bg-[#276f64]"
                  disabled={busyAction === "reset-password"}
                >
                  {busyAction === "reset-password" ? "Updating password..." : "Update password"}
                </Button>
              </form>
            ) : (
              <div className="space-y-4 rounded-[1.5rem] border border-amber-100 bg-amber-50 p-5 text-center">
                <p className="text-sm text-slate-700">This reset link is invalid or has expired.</p>
                <Button
                  type="button"
                  className="h-12 w-full rounded-xl bg-[#2f887a] text-white hover:bg-[#276f64]"
                  onClick={() => {
                    void supabaseAuth.auth.signOut({ scope: "local" });
                    navigate("/auth", { replace: true });
                  }}
                >
                  Back to sign in
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  if (mode === "signup") {
    return (
      <AuthShell>
        <div className="mb-4 flex justify-end">
          <InstallAppButton variant="outline" size="sm" className="h-10 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            Install App
          </InstallAppButton>
        </div>
        <Card className="overflow-hidden rounded-[1.75rem] border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <CardContent className="space-y-6 p-6 sm:p-7">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setLoginView(DEFAULT_AUTH_LOGIN_VIEW);
                }}
                className="inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </button>
              <div className="space-y-4 pt-2 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2f887a] text-white">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-3xl font-semibold text-slate-950">Create account</h1>
                  <p className="text-sm text-slate-500">Set up your account</p>
                </div>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSignup}>
              <div className="space-y-2">
                <Label className="text-slate-700">Full name</Label>
                <Input
                  value={signupName}
                  onChange={(event) => setSignupName(event.target.value)}
                  className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                  placeholder="Varun Singh"
                  required
                />
              </div>
              {ENABLE_MOBILE_OTP_AUTH ? (
                <div className="space-y-2">
                  <Label className="text-slate-700">Mobile number</Label>
                  <Input
                    value={signupPhone}
                    onChange={(event) => setSignupPhone(event.target.value)}
                    className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                    placeholder="+919876543210"
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label className="text-slate-700">Email</Label>
                <Input
                  type="email"
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-700">Password</Label>
                <Input
                  type="password"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                  className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                  placeholder="Minimum 6 characters"
                  required
                />
              </div>

              <Button
                type="submit"
                className="h-12 w-full rounded-xl bg-[#2f887a] text-white hover:bg-[#276f64]"
                disabled={busyAction === "signup"}
              >
                {busyAction === "signup" ? "Creating account..." : "Create account"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-4 flex justify-end">
        <InstallAppButton variant="outline" size="sm" className="h-10 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
          Install App
        </InstallAppButton>
      </div>
      <Card className="overflow-hidden rounded-[1.75rem] border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <CardContent className="space-y-6 p-6 sm:p-7">
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2f887a] text-white">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Welcome back</h1>
              <p className="text-sm text-slate-500">Sign in to your Libriofy account</p>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {!showOtpChallenge ? (
              <motion.div
                key="phone-form"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="space-y-5"
              >
                {ENABLE_MOBILE_OTP_AUTH ? (
                  <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
                    <LoginMethodButton
                      active={loginView === "email"}
                      icon={<Mail className="h-4 w-4" />}
                      label="Email"
                      onClick={() => setLoginView("email")}
                    />
                    <LoginMethodButton
                      active={loginView === "phone"}
                      icon={<Smartphone className="h-4 w-4" />}
                      label="Mobile OTP"
                      onClick={() => setLoginView("phone")}
                    />
                  </div>
                ) : null}

                <AnimatePresence mode="wait" initial={false}>
                  {showPhoneLogin ? (
                    <motion.div
                      key="mobile-login"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="space-y-4"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="phone-login" className="text-sm font-medium text-slate-700">Mobile number</Label>
                        <Input
                          id="phone-login"
                          autoFocus={showPhoneLogin}
                          inputMode="tel"
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                          className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                          placeholder="+91 98765 43210"
                        />
                        <p className="text-sm text-slate-500">OTP will be sent via WhatsApp/SMS</p>
                      </div>

                      <Button
                        type="button"
                        className="h-12 w-full rounded-xl bg-[#2f887a] text-base font-medium text-white hover:bg-[#276f64]"
                        onClick={() => void handleSendOtp()}
                        disabled={busyAction === "send"}
                      >
                        {busyAction === "send" ? "Sending OTP..." : "Continue"}
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.form
                      key="email-login"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      onSubmit={handleEmailLogin}
                      className="space-y-4"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="email-login" className="text-sm font-medium text-slate-700">Email</Label>
                        <Input
                          id="email-login"
                          type="email"
                          autoFocus={!showPhoneLogin}
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                          placeholder="Email"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="password-login" className="text-sm font-medium text-slate-700">Password</Label>
                        <Input
                          id="password-login"
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className="h-12 rounded-xl border-slate-200 bg-white text-slate-950 placeholder:text-slate-400"
                          placeholder="Password"
                          required
                        />
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={openForgotPassword}
                          className="text-sm font-medium text-[#2f887a] hover:text-[#276f64]"
                        >
                          Forgot password?
                        </button>
                      </div>

                      <Button
                        type="submit"
                        className="h-12 w-full rounded-xl bg-[#2f887a] text-white hover:bg-[#276f64]"
                        disabled={busyAction === "email"}
                      >
                        {busyAction === "email" ? "Signing in..." : "Sign in"}
                      </Button>
                    </motion.form>
                  )}
                </AnimatePresence>

                <p className="text-center text-sm text-slate-500">
                  <button type="button" onClick={() => setMode("signup")} className="font-medium text-[#2f887a] hover:text-[#276f64]">
                    Create account
                  </button>
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="otp-form"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="space-y-4"
              >
                <div className="space-y-2 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2f887a] text-white">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <h2 className="text-3xl font-semibold text-slate-950">Enter OTP</h2>
                  <p className="text-sm text-slate-500">{maskPhoneNumber(phone)}</p>
                  <p className="text-sm text-slate-500">
                    Sent via <span className="font-medium text-slate-950">{deliveryChannel === "sms" ? "SMS" : "WhatsApp"}</span>
                  </p>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                  <button
                    type="button"
                    onClick={() => {
                      setOtpSent(false);
                      setOtp("");
                      setBusyAction(null);
                      setLoginView(DEFAULT_AUTH_LOGIN_VIEW);
                    }}
                    className="mb-5 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-800"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>

                  <div className="flex justify-center">
                    <InputOTP
                      autoFocus
                      maxLength={6}
                      value={otp}
                      onChange={setOtp}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    >
                      <InputOTPGroup className="gap-2">
                        {[0, 1, 2, 3, 4, 5].map((index) => (
                          <InputOTPSlot
                            key={index}
                            index={index}
                            className="h-14 w-12 rounded-xl border-slate-200 bg-white text-lg text-slate-950"
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  <div className="mt-6 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
                    <div className="flex items-center gap-2 text-slate-600">
                      <TimerReset className="h-4 w-4 text-[#2f887a]" />
                      {secondsLeft > 0 ? `Resend in ${formatCountdown(secondsLeft)}` : "Resend OTP"}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSendOtp()}
                      disabled={secondsLeft > 0 || busyAction === "send"}
                      className="font-medium text-[#2f887a] transition hover:text-[#276f64] disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      Resend
                    </button>
                  </div>

                  <Button
                    type="button"
                    className="mt-4 h-12 w-full rounded-xl bg-[#2f887a] text-white hover:bg-[#276f64]"
                    onClick={() => void handleVerifyOtp()}
                    disabled={busyAction === "otp" || otp.length < 6}
                  >
                    {busyAction === "otp" ? "Verifying..." : "Continue"}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </AuthShell>
  );
};

export default AuthPage;
