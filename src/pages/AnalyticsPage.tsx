import DashboardLayout from "@/components/dashboard/DashboardLayout";
import RevenueChart from "@/components/dashboard/RevenueChart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const occupancyData = [
  { slot: "Morning", occupancy: 92 },
  { slot: "Forenoon", occupancy: 82 },
  { slot: "Afternoon", occupancy: 70 },
  { slot: "Evening", occupancy: 97 },
];

const planDist = [
  { name: "4 Hour", value: 12, color: "hsl(172, 66%, 45%)" },
  { name: "6 Hour", value: 14, color: "hsl(38, 92%, 50%)" },
  { name: "Full Day", value: 8, color: "hsl(210, 80%, 55%)" },
];

const insights = [
  { text: "Evening slot has 97% occupancy. Consider increasing price by ₹200.", type: "revenue" },
  { text: "Afternoon slot has lowest demand. Try a ₹300 discount to boost.", type: "discount" },
  { text: "6-Hour plan is most popular. Feature it on your public page.", type: "growth" },
];

const AnalyticsPage = () => (
  <DashboardLayout>
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-display text-foreground">Analytics</h2>
        <p className="text-sm text-muted-foreground mt-1">Insights into your library performance</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart />

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold font-display text-foreground mb-4">Slot Occupancy</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={occupancyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(200, 15%, 89%)" />
                <XAxis dataKey="slot" tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: number) => [`${v}%`, "Occupancy"]} />
                <Bar dataKey="occupancy" fill="hsl(172, 66%, 30%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold font-display text-foreground mb-4">Plan Distribution</h3>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={planDist} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={4}>
                  {planDist.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2">
            {planDist.map((p) => (
              <div key={p.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                {p.name} ({p.value})
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold font-display text-foreground mb-4">Smart Insights</h3>
          <div className="space-y-4">
            {insights.map((ins, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                  ins.type === "revenue" ? "bg-success" : ins.type === "discount" ? "bg-warning" : "bg-info"
                }`} />
                <p className="text-sm text-foreground">{ins.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </DashboardLayout>
);

export default AnalyticsPage;
