import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import RevenueChart from "@/components/dashboard/RevenueChart";
import { Building2, Users, CreditCard, TrendingUp, CheckCircle, AlertTriangle, Zap, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const SuperAdminDashboard = () => {
  const { data: libraries = [] } = useQuery({
    queryKey: ["admin-libraries"],
    queryFn: async () => {
      const { data, error } = await supabase.from("libraries").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: subs = [] } = useQuery({
    queryKey: ["admin-subscriptions-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("library_subscriptions" as any).select("*");
      if (error) throw error;
      return data as any[];
    },
  });

  const totalRevenue = libraries.reduce((sum, l: any) => sum + Number(l.monthly_revenue || 0), 0);
  const totalStudents = libraries.reduce((sum, l: any) => sum + (l.active_students || 0), 0);
  const activeLibraries = libraries.filter((l: any) => l.enabled).length;
  const expiredSubs = subs.filter((s: any) => s.status === "expired").length;
  const activeSubs = subs.filter((s: any) => s.status === "active" || s.status === "trial").length;
  const subRevenue = subs.reduce((sum: number, s: any) => sum + Number(s.price || 0), 0);

  const insights = [
    totalStudents > 100 && { text: "Platform growing steadily — " + totalStudents + " students across all libraries", type: "success" },
    expiredSubs > 0 && { text: expiredSubs + " library subscriptions expired — follow up for renewal", type: "warning" },
    activeLibraries < libraries.length && { text: (libraries.length - activeLibraries) + " libraries currently disabled", type: "warning" },
  ].filter(Boolean) as { text: string; type: string }[];

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
          <StatsCard icon={CreditCard} title="Subscription MRR" value={`₹${subRevenue.toLocaleString()}`} trend="up" iconColor="text-success" />
          <StatsCard icon={TrendingUp} title="Active Plans" value={String(activeSubs)} change={`${expiredSubs} expired`} trend={expiredSubs > 0 ? "down" : "up"} iconColor="text-warning" />
        </div>

        {/* Smart Insights */}
        {insights.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold font-display text-foreground mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> Smart Insights
            </h3>
            <div className="space-y-2">
              {insights.map((ins, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {ins.type === "success" ? <CheckCircle className="w-4 h-4 text-success flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />}
                  <span className="text-muted-foreground">{ins.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RevenueChart />
          </div>
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

        {/* Top by occupancy */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold font-display text-foreground mb-4">Top Libraries by Seat Occupancy</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {libraries
              .map((l: any) => ({ ...l, occupancy: l.total_seats > 0 ? Math.round((l.active_students / l.total_seats) * 100) : 0 }))
              .sort((a: any, b: any) => b.occupancy - a.occupancy)
              .slice(0, 5)
              .map((lib: any) => (
                <div key={lib.id} className="p-3 rounded-lg border border-border">
                  <p className="text-sm font-medium text-foreground truncate">{lib.name}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">{lib.active_students}/{lib.total_seats} seats</span>
                    <Badge variant={lib.occupancy >= 90 ? "destructive" : lib.occupancy >= 70 ? "default" : "secondary"}>
                      {lib.occupancy}%
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
