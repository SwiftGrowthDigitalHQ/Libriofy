import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { BookOpen, Mail, Smartphone, Chrome, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

const AuthPage = () => {
  // Mode: "login" | "signup" | "verify-phone"
  const [mode, setMode] = useState<"login" | "signup" | "verify-phone">("login");

  // Email login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Signup
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [signupOtpSent, setSignupOtpSent] = useState(false);
  const [signupOtp, setSignupOtp] = useState("");

  // Mobile OTP login
  const [loginPhone, setLoginPhone] = useState("");
  const [loginOtpSent, setLoginOtpSent] = useState(false);
  const [loginOtp, setLoginOtp] = useState("");

  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const redirectAfterLogin = useCallback(async () => {
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    if (!currentUser) { navigate("/dashboard"); return; }
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", currentUser.id);
    if (roles?.some((r) => r.role === "super_admin")) {
      navigate("/admin");
    } else {
      navigate("/dashboard");
    }
  }, [navigate]);

  // --- Email + Password Login ---
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      await redirectAfterLogin();
    } catch (err: any) {
      toast({ title: "Login Failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // --- Mobile OTP Login ---
  const handleSendLoginOtp = async () => {
    if (!loginPhone) return;
    setLoading(true);
    try {
      // Check if phone exists in profiles
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("phone_number", loginPhone)
        .maybeSingle();

      if (!profile) {
        toast({ title: "Account not found", description: "No account registered with this number. Please sign up first.", variant: "destructive" });
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({ phone: loginPhone });
      if (error) throw error;
      setLoginOtpSent(true);
      toast({ title: "OTP Sent", description: "Check your phone for the verification code." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyLoginOtp = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: loginPhone, token: loginOtp, type: "sms" });
      if (error) {
        if (error.message.toLowerCase().includes("invalid") || error.message.toLowerCase().includes("expired")) {
          toast({ title: "Invalid OTP", description: "The code is incorrect or has expired. Please try again.", variant: "destructive" });
        } else {
          throw error;
        }
        setLoading(false);
        return;
      }
      await redirectAfterLogin();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // --- Google Login ---
  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (error) throw error;
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // --- Signup: Send phone OTP ---
  const handleSendSignupOtp = async () => {
    if (!signupPhone) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: signupPhone });
      if (error) throw error;
      setSignupOtpSent(true);
      toast({ title: "OTP Sent", description: "Enter the code sent to your phone." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // --- Signup: Verify phone OTP ---
  const handleVerifySignupOtp = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: signupPhone, token: signupOtp, type: "sms" });
      if (error) {
        toast({ title: "Invalid OTP", description: "The code is incorrect or has expired.", variant: "destructive" });
        setLoading(false);
        return;
      }
      // Sign out the phone-auth session; we'll create the real account with email
      await supabase.auth.signOut();
      setPhoneVerified(true);
      setSignupOtpSent(false);
      setMode("signup");
      toast({ title: "Phone verified!", description: "Complete your signup below." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // --- Signup: Create account ---
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneVerified) {
      setMode("verify-phone");
      return;
    }
    setLoading(true);
    try {
      await signUp(signupEmail, signupPassword, signupName);
      // Update profile with phone after signup
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("profiles").update({
          phone_number: signupPhone,
          is_phone_verified: true,
        }).eq("user_id", user.id);
      }
      toast({ title: "Account created!", description: "Check your email to confirm, then sign in." });
      setMode("login");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // --- Render: Phone Verification Step ---
  if (mode === "verify-phone") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-4">
              <Smartphone className="w-6 h-6 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl">Verify Your Phone</CardTitle>
            <CardDescription>We need to verify your mobile number before creating your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!signupOtpSent ? (
              <>
                <div className="space-y-2">
                  <Label>Mobile Number</Label>
                  <Input
                    type="tel"
                    placeholder="+91XXXXXXXXXX"
                    value={signupPhone}
                    onChange={(e) => setSignupPhone(e.target.value)}
                  />
                </div>
                <Button className="w-full" onClick={handleSendSignupOtp} disabled={loading || !signupPhone}>
                  {loading ? "Sending..." : "Send OTP"}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground text-center">
                  Enter the 6-digit code sent to {signupPhone}
                </p>
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={signupOtp} onChange={setSignupOtp}>
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <Button className="w-full" onClick={handleVerifySignupOtp} disabled={loading || signupOtp.length < 6}>
                  {loading ? "Verifying..." : "Verify Phone"}
                </Button>
                <button
                  onClick={() => { setSignupOtpSent(false); setSignupOtp(""); }}
                  className="text-sm text-primary hover:underline w-full text-center block"
                >
                  Change number
                </button>
              </>
            )}
            <button
              onClick={() => setMode("signup")}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mx-auto"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to signup
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Render: Signup ---
  if (mode === "signup") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-4">
              <BookOpen className="w-6 h-6 text-primary-foreground" />
            </div>
            <CardTitle className="text-2xl">Create Account</CardTitle>
            <CardDescription>Get started with Libriofy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={loading}>
              <Chrome className="w-4 h-4 mr-2" /> Sign up with Google
            </Button>
            <div className="relative">
              <Separator />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">or</span>
            </div>
            <form onSubmit={handleSignup} className="space-y-3">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input value={signupName} onChange={(e) => setSignupName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="space-y-2">
                <Label>Mobile Number</Label>
                <div className="flex gap-2">
                  <Input
                    type="tel"
                    placeholder="+91XXXXXXXXXX"
                    value={signupPhone}
                    onChange={(e) => setSignupPhone(e.target.value)}
                    required
                    className="flex-1"
                  />
                  {phoneVerified ? (
                    <span className="inline-flex items-center text-xs font-medium text-green-600 bg-green-50 px-2.5 rounded-md border border-green-200">
                      Verified ✓
                    </span>
                  ) : (
                    <Button type="button" variant="outline" size="sm" onClick={() => setMode("verify-phone")} disabled={!signupPhone}>
                      Verify
                    </Button>
                  )}
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading || !phoneVerified}>
                {loading ? "Creating..." : "Create Account"}
              </Button>
              {!phoneVerified && (
                <p className="text-xs text-muted-foreground text-center">
                  Please verify your mobile number to continue
                </p>
              )}
            </form>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <button onClick={() => setMode("login")} className="text-primary font-medium hover:underline">Sign in</button>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Render: Login ---
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-4">
            <BookOpen className="w-6 h-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to your Libriofy account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={loading}>
            <Chrome className="w-4 h-4 mr-2" /> Continue with Google
          </Button>

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">or</span>
          </div>

          <Tabs defaultValue="email" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="email" className="gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</TabsTrigger>
              <TabsTrigger value="mobile" className="gap-1.5"><Smartphone className="w-3.5 h-3.5" /> Mobile OTP</TabsTrigger>
            </TabsList>

            <TabsContent value="email">
              <form onSubmit={handleEmailLogin} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="mobile">
              <div className="space-y-4 pt-2">
                {!loginOtpSent ? (
                  <>
                    <div className="space-y-2">
                      <Label>Mobile Number</Label>
                      <Input
                        type="tel"
                        placeholder="+91XXXXXXXXXX"
                        value={loginPhone}
                        onChange={(e) => setLoginPhone(e.target.value)}
                      />
                    </div>
                    <Button className="w-full" onClick={handleSendLoginOtp} disabled={loading || !loginPhone}>
                      {loading ? "Sending..." : "Send OTP"}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center">
                      Enter the 6-digit code sent to {loginPhone}
                    </p>
                    <div className="flex justify-center">
                      <InputOTP maxLength={6} value={loginOtp} onChange={setLoginOtp}>
                        <InputOTPGroup>
                          {[0, 1, 2, 3, 4, 5].map((i) => (
                            <InputOTPSlot key={i} index={i} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <Button className="w-full" onClick={handleVerifyLoginOtp} disabled={loading || loginOtp.length < 6}>
                      {loading ? "Verifying..." : "Verify & Login"}
                    </Button>
                    <button
                      onClick={() => { setLoginOtpSent(false); setLoginOtp(""); }}
                      className="text-sm text-primary hover:underline w-full text-center block"
                    >
                      Change number
                    </button>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <button onClick={() => setMode("signup")} className="text-primary font-medium hover:underline">Sign up</button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthPage;
