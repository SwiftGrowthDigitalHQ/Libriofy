import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import RevenueChart from "@/components/dashboard/RevenueChart";
import { Users, LayoutGrid, CreditCard, CalendarClock, AlertTriangle, CheckCircle } from "lucide-react";

const recentActivity = [
  { action: "New admission", detail: "Aarav Sharma - Plan: Full Day", time: "2 min ago", type: "success" },
  { action: "Payment received", detail: "₹3,500 from Priya Mehta", time: "15 min ago", type: "success" },
  { action: "Seat expired", detail: "Seat B3 - Vikram Patel", time: "1 hour ago", type: "warning" },
  { action: "Check-in", detail: "Neha Gupta - Seat A5", time: "2 hours ago", type: "info" },
  { action: "Renewal reminder sent", detail: "3 students expiring in 3 days", time: "3 hours ago", type: "warning" },
];

const Dashboard = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">Overview of your library operations</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard icon={LayoutGrid} title="Total Seats" value="40" change="+5 this month" trend="up" />
          <StatsCard icon={Users} title="Active Students" value="34" change="+8%" trend="up" iconColor="text-info" />
          <StatsCard icon={CreditCard} title="Revenue (MTD)" value="₹78,500" change="+12%" trend="up" iconColor="text-success" />
          <StatsCard icon={CalendarClock} title="Expiring Soon" value="6" change="Next 7 days" trend="down" iconColor="text-warning" />
        </div>

        {/* Charts + Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <RevenueChart />
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold font-display text-foreground mb-4">Recent Activity</h3>
            <div className="space-y-4">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    item.type === "success" ? "bg-success/10" : item.type === "warning" ? "bg-warning/10" : "bg-info/10"
                  }`}>
                    {item.type === "success" ? (
                      <CheckCircle className="w-3.5 h-3.5 text-success" />
                    ) : item.type === "warning" ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5 text-info" />
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
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
