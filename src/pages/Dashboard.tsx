import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle,
  Flame,
  Info,
  LayoutGrid,
  MessageCircle,
  Phone,
  Plus,
  ScanLine,
  UserRoundX,
  Users,
  XCircle,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import RevenueControlDashboard from "@/components/dashboard/RevenueControlDashboard";
import RevenueChart, { type DailyRevenuePoint, type RevenuePoint } from "@/components/dashboard/RevenueChart";
import StatsCard from "@/components/dashboard/StatsCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { comparePaymentSummaryRisk, createPlanPriceLookup, derivePaymentSummary, groupPaymentsByStudent } from "@/lib/paymentRecovery";
import { isPendingPaymentStatus, isSuccessfulPaymentStatus } from "@/lib/payments";
import { isMissingRelationError } from "@/lib/studentSlotUtils";
import { cn } from "@/lib/utils";

type LibraryRow = Pick<Database["public"]["Tables"]["libraries"]["Row"], "id" | "name" | "opening_hours" | "total_seats" | "upi_id">;
type PlanDashboardRow = Pick<Database["public"]["Tables"]["plans"]["Row"], "id" | "name" | "price">;
type StudentDashboardRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "id" | "created_at" | "expiry_date" | "full_name" | "last_check_in" | "no_show_days" | "phone" | "plan" | "plan_id" | "seat_number" | "start_date" | "status"
>;
type NotificationRow = Pick<
  Database["public"]["Tables"]["notifications"]["Row"],
  "id" | "type" | "category" | "title" | "message" | "created_at"
>;
type PaymentRow = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  "id" | "amount" | "created_at" | "payment_method" | "period_end" | "period_start" | "plan" | "status" | "student_id"
> & {
  students: { full_name: string | null; phone: string | null; seat_number: string | null } | null;
};
type LockerDashboardRow = Pick<Database["public"]["Tables"]["lockers"]["Row"], "id" | "monthly_price" | "status">;
type AttendanceRow = Pick<
  Database["public"]["Tables"]["attendance_logs"]["Row"],
  "id" | "student_id" | "date" | "check_in" | "check_out"
> & {
  students: { full_name: string | null; seat_number: string | null } | null;
};
type AutomatedCallDashboardRow = {
  call_status: string;
  created_at: string;
  estimated_recovery_impact: number;
  pickup_status: string;
};

type ActivityType = "success" | "warning" | "info";
type MetricTone = "success" | "warning" | "danger" | "info" | "neutral";

type ActivityItem = {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
  type: ActivityType;
};

type AttendanceInsight = {
  id: string;
  name: string;
  seatNumber: string | null;
  phone: string | null;
  estimatedMonthlyValue: number;
  streakDays: number;
  absentDays: number;
  lastAttendedDate: string | null;
  isPresentToday: boolean;
  riskLevel: "low" | "medium" | "high" | null;
};

type TopPayer = {
  id: string;
  name: string;
  paymentCount: number;
  totalAmount: number;
};

type PendingPaymentInsight = {
  id: string;
  amount: number;
  createdAt: string;
  studentName: string;
  phone: string | null;
  seatNumber: string | null;
};

type MoneyPriorityItem = {
  id: string;
  name: string;
  amountAtRisk: number;
  reason: string;
  phone: string | null;
  seatNumber: string | null;
  source: "payment" | "risk" | "absence";
  urgency: "critical" | "warning" | "watch";
  whatsappMessage: string;
};

type SmartSuggestion = {
  id: string;
  title: string;
  detail: string;
  actionLabel: string;
  onClick: () => void;
  tone: MetricTone;
};

type DashboardData = {
  openingHours: string | null;
  totalSeats: number;
  occupiedSeats: number;
  totalLockers: number;
  availableLockers: number;
  occupiedLockers: number;
  lockerRevenue: number;
  activeStudents: number;
  newAdmissionsThisMonth: number;
  revenueMTD: number;
  previousRevenueMTD: number;
  expiringSoon: number;
  revenueTrend: RevenuePoint[];
  dailyRevenueTrend: DailyRevenuePoint[];
  recentActivity: ActivityItem[];
  eligibleStudents: number;
  attendanceMarkedToday: boolean;
  missedAttendanceCompletedDays: number;
  attendanceRate: number;
  todayPresent: number;
  todayAbsent: number;
  activeStreakStudents: number;
  absentTodayStudents: AttendanceInsight[];
  riskStudents: AttendanceInsight[];
  urgentRiskStudents: AttendanceInsight[];
  topStreakStudent: AttendanceInsight | null;
  streakLeaderboard: AttendanceInsight[];
  topPayingStudents: TopPayer[];
  topPayersRangeLabel: string;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: number;
  oldestPendingPaymentAgeDays: number | null;
  pendingPaymentsRecent: PendingPaymentInsight[];
  automatedCallsMade: number;
  automatedCallsPicked: number;
  automatedCallsMissed: number;
  automatedRecoveryImpact: number;
  riskRevenueAtRisk: number;
  urgentRiskRevenueAtRisk: number;
  totalRevenueAtRisk: number;
  averageStudentValue: number;
  recoveredToday: number;
  paymentsReceivedToday: number;
  studentsConvertedToday: number;
};

type TodayTask = {
  id: string;
  title: string;
  detail: string;
  urgencyLabel: string;
  actionLabel: string;
  tone: MetricTone;
  onClick: () => void;
  autoCompleted?: boolean;
  canMarkDone?: boolean;
};

type DashboardDayState = {
  attendanceSkipUsed: boolean;
  completedTaskIds: string[];
};

const ATTENDANCE_LOOKBACK_DAYS = 120;
const ATTENDANCE_DEADLINE_HOUR = 21;
const DASHBOARD_DAY_STATE_PREFIX = "libriofy:dashboard-day-state";

const EMPTY_DASHBOARD_DATA: DashboardData = {
  openingHours: null,
  totalSeats: 0,
  occupiedSeats: 0,
  totalLockers: 0,
  availableLockers: 0,
  occupiedLockers: 0,
  lockerRevenue: 0,
  activeStudents: 0,
  newAdmissionsThisMonth: 0,
  revenueMTD: 0,
  previousRevenueMTD: 0,
  expiringSoon: 0,
  revenueTrend: [],
  dailyRevenueTrend: [],
  recentActivity: [],
  eligibleStudents: 0,
  attendanceMarkedToday: false,
  missedAttendanceCompletedDays: 0,
  attendanceRate: 0,
  todayPresent: 0,
  todayAbsent: 0,
  activeStreakStudents: 0,
  absentTodayStudents: [],
  riskStudents: [],
  urgentRiskStudents: [],
  topStreakStudent: null,
  streakLeaderboard: [],
  topPayingStudents: [],
  topPayersRangeLabel: "This month",
  pendingPaymentsCount: 0,
  pendingPaymentsAmount: 0,
  oldestPendingPaymentAgeDays: null,
  pendingPaymentsRecent: [],
  automatedCallsMade: 0,
  automatedCallsPicked: 0,
  automatedCallsMissed: 0,
  automatedRecoveryImpact: 0,
  riskRevenueAtRisk: 0,
  urgentRiskRevenueAtRisk: 0,
  totalRevenueAtRisk: 0,
  averageStudentValue: 0,
  recoveredToday: 0,
  paymentsReceivedToday: 0,
  studentsConvertedToday: 0,
};

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unknown error";
  return (error as { message?: string }).message || "Unknown error";
};

const parseMs = (value: string): number => {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
};

const formatInr = (amount: number) => `\u20b9${Math.round(amount).toLocaleString("en-IN")}`;

const isSuccessfulPayment = (status: string | null): boolean => isSuccessfulPaymentStatus(status);

const isPendingPayment = (status: string | null): boolean => isPendingPaymentStatus(status);

const toDateKey = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.length >= 10 ? value.slice(0, 10) : null;
};

const maxDateKey = (left: string | null, right: string | null): string | null => {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
};

const normalizeWhatsAppNumber = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const getStudentStartDate = (student: StudentDashboardRow) => startOfDay(new Date(`${student.start_date}T00:00:00`));

const getDashboardDayStorageKey = (libraryId: string, dateKey: string) =>
  `${DASHBOARD_DAY_STATE_PREFIX}:${libraryId}:${dateKey}`;

const readDashboardDayState = (libraryId: string | null, dateKey: string): DashboardDayState => {
  if (!libraryId || typeof window === "undefined") {
    return { attendanceSkipUsed: false, completedTaskIds: [] };
  }

  try {
    const raw = window.localStorage.getItem(getDashboardDayStorageKey(libraryId, dateKey));
    if (!raw) {
      return { attendanceSkipUsed: false, completedTaskIds: [] };
    }

    const parsed = JSON.parse(raw) as Partial<DashboardDayState>;
    return {
      attendanceSkipUsed: parsed.attendanceSkipUsed === true,
      completedTaskIds: Array.isArray(parsed.completedTaskIds)
        ? parsed.completedTaskIds.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return { attendanceSkipUsed: false, completedTaskIds: [] };
  }
};

const writeDashboardDayState = (libraryId: string | null, dateKey: string, state: DashboardDayState) => {
  if (!libraryId || typeof window === "undefined") return;
  window.localStorage.setItem(getDashboardDayStorageKey(libraryId, dateKey), JSON.stringify(state));
};

const parseClosingTime = (openingHours: string | null | undefined) => {
  if (!openingHours) return null;

  const matches = Array.from(openingHours.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi));
  const lastMatch = matches.at(-1);
  if (!lastMatch) return null;

  let hours = Number(lastMatch[1]);
  const minutes = Number(lastMatch[2] || 0);
  const meridiem = lastMatch[3]?.toLowerCase();

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
};

const getAttendanceDeadline = (now: Date, openingHours: string | null) => {
  const parsedClosingTime = parseClosingTime(openingHours);
  const deadline = new Date(now);

  deadline.setHours(
    parsedClosingTime?.hours ?? ATTENDANCE_DEADLINE_HOUR,
    parsedClosingTime?.minutes ?? 0,
    0,
    0,
  );

  return deadline;
};

const formatRemainingTime = (now: Date, deadline: Date) => {
  const diffMs = deadline.getTime() - now.getTime();
  if (diffMs <= 0) return "Deadline passed";

  const totalMinutes = Math.ceil(diffMs / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes} min${totalMinutes === 1 ? "" : "s"} left`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hour${hours === 1 ? "" : "s"} left`;
  return `${hours}h ${minutes}m left`;
};

const calculateLibraryAttendanceMissedDays = (
  attendanceDates: Set<string>,
  startDate: Date | null,
  today: Date,
  includeToday: boolean,
) => {
  if (!startDate) return 0;

  let missedDays = 0;
  let cursor = includeToday ? today : subDays(today, 1);

  while (cursor >= startDate && missedDays < ATTENDANCE_LOOKBACK_DAYS) {
    const key = format(cursor, "yyyy-MM-dd");
    if (attendanceDates.has(key)) break;
    missedDays += 1;
    cursor = subDays(cursor, 1);
  }

  return missedDays;
};

