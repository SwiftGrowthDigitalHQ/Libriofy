import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SuperAdminSettings = () => (
  <SuperAdminLayout>
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-display text-foreground">Platform Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Configure global platform settings</p>
      </div>
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

export default SuperAdminSettings;
