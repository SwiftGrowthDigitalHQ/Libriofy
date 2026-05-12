import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Mail,
  Shield,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { SUPER_ADMIN_DASHBOARD_ROUTE, sanitizeSuperAdminRedirectPath } from "@/lib/superAdminPaths";

const formatCountdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const SuperAdminLoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { startSuperAdminLogin, verifySuperAdminOtp } = useAuth();
  const routeState = location.state as { from?: string } | null;

  const redirectTarget = useMemo(() => {
    const stateRedirect = sanitizeSuperAdminRedirectPath(routeState?.from);
    if (stateRedirect) {
      return stateRedirect;
    }

    return sanitizeSuperAdminRedirectPath(new URLSearchParams(location.search).get("redirect"));
  }, [location.search, routeState?.from]);

  const [email, setEmail] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [maskedDestination, setMaskedDestination] = useState("");
  const [error, setError] = useState("");
  const [verifyDebugMeta, setVerifyDebugMeta] = useState<{
    code: string | null;
    detail: string | null;
    failureCategory: string | null;
    requestId: string | null;
    status: number | null;
  } | null>(null);
  const [stepLoading, setStepLoading] = useState<"email" | "otp" | "resend" | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState<number | null>(null);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(0);
      return;
    }

    const updateCountdown = () => {
      setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [expiresAt]);

  useEffect(() => {
    if (!resendAvailableAt) {
      setResendSecondsLeft(0);
      return;
    }

    const updateCountdown = () => {
      setResendSecondsLeft(Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)));
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [resendAvailableAt]);

  const sendOtpToEmail = async (resend = false) => {
    const normalizedEmail = email.trim().toLowerCase();
    setError("");
    setVerifyDebugMeta(null);
    setStepLoading(resend ? "resend" : "email");

    try {
      const response = await startSuperAdminLogin(normalizedEmail);
      setEmail(response.email);
      setOtpEmail(response.email);
      setMaskedDestination(response.maskedDestination);
      setOtp("");
      setExpiresAt(Date.now() + response.expiresIn * 1000);
      setResendAvailableAt(Date.now() + response.retryAfter * 1000);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to send OTP.";
      setError(message);
    } finally {
      setStepLoading(null);
    }
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await sendOtpToEmail(false);
  };

  const handleOtpSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = otpEmail || email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your super admin email again to continue.");
      return;
    }

    setError("");
    setVerifyDebugMeta(null);
    setStepLoading("otp");

    try {
      await verifySuperAdminOtp(normalizedEmail, otp);
      navigate(redirectTarget ?? SUPER_ADMIN_DASHBOARD_ROUTE, { replace: true });
    } catch (submitError) {
      // #region agent log
      console.error("[agent-log] super-admin verify failed", {
        code: (submitError as { code?: string })?.code ?? null,
        detail: (submitError as { detail?: string })?.detail ?? null,
        failureCategory: (submitError as { failureCategory?: string })?.failureCategory ?? null,
        message: submitError instanceof Error ? submitError.message : String(submitError),
        requestId: (submitError as { requestId?: string })?.requestId ?? null,
        status: (submitError as { status?: number })?.status ?? null,
      });
      // #endregion
      setVerifyDebugMeta({
        code: (submitError as { code?: string })?.code ?? null,
        detail: (submitError as { detail?: string })?.detail ?? null,
        failureCategory: (submitError as { failureCategory?: string })?.failureCategory ?? null,
        requestId: (submitError as { requestId?: string })?.requestId ?? null,
        status: (submitError as { status?: number })?.status ?? null,
      });
      const message = submitError instanceof Error ? submitError.message : "Unable to verify OTP.";
      setError(message);
      setOtp("");
    } finally {
      setStepLoading(null);
    }
  };

  const handleBackToEmail = () => {
    setOtpEmail("");
    setOtp("");
    setMaskedDestination("");
    setExpiresAt(null);
    setResendAvailableAt(null);
    setError("");
  };

  const isOtpStep = !!otpEmail;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-md overflow-hidden rounded-[2rem] border-zinc-800 bg-zinc-900 shadow-[0_35px_100px_rgba(0,0,0,0.55)]">
        <CardContent className="space-y-6 p-6 sm:p-7">
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-red-500/20 bg-red-500/10">
              <Shield className="h-8 w-8 text-red-300" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-red-200/80">Restricted</p>
              <h1 className="mt-2 text-3xl font-semibold text-zinc-100">Super Admin Login</h1>
              <p className="mt-2 text-sm text-zinc-400">
                {isOtpStep
                  ? "Enter the 6-digit OTP from your inbox to finish signing in."
                  : "Enter your approved Super Admin email to receive a one-time login code."}
              </p>
            </div>
          </div>

          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
          {verifyDebugMeta ? (
            <div className="rounded-2xl border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
              <p className="font-medium text-zinc-200">Debug verify payload</p>
              <p>status: {verifyDebugMeta.status ?? "null"}</p>
              <p>code: {verifyDebugMeta.code ?? "null"}</p>
              <p>failureCategory: {verifyDebugMeta.failureCategory ?? "null"}</p>
              <p>detail: {verifyDebugMeta.detail ?? "null"}</p>
              <p>requestId: {verifyDebugMeta.requestId ?? "null"}</p>
            </div>
          ) : null}

          {!isOtpStep ? (
            <form className="space-y-4" onSubmit={handleEmailSubmit}>
              <div className="space-y-2">
                <Label className="text-zinc-300">Email address</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-12 rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500"
                  placeholder="Enter your admin email"
                  required
                />
              </div>

              <Button
                type="submit"
                className="h-12 w-full rounded-2xl bg-red-500 text-white hover:bg-red-400"
                disabled={stepLoading === "email" || stepLoading === "resend"}
              >
                {stepLoading === "email" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending OTP...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send OTP
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={handleOtpSubmit}>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-300">
                <div className="flex items-center gap-2 font-medium text-zinc-100">
                  <Mail className="h-4 w-4" />
                  OTP sent to {maskedDestination}
                </div>
                <p className="mt-2 text-zinc-400">
                  {secondsLeft > 0 ? `Code expires in ${formatCountdown(secondsLeft)}.` : "This code has expired. Request a new OTP."}
                </p>
                <p className="mt-1 text-zinc-500">
                  {resendSecondsLeft > 0
                    ? `You can request another OTP in ${formatCountdown(resendSecondsLeft)}.`
                    : "You can request another OTP if you did not receive it."}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-zinc-300">Enter OTP</Label>
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup className="grid w-full grid-cols-6 gap-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <InputOTPSlot
                        key={index}
                        index={index}
                        className="h-12 w-full rounded-2xl border border-zinc-700 bg-zinc-950 text-zinc-100"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 flex-1 rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800"
                  onClick={handleBackToEmail}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  type="submit"
                  className="h-12 flex-1 rounded-2xl bg-red-500 text-white hover:bg-red-400"
                  disabled={otp.length !== 6 || stepLoading === "otp" || secondsLeft === 0}
                >
                  {stepLoading === "otp" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    "Verify OTP"
                  )}
                </Button>
              </div>

              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full rounded-2xl text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                disabled={resendSecondsLeft > 0 || stepLoading === "email" || stepLoading === "resend"}
                onClick={() => {
                  void sendOtpToEmail(true);
                }}
              >
                {stepLoading === "resend" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resending OTP...
                  </>
                ) : (
                  "Resend OTP"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SuperAdminLoginPage;
