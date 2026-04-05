import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, LockKeyhole, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const SUPER_ADMIN_EMAIL = "shop43851@gmail.com";

const SuperAdminLoginPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { getCurrentSession, signIn, signOut } = useAuth();

  const [email, setEmail] = useState(SUPER_ADMIN_EMAIL);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await signIn(email.trim().toLowerCase(), password);

      const currentUserId = (await getCurrentSession())?.user.id ?? "";
      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", currentUserId);

      if (roleError) {
        throw roleError;
      }

      const hasSuperAdminRole = roles?.some((role) => role.role === "super_admin") ?? false;
      if (!hasSuperAdminRole) {
        await signOut();
        setError("Access denied. This account does not have Super Admin access.");
        return;
      }

      toast({
        title: "Login successful",
        description: "Welcome back, Super Admin.",
      });
      navigate("/admin", { replace: true });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to sign in.";
      setError(message);
      toast({
        title: "Login failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

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
              <p className="mt-2 text-sm text-zinc-400">Email/password fallback access for platform operations.</p>
            </div>
          </div>

          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label className="text-zinc-300">Email address</Label>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-12 rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500"
                placeholder="shop43851@gmail.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-12 rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500"
                placeholder="Enter your password"
                required
              />
            </div>

            <Button
              type="submit"
              className="h-12 w-full rounded-2xl bg-red-500 text-white hover:bg-red-400"
              disabled={loading}
            >
              <LockKeyhole className="mr-2 h-4 w-4" />
              {loading ? "Signing in..." : "Continue"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default SuperAdminLoginPage;