const isActiveStudent = (student: StudentDashboardRow, today: Date): boolean => {
  if (student.status !== "active") return false;
  if (!student.expiry_date) return true;
  const expiry = new Date(`${student.expiry_date}T00:00:00`);
  return expiry >= today;
};

const isAttendanceTrackedStudent = (student: StudentDashboardRow, today: Date): boolean => {
  if (student.status === "waiting") return false;
  if (getStudentStartDate(student) > today) return false;
  if (!student.expiry_date) return true;
  const expiry = new Date(`${student.expiry_date}T00:00:00`);
  return expiry >= today;
};

const notificationTypeToActivityType = (category: string | null, type: string): ActivityType => {
  const value = type.toLowerCase();
  if (value.includes("locker_assigned")) return "success";
  if (value.includes("locker_payment_due")) return "warning";
  if (category === "payment") return "success";
  if (category === "renewal") return value.includes("expired") || value.includes("expiry") ? "warning" : "info";
  if (value.includes("expiry") || value.includes("no_show") || value.includes("waitlist")) return "warning";
  if (value.includes("success") || value.includes("payment")) return "success";
  return "info";
};

const calculatePresentStreak = (attendanceDates: Set<string>, startDate: Date, today: Date) => {
  const todayKey = format(today, "yyyy-MM-dd");
  if (!attendanceDates.has(todayKey)) return 0;

  let streak = 0;
  let cursor = today;

  while (cursor >= startDate && streak < ATTENDANCE_LOOKBACK_DAYS) {
    const key = format(cursor, "yyyy-MM-dd");
    if (!attendanceDates.has(key)) break;
    streak += 1;
    cursor = subDays(cursor, 1);
  }

  return streak;
};

const calculateAbsenceStreak = (
  attendanceDates: Set<string>,
  startDate: Date,
  today: Date,
  fallbackNoShowDays: number,
) => {
  const todayKey = format(today, "yyyy-MM-dd");
  if (attendanceDates.has(todayKey)) return 0;

  let absentDays = 0;
  let cursor = today;

  while (cursor >= startDate && absentDays < ATTENDANCE_LOOKBACK_DAYS) {
    const key = format(cursor, "yyyy-MM-dd");
    if (attendanceDates.has(key)) break;
    absentDays += 1;
    cursor = subDays(cursor, 1);
  }

  return Math.max(absentDays, fallbackNoShowDays);
};

const getRiskLevel = (absentDays: number): AttendanceInsight["riskLevel"] => {
  if (absentDays >= 5) return "high";
  if (absentDays >= 3) return "medium";
  if (absentDays >= 2) return "low";
  return null;
};

const getRiskLabel = (riskLevel: AttendanceInsight["riskLevel"]) => {
  if (riskLevel === "high") return "High risk";
  if (riskLevel === "medium") return "Medium risk";
  if (riskLevel === "low") return "Low risk";
  return "Stable";
};

const getRiskBadgeClassName = (riskLevel: AttendanceInsight["riskLevel"]) => {
  if (riskLevel === "high") return "border-red-300 bg-red-50 text-red-700";
  if (riskLevel === "medium") return "border-orange-300 bg-orange-50 text-orange-700";
  if (riskLevel === "low") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-border/70 bg-muted/40 text-foreground";
};

const getLastSeenLabel = (dateKey: string | null) => {
  if (!dateKey) return "No attendance recorded yet";
  return `Last attended ${formatDistanceToNowStrict(new Date(`${dateKey}T00:00:00`), { addSuffix: true })}`;
};

const getOverdueLabel = (days: number | null) => {
  if (days === null) return "No overdue fees";
  if (days <= 0) return "Due today";
  if (days === 1) return "1 day overdue";
  return `${days} days overdue`;
};

const buildReminderMessage = (student: AttendanceInsight) => {
  const lastSeen = student.lastAttendedDate
    ? `Your last attendance was on ${format(new Date(`${student.lastAttendedDate}T00:00:00`), "dd MMM yyyy")}. `
    : "";
  return `Hi ${student.name}, we missed you at the library today. ${lastSeen}You have been absent for ${student.absentDays} day${student.absentDays === 1 ? "" : "s"}. Please reply if you need any help or plan to continue your seat.`;
};

const buildPaymentRecoveryMessage = (name: string, amount: number) =>
  `Hi ${name}, your library payment of ${formatInr(amount)} is pending. Please clear it today to keep your seat active without interruption.`;

const metricToneClasses: Record<MetricTone, { card: string; iconBox: string; icon: string; value: string }> = {
  success: {
    card: "border-success/25 bg-gradient-to-br from-success/10 via-card to-card shadow-md shadow-success/10",
    iconBox: "bg-success/10",
    icon: "text-success",
    value: "text-success",
  },
  warning: {
    card: "border-amber-300/40 bg-gradient-to-br from-amber-50 via-card to-card shadow-md shadow-amber-100/70",
    iconBox: "bg-amber-100",
    icon: "text-amber-700",
    value: "text-foreground",
  },
  danger: {
    card: "border-destructive/25 bg-gradient-to-br from-destructive/10 via-card to-card shadow-md shadow-destructive/10",
    iconBox: "bg-destructive/10",
    icon: "text-destructive",
    value: "text-destructive",
  },
  info: {
    card: "border-info/25 bg-gradient-to-br from-info/10 via-card to-card shadow-md shadow-info/10",
    iconBox: "bg-info/10",
    icon: "text-info",
    value: "text-foreground",
  },
  neutral: {
    card: "border-primary/15 bg-gradient-to-br from-primary/5 via-card to-card shadow-sm",
    iconBox: "bg-primary/10",
    icon: "text-primary",
    value: "text-foreground",
  },
};

const getToneBadgeClassName = (tone: MetricTone) =>
  cn(
    "shrink-0",
    tone === "danger" && "border-destructive/20 bg-destructive/10 text-destructive",
    tone === "warning" && "border-warning/20 bg-warning/10 text-warning",
    tone === "info" && "border-info/20 bg-info/10 text-info",
    tone === "success" && "border-success/20 bg-success/10 text-success",
    tone === "neutral" && "border-border/70 bg-muted/40 text-foreground",
  );

const InsightMetricCard = ({
  title,
  value,
  subtitle,
  tone = "neutral",
  icon: Icon,
  actionLabel,
  actionTo,
  compactValue = false,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone?: MetricTone;
  icon: typeof Users;
  actionLabel?: string;
  actionTo?: string;
  compactValue?: boolean;
}) => {
  const toneClasses = metricToneClasses[tone];

  return (
    <Card className={cn("h-full", toneClasses.card)}>
      <CardContent className="flex h-full items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
          <p
            className={cn(
              "mt-3 font-bold font-display",
              compactValue ? "text-base leading-6" : "text-2xl",
              toneClasses.value,
            )}
          >
            {value}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          {actionLabel && actionTo ? (
            <Button asChild size="sm" className="mt-4 h-8 px-3 font-semibold shadow-sm">
              <Link to={actionTo}>{actionLabel}</Link>
            </Button>
          ) : null}
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", toneClasses.iconBox)}>
          <Icon className={cn("h-5 w-5", toneClasses.icon)} />
        </div>
      </CardContent>
    </Card>
  );
};

const RevenueSummaryCard = ({
  title,
  value,
  detail,
  tone = "neutral",
}: {
  title: string;
  value: string;
  detail: string;
  tone?: MetricTone;
}) => (
  <div
    className={cn(
      "rounded-2xl border p-4 shadow-sm",
      tone === "danger" && "border-destructive/25 bg-gradient-to-br from-destructive/10 via-card to-card",
      tone === "success" && "border-success/25 bg-gradient-to-br from-success/10 via-card to-card",
      tone === "info" && "border-info/25 bg-gradient-to-br from-info/10 via-card to-card",
      tone === "neutral" && "border-border/70 bg-card",
    )}
  >
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
    <p className={cn("mt-3 text-2xl font-bold font-display", tone === "danger" ? "text-destructive" : "text-foreground")}>
      {value}
    </p>
    <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
  </div>
);

