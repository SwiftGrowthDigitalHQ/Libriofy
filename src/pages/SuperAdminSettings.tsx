import { useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";
import { setMaintenanceMode } from "@/lib/maintenanceClient";

const SuperAdminSettings = () => {
  const { loading, maintenanceMode, source, updatedAt, refresh } = useMaintenanceMode({ pollIntervalMs: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleToggleMaintenanceMode = async () => {
    setIsSaving(true);
    setActionError(null);

    try {
      await setMaintenanceMode(!maintenanceMode);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update maintenance mode.");
    } finally {
      setIsSaving(false);
    }
  };

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
            <CardDescription>Toggle the global platform lock for standard users.</CardDescription>
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
                  <Button
                    type="button"
                    variant={maintenanceMode ? "secondary" : "destructive"}
                    onClick={handleToggleMaintenanceMode}
                    disabled={isSaving}
                  >
                    {isSaving ? "Saving..." : maintenanceMode ? "Disable maintenance" : "Enable maintenance"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  {maintenanceMode
                    ? "The app is locked for all standard users until the flag is turned off."
                    : "The platform is currently open for normal operations."}
                </p>
                {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
                <p className="text-xs text-muted-foreground">
                  This control writes to <code>/api/admin/settings</code>, which persists the flag in{" "}
                  <code>public.platform_settings</code> with a safe API fallback if the database row is unavailable.
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
