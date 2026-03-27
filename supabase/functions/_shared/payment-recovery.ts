export type RecoveryStudentRow = {
  expiry_date: string | null;
  full_name: string;
  id: string;
  phone: string | null;
  plan: string | null;
  plan_id: string | null;
  seat_number: string | null;
  slot: string | null;
  start_date: string;
  status: string | null;
};

export type RecoveryPlanRow = {
  id: string;
  name: string;
  price: number | string | null;
};

export type RecoveryPaymentRow = {
  amount: number | string | null;
  created_at: string;
  id: string;
  payment_method: string | null;
  period_end: string | null;
  period_start: string | null;
  plan: string | null;
  status: string | null;
  student_id: string;
};

export type PaymentRecoveryStatus = "paid" | "partial" | "unpaid";

export type RecoveryCandidate = {
  amountDue: number;
  amountPaid: number;
  dueDate: string | null;
  fullName: string;
  overdueDays: number;
  paymentStatus: PaymentRecoveryStatus;
  phone: string | null;
  planName: string;
  recoveryUrgencyLabel: string;
  seatNumber: string | null;
  slotLabel: string;
  studentId: string;
  totalFees: number;
};

type PlanPriceLookup = {
  averagePrice: number;
  byId: Map<string, number>;
  byName: Map<string, number>;
  nameById: Map<string, string>;
};

const SUCCESSFUL_PAYMENT_STATUSES = new Set(["approved", "completed", "captured", "paid", "success"]);

const normalizeText = (value: string | null | undefined) => (value || "").trim().toLowerCase().replace(/\s+/g, " ");

const parseDateOnly = (value: string) => new Date(`${value}T00:00:00`);

const roundCurrency = (amount: number) => Math.round(Math.max(amount, 0));

export const formatInr = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;

export const normalizePhone = (raw: string | null | undefined, defaultCountryCode = "+91") => {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `${defaultCountryCode}${digits}`;
  }

  return `+${digits}`;
};

const isSuccessfulPaymentStatus = (status: string | null | undefined) =>
  SUCCESSFUL_PAYMENT_STATUSES.has((status || "").toLowerCase());

const buildPlanPriceLookup = (plans: RecoveryPlanRow[]): PlanPriceLookup => {
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  const nameById = new Map<string, string>();
  const prices: number[] = [];

  for (const plan of plans) {
    const price = Number(plan.price || 0);
    if (!Number.isFinite(price) || price <= 0) continue;

    byId.set(plan.id, price);
    byName.set(normalizeText(plan.name), price);
    nameById.set(plan.id, plan.name);
    prices.push(price);
  }

  return {
    averagePrice: prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0,
    byId,
    byName,
    nameById,
  };
};

const getStudentPlanPrice = (student: Pick<RecoveryStudentRow, "plan" | "plan_id">, planLookup: PlanPriceLookup) => {
  if (student.plan_id && planLookup.byId.has(student.plan_id)) {
    return planLookup.byId.get(student.plan_id) || 0;
  }

  const namedPrice = planLookup.byName.get(normalizeText(student.plan));
  if (typeof namedPrice === "number") return namedPrice;
  return planLookup.averagePrice;
};

const getStudentPlanName = (student: Pick<RecoveryStudentRow, "plan" | "plan_id">, planLookup: PlanPriceLookup) => {
  if (student.plan_id && planLookup.nameById.has(student.plan_id)) {
    return planLookup.nameById.get(student.plan_id) || student.plan || "Plan";
  }

  return student.plan || "Plan";
};

const getRecoveryUrgencyLabel = (overdueDays: number, amountDue: number) => {
  if (amountDue <= 0) return "Paid";
  if (overdueDays >= 7) return "Seat cancellation warning";
  if (overdueDays >= 5) return "Call alert";
  if (overdueDays >= 2) return "Follow-up reminder";
  return "WhatsApp reminder";
};

export const groupPaymentsByStudent = <TPayment extends Pick<RecoveryPaymentRow, "student_id">>(payments: TPayment[]) => {
  const paymentsByStudent = new Map<string, TPayment[]>();

  for (const payment of payments) {
    const current = paymentsByStudent.get(payment.student_id) ?? [];
    current.push(payment);
    paymentsByStudent.set(payment.student_id, current);
  }

  return paymentsByStudent;
};

export const deriveRecoveryCandidates = ({
  plans,
  students,
  studentPayments,
  today = new Date(),
}: {
  plans: RecoveryPlanRow[];
  studentPayments: Map<string, RecoveryPaymentRow[]>;
  students: RecoveryStudentRow[];
  today?: Date;
}) => {
  const planLookup = buildPlanPriceLookup(plans);

  return students
    .filter((student) => (student.status || "").toLowerCase() === "active")
    .map<RecoveryCandidate>((student) => {
      const payments = [...(studentPayments.get(student.id) ?? [])].sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      );
      const successfulPayments = payments.filter((payment) => isSuccessfulPaymentStatus(payment.status));
      const totalFees = roundCurrency(getStudentPlanPrice(student, planLookup));
      const amountPaid = roundCurrency(
        successfulPayments.reduce((sum, payment) => sum + Math.max(Number(payment.amount || 0), 0), 0),
      );
      const amountDue = Math.max(totalFees - amountPaid, 0);
      const dueDate =
        payments.find((payment) => payment.period_end)?.period_end || student.expiry_date || student.start_date || null;
      const overdueDays =
        amountDue > 0 && dueDate
          ? Math.max(
              Math.floor(
                (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
                  Date.UTC(
                    parseDateOnly(dueDate).getFullYear(),
                    parseDateOnly(dueDate).getMonth(),
                    parseDateOnly(dueDate).getDate(),
                  )) /
                  86400000,
              ),
              0,
            )
          : 0;
      const paymentStatus: PaymentRecoveryStatus =
        amountDue <= 0 && totalFees > 0 ? "paid" : amountPaid > 0 ? "partial" : "unpaid";

      return {
        amountDue,
        amountPaid,
        dueDate,
        fullName: student.full_name,
        overdueDays,
        paymentStatus,
        phone: student.phone || null,
        planName: getStudentPlanName(student, planLookup),
        recoveryUrgencyLabel: getRecoveryUrgencyLabel(overdueDays, amountDue),
        seatNumber: student.seat_number || null,
        slotLabel: student.slot || "",
        studentId: student.id,
        totalFees,
      };
    })
    .filter((candidate) => candidate.amountDue > 0)
    .sort((left, right) => {
      if (right.amountDue !== left.amountDue) return right.amountDue - left.amountDue;
      if (right.overdueDays !== left.overdueDays) return right.overdueDays - left.overdueDays;
      return left.fullName.localeCompare(right.fullName);
    });
};

export const buildRecoveryScript = ({
  amountDue,
  libraryName,
  studentName,
}: {
  amountDue: number;
  libraryName: string;
  studentName: string;
}) =>
  `Hello ${studentName}, this is from ${libraryName}. Your ${formatInr(amountDue)} fee is pending. Please pay today to avoid late charges.`;