const Dashboard = () => {
  const absentSectionRef = useRef<HTMLDivElement | null>(null);
  const riskSectionRef = useRef<HTMLDivElement | null>(null);
  const skipDashboardDayStateWriteRef = useRef(true);
  const [showAllUrgentRisk, setShowAllUrgentRisk] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [dashboardDayState, setDashboardDayState] = useState<DashboardDayState>({
    attendanceSkipUsed: false,
    completedTaskIds: [],
  });
  const [attendanceAlertCollapsed, setAttendanceAlertCollapsed] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);

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
  const currentDateKey = format(currentTime, "yyyy-MM-dd");

  useEffect(() => {
    skipDashboardDayStateWriteRef.current = true;
    const nextState = readDashboardDayState(resolvedLibraryId, currentDateKey);
    setDashboardDayState(nextState);
    setAttendanceAlertCollapsed(nextState.attendanceSkipUsed);
    setTasksOpen(true);
  }, [currentDateKey, resolvedLibraryId]);

  useEffect(() => {
    if (skipDashboardDayStateWriteRef.current) {
      skipDashboardDayStateWriteRef.current = false;
      return;
    }
    writeDashboardDayState(resolvedLibraryId, currentDateKey, dashboardDayState);
  }, [currentDateKey, dashboardDayState, resolvedLibraryId]);

  const {
    data: dashboard,
    isLoading: dashboardLoading,
    isError: dashboardError,
    error: dashboardQueryError,
    refetch: refetchDashboard,
  } = useQuery({
    queryKey: ["dashboard-overview", resolvedLibraryId],
    queryFn: async (): Promise<DashboardData> => {
      if (!resolvedLibraryId || !user?.id) {
        return EMPTY_DASHBOARD_DATA;
      }

      const now = new Date();
      const today = startOfDay(now);
      const todayIso = format(today, "yyyy-MM-dd");
      const attendanceStart = format(subDays(today, ATTENDANCE_LOOKBACK_DAYS - 1), "yyyy-MM-dd");
      const startCurrentMonth = startOfMonth(now);
      const startPreviousMonth = startOfMonth(subMonths(now, 1));
      const previousComparableEnd = subMonths(now, 1);

      const [libraryRes, studentsRes, plansRes, paymentsRes, notificationsRes, attendanceRes, lockersRes, automatedCallsRes] = await Promise.all([
        supabase.from("libraries").select("id, name, opening_hours, total_seats, upi_id").eq("id", resolvedLibraryId).maybeSingle(),
        supabase
          .from("students")
          .select(
            "id, created_at, expiry_date, full_name, last_check_in, no_show_days, phone, plan, plan_id, seat_number, start_date, status",
          )
          .eq("library_id", resolvedLibraryId),
        supabase.from("plans").select("id, name, price").eq("library_id", resolvedLibraryId),
        supabase
          .from("payments")
          .select("id, amount, created_at, payment_method, period_end, period_start, plan, status, student_id, students:student_id(full_name, phone, seat_number)")
          .eq("library_id", resolvedLibraryId)
          .order("created_at", { ascending: false }),
        supabase
          .from("notifications")
          .select("id, type, category, title, message, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("attendance_logs")
          .select("id, student_id, date, check_in, check_out, students:student_id(full_name, seat_number)")
          .eq("library_id", resolvedLibraryId)
          .gte("date", attendanceStart)
          .order("check_in", { ascending: false }),
        supabase
          .from("lockers")
          .select("id, status, monthly_price")
          .eq("library_id", resolvedLibraryId),
        supabase
          .from("automated_calls" as any)
          .select("call_status, created_at, estimated_recovery_impact, pickup_status")
          .eq("library_id", resolvedLibraryId)
          .gte("created_at", startCurrentMonth.toISOString())
          .lte("created_at", now.toISOString())
          .order("created_at", { ascending: false }),
      ]);

      if (libraryRes.error) throw libraryRes.error;
      if (studentsRes.error) throw studentsRes.error;
      if (plansRes.error) throw plansRes.error;
      if (paymentsRes.error) throw paymentsRes.error;
      if (notificationsRes.error) throw notificationsRes.error;
      if (attendanceRes.error) throw attendanceRes.error;
      if (lockersRes.error && !isMissingRelationError(lockersRes.error, "lockers")) throw lockersRes.error;
      if (automatedCallsRes.error && !isMissingRelationError(automatedCallsRes.error, "automated_calls")) throw automatedCallsRes.error;

      const library = (libraryRes.data as LibraryRow | null) ?? null;
      const students = (studentsRes.data ?? []) as StudentDashboardRow[];
      const plans = (plansRes.data ?? []) as PlanDashboardRow[];
      const payments = (paymentsRes.data ?? []) as PaymentRow[];
      const notifications = (notificationsRes.data ?? []) as NotificationRow[];
      const attendance = (attendanceRes.data ?? []) as AttendanceRow[];
      const lockers = lockersRes.error ? [] : ((lockersRes.data ?? []) as LockerDashboardRow[]);
      const automatedCalls = (automatedCallsRes.error ? [] : ((automatedCallsRes.data ?? []) as AutomatedCallDashboardRow[])).map((call) => ({
        ...call,
        estimated_recovery_impact: Number(call.estimated_recovery_impact || 0),
      }));

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

      const totalLockers = lockers.length;
      const availableLockers = lockers.filter((locker) => locker.status === "available").length;
      const occupiedLockers = lockers.filter((locker) => locker.status === "occupied").length;
      const lockerRevenue = lockers
        .filter((locker) => locker.status === "occupied")
        .reduce((sum, locker) => sum + Number(locker.monthly_price || 0), 0);

      const successfulPayments = payments.filter((payment) => isSuccessfulPayment(payment.status));
      const pendingPayments = payments.filter((payment) => isPendingPayment(payment.status));
      const planLookup = createPlanPriceLookup(
        plans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          price: plan.price,
        })),
      );
      const paymentsByStudentId = groupPaymentsByStudent(payments);
      const paymentSummaries = activeStudentsList
        .map((student) =>
          derivePaymentSummary({
            libraryName: library?.name ?? "Library",
            planLookup,
            student,
            studentPayments: paymentsByStudentId.get(student.id) ?? [],
            upiId: library?.upi_id ?? null,
          }),
        )
        .sort(comparePaymentSummaryRisk);
      const pendingPaymentSummaries = paymentSummaries.filter((summary) => summary.amountDue > 0);
      const successfulPaymentsToday = successfulPayments.filter((payment) => toDateKey(payment.created_at) === todayIso);
      const recoveredToday = Math.round(successfulPaymentsToday.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
      const paymentsReceivedToday = successfulPaymentsToday.length;
      const studentsConvertedToday = new Set(
        successfulPaymentsToday.map((payment) => payment.student_id).filter((studentId): studentId is string => !!studentId),
      ).size;
      const automatedCallsMade = automatedCalls.length;
      const automatedCallsPicked = automatedCalls.filter((call) => call.pickup_status === "picked").length;
      const automatedCallsMissed = automatedCalls.filter((call) => call.pickup_status === "not_picked").length;
      const automatedRecoveryImpact = Math.round(
        automatedCalls.reduce((sum, call) => sum + Number(call.estimated_recovery_impact || 0), 0),
      );

      const latestSuccessfulPaymentByStudent = new Map<string, number>();
      const latestChargeByStudent = new Map<string, number>();

      for (const payment of payments) {
        const amount = Number(payment.amount) || 0;
        if (amount <= 0 || !payment.student_id) continue;

        if (!latestChargeByStudent.has(payment.student_id)) {
          latestChargeByStudent.set(payment.student_id, amount);
        }

        if (isSuccessfulPayment(payment.status) && !latestSuccessfulPaymentByStudent.has(payment.student_id)) {
          latestSuccessfulPaymentByStudent.set(payment.student_id, amount);
        }
      }

      const latestSuccessfulValues = Array.from(latestSuccessfulPaymentByStudent.values()).filter((value) => value > 0);
      const averageStudentValue = Math.round(
        latestSuccessfulValues.length > 0
          ? latestSuccessfulValues.reduce((sum, value) => sum + value, 0) / latestSuccessfulValues.length
          : planLookup.averagePrice > 0
            ? planLookup.averagePrice
            : successfulPayments.length > 0
              ? successfulPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) / successfulPayments.length
              : 0,
      );

      let revenueMTD = 0;
      let previousRevenueMTD = 0;
      const dailyRevenueCurrent = new Map<number, number>();
      const dailyRevenuePrevious = new Map<number, number>();

      for (const payment of successfulPayments) {
        const paymentDate = new Date(payment.created_at);
        const amount = Number(payment.amount) || 0;

        if (paymentDate >= startCurrentMonth && paymentDate <= now) {
          revenueMTD += amount;
          const dayNumber = paymentDate.getDate();
          dailyRevenueCurrent.set(dayNumber, (dailyRevenueCurrent.get(dayNumber) || 0) + amount);
        }

        if (paymentDate >= startPreviousMonth && paymentDate <= previousComparableEnd) {
          previousRevenueMTD += amount;
          const dayNumber = paymentDate.getDate();
          dailyRevenuePrevious.set(dayNumber, (dailyRevenuePrevious.get(dayNumber) || 0) + amount);
        }
      }

      const monthStarts = Array.from({ length: 7 }, (_, index) => addMonths(startOfMonth(subMonths(now, 6)), index));
      const trendMap = new Map<string, number>();
      monthStarts.forEach((monthDate) => trendMap.set(format(monthDate, "yyyy-MM"), 0));

      for (const payment of successfulPayments) {
        const key = format(new Date(payment.created_at), "yyyy-MM");
        if (trendMap.has(key)) {
          trendMap.set(key, (trendMap.get(key) || 0) + (Number(payment.amount) || 0));
        }
      }

      const revenueTrend: RevenuePoint[] = monthStarts.map((monthDate) => {
        const key = format(monthDate, "yyyy-MM");
        return {
          month: format(monthDate, "MMM"),
          revenue: Math.round(trendMap.get(key) || 0),
        };
      });

      const dailyRevenueTrend: DailyRevenuePoint[] = Array.from(
        { length: differenceInCalendarDays(today, startCurrentMonth) + 1 },
        (_, index) => {
          const currentDate = new Date(startCurrentMonth);
          currentDate.setDate(index + 1);

          const previousDate = new Date(startPreviousMonth);
          previousDate.setDate(index + 1);
          const hasPreviousMatch = previousDate.getMonth() === startPreviousMonth.getMonth();

          return {
            day: format(currentDate, "d"),
            label: format(currentDate, "dd MMM"),
            currentMonthRevenue: Math.round(dailyRevenueCurrent.get(index + 1) || 0),
            previousMonthRevenue: hasPreviousMatch ? Math.round(dailyRevenuePrevious.get(index + 1) || 0) : 0,
          };
        },
      );

      const attendanceMap = new Map<string, { dates: Set<string>; lastAttendedDate: string | null }>();

      for (const row of attendance) {
        const dateKey = toDateKey(row.date) ?? toDateKey(row.check_in);
        if (!dateKey) continue;

        const currentStudentAttendance = attendanceMap.get(row.student_id) ?? {
          dates: new Set<string>(),
          lastAttendedDate: null,
        };

        currentStudentAttendance.dates.add(dateKey);
        currentStudentAttendance.lastAttendedDate = maxDateKey(currentStudentAttendance.lastAttendedDate, dateKey);
        attendanceMap.set(row.student_id, currentStudentAttendance);
      }

      const trackedStudents = students.filter((student) => isAttendanceTrackedStudent(student, today));
      const trackedStudentIds = new Set(trackedStudents.map((student) => student.id));
      const trackedAttendanceDates = new Set(
        attendance
          .filter((row) => trackedStudentIds.has(row.student_id))
          .map((row) => toDateKey(row.date) ?? toDateKey(row.check_in))
          .filter((value): value is string => !!value),
      );
      const todayPresentIds = new Set(
        attendance
          .filter((row) => trackedStudentIds.has(row.student_id) && (toDateKey(row.date) ?? toDateKey(row.check_in)) === todayIso)
          .map((row) => row.student_id),
      );

      const firstTrackedStartDate = trackedStudents.reduce<Date | null>((earliest, student) => {
        const startDate = getStudentStartDate(student);
        if (!earliest || startDate < earliest) return startDate;
        return earliest;
      }, null);

      const attendanceMarkedToday = trackedAttendanceDates.has(todayIso);
      const missedAttendanceCompletedDays = calculateLibraryAttendanceMissedDays(
        trackedAttendanceDates,
        firstTrackedStartDate,
        today,
        false,
      );

      const attendanceInsights: AttendanceInsight[] = trackedStudents.map((student) => {
        const startDate = getStudentStartDate(student);
        const studentAttendance = attendanceMap.get(student.id);
        const attendanceDates = studentAttendance?.dates ?? new Set<string>();
        const lastAttendedDate = maxDateKey(studentAttendance?.lastAttendedDate ?? null, toDateKey(student.last_check_in));
        const estimatedMonthlyValue =
          latestSuccessfulPaymentByStudent.get(student.id) ??
          latestChargeByStudent.get(student.id) ??
          averageStudentValue;
        const isPresentToday = todayPresentIds.has(student.id);
        const streakDays = calculatePresentStreak(attendanceDates, startDate, today);
        const absentDays = calculateAbsenceStreak(attendanceDates, startDate, today, Math.max(student.no_show_days || 0, 0));
        const riskLevel = getRiskLevel(absentDays);

        return {
          id: student.id,
          name: student.full_name,
          seatNumber: student.seat_number,
          phone: student.phone,
          estimatedMonthlyValue: Math.round(estimatedMonthlyValue),
          streakDays,
          absentDays,
          lastAttendedDate,
          isPresentToday,
          riskLevel,
        };
      });

      const absentTodayStudents = attendanceInsights
        .filter((student) => !student.isPresentToday)
        .sort((left, right) => right.absentDays - left.absentDays || left.name.localeCompare(right.name));

      const riskStudents = absentTodayStudents.filter((student) => student.absentDays >= 2);
      const urgentRiskStudents = riskStudents.filter((student) => student.absentDays >= 3);
      const streakLeaderboard = [...attendanceInsights]
        .filter((student) => student.streakDays > 0)
        .sort((left, right) => right.streakDays - left.streakDays || left.name.localeCompare(right.name))
        .slice(0, 3);

      const eligibleStudents = trackedStudents.length;
      const todayPresent = todayPresentIds.size;
      const todayAbsent = Math.max(eligibleStudents - todayPresent, 0);
      const attendanceRate = eligibleStudents > 0 ? Math.round((todayPresent / eligibleStudents) * 100) : 0;
      const activeStreakStudents = attendanceInsights.filter((student) => student.streakDays > 0).length;
      const riskRevenueAtRisk = Math.round(riskStudents.reduce((sum, student) => sum + student.estimatedMonthlyValue, 0));
      const urgentRiskRevenueAtRisk = Math.round(
        urgentRiskStudents.reduce((sum, student) => sum + student.estimatedMonthlyValue, 0),
      );
      const pendingPaymentsAmount = Math.round(
        pendingPaymentSummaries.reduce((sum, summary) => sum + summary.amountDue, 0),
      );
      const totalRevenueAtRisk = Math.round(riskRevenueAtRisk + pendingPaymentsAmount);
      const oldestPendingPaymentAgeDays =
        pendingPaymentSummaries[0] != null
          ? pendingPaymentSummaries.reduce((oldest, summary) => Math.max(oldest, summary.overdueDays), 0)
          : null;

      const currentMonthSuccessfulPayments = successfulPayments.filter((payment) => {
        const paymentDate = new Date(payment.created_at);
        return paymentDate >= startCurrentMonth && paymentDate <= now;
      });

      const topPayersMap = new Map<string, TopPayer>();
      for (const payment of currentMonthSuccessfulPayments) {
        const amount = Number(payment.amount) || 0;
        const existing = topPayersMap.get(payment.student_id) ?? {
          id: payment.student_id,
          name: payment.students?.full_name || "Student",
          paymentCount: 0,
          totalAmount: 0,
        };

        existing.paymentCount += 1;
        existing.totalAmount += amount;
        topPayersMap.set(payment.student_id, existing);
      }

      const topPayingStudents = Array.from(topPayersMap.values())
        .sort((left, right) => right.totalAmount - left.totalAmount || left.name.localeCompare(right.name))
        .slice(0, 3);

      const pendingPaymentsRecent: PendingPaymentInsight[] = pendingPaymentSummaries.slice(0, 4).map((summary) => ({
        id: summary.studentId,
        amount: summary.amountDue,
        createdAt: summary.dueDate ? `${summary.dueDate}T00:00:00` : now.toISOString(),
        studentName: summary.studentName,
        phone: summary.phone,
        seatNumber: summary.seatNumber,
      }));

      const notificationActivities: ActivityItem[] = notifications.map((item) => ({
        id: `notif-${item.id}`,
        action: item.title,
        detail: item.message || "Notification",
        createdAt: item.created_at,
        type: notificationTypeToActivityType(item.category, item.type),
      }));

      const admissionActivities: ActivityItem[] = [...students]
        .sort((left, right) => parseMs(right.created_at) - parseMs(left.created_at))
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
        detail: `${formatInr(Number(payment.amount) || 0)}${payment.students?.full_name ? ` from ${payment.students.full_name}` : ""}`,
        createdAt: payment.created_at,
        type: "success",
      }));

      const attendanceActivities: ActivityItem[] = attendance.slice(0, 4).map((row) => ({
        id: `attendance-${row.id}`,
        action: row.check_out ? "Check-out" : "Check-in",
        detail: `${row.students?.full_name || "Student"}${row.students?.seat_number ? ` - Seat ${row.students.seat_number}` : ""}`,
        createdAt: row.check_out || row.check_in,
        type: "info",
      }));

      const recentActivity = [...notificationActivities, ...admissionActivities, ...paymentActivities, ...attendanceActivities]
        .sort((left, right) => parseMs(right.createdAt) - parseMs(left.createdAt))
        .slice(0, 8);

      return {
        openingHours: library?.opening_hours || null,
        totalSeats: library?.total_seats || 0,
        occupiedSeats,
        totalLockers,
        availableLockers,
        occupiedLockers,
        lockerRevenue: Math.round(lockerRevenue),
        activeStudents,
        newAdmissionsThisMonth,
        revenueMTD: Math.round(revenueMTD),
        previousRevenueMTD: Math.round(previousRevenueMTD),
        expiringSoon,
        revenueTrend,
        dailyRevenueTrend,
        recentActivity,
        eligibleStudents,
        attendanceMarkedToday,
        missedAttendanceCompletedDays,
        attendanceRate,
        todayPresent,
        todayAbsent,
        activeStreakStudents,
        absentTodayStudents,
        riskStudents,
        urgentRiskStudents,
        topStreakStudent: streakLeaderboard[0] ?? null,
        streakLeaderboard,
        topPayingStudents,
        topPayersRangeLabel: "This month",
        pendingPaymentsCount: pendingPaymentSummaries.length,
        pendingPaymentsAmount,
        oldestPendingPaymentAgeDays,
        pendingPaymentsRecent,
        automatedCallsMade,
        automatedCallsPicked,
        automatedCallsMissed,
        automatedRecoveryImpact,
        riskRevenueAtRisk,
        urgentRiskRevenueAtRisk,
        totalRevenueAtRisk,
        averageStudentValue,
        recoveredToday,
        paymentsReceivedToday,
        studentsConvertedToday,
      };
    },
    enabled: !!resolvedLibraryId && !!user?.id,
    refetchInterval: 15_000,
  });

  const loading = roleLibraryLoading || fallbackLoading || dashboardLoading;
  const dashboardData = dashboard ?? EMPTY_DASHBOARD_DATA;
  const attendanceDeadline = useMemo(
    () => getAttendanceDeadline(currentTime, dashboardData.openingHours),
    [currentTime, dashboardData.openingHours],
  );
  const attendanceCountdownLabel = dashboardData.attendanceMarkedToday
    ? "Completed for today"
    : formatRemainingTime(currentTime, attendanceDeadline);
  const recoveryWindowLabel = formatRemainingTime(currentTime, attendanceDeadline);

  const attendanceSummaryLabel = dashboardData.attendanceMarkedToday
    ? dashboardData.eligibleStudents > 0
      ? `${dashboardData.attendanceRate}% attendance coverage across ${dashboardData.eligibleStudents} tracked students`
      : "Add students and start marking attendance to unlock streaks and risk alerts."
    : dashboardData.eligibleStudents > 0
      ? `Attendance not marked for ${dashboardData.eligibleStudents} tracked students. ${attendanceCountdownLabel}.`
      : "Add students and start marking attendance to unlock streaks and risk alerts.";

  const showAttendanceGate =
    dashboardData.eligibleStudents > 0 &&
    dashboardData.missedAttendanceCompletedDays >= 2 &&
    !dashboardData.attendanceMarkedToday;

  const revenueChange = useMemo(() => {
    const current = dashboardData.revenueMTD;
    const previous = dashboardData.previousRevenueMTD;

    if (previous <= 0) {
      if (current <= 0) return { text: "No collections yet", trend: "down" as const };
      return { text: "Collections started this month", trend: "up" as const };
    }

    const pct = ((current - previous) / previous) * 100;
    return {
      text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs last month`,
      trend: pct >= 0 ? ("up" as const) : ("down" as const),
    };
  }, [dashboardData.previousRevenueMTD, dashboardData.revenueMTD]);

  const revenueInsight = useMemo(() => {
    const peakDay = dashboardData.dailyRevenueTrend.reduce<DailyRevenuePoint | null>((best, point) => {
      if (!best || point.currentMonthRevenue > best.currentMonthRevenue) return point;
      return best;
    }, null);
    const revenueDeltaPct =
      dashboardData.previousRevenueMTD > 0
        ? Math.abs(((dashboardData.revenueMTD - dashboardData.previousRevenueMTD) / dashboardData.previousRevenueMTD) * 100).toFixed(0)
        : null;

    const earnedText =
      dashboardData.revenueMTD > 0
        ? `${formatInr(dashboardData.revenueMTD)} collected this month`
        : "No earnings recorded this month";

    const riskText =
      dashboardData.totalRevenueAtRisk > 0
        ? `${formatInr(dashboardData.totalRevenueAtRisk)} needs attention today`
        : "No immediate revenue pressure right now";

    const growthText =
      revenueDeltaPct !== null
        ? `Growth vs last month: ${dashboardData.revenueMTD >= dashboardData.previousRevenueMTD ? "+" : "-"}${revenueDeltaPct}%`
        : "Growth vs last month: Waiting for comparison data";

    const peakText =
      peakDay && peakDay.currentMonthRevenue > 0
        ? `Peak earning day: ${peakDay.label} (${formatInr(peakDay.currentMonthRevenue)})`
        : "Peak earning day: Waiting for the first approved payment";

    return { earnedText, riskText, growthText, peakText };
  }, [
    dashboardData.dailyRevenueTrend,
    dashboardData.previousRevenueMTD,
    dashboardData.revenueMTD,
    dashboardData.totalRevenueAtRisk,
  ]);

  const visibleRiskStudents = showAllUrgentRisk
    ? dashboardData.riskStudents
    : dashboardData.riskStudents.slice(0, 4);

  const primaryReminderTarget = useMemo(
    () =>
      dashboardData.urgentRiskStudents[0] ??
      dashboardData.riskStudents[0] ??
      dashboardData.absentTodayStudents[0] ??
      null,
    [dashboardData.absentTodayStudents, dashboardData.riskStudents, dashboardData.urgentRiskStudents],
  );

  const copyReminder = async (student: AttendanceInsight) => {
    if (!navigator.clipboard?.writeText) {
      toast({
        title: "Clipboard unavailable",
        description: "Your browser cannot copy the reminder text automatically.",
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(buildReminderMessage(student));
      toast({
        title: "Reminder copied",
        description: `${student.name}'s follow-up message is ready to paste.`,
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Unable to copy the reminder message.",
        variant: "destructive",
      });
    }
  };

  const openWhatsAppReminder = (student: AttendanceInsight) => {
    const phone = normalizeWhatsAppNumber(student.phone);
    if (!phone) {
      toast({
        title: "No phone number",
        description: `${student.name} does not have a WhatsApp number saved yet.`,
        variant: "destructive",
      });
      return;
    }

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildReminderMessage(student))}`, "_blank", "noopener,noreferrer");
    toast({
      title: "WhatsApp opened",
      description: `Drafted a reminder for ${student.name}.`,
    });
  };

  const sendReminder = async (student: AttendanceInsight) => {
    const phone = normalizeWhatsAppNumber(student.phone);
    if (phone) {
      openWhatsAppReminder(student);
      return;
    }

    await copyReminder(student);
  };

  const scrollToSection = (ref: { current: HTMLDivElement | null }) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleQuickReminder = async () => {
    if (!primaryReminderTarget) {
      toast({
        title: "No reminder needed",
        description: "No absent students need a follow-up right now.",
      });
      return;
    }

    await copyReminder(primaryReminderTarget);
  };

  const handleQuickWhatsApp = () => {
    if (!primaryReminderTarget) {
      toast({
        title: "No reminder needed",
        description: "No absent students need a WhatsApp follow-up right now.",
      });
      return;
    }

    openWhatsAppReminder(primaryReminderTarget);
  };

  const emptySeats = Math.max(dashboardData.totalSeats - dashboardData.occupiedSeats, 0);
  const highRiskStudentsCount = dashboardData.urgentRiskStudents.length;
  const emptySeatRevenueLoss = Math.round(emptySeats * Math.max(dashboardData.averageStudentValue, 0));
  const occupancyRate = dashboardData.totalSeats > 0 ? Math.round((dashboardData.occupiedSeats / dashboardData.totalSeats) * 100) : 0;
  const churnRate = dashboardData.activeStudents > 0 ? Number(((dashboardData.riskStudents.length / dashboardData.activeStudents) * 100).toFixed(1)) : 0;
  const revenuePerSeat = dashboardData.occupiedSeats > 0 ? Math.round(dashboardData.revenueMTD / dashboardData.occupiedSeats) : 0;

  const openPhoneCall = (phone: string | null, name: string) => {
    const normalizedPhone = normalizeWhatsAppNumber(phone);
    if (!normalizedPhone) {
      toast({
        title: "Phone number missing",
        description: `${name} does not have a callable number saved yet.`,
        variant: "destructive",
      });
      return;
    }

    window.location.href = `tel:${normalizedPhone}`;
  };

  const openPriorityWhatsApp = (item: MoneyPriorityItem) => {
    const phone = normalizeWhatsAppNumber(item.phone);
    if (!phone) {
      toast({
        title: "WhatsApp number missing",
        description: `${item.name} does not have a WhatsApp number saved yet.`,
        variant: "destructive",
      });
      return;
    }

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(item.whatsappMessage)}`, "_blank", "noopener,noreferrer");
  };

  const handleMarkAsPaid = (item: MoneyPriorityItem) => {
    navigate("/dashboard/payments");
    toast({
      title: "Open payment recovery",
      description: `Review ${item.name}'s payment and mark it paid after confirmation.`,
    });
  };

  const handleRemoveSeat = (item: MoneyPriorityItem) => {
    navigate("/dashboard/students");
    toast({
      title: "Seat action opened",
      description: `Review ${item.name}'s seat before removing or reallocating it.`,
    });
  };

  const handleRecoverNow = () => {
    if (dashboardData.pendingPaymentsCount > 0 || dashboardData.riskStudents.length > 0) {
      scrollToSection(riskSectionRef);
      toast({
        title: "Auto recovery armed",
        description: "Revenue priority list is ready for call, WhatsApp, and payment actions.",
      });
      return;
    }

    toast({
      title: "No recovery queue right now",
      description: "Today's money risk is already under control.",
    });
  };

  const handleCallHighRiskStudents = () => {
    const target = dashboardData.urgentRiskStudents[0] ?? dashboardData.riskStudents[0] ?? null;
    if (!target) {
      toast({
        title: "No high-risk students",
        description: "There is no urgent call list right now.",
      });
      return;
    }

    openPhoneCall(target.phone, target.name);
  };

  const moneyPriorityItems = useMemo<MoneyPriorityItem[]>(() => {
    const urgencyRank: Record<MoneyPriorityItem["urgency"], number> = {
      critical: 0,
      warning: 1,
      watch: 2,
    };

    const paymentItems: MoneyPriorityItem[] = dashboardData.pendingPaymentsRecent.map((payment) => {
      const overdueDays = differenceInCalendarDays(currentTime, startOfDay(new Date(payment.createdAt)));
      return {
        id: `payment-${payment.id}`,
        name: payment.studentName,
        amountAtRisk: payment.amount,
        reason: `Unpaid fee - ${getOverdueLabel(overdueDays)}`,
        phone: payment.phone,
        seatNumber: payment.seatNumber,
        source: "payment",
        urgency: overdueDays >= 3 ? "critical" : "warning",
        whatsappMessage: buildPaymentRecoveryMessage(payment.studentName, payment.amount),
      };
    });

    const riskItems: MoneyPriorityItem[] = dashboardData.riskStudents.map((student) => ({
      id: `risk-${student.id}`,
      name: student.name,
      amountAtRisk: student.estimatedMonthlyValue,
      reason:
        student.absentDays > 0
          ? `${student.absentDays} absent day${student.absentDays === 1 ? "" : "s"}`
          : "No attendance trend",
      phone: student.phone,
      seatNumber: student.seatNumber,
      source: "risk",
      urgency: student.riskLevel === "high" ? "critical" : "warning",
      whatsappMessage: buildReminderMessage(student),
    }));

    const absenceItems: MoneyPriorityItem[] = dashboardData.absentTodayStudents
      .filter((student) => !dashboardData.riskStudents.some((riskStudent) => riskStudent.id === student.id))
      .slice(0, 4)
      .map((student) => ({
        id: `absence-${student.id}`,
        name: student.name,
        amountAtRisk: student.estimatedMonthlyValue,
        reason: "No attendance today",
        phone: student.phone,
        seatNumber: student.seatNumber,
        source: "absence" as const,
        urgency: "watch" as const,
        whatsappMessage: buildReminderMessage(student),
      }));

    return [...paymentItems, ...riskItems, ...absenceItems].sort((left, right) => {
      const amountDiff = right.amountAtRisk - left.amountAtRisk;
      if (amountDiff !== 0) return amountDiff;
      return urgencyRank[left.urgency] - urgencyRank[right.urgency];
    });
  }, [currentTime, dashboardData.absentTodayStudents, dashboardData.pendingPaymentsRecent, dashboardData.riskStudents]);

  const visibleMoneyPriorityItems = showAllUrgentRisk ? moneyPriorityItems : moneyPriorityItems.slice(0, 6);
  const callNowCandidates = dashboardData.urgentRiskStudents.length > 0 ? dashboardData.urgentRiskStudents : dashboardData.riskStudents;
  const callNowStudents = callNowCandidates.slice(0, 5);
  const callNowRecovery = Math.round(callNowStudents.reduce((sum, student) => sum + student.estimatedMonthlyValue, 0));
  const inactiveSeatCandidates = dashboardData.riskStudents.filter((student) => student.absentDays >= 5).length;

  const smartSuggestions = useMemo<SmartSuggestion[]>(() => {
    const suggestions: SmartSuggestion[] = [];

    suggestions.push({
      id: "call-now",
      title:
        callNowStudents.length > 0
          ? `Call these ${callNowStudents.length} students now to protect ${formatInr(callNowRecovery)}`
          : "No urgent call list right now",
      detail:
        callNowStudents.length > 0
          ? "Start with the students who have already crossed the churn threshold."
          : "Focus on seat fill and attendance quality while the risk queue stays clean.",
      actionLabel: callNowStudents.length > 0 ? "Start Calling" : "Review Students",
      onClick: callNowStudents.length > 0 ? handleCallHighRiskStudents : () => navigate("/dashboard/students"),
      tone: callNowStudents.length > 0 ? "danger" : "success",
    });

    suggestions.push({
      id: "inactive-seats",
      title:
        inactiveSeatCandidates > 0
          ? `${inactiveSeatCandidates} inactive students should be reviewed for seat recovery`
          : emptySeats > 0
            ? `${emptySeats} empty seats are leaking ${formatInr(emptySeatRevenueLoss)} every month`
            : "Seat utilization is healthy right now",
      detail:
        inactiveSeatCandidates > 0
          ? "Freeing blocked seats is the fastest path to new revenue without new capacity."
          : emptySeats > 0
            ? "Push short-term follow-ups and refill the red seats first."
            : "Keep protecting paid seats and reduce absence risk before it turns into churn.",
      actionLabel: inactiveSeatCandidates > 0 ? "Review Seats" : "Open Seat View",
      onClick: inactiveSeatCandidates > 0 ? () => navigate("/dashboard/students") : () => scrollToSection(absentSectionRef),
      tone: inactiveSeatCandidates > 0 || emptySeats > 0 ? "warning" : "success",
    });

    suggestions.push({
      id: "attendance-pressure",
      title: dashboardData.attendanceMarkedToday ? "Attendance completed, now move to fee recovery" : "Attendance delay is increasing churn risk",
      detail: dashboardData.attendanceMarkedToday
        ? `${dashboardData.todayAbsent} students are still absent today, so follow up before the day closes.`
        : attendanceSummaryLabel,
      actionLabel: dashboardData.attendanceMarkedToday ? "Open Priority List" : "Mark Attendance",
      onClick: dashboardData.attendanceMarkedToday ? () => scrollToSection(riskSectionRef) : () => navigate("/dashboard/attendance"),
      tone: dashboardData.attendanceMarkedToday ? "info" : "danger",
    });

    return suggestions;
  }, [
    absentSectionRef,
    attendanceSummaryLabel,
    callNowRecovery,
    callNowStudents.length,
    dashboardData.attendanceMarkedToday,
    dashboardData.todayAbsent,
    emptySeatRevenueLoss,
    emptySeats,
    inactiveSeatCandidates,
    navigate,
  ]);

  const dailyActionFlow = useMemo(
    () => [
      {
        id: "attendance",
        step: "Mark attendance",
        status: dashboardData.attendanceMarkedToday ? "Done" : "Pending",
        detail: dashboardData.attendanceMarkedToday
          ? `${dashboardData.todayPresent}/${Math.max(dashboardData.eligibleStudents, 1)} tracked students logged.`
          : attendanceSummaryLabel,
        tone: dashboardData.attendanceMarkedToday ? "success" : "danger",
        actionLabel: dashboardData.attendanceMarkedToday ? "Review" : "Mark Now",
        onClick: () => navigate("/dashboard/attendance"),
      },
      {
        id: "risk",
        step: "Contact high-risk students",
        status: dashboardData.riskStudents.length > 0 ? `${dashboardData.riskStudents.length} pending` : "Done",
        detail:
          dashboardData.riskStudents.length > 0
            ? `${formatInr(dashboardData.riskRevenueAtRisk)} can still be protected if you act now.`
            : "No active churn-risk queue right now.",
        tone: dashboardData.riskStudents.length > 0 ? "danger" : "success",
        actionLabel: dashboardData.riskStudents.length > 0 ? "Open Risk List" : "View Students",
        onClick: dashboardData.riskStudents.length > 0 ? () => scrollToSection(riskSectionRef) : () => navigate("/dashboard/students"),
      },
      {
        id: "fees",
        step: "Collect pending fees",
        status: dashboardData.pendingPaymentsCount > 0 ? `${dashboardData.pendingPaymentsCount} pending` : "Done",
        detail:
          dashboardData.pendingPaymentsCount > 0
            ? `${formatInr(dashboardData.pendingPaymentsAmount)} is waiting in unpaid fees.`
            : "No pending fee pressure at the moment.",
        tone: dashboardData.pendingPaymentsCount > 0 ? "warning" : "success",
        actionLabel: dashboardData.pendingPaymentsCount > 0 ? "Open Payments" : "Review Revenue",
        onClick: () => navigate(dashboardData.pendingPaymentsCount > 0 ? "/dashboard/payments" : "/dashboard"),
      },
    ],
    [
      attendanceSummaryLabel,
      dashboardData.attendanceMarkedToday,
      dashboardData.eligibleStudents,
      dashboardData.pendingPaymentsAmount,
      dashboardData.pendingPaymentsCount,
      dashboardData.riskRevenueAtRisk,
      dashboardData.riskStudents.length,
      dashboardData.todayPresent,
      navigate,
    ],
  );

  const seatMonetizationBlocks = useMemo(() => {
    const atRiskSeats = Math.min(dashboardData.riskStudents.length, dashboardData.occupiedSeats);
    const paidSeats = Math.max(dashboardData.occupiedSeats - atRiskSeats, 0);
    const valuePerSeat = Math.max(Math.round(dashboardData.averageStudentValue), 0);

    return Array.from({ length: dashboardData.totalSeats }, (_, index) => {
      if (index < emptySeats) {
        return {
          seatLabel: `S${String(index + 1).padStart(2, "0")}`,
          value: valuePerSeat,
          tone: "empty" as const,
        };
      }

      if (index < emptySeats + atRiskSeats) {
        return {
          seatLabel: `S${String(index + 1).padStart(2, "0")}`,
          value: valuePerSeat,
          tone: "risk" as const,
        };
      }

      if (index < emptySeats + atRiskSeats + paidSeats) {
        return {
          seatLabel: `S${String(index + 1).padStart(2, "0")}`,
          value: valuePerSeat,
          tone: "paid" as const,
        };
      }

      return {
        seatLabel: `S${String(index + 1).padStart(2, "0")}`,
        value: valuePerSeat,
        tone: "empty" as const,
      };
    });
  }, [dashboardData.averageStudentValue, dashboardData.occupiedSeats, dashboardData.riskStudents.length, dashboardData.totalSeats, emptySeats]);

  const todayTasks = useMemo<TodayTask[]>(() => {
    const tasks: TodayTask[] = [];

    if (dashboardData.eligibleStudents > 0) {
      tasks.push({
        id: "attendance",
        title: dashboardData.attendanceMarkedToday ? "Attendance completed" : "Attendance not marked",
        detail: dashboardData.attendanceMarkedToday
          ? `${dashboardData.todayPresent}/${dashboardData.eligibleStudents} tracked students have attendance today.`
          : `Attendance is still pending for ${dashboardData.eligibleStudents} tracked students.`,
        urgencyLabel: dashboardData.attendanceMarkedToday ? "Completed" : attendanceCountdownLabel,
        actionLabel: dashboardData.attendanceMarkedToday ? "View Attendance" : "Mark Now",
        tone: dashboardData.attendanceMarkedToday ? "success" : "danger",
        onClick: () => navigate("/dashboard/attendance"),
        autoCompleted: dashboardData.attendanceMarkedToday,
      });
    }

    if (dashboardData.riskStudents.length > 0) {
      tasks.push({
        id: "risk-follow-up",
        title: "Follow up students who may leave",
        detail: `${dashboardData.riskStudents.length} students may churn. ${formatInr(
          dashboardData.riskRevenueAtRisk,
        )} potential loss needs action.`,
        urgencyLabel:
          dashboardData.urgentRiskStudents.length > 0
            ? `${dashboardData.urgentRiskStudents.length} urgent`
            : "Follow up today",
        actionLabel: "Open Risk List",
        tone: "danger",
        onClick: () => scrollToSection(riskSectionRef),
        canMarkDone: true,
      });
    }

    if (dashboardData.pendingPaymentsCount > 0) {
      tasks.push({
        id: "fee-follow-up",
        title: "Review pending fees",
        detail: `${dashboardData.pendingPaymentsCount} fee entries are pending. ${formatInr(
          dashboardData.pendingPaymentsAmount,
        )} is waiting to be recovered.`,
        urgencyLabel: getOverdueLabel(dashboardData.oldestPendingPaymentAgeDays),
        actionLabel: "Open Payments",
        tone: dashboardData.oldestPendingPaymentAgeDays && dashboardData.oldestPendingPaymentAgeDays >= 3 ? "danger" : "warning",
        onClick: () => navigate("/dashboard/payments"),
        canMarkDone: true,
      });
    }

    if (dashboardData.expiringSoon > 0) {
      tasks.push({
        id: "renewal-follow-up",
        title: "Renew expiring students",
        detail: `${dashboardData.expiringSoon} students are expiring in the next 7 days.`,
        urgencyLabel: "Due this week",
        actionLabel: "Open Renewals",
        tone: "warning",
        onClick: () => navigate("/dashboard/renewals"),
        canMarkDone: true,
      });
    }

    if (dashboardData.todayAbsent > 0) {
      tasks.push({
        id: "absence-reminders",
        title: "Send absence reminders",
        detail: `${dashboardData.todayAbsent} students are absent today. Follow up before the day ends.`,
        urgencyLabel: attendanceCountdownLabel,
        actionLabel: "Send Reminder",
        tone: dashboardData.riskStudents.length > 0 ? "danger" : "info",
        onClick: handleQuickWhatsApp,
        canMarkDone: true,
      });
    }

    if (tasks.length === 0) {
      tasks.push({
        id: "healthy-day",
        title: "All tasks completed",
        detail: "No urgent attendance, fee, or churn actions need attention right now.",
        urgencyLabel: "Healthy day",
        actionLabel: "View Dashboard",
        tone: "success",
        onClick: () => scrollToSection(absentSectionRef),
        autoCompleted: true,
      });
    }

    return tasks.slice(0, 5);
  }, [
    attendanceCountdownLabel,
    dashboardData.attendanceMarkedToday,
    dashboardData.eligibleStudents,
    dashboardData.expiringSoon,
    dashboardData.oldestPendingPaymentAgeDays,
    dashboardData.pendingPaymentsAmount,
    dashboardData.pendingPaymentsCount,
    dashboardData.riskRevenueAtRisk,
    dashboardData.riskStudents.length,
    dashboardData.todayAbsent,
    dashboardData.todayPresent,
    dashboardData.urgentRiskStudents.length,
    handleQuickWhatsApp,
    navigate,
  ]);

  const manualTaskIds = useMemo(
    () => todayTasks.filter((task) => task.canMarkDone).map((task) => task.id),
    [todayTasks],
  );

  useEffect(() => {
    setDashboardDayState((current) => {
      const nextCompleted = current.completedTaskIds.filter((taskId) => manualTaskIds.includes(taskId));
      if (nextCompleted.length === current.completedTaskIds.length) {
        return current;
      }

      return {
        ...current,
        completedTaskIds: nextCompleted,
      };
    });
  }, [manualTaskIds]);

  const completedTaskIdSet = useMemo(
    () => new Set(dashboardDayState.completedTaskIds),
    [dashboardDayState.completedTaskIds],
  );

  const tasksWithState = useMemo(
    () =>
      todayTasks.map((task) => ({
        ...task,
        isCompleted: task.autoCompleted === true || completedTaskIdSet.has(task.id),
      })),
    [completedTaskIdSet, todayTasks],
  );

  const pendingTasksCount = tasksWithState.filter((task) => !task.isCompleted).length;

  const handleTaskCheckedChange = (taskId: string, nextValue: boolean) => {
    setDashboardDayState((current) => {
      const nextIds = nextValue
        ? Array.from(new Set([...current.completedTaskIds, taskId]))
        : current.completedTaskIds.filter((id) => id !== taskId);

      return {
        ...current,
        completedTaskIds: nextIds,
      };
    });
  };

  const handleAttendanceSkip = () => {
    setDashboardDayState((current) => ({
      ...current,
      attendanceSkipUsed: true,
    }));
    setAttendanceAlertCollapsed(true);
    toast({
      title: "Attendance reminder minimized",
      description: "Reminder compact mode me rahega, but aaj ke liye hide nahi hoga.",
    });
  };

  const riskStatus = useMemo(() => {
    if (dashboardData.urgentRiskStudents.length > 0) {
      return { icon: "🔴", label: "High", className: "text-destructive" };
    }

    if (dashboardData.riskStudents.length > 0 || dashboardData.todayAbsent > 0) {
      return { icon: "⚠️", label: "Medium", className: "text-warning" };
    }

    return { icon: "🟢", label: "Low", className: "text-success" };
  }, [dashboardData.riskStudents.length, dashboardData.todayAbsent, dashboardData.urgentRiskStudents.length]);

  const revenueStatus = useMemo(() => {
    if (dashboardData.totalRevenueAtRisk > 0 || dashboardData.revenueMTD < dashboardData.previousRevenueMTD) {
      return { icon: "⚠️", label: "At Risk", className: "text-warning" };
    }

    return { icon: "✅", label: "Good", className: "text-success" };
  }, [dashboardData.previousRevenueMTD, dashboardData.revenueMTD, dashboardData.totalRevenueAtRisk]);

  const getActivityIcon = (type: ActivityType) => {
    if (type === "success") return <CheckCircle className="h-3.5 w-3.5 text-success" />;
    if (type === "warning") return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
    return <Info className="h-3.5 w-3.5 text-info" />;
  };

  const getActivityBg = (type: ActivityType) => {
    if (type === "success") return "bg-success/10";
    if (type === "warning") return "bg-warning/10";
    return "bg-info/10";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {showAttendanceGate ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm">
            <Card className="w-full max-w-xl border-destructive/30 bg-card shadow-2xl">
              <CardHeader className="space-y-4">
                <Badge variant="outline" className="w-fit border-destructive/20 bg-destructive/10 text-destructive">
                  Dashboard Locked
                </Badge>
                <div className="space-y-2">
                  <CardTitle className="text-2xl font-display">Please complete attendance to continue</CardTitle>
                  <CardDescription className="text-base">
                    Attendance was not marked for the last {dashboardData.missedAttendanceCompletedDays} completed days. Mark
                    today&apos;s attendance to unlock the dashboard.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row">
                <Button asChild className="sm:flex-1">
                  <Link to="/dashboard/attendance">Mark Attendance</Link>
                </Button>
                <Button variant="outline" className="sm:flex-1" onClick={() => refetchDashboard()}>
                  I already completed it
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {!resolvedLibraryId && !loading ? (
          <Card>
            <CardContent className="py-10 text-center text-destructive">
              Library not linked to your account. Please check user role setup.
            </CardContent>
          </Card>
        ) : dashboardError ? (
          <Card>
            <CardContent className="py-10 text-center text-destructive">
              Unable to load dashboard: {getErrorMessage(dashboardQueryError)}
            </CardContent>
          </Card>
        ) : loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Card key={index}>
                <CardContent className="h-36 animate-pulse rounded-lg bg-muted/30" />
              </Card>
            ))}
          </div>
        ) : (
          <>
            {dashboardData.eligibleStudents > 0 && !dashboardData.attendanceMarkedToday ? (
              <div className="relative z-10">
                <Alert
                  className={cn(
                    "border-destructive/20 bg-gradient-to-r from-destructive/10 via-card to-card shadow-lg",
                    attendanceAlertCollapsed ? "py-3" : "py-4",
                  )}
                >
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                      <AlertTitle className="text-base font-display text-foreground">
                        {attendanceAlertCollapsed
                          ? "Attendance reminder minimized"
                          : "Attendance not marked today (Required)"}
                      </AlertTitle>
                      <AlertDescription className="text-sm text-muted-foreground">
                        {attendanceAlertCollapsed
                          ? `Reminder stays visible until attendance is completed. ${attendanceCountdownLabel}.`
                          : `You still need to open attendance for ${dashboardData.eligibleStudents} tracked students. ${attendanceCountdownLabel}.`}
                      </AlertDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive">
                        {attendanceCountdownLabel}
                      </Badge>
                      <Button asChild size="sm">
                        <Link to="/dashboard/attendance">Mark Now</Link>
                      </Button>
                      {!dashboardDayState.attendanceSkipUsed && !attendanceAlertCollapsed ? (
                        <Button size="sm" variant="outline" onClick={handleAttendanceSkip}>
                          Skip
                        </Button>
                      ) : null}
                      {attendanceAlertCollapsed ? (
                        <Button size="sm" variant="ghost" onClick={() => setAttendanceAlertCollapsed(false)}>
                          Expand
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Alert>
              </div>
            ) : null}

            <RevenueControlDashboard
              currentDateLabel={format(currentTime, "EEEE, dd MMM yyyy")}
              recoveryWindowLabel={recoveryWindowLabel}
              totalRevenueAtRisk={dashboardData.totalRevenueAtRisk}
              pendingPaymentsAmount={dashboardData.pendingPaymentsAmount}
              riskRevenueAtRisk={dashboardData.riskRevenueAtRisk}
              highRiskStudentsCount={highRiskStudentsCount}
              totalRiskStudents={dashboardData.riskStudents.length}
              emptySeats={emptySeats}
              emptySeatRevenueLoss={emptySeatRevenueLoss}
              revenueMTD={dashboardData.revenueMTD}
              revenueChangeText={revenueChange.text}
              occupancyRate={occupancyRate}
              occupiedSeats={dashboardData.occupiedSeats}
              totalSeats={dashboardData.totalSeats}
              churnRate={churnRate}
              revenuePerSeat={revenuePerSeat}
              pendingTasksCount={pendingTasksCount}
              recoveredToday={dashboardData.recoveredToday}
              paymentsReceivedToday={dashboardData.paymentsReceivedToday}
              studentsConvertedToday={dashboardData.studentsConvertedToday}
              smartSuggestions={smartSuggestions}
              moneyPriorityItems={moneyPriorityItems}
              visibleMoneyPriorityItems={visibleMoneyPriorityItems}
              moneyPriorityCount={moneyPriorityItems.length}
              showAllUrgentRisk={showAllUrgentRisk}
              onToggleShowAllUrgentRisk={() => setShowAllUrgentRisk((value) => !value)}
              onRecoverNow={handleRecoverNow}
              onCallHighRiskStudents={handleCallHighRiskStudents}
              onQuickWhatsApp={handleQuickWhatsApp}
              onCallItem={(item) => openPhoneCall(item.phone, item.name)}
              onWhatsAppItem={openPriorityWhatsApp}
              onMarkPaid={handleMarkAsPaid}
              onRemoveSeat={handleRemoveSeat}
              dailyActionFlow={dailyActionFlow}
              seatMonetizationBlocks={seatMonetizationBlocks}
              moneyPriorityRef={riskSectionRef}
              seatViewRef={absentSectionRef}
            />

            <div className="grid gap-4 md:grid-cols-3">
              <Card className="border-sky-200/70 bg-[linear-gradient(135deg,rgba(239,246,255,0.92),rgba(255,255,255,0.98))] shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">AI Recovery Calls</p>
                      <p className="mt-3 text-3xl font-display font-bold text-slate-950">{dashboardData.automatedCallsMade}</p>
                      <p className="mt-2 text-sm text-slate-600">Automated payment recovery calls triggered this month.</p>
                    </div>
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100">
                      <Bot className="h-5 w-5 text-sky-700" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-emerald-200/70 bg-[linear-gradient(135deg,rgba(236,253,245,0.94),rgba(255,255,255,0.98))] shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Picked Vs Missed</p>
                      <p className="mt-3 text-3xl font-display font-bold text-slate-950">
                        {dashboardData.automatedCallsPicked} / {dashboardData.automatedCallsMissed}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">Live answer rate from the automated calling queue this month.</p>
                    </div>
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100">
                      <Phone className="h-5 w-5 text-emerald-700" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.94),rgba(255,255,255,0.98))] shadow-sm">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Estimated Recovery Impact</p>
                      <p className="mt-3 text-3xl font-display font-bold text-slate-950">{formatInr(dashboardData.automatedRecoveryImpact)}</p>
                      <p className="mt-2 text-sm text-slate-600">Pending dues targeted by AI calls in the current month.</p>
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0">
                      <Link to="/dashboard/payments">
                        Open Payments <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {false ? (
              <>
                <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
              <Card
                ref={riskSectionRef}
                className={cn(
                  "overflow-hidden border-2 shadow-lg",
                  dashboardData.riskStudents.length > 0
                    ? "border-destructive/25 bg-gradient-to-br from-destructive/10 via-card to-card"
                    : "border-success/25 bg-gradient-to-br from-success/10 via-card to-card",
                )}
              >
                <CardHeader className="pb-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "w-fit",
                          dashboardData.riskStudents.length > 0
                            ? "border-destructive/20 bg-destructive/10 text-destructive"
                            : "border-success/20 bg-success/10 text-success",
                        )}
                      >
                        {dashboardData.urgentRiskStudents.length > 0
                          ? "High urgency"
                          : dashboardData.riskStudents.length > 0
                            ? "Action needed"
                            : "Under control"}
                      </Badge>
                      <div>
                        <CardTitle className="text-2xl font-display">
                          {dashboardData.riskStudents.length > 0
                            ? `${dashboardData.riskStudents.length} students may leave (${formatInr(
                                dashboardData.riskRevenueAtRisk,
                              )} potential loss)`
                            : "No students are at immediate drop-off risk"}
                        </CardTitle>
                        <CardDescription className="mt-2 max-w-2xl text-sm">
                          {dashboardData.riskStudents.length > 0
                            ? `${dashboardData.urgentRiskStudents.length} students have crossed the urgent threshold. Follow up before they churn.`
                            : "Attendance risk is stable right now. Keep momentum going with today’s task flow."}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 sm:flex">
                      <AlertTriangle className="h-6 w-6 text-destructive" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dashboardData.riskStudents.length > 0 ? (
                    <>
                      {visibleRiskStudents.map((student) => (
                        <div key={student.id} className="rounded-2xl border border-destructive/15 bg-background/80 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-base font-semibold text-foreground">{student.name}</p>
                                {student.seatNumber ? (
                                  <Badge variant="outline" className="border-border/70 bg-muted/30 text-foreground">
                                    Seat {student.seatNumber}
                                  </Badge>
                                ) : null}
                                <Badge variant="outline" className={getRiskBadgeClassName(student.riskLevel)}>
                                  {getRiskLabel(student.riskLevel)}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                                <span>{student.absentDays} days absent</span>
                                <span>{getLastSeenLabel(student.lastAttendedDate)}</span>
                                <span>{formatInr(student.estimatedMonthlyValue)} at risk</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={() => copyReminder(student)}>
                                Copy
                              </Button>
                              <Button size="sm" onClick={() => sendReminder(student)}>
                                Remind
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={handleQuickWhatsApp}>
                          <MessageCircle className="h-4 w-4" />
                          Send next reminder
                        </Button>
                        {dashboardData.riskStudents.length > 4 ? (
                          <Button size="sm" variant="outline" onClick={() => setShowAllUrgentRisk((value) => !value)}>
                            {showAllUrgentRisk ? "Show fewer" : "Show all"}
                          </Button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-success/20 bg-success/5 p-4 text-sm text-muted-foreground">
                      No one has crossed the churn-risk threshold today. Keep attendance and reminders consistent to hold this
                      position.
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Collapsible open={tasksOpen} onOpenChange={setTasksOpen}>
                  <Card className="border-border/70 bg-card/95">
                    <CardHeader className="pb-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-3">
                          <Badge
                            variant="outline"
                            className={cn(
                              "w-fit",
                              pendingTasksCount > 0
                                ? "border-warning/20 bg-warning/10 text-warning"
                                : "border-success/20 bg-success/10 text-success",
                            )}
                          >
                            {pendingTasksCount > 0 ? `${pendingTasksCount} pending` : "All done"}
                          </Badge>
                          <div>
                            <CardTitle className="text-xl font-display">
                              {pendingTasksCount > 0 ? `Today's Tasks: ${pendingTasksCount} pending` : "All tasks completed"}
                            </CardTitle>
                            <CardDescription className="mt-2 text-sm">
                              {pendingTasksCount > 0
                                ? "Critical tasks stay visible until you act on them."
                                : "Everything important for today is already handled."}
                            </CardDescription>
                          </div>
                        </div>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm">
                            {tasksOpen ? "Hide" : "Open"}
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </CardHeader>
                    <CollapsibleContent>
                      <CardContent className="space-y-3">
                        {tasksWithState.map((task) => (
                          <div
                            key={task.id}
                            className={cn(
                              "rounded-2xl border p-4 transition-colors",
                              task.isCompleted ? "border-success/20 bg-success/5" : "border-border/70 bg-muted/20",
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <div className="pt-0.5">
                                {task.canMarkDone ? (
                                  <Checkbox
                                    checked={task.isCompleted}
                                    onCheckedChange={(value) => handleTaskCheckedChange(task.id, value === true)}
                                    aria-label={`${task.title} completed`}
                                  />
                                ) : task.isCompleted ? (
                                  <CheckCircle className="h-4 w-4 text-success" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-semibold text-foreground">{task.title}</p>
                                  <Badge variant="outline" className={getToneBadgeClassName(task.tone)}>
                                    {task.isCompleted ? "Done" : task.urgencyLabel}
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">{task.detail}</p>
                                <Button
                                  size="sm"
                                  variant={task.tone === "danger" && !task.isCompleted ? "default" : "outline"}
                                  onClick={task.onClick}
                                >
                                  {task.actionLabel}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

                <Card className="border-border/70">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-display">Quick Actions</CardTitle>
                    <CardDescription>Fast shortcuts for the actions that move the day forward.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3">
                    <Button asChild className="justify-start">
                      <Link to="/dashboard/attendance">
                        <ScanLine className="h-4 w-4" />
                        Mark Attendance
                      </Link>
                    </Button>
                    <Button variant="outline" className="justify-start" onClick={handleQuickWhatsApp}>
                      <MessageCircle className="h-4 w-4" />
                      WhatsApp Reminder
                    </Button>
                    <Button variant="outline" className="justify-start" onClick={handleQuickReminder}>
                      <ArrowRight className="h-4 w-4" />
                      Copy Reminder
                    </Button>
                    <Button asChild variant="outline" className="justify-start">
                      <Link to="/dashboard/students">
                        <Plus className="h-4 w-4" />
                        Add Student
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Card className="border-border/70">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-display">Daily Activity Panel</CardTitle>
                <CardDescription>Turn dashboard metrics into action instead of passive reporting.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <InsightMetricCard
                    title="Attendance Today"
                    value={
                      dashboardData.attendanceMarkedToday
                        ? `${dashboardData.todayPresent}/${Math.max(dashboardData.eligibleStudents, 1)}`
                        : "Pending"
                    }
                    subtitle={attendanceSummaryLabel}
                    tone={dashboardData.attendanceMarkedToday ? "success" : "danger"}
                    icon={ScanLine}
                    actionLabel={dashboardData.attendanceMarkedToday ? "Review" : "Mark now"}
                    actionTo="/dashboard/attendance"
                  />
                  <InsightMetricCard
                    title="Students May Leave"
                    value={String(dashboardData.riskStudents.length)}
                    subtitle={
                      dashboardData.riskStudents.length > 0
                        ? `${formatInr(dashboardData.riskRevenueAtRisk)} potential loss from attendance risk`
                        : "No churn alert triggered today"
                    }
                    tone={dashboardData.riskStudents.length > 0 ? "danger" : "success"}
                    icon={UserRoundX}
                    actionLabel="Open Students"
                    actionTo="/dashboard/students"
                  />
                  <InsightMetricCard
                    title="Fee Pending"
                    value={String(dashboardData.pendingPaymentsCount)}
                    subtitle={
                      dashboardData.pendingPaymentsCount > 0
                        ? `${formatInr(dashboardData.pendingPaymentsAmount)} pending, ${getOverdueLabel(
                            dashboardData.oldestPendingPaymentAgeDays,
                          )}`
                        : "No overdue payment pressure"
                    }
                    tone={dashboardData.pendingPaymentsCount > 0 ? "warning" : "success"}
                    icon={AlertTriangle}
                    actionLabel="Review Fees"
                    actionTo="/dashboard/payments"
                  />
                  <InsightMetricCard
                    title="Renewals Due"
                    value={String(dashboardData.expiringSoon)}
                    subtitle={
                      dashboardData.expiringSoon > 0
                        ? "Students expiring within the next 7 days"
                        : "No urgent renewal follow-ups this week"
                    }
                    tone={dashboardData.expiringSoon > 0 ? "warning" : "info"}
                    icon={CalendarClock}
                    actionLabel="Open Renewals"
                    actionTo="/dashboard/renewals"
                  />
                  <InsightMetricCard
                    title="Active Streaks"
                    value={String(dashboardData.activeStreakStudents)}
                    subtitle={
                      dashboardData.topStreakStudent
                        ? `${dashboardData.topStreakStudent.name} leads with ${dashboardData.topStreakStudent.streakDays} days`
                        : "No streak leader yet"
                    }
                    tone={dashboardData.activeStreakStudents > 0 ? "info" : "neutral"}
                    icon={Flame}
                    actionLabel="View Attendance"
                    actionTo="/dashboard/attendance"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="dashboard-secondary-sections space-y-6">
              <div className="grid gap-6 xl:grid-cols-3">
                <Card ref={absentSectionRef} className="border-border/70">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-display">Absent Today</CardTitle>
                    <CardDescription>Students who still need follow-up before the day closes.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {dashboardData.absentTodayStudents.length > 0 ? (
                      dashboardData.absentTodayStudents.slice(0, 5).map((student) => (
                        <div key={student.id} className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                          <div className="flex flex-col gap-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-semibold text-foreground">{student.name}</p>
                                <p className="text-sm text-muted-foreground">
                                  {student.seatNumber ? `Seat ${student.seatNumber}` : "Seat not assigned"}
                                </p>
                              </div>
                              <Badge variant="outline" className={getRiskBadgeClassName(student.riskLevel)}>
                                {student.absentDays} days missed
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{getLastSeenLabel(student.lastAttendedDate)}</p>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={() => copyReminder(student)}>
                                Copy
                              </Button>
                              <Button size="sm" onClick={() => sendReminder(student)}>
                                Remind
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-success/20 bg-success/5 p-4 text-sm text-muted-foreground">
                        Everyone tracked for attendance has activity today.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70 bg-gradient-to-br from-amber-50 via-card to-card">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-display">Streak Leaderboard</CardTitle>
                    <CardDescription>Reward consistency so daily attendance becomes habit-forming.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {dashboardData.streakLeaderboard.length > 0 ? (
                      dashboardData.streakLeaderboard.map((student, index) => (
                        <div key={student.id} className="flex items-center justify-between rounded-2xl border border-amber-200/60 bg-white/70 p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-700">
                              #{index + 1}
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{student.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {student.seatNumber ? `Seat ${student.seatNumber}` : "No seat assigned"}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-amber-700">{student.streakDays}</p>
                            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Day streak</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                        Start marking attendance regularly to unlock streaks and leaderboards.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/70">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg font-display">Fee Pressure</CardTitle>
                        <CardDescription>Use overdue age to create urgency around collections.</CardDescription>
                      </div>
                      <Badge variant="outline" className={getToneBadgeClassName(dashboardData.pendingPaymentsCount > 0 ? "warning" : "success")}>
                        {getOverdueLabel(dashboardData.oldestPendingPaymentAgeDays)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {dashboardData.pendingPaymentsRecent.length > 0 ? (
                      <>
                        {dashboardData.pendingPaymentsRecent.map((payment) => (
                          <div key={payment.id} className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold text-foreground">{payment.studentName}</p>
                                <p className="text-sm text-muted-foreground">
                                  {getOverdueLabel(
                                    differenceInCalendarDays(currentTime, startOfDay(new Date(payment.createdAt))),
                                  )}
                                </p>
                              </div>
                              <p className="text-base font-semibold text-foreground">{formatInr(payment.amount)}</p>
                            </div>
                          </div>
                        ))}
                        <Button asChild variant="outline" className="w-full">
                          <Link to="/dashboard/payments">Open Payments</Link>
                        </Button>
                      </>
                    ) : (
                      <div className="rounded-2xl border border-success/20 bg-success/5 p-4 text-sm text-muted-foreground">
                        No fee collection pressure right now.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="dashboard-revenue-sections space-y-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold font-display text-foreground">Revenue Pressure</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Show revenue in a risk-first format so delays feel actionable, not abstract.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <RevenueSummaryCard
                      title="Collected This Month"
                      value={formatInr(dashboardData.revenueMTD)}
                      detail={revenueChange.text}
                      tone={dashboardData.revenueMTD > 0 ? "success" : "neutral"}
                    />
                    <RevenueSummaryCard
                      title="Revenue At Risk"
                      value={formatInr(dashboardData.totalRevenueAtRisk)}
                      detail={`${formatInr(dashboardData.pendingPaymentsAmount)} pending fees + attendance risk`}
                      tone={dashboardData.totalRevenueAtRisk > 0 ? "danger" : "success"}
                    />
                    <RevenueSummaryCard
                      title="Potential Loss"
                      value={formatInr(dashboardData.riskRevenueAtRisk)}
                      detail={`${dashboardData.riskStudents.length} students may leave if follow-up slips`}
                      tone={dashboardData.riskRevenueAtRisk > 0 ? "danger" : "neutral"}
                    />
                    <RevenueSummaryCard
                      title="Pending Fees"
                      value={formatInr(dashboardData.pendingPaymentsAmount)}
                      detail={dashboardData.pendingPaymentsCount > 0 ? `${dashboardData.pendingPaymentsCount} unpaid entries` : "No pending dues"}
                      tone={dashboardData.pendingPaymentsCount > 0 ? "info" : "neutral"}
                    />
                  </div>

                  <Alert className="border-info/20 bg-info/5">
                    <Info className="h-4 w-4 text-info" />
                    <AlertTitle>Revenue focus for today</AlertTitle>
                    <AlertDescription className="space-y-1">
                      <p>{revenueInsight.earnedText}</p>
                      <p>{revenueInsight.riskText}</p>
                      <p>{revenueInsight.growthText}</p>
                      <p>{revenueInsight.peakText}</p>
                    </AlertDescription>
                  </Alert>

                  {dashboardData.pendingPaymentsCount > 0 ? (
                    <Alert className="border-warning/20 bg-warning/5">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <AlertTitle>{formatInr(dashboardData.pendingPaymentsAmount)} fee recovery needs action</AlertTitle>
                      <AlertDescription>
                        {dashboardData.pendingPaymentsCount} payments are pending. The oldest item is {getOverdueLabel(
                          dashboardData.oldestPendingPaymentAgeDays,
                        )}
                        .
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
                    <RevenueChart
                      data={dashboardData.revenueTrend}
                      dailyData={dashboardData.dailyRevenueTrend}
                      title="Revenue Momentum"
                      subtitle="Daily collections compared against the same period last month."
                    />

                    <div className="space-y-6">
                      <Card className="border-border/70">
                        <CardHeader className="pb-4">
                          <CardTitle className="text-lg font-display">Top Payers</CardTitle>
                          <CardDescription>{dashboardData.topPayersRangeLabel}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {dashboardData.topPayingStudents.length > 0 ? (
                            dashboardData.topPayingStudents.map((student) => (
                              <div key={student.id} className="flex items-center justify-between rounded-2xl border border-border/70 bg-muted/20 p-4">
                                <div>
                                  <p className="font-semibold text-foreground">{student.name}</p>
                                  <p className="text-sm text-muted-foreground">{student.paymentCount} successful payments</p>
                                </div>
                                <p className="font-semibold text-foreground">{formatInr(student.totalAmount)}</p>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                              No approved payments yet for this month.
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      <Card className="border-border/70">
                        <CardHeader className="pb-4">
                          <CardTitle className="text-lg font-display">Recent Activity</CardTitle>
                          <CardDescription>Latest signals across admissions, payments, and attendance.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {dashboardData.recentActivity.length > 0 ? (
                            dashboardData.recentActivity.map((item) => (
                              <div key={item.id} className="flex items-start gap-3">
                                <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", getActivityBg(item.type))}>
                                  {getActivityIcon(item.type)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-foreground">{item.action}</p>
                                  <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                                </div>
                                <span className="whitespace-nowrap text-xs text-muted-foreground">
                                  {formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                              Activity will appear here as attendance, payments, and notifications start flowing in.
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </div>

                <div className="dashboard-ops-sections space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold font-display text-foreground">Operations Snapshot</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Support metrics that still help the day-to-day control loop.
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatsCard
                      icon={LayoutGrid}
                      title="Total Seats"
                      value={String(dashboardData.totalSeats)}
                      change={`${dashboardData.occupiedSeats} occupied now`}
                      trend="up"
                    />
                    <StatsCard
                      icon={Users}
                      title="Active Students"
                      value={String(dashboardData.activeStudents)}
                      change={`${dashboardData.newAdmissionsThisMonth} added this month`}
                      trend="up"
                      iconColor="text-info"
                    />
                    <StatsCard
                      icon={CalendarClock}
                      title="Expiring Soon"
                      value={String(dashboardData.expiringSoon)}
                      change="Next 7 days"
                      trend={dashboardData.expiringSoon > 0 ? "down" : "up"}
                      iconColor="text-warning"
                    />
                    <StatsCard
                      icon={Archive}
                      title="Lockers"
                      value={String(dashboardData.totalLockers)}
                      change={`${dashboardData.availableLockers} available now`}
                      trend="up"
                      iconColor="text-primary"
                    />
                  </div>
                </div>
              </div>
            </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
