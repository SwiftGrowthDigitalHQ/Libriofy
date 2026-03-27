import { LineChart as LineChartIcon } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type FinanceTrendPoint = {
  day: string;
  label: string;
  revenue: number;
  expense: number;
};

type FinanceTrendChartProps = {
  data: FinanceTrendPoint[];
  title?: string;
  subtitle?: string;
};

type ChartPoint = FinanceTrendPoint;

const formatInr = (amount: number) => `\u20b9${Math.round(amount).toLocaleString("en-IN")}`;

const FinanceTrendChart = ({
  data,
  title = "Revenue vs Expense",
  subtitle = "Track money in and money out across the selected period.",
}: FinanceTrendChartProps) => {
  const hasData = data.some((point) => point.revenue > 0 || point.expense > 0);
  const shouldUseWeeklyView = data.length > 35;

  const chartData: ChartPoint[] = shouldUseWeeklyView
    ? Array.from({ length: Math.ceil(data.length / 7) }, (_, index) => {
        const weekPoints = data.slice(index * 7, index * 7 + 7);
        const startLabel = weekPoints[0]?.label ?? `Week ${index + 1}`;
        const endLabel = weekPoints[weekPoints.length - 1]?.label ?? startLabel;

        return {
          day: `W${index + 1}`,
          label: startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`,
          revenue: weekPoints.reduce((sum, point) => sum + point.revenue, 0),
          expense: weekPoints.reduce((sum, point) => sum + point.expense, 0),
        };
      })
    : data;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold font-display text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
          {shouldUseWeeklyView ? "Weekly breakdown" : "Daily breakdown"}
        </div>
      </div>

      <div className="h-80">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(200 15% 89%)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 12 }}
                stroke="hsl(200 10% 45%)"
                tickMargin={10}
                minTickGap={24}
                padding={{ left: 12, right: 12 }}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                stroke="hsl(200 10% 45%)"
                tickFormatter={(value) => `\u20b9${Math.round(value / 1000)}K`}
              />
              <Tooltip
                labelFormatter={(_value, payload) => payload?.[0]?.payload?.label ?? "Period"}
                formatter={(value: number, name: string) => [
                  formatInr(value),
                  name === "revenue" ? "Revenue" : "Expense",
                ]}
                contentStyle={{
                  backgroundColor: "hsl(0 0% 100%)",
                  border: "1px solid hsl(200 15% 89%)",
                  borderRadius: "12px",
                  fontSize: "12px",
                }}
              />
              <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: "12px" }} />
              <Line
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="hsl(142 72% 35%)"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="expense"
                name="Expense"
                stroke="hsl(0 72% 52%)"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/20 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <LineChartIcon className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">No finance movement yet</p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Payments and expenses from the selected period will appear here automatically.
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {hasData
          ? shouldUseWeeklyView
            ? "Weekly grouping keeps longer ranges readable while preserving exact hover values."
            : "Hover over any point to see exact revenue and expense values."
          : "Add payments or expenses to unlock trend visibility."}
      </p>
    </div>
  );
};

export default FinanceTrendChart;
