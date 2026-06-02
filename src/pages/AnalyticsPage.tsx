import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, format, startOfDay, startOfMonth, subMonths } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

import DashboardLayout from "@/components/dashboard/DashboardLayout";
import RevenueChart, { type RevenuePoint } from "@/components/dashboard/RevenueChart";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { isStudentCurrentlyActive } from "@/lib/studentMembership";
import { STUDENT_GENDER_OPTIONS, formatStudentGender, type StudentGender, type StudentGenderFilter } from "@/lib/studentGender";
import { isSuccessfulPaymentStatus } from "@/lib/payments";

type LibraryRow = Pick<Database["public"]["Tables"]["libraries"]["Row"], "id" | "total_seats">;
type SlotRow = Pick<Database["public"]["Tables"]["time_slots"]["Row"], "id" | "name" | "max_seats" | "is_active">;
type StudentAnalyticsRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "expiry_date" | "gender" | "id" | "plan" | "slot" | "status"
>;
type PaymentAnalyticsRow = Pick<Database["public"]["Tables"]["payments"]["Row"], "amount" | "created_at" | "status" | "student_id">;

type OccupancyPoint = {
  capacity: number;
  occupancy: number;
  occupied: number;
  rawOccupancy: number;
  slot: string;
};

type PlanPoint = {
  color: string;
  name: string;
  value: number;
};

type GenderDistributionPoint = {
  color: string;
  name: string;
  percentage: number;
  value: number;
};

type SlotGenderPoint = {
  female: number;
  male: number;
  slot: string;
  total: number;
};

type InsightType = "revenue" | "discount" | "growth";

type InsightItem = {
  text: string;
  type: InsightType;
};

type AnalyticsData = {
  genderDistribution: GenderDistributionPoint[];
  genderInsights: string[];
  insights: InsightItem[];
  occupancyData: OccupancyPoint[];
  planDist: PlanPoint[];
  revenueTrend: RevenuePoint[];
  slotGenderData: SlotGenderPoint[];
};

const planColors = ["hsl(172, 66%, 45%)", "hsl(38, 92%, 50%)", "hsl(210, 80%, 55%)", "hsl(340, 82%, 58%)", "hsl(270, 70%, 58%)"];
const genderColors: Record<StudentGender, string> = {
  female: "hsl(330, 81%, 68%)",
  male: "hsl(206, 90%, 62%)",
};

const getErrorMessage = (error: unknown): string => getSafeErrorMessage(error);

const normalizeText = (value: string | null | undefined) => (value || "").replace(/\s+/g, "").toLowerCase();

const slotMatches = (studentSlot: string | null, slotName: string): boolean => {
  if (!studentSlot) return false;
  const a = normalizeText(studentSlot);
  const b = normalizeText(slotName);
  return a === b || a.includes(b) || b.includes(a);
};

const isActiveStudent = (student: StudentAnalyticsRow, today: Date): boolean => {
  return isStudentCurrentlyActive(student, today);
};

const getHighestGenderSlot = (rows: SlotGenderPoint[], gender: StudentGender) => {
  const sorted = [...rows].sort((left, right) => right[gender] - left[gender]);
  return sorted[0] && sorted[0][gender] > 0 ? sorted[0] : null;
};

