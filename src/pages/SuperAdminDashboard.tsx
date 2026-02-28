import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import RevenueChart from "@/components/dashboard/RevenueChart";
import { Building2, Users, CreditCard, TrendingUp, CheckCircle, AlertTriangle } from "lucide-react";

const SuperAdminDashboard = () => {
  const { data: libraries = [] } = useQuery({
    queryKey: ["admin-libraries"],
    queryFn: async () => {
      const { data, error } = await supabase.from("libraries").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const totalRevenue = libraries.reduce((sum, l: any) => sum + Number(l.monthly_revenue || 0), 0);
  const totalStudents = libraries.reduce((sum, l: any) => sum + (l.active_students || 0), 0);
  const totalSeats = libraries.reduce((sum, l: any) => sum + (l.total_seats || 0), 0);
  const activeLibraries = libraries.filter((l: any) => l.enabled).length;

  const recentActivity = [
    { action: "New library onboarded", detail: "Focus Library - Mumbai", time: "1 hour ago", type: "success" },
    { action: "Subscription renewed", detail: "City Study Hub - Pro Plan", time: "3 hours ago", type: "success" },
    { action: "Library disabled", detail: "Topper Zone - Payment overdue", time: "1 day ago", type: "warning" },
    { action: "Revenue milestone", detail: "Platform crossed ₹5L MTD", time: "2 days ago", type: "success" },
  ];

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Platform Overview</h2>
          <p className="text-sm text-muted-foreground mt-1">Monitor all libraries and platform metrics</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard icon={Building2} title="Total Libraries" value={String(libraries.length)} change={`${activeLibraries} active`} trend="up" />
          <StatsCard icon={Users} title="Total Students" value={String(totalStudents)} trend="up" iconColor="text-info" />
          <StatsCard icon={CreditCard} title="Platform Revenue" value={`₹${totalRevenue.toLocaleString()}`} trend="up" iconColor="text-success" />
          <StatsCard icon={TrendingUp} title="Total Seats" value={String(totalSeats)} trend="up" iconColor="text-warning" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RevenueChart />
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold font-display text-foreground mb-4">Platform Activity</h3>
            <div className="space-y-4">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    item.type === "success" ? "bg-success/10" : "bg-warning/10"
                  }`}>
                    {item.type === "success" ? (
                      <CheckCircle className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.action}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{item.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Libraries */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold font-display text-foreground mb-4">Top Libraries by Revenue</h3>
          <div className="space-y-3">
            {libraries
              .sort((a: any, b: any) => Number(b.monthly_revenue || 0) - Number(a.monthly_revenue || 0))
              .slice(0, 5)
              .map((lib: any, i) => (
                <div key={lib.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-5">#{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{lib.name}</p>
                      <p className="text-xs text-muted-foreground">{lib.city || "—"} · {lib.active_students} students</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-foreground">₹{Number(lib.monthly_revenue || 0).toLocaleString()}</span>
                </div>
              ))}
            {libraries.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No libraries yet</p>
            )}
          </div>
        </div>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminDashboard;
