import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";

const SuperAdminSettings = () => {
  const { loading, maintenanceMode, source, updatedAt } = useMaintenanceMode({ pollIntervalMs: 0 });

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Platform Settings</h2>
          <p className="text-sm text-muted-foreground mt-1">Configure global platform settings</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Maintenance Mode</CardTitle>
            <CardDescription>Read-only status for the global platform lock.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Checking maintenance state...</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={maintenanceMode ? "destructive" : "secondary"}>
                    {maintenanceMode ? "Enabled" : "Disabled"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">Source: {source}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {maintenanceMode
                    ? "The app is locked for all standard users until the flag is turned off."
                    : "The platform is currently open for normal operations."}
                </p>
                <p className="text-xs text-muted-foreground">
                  Manage this flag from the <code>public.platform_settings</code> table or the{" "}
                  <code>MAINTENANCE_MODE</code> environment variable.
                  {updatedAt ? ` Last updated: ${new Date(updatedAt).toLocaleString()}.` : ""}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">General Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground py-8 text-center">
              Platform-wide configuration settings coming soon.
            </p>
          </CardContent>
        </Card>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminSettings;
