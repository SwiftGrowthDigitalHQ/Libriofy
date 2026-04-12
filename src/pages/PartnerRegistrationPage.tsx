import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase, supabaseAuth } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { getReferralLink } from "@/lib/partnerLinks";

const PartnerRegistrationPage = () => {
  const { toast } = useToast();
  const { signUp } = useAuth();

  const [loading, setLoading] = useState(false);
  const [partnerCode, setPartnerCode] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [experience, setExperience] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [payoutMethod, setPayoutMethod] = useState<"upi" | "bank">("upi");
  const [upiId, setUpiId] = useState("");

  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [bankName, setBankName] = useState("");

  const validate = () => {
    if (!name.trim()) return "Name is required.";
    if (!phone.trim()) return "Phone is required.";
    if (!email.trim()) return "Email is required.";
    if (!city.trim()) return "City is required.";
    if (!password) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirmPassword) return "Passwords do not match.";

    if (payoutMethod === "upi") {
      if (!upiId.trim()) return "UPI ID is required.";
    } else {
      if (!bankAccountName.trim()) return "Account holder name is required.";
      if (!bankAccountNumber.trim()) return "Account number is required.";
      if (!bankIfsc.trim()) return "IFSC code is required.";
      if (!bankName.trim()) return "Bank name is required.";
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errorMessage = validate();
    if (errorMessage) {
      toast({ title: "Check your details", description: errorMessage, variant: "destructive" });
      return;
    }

    setLoading(true);
    setPartnerCode(null);
    try {
      await signUp(email.trim().toLowerCase(), password, name.trim(), phone.trim(), {
        accountType: "partner",
        partnerProfile: {
          city: city.trim(),
          experience: experience.trim(),
          payoutMethod,
          upiId: payoutMethod === "upi" ? upiId.trim() : undefined,
          bankDetails:
            payoutMethod === "bank"
              ? {
                  account_holder_name: bankAccountName.trim(),
                  account_number: bankAccountNumber.trim(),
                  ifsc: bankIfsc.trim().toUpperCase(),
                  bank_name: bankName.trim(),
                }
              : {},
        },
      });

      const { data: authData } = await supabaseAuth.auth.getUser();
      const userId = authData?.user?.id ?? null;
      if (userId) {
        const { data, error } = await supabase
          .from("affiliates")
          .select("code")
          .eq("user_id", userId)
          .returns<Database["public"]["Tables"]["affiliates"]["Row"][]>()
          .maybeSingle();
        if (!error && data?.code) {
          setPartnerCode(String(data.code));
        }
      }

      toast({
        title: "Partner registration submitted",
        description: "Check your email to confirm your account, then sign in to access the Partner Dashboard.",
      });
    } catch (err) {
      toast({
        title: "Registration failed",
        description: err instanceof Error ? err.message : "Unable to register partner.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl font-display">Become a Libriofy Partner</CardTitle>
          <CardDescription>
            Earn <span className="font-medium text-foreground">10% commission</span> on every successful library subscription you bring.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {partnerCode ? (
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">Your Partner ID</p>
              <p className="mt-1 text-xl font-semibold tracking-wide">{partnerCode}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Referral link: <span className="font-mono">{getReferralLink(partnerCode)}</span>
              </p>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91XXXXXXXXXX" />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Your city" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Experience</Label>
              <Input
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
                placeholder="e.g., Sales / Field work / Calling"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" />
              </div>
              <div className="space-y-2">
                <Label>Confirm Password</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Payout Method</Label>
              <Tabs value={payoutMethod} onValueChange={(value) => setPayoutMethod(value as "upi" | "bank")}>
                <TabsList>
                  <TabsTrigger value="upi">UPI</TabsTrigger>
                  <TabsTrigger value="bank">Bank</TabsTrigger>
                </TabsList>
                <TabsContent value="upi" className="pt-4">
                  <div className="space-y-2">
                    <Label>UPI ID</Label>
                    <Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="name@upi" />
                  </div>
                </TabsContent>
                <TabsContent value="bank" className="pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Account Holder Name</Label>
                      <Input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} placeholder="Name on account" />
                    </div>
                    <div className="space-y-2">
                      <Label>Account Number</Label>
                      <Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} placeholder="XXXXXXXXXXXX" />
                    </div>
                    <div className="space-y-2">
                      <Label>IFSC</Label>
                      <Input value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} placeholder="IFSC code" />
                    </div>
                    <div className="space-y-2">
                      <Label>Bank Name</Label>
                      <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank" />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <Button type="submit" disabled={loading} className="sm:w-auto">
                {loading ? "Submitting..." : "Register as Partner"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Already registered?{" "}
                <Link to="/login" className="text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default PartnerRegistrationPage;