const buildGenderInsights = (rows: SlotGenderPoint[], femaleCount: number, maleCount: number, scope: StudentGenderFilter) => {
  const insights: string[] = [];
  const total = maleCount + femaleCount;

  if (total === 0) {
    return ["Add student gender data to unlock seating and slot-level insights."];
  }

  if (scope !== "all") {
    const scopedLabel = formatStudentGender(scope);
    const topSlot = getHighestGenderSlot(rows, scope);
    const occupiedSlots = rows.filter((row) => row[scope] > 0).length;

    if (topSlot) {
      insights.push(`${scopedLabel} students are most concentrated in ${topSlot.slot}.`);
    }

    if (occupiedSlots > 0) {
      insights.push(`${scopedLabel} students are spread across ${occupiedSlots} active slot${occupiedSlots === 1 ? "" : "s"}.`);
    }

    if ((scope === "male" ? maleCount : femaleCount) <= 3) {
      insights.push(`Only ${(scope === "male" ? maleCount : femaleCount).toString()} ${scopedLabel.toLowerCase()} students match this filter right now.`);
    }

    return insights.length > 0 ? insights.slice(0, 3) : [`${scopedLabel} students have been captured, but slot patterns are still too sparse to read.`];
  }

  const femaleRatio = (femaleCount / total) * 100;
  const maleRatio = (maleCount / total) * 100;
  const femaleTopSlot = getHighestGenderSlot(rows, "female");
  const maleTopSlot = getHighestGenderSlot(rows, "male");
  const dominatedSlot = [...rows]
    .filter((row) => row.total >= 3)
    .sort((left, right) => {
      const leftBias = Math.max(left.male, left.female) / left.total;
      const rightBias = Math.max(right.male, right.female) / right.total;
      return rightBias - leftBias;
    })[0];

  if (femaleTopSlot) {
    insights.push(`Female students are most concentrated in ${femaleTopSlot.slot}.`);
  }

  if (femaleRatio < 35) {
    insights.push(`Low female ratio detected: ${femaleRatio.toFixed(0)}% of active students are female.`);
  } else if (maleRatio < 35) {
    insights.push(`Low male ratio detected: ${maleRatio.toFixed(0)}% of active students are male.`);
  }

  if (dominatedSlot) {
    const dominantGender = dominatedSlot.female > dominatedSlot.male ? "female" : "male";
    const dominantCount = dominantGender === "female" ? dominatedSlot.female : dominatedSlot.male;
    insights.push(`${dominatedSlot.slot} is ${dominantGender}-dominated (${dominantCount} of ${dominatedSlot.total} students).`);
  } else if (Math.abs(femaleRatio - maleRatio) <= 10) {
    insights.push("Gender mix is balanced overall, which supports flexible seating decisions.");
  }

  if (insights.length < 3 && maleTopSlot) {
    insights.push(`Male students are most concentrated in ${maleTopSlot.slot}.`);
  }

  return insights.length > 0 ? insights.slice(0, 3) : ["Gender data is available, but slot patterns are still too sparse to detect a trend."];
};

