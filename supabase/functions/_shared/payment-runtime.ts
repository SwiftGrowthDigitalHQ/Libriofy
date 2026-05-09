const ACTIVE_PAYMENT_REUSE_WINDOW_MS = 30 * 60_000;

export type PaymentTraceContext = {
  correlationId: string | null;
  requestId: string | null;
  traceId: string | null;
};

export type ReusableSubscriptionPayment = {
  amount?: number | string | null;
  created_at?: string | null;
  currency?: string | null;
  id?: string | null;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown> | null;
  razorpay_order_id?: string | null;
  status?: string | null;
};

const normalizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const buildStableJson = (value: unknown): string => {
  if (value == null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => buildStableJson(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${buildStableJson(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

export const buildSubscriptionPaymentIdempotencyKey = ({
  couponCode,
  currentPlanCode,
  libraryId,
  months,
  planCode,
}: {
  couponCode?: string | null;
  currentPlanCode?: string | null;
  libraryId: string;
  months: number;
  planCode: string;
}) =>
  [
    normalizeText(libraryId).toLowerCase(),
    normalizeText(planCode).toLowerCase(),
    Math.max(1, Math.trunc(months || 1)),
    normalizeText(couponCode).toUpperCase() || "no_coupon",
    normalizeText(currentPlanCode).toLowerCase() || "no_current_plan",
  ].join(":");

export const readPaymentTraceHeaders = (headers: Headers): PaymentTraceContext => ({
  correlationId: normalizeText(headers.get("x-correlation-id")) || null,
  requestId: normalizeText(headers.get("x-request-id")) || null,
  traceId: normalizeText(headers.get("x-trace-id")) || null,
});

export const findReusableSubscriptionPayment = (
  rows: ReusableSubscriptionPayment[] | null | undefined,
  idempotencyKey: string,
  nowMs = Date.now(),
) => {
  const normalizedKey = normalizeText(idempotencyKey);
  if (!normalizedKey) {
    return null;
  }

  let newestReusableRow: ReusableSubscriptionPayment | null = null;
  let newestReusableCreatedAtMs = Number.NEGATIVE_INFINITY;

  for (const row of rows ?? []) {
    if (normalizeText(row.status).toLowerCase() !== "created") {
      continue;
    }

    const rowKey =
      normalizeText(row.idempotency_key) ||
      normalizeText((row.metadata as Record<string, unknown> | null | undefined)?.idempotency_key);
    if (rowKey !== normalizedKey) {
      continue;
    }

    const createdAtMs = row.created_at ? Date.parse(row.created_at) : Number.NaN;
    if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs > ACTIVE_PAYMENT_REUSE_WINDOW_MS) {
      continue;
    }

    const orderId = normalizeText(row.razorpay_order_id);
    if (!orderId) {
      continue;
    }

    if (createdAtMs > newestReusableCreatedAtMs) {
      newestReusableCreatedAtMs = createdAtMs;
      newestReusableRow = row;
    }
  }

  return newestReusableRow;
};

export const mergePaymentTraceMetadata = (
  metadata: Record<string, unknown>,
  trace: PaymentTraceContext,
) => ({
  ...metadata,
  correlation_id: trace.correlationId,
  request_id: trace.requestId,
  trace_id: trace.traceId,
});

export const buildPaymentObservabilityFingerprint = (value: unknown) => buildStableJson(value);
