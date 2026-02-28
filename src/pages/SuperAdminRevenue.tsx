import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import RevenueChart from "@/components/dashboard/RevenueChart";

const SuperAdminRevenue = () => (
  <SuperAdminLayout>
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-display text-foreground">Platform Revenue</h2>
        <p className="text-sm text-muted-foreground mt-1">Track revenue across all libraries</p>
      </div>
      <RevenueChart />
    </div>
  </SuperAdminLayout>
);

export default SuperAdminRevenue;
