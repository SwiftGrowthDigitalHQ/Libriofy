import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getRoleHomeRoute, useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PartnerPortalHome = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { data: roles, isLoading: rolesLoading } = useUserRole();

  const homeRoute = useMemo(() => getRoleHomeRoute(roles), [roles]);

  useEffect(() => {
    if (loading || rolesLoading) return;
    if (!user) return;
    if (homeRoute && homeRoute !== "/auth") {
      navigate(homeRoute, { replace: true });
    }
  }, [homeRoute, loading, navigate, rolesLoading, user]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl font-display">Libriofy Partner Portal</CardTitle>
          <CardDescription>
            Track leads, commissions, payouts, and get your marketing kit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground">Commission</p>
            <p className="mt-1 text-lg font-semibold text-foreground">10% on every successful sale</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="sm:flex-1">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild variant="outline" className="sm:flex-1">
              <Link to="/partner">Become a partner</Link>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Library owners should use the main dashboard at <span className="font-mono">/dashboard</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default PartnerPortalHome;

