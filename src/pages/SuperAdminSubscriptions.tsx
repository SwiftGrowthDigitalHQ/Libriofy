import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SuperAdminSubscriptions = () => (
  <SuperAdminLayout>
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-display text-foreground">Subscriptions</h2>
        <p className="text-sm text-muted-foreground mt-1">Manage platform subscription plans</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">Subscription Management</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            Subscription management coming soon. Configure billing plans for library owners here.
          </p>
        </CardContent>
      </Card>
    </div>
  </SuperAdminLayout>
);

export default SuperAdminSubscriptions;
