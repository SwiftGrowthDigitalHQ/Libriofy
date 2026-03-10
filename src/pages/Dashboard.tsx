import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, startOfMonth, subMonths, addMonths, differenceInCalendarDays, formatDistanceToNowStrict } from "date-fns";
import { Users, LayoutGrid, CreditCard, CalendarClock, AlertTriangle, CheckCircle, Info } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StatsCard from "@/components/dashboard/StatsCard";
import RevenueChart, { type RevenuePoint } from "@/components/dashboard/RevenueChart";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { isSuccessfulPaymentStatus } from "@/lib/payments";

type LibraryRow = Pick<Database["public"]["Tables"]["libraries"]["Row"], "id" | "total_seats">;
type StudentDashboardRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "id" | "full_name" | "plan" | "status" | "seat_number" | "expiry_date" | "created_at"
>;
type NotificationRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "id" | "type" | "title" | "message" | "created_at"
>;
type PaymentRow = Pick<Database["public"]["Tables"]["payments"]["Row"], "id" | "amount" | "status" | "created_at"> & {
  students: { full_name: string | null } | null;
};
type AttendanceRow = Pick<Database["public"]["Tables"]["attendance_logs"]["Row"], "id" | "check_in" | "check_out"> & {
  students: { full_name: string | null; seat_number: string | null } | null;
};

type ActivityType = "success" | "warning" | "info";

type ActivityItem = {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
  type: ActivityType;
};

type DashboardData = {
  totalSeats: number;
  occupiedSeats: number;
  activeStudents: number;
  newAdmissionsThisMonth: number;
  revenueMTD: number;
  previousRevenueMTD: number;
  expiringSoon: number;
  revenueTrend: RevenuePoint[];
  recentActivity: ActivityItem[];
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unknown error";
  return (error as { message?: string }).message || "Unknown error";
};

const parseMs = (value: string): number => {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
};

const isSuccessfulPayment = (status: string | null): boolean => isSuccessfulPaymentStatus(status);

const isActiveStudent = (student: StudentDashboardRow, today: Date): boolean => {
  if (student.status !== "active") return false;
  if (!student.expiry_date) return true;
  const expiry = new Date(`${student.expiry_date}T00:00:00`);
  return expiry >= today;
};

const notificationTypeToActivityType = (type: string): ActivityType => {
  const value = type.toLowerCase();
  if (value.includes("expiry") || value.includes("no_show") || value.includes("waitlist")) return "warning";
  if (value.includes("success") || value.includes("payment")) return "success";
  return "info";
};

