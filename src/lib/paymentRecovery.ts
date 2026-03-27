import { addDays, differenceInCalendarDays, format, startOfDay } from "date-fns";

import { buildUpiPaymentLink, isSuccessfulPaymentStatus } from "@/lib/payments";

type NullableString = string | null | undefined;

export type PaymentRecoveryStudent = {
  expiry_date?: NullableString;
  full_name: string;
  id: string;
  phone?: NullableString;
  plan?: NullableString;
  plan_id?: NullableString;
  seat_id?: NullableString;
  seat_number?: NullableString;
  slot?: NullableString;
  start_date: string;
  status?: NullableString;
};

export type PaymentRecoveryPayment = {
  amount: number | string | null;
  created_at: string;
  id: string;
  payment_method?: NullableString;
  period_end?: NullableString;
  period_start?: NullableString;
  plan?: NullableString;
  source?: NullableString;
  status?: NullableString;
  student_id: string;
};

export type PaymentHistoryItem = {
  amount: number;
  createdAt: string;
  id: string;
  isSuccessful: boolean;
  method: string | null;
  periodEnd: string | null;
  periodStart: string | null;
  source: string | null;
  status: string;
};

export type PaymentStatus = "paid" | "partial" | "unpaid";

export type RecoveryStage =
  | "none"
  | "day_0_whatsapp"
  | "day_2_followup"
  | "day_5_call"
  | "day_7_cancel_warning";

export type PlanPriceLookup = {
  averagePrice: number;
  byId: Map<string, number>;
  byName: Map<string, number>;
  nameById: Map<string, string>;
};

export type PaymentSummary = {
  amountDue: number;
  amountPaid: number;
  dueDate: string | null;
  hasPaymentHistory: boolean;
  history: PaymentHistoryItem[];
  lastPaymentDate: string | null;
  overdueDays: number;
  payNowLink: string | null;
  payNowMessage: string;
  paymentStatus: PaymentStatus;
  pendingEntries: number;
  planName: string;
  phone: string | null;
  recoveryStage: RecoveryStage;
  recoveryUrgencyLabel: string;
  slotLabel: string;
  studentId: string;
  studentName: string;
  seatNumber: string | null;
  successfulPaymentCount: number;
  totalFees: number;
};

const normalizeText = (value: NullableString) => (value || "").trim().toLowerCase().replace(/\s+/g, " ");

const parseDateOnly = (value: string) => new Date(`${value}T00:00:00`);

export const formatInr = (amount: number) => `\u20b9${Math.round(amount).toLocaleString("en-IN")}`;

export const getDefaultPaymentDueDate = (startDate?: NullableString) => {
  const baseDate = startDate ? parseDateOnly(startDate) : startOfDay(new Date());
  return format(baseDate, "yyyy-MM-dd");
};

export const getDefaultPaymentPeriodEnd = (startDate?: NullableString) => {
  const baseDate = startDate ? parseDateOnly(startDate) : startOfDay(new Date());
  return format(addDays(baseDate, 30), "yyyy-MM-dd");
};

