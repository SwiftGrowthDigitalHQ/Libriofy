import { readPaymentTraceHeaders } from "./payment-runtime.ts";

export type BillingProvider = "razorpay" | "stripe";

export type BillingTraceContext = {
  correlationId: string;
  requestId: string;
  traceId: string;
};

export type BillingEnvValidationResult = {
  checks: Array<{
    detail: string;
    key: string;
    status: "invalid" | "missing" | "ok";
  }>;
  missing: string[];
  ok: boolean;
};

export type BillingProviderStatus = {
  activeProvider: BillingProvider;
  providers: Record<BillingProvider, {
    configured: boolean;
    missing: string[];
  }>;
};

export type BillingFunctionErrorPayload = {
  code: string;
  detail?: string | null;
  diagnostics?: Record<string, unknown> | null;
  hint?: string | null;
  layer: string;
  message: string;
  requestId: string;
  retryable?: boolean;
  status: number;
};

export class BillingFunctionError extends Error {
  readonly payload: BillingFunctionErrorPayload;

  constructor(payload: BillingFunctionErrorPayload) {
    super(payload.message);
    this.name = "BillingFunctionError";
    this.payload = payload;
  }
}

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const hasValue = (value: unknown) => trimText(value).length > 0;

const looksLikePlaceholder = (value: string) => {
  const normalized = trimText(value).toLowerCase();
  return (
    !normalized ||
    normalized.includes("your_") ||
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized === "changeme"
  );
};

const pushEnvCheck = (
  result: BillingEnvValidationResult,
  input: {
    detail?: string;
    key: string;
    value: string | undefined;
  },
) => {
  const normalized = trimText(input.value);
  const status = !normalized ? "missing" : looksLikePlaceholder(normalized) ? "invalid" : "ok";

  result.checks.push({
    detail:
      input.detail ??
      (status === "ok"
        ? `${input.key} is configured.`
        : status === "missing"
          ? `${input.key} is missing.`
          : `${input.key} still has a placeholder value.`),
    key: input.key,
    status,
  });

  if (status !== "ok" && !result.missing.includes(input.key)) {
    result.missing.push(input.key);
  }
};

export const resolveBillingTraceContext = (headers: Headers): BillingTraceContext => {
  const trace = readPaymentTraceHeaders(headers);

  return {
    correlationId: trace.correlationId ?? crypto.randomUUID(),
    requestId: trace.requestId ?? crypto.randomUUID(),
    traceId: trace.traceId ?? crypto.randomUUID(),
  };
};