const Dashboard = () => {
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
    data: dashboard,
    isLoading: dashboardLoading,
    isError: dashboardError,
    error: dashboardQueryError,
  } = useQuery({
    queryKey: ["dashboard-overview", resolvedLibraryId],
    queryFn: async (): Promise<DashboardData> => {
      if (!resolvedLibraryId) {
        return {
          totalSeats: 0,
          occupiedSeats: 0,
          activeStudents: 0,
          newAdmissionsThisMonth: 0,
          revenueMTD: 0,
          previousRevenueMTD: 0,
          expiringSoon: 0,
          revenueTrend: [],
          recentActivity: [],
        };
      }

      const now = new Date();
      const today = startOfDay(now);
      const startCurrentMonth = startOfMonth(now);
      const startPreviousMonth = startOfMonth(subMonths(now, 1));
      const previousComparableEnd = subMonths(now, 1);
      const chartStart = startOfMonth(subMonths(now, 6)).toISOString();
      const todayIso = format(now, "yyyy-MM-dd");

      const [libraryRes, studentsRes, paymentsRes, notificationsRes, attendanceRes] = await Promise.all([
        supabase.from("libraries").select("id, total_seats").eq("id", resolvedLibraryId).maybeSingle(),
        supabase
          .from("students")
          .select("id, full_name, plan, status, seat_number, expiry_date, created_at")
          .eq("library_id", resolvedLibraryId),
        supabase
          .from("payments")
          .select("id, amount, status, created_at, students:student_id(full_name)")
          .eq("library_id", resolvedLibraryId)
          .gte("created_at", chartStart)
          .order("created_at", { ascending: false }),
        supabase
          .from("notifications")
          .select("id, type, title, message, created_at")
          .eq("library_id", resolvedLibraryId)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("attendance_logs")
          .select("id, check_in, check_out, students:student_id(full_name, seat_number)")
          .eq("library_id", resolvedLibraryId)
          .eq("date", todayIso)
          .order("check_in", { ascending: false })
          .limit(10),
      ]);

      if (libraryRes.error) throw libraryRes.error;
      if (studentsRes.error) throw studentsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;
      if (notificationsRes.error) throw notificationsRes.error;
      if (attendanceRes.error) throw attendanceRes.error;

      const library = libraryRes.data as LibraryRow | null;
      const students = (studentsRes.data ?? []) as StudentDashboardRow[];
      const payments = (paymentsRes.data ?? []) as PaymentRow[];
      const notifications = (notificationsRes.data ?? []) as NotificationRow[];
      const attendance = (attendanceRes.data ?? []) as AttendanceRow[];

      const activeStudentsList = students.filter((student) => isActiveStudent(student, today));
      const activeStudents = activeStudentsList.length;
      const occupiedSeats = new Set(
        activeStudentsList
          .map((student) => (student.seat_number || "").trim().toUpperCase())
          .filter((seat) => !!seat),
      ).size;

      const newAdmissionsThisMonth = students.filter((student) => parseMs(student.created_at) >= startCurrentMonth.getTime()).length;

      const expiringSoon = activeStudentsList.filter((student) => {
        if (!student.expiry_date) return false;
        const expiry = new Date(`${student.expiry_date}T00:00:00`);
        const days = differenceInCalendarDays(expiry, today);
        return days >= 0 && days <= 7;
      }).length;

      const successfulPayments = payments.filter((payment) => isSuccessfulPayment(payment.status));

      let revenueMTD = 0;
      let previousRevenueMTD = 0;

      for (const payment of successfulPayments) {
        const paymentDate = new Date(payment.created_at);
        const amount = Number(payment.amount) || 0;

        if (paymentDate >= startCurrentMonth && paymentDate <= now) {
          revenueMTD += amount;
        }

        if (paymentDate >= startPreviousMonth && paymentDate <= previousComparableEnd) {
          previousRevenueMTD += amount;
        }
      }

      const monthStarts = Array.from({ length: 7 }, (_, i) => addMonths(startOfMonth(subMonths(now, 6)), i));
      const trendMap = new Map<string, number>();
      monthStarts.forEach((monthDate) => trendMap.set(format(monthDate, "yyyy-MM"), 0));

      for (const payment of successfulPayments) {
        const key = format(new Date(payment.created_at), "yyyy-MM");
        if (trendMap.has(key)) {
          trendMap.set(key, (trendMap.get(key) || 0) + Number(payment.amount || 0));
        }
      }

      const revenueTrend: RevenuePoint[] = monthStarts.map((monthDate) => {
        const key = format(monthDate, "yyyy-MM");
        return {
          month: format(monthDate, "MMM"),
          revenue: Math.round(trendMap.get(key) || 0),
        };
      });

      const notificationActivities: ActivityItem[] = notifications.map((item) => ({
        id: `notif-${item.id}`,
        action: item.title,
        detail: item.message || "Notification",
        createdAt: item.created_at,
        type: notificationTypeToActivityType(item.type),
      }));

      const admissionActivities: ActivityItem[] = [...students]
        .sort((a, b) => parseMs(b.created_at) - parseMs(a.created_at))
        .slice(0, 3)
        .map((student) => ({
          id: `student-${student.id}`,
          action: "New admission",
          detail: `${student.full_name}${student.plan ? ` - Plan: ${student.plan}` : ""}`,
          createdAt: student.created_at,
          type: "success",
        }));

      const paymentActivities: ActivityItem[] = successfulPayments.slice(0, 3).map((payment) => ({
        id: `payment-${payment.id}`,
        action: "Payment received",
        detail: `Rs ${Number(payment.amount || 0).toLocaleString("en-IN")}${payment.students?.full_name ? ` from ${payment.students.full_name}` : ""}`,
        createdAt: payment.created_at,
        type: "success",
      }));

      const attendanceActivities: ActivityItem[] = attendance.map((row) => ({
        id: `attendance-${row.id}`,
        action: row.check_out ? "Check-out" : "Check-in",
        detail: `${row.students?.full_name || "Student"}${row.students?.seat_number ? ` - Seat ${row.students.seat_number}` : ""}`,
        createdAt: row.check_out || row.check_in,
        type: "info",
      }));

      const recentActivity = [...notificationActivities, ...admissionActivities, ...paymentActivities, ...attendanceActivities]
        .sort((a, b) => parseMs(b.createdAt) - parseMs(a.createdAt))
        .slice(0, 8);

      return {
        totalSeats: library?.total_seats || 0,
        occupiedSeats,
        activeStudents,
        newAdmissionsThisMonth,
        revenueMTD: Math.round(revenueMTD),
        previousRevenueMTD: Math.round(previousRevenueMTD),
        expiringSoon,
        revenueTrend,
        recentActivity,
      };
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
  });

  const loading = roleLibraryLoading || fallbackLoading || dashboardLoading;

  const revenueChange = useMemo(() => {
    const current = dashboard?.revenueMTD || 0;
    const previous = dashboard?.previousRevenueMTD || 0;

    if (previous <= 0) {
      if (current <= 0) return { text: "No collections yet", trend: "down" as const };
      return { text: "New collections started", trend: "up" as const };
    }

    const pct = ((current - previous) / previous) * 100;
    return {
      text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs last month`,
      trend: pct >= 0 ? ("up" as const) : ("down" as const),
    };
  }, [dashboard?.revenueMTD, dashboard?.previousRevenueMTD]);

  const getActivityIcon = (type: ActivityType) => {
    if (type === "success") return <CheckCircle className="w-3.5 h-3.5 text-success" />;
    if (type === "warning") return <AlertTriangle className="w-3.5 h-3.5 text-warning" />;
    return <Info className="w-3.5 h-3.5 text-info" />;
  };

  const getActivityBg = (type: ActivityType) => {
    if (type === "success") return "bg-success/10";
    if (type === "warning") return "bg-warning/10";
    return "bg-info/10";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">Overview of your library operations</p>
        </div>

        {!resolvedLibraryId && !loading ? (
          <Card>
            <CardContent className="py-8 text-center text-destructive">
              Library not linked to your account. Please check user role setup.
            </CardContent>
          </Card>
        ) : dashboardError ? (
          <Card>
            <CardContent className="py-8 text-center text-destructive">
              Unable to load dashboard: {getErrorMessage(dashboardQueryError)}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatsCard
                icon={LayoutGrid}
                title="Total Seats"
                value={String(dashboard?.totalSeats ?? 0)}
                change={`${dashboard?.occupiedSeats ?? 0} occupied now`}
                trend="up"
              />
              <StatsCard
                icon={Users}
                title="Active Students"
                value={String(dashboard?.activeStudents ?? 0)}
                change={`${dashboard?.newAdmissionsThisMonth ?? 0} added this month`}
                trend="up"
                iconColor="text-info"
              />
              <StatsCard
                icon={CreditCard}
                title="Revenue (MTD)"
                value={`Rs ${(dashboard?.revenueMTD ?? 0).toLocaleString("en-IN")}`}
                change={revenueChange.text}
                trend={revenueChange.trend}
                iconColor="text-success"
              />
              <StatsCard
                icon={CalendarClock}
                title="Expiring Soon"
                value={String(dashboard?.expiringSoon ?? 0)}
                change="Next 7 days"
                trend="down"
                iconColor="text-warning"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <RevenueChart data={dashboard?.revenueTrend ?? []} />
              </div>

              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold font-display text-foreground mb-4">Recent Activity</h3>

                {loading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Loading activity...</p>
                ) : (dashboard?.recentActivity.length || 0) === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No recent activity yet</p>
                ) : (
                  <div className="space-y-4">
                    {dashboard?.recentActivity.map((item) => (
                      <div key={item.id} className="flex items-start gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${getActivityBg(item.type)}`}>
                          {getActivityIcon(item.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{item.action}</p>
                          <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
