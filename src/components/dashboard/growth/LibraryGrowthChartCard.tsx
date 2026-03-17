import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type LibraryGrowthPoint = {
  month: string;
  monthStart: string;
  libraries: number;
};

const LibraryGrowthChartCard = ({ data, isLoading }: { data: LibraryGrowthPoint[]; isLoading: boolean }) => {
  const hasData = data.some((point) => point.libraries > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">Library Growth Over Time</h3>
        <p className="mt-1 text-xs text-muted-foreground">Monthly library signups.</p>
      </div>

      <div className="mt-4 h-[320px]">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
        ) : !hasData ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No signups yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barCategoryGap={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(200, 15%, 89%)" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" />
              <Tooltip
                formatter={(value: number) => [value, "Libraries"]}
                labelFormatter={(_, payload) => {
                  const monthStart = payload?.[0]?.payload?.monthStart;
                  if (!monthStart) return "";
                  const date = new Date(monthStart);
                  return date.toLocaleString("en-IN", { month: "short", year: "numeric" });
                }}
                contentStyle={{
                  backgroundColor: "hsl(0, 0%, 100%)",
                  border: "1px solid hsl(200, 15%, 89%)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="libraries" fill="hsl(172, 66%, 30%)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default LibraryGrowthChartCard;