export const createPlanPriceLookup = (
  plans: Array<{ id: string; name: string; price: number | string | null }>,
): PlanPriceLookup => {
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  const nameById = new Map<string, string>();
  const allPrices: number[] = [];

  for (const plan of plans) {
    const price = Number(plan.price || 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    byId.set(plan.id, price);
    byName.set(normalizeText(plan.name), price);
    nameById.set(plan.id, plan.name);
    allPrices.push(price);
  }

  return {
    averagePrice: allPrices.length > 0 ? allPrices.reduce((sum, price) => sum + price, 0) / allPrices.length : 0,
    byId,
    byName,
    nameById,
  };
};

export const getStudentPlanPrice = (
  student: Pick<PaymentRecoveryStudent, "plan" | "plan_id">,
  planLookup: PlanPriceLookup,
) => {
  if (student.plan_id && planLookup.byId.has(student.plan_id)) {
    return planLookup.byId.get(student.plan_id) || 0;
  }

  const byName = planLookup.byName.get(normalizeText(student.plan));
  if (typeof byName === "number") return byName;
  return planLookup.averagePrice;
};

export const getStudentPlanName = (
  student: Pick<PaymentRecoveryStudent, "plan" | "plan_id">,
  planLookup: PlanPriceLookup,
) => {
  if (student.plan_id && planLookup.nameById.has(student.plan_id)) {
    return planLookup.nameById.get(student.plan_id) || student.plan || "Plan";
  }

  return student.plan || "Plan";
};

export const getRecoveryStage = (overdueDays: number, amountDue: number): RecoveryStage => {
  if (amountDue <= 0) return "none";
  if (overdueDays >= 7) return "day_7_cancel_warning";
  if (overdueDays >= 5) return "day_5_call";
  if (overdueDays >= 2) return "day_2_followup";
  return "day_0_whatsapp";
};

export const getRecoveryUrgencyLabel = (stage: RecoveryStage) => {
  if (stage === "day_7_cancel_warning") return "Seat cancellation warning";
  if (stage === "day_5_call") return "Call alert";
  if (stage === "day_2_followup") return "Follow-up reminder";
  if (stage === "day_0_whatsapp") return "WhatsApp reminder";
  return "Paid";
};

export const getPaymentStatusLabel = (status: PaymentStatus) => {
  if (status === "paid") return "Paid";
  if (status === "partial") return "Partial";
  return "Unpaid";
};

export const groupPaymentsByStudent = <TPayment extends Pick<PaymentRecoveryPayment, "student_id">>(payments: TPayment[]) => {
  const paymentsByStudent = new Map<string, TPayment[]>();
  for (const payment of payments) {
    const current = paymentsByStudent.get(payment.student_id) ?? [];
    current.push(payment);
    paymentsByStudent.set(payment.student_id, current);
  }
  return paymentsByStudent;
};

export const derivePaymentSummary = ({
  libraryName,
  slotLabel,
  student,
  studentPayments,
  today = new Date(),
  upiId,
  planLookup,
}: {
  libraryName?: string | null;
  planLookup: PlanPriceLookup;
  slotLabel?: string | null;
  student: PaymentRecoveryStudent;
  studentPayments: PaymentRecoveryPayment[];
  today?: Date;
  upiId?: string | null;
}) : PaymentSummary => {
  const history = [...studentPayments]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .map((payment) => ({
      amount: Math.round(Number(payment.amount || 0)),
      createdAt: payment.created_at,
      id: payment.id,
      isSuccessful: isSuccessfulPaymentStatus(payment.status),
      method: payment.payment_method || null,
      periodEnd: payment.period_end || null,
      periodStart: payment.period_start || null,
      source: payment.source || null,
      status: payment.status || "pending",
    }));

  const successfulHistory = history.filter((payment) => payment.isSuccessful);
  const pendingEntries = history.filter((payment) => !payment.isSuccessful).length;
  const totalFees = Math.round(Math.max(getStudentPlanPrice(student, planLookup), 0));
  const amountPaid = Math.round(
    successfulHistory.reduce((sum, payment) => sum + Math.max(payment.amount, 0), 0),
  );
  const amountDue = Math.max(totalFees - amountPaid, 0);
  const paymentStatus: PaymentStatus =
    amountDue <= 0 && totalFees > 0 ? "paid" : amountPaid > 0 ? "partial" : "unpaid";
  const lastPaymentDate = successfulHistory[0]?.createdAt ?? null;
  const dueDate =
    history.find((payment) => payment.periodEnd)?.periodEnd ||
    student.expiry_date ||
    student.start_date ||
    null;
  const overdueDays =
    amountDue > 0 && dueDate
      ? Math.max(differenceInCalendarDays(startOfDay(today), startOfDay(parseDateOnly(dueDate))), 0)
      : 0;
  const recoveryStage = getRecoveryStage(overdueDays, amountDue);
  const recoveryUrgencyLabel = getRecoveryUrgencyLabel(recoveryStage);
  const payNowLink =
    upiId && amountDue > 0
      ? buildUpiPaymentLink({
          amount: amountDue,
          libraryName: libraryName || "Library Payment",
          upiId,
        })
      : null;
  const payNowMessage =
    amountDue > 0
      ? `Hi ${student.full_name}, your ${formatInr(amountDue)} library fee is pending${payNowLink ? `. Pay now: ${payNowLink}` : "."}`
      : `${student.full_name} has no pending fee right now.`;

  return {
    amountDue,
    amountPaid,
    dueDate,
    hasPaymentHistory: history.length > 0,
    history,
    lastPaymentDate,
    overdueDays,
    payNowLink,
    payNowMessage,
    paymentStatus,
    pendingEntries,
    planName: getStudentPlanName(student, planLookup),
    phone: student.phone || null,
    recoveryStage,
    recoveryUrgencyLabel,
    seatNumber: student.seat_number || null,
    slotLabel: slotLabel || student.slot || "",
    studentId: student.id,
    studentName: student.full_name,
    successfulPaymentCount: successfulHistory.length,
    totalFees,
  };
};

export const comparePaymentSummaryRisk = (left: PaymentSummary, right: PaymentSummary) => {
  if (right.amountDue !== left.amountDue) return right.amountDue - left.amountDue;
  if (right.overdueDays !== left.overdueDays) return right.overdueDays - left.overdueDays;
  return left.studentName.localeCompare(right.studentName);
};

export const buildPaymentInsights = (summaries: PaymentSummary[]) => {
  const unpaidSummaries = summaries.filter((summary) => summary.amountDue > 0).sort(comparePaymentSummaryRisk);
  const highestRecoveryBatch = unpaidSummaries.slice(0, 5);
  const recoverableNow = highestRecoveryBatch.reduce((sum, summary) => sum + summary.amountDue, 0);
  const latePayers = unpaidSummaries.filter((summary) => summary.overdueDays >= 5);
  const slotTotals = new Map<string, { amount: number; count: number }>();

  for (const summary of unpaidSummaries) {
    const key = summary.slotLabel || "Unassigned slot";
    const current = slotTotals.get(key) ?? { amount: 0, count: 0 };
    current.amount += summary.amountDue;
    current.count += 1;
    slotTotals.set(key, current);
  }

  const topSlot = Array.from(slotTotals.entries()).sort((left, right) => right[1].amount - left[1].amount)[0] ?? null;

  return {
    latePayers,
    recoverableNow,
    topRecoveryBatch: highestRecoveryBatch,
    topSlot,
    unpaidSummaries,
  };
};
