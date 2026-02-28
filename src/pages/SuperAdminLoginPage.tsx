import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Shield, Mail, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SuperAdminLoginPage = () => {
  const [identifier, setIdentifier] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState<"email" | "phone">("email");
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSendOtp = async () => {
    if (!identifier) return;
    setLoading(true);
    try {
      if (method === "email") {
        const { error } = await supabase.auth.signInWithOtp({ email: identifier });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({ phone: identifier });
        if (error) throw error;
      }
      setOtpSent(true);
      toast({ title: "OTP Sent", description: `Verification code sent to your ${method}.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    try {
      let result;
      if (method === "email") {
        result = await supabase.auth.verifyOtp({ email: identifier, token: otp, type: "email" });
      } else {
        result = await supabase.auth.verifyOtp({ phone: identifier, token: otp, type: "sms" });
      }
      if (result.error) throw result.error;

      // Verify super_admin role
      const user = result.data.user;
      if (!user) throw new Error("Authentication failed");

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "super_admin");

      if (!roles || roles.length === 0) {
        await supabase.auth.signOut();
        toast({ title: "Access Denied", description: "You are not authorized as Super Admin.", variant: "destructive" });
        return;
      }

      navigate("/admin");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-md border-zinc-800 bg-zinc-900 text-zinc-100">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center mb-4">
            <Shield className="w-7 h-7 text-red-400" />
          </div>
          <CardTitle className="text-2xl font-bold text-zinc-100">Super Admin Access</CardTitle>
          <CardDescription className="text-zinc-400">Authorized personnel only</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="email" onValueChange={(v) => { setMethod(v as "email" | "phone"); setOtpSent(false); setOtp(""); setIdentifier(""); }}>
            <TabsList className="grid w-full grid-cols-2 bg-zinc-800">
              <TabsTrigger value="email" className="gap-1.5 data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100 text-zinc-400">
                <Mail className="w-3.5 h-3.5" /> Email OTP
              </TabsTrigger>
              <TabsTrigger value="phone" className="gap-1.5 data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100 text-zinc-400">
                <Smartphone className="w-3.5 h-3.5" /> Mobile OTP
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email">
              <div className="space-y-4 pt-2">
                {!otpSent ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="sa-email" className="text-zinc-300">Email Address</Label>
                      <Input
                        id="sa-email"
                        type="email"
                        placeholder="admin@libriofy.com"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                      />
                    </div>
                    <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={handleSendOtp} disabled={loading || !identifier}>
                      {loading ? "Sending..." : "Send OTP"}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-zinc-400 text-center">Enter the 6-digit code sent to {identifier}</p>
                    <div className="flex justify-center">
                      <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                        <InputOTPGroup>
                          {[0,1,2,3,4,5].map(i => (
                            <InputOTPSlot key={i} index={i} className="border-zinc-700 bg-zinc-800 text-zinc-100" />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={handleVerifyOtp} disabled={loading || otp.length < 6}>
                      {loading ? "Verifying..." : "Verify & Login"}
                    </Button>
                    <button onClick={() => { setOtpSent(false); setOtp(""); }} className="text-sm text-red-400 hover:underline w-full text-center">
                      Change email
                    </button>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="phone">
              <div className="space-y-4 pt-2">
                {!otpSent ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="sa-phone" className="text-zinc-300">Mobile Number</Label>
                      <Input
                        id="sa-phone"
                        type="tel"
                        placeholder="+91XXXXXXXXXX"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                      />
                    </div>
                    <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={handleSendOtp} disabled={loading || !identifier}>
                      {loading ? "Sending..." : "Send OTP"}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-zinc-400 text-center">Enter the 6-digit code sent to {identifier}</p>
                    <div className="flex justify-center">
                      <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                        <InputOTPGroup>
                          {[0,1,2,3,4,5].map(i => (
                            <InputOTPSlot key={i} index={i} className="border-zinc-700 bg-zinc-800 text-zinc-100" />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={handleVerifyOtp} disabled={loading || otp.length < 6}>
                      {loading ? "Verifying..." : "Verify & Login"}
                    </Button>
                    <button onClick={() => { setOtpSent(false); setOtp(""); }} className="text-sm text-red-400 hover:underline w-full text-center">
                      Change number
                    </button>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <p className="text-xs text-zinc-500 text-center pt-2">
            This portal is restricted to Super Admin access only. Unauthorized attempts are logged.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SuperAdminLoginPage;
