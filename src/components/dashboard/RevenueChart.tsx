import { BarChart3 } from "lucide-react";
import { ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line } from "recharts";

export type RevenuePoint = {
  month: string;
  revenue: number;
};

export type DailyRevenuePoint = {
  day: string;
  label: string;
  currentMonthRevenue: number;
  previousMonthRevenue: number;
};

const defaultData: RevenuePoint[] = [
  { month: "Jan", revenue: 42000 },
  { month: "Feb", revenue: 48000 },
  { month: "Mar", revenue: 55000 },
  { month: "Apr", revenue: 51000 },
  { month: "May", revenue: 62000 },
  { month: "Jun", revenue: 71000 },
  { month: "Jul", revenue: 78000 },
];

type RevenueChartProps = {
  data?: RevenuePoint[];
  dailyData?: DailyRevenuePoint[];
  title?: string;
  subtitle?: string;
};

type ChartRevenuePoint = {
  day: string;
  label: string;
  currentMonthRevenue: number;
  previousMonthRevenue: number;
};

const RevenueChart = ({
  data = defaultData,
  dailyData = [],
  title = "Revenue Trend",
  subtitle = "Monthly payment collections across recent months.",
}: RevenueChartProps) => {
  const hasData = data.some((item) => item.revenue > 0);
  const hasDailyData = dailyData.some((item) => item.currentMonthRevenue > 0 || item.previousMonthRevenue > 0);
  const peakValue = Math.max(...data.map((item) => item.revenue), 0);
  const peakMonth = data.find((item) => item.revenue === peakValue)?.month ?? null;
  const shouldUseWeeklyView = dailyData.length > 14;
  const chartData: ChartRevenuePoint[] = shouldUseWeeklyView
    ? Array.from({ length: Math.ceil(dailyData.length / 7) }, (_, index) => {
        const weekPoints = dailyData.slice(index * 7, index * 7 + 7);
        const startLabel = weekPoints[0]?.label ?? `Week ${index + 1}`;
        const endLabel = weekPoints[weekPoints.length - 1]?.label ?? startLabel;

        return {
          day: `Week ${index + 1}`,
          label: startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`,
          currentMonthRevenue: weekPoints.reduce((sum, point) => sum + point.currentMonthRevenue, 0),
          previousMonthRevenue: weekPoints.reduce((sum, point) => sum + point.previousMonthRevenue, 0),
        };
      })
    : dailyData;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold font-display text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            {shouldUseWeeklyView ? "Weekly grouping" : "Daily breakdown"}
          </div>
          {hasData && peakMonth ? (
            <div className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              Peak month: {peakMonth}
            </div>
          ) : null}
        </div>
      </div>

      <div className="h-72">
        {hasDailyData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 6, bottom: 8 }} barCategoryGap={shouldUseWeeklyView ? "18%" : "26%"}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(200 15% 89%)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 12 }}
                stroke="hsl(200 10% 45%)"
                tickMargin={10}
                minTickGap={24}
                interval={0}
                padding={{ left: 12, right: 12 }}
              />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(200 10% 45%)" tickFormatter={(value) => `\u20b9${Math.round(value / 1000)}K`} />
              <Tooltip
                labelFormatter={(_value, payload) => payload?.[0]?.payload?.label ?? "Day"}
                formatter={(value: number, name: string) => [
                  `\u20b9${value.toLocaleString("en-IN")}`,
                  name === "currentMonthRevenue" ? "This month" : "Last month",
                ]}
                contentStyle={{
                  backgroundColor: "hsl(0 0% 100%)",
                  border: "1px solid hsl(200 15% 89%)",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="currentMonthRevenue" name="This month" fill="hsl(172 66% 40%)" radius={[8, 8, 4, 4]} maxBarSize={24} />
              <Line
                type="monotone"
                dataKey="previousMonthRevenue"
                name="Last month"
                stroke="hsl(24 95% 53%)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">No payment trend yet</p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Approve your first payments to unlock daily revenue breakdowns and last-month comparisons.
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {hasDailyData
          ? shouldUseWeeklyView
            ? "Bars show weekly revenue blocks. The orange line compares the same weekly periods from last month."
            : "Bars show daily revenue. The orange line tracks the same dates from last month for quick comparison."
          : "The dashboard will keep showing revenue summaries even before the chart has enough data."}
      </p>
    </div>
  );
};

export default RevenueChart;
