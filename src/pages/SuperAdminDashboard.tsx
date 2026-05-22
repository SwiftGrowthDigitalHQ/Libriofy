import { Building2, CheckCircle, CreditCard, Users } from "lucide-react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useControlPlane } from "@/hooks/superAdmin";
import { formatInr, formatNumber } from "@/lib/superAdmin/presentation";

const SuperAdminDashboard = () => {
  const platformQuery = useControlPlane();
  const platform = platformQuery.data;
  const isLoading = platformQuery.isLoading;

  const totalLibraries = platform?.libraries?.length ?? 0;
  const activeLibraries = platform?.analytics?.dailyActiveLibraries ?? 0;
  const totalStudents = platform?.analytics?.activeStudentsToday ?? 0;
  const monthlyRevenue = platform?.analytics?.revenueThisMonth ?? 0;
  const queuedJobs = platform?.automation?.queuedJobs ?? 0;
  const systemStatus = platform?.systemStatus ?? "yellow";
  const maintenanceMode = platform?.maintenanceMode ?? false;

  const statusColor = systemStatus === "green" ? "default" : systemStatus === "red" ? "destructive" : "secondary";
  const statusLabel = maintenanceMode ? "Maintenance" : systemStatus === "green" ? "Healthy" : systemStatus === "red" ? "Degraded" : "Unknown";

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-display text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Platform overview</p>
          </div>
          <Badge variant={statusColor}>{statusLabel}</Badge>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="h-16 animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Libraries</p>
                  <p className="text-2xl font-bold">{formatNumber(totalLibraries)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
                  <CheckCircle className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Libraries</p>
                  <p className="text-2xl font-bold">{formatNumber(activeLibraries)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Students</p>
                  <p className="text-2xl font-bold">{formatNumber(totalStudents)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-500/10">
                  <CreditCard className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Monthly Revenue</p>
                  <p className="text-2xl font-bold">{formatInr(monthlyRevenue)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-500/10">
                  <CreditCard className="h-6 w-6 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Pending Jobs</p>
                  <p className="text-2xl font-bold">{formatNumber(queuedJobs)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/10">
                  <CheckCircle className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Platform Status</p>
                  <p className="text-2xl font-bold capitalize">{statusLabel}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminDashboard;