const AnalyticsPage = () => {
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();
  const [genderFilter, setGenderFilter] = useState<StudentGenderFilter>("all");

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
    queryKey: ["analytics-overview", resolvedLibraryId, genderFilter],
    queryFn: async (): Promise<AnalyticsData> => {
      if (!resolvedLibraryId) {
        return {
          genderDistribution: [],
          genderInsights: [],
          insights: [],
          occupancyData: [],
          planDist: [],
          revenueTrend: [],
          slotGenderData: [],
        };
      }

      const now = new Date();
      const today = startOfDay(now);
      const monthStarts = Array.from({ length: 7 }, (_, index) => addMonths(startOfMonth(subMonths(now, 6)), index));
      const chartStart = monthStarts[0].toISOString();

      const [libraryRes, slotsRes, studentsRes, paymentsRes] = await Promise.all([
        supabase.from("libraries").select("id, total_seats").eq("id", resolvedLibraryId).maybeSingle(),
        supabase
          .from("time_slots")
          .select("id, name, max_seats, is_active")
          .eq("library_id", resolvedLibraryId)
          .eq("is_active", true)
          .order("start_time", { ascending: true }),
        supabase
          .from("students")
          .select("id, plan, slot, status, expiry_date, gender")
          .eq("library_id", resolvedLibraryId),
        supabase
          .from("payments")
          .select("amount, status, created_at, student_id")
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
      const scopedStudents = genderFilter === "all" ? activeStudents : activeStudents.filter((student) => student.gender === genderFilter);
      const scopedStudentIds = new Set(scopedStudents.map((student) => student.id));

      const slotCount = slots.length;
      const baseCapacityPerSlot = slotCount > 0 ? Math.max(1, Math.ceil((library?.total_seats || slotCount) / slotCount)) : 0;

      const occupancyData: OccupancyPoint[] = slots.map((slot) => {
        const occupied = scopedStudents.filter((student) => slotMatches(student.slot, slot.name)).length;
        const capacity = slot.max_seats && slot.max_seats > 0 ? slot.max_seats : baseCapacityPerSlot;
        const rawOccupancy = capacity > 0 ? (occupied / capacity) * 100 : 0;
        return {
          capacity,
          occupancy: Math.max(0, Math.min(100, Math.round(rawOccupancy))),
          occupied,
          rawOccupancy,
          slot: slot.name,
        };
      });

      const planCount = new Map<string, number>();
      for (const student of scopedStudents) {
        const key = (student.plan || "Unassigned").trim() || "Unassigned";
        planCount.set(key, (planCount.get(key) || 0) + 1);
      }

      const planDist: PlanPoint[] = Array.from(planCount.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([name, value], index) => ({
          color: planColors[index % planColors.length],
          name,
          value,
        }));

      const femaleCount = scopedStudents.filter((student) => student.gender === "female").length;
      const maleCount = scopedStudents.filter((student) => student.gender === "male").length;
      const genderTotal = maleCount + femaleCount;

      const genderDistribution: GenderDistributionPoint[] = STUDENT_GENDER_OPTIONS.map((option) => {
        const value = option.value === "male" ? maleCount : femaleCount;
        return {
          color: genderColors[option.value],
          name: option.label,
          percentage: genderTotal > 0 ? Math.round((value / genderTotal) * 100) : 0,
          value,
        };
      }).filter((point) => point.value > 0);

      const slotGenderData: SlotGenderPoint[] = slots.map((slot) => {
        const male = scopedStudents.filter((student) => student.gender === "male" && slotMatches(student.slot, slot.name)).length;
        const female = scopedStudents.filter((student) => student.gender === "female" && slotMatches(student.slot, slot.name)).length;
        return {
          female,
          male,
          slot: slot.name,
          total: male + female,
        };
      });

      const scopedPayments = genderFilter === "all" ? payments : payments.filter((payment) => payment.student_id && scopedStudentIds.has(payment.student_id));
      const trendMap = new Map<string, number>();
      monthStarts.forEach((monthDate) => trendMap.set(format(monthDate, "yyyy-MM"), 0));

      for (const payment of scopedPayments) {
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
        const sortedByOccupancy = [...occupancyData].sort((left, right) => right.rawOccupancy - left.rawOccupancy);
        const topSlot = sortedByOccupancy[0];
        const lowSlot = sortedByOccupancy[sortedByOccupancy.length - 1];

        if (topSlot && topSlot.rawOccupancy >= 100) {
          insights.push({
            type: "revenue",
            text: `${topSlot.slot} slot is overbooked (${Math.round(topSlot.rawOccupancy)}%). Increase capacity or adjust pricing.`,
          });
        } else if (topSlot && topSlot.rawOccupancy >= 85) {
          insights.push({
            type: "revenue",
            text: `${topSlot.slot} slot has ${Math.round(topSlot.rawOccupancy)}% occupancy. Consider a small price increase.`,
          });
        }

        if (lowSlot && lowSlot.rawOccupancy <= 60) {
          insights.push({
            type: "discount",
            text: `${lowSlot.slot} slot has low occupancy (${Math.round(lowSlot.rawOccupancy)}%). Run an offer to improve fill rate.`,
          });
        }
      }

      if (planDist.length > 0) {
        insights.push({
          type: "growth",
          text: `${planDist[0].name} is the most popular plan in this view (${planDist[0].value} active students).`,
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
          text: `Revenue is ${diff >= 0 ? "up" : "down"} ${Math.abs(diff).toFixed(0)}% vs last month for this view.`,
        });
      }

      if (insights.length === 0) {
        insights.push({ type: "growth", text: "Add more student and payment data to unlock deeper operational insights." });
      }

      return {
        genderDistribution,
        genderInsights: buildGenderInsights(slotGenderData, femaleCount, maleCount, genderFilter),
        insights: insights.slice(0, 3),
        occupancyData,
        planDist,
        revenueTrend,
        slotGenderData,
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
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Analytics</h2>
            <p className="mt-1 text-sm text-muted-foreground">Insights into your library performance</p>
          </div>

          <div className="w-full max-w-[220px] space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Gender Filter</p>
            <Select value={genderFilter} onValueChange={(value) => setGenderFilter(value as StudentGenderFilter)}>
              <SelectTrigger className="h-11 rounded-2xl border-border/70 bg-card">
                <SelectValue placeholder="All genders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                {STUDENT_GENDER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RevenueChart data={data?.revenueTrend || []} title="Revenue Trend" />

              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-4 text-sm font-semibold font-display text-foreground">Slot Occupancy</h3>
                <div className="h-64">
                  {loading ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading slot analytics...</div>
                  ) : (data?.occupancyData.length || 0) === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No slot occupancy data yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data?.occupancyData || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(200, 15%, 89%)" />
                        <XAxis dataKey="slot" tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" />
                        <YAxis tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" tickFormatter={(value) => `${value}%`} domain={[0, 100]} />
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

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-4 text-sm font-semibold font-display text-foreground">Plan Distribution</h3>
                <div className="flex h-64 items-center justify-center">
                  {loading ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading plan distribution...</div>
                  ) : (data?.planDist.length || 0) === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No active plan data yet</div>
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
                {(data?.planDist.length || 0) > 0 ? (
                  <div className="mt-2 flex flex-wrap justify-center gap-4">
                    {(data?.planDist || []).map((plan) => (
                      <div key={plan.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: plan.color }} />
                        {plan.name} ({plan.value})
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-4 text-sm font-semibold font-display text-foreground">Smart Insights</h3>
                <div className="space-y-4">
                  {(loading ? [] : data?.insights || []).map((insight, index) => (
                    <div key={`${insight.type}-${index}`} className="flex items-start gap-3 rounded-lg bg-secondary/50 p-3">
                      <div
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                          insight.type === "revenue" ? "bg-success" : insight.type === "discount" ? "bg-warning" : "bg-info"
                        }`}
                      />
                      <p className="text-sm text-foreground">{insight.text}</p>
                    </div>
                  ))}
                  {loading ? <p className="text-sm text-muted-foreground">Generating insights...</p> : null}
                </div>
                {!loading && !hasRevenue ? <p className="mt-4 text-xs text-muted-foreground">Tip: Add payments to improve revenue analytics.</p> : null}
              </div>
            </div>

            <section className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-foreground">Gender Insights</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Turn gender data into operational signals for seating comfort, slot planning, and targeted outreach.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.25fr_0.95fr]">
                <div className="rounded-xl border border-border bg-card p-5">
                  <h4 className="mb-4 text-sm font-semibold font-display text-foreground">Gender Distribution</h4>
                  <div className="flex h-64 items-center justify-center">
                    {loading ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading gender distribution...</div>
                    ) : (data?.genderDistribution.length || 0) === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No gender data captured yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data?.genderDistribution || []}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={92}
                            dataKey="value"
                            paddingAngle={4}
                          >
                            {(data?.genderDistribution || []).map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => [String(value), "Students"]} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  {(data?.genderDistribution.length || 0) > 0 ? (
                    <div className="space-y-2">
                      {(data?.genderDistribution || []).map((entry) => (
                        <div key={entry.name} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                            <span className="text-foreground">{entry.name}</span>
                          </div>
                          <span className="text-muted-foreground">
                            {entry.value} ({entry.percentage}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <h4 className="mb-4 text-sm font-semibold font-display text-foreground">Slot-wise Gender Analysis</h4>
                  <div className="h-72">
                    {loading ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading slot-wise gender split...</div>
                    ) : (data?.slotGenderData.length || 0) === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No slot-wise gender data yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data?.slotGenderData || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(200, 15%, 89%)" />
                          <XAxis dataKey="slot" tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" />
                          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="hsl(200, 10%, 45%)" />
                          <Tooltip
                            formatter={(value: number, name: string) => [String(value), name === "male" ? "Male students" : "Female students"]}
                          />
                          <Bar dataKey="male" stackId="gender" fill={genderColors.male} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="female" stackId="gender" fill={genderColors.female} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {STUDENT_GENDER_OPTIONS.map((option) => (
                      <div key={option.value} className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: genderColors[option.value] }} />
                        {formatStudentGender(option.value)}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <h4 className="mb-4 text-sm font-semibold font-display text-foreground">Smart Gender Insights</h4>
                  <div className="space-y-4">
                    {(loading ? [] : data?.genderInsights || []).map((insight, index) => (
                      <div key={`${insight}-${index}`} className="rounded-lg bg-secondary/50 p-3">
                        <p className="text-sm text-foreground">{insight}</p>
                      </div>
                    ))}
                    {loading ? <p className="text-sm text-muted-foreground">Scanning gender patterns...</p> : null}
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AnalyticsPage;
