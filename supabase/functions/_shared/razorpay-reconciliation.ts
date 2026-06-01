export const RECONCILIATION_SCAN_AFTER_MINUTES = 5;
export const RECONCILIATION_STALE_AFTER_MINUTES = 10;

export type RazorpayPayment = {
  amount?: number;
  captured?: boolean;
  created_at?: number;
  currency?: string;
  id?: string;
  order_id?: string;
  status?: string;
};

export type RazorpayOrder = {
  amount?: number;
  currency?: string;
  id?: string;
  status?: string;
};

export type RazorpayOrderPaymentsResponse = {
  count?: number;
  entity?: string;
  items?: RazorpayPayment[];
};

export type PendingSubscriptionPaymentRow = {
  created_at: string;
  id: string;
  library_id: string;
  metadata?: Record<string, unknown> | null;
  months_purchased?: number | null;
  razorpay_order_id?: string | null;
  status: string;
  subscription_id: string;
};

export type PendingPaymentReconciliationDecision =
  | {
      action: "alert";
      ageMinutes: number;
      capturedPayment: null;
      stale: boolean;
    }
  | {
      action: "capture";
      ageMinutes: number;
      capturedPayment: RazorpayPayment;
      stale: boolean;
    }
  | {
      action: "skip";
      ageMinutes: number | null;
      capturedPayment: null;
      stale: boolean;
    };

const normalizeText = (value: unknown) => String(value ?? "").trim();

export const getCapturedPayment = (payments: RazorpayOrderPaymentsResponse | null | undefined) => {
  const captured = (payments?.items ?? [])
    .filter((payment) => String(payment.status ?? "").toLowerCase() === "captured" || payment.captured === true)
    .sort((left, right) => Number(right.created_at ?? 0) - Number(left.created_at ?? 0));

  return captured[0] ?? null;
};

export const getPendingPaymentAgeMinutes = (createdAt: string, nowMs = Date.now()) => {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return Number.NaN;
  }

  return Math.max(0, Math.floor((nowMs - createdAtMs) / 60_000));
};

export const isPendingPaymentOlderThan = (
  createdAt: string,
  thresholdMinutes: number,
  nowMs = Date.now(),
) => {
  const ageMinutes = getPendingPaymentAgeMinutes(createdAt, nowMs);
  return Number.isFinite(ageMinutes) && ageMinutes >= thresholdMinutes;
};

export const selectPendingPaymentsForReconciliation = (
  rows: PendingSubscriptionPaymentRow[] | null | undefined,
  nowMs = Date.now(),
  thresholdMinutes = RECONCILIATION_SCAN_AFTER_MINUTES,
) =>
  (rows ?? [])
    .filter((row) => {
      if (normalizeText(row.status).toLowerCase() !== "pending") {
        return false;
      }

      if (!normalizeText(row.razorpay_order_id)) {
        return false;
      }

      return isPendingPaymentOlderThan(row.created_at, thresholdMinutes, nowMs);
    })
    .sort((left, right) => left.created_at.localeCompare(right.created_at));

export const evaluatePendingPaymentReconciliation = (
  row: PendingSubscriptionPaymentRow,
  payments: RazorpayOrderPaymentsResponse | null | undefined,
  nowMs = Date.now(),
): PendingPaymentReconciliationDecision => {
  if (normalizeText(row.status).toLowerCase() !== "pending") {
    return {
      action: "skip",
      ageMinutes: null,
      capturedPayment: null,
      stale: false,
    };
  }

  const ageMinutes = getPendingPaymentAgeMinutes(row.created_at, nowMs);
  if (!Number.isFinite(ageMinutes) || ageMinutes < RECONCILIATION_SCAN_AFTER_MINUTES) {
    return {
      action: "skip",
      ageMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
      capturedPayment: null,
      stale: false,
    };
  }

  const capturedPayment = getCapturedPayment(payments);
  if (capturedPayment) {
    return {
      action: "capture",
      ageMinutes,
      capturedPayment,
      stale: ageMinutes >= RECONCILIATION_STALE_AFTER_MINUTES,
    };
  }

  return {
    action: "alert",
    ageMinutes,
    capturedPayment: null,
    stale: ageMinutes >= RECONCILIATION_STALE_AFTER_MINUTES,
  };
};
