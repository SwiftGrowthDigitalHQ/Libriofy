import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, CheckCircle, CreditCard, TrendingUp, Users, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import RevenueChart from "@/components/dashboard/RevenueChart";
import StatsCard from "@/components/dashboard/StatsCard";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type AdminLibraryRow = Pick<
  Database["public"]["Tables"]["libraries"]["Row"],
  "id" | "name" | "city" | "enabled" | "monthly_revenue" | "active_students" | "total_seats"
>;

type AdminSubscriptionStatRow = Pick<
  Database["public"]["Tables"]["library_subscriptions"]["Row"],
  "status" | "price"
>;

const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const SuperAdminDashboard = () => {
  const { data: libraries = [] } = useQuery({
    queryKey: ["admin-libraries"],
    queryFn: async (): Promise<AdminLibraryRow[]> => {
      const { data, error } = await supabase.from("libraries").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as AdminLibraryRow[];
    },
  });

  const { data: subscriptions = [] } = useQuery({
    queryKey: ["admin-subscriptions-stats"],
    queryFn: async (): Promise<AdminSubscriptionStatRow[]> => {
      const { data, error } = await supabase.from("library_subscriptions").select("status, price");
      if (error) throw error;
      return data as AdminSubscriptionStatRow[];
    },
  });

  const totalStudents = libraries.reduce((sum, library) => sum + (library.active_students || 0), 0);
  const activeLibraries = libraries.filter((library) => library.enabled).length;
  const expiredSubscriptions = subscriptions.filter((subscription) => subscription.status === "expired").length;
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "active" || subscription.status === "trial").length;
  const subscriptionRevenue = subscriptions.reduce((sum, subscription) => sum + Number(subscription.price || 0), 0);

  const insights = [
    totalStudents > 100 && { text: `Platform growing steadily - ${totalStudents} students across all libraries`, type: "success" },
    expiredSubscriptions > 0 && { text: `${expiredSubscriptions} library subscriptions expired - follow up for renewal`, type: "warning" },
    activeLibraries < libraries.length && { text: `${libraries.length - activeLibraries} libraries currently disabled`, type: "warning" },
  ].filter(Boolean) as Array<{ text: string; type: string }>;

  const topRevenueLibraries = [...libraries]
    .sort((left, right) => Number(right.monthly_revenue || 0) - Number(left.monthly_revenue || 0))
    .slice(0, 5);

  const occupancyLibraries = libraries
    .map((library) => ({
      ...library,
      occupancy: library.total_seats > 0 ? Math.round((library.active_students / library.total_seats) * 100) : 0,
    }))
    .sort((left, right) => right.occupancy - left.occupancy)
    .slice(0, 5);

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Platform Overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">Monitor all libraries and platform metrics.</p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatsCard icon={Building2} title="Total Libraries" value={String(libraries.length)} change={`${activeLibraries} active`} trend="up" />
          <StatsCard icon={Users} title="Total Students" value={String(totalStudents)} trend="up" iconColor="text-info" />
          <StatsCard icon={CreditCard} title="Subscription MRR" value={formatInr(subscriptionRevenue)} trend="up" iconColor="text-success" />
          <StatsCard
            icon={TrendingUp}
            title="Active Plans"
            value={String(activeSubscriptions)}
            change={`${expiredSubscriptions} expired`}
            trend={expiredSubscriptions > 0 ? "down" : "up"}
            iconColor="text-warning"
          />
        </div>

        {insights.length > 0 ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold font-display text-foreground">
              <Zap className="h-4 w-4 text-primary" />
              Smart Insights
            </h3>
            <div className="space-y-2">
              {insights.map((insight, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  {insight.type === "success" ? (
                    <CheckCircle className="h-4 w-4 flex-shrink-0 text-success" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
                  )}
                  <span className="text-muted-foreground">{insight.text}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RevenueChart />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 text-sm font-semibold font-display text-foreground">Top Libraries by Revenue</h3>
            <div className="space-y-3">
              {topRevenueLibraries.map((library, index) => (
                <div key={library.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-xs text-muted-foreground">#{index + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{library.name}</p>
                      <p className="text-xs text-muted-foreground">{library.city || "-"} - {library.active_students} students</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{formatInr(Number(library.monthly_revenue || 0))}</span>
                </div>
              ))}
              {libraries.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No libraries yet.</p> : null}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold font-display text-foreground">Top Libraries by Seat Occupancy</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {occupancyLibraries.map((library) => (
              <div key={library.id} className="rounded-lg border border-border p-3">
                <p className="truncate text-sm font-medium text-foreground">{library.name}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{library.active_students}/{library.total_seats} seats</span>
                  <Badge variant={library.occupancy >= 90 ? "destructive" : library.occupancy >= 70 ? "default" : "secondary"}>
                    {library.occupancy}%
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminDashboard;
