import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, startOfDay, startOfMonth, subMonths } from "date-fns";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import RevenueChart, { type RevenuePoint } from "@/components/dashboard/RevenueChart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isSuccessfulPaymentStatus } from "@/lib/payments";

type LibraryRow = Pick<Database["public"]["Tables"]["libraries"]["Row"], "id" | "total_seats">;
type SlotRow = Pick<
  Database["public"]["Tables"]["time_slots"]["Row"],
  "id" | "name" | "max_seats" | "is_active"
>;
type StudentAnalyticsRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "id" | "plan" | "slot" | "status" | "expiry_date"
>;
type PaymentAnalyticsRow = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  "amount" | "status" | "created_at"
>;

type OccupancyPoint = {
  slot: string;
  occupancy: number;
  occupied: number;
  capacity: number;
  rawOccupancy: number;
};

type PlanPoint = {
  name: string;
  value: number;
  color: string;
};

type InsightType = "revenue" | "discount" | "growth";

type InsightItem = {
  text: string;
  type: InsightType;
};

type AnalyticsData = {
  revenueTrend: RevenuePoint[];
  occupancyData: OccupancyPoint[];
  planDist: PlanPoint[];
  insights: InsightItem[];
};

const planColors = ["hsl(172, 66%, 45%)", "hsl(38, 92%, 50%)", "hsl(210, 80%, 55%)", "hsl(340, 82%, 58%)", "hsl(270, 70%, 58%)"];

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unknown error";
  return (error as { message?: string }).message || "Unknown error";
};

const normalizeText = (value: string | null | undefined) => (value || "").replace(/\s+/g, "").toLowerCase();

const slotMatches = (studentSlot: string | null, slotName: string): boolean => {
  if (!studentSlot) return false;
  const a = normalizeText(studentSlot);
  const b = normalizeText(slotName);
  return a === b || a.includes(b) || b.includes(a);
};

const isActiveStudent = (student: StudentAnalyticsRow, today: Date): boolean => {
  if (student.status !== "active") return false;
  if (!student.expiry_date) return true;
  const expiry = new Date(`${student.expiry_date}T00:00:00`);
  return expiry >= today;
};

