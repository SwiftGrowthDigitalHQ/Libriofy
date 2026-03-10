import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Mail, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";

const SUPER_ADMIN_EMAIL = "shop43851@gmail.com";

type ProfileAccessRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "user_id" | "email">;

const getReadableOtpError = (message: string): string => {
  const lower = message.toLowerCase();

  if (lower.includes("signups not allowed for otp")) {
    return "Unable to send OTP for the super admin email. Check that email OTP sign-in and email signups are enabled in Supabase Auth.";
  }

  if (lower.includes("invalid") || lower.includes("expired")) {
    return "Invalid or expired OTP. Please try again.";
  }

  return message;
};

const SuperAdminLoginPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = useState(SUPER_ADMIN_EMAIL);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const validateAdminEmail = (): boolean => {
    if (!normalizedEmail) {
      setError("Email is required.");
      return false;
    }

    if (normalizedEmail !== SUPER_ADMIN_EMAIL) {
      setError("Access denied. Only authorized Super Admin email can sign in.");
      return false;
    }

    return true;
  };

  const handleSendOtp = async () => {
    setError("");
    if (!validateAdminEmail()) return;

    try {
      setLoading(true);
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
      });

      if (otpError) throw otpError;

      setOtpSent(true);
      toast({ title: "OTP sent", description: `Verification code sent to ${normalizedEmail}` });
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "Unable to send OTP.";
      const message = getReadableOtpError(rawMessage);
      setError(message);
      toast({ title: "Send OTP failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError("");
    if (!validateAdminEmail()) return;

    if (otp.length < 6) {
      setError("Please enter 6-digit OTP.");
      return;
    }

    try {
      setLoading(true);

      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: otp,
        type: "email",
      });

      if (verifyError) {
        setError(getReadableOtpError(verifyError.message));
        return;
      }

      const user = data.user;
      if (!user) {
        setError("Authentication failed. Please try again.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("user_id, email")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profileError) throw profileError;

      const typedProfile = profile as ProfileAccessRow | null;
      if (!typedProfile || (typedProfile.email || "").toLowerCase() !== SUPER_ADMIN_EMAIL) {
        await supabase.auth.signOut();
        setError("Access denied. Profile is not authorized for Super Admin access.");
        return;
      }

      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "super_admin")
        .limit(1);

      if (roleError) throw roleError;

      if (!roleRows || roleRows.length === 0) {
        await supabase.auth.signOut();
        setError("Access denied. You are not authorized as Super Admin.");
        return;
      }

      toast({ title: "Login successful", description: "Welcome Super Admin" });
      navigate("/admin", { replace: true });
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "OTP verification failed.";
      const message = getReadableOtpError(rawMessage);
      setError(message);
      toast({ title: "Verify OTP failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center">
            <Shield className="w-7 h-7 text-red-400" />
          </div>
          <CardTitle className="text-2xl font-bold text-zinc-100">Super Admin Login</CardTitle>
          <CardDescription className="text-zinc-400">Email OTP verification</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-red-900/30 border border-red-800/50 text-red-300 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-zinc-300 flex items-center gap-2">
              <Mail className="w-4 h-4" /> Email Address
            </Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="shop43851@gmail.com"
              className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
            />
          </div>

          {!otpSent ? (
            <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={() => void handleSendOtp()} disabled={loading || !normalizedEmail}>
              {loading ? "Sending OTP..." : "Send OTP"}
            </Button>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400 text-center">Enter the 6-digit OTP sent to {normalizedEmail}</p>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <InputOTPSlot key={index} index={index} className="border-zinc-700 bg-zinc-800 text-zinc-100" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={() => void handleVerifyOtp()} disabled={loading || otp.length < 6}>
                {loading ? "Verifying..." : "Verify OTP"}
              </Button>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setError("");
                  }}
                  className="text-sm text-red-400 hover:underline"
                >
                  Change email
                </button>
                <button
                  type="button"
                  onClick={() => void handleSendOtp()}
                  disabled={loading}
                  className="text-sm text-zinc-300 hover:underline disabled:opacity-50"
                >
                  Resend OTP
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SuperAdminLoginPage;
