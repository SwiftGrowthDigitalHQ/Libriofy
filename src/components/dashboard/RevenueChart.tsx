import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const data = [
  { month: "Jan", revenue: 42000 },
  { month: "Feb", revenue: 48000 },
  { month: "Mar", revenue: 55000 },
  { month: "Apr", revenue: 51000 },
  { month: "May", revenue: 62000 },
  { month: "Jun", revenue: 71000 },
  { month: "Jul", revenue: 78000 },
];

const RevenueChart = () => {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-semibold font-display text-foreground mb-4">Revenue Trend</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(172, 66%, 30%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(172, 66%, 30%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(200, 15%, 89%)" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" />
            <YAxis tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" tickFormatter={(v) => `₹${v / 1000}K`} />
            <Tooltip
              formatter={(value: number) => [`₹${value.toLocaleString()}`, "Revenue"]}
              contentStyle={{
                backgroundColor: "hsl(0, 0%, 100%)",
                border: "1px solid hsl(200, 15%, 89%)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="hsl(172, 66%, 30%)"
              strokeWidth={2}
              fill="url(#revenueGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default RevenueChart;
