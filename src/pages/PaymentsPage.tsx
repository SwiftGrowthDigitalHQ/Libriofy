import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  format,
  max as maxDate,
  min as minDate,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import {
  Bot,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  ImageIcon,
  LineChart,
  MessageCircle,
  Phone,
  Plus,
  Receipt,
  Target,
  TimerReset,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import FinanceTrendChart, { type FinanceTrendPoint } from "@/components/payments/FinanceTrendChart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { getEdgeFunctionAuthHeaders, readFunctionErrorMessage } from "@/lib/billingEdgeFunctions";
import { exportToCsv } from "@/lib/exportCsv";
import {
  buildPaymentInsights,
  comparePaymentSummaryRisk,
  createPlanPriceLookup,
  derivePaymentSummary,
  formatInr,
  getDefaultPaymentDueDate,
  getPaymentStatusLabel,
  groupPaymentsByStudent,
} from "@/lib/paymentRecovery";
import { isPendingPaymentStatus, isSuccessfulPaymentStatus, PAYMENT_SCREENSHOT_BUCKET } from "@/lib/payments";
import { isMissingRelationError } from "@/lib/studentSlotUtils";
import { cn } from "@/lib/utils";

type LibraryFinanceRow = Pick<Database["public"]["Tables"]["libraries"]["Row"], "id" | "name" | "total_seats" | "upi_id">;
type PlanFinanceRow = Pick<Database["public"]["Tables"]["plans"]["Row"], "id" | "is_active" | "name" | "price">;
type StudentFinanceRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "expiry_date" | "full_name" | "id" | "phone" | "plan" | "plan_id" | "seat_id" | "seat_number" | "slot" | "start_date" | "status"
>;
type PaymentLedgerRow = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  "amount" | "created_at" | "id" | "payment_method" | "payment_screenshot" | "period_end" | "period_start" | "plan" | "seat_id" | "source" | "status" | "student_id"
> & {
  students: Pick<Database["public"]["Tables"]["students"]["Row"], "full_name" | "id" | "phone" | "seat_number"> | null;
};
type ExpenseRow = Pick<
  Database["public"]["Tables"]["expenses"]["Row"],
  "amount" | "category" | "created_at" | "date" | "id" | "notes"
>;

type PaymentRow = {
  amount: number;
  created_at: string;
  id: string;
  payment_method: string | null;
  payment_screenshot: string | null;
  period_end: string | null;
  period_start: string | null;
  plan: string | null;
  seat_id: string | null;
  source: string;
  status: string;
  student_id: string;
  student_name: string;
  student_phone: string | null;
  student_seat_number: string | null;
};

type AutomatedCallLogRow = {
  call_status: string;
  called_phone: string | null;
  created_at: string;
  error_message: string | null;
  estimated_recovery_impact: number;
  id: string;
  ivr_action: string | null;
  ivr_choice: string | null;
  pending_amount_snapshot: number;
  pickup_status: string;
  provider_call_sid: string | null;
  student_id: string | null;
  student_name_snapshot: string;
  tts_provider: string;
};

type FinanceData = {
  allPayments: PaymentRow[];
  automatedCalls: AutomatedCallLogRow[];
  comparisonPayments: PaymentRow[];
  expenses: ExpenseRow[];
  library: LibraryFinanceRow | null;
  payments: PaymentRow[];
  pendingRenewals: PaymentRow[];
  plans: PlanFinanceRow[];
  students: StudentFinanceRow[];
};

type PeriodPreset = "this_month" | "last_month" | "last_3_months" | "custom";

type DateRangeValue = {
  end: Date;
  key: string;
  label: string;
  start: Date;
};

type FinanceListRow = {
  amount: number;
  category: string;
  date: Date;
  dateLabel: string;
  id: string;
  note: string;
  proofAvailable: boolean;
  status: string;
  title: string;
  type: "Expense" | "Revenue";
  payment?: PaymentRow;
};

type InsightTone = "danger" | "info" | "neutral" | "success" | "warning";
type RecoveryFilter = "all" | "overdue" | "partial" | "unpaid";

type StartRecoveryCallsResponse = {
  error?: string;
  estimatedRecoveryImpact?: number;
  failed?: Array<{ error: string; studentId: string; studentName: string }>;
  message?: string;
  queuedCalls?: number;
  skipped?: Array<{ reason: string; studentId: string; studentName: string }>;
  started?: Array<{
    amountDue: number;
    callId: string;
    callStatus: string;
    providerCallSid: string | null;
    studentId: string;
    studentName: string;
    ttsProvider: string;
  }>;
  targetedStudents?: number;
};

const expenseCategories = [
  { label: "Rent", value: "rent" },
  { label: "Electricity", value: "electricity" },
  { label: "Internet", value: "internet" },
  { label: "Salary", value: "salary" },
  { label: "Other", value: "other" },
] as const;

const initialPaymentForm = {
  amount: "",
  payment_method: "manual",
  plan: "",
  status: "completed",
  student_id: "",
};

const createInitialExpenseForm = () => ({
  amount: "",
  category: "rent",
  date: format(new Date(), "yyyy-MM-dd"),
  notes: "",
});

const getErrorMessage = (error: unknown): string => {
  if (!error || typeof error !== "object") return "Unknown error";
  return (error as { message?: string }).message || "Unknown error";
};

const getStatusBadge = (status: string) => {
  if (isSuccessfulPaymentStatus(status)) {
    return <Badge className="border-success/20 bg-success/10 text-success hover:bg-success/10">{status}</Badge>;
  }
  if (isPendingPaymentStatus(status)) {
    return <Badge variant="secondary">{status}</Badge>;
  }
  return <Badge variant="destructive">{status}</Badge>;
};

const getExpenseCategoryLabel = (category: string) =>
  expenseCategories.find((item) => item.value === category)?.label ?? "Other";

const normalizeText = (value: string | null | undefined) => (value || "").trim().toLowerCase().replace(/\s+/g, " ");
const hasCallablePhone = (value: string | null | undefined) => (value || "").replace(/\D/g, "").length >= 10;
const formatCallStatusLabel = (value: string | null | undefined) =>
  (value || "queued")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
const getCallStatusBadgeClassName = (value: string | null | undefined) => {
  const normalized = (value || "").toLowerCase();
  if (normalized === "completed" || normalized === "answered" || normalized === "in-progress") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (normalized === "queued" || normalized === "ringing" || normalized === "initiated") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (normalized === "busy" || normalized === "failed" || normalized === "canceled" || normalized === "no-answer") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
};

const parseDateOnly = (value: string) => new Date(`${value}T00:00:00`);

const isStudentActiveOn = (student: StudentFinanceRow, date: Date) => {
  if (student.status !== "active") return false;
  const start = startOfDay(parseDateOnly(student.start_date));
  if (start > date) return false;
  if (!student.expiry_date) return true;
  return parseDateOnly(student.expiry_date) >= date;
};

const getActiveOverlapDays = (student: StudentFinanceRow, rangeStart: Date, rangeEnd: Date) => {
  if (student.status !== "active") return 0;
  const start = startOfDay(parseDateOnly(student.start_date));
  const end = student.expiry_date ? endOfDay(parseDateOnly(student.expiry_date)) : rangeEnd;
  const overlapStart = maxDate([rangeStart, start]);
  const overlapEnd = minDate([rangeEnd, end]);
  if (overlapStart > overlapEnd) return 0;
  return differenceInCalendarDays(overlapEnd, overlapStart) + 1;
};

const getPresetRange = (
  preset: PeriodPreset,
  customStart: string,
  customEnd: string,
  today: Date,
): DateRangeValue => {
  if (preset === "last_month") {
    const lastMonthDate = subMonths(today, 1);
    const start = startOfMonth(lastMonthDate);
    const end = endOfMonth(lastMonthDate);
    return {
      end,
      key: `${format(start, "yyyy-MM-dd")}_${format(end, "yyyy-MM-dd")}`,
      label: `Last Month • ${format(start, "dd MMM")} - ${format(end, "dd MMM yyyy")}`,
      start,
    };
  }

  if (preset === "last_3_months") {
    const start = startOfMonth(subMonths(today, 2));
    const end = endOfDay(today);
    return {
      end,
      key: `${format(start, "yyyy-MM-dd")}_${format(end, "yyyy-MM-dd")}`,
      label: `Last 3 Months • ${format(start, "dd MMM")} - ${format(end, "dd MMM yyyy")}`,
      start,
    };
  }

  if (preset === "custom") {
    const rawStart = customStart ? startOfDay(parseDateOnly(customStart)) : startOfMonth(today);
    const rawEnd = customEnd ? endOfDay(parseDateOnly(customEnd)) : endOfDay(today);
    const start = rawStart <= rawEnd ? rawStart : rawEnd;
    const end = rawStart <= rawEnd ? rawEnd : endOfDay(rawStart);

    return {
      end,
      key: `${format(start, "yyyy-MM-dd")}_${format(end, "yyyy-MM-dd")}`,
      label: `Custom Range • ${format(start, "dd MMM")} - ${format(end, "dd MMM yyyy")}`,
      start,
    };
  }

  const start = startOfMonth(today);
  const end = endOfDay(today);
  return {
    end,
    key: `${format(start, "yyyy-MM-dd")}_${format(end, "yyyy-MM-dd")}`,
    label: `This Month • ${format(start, "dd MMM")} - ${format(end, "dd MMM yyyy")}`,
    start,
  };
};

const getComparisonRange = (range: DateRangeValue): DateRangeValue => {
  const totalDays = differenceInCalendarDays(range.end, range.start) + 1;
  const end = endOfDay(subDays(range.start, 1));
  const start = startOfDay(subDays(end, totalDays - 1));
  return {
    end,
    key: `${format(start, "yyyy-MM-dd")}_${format(end, "yyyy-MM-dd")}`,
    label: `${format(start, "dd MMM")} - ${format(end, "dd MMM yyyy")}`,
    start,
  };
};

const periodButtonCopy: Array<{ label: string; value: PeriodPreset }> = [
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
  { label: "Last 3 Months", value: "last_3_months" },
  { label: "Custom Date Range", value: "custom" },
];

const summaryToneClasses: Record<InsightTone, { card: string; iconBox: string; iconColor: string; valueColor: string }> = {
  danger: {
    card: "border-destructive/25 bg-gradient-to-br from-destructive/10 via-card to-card shadow-md shadow-destructive/10",
    iconBox: "bg-destructive/10",
    iconColor: "text-destructive",
    valueColor: "text-destructive",
  },
  info: {
    card: "border-info/25 bg-gradient-to-br from-info/10 via-card to-card shadow-md shadow-info/10",
    iconBox: "bg-info/10",
    iconColor: "text-info",
    valueColor: "text-foreground",
  },
  neutral: {
    card: "border-border/70 bg-card shadow-sm",
    iconBox: "bg-primary/10",
    iconColor: "text-primary",
    valueColor: "text-foreground",
  },
  success: {
    card: "border-success/25 bg-gradient-to-br from-success/10 via-card to-card shadow-md shadow-success/10",
    iconBox: "bg-success/10",
    iconColor: "text-success",
    valueColor: "text-success",
  },
  warning: {
    card: "border-amber-300/40 bg-gradient-to-br from-amber-50 via-card to-card shadow-md shadow-amber-100/70",
    iconBox: "bg-amber-100",
    iconColor: "text-amber-700",
    valueColor: "text-foreground",
  },
};

const FinanceSummaryCard = ({
  detail,
  icon: Icon,
  title,
  tone,
  value,
}: {
  detail: string;
  icon: typeof Wallet;
  title: string;
  tone: InsightTone;
  value: string;
}) => {
  const toneClasses = summaryToneClasses[tone];

  return (
    <Card className={toneClasses.card}>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
          <p className={cn("mt-3 text-3xl font-bold font-display", toneClasses.valueColor)}>{value}</p>
          <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        </div>
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", toneClasses.iconBox)}>
          <Icon className={cn("h-5 w-5", toneClasses.iconColor)} />
        </div>
      </CardContent>
    </Card>
  );
};

const PaymentsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();
  const navigate = useNavigate();

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("this_month");
  const [customStart, setCustomStart] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(format(new Date(), "yyyy-MM-dd"));
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [recoveryFilter, setRecoveryFilter] = useState<RecoveryFilter>("all");
  const [recoverySearch, setRecoverySearch] = useState("");
  const [paymentForm, setPaymentForm] = useState(initialPaymentForm);
  const [expenseForm, setExpenseForm] = useState(createInitialExpenseForm());
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const today = new Date();
  const selectedRange = useMemo(
    () => getPresetRange(periodPreset, customStart, customEnd, today),
    [customEnd, customStart, periodPreset, today],
  );
  const comparisonRange = useMemo(() => getComparisonRange(selectedRange), [selectedRange]);

  const { data: fallbackLibraries = [], isLoading: fallbackLoading } = useQuery({
    queryKey: ["payments-library-fallback", user?.id],
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
    data: financeData,
    error,
    isError,
    isLoading,
  } = useQuery({
    queryKey: ["finance-dashboard", resolvedLibraryId, selectedRange.key, comparisonRange.key],
    queryFn: async (): Promise<FinanceData> => {
      if (!resolvedLibraryId) {
        return {
          allPayments: [],
          automatedCalls: [],
          comparisonPayments: [],
          expenses: [],
          library: null,
          payments: [],
          pendingRenewals: [],
          plans: [],
          students: [],
        };
      }

      const fetchStart = comparisonRange.start < selectedRange.start ? comparisonRange.start : selectedRange.start;

      const [libraryRes, studentsRes, plansRes, paymentsRes, pendingRenewalsRes, expensesRes, automatedCallsRes] = await Promise.all([
        supabase
          .from("libraries")
          .select("id, name, total_seats, upi_id")
          .eq("id", resolvedLibraryId)
          .maybeSingle(),
        supabase
          .from("students")
          .select("id, expiry_date, full_name, phone, plan, plan_id, seat_id, seat_number, slot, start_date, status")
          .eq("library_id", resolvedLibraryId)
          .order("full_name", { ascending: true }),
        supabase
          .from("plans")
          .select("id, is_active, name, price")
          .eq("library_id", resolvedLibraryId)
          .order("created_at", { ascending: false }),
        supabase
          .from("payments")
          .select("amount, created_at, id, payment_method, payment_screenshot, period_end, period_start, plan, seat_id, source, status, student_id, students:student_id(id, full_name, phone, seat_number)")
          .eq("library_id", resolvedLibraryId)
          .lte("created_at", selectedRange.end.toISOString())
          .order("created_at", { ascending: false }),
        supabase
          .from("payments")
          .select("amount, created_at, id, payment_method, payment_screenshot, period_end, period_start, plan, seat_id, source, status, student_id, students:student_id(id, full_name, phone, seat_number)")
          .eq("library_id", resolvedLibraryId)
          .eq("source", "student_renewal")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("expenses")
          .select("amount, category, created_at, date, id, notes")
          .eq("library_id", resolvedLibraryId)
          .gte("date", format(selectedRange.start, "yyyy-MM-dd"))
          .lte("date", format(selectedRange.end, "yyyy-MM-dd"))
          .order("date", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("automated_calls" as any)
          .select("call_status, called_phone, created_at, error_message, estimated_recovery_impact, id, ivr_action, ivr_choice, pending_amount_snapshot, pickup_status, provider_call_sid, student_id, student_name_snapshot, tts_provider")
          .eq("library_id", resolvedLibraryId)
          .gte("created_at", selectedRange.start.toISOString())
          .lte("created_at", selectedRange.end.toISOString())
          .order("created_at", { ascending: false }),
      ]);

      if (libraryRes.error) throw libraryRes.error;
      if (studentsRes.error) throw studentsRes.error;
      if (plansRes.error) throw plansRes.error;
      if (paymentsRes.error) throw paymentsRes.error;
      if (pendingRenewalsRes.error) throw pendingRenewalsRes.error;
      if (expensesRes.error) throw expensesRes.error;
      if (automatedCallsRes.error && !isMissingRelationError(automatedCallsRes.error, "automated_calls")) throw automatedCallsRes.error;

      const mapPayment = (payment: PaymentLedgerRow): PaymentRow => ({
        amount: Number(payment.amount || 0),
        created_at: payment.created_at,
        id: payment.id,
        payment_method: payment.payment_method,
        payment_screenshot: payment.payment_screenshot,
        period_end: payment.period_end,
        period_start: payment.period_start,
        plan: payment.plan,
        seat_id: payment.seat_id,
        source: payment.source,
        status: payment.status,
        student_id: payment.student_id,
        student_name: payment.students?.full_name ?? "Student",
        student_phone: payment.students?.phone ?? null,
        student_seat_number: payment.students?.seat_number ?? payment.seat_id ?? null,
      });

      const allPayments = ((paymentsRes.data ?? []) as PaymentLedgerRow[]).map(mapPayment);
      const payments = allPayments.filter((payment) => {
        const createdAt = new Date(payment.created_at);
        return createdAt >= selectedRange.start && createdAt <= selectedRange.end;
      });
      const comparisonPayments = allPayments.filter((payment) => {
        const createdAt = new Date(payment.created_at);
        return createdAt >= comparisonRange.start && createdAt <= comparisonRange.end;
      });

      return {
        allPayments,
        automatedCalls: (automatedCallsRes.error ? [] : ((automatedCallsRes.data ?? []) as AutomatedCallLogRow[])).map((call) => ({
          ...call,
          estimated_recovery_impact: Number(call.estimated_recovery_impact || 0),
          pending_amount_snapshot: Number(call.pending_amount_snapshot || 0),
        })),
        comparisonPayments,
        expenses: (expensesRes.data ?? []) as ExpenseRow[],
        library: (libraryRes.data as LibraryFinanceRow | null) ?? null,
        payments,
        pendingRenewals: ((pendingRenewalsRes.data ?? []) as PaymentLedgerRow[]).map(mapPayment),
        plans: (plansRes.data ?? []) as PlanFinanceRow[],
        students: (studentsRes.data ?? []) as StudentFinanceRow[],
      };
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 15000,
  });

  const data = financeData ?? {
    allPayments: [],
    automatedCalls: [],
    comparisonPayments: [],
    expenses: [],
    library: null,
    payments: [],
    pendingRenewals: [],
    plans: [],
    students: [],
  };

  const selectedStudent = useMemo(
    () => data.students.find((student) => student.id === paymentForm.student_id) ?? null,
    [data.students, paymentForm.student_id],
  );

  const planLookup = useMemo(
    () =>
      createPlanPriceLookup(
        data.plans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          price: plan.price,
        })),
      ),
    [data.plans],
  );

  const averagePlanPrice = useMemo(() => {
    const activeStudentsToday = data.students.filter((student) => isStudentActiveOn(student, today));
    const studentPrices = activeStudentsToday
      .map((student) => {
        if (student.plan_id && planLookup.byId.has(student.plan_id)) return planLookup.byId.get(student.plan_id) || 0;
        return planLookup.byName.get(normalizeText(student.plan)) || 0;
      })
      .filter((price) => price > 0);

    if (studentPrices.length > 0) {
      return studentPrices.reduce((sum, price) => sum + price, 0) / studentPrices.length;
    }

    return planLookup.averagePrice;
  }, [data.plans, data.students, planLookup.byId, planLookup.byName, today]);

  const getStudentMonthlyPrice = (student: StudentFinanceRow) => {
    if (student.plan_id && planLookup.byId.has(student.plan_id)) {
      return planLookup.byId.get(student.plan_id) || 0;
    }
    const matchedByName = planLookup.byName.get(normalizeText(student.plan));
    if (matchedByName) return matchedByName;
    return averagePlanPrice;
  };

  const successfulPayments = useMemo(
    () => data.payments.filter((payment) => isSuccessfulPaymentStatus(payment.status)),
    [data.payments],
  );
  const pendingPayments = useMemo(
    () => data.payments.filter((payment) => isPendingPaymentStatus(payment.status)),
    [data.payments],
  );
  const paymentsByStudentId = useMemo(() => groupPaymentsByStudent(data.allPayments), [data.allPayments]);
  const studentPaymentSummaries = useMemo(
    () =>
      data.students
        .map((student) =>
          derivePaymentSummary({
            libraryName: data.library?.name ?? "Library",
            planLookup,
            student,
            studentPayments: paymentsByStudentId.get(student.id) ?? [],
            upiId: data.library?.upi_id ?? null,
          }),
        )
        .sort(comparePaymentSummaryRisk),
    [data.library?.name, data.library?.upi_id, data.students, paymentsByStudentId, planLookup],
  );
  const studentPaymentSummaryById = useMemo(
    () => new Map(studentPaymentSummaries.map((summary) => [summary.studentId, summary])),
    [studentPaymentSummaries],
  );
  const selectedStudentPaymentSummary = useMemo(
    () => (selectedStudent ? studentPaymentSummaryById.get(selectedStudent.id) ?? null : null),
    [selectedStudent, studentPaymentSummaryById],
  );
  const recoveryInsights = useMemo(() => buildPaymentInsights(studentPaymentSummaries), [studentPaymentSummaries]);
  const unpaidStudentsCount = useMemo(
    () => studentPaymentSummaries.filter((summary) => summary.paymentStatus === "unpaid" && summary.amountDue > 0).length,
    [studentPaymentSummaries],
  );
  const partialStudentsCount = useMemo(
    () => studentPaymentSummaries.filter((summary) => summary.paymentStatus === "partial").length,
    [studentPaymentSummaries],
  );
  const overdueStudentsCount = useMemo(
    () => studentPaymentSummaries.filter((summary) => summary.amountDue > 0 && summary.overdueDays > 0).length,
    [studentPaymentSummaries],
  );
  const totalPendingCollection = useMemo(
    () => studentPaymentSummaries.reduce((sum, summary) => sum + summary.amountDue, 0),
    [studentPaymentSummaries],
  );
  const recoveryQueue = useMemo(() => {
    const query = recoverySearch.trim().toLowerCase();
    return studentPaymentSummaries.filter((summary) => {
      if (recoveryFilter === "unpaid" && summary.paymentStatus !== "unpaid") return false;
      if (recoveryFilter === "partial" && summary.paymentStatus !== "partial") return false;
      if (recoveryFilter === "overdue" && summary.overdueDays <= 0) return false;
      if (!query) return true;
      return [
        summary.studentName,
        summary.seatNumber || "",
        summary.planName,
        getPaymentStatusLabel(summary.paymentStatus),
      ].some((field) => field.toLowerCase().includes(query));
    });
  }, [recoveryFilter, recoverySearch, studentPaymentSummaries]);
  const callableRecoveryQueue = useMemo(
    () => recoveryQueue.filter((summary) => hasCallablePhone(summary.phone)),
    [recoveryQueue],
  );
  const aiCallBatch = useMemo(() => callableRecoveryQueue.slice(0, 5), [callableRecoveryQueue]);
  const overdueAiCallBatch = useMemo(
    () => studentPaymentSummaries.filter((summary) => summary.amountDue > 0 && summary.overdueDays > 0 && hasCallablePhone(summary.phone)).slice(0, 5),
    [studentPaymentSummaries],
  );
  const aiCallPreviewStudent = aiCallBatch[0] ?? null;
  const aiCallPreviewScript = aiCallPreviewStudent
    ? `Hello ${aiCallPreviewStudent.studentName}, this is from ${data.library?.name || "your library"}. Your ${formatInr(aiCallPreviewStudent.amountDue)} fee is pending. Please pay today to avoid late charges.`
    : null;
  const totalCallsMade = useMemo(() => data.automatedCalls.length, [data.automatedCalls]);
  const pickedCalls = useMemo(
    () => data.automatedCalls.filter((call) => call.pickup_status === "picked").length,
    [data.automatedCalls],
  );
  const missedCalls = useMemo(
    () => data.automatedCalls.filter((call) => call.pickup_status === "not_picked").length,
    [data.automatedCalls],
  );
  const completedCalls = useMemo(
    () => data.automatedCalls.filter((call) => (call.call_status || "").toLowerCase() === "completed").length,
    [data.automatedCalls],
  );
  const callResponsesReceived = useMemo(
    () => data.automatedCalls.filter((call) => !!call.ivr_choice).length,
    [data.automatedCalls],
  );
  const adminCallbackRequests = useMemo(
    () => data.automatedCalls.filter((call) => call.ivr_action === "admin_callback_requested").length,
    [data.automatedCalls],
  );
  const estimatedCallRecoveryImpact = useMemo(
    () =>
      Math.round(
        data.automatedCalls.reduce(
          (sum, call) => sum + Number(call.estimated_recovery_impact || call.pending_amount_snapshot || 0),
          0,
        ),
      ),
    [data.automatedCalls],
  );
  const recentAutomatedCalls = useMemo(() => data.automatedCalls.slice(0, 6), [data.automatedCalls]);
  const comparisonRevenue = useMemo(
    () =>
      data.comparisonPayments
        .filter((payment) => isSuccessfulPaymentStatus(payment.status))
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [data.comparisonPayments],
  );

  const totalRevenue = useMemo(
    () => successfulPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [successfulPayments],
  );
  const totalExpenses = useMemo(
    () => data.expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    [data.expenses],
  );
  const netProfit = totalRevenue - totalExpenses;

  const trendPoints = useMemo<FinanceTrendPoint[]>(() => {
    const totalDays = differenceInCalendarDays(selectedRange.end, selectedRange.start) + 1;
    const revenueByDay = new Map<string, number>();
    const expenseByDay = new Map<string, number>();

    for (const payment of successfulPayments) {
      const key = format(new Date(payment.created_at), "yyyy-MM-dd");
      revenueByDay.set(key, (revenueByDay.get(key) || 0) + Number(payment.amount || 0));
    }

    for (const expense of data.expenses) {
      const key = expense.date;
      expenseByDay.set(key, (expenseByDay.get(key) || 0) + Number(expense.amount || 0));
    }

    return Array.from({ length: totalDays }, (_, index) => {
      const date = addDays(selectedRange.start, index);
      const key = format(date, "yyyy-MM-dd");
      return {
        day: format(date, totalDays > 35 ? "dd MMM" : "d"),
        expense: Math.round(expenseByDay.get(key) || 0),
        label: format(date, "dd MMM yyyy"),
        revenue: Math.round(revenueByDay.get(key) || 0),
      };
    });
  }, [data.expenses, selectedRange.end, selectedRange.start, successfulPayments]);

  const expectedRevenue = useMemo(() => {
    const expected = data.students.reduce((sum, student) => {
      const overlapDays = getActiveOverlapDays(student, selectedRange.start, selectedRange.end);
      if (overlapDays <= 0) return sum;
      const monthlyPrice = getStudentMonthlyPrice(student);
      return sum + monthlyPrice * (overlapDays / 30);
    }, 0);

    return Math.round(expected);
  }, [data.students, selectedRange.end, selectedRange.start]);

  const occupiedSeatDays = useMemo(
    () => data.students.reduce((sum, student) => sum + getActiveOverlapDays(student, selectedRange.start, selectedRange.end), 0),
    [data.students, selectedRange.end, selectedRange.start],
  );

  const totalPeriodDays = differenceInCalendarDays(selectedRange.end, selectedRange.start) + 1;
  const emptySeatDays = Math.max(((data.library?.total_seats ?? 0) * totalPeriodDays) - occupiedSeatDays, 0);
  const emptySeatOpportunity = Math.round((averagePlanPrice / 30) * emptySeatDays);
  const pendingPaymentsAmount = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const collectionGap = Math.max(expectedRevenue - totalRevenue, 0);
  const revenueLeakage = emptySeatOpportunity + pendingPaymentsAmount;

  const topPayingStudent = useMemo(() => {
    const totals = new Map<string, { name: string; total: number }>();
    for (const payment of successfulPayments) {
      const current = totals.get(payment.student_id) ?? { name: payment.student_name, total: 0 };
      current.total += Number(payment.amount || 0);
      totals.set(payment.student_id, current);
    }

    return Array.from(totals.values()).sort((left, right) => right.total - left.total)[0] ?? null;
  }, [successfulPayments]);

  const bestEarningDay = useMemo(() => {
    return trendPoints.reduce<FinanceTrendPoint | null>((best, point) => {
      if (!best || point.revenue > best.revenue) return point;
      return best;
    }, null);
  }, [trendPoints]);

  const revenueChange = useMemo(() => {
    if (comparisonRevenue <= 0) {
      if (totalRevenue <= 0) {
        return {
          detail: "Need at least two periods of collections for growth comparison.",
          text: "Waiting for comparison data",
        };
      }

      return {
        detail: "Collections started during this period.",
        text: "Revenue picked up from zero",
      };
    }

    const pct = ((totalRevenue - comparisonRevenue) / comparisonRevenue) * 100;
    return {
      detail: `${pct >= 0 ? "Higher" : "Lower"} than the previous matching period`,
      text: `Collection ${pct >= 0 ? "increased" : "decreased"} by ${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(0)}%`,
    };
  }, [comparisonRevenue, totalRevenue]);

  const expenseBreakdown = useMemo(
    () =>
      expenseCategories.map((category) => ({
        amount: data.expenses
          .filter((expense) => expense.category === category.value)
          .reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
        label: category.label,
        value: category.value,
      })),
    [data.expenses],
  );

  const financeActivity = useMemo<FinanceListRow[]>(() => {
    const paymentRows: FinanceListRow[] = data.payments.map((payment) => ({
      amount: Number(payment.amount || 0),
      category: payment.source.replace(/_/g, " "),
      date: new Date(payment.created_at),
      dateLabel: format(new Date(payment.created_at), "dd MMM yyyy"),
      id: payment.id,
      note: payment.plan || payment.payment_method || "Payment",
      payment,
      proofAvailable: !!payment.payment_screenshot,
      status: payment.status,
      title: payment.student_name,
      type: "Revenue",
    }));

    const expenseRows: FinanceListRow[] = data.expenses.map((expense) => ({
      amount: Number(expense.amount || 0),
      category: getExpenseCategoryLabel(expense.category),
      date: parseDateOnly(expense.date),
      dateLabel: format(parseDateOnly(expense.date), "dd MMM yyyy"),
      id: expense.id,
      note: expense.notes || "Manual expense entry",
      proofAvailable: false,
      status: "recorded",
      title: getExpenseCategoryLabel(expense.category),
      type: "Expense",
    }));

    return [...paymentRows, ...expenseRows].sort((left, right) => right.date.getTime() - left.date.getTime());
  }, [data.expenses, data.payments]);

  const topInsights = useMemo(
    () => [
      {
        description:
          bestEarningDay && bestEarningDay.revenue > 0
            ? `${bestEarningDay.label} (${formatInr(bestEarningDay.revenue)})`
            : "Best earning day will appear after the first collected payment.",
        title: "Best earning day",
      },
      {
        description: topPayingStudent ? `${topPayingStudent.name} (${formatInr(topPayingStudent.total)})` : "Highest paying student will appear once collections start.",
        title: "Highest paying student",
      },
      {
        description: revenueChange.text,
        title: "Collection movement",
      },
    ],
    [bestEarningDay, revenueChange.text, topPayingStudent],
  );

  const smartActionInsights = useMemo(
    () =>
      [
        aiCallBatch.length > 0
          ? {
              actionLabel: "Start AI Calling",
              description: `Recover ${formatInr(recoveryInsights.recoverableNow)} by contacting ${aiCallBatch.length} students first with personalized voice calls.`,
              onClick: () => startAiRecoveryForStudents(aiCallBatch.map((summary) => summary.studentId), "payments_insight"),
              title: "Money ready for recovery",
            }
          : null,
        overdueAiCallBatch.length > 0
          ? {
              actionLabel: "Call Overdue Now",
              description: `${overdueAiCallBatch.length} students have crossed the overdue threshold and are ready for automated calling.`,
              onClick: () => startAiRecoveryForStudents(overdueAiCallBatch.map((summary) => summary.studentId), "payments_overdue_insight"),
              title: "Call alert",
            }
          : null,
        recoveryInsights.topSlot
          ? {
              actionLabel: "Open Queue",
              description: `${recoveryInsights.topSlot[0]} has ${formatInr(recoveryInsights.topSlot[1].amount)} pending across ${recoveryInsights.topSlot[1].count} students.`,
              onClick: () => setRecoverySearch(recoveryInsights.topSlot?.[0] ?? ""),
              title: "Unpaid concentration",
            }
          : null,
      ].filter((item): item is { actionLabel: string; description: string; onClick: () => void; title: string } => !!item),
    [aiCallBatch, overdueAiCallBatch, recoveryInsights],
  );

  const dailyActionFlow = useMemo(
    () => [
      {
        actionLabel: "Open Attendance",
        detail: "Start with attendance so churn signals and fee follow-ups stay accurate.",
        onClick: () => navigate("/dashboard/attendance"),
        status: "Required",
        step: "Step 1",
        title: "Mark attendance",
      },
      {
        actionLabel: "Contact Unpaid",
        detail:
          overdueStudentsCount > 0
            ? `${overdueStudentsCount} overdue students need immediate follow-up.`
            : `${unpaidStudentsCount + partialStudentsCount} students still need payment action.`,
        onClick: () => setRecoveryFilter(overdueStudentsCount > 0 ? "overdue" : "all"),
        status: overdueStudentsCount > 0 ? "Urgent" : "Pending",
        step: "Step 2",
        title: "Contact unpaid students",
      },
      {
        actionLabel: "Collect Payment",
        detail: `${formatInr(totalPendingCollection)} is still open in current student dues.`,
        onClick: () =>
          recoveryQueue[0] ? openPaymentDialogForStudent(recoveryQueue[0].studentId, recoveryQueue[0].amountDue) : setPaymentDialogOpen(true),
        status: totalPendingCollection > 0 ? "In progress" : "Done",
        step: "Step 3",
        title: "Collect pending fees",
      },
    ],
    [navigate, overdueStudentsCount, unpaidStudentsCount, partialStudentsCount, totalPendingCollection, recoveryQueue],
  );

  const startRecoveryCallsMutation = useMutation({
    mutationFn: async ({
      limit,
      source,
      studentIds,
    }: {
      limit?: number;
      source: string;
      studentIds?: string[];
    }) => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      const headers = await getEdgeFunctionAuthHeaders();

      const { data: responseData, error: invokeError } = await supabase.functions.invoke<StartRecoveryCallsResponse>(
        "start-payment-recovery-calls",
        {
          headers,
          body: {
            libraryId: resolvedLibraryId,
            limit,
            source,
            studentIds,
          },
        },
      );

      if (invokeError) {
        throw new Error(await readFunctionErrorMessage(invokeError, "start-payment-recovery-calls"));
      }

      if (responseData?.error) {
        throw new Error(responseData.error);
      }

      return responseData;
    },
    onError: (mutationError: Error) => {
      toast({ title: "AI calling failed", description: mutationError.message, variant: "destructive" });
    },
    onSuccess: (responseData) => {
      toast({
        title: "AI calling started",
        description:
          responseData?.message ||
          `Started ${responseData?.queuedCalls ?? 0} automated payment recovery call(s).`,
      });
      queryClient.invalidateQueries({ queryKey: ["finance-dashboard", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
    },
  });

  const addPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      if (!paymentForm.student_id) throw new Error("Please select a student.");
      if (!paymentForm.amount || Number(paymentForm.amount) <= 0) throw new Error("Enter a valid amount.");

      const payload: Database["public"]["Tables"]["payments"]["Insert"] = {
        amount: Number(paymentForm.amount),
        library_id: resolvedLibraryId,
        payment_method: paymentForm.payment_method || "cash",
        period_end:
          selectedStudentPaymentSummary?.dueDate || getDefaultPaymentDueDate(selectedStudent?.start_date || format(new Date(), "yyyy-MM-dd")),
        period_start: selectedStudent?.start_date || format(new Date(), "yyyy-MM-dd"),
        plan: paymentForm.plan || selectedStudent?.plan || null,
        seat_id: selectedStudent?.seat_id || null,
        source: "manual",
        status: paymentForm.status,
        student_id: paymentForm.student_id,
      };

      const { error } = await supabase.from("payments").insert(payload);
      if (error) throw error;
    },
    onError: (mutationError: Error) => {
      toast({ title: "Unable to add payment", description: mutationError.message, variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Payment added" });
      setPaymentDialogOpen(false);
      setPaymentForm(initialPaymentForm);
      queryClient.invalidateQueries({ queryKey: ["finance-dashboard", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students-payment-tracking", resolvedLibraryId] });
    },
  });

  const markStudentPaidMutation = useMutation({
    mutationFn: async ({
      amount,
      studentId,
    }: {
      amount: number;
      studentId: string;
    }) => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      if (amount <= 0) throw new Error("No due amount left for this student.");
      const student = data.students.find((entry) => entry.id === studentId);
      if (!student) throw new Error("Student not found.");
      const summary = studentPaymentSummaryById.get(studentId);

      const payload: Database["public"]["Tables"]["payments"]["Insert"] = {
        amount,
        library_id: resolvedLibraryId,
        payment_method: "cash",
        period_end: summary?.dueDate || getDefaultPaymentDueDate(student.start_date || format(new Date(), "yyyy-MM-dd")),
        period_start: student.start_date || format(new Date(), "yyyy-MM-dd"),
        plan: student.plan || null,
        seat_id: student.seat_id || null,
        source: "manual",
        status: "approved",
        student_id: studentId,
      };

      const { error } = await supabase.from("payments").insert(payload);
      if (error) throw error;
    },
    onError: (mutationError: Error) => {
      toast({ title: "Unable to mark as paid", description: mutationError.message, variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Payment marked as paid" });
      queryClient.invalidateQueries({ queryKey: ["finance-dashboard", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
    },
  });

  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      if (!expenseForm.amount || Number(expenseForm.amount) <= 0) throw new Error("Enter a valid expense amount.");

      const payload: Database["public"]["Tables"]["expenses"]["Insert"] = {
        amount: Number(expenseForm.amount),
        category: expenseForm.category,
        date: expenseForm.date,
        library_id: resolvedLibraryId,
        notes: expenseForm.notes.trim() || null,
      };

      const { error } = await supabase.from("expenses").insert(payload);
      if (error) throw error;
    },
    onError: (mutationError: Error) => {
      toast({ title: "Unable to add expense", description: mutationError.message, variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Expense recorded" });
      setExpenseDialogOpen(false);
      setExpenseForm(createInitialExpenseForm());
      queryClient.invalidateQueries({ queryKey: ["finance-dashboard", resolvedLibraryId] });
    },
  });

  const approvePaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase
        .from("payments")
        .update({ status: "approved" })
        .eq("id", paymentId);
      if (error) throw error;
    },
    onError: (mutationError: Error) => {
      toast({ title: "Approval failed", description: mutationError.message, variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Renewal approved", description: "Student expiry date has been extended by 30 days." });
      queryClient.invalidateQueries({ queryKey: ["finance-dashboard", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students-renewals", resolvedLibraryId] });
    },
  });

  const normalizePhoneNumber = (value: string | null | undefined) => (value || "").replace(/\D/g, "");

  const openPaymentDialogForStudent = (studentId: string, suggestedAmount?: number) => {
    const student = data.students.find((entry) => entry.id === studentId);
    if (!student) return;
    const summary = studentPaymentSummaryById.get(studentId);
    setPaymentForm({
      amount: String(Math.max(suggestedAmount ?? summary?.amountDue ?? 0, 0)),
      payment_method: "cash",
      plan: student.plan || "",
      status: "completed",
      student_id: studentId,
    });
    setPaymentDialogOpen(true);
  };

  const openPhoneRecovery = (studentId: string) => {
    const student = data.students.find((entry) => entry.id === studentId);
    const phone = normalizePhoneNumber(student?.phone);
    if (!student || !phone) {
      toast({
        title: "Phone number missing",
        description: "Add a phone number before triggering call recovery.",
        variant: "destructive",
      });
      return;
    }

    window.location.href = `tel:${phone}`;
  };

  const openWhatsAppRecovery = (studentId: string) => {
    const student = data.students.find((entry) => entry.id === studentId);
    const summary = studentPaymentSummaryById.get(studentId);
    const phone = normalizePhoneNumber(student?.phone);
    if (!student || !phone || !summary) {
      toast({
        title: "WhatsApp recovery unavailable",
        description: "Student phone or recovery message is missing.",
        variant: "destructive",
      });
      return;
    }

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(summary.payNowMessage)}`, "_blank", "noopener,noreferrer");
  };

  const openPayNowLink = (studentId: string) => {
    const summary = studentPaymentSummaryById.get(studentId);
    if (!summary?.payNowLink) {
      toast({
        title: "Pay link unavailable",
        description: "Configure library UPI ID in Settings to generate a direct payment link.",
        variant: "destructive",
      });
      return;
    }

    window.open(summary.payNowLink, "_blank", "noopener,noreferrer");
  };

  const startAiRecoveryForStudents = (studentIds: string[], source: string) => {
    const filteredStudentIds = Array.from(new Set(studentIds.filter(Boolean)));
    if (filteredStudentIds.length === 0) {
      toast({
        title: "No callable students",
        description: "Add phone numbers to unpaid students before starting AI recovery calls.",
        variant: "destructive",
      });
      return;
    }

    startRecoveryCallsMutation.mutate({
      limit: filteredStudentIds.length,
      source,
      studentIds: filteredStudentIds,
    });
  };

  const startSingleAiRecovery = (studentId: string) => {
    const student = data.students.find((entry) => entry.id === studentId);
    if (!hasCallablePhone(student?.phone)) {
      toast({
        title: "Phone number missing",
        description: "Add a phone number before triggering AI call recovery.",
        variant: "destructive",
      });
      return;
    }

    startAiRecoveryForStudents([studentId], "payments_row");
  };

  const openScreenshotPreview = async (payment: PaymentRow) => {
    if (!payment.payment_screenshot) return;

    const { data: signedUrl, error: signedUrlError } = await supabase.storage
      .from(PAYMENT_SCREENSHOT_BUCKET)
      .createSignedUrl(payment.payment_screenshot, 3600);

    if (signedUrlError) {
      toast({ title: "Unable to open screenshot", description: signedUrlError.message, variant: "destructive" });
      return;
    }

    setPreviewTitle(`${payment.student_name} • ${format(new Date(payment.created_at), "dd MMM yyyy, hh:mm a")}`);
    setPreviewUrl(signedUrl.signedUrl);
    setPreviewOpen(true);
  };

  const handleCsvExport = () => {
    if (financeActivity.length === 0) {
      toast({ title: "No finance data to export", variant: "destructive" });
      return;
    }

    exportToCsv(
      `finance-${selectedRange.key}`,
      financeActivity.map((row) => ({
        amount: row.amount,
        category: row.category,
        date: row.dateLabel,
        details: row.note,
        status: row.status,
        title: row.title,
        type: row.type,
      })),
    );

    toast({ title: "CSV export started" });
  };

  const handlePdfExport = () => {
    if (financeActivity.length === 0) {
      toast({ title: "No finance data to export", variant: "destructive" });
      return;
    }

    const popup = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
    if (!popup) {
      toast({ title: "Unable to open export preview", description: "Please allow pop-ups and try again.", variant: "destructive" });
      return;
    }

    const rowsHtml = financeActivity
      .slice(0, 20)
      .map(
        (row) => `
          <tr>
            <td>${row.dateLabel}</td>
            <td>${row.type}</td>
            <td>${row.title}</td>
            <td>${row.category}</td>
            <td>${formatInr(row.amount)}</td>
            <td>${row.status}</td>
            <td>${row.note}</td>
          </tr>
        `,
      )
      .join("");

    popup.document.write(`
      <html>
        <head>
          <title>Finance Export</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; color: #111827; }
            h1, h2 { margin: 0 0 8px; }
            p { margin: 0 0 6px; color: #4b5563; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin: 24px 0; }
            .card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 16px; }
            .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
            .value { font-size: 28px; font-weight: 700; margin-top: 8px; color: #111827; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; }
            th, td { border: 1px solid #e5e7eb; padding: 10px; text-align: left; font-size: 12px; }
            th { background: #f9fafb; color: #374151; }
          </style>
        </head>
        <body>
          <h1>Finance Dashboard Export</h1>
          <p>${selectedRange.label}</p>
          <div class="grid">
            <div class="card">
              <div class="label">Total Revenue</div>
              <div class="value">${formatInr(totalRevenue)}</div>
            </div>
            <div class="card">
              <div class="label">Total Expenses</div>
              <div class="value">${formatInr(totalExpenses)}</div>
            </div>
            <div class="card">
              <div class="label">Net Profit</div>
              <div class="value">${formatInr(netProfit)}</div>
            </div>
            <div class="card">
              <div class="label">Expected vs Actual</div>
              <div class="value">${formatInr(expectedRevenue)} / ${formatInr(totalRevenue)}</div>
            </div>
          </div>
          <h2>Filtered Transactions</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Title</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `);

    popup.document.close();
    popup.focus();
    popup.print();
  };

  const loading = roleLibraryLoading || fallbackLoading || isLoading;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Payments & Finance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Track revenue, expenses, profit, and leakages in one clean business finance dashboard.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleCsvExport}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handlePdfExport}>
              <FileText className="mr-1 h-4 w-4" /> Export PDF
            </Button>

            <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" size="sm" disabled={!resolvedLibraryId}>
                  <Plus className="mr-1 h-4 w-4" /> Add Expense
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">Add Expense</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Amount (INR)</Label>
                      <Input type="number" placeholder="2500" value={expenseForm.amount} onChange={(event) => setExpenseForm((previous) => ({ ...previous, amount: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={expenseForm.category} onValueChange={(value) => setExpenseForm((previous) => ({ ...previous, category: value }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {expenseCategories.map((category) => (
                            <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Date</Label>
                      <Input type="date" value={expenseForm.date} onChange={(event) => setExpenseForm((previous) => ({ ...previous, date: event.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea placeholder="Optional note about this expense" value={expenseForm.notes} onChange={(event) => setExpenseForm((previous) => ({ ...previous, notes: event.target.value }))} />
                  </div>
                  <Button className="w-full" onClick={() => addExpenseMutation.mutate()} disabled={addExpenseMutation.isPending || !expenseForm.amount}>
                    {addExpenseMutation.isPending ? "Saving..." : "Save Expense"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!resolvedLibraryId}>
                  <Plus className="mr-1 h-4 w-4" /> Add Payment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">Add Manual Payment</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Student</Label>
                    <Select value={paymentForm.student_id || "none"} onValueChange={(value) => setPaymentForm((previous) => ({ ...previous, student_id: value === "none" ? "" : value }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select student" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Select student</SelectItem>
                        {data.students.map((student) => (
                          <SelectItem key={student.id} value={student.id}>{student.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                      </Select>
                    </div>
                    {selectedStudentPaymentSummary ? (
                      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                        <div className="grid gap-3 md:grid-cols-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Total Fees</p>
                            <p className="mt-2 text-lg font-semibold text-foreground">{formatInr(selectedStudentPaymentSummary.totalFees)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paid</p>
                            <p className="mt-2 text-lg font-semibold text-emerald-700">{formatInr(selectedStudentPaymentSummary.amountPaid)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Due</p>
                            <p className="mt-2 text-lg font-semibold text-rose-700">{formatInr(selectedStudentPaymentSummary.amountDue)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Status</p>
                            <p className="mt-2 text-lg font-semibold text-foreground">{getPaymentStatusLabel(selectedStudentPaymentSummary.paymentStatus)}</p>
                          </div>
                        </div>
                        {selectedStudentPaymentSummary.amountDue > 0 ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => openWhatsAppRecovery(selectedStudentPaymentSummary.studentId)}>
                              <MessageCircle className="mr-1 h-3.5 w-3.5" /> Send reminder
                            </Button>
                            <Button type="button" size="sm" variant="outline" onClick={() => openPayNowLink(selectedStudentPaymentSummary.studentId)}>
                              <TimerReset className="mr-1 h-3.5 w-3.5" /> Open pay link
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Amount (INR)</Label>
                      <Input type="number" placeholder="3500" value={paymentForm.amount} onChange={(event) => setPaymentForm((previous) => ({ ...previous, amount: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={paymentForm.status} onValueChange={(value) => setPaymentForm((previous) => ({ ...previous, status: value }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                          <SelectItem value="refunded">Refunded</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Plan</Label>
                    <Input placeholder="Plan name" value={paymentForm.plan || selectedStudent?.plan || ""} onChange={(event) => setPaymentForm((previous) => ({ ...previous, plan: event.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <Input placeholder="cash / upi / card / razorpay" value={paymentForm.payment_method} onChange={(event) => setPaymentForm((previous) => ({ ...previous, payment_method: event.target.value }))} />
                  </div>
                  <Button className="w-full" onClick={() => addPaymentMutation.mutate()} disabled={addPaymentMutation.isPending || !paymentForm.student_id || !paymentForm.amount}>
                    {addPaymentMutation.isPending ? "Saving..." : "Save Payment"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-primary/5 shadow-lg shadow-primary/10">
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Smart Date Filter</p>
                <p className="mt-2 text-lg font-semibold font-display text-foreground">{selectedRange.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">Cards, chart, and transaction list all react to the selected finance window.</p>
              </div>
              <Badge variant="outline" className="w-fit border-primary/20 bg-primary/5 text-primary">Compare against {comparisonRange.label}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {periodButtonCopy.map((period) => (
                <Button key={period.value} type="button" variant={periodPreset === period.value ? "default" : "outline"} className="font-semibold" onClick={() => setPeriodPreset(period.value)}>
                  {period.label}
                </Button>
              ))}
            </div>
            {periodPreset === "custom" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Start date</Label>
                  <Input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End date</Label>
                  <Input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {!resolvedLibraryId && !loading ? (
          <Card>
            <CardContent className="py-8 text-center text-destructive">Library not linked to your account. Please check user role setup.</CardContent>
          </Card>
        ) : loading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">Loading finance dashboard...</CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="py-8 text-center text-destructive">Unable to load finance dashboard: {getErrorMessage(error)}</CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-rose-200/70 bg-[linear-gradient(135deg,rgba(255,241,242,0.95),rgba(255,255,255,0.98))] shadow-lg shadow-rose-100/60">
              <CardContent className="space-y-5 p-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Payment Tracking + Revenue Recovery</p>
                    <h3 className="mt-3 text-3xl font-display font-bold text-slate-950">{formatInr(totalPendingCollection)} needs collection now</h3>
                    <p className="mt-2 max-w-2xl text-sm text-slate-600">
                      {unpaidStudentsCount} unpaid students, {partialStudentsCount} partial payments, and {overdueStudentsCount} overdue collections are active in the recovery engine.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-rose-200 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Pending Collection</p>
                      <p className="mt-3 text-2xl font-semibold text-rose-700">{formatInr(totalPendingCollection)}</p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Unpaid Students</p>
                      <p className="mt-3 text-2xl font-semibold text-amber-700">{unpaidStudentsCount}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Overdue Payments</p>
                      <p className="mt-3 text-2xl font-semibold text-slate-950">{overdueStudentsCount}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
                  <Button className="h-12 justify-center text-base font-semibold" onClick={() => recoveryQueue[0] ? openPaymentDialogForStudent(recoveryQueue[0].studentId, recoveryQueue[0].amountDue) : setPaymentDialogOpen(true)}>
                    <Wallet className="mr-2 h-4 w-4" />
                    Collect {formatInr(totalPendingCollection)} Now
                  </Button>
                  <Button variant="outline" className="h-12 justify-center text-base font-semibold" onClick={() => recoveryQueue[0] ? openPhoneRecovery(recoveryQueue[0].studentId) : setRecoveryFilter("overdue")}>
                    <Phone className="mr-2 h-4 w-4" />
                    Call High-Risk Students
                  </Button>
                  <Button variant="outline" className="h-12 justify-center text-base font-semibold" onClick={() => recoveryQueue[0] ? openWhatsAppRecovery(recoveryQueue[0].studentId) : setRecoveryFilter("all")}>
                    <MessageCircle className="mr-2 h-4 w-4" />
                    Send WhatsApp Reminders
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-sky-200/70 bg-[linear-gradient(135deg,rgba(239,246,255,0.92),rgba(255,255,255,0.98))] shadow-lg shadow-sky-100/70">
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">AI Calling Recovery</Badge>
                      <Badge variant="outline" className="border-slate-200 bg-white/80 text-slate-700">
                        {callResponsesReceived} IVR response{callResponsesReceived === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <CardTitle className="mt-3 text-2xl font-display">Automated payment calls that speak student name, library name, and exact due amount</CardTitle>
                    <CardDescription className="mt-2 max-w-3xl text-sm text-slate-600">
                      Unpaid students are detected automatically from payment tracking. Calls play a personalized reminder, then offer IVR options to confirm payment or request an admin callback.
                    </CardDescription>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-sky-200 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Total Calls</p>
                      <p className="mt-3 text-2xl font-semibold text-slate-950">{totalCallsMade}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Picked Vs Missed</p>
                      <p className="mt-3 text-2xl font-semibold text-emerald-700">{pickedCalls} / {missedCalls}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Completed</p>
                      <p className="mt-3 text-2xl font-semibold text-slate-950">{completedCalls}</p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Recovery Impact</p>
                      <p className="mt-3 text-2xl font-semibold text-amber-700">{formatInr(estimatedCallRecoveryImpact)}</p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                  <div className="rounded-3xl border border-sky-200/70 bg-white/80 p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Live Script Preview</p>
                    {aiCallPreviewScript ? (
                      <>
                        <p className="mt-4 text-lg font-semibold text-slate-950">
                          {aiCallPreviewStudent?.studentName} • {formatInr(aiCallPreviewStudent?.amountDue ?? 0)} due
                        </p>
                        <p className="mt-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-4 text-sm leading-7 text-slate-700">
                          “{aiCallPreviewScript}”
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                          <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">TTS: ElevenLabs / Google fallback / Twilio Say</Badge>
                          <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">IVR: Press 1 payment, Press 2 admin</Badge>
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed border-sky-200 bg-sky-50/60 p-4 text-sm text-slate-600">
                        No callable unpaid students are available right now. Add phone numbers or wait for unpaid entries to enter the recovery queue.
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border/70 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Ready For AI Call</p>
                      <p className="mt-3 text-3xl font-display font-bold text-slate-950">{aiCallBatch.length}</p>
                      <p className="mt-2 text-sm text-slate-600">{formatInr(aiCallBatch.reduce((sum, student) => sum + student.amountDue, 0))} can be chased in the top batch right now.</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Overdue Call Queue</p>
                      <p className="mt-3 text-3xl font-display font-bold text-slate-950">{overdueAiCallBatch.length}</p>
                      <p className="mt-2 text-sm text-slate-600">These students already crossed the overdue threshold and should be called first.</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Admin Callback Requests</p>
                      <p className="mt-3 text-3xl font-display font-bold text-slate-950">{adminCallbackRequests}</p>
                      <p className="mt-2 text-sm text-slate-600">Students who pressed 2 and asked for a live admin conversation.</p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-white/90 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current Flow</p>
                      <p className="mt-3 text-lg font-semibold text-slate-950">Detect unpaid → Call → Track response</p>
                      <p className="mt-2 text-sm text-slate-600">Only unpaid or partial students with due amounts and phone numbers are sent into the AI queue.</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
                  <Button
                    className="h-12 justify-center text-base font-semibold"
                    disabled={startRecoveryCallsMutation.isPending || aiCallBatch.length === 0}
                    onClick={() => startAiRecoveryForStudents(aiCallBatch.map((summary) => summary.studentId), "payments_top_batch")}
                  >
                    <Bot className="mr-2 h-4 w-4" />
                    {startRecoveryCallsMutation.isPending ? "Starting AI Calls..." : `Start AI Calling (${aiCallBatch.length})`}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-12 justify-center text-base font-semibold"
                    disabled={startRecoveryCallsMutation.isPending || overdueAiCallBatch.length === 0}
                    onClick={() => startAiRecoveryForStudents(overdueAiCallBatch.map((summary) => summary.studentId), "payments_overdue_batch")}
                  >
                    <Phone className="mr-2 h-4 w-4" />
                    Call Overdue Students
                  </Button>
                  <Button variant="outline" className="h-12 justify-center text-base font-semibold" onClick={() => setRecoveryFilter("all")}>
                    <Wallet className="mr-2 h-4 w-4" />
                    Open Recovery Queue
                  </Button>
                </div>

                <div className="rounded-3xl border border-border/70 bg-white/90 p-5">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-base font-semibold text-slate-950">Recent AI Call Log</p>
                      <p className="text-sm text-slate-600">Track picked vs missed, IVR response, and estimated recovery impact from recent automated calls.</p>
                    </div>
                    <Badge variant="outline" className="w-fit border-slate-200 bg-slate-50 text-slate-700">{recentAutomatedCalls.length} visible</Badge>
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>IVR</TableHead>
                          <TableHead>Impact</TableHead>
                          <TableHead className="text-right">Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentAutomatedCalls.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                              No AI recovery calls have been triggered in this date range yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          recentAutomatedCalls.map((call) => (
                            <TableRow key={call.id}>
                              <TableCell>
                                <p className="font-medium text-foreground">{call.student_name_snapshot}</p>
                                <p className="text-xs text-muted-foreground">{call.tts_provider.replace(/_/g, " ")}</p>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn(getCallStatusBadgeClassName(call.call_status))}>
                                  {formatCallStatusLabel(call.call_status)}
                                </Badge>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {call.pickup_status === "picked" ? "Picked" : call.pickup_status === "not_picked" ? "Missed" : "Waiting"}
                                </p>
                              </TableCell>
                              <TableCell>
                                <p className="text-sm font-medium text-foreground">
                                  {call.ivr_choice === "1"
                                    ? "Payment confirmed"
                                    : call.ivr_choice === "2"
                                      ? "Talk to admin"
                                      : "No IVR input"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {call.error_message ? call.error_message : call.provider_call_sid ? `SID ${call.provider_call_sid}` : "Awaiting provider update"}
                                </p>
                              </TableCell>
                              <TableCell className="font-semibold text-amber-700">
                                {formatInr(call.estimated_recovery_impact || call.pending_amount_snapshot)}
                              </TableCell>
                              <TableCell className="text-right text-sm text-muted-foreground">
                                {format(new Date(call.created_at), "dd MMM, hh:mm a")}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-primary/5 shadow-lg shadow-primary/10">
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl font-display">Daily Action Flow</CardTitle>
                  <CardDescription>Remove decision friction and move from attendance to payment recovery fast.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  {dailyActionFlow.map((step) => (
                    <div key={step.step} className="rounded-2xl border border-border/70 bg-white/90 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{step.step}</p>
                        <Badge variant="outline">{step.status}</Badge>
                      </div>
                      <p className="mt-3 text-lg font-semibold text-slate-950">{step.title}</p>
                      <p className="mt-2 text-sm text-slate-600">{step.detail}</p>
                      <Button className="mt-4 w-full" variant={step.step === "Step 3" ? "default" : "outline"} onClick={step.onClick}>
                        {step.actionLabel}
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl font-display">Smart Payment Insights</CardTitle>
                  <CardDescription>Every insight is tied to recovery or risk reduction.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {smartActionInsights.length > 0 ? (
                    smartActionInsights.map((insight) => (
                      <div key={insight.title} className="rounded-2xl border border-border/70 bg-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                            <p className="mt-2 text-sm text-muted-foreground">{insight.description}</p>
                          </div>
                          <Target className="h-4 w-4 text-primary" />
                        </div>
                        <Button className="mt-4 w-full" variant="outline" onClick={insight.onClick}>
                          {insight.actionLabel}
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
                      No payment risk is building right now. Collections are under control.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <CardTitle className="text-xl font-display">Recovery Queue</CardTitle>
                    <CardDescription>Every unpaid student is pushed here automatically with amount due, overdue age, and next action.</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { label: "All", value: "all" },
                      { label: "Unpaid", value: "unpaid" },
                      { label: "Partial", value: "partial" },
                      { label: "Overdue", value: "overdue" },
                    ] as Array<{ label: string; value: RecoveryFilter }>).map((filter) => (
                      <Button key={filter.value} type="button" variant={recoveryFilter === filter.value ? "default" : "outline"} onClick={() => setRecoveryFilter(filter.value)}>
                        {filter.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-3 md:flex-row">
                  <Input
                    placeholder="Search by student, seat, plan, or payment status"
                    value={recoverySearch}
                    onChange={(event) => setRecoverySearch(event.target.value)}
                    className="md:max-w-sm"
                  />
                  <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                    {recoveryQueue.length} students visible • {formatInr(totalPendingCollection)} open • {formatInr(recoveryInsights.recoverableNow)} recoverable by calling the top batch now
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Seat / Plan</TableHead>
                        <TableHead>Total Fees</TableHead>
                        <TableHead>Paid</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>History</TableHead>
                        <TableHead className="text-right">Recover Now</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recoveryQueue.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                            No students match this recovery filter.
                          </TableCell>
                        </TableRow>
                      ) : (
                        recoveryQueue.map((summary) => (
                          <TableRow key={summary.studentId}>
                            <TableCell>
                              <p className="font-medium text-foreground">{summary.studentName}</p>
                              <p className="text-xs text-muted-foreground">{summary.recoveryUrgencyLabel}</p>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm font-medium text-foreground">{summary.seatNumber || "-"}</p>
                              <p className="text-xs text-muted-foreground">{summary.planName}</p>
                            </TableCell>
                            <TableCell className="font-semibold text-foreground">{formatInr(summary.totalFees)}</TableCell>
                            <TableCell className="text-emerald-700">{formatInr(summary.amountPaid)}</TableCell>
                            <TableCell>
                              <p className="font-semibold text-rose-700">{formatInr(summary.amountDue)}</p>
                              <p className="text-xs text-muted-foreground">
                                {summary.overdueDays > 0 ? `${summary.overdueDays} day(s) overdue` : summary.dueDate ? `Due ${format(new Date(`${summary.dueDate}T00:00:00`), "dd MMM yyyy")}` : "Due date not set"}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn(
                                summary.paymentStatus === "paid" && "border-emerald-200 bg-emerald-50 text-emerald-700",
                                summary.paymentStatus === "partial" && "border-amber-200 bg-amber-50 text-amber-700",
                                summary.paymentStatus === "unpaid" && "border-rose-200 bg-rose-50 text-rose-700",
                              )}>
                                {getPaymentStatusLabel(summary.paymentStatus)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm font-medium text-foreground">{summary.successfulPaymentCount} logged payment(s)</p>
                              <p className="text-xs text-muted-foreground">
                                {summary.lastPaymentDate ? `Last payment ${format(new Date(summary.lastPaymentDate), "dd MMM yyyy")}` : "No payment recorded"}
                              </p>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button size="sm" variant="secondary" disabled={startRecoveryCallsMutation.isPending || !hasCallablePhone(summary.phone)} onClick={() => startSingleAiRecovery(summary.studentId)}>
                                  <Bot className="mr-1 h-3.5 w-3.5" /> AI Call
                                </Button>
                                <Button size="sm" onClick={() => openPaymentDialogForStudent(summary.studentId, summary.amountDue)}>
                                  <Wallet className="mr-1 h-3.5 w-3.5" /> Collect
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => openPhoneRecovery(summary.studentId)}>
                                  <Phone className="mr-1 h-3.5 w-3.5" /> Call
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => openWhatsAppRecovery(summary.studentId)}>
                                  <MessageCircle className="mr-1 h-3.5 w-3.5" /> WhatsApp
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => openPayNowLink(summary.studentId)}>
                                  <TimerReset className="mr-1 h-3.5 w-3.5" /> Pay Link
                                </Button>
                                <Button size="sm" variant="ghost" disabled={summary.amountDue <= 0 || markStudentPaidMutation.isPending} onClick={() => markStudentPaidMutation.mutate({ amount: summary.amountDue, studentId: summary.studentId })}>
                                  Mark as Paid
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <FinanceSummaryCard icon={TrendingUp} title="Total Revenue" value={formatInr(totalRevenue)} detail={`${successfulPayments.length} successful payment(s) in this period`} tone="success" />
              <FinanceSummaryCard icon={Receipt} title="Total Expenses" value={formatInr(totalExpenses)} detail={`${data.expenses.length} manual expense entr${data.expenses.length === 1 ? "y" : "ies"}`} tone={totalExpenses > 0 ? "danger" : "neutral"} />
              <FinanceSummaryCard icon={Wallet} title="Net Profit" value={formatInr(netProfit)} detail={netProfit >= 0 ? "Revenue is ahead of spending." : "Expenses are higher than collections."} tone={netProfit >= 0 ? "success" : "warning"} />
              <FinanceSummaryCard icon={LineChart} title="Total Transactions" value={String(financeActivity.length)} detail={`${data.payments.length} payments and ${data.expenses.length} expenses`} tone="info" />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
              <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-card to-primary/5 shadow-lg shadow-primary/10">
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl font-display">Expected vs Actual Revenue</CardTitle>
                  <CardDescription>Know what should have come in, what was actually collected, and where the gap is forming.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-border/70 bg-card p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Expected Revenue</p>
                      <p className="mt-3 text-3xl font-bold font-display text-foreground">{formatInr(expectedRevenue)}</p>
                      <p className="mt-2 text-sm text-muted-foreground">Estimated from active seats and their plan pricing.</p>
                    </div>
                    <div className="rounded-2xl border border-success/20 bg-success/5 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Actual Revenue</p>
                      <p className="mt-3 text-3xl font-bold font-display text-success">{formatInr(totalRevenue)}</p>
                      <p className="mt-2 text-sm text-muted-foreground">Collected payments in the selected period.</p>
                    </div>
                    <div className="rounded-2xl border border-amber-300/40 bg-amber-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Collection Gap</p>
                      <p className="mt-3 text-3xl font-bold font-display text-foreground">{formatInr(collectionGap)}</p>
                      <p className="mt-2 text-sm text-muted-foreground">Revenue still missing from delayed or unpaid collections.</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-primary/20 bg-card/90 p-4">
                    <p className="text-sm font-semibold text-foreground">Expected: {formatInr(expectedRevenue)} | Collected: {formatInr(totalRevenue)}</p>
                    <p className="mt-2 text-sm text-muted-foreground">Gap: {formatInr(collectionGap)} from unpaid or late collections across the selected period.</p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Alert className={cn("border-destructive/25 bg-gradient-to-br from-destructive/10 via-card to-destructive/5", revenueLeakage === 0 && "border-success/20 from-success/10 to-card")}>
                  {revenueLeakage > 0 ? <TriangleAlert className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                  <AlertTitle>{revenueLeakage > 0 ? `You are losing approx ${formatInr(revenueLeakage)} in this period` : "No major revenue leakage detected"}</AlertTitle>
                  <AlertDescription>
                    {revenueLeakage > 0 ? `${formatInr(emptySeatOpportunity)} from empty seat capacity and ${formatInr(pendingPaymentsAmount)} tied up in pending payments.` : "Seat occupancy and pending collections look stable for the selected range."}
                  </AlertDescription>
                </Alert>

                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-display">Top Insights</CardTitle>
                    <CardDescription>Simple finance signals the owner can act on immediately.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {topInsights.map((insight) => (
                      <div key={insight.title} className="rounded-xl border border-border/70 bg-card p-4">
                        <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                        <p className="mt-2 text-sm text-muted-foreground">{insight.description}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.65fr_0.95fr]">
              <FinanceTrendChart data={trendPoints} title="Revenue vs Expense" subtitle="Dual-line finance trend with exact hover values and cleaner grouping for longer ranges." />
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg font-display">Expense Tracker</CardTitle>
                        <CardDescription>Manual operating expenses recorded inside the selected period.</CardDescription>
                      </div>
                      <Badge variant="outline" className="border-destructive/20 bg-destructive/5 text-destructive">{data.expenses.length} entries</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {data.expenses.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">No expenses added yet. Start tracking rent, salary, or utilities to see true profit.</div>
                    ) : (
                      <>
                        <div className="space-y-3">
                          {expenseBreakdown.filter((item) => item.amount > 0).map((item) => (
                            <div key={item.value} className="flex items-center justify-between rounded-xl border border-border/70 p-3">
                              <p className="text-sm font-medium text-foreground">{item.label}</p>
                              <p className="text-sm font-semibold text-foreground">{formatInr(item.amount)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Most recent expense</p>
                          <p className="mt-2 text-sm font-medium text-foreground">{getExpenseCategoryLabel(data.expenses[0]?.category || "other")} • {formatInr(Number(data.expenses[0]?.amount || 0))}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{data.expenses[0] ? format(parseDateOnly(data.expenses[0].date), "dd MMM yyyy") : "No expense date"}{data.expenses[0]?.notes ? ` • ${data.expenses[0].notes}` : ""}</p>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-display">Finance Snapshot</CardTitle>
                    <CardDescription>Quick business view in plain language.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="rounded-xl border border-border/70 p-4">
                      <p className="font-medium text-foreground">Active seats today</p>
                      <p className="mt-2 text-muted-foreground">{data.students.filter((student) => isStudentActiveOn(student, today)).length} active out of {data.library?.total_seats ?? 0} total seats</p>
                    </div>
                    <div className="rounded-xl border border-border/70 p-4">
                      <p className="font-medium text-foreground">Pending payment pressure</p>
                      <p className="mt-2 text-muted-foreground">{pendingPayments.length > 0 ? `${pendingPayments.length} payment(s) worth ${formatInr(pendingPaymentsAmount)} are still pending.` : "No pending payments in the selected period."}</p>
                    </div>
                    <div className="rounded-xl border border-border/70 p-4">
                      <p className="font-medium text-foreground">Collection trend</p>
                      <p className="mt-2 text-muted-foreground">{revenueChange.text}. {revenueChange.detail}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle className="text-lg font-display">Filtered Finance Activity</CardTitle>
                    <CardDescription>Revenue and expense entries for {selectedRange.label}.</CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit border-primary/20 bg-primary/5 text-primary">{financeActivity.length} entries</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Details</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status / Notes</TableHead>
                        <TableHead>Proof</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {financeActivity.length === 0 ? (
                        <TableRow>
                          <TableCell className="text-center text-muted-foreground" colSpan={7}>No payments or expenses found in this range.</TableCell>
                        </TableRow>
                      ) : (
                        financeActivity.map((row) => (
                          <TableRow key={`${row.type}-${row.id}`}>
                            <TableCell className="text-xs text-muted-foreground">{row.dateLabel}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn(row.type === "Revenue" ? "border-success/20 bg-success/10 text-success" : "border-destructive/20 bg-destructive/10 text-destructive")}>{row.type}</Badge>
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-foreground">{row.title}</p>
                              <p className="text-xs text-muted-foreground">{row.note}</p>
                            </TableCell>
                            <TableCell className="capitalize text-muted-foreground">{row.category}</TableCell>
                            <TableCell className={cn("font-semibold", row.type === "Revenue" ? "text-success" : "text-destructive")}>{row.type === "Revenue" ? "+" : "-"}{formatInr(row.amount)}</TableCell>
                            <TableCell>{row.type === "Revenue" ? getStatusBadge(row.status) : <span className="text-xs text-muted-foreground">{row.note}</span>}</TableCell>
                            <TableCell>
                              {row.proofAvailable && row.payment ? (
                                <Button variant="ghost" size="sm" onClick={() => openScreenshotPreview(row.payment)}>
                                  <ImageIcon className="mr-1 h-3.5 w-3.5" /> View
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle className="text-lg font-display">Pending Renewal Proof Verification</CardTitle>
                    <CardDescription>Keep screenshot-based renewals moving so expected revenue turns into actual revenue.</CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit border-warning/20 bg-warning/10 text-warning">{data.pendingRenewals.length} pending</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Seat</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Submitted</TableHead>
                        <TableHead>Screenshot</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.pendingRenewals.length === 0 ? (
                        <TableRow>
                          <TableCell className="text-center text-muted-foreground" colSpan={6}>No pending renewal screenshots right now.</TableCell>
                        </TableRow>
                      ) : (
                        data.pendingRenewals.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell>
                              <p className="font-medium text-foreground">{payment.student_name}</p>
                              <p className="text-xs text-muted-foreground">{payment.plan || "Membership"}</p>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{payment.student_seat_number || "-"}</TableCell>
                            <TableCell className="font-semibold text-foreground">{formatInr(payment.amount)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{format(new Date(payment.created_at), "dd MMM yyyy, hh:mm a")}</TableCell>
                            <TableCell>
                              <Button variant="outline" size="sm" onClick={() => openScreenshotPreview(payment)} disabled={!payment.payment_screenshot}>
                                <Eye className="mr-1 h-3.5 w-3.5" /> View
                              </Button>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" onClick={() => approvePaymentMutation.mutate(payment.id)} disabled={approvePaymentMutation.isPending}>
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display">{previewTitle || "Payment Screenshot"}</DialogTitle>
          </DialogHeader>
          {previewUrl ? (
            <img src={previewUrl} alt="Payment screenshot" className="w-full rounded-lg border border-border object-contain" />
          ) : (
            <p className="text-sm text-muted-foreground">Screenshot preview unavailable.</p>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default PaymentsPage;