const AnalyticsPage = () => {
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

  const { data: fallbackLibraries = [], isLoading: fallbackLoading } = useQuery({
    queryKey: ["my-libraries-fallback", user?.id],
    queryFn: async (): Promise<Array<{ id: string }>> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("libraries")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !libraryId,
  });

  const resolvedLibraryId = libraryId ?? fallbackLibraries[0]?.id ?? null;

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["analytics-overview", resolvedLibraryId],
    queryFn: async (): Promise<AnalyticsData> => {
      if (!resolvedLibraryId) return { revenueTrend: [], occupancyData: [], planDist: [], insights: [] };

      const now = new Date();
      const today = startOfDay(now);
      const monthStarts = Array.from({ length: 7 }, (_, i) => addMonths(startOfMonth(subMonths(now, 6)), i));
      const chartStart = monthStarts[0].toISOString();

      const [libraryRes, slotsRes, studentsRes, paymentsRes] = await Promise.all([
        supabase
          .from("libraries")
          .select("id, total_seats")
          .eq("id", resolvedLibraryId)
          .maybeSingle(),
        supabase
          .from("time_slots")
          .select("id, name, max_seats, is_active")
          .eq("library_id", resolvedLibraryId)
          .eq("is_active", true)
          .order("start_time", { ascending: true }),
        supabase
          .from("students")
          .select("id, plan, slot, status, expiry_date")
          .eq("library_id", resolvedLibraryId),
        supabase
          .from("payments")
          .select("amount, status, created_at")
          .eq("library_id", resolvedLibraryId)
          .gte("created_at", chartStart),
      ]);

      if (libraryRes.error) throw libraryRes.error;
      if (slotsRes.error) throw slotsRes.error;
      if (studentsRes.error) throw studentsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      const library = libraryRes.data as LibraryRow | null;
      const slots = (slotsRes.data ?? []) as SlotRow[];
      const students = (studentsRes.data ?? []) as StudentAnalyticsRow[];
      const payments = (paymentsRes.data ?? []) as PaymentAnalyticsRow[];

      const activeStudents = students.filter((student) => isActiveStudent(student, today));

      const slotCount = slots.length;
      const baseCapacityPerSlot = slotCount > 0 ? Math.max(1, Math.ceil((library?.total_seats || slotCount) / slotCount)) : 0;

      const occupancyData: OccupancyPoint[] = slots.map((slot) => {
        const occupied = activeStudents.filter((student) => slotMatches(student.slot, slot.name)).length;
        const capacity = slot.max_seats && slot.max_seats > 0 ? slot.max_seats : baseCapacityPerSlot;
        const rawOccupancy = capacity > 0 ? (occupied / capacity) * 100 : 0;
        return {
          slot: slot.name,
          occupied,
          capacity,
          rawOccupancy,
          occupancy: Math.max(0, Math.min(100, Math.round(rawOccupancy))),
        };
      });

      const planCount = new Map<string, number>();
      for (const student of activeStudents) {
        const key = (student.plan || "Unassigned").trim() || "Unassigned";
        planCount.set(key, (planCount.get(key) || 0) + 1);
      }

      const planDist: PlanPoint[] = Array.from(planCount.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, value], index) => ({
          name,
          value,
          color: planColors[index % planColors.length],
        }));

      const trendMap = new Map<string, number>();
      monthStarts.forEach((monthDate) => trendMap.set(format(monthDate, "yyyy-MM"), 0));

      for (const payment of payments) {
        if (!isSuccessfulPaymentStatus(payment.status)) continue;
        const key = format(new Date(payment.created_at), "yyyy-MM");
        if (!trendMap.has(key)) continue;
        trendMap.set(key, (trendMap.get(key) || 0) + Number(payment.amount || 0));
      }

      const revenueTrend: RevenuePoint[] = monthStarts.map((monthDate) => ({
        month: format(monthDate, "MMM"),
        revenue: Math.round(trendMap.get(format(monthDate, "yyyy-MM")) || 0),
      }));

      const insights: InsightItem[] = [];

      if (occupancyData.length > 0) {
        const sortedByOccupancy = [...occupancyData].sort((a, b) => b.rawOccupancy - a.rawOccupancy);
        const topSlot = sortedByOccupancy[0];
        const lowSlot = sortedByOccupancy[sortedByOccupancy.length - 1];

        if (topSlot.rawOccupancy >= 100) {
          insights.push({
            type: "revenue",
            text: `${topSlot.slot} slot is overbooked (${Math.round(topSlot.rawOccupancy)}%). Increase capacity or adjust pricing.`,
          });
        } else if (topSlot.rawOccupancy >= 85) {
          insights.push({
            type: "revenue",
            text: `${topSlot.slot} slot has ${Math.round(topSlot.rawOccupancy)}% occupancy. Consider a small price increase.`,
          });
        }

        if (lowSlot.rawOccupancy <= 60) {
          insights.push({
            type: "discount",
            text: `${lowSlot.slot} slot has low occupancy (${Math.round(lowSlot.rawOccupancy)}%). Run an offer to improve fill rate.`,
          });
        }
      }

      if (planDist.length > 0) {
        insights.push({
          type: "growth",
          text: `${planDist[0].name} is your most popular plan (${planDist[0].value} active students). Highlight it on your public page.`,
        });
      }

      const currentKey = format(monthStarts[monthStarts.length - 1], "yyyy-MM");
      const previousKey = format(subMonths(monthStarts[monthStarts.length - 1], 1), "yyyy-MM");
      const currentRevenue = trendMap.get(currentKey) || 0;
      const previousRevenue = trendMap.get(previousKey) || 0;

      if (currentRevenue > 0 && previousRevenue > 0 && insights.length < 3) {
        const diff = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
        insights.push({
          type: diff >= 0 ? "growth" : "discount",
          text: `Revenue is ${diff >= 0 ? "up" : "down"} ${Math.abs(diff).toFixed(0)}% vs last month.`,
        });
      }

      if (insights.length === 0) {
        insights.push({ type: "growth", text: "Add more student and payment data to unlock deeper insights." });
      }

      return {
        revenueTrend,
        occupancyData,
        planDist,
        insights: insights.slice(0, 3),
      };
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
  });

  const loading = roleLibraryLoading || fallbackLoading || isLoading;

  const hasRevenue = useMemo(() => (data?.revenueTrend || []).some((item) => item.revenue > 0), [data?.revenueTrend]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Analytics</h2>
          <p className="text-sm text-muted-foreground mt-1">Insights into your library performance</p>
        </div>

        {!resolvedLibraryId && !loading ? (
          <Card>
            <CardContent className="py-8 text-center text-destructive">
              Library not linked to your account. Please check user role setup.
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="py-8 text-center text-destructive">
              Unable to load analytics: {getErrorMessage(error)}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RevenueChart data={data?.revenueTrend || []} title="Revenue Trend" />

              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold font-display text-foreground mb-4">Slot Occupancy</h3>
                <div className="h-64">
                  {loading ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading slot analytics...</div>
                  ) : (data?.occupancyData.length || 0) === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No slot occupancy data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data?.occupancyData || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(200, 15%, 89%)" />
                        <XAxis dataKey="slot" tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" />
                        <YAxis tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                        <Tooltip
                          formatter={(value: number, _name, payload) => {
                            const row = payload?.payload as OccupancyPoint | undefined;
                            const details = row ? `${row.occupied}/${row.capacity} seats` : "Occupancy";
                            return [`${value}%`, details];
                          }}
                        />
                        <Bar dataKey="occupancy" fill="hsl(172, 66%, 30%)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold font-display text-foreground mb-4">Plan Distribution</h3>
                <div className="h-64 flex items-center justify-center">
                  {loading ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Loading plan distribution...</div>
                  ) : (data?.planDist.length || 0) === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No active plan data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data?.planDist || []} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={4}>
                          {(data?.planDist || []).map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => [String(value), "Students"]} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                {(data?.planDist.length || 0) > 0 && (
                  <div className="flex justify-center gap-4 mt-2 flex-wrap">
                    {(data?.planDist || []).map((plan) => (
                      <div key={plan.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: plan.color }} />
                        {plan.name} ({plan.value})
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold font-display text-foreground mb-4">Smart Insights</h3>
                <div className="space-y-4">
                  {(loading ? [] : data?.insights || []).map((insight, index) => (
                    <div key={`${insight.type}-${index}`} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50">
                      <div
                        className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                          insight.type === "revenue" ? "bg-success" : insight.type === "discount" ? "bg-warning" : "bg-info"
                        }`}
                      />
                      <p className="text-sm text-foreground">{insight.text}</p>
                    </div>
                  ))}
                  {loading && <p className="text-sm text-muted-foreground">Generating insights...</p>}
                </div>
                {!loading && !hasRevenue && <p className="text-xs text-muted-foreground mt-4">Tip: Add payments to improve revenue analytics.</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AnalyticsPage;