export const validateBillingRuntimeEnv = (
  env: Record<string, string | undefined>,
  options?: {
    provider?: BillingProvider | null;
    requireWebhookSecret?: boolean;
  },
): BillingEnvValidationResult => {
  const result: BillingEnvValidationResult = {
    checks: [],
    missing: [],
    ok: true,
  };

  pushEnvCheck(result, {
    detail: "SUPABASE_URL is required for billing edge functions.",
    key: "SUPABASE_URL",
    value: env.SUPABASE_URL,
  });
  pushEnvCheck(result, {
    detail: "SUPABASE_SERVICE_ROLE_KEY is required for billing edge functions.",
    key: "SUPABASE_SERVICE_ROLE_KEY",
    value: env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (options?.provider === "razorpay") {
    pushEnvCheck(result, {
      detail: "RAZORPAY_KEY_ID is required for Razorpay checkout.",
      key: "RAZORPAY_KEY_ID",
      value: env.RAZORPAY_KEY_ID,
    });
    pushEnvCheck(result, {
      detail: "RAZORPAY_KEY_SECRET is required for Razorpay order creation and verification.",
      key: "RAZORPAY_KEY_SECRET",
      value: env.RAZORPAY_KEY_SECRET,
    });

    if (options.requireWebhookSecret) {
      pushEnvCheck(result, {
        detail: "RAZORPAY_WEBHOOK_SECRET is required for webhook verification.",
        key: "RAZORPAY_WEBHOOK_SECRET",
        value: env.RAZORPAY_WEBHOOK_SECRET,
      });
    }
  }

  if (options?.provider === "stripe") {
    pushEnvCheck(result, {
      detail: "STRIPE_SECRET_KEY is required when Stripe billing is enabled.",
      key: "STRIPE_SECRET_KEY",
      value: env.STRIPE_SECRET_KEY,
    });

    if (options.requireWebhookSecret) {
      pushEnvCheck(result, {
        detail: "STRIPE_WEBHOOK_SECRET is required when Stripe webhooks are enabled.",
        key: "STRIPE_WEBHOOK_SECRET",
        value: env.STRIPE_WEBHOOK_SECRET,
      });
    }
  }

  result.ok = result.missing.length === 0;
  return result;
};

export const resolveBillingProviderStatus = (
  env: Record<string, string | undefined>,
): BillingProviderStatus => {
  const configuredProvider = trimText(env.BILLING_PROVIDER).toLowerCase();
  const activeProvider: BillingProvider = configuredProvider === "stripe" ? "stripe" : "razorpay";
  const razorpayValidation = validateBillingRuntimeEnv(env, {
    provider: "razorpay",
    requireWebhookSecret: true,
  });
  const stripeValidation = validateBillingRuntimeEnv(env, {
    provider: "stripe",
    requireWebhookSecret: true,
  });

  return {
    activeProvider,
    providers: {
      razorpay: {
        configured: razorpayValidation.ok,
        missing: razorpayValidation.missing,
      },
      stripe: {
        configured: stripeValidation.ok,
        missing: stripeValidation.missing,
      },
    },
  };
};

export const serializeSupabaseError = (error: unknown) => {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : null;

  return {
    code: typeof record?.code === "string" ? record.code : null,
    details: record?.details ?? null,
    error: record?.error ?? null,
    hint: record?.hint ?? null,
    message:
      typeof record?.message === "string"
        ? record.message
        : error instanceof Error
          ? error.message
          : String(error ?? ""),
    name:
      typeof record?.name === "string"
        ? record.name
        : error instanceof Error
          ? error.name
          : null,
    status:
      typeof record?.status === "number"
        ? record.status
        : typeof record?.statusCode === "number"
          ? record.statusCode
          : null,
  };
};

export const logBillingFunctionEvent = (
  level: "error" | "info" | "warn",
  stage: string,
  payload: Record<string, unknown>,
) => {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger(`[billing] ${stage}`, payload);
};

export const createBillingFunctionError = (payload: Omit<BillingFunctionErrorPayload, "requestId"> & { requestId?: string }) =>
  new BillingFunctionError({
    ...payload,
    requestId: payload.requestId ?? crypto.randomUUID(),
  });

export const isBillingFunctionError = (error: unknown): error is BillingFunctionError =>
  error instanceof BillingFunctionError;

export const createSupabaseOperationError = (payload: {
  diagnostics?: Record<string, unknown> | null;
  error: unknown;
  hint?: string | null;
  layer: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
  status?: number;
}) => {
  const serialized = serializeSupabaseError(payload.error);
  const status =
    payload.status ??
    (typeof serialized.status === "number" && serialized.status >= 400 ? serialized.status : 500);

  return createBillingFunctionError({
    code: serialized.code ?? "SUPABASE_ERROR",
    detail: serialized.message || payload.message,
    diagnostics: {
      ...(payload.diagnostics ?? {}),
      supabaseError: serialized,
    },
    hint: payload.hint ?? null,
    layer: payload.layer,
    message: payload.message,
    requestId: payload.requestId,
    retryable: payload.retryable ?? status >= 500,
    status,
  });
};

export const buildBillingErrorBody = (payload: BillingFunctionErrorPayload) => ({
  code: payload.code,
  detail: payload.detail ?? null,
  diagnostics: payload.diagnostics ?? null,
  error: payload.message,
  hint: payload.hint ?? null,
  layer: payload.layer,
  message: payload.message,
  requestId: payload.requestId,
  retryable: Boolean(payload.retryable),
  success: false,
});

export const readJsonRequestBody = async <T>(req: Request, payload: {
  diagnostics?: Record<string, unknown>;
  layer: string;
  message?: string;
  requestId: string;
}) => {
  try {
    return (await req.json()) as T;
  } catch (error) {
    throw createBillingFunctionError({
      code: "INVALID_JSON",
      detail: error instanceof Error ? error.message : "The request body could not be parsed as JSON.",
      diagnostics: payload.diagnostics ?? null,
      hint: "Send a valid JSON request body.",
      layer: payload.layer,
      message: payload.message ?? "Invalid billing request payload.",
      requestId: payload.requestId,
      retryable: false,
      status: 400,
    });
  }
};

export const normalizePlanCode = (value: unknown) => trimText(value).toLowerCase();

export const normalizeCouponCode = (value: unknown) => trimText(value).toUpperCase();

export const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
};

export const safeNumber = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const exceedsPlanLimit = (currentUsage: number, planLimit: number | null | undefined) =>
  typeof planLimit === "number" && planLimit > 0 && currentUsage > planLimit;

export const buildCapacityLimitError = ({
  currentLockers,
  currentSeats,
  plan,
}: {
  currentLockers: number;
  currentSeats: number;
  plan: {
    lockers_limit: number | null;
    name: string;
    seats_limit: number | null;
  };
}) => {
  const messages: string[] = [];

  if (exceedsPlanLimit(currentSeats, plan.seats_limit)) {
    messages.push(`${currentSeats} configured seats exceed the ${plan.seats_limit} seat limit`);
  }

  if (exceedsPlanLimit(currentLockers, plan.lockers_limit)) {
    messages.push(`${currentLockers} configured lockers exceed the ${plan.lockers_limit} locker limit`);
  }

  if (messages.length === 0) return null;
  return `Reduce capacity before switching to ${plan.name}: ${messages.join(" and ")}.`;
};

export const computeCouponDiscount = (
  subtotal: number,
  coupon: {
    discount_type: "flat" | "percentage";
    discount_value: number | string;
  },
) => {
  if (subtotal <= 0) return 0;
  if (coupon.discount_type === "percentage") {
    const pct = Math.max(0, Math.min(100, safeNumber(coupon.discount_value, 0)));
    return Math.floor((subtotal * pct) / 100);
  }

  const flat = Math.max(0, safeNumber(coupon.discount_value, 0));
  return Math.min(Math.floor(flat), Math.max(0, subtotal - 1));
};
