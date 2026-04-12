import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Shield,
  Smartphone,
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
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [deliveryChannel, setDeliveryChannel] = useState<"email" | "whatsapp" | null>(null);
  const [maskedDestination, setMaskedDestination] = useState("");
  const [error, setError] = useState("");
  const [stepLoading, setStepLoading] = useState<"credentials" | "otp" | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

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

  const handleCredentialsSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setStepLoading("credentials");

    try {
      const response = await startSuperAdminLogin(email.trim().toLowerCase(), password);
      setChallengeId(response.challengeId);
      setDeliveryChannel(response.channel);
      setMaskedDestination(response.maskedDestination);
      setOtp("");
      setExpiresAt(Date.now() + response.expiresIn * 1000);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to continue.";
      setError(message);
    } finally {
      setStepLoading(null);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challengeId) {
      setError("Restart the login flow and request a new OTP.");
      return;
    }

    setError("");
    setStepLoading("otp");

    try {
      await verifySuperAdminOtp(challengeId, otp);
      navigate(redirectTarget ?? SUPER_ADMIN_DASHBOARD_ROUTE, { replace: true });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to verify OTP.";
      setError(message);
      setOtp("");
    } finally {
      setStepLoading(null);
    }
  };

  const handleBackToCredentials = () => {
    setChallengeId("");
    setOtp("");
    setDeliveryChannel(null);
    setMaskedDestination("");
    setExpiresAt(null);
    setError("");
  };

  const isOtpStep = !!challengeId;

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
                  ? "Verify the 6-digit OTP to complete your secure sign-in."
                  : "Enter your super admin credentials to continue to OTP verification."}
              </p>
            </div>
          </div>

          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {!isOtpStep ? (
            <form className="space-y-4" onSubmit={handleCredentialsSubmit}>
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

              <div className="space-y-2">
                <Label className="text-zinc-300">Password</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 rounded-2xl border-zinc-700 bg-zinc-950 pr-12 text-zinc-100 placeholder:text-zinc-500"
                    placeholder="Enter your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-zinc-400 transition hover:text-zinc-200"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="h-12 w-full rounded-2xl bg-red-500 text-white hover:bg-red-400"
                disabled={stepLoading === "credentials"}
              >
                {stepLoading === "credentials" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <LockKeyhole className="mr-2 h-4 w-4" />
                    Continue
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form className="space-y-5" onSubmit={handleOtpSubmit}>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-300">
                <div className="flex items-center gap-2 font-medium text-zinc-100">
                  {deliveryChannel === "email" ? <Mail className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  OTP sent to {maskedDestination}
                </div>
                <p className="mt-2 text-zinc-400">
                  {secondsLeft > 0 ? `Code expires in ${formatCountdown(secondsLeft)}.` : "This code has expired. Request a new one."}
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
                  onClick={handleBackToCredentials}
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
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SuperAdminLoginPage;
