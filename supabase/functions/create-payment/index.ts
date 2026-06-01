import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { logEdgeEvent, sendEdgeAdminAlert } from "../_shared/observability.ts";
import {
  buildSubscriptionPaymentIdempotencyKey,
  findReusableSubscriptionPayment,
  mergePaymentTraceMetadata,
  type ReusableSubscriptionPayment,
} from "../_shared/payment-runtime.ts";
import {
  buildBillingErrorBody,
  buildCapacityLimitError,
  clampInt,
  computeCouponDiscount,
  createBillingFunctionError,
  createSupabaseOperationError,
  isBillingFunctionError,
  logBillingFunctionEvent,
  normalizeCouponCode,
  normalizePlanCode,
  readJsonRequestBody,
  resolveBillingTraceContext,
  safeNumber,
  serializeSupabaseError,
  validateBillingRuntimeEnv,
} from "../_shared/billing-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-correlation-id, x-trace-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type SubscriptionPlanRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number | string;
  seats_limit: number | null;
  lockers_limit: number | null;
  features: unknown;
  is_active: boolean;
};

type CouponRow = {
  id: string;
  code: string;
  discount_type: "percentage" | "flat";
  discount_value: number | string;
  expires_at: string | null;
  max_uses: number | null;
  is_active: boolean;
};

type UserRoleRow = { role: string; library_id: string | null };
type LibraryCapacityRow = {
  total_seats: number | null;
  total_lockers: number | null;
};
type LibrarySubscriptionRow = {
  id: string;
  plan_name: string | null;
};

const REFERRAL_SIGNUP_DISCOUNT_PERCENT = 10;
const REFERRAL_SIGNUP_DISCOUNT_MAX = 1000;

const listOwnedLibraryIds = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
  requestId: string,
) => {
  const { data, error } = await supabase
    .from("libraries")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw createSupabaseOperationError({
      diagnostics: {
        requestId,
        userId,
      },
      error,
      hint: "Confirm the libraries table is readable in the active Supabase project.",
      layer: "db.libraries.lookup_owned",
      message: "Failed to resolve library ownership for payment creation.",
      requestId,
    });
  }

  return (data ?? []).map((library) => String(library.id));
};

const resolveLibraryId = (
  roles: UserRoleRow[],
  libraryIdInput: string,
  ownedLibraryIds: string[],
) => {
  if (libraryIdInput) return libraryIdInput;

  const ownedLibraryId = ownedLibraryIds[0] ?? "";
  if (ownedLibraryId) return ownedLibraryId;

  const ownerRoleLibraryId = roles.find((row) => row.role === "library_owner" && row.library_id)?.library_id ?? null;
  if (ownerRoleLibraryId) return String(ownerRoleLibraryId);

  const staffRoleLibraryId = roles.find((row) => row.role === "staff" && row.library_id)?.library_id ?? null;
  if (staffRoleLibraryId) return String(staffRoleLibraryId);

  return "";
};

const ensureLibrarySubscription = async (
  supabase: ReturnType<typeof createClient>,
  libraryId: string,
  userId: string,
  requestId: string,
) => {
  const { error: ensureError } = await supabase.rpc("ensure_library_subscription", {
    p_actor_user_id: userId,
    p_library_id: libraryId,
  });
  if (ensureError) {
    throw createSupabaseOperationError({
      diagnostics: {
        libraryId,
        requestId,
        userId,
      },
      error: ensureError,
      hint: "Apply the latest billing migration so ensure_library_subscription is available and executable.",
      layer: "db.rpc.ensure_library_subscription",
      message: "The billing runtime could not guarantee a subscription row for this library.",
      requestId,
    });
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("library_subscriptions")
    .select("id, plan_name")
    .eq("library_id", libraryId)
    .maybeSingle();
  if (subscriptionError) {
    throw createSupabaseOperationError({
      diagnostics: {
        libraryId,
        requestId,
        userId,
      },
      error: subscriptionError,
      hint: "Check library_subscriptions RLS, grants, and the ensure_library_subscription migration.",
      layer: "db.library_subscriptions.fetch",
      message: "Failed to load the library subscription record required for payment creation.",
      requestId,
    });
  }
  if (!subscription) {
    throw createBillingFunctionError({
      code: "SUBSCRIPTION_ROW_MISSING",
      diagnostics: {
        libraryId,
        requestId,
        userId,
      },
      hint: "Run the latest billing migrations and backfill missing library_subscriptions rows.",
      layer: "db.library_subscriptions.fetch",
      message: "No billing subscription row exists for this library.",
      requestId,
      retryable: false,
      status: 500,
    });
  }

  return subscription as LibrarySubscriptionRow;
};

const recordBillingLifecycleEvent = async (
  supabase: ReturnType<typeof createClient> | null,
  payload: Parameters<typeof logEdgeEvent>[1],
  diagnostics: Record<string, unknown>,
) => {
  if (!supabase) return;

  try {
    await logEdgeEvent(supabase, payload);
  } catch (error) {
    logBillingFunctionEvent("warn", "create_payment_observability_failed", {
      ...diagnostics,
      observabilityError: serializeSupabaseError(error),
      payload,
    });
  }
};

const recordBillingAdminAlert = async (
  payload: Parameters<typeof sendEdgeAdminAlert>[0],
  diagnostics: Record<string, unknown>,
) => {
  try {
    await sendEdgeAdminAlert(payload);
  } catch (error) {
    logBillingFunctionEvent("warn", "create_payment_admin_alert_failed", {
      ...diagnostics,
      observabilityError: serializeSupabaseError(error),
      payload,
    });
  }
};

serve(async (req) => {
  const trace = resolveBillingTraceContext(req.headers);
  let observabilitySupabase: ReturnType<typeof createClient> | null = null;
  let observabilityUser = "anonymous";
  let observabilityEntityId: string | null = null;
  let diagnostics: Record<string, unknown> = {
    correlationId: trace.correlationId,
    functionName: "create-payment",
    paymentProvider: "razorpay",
    requestId: trace.requestId,
    source: "create_payment_edge",
    traceId: trace.traceId,
  };

  const respondWithError = async (error: unknown) => {
    const billingError = isBillingFunctionError(error)
      ? error
      : createBillingFunctionError({
          code: "UNEXPECTED_BILLING_ERROR",
          detail: error instanceof Error ? error.message : String(error),
          diagnostics: {
            ...diagnostics,
            unexpectedError: serializeSupabaseError(error),
          },
          hint: "Inspect the request diagnostics and billing logs for the failing backend layer.",
          layer: "create_payment.unhandled",
          message: "Payment session creation failed unexpectedly.",
          requestId: trace.requestId,
          retryable: true,
          status: 500,
        });

    const errorBody = buildBillingErrorBody(billingError.payload);
    logBillingFunctionEvent("error", "create_payment_failed", {
      ...diagnostics,
      error: errorBody,
    });

    await Promise.all([
      recordBillingLifecycleEvent(
        observabilitySupabase,
        {
          type: "PAYMENT_FAILED",
          status: "FAILED",
          user: observabilityUser,
          entityId: observabilityEntityId,
          metadata: {
            ...diagnostics,
            severity: "CRITICAL",
            stage: billingError.payload.layer,
          },
          message: billingError.payload.message,
        },
        diagnostics,
      ),
      recordBillingAdminAlert(
        {
          type: "PAYMENT_FAILED",
          severity: "CRITICAL",
          user: observabilityUser,
          message: billingError.payload.message,
          metadata: {
            ...diagnostics,
            entityId: observabilityEntityId,
            stage: billingError.payload.layer,
          },
        },
        diagnostics,
      ),
    ]);

    return json(errorBody, billingError.payload.status);
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  try {
    if (req.method !== "POST") {
      throw createBillingFunctionError({
        code: "METHOD_NOT_ALLOWED",
        detail: `Received ${req.method}.`,
        diagnostics,
        hint: "Send this payment creation request as POST.",
        layer: "http.method",
        message: "Method not allowed.",
        requestId: trace.requestId,
        retryable: false,
        status: 405,
      });
    }

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "").trim() ?? "";
    if (!token) {
      throw createBillingFunctionError({
        code: "MISSING_AUTH_TOKEN",
        diagnostics,
        hint: "Refresh the page, sign in again, and retry checkout.",
        layer: "auth.header",
        message: "Payment session creation requires an authenticated session.",
        requestId: trace.requestId,
        retryable: false,
        status: 401,
      });
    }

    const envValidation = validateBillingRuntimeEnv({
      RAZORPAY_KEY_ID: Deno.env.get("RAZORPAY_KEY_ID"),
      RAZORPAY_KEY_SECRET: Deno.env.get("RAZORPAY_KEY_SECRET"),
      RAZORPAY_WEBHOOK_SECRET: Deno.env.get("RAZORPAY_WEBHOOK_SECRET"),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    }, {
      provider: "razorpay",
      requireWebhookSecret: true,
    });
    logBillingFunctionEvent("info", "create_payment_env_validation", {
      ...diagnostics,
      envValidation,
    });
    if (!envValidation.ok) {
      throw createBillingFunctionError({
        code: "BILLING_ENV_INVALID",
        detail: "The payment runtime is missing one or more required billing secrets.",
        diagnostics: {
          ...diagnostics,
          envValidation,
        },
        hint: "Configure Supabase, Razorpay, and webhook secrets in the active billing runtime before activating plans.",
        layer: "runtime.env",
        message: "Billing payment creation is not configured correctly.",
        requestId: trace.requestId,
        retryable: false,
        status: 500,
      });
    }

    const body = await readJsonRequestBody<{
      couponCode?: string | null;
      libraryId?: string | null;
      months?: number | string | null;
      plan?: string | null;
      planName?: string | null;
    }>(req, {
      diagnostics,
      layer: "request.json",
      message: "Payment session payload is invalid.",
      requestId: trace.requestId,
    });

    const libraryIdInput = String(body?.libraryId ?? "").trim();
    const months = clampInt(body?.months, 1, 12, 1);
    const planCodeInput = normalizePlanCode(body?.planName ?? body?.plan);
    const couponCodeInput = normalizeCouponCode(body?.couponCode);
    diagnostics = mergePaymentTraceMetadata({
      couponCode: couponCodeInput || null,
      functionName: "create-payment",
      libraryIdInput: libraryIdInput || null,
      months,
      paymentProvider: "razorpay",
      planCode: planCodeInput || null,
      source: "create_payment_edge",
    }, trace);
    observabilityEntityId = libraryIdInput || null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") as string,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string,
    );
    observabilitySupabase = supabase;

    logBillingFunctionEvent("info", "create_payment_request_received", diagnostics);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: authError,
        hint: "The billing token could not be validated. Ask the user to sign in again.",
        layer: "auth.get_user",
        message: "Failed to validate the authenticated billing user.",
        requestId: trace.requestId,
        retryable: false,
        status: 401,
      });
    }
    if (!authData.user) {
      throw createBillingFunctionError({
        code: "UNAUTHORIZED",
        diagnostics,
        hint: "Sign in again before activating a plan.",
        layer: "auth.get_user",
        message: "Unauthorized payment session request.",
        requestId: trace.requestId,
        retryable: false,
        status: 401,
      });
    }

    const userId = authData.user.id;
    observabilityUser = `user:${userId}`;
    diagnostics = {
      ...diagnostics,
      userId,
    };

    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role, library_id")
      .eq("user_id", userId);
    if (roleError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: roleError,
        hint: "Check the user_roles table permissions and data in the active Supabase project.",
        layer: "db.user_roles.fetch",
        message: "Failed to load billing roles for the authenticated user.",
        requestId: trace.requestId,
      });
    }

    const roles = (roleData ?? []) as UserRoleRow[];
    const isSuperAdmin = roles.some((role) => role.role === "super_admin");
    const ownedLibraryIds = await listOwnedLibraryIds(supabase, userId, trace.requestId);
    const libraryId = resolveLibraryId(roles, libraryIdInput, ownedLibraryIds);
    if (!libraryId) {
      throw createBillingFunctionError({
        code: "LIBRARY_ID_REQUIRED",
        diagnostics: {
          ...diagnostics,
          ownedLibraryIds,
          roleLibraryIds: roles.map((role) => role.library_id).filter(Boolean),
        },
        hint: "Select a library before activating a plan.",
        layer: "request.validation",
        message: "libraryId is required.",
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

    observabilityEntityId = libraryId;
    const canAccessLibrary =
      ownedLibraryIds.includes(libraryId) ||
      roles.some((role) => role.library_id === libraryId && (role.role === "library_owner" || role.role === "staff"));

    diagnostics = {
      ...diagnostics,
      libraryId,
      ownedLibraryIds,
      roleLibraryIds: roles.map((role) => role.library_id).filter(Boolean),
      roles: roles.map((role) => role.role),
    };

    if (!isSuperAdmin && !canAccessLibrary) {
      throw createBillingFunctionError({
        code: "FORBIDDEN",
        diagnostics,
        hint: "Use the library owner or staff account linked to this library.",
        layer: "auth.library_access",
        message: "This account cannot create a payment session for the selected library.",
        requestId: trace.requestId,
        retryable: false,
        status: 403,
      });
    }

    const sub = await ensureLibrarySubscription(supabase, libraryId, userId, trace.requestId);
    diagnostics = {
      ...diagnostics,
      ensuredSubscriptionId: sub.id,
      ensuredSubscriptionPlan: sub.plan_name,
    };
    logBillingFunctionEvent("info", "create_payment_subscription_ensured", diagnostics);

    const currentPlanCode = normalizePlanCode(sub.plan_name);
    const requestedPlanCode = planCodeInput || currentPlanCode;
    diagnostics = {
      ...diagnostics,
      currentPlanCode: currentPlanCode || null,
      requestedPlanCode: requestedPlanCode || null,
    };

    if (!requestedPlanCode) {
      throw createBillingFunctionError({
        code: "PLAN_REQUIRED",
        diagnostics,
        hint: "Choose a valid subscription plan before activating billing.",
        layer: "request.validation",
        message: "plan is required.",
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

    await recordBillingLifecycleEvent(
      supabase,
      {
        type: "PAYMENT_INITIATED",
        status: "START",
        user: observabilityUser,
        entityId: libraryId,
        metadata: {
          ...diagnostics,
          currentPlanCode: currentPlanCode || null,
          requestedPlanCode,
          severity: "INFO",
        },
        message: "Razorpay order creation started.",
      },
      diagnostics,
    );

    const { data: planRow, error: planError } = await supabase
      .from("subscription_plans")
      .select("id, code, name, description, price, seats_limit, lockers_limit, features, is_active")
      .eq("code", requestedPlanCode)
      .maybeSingle();
    if (planError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: planError,
        hint: "Check the subscription_plans table, grants, and active Supabase project alignment.",
        layer: "db.subscription_plans.fetch",
        message: "Failed to resolve the selected billing plan.",
        requestId: trace.requestId,
      });
    }
    if (!planRow) {
      throw createBillingFunctionError({
        code: "PLAN_NOT_FOUND",
        diagnostics,
        hint: "Select a plan that exists in subscription_plans and is active for billing.",
        layer: "db.subscription_plans.fetch",
        message: "Invalid plan selected.",
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

    const plan = planRow as SubscriptionPlanRow;
    const canPurchaseInactive = isSuperAdmin || requestedPlanCode === currentPlanCode;
    if (!plan.is_active && !canPurchaseInactive) {
      throw createBillingFunctionError({
        code: "PLAN_DISABLED",
        diagnostics,
        hint: "Enable the plan in subscription_plans or choose another active plan.",
        layer: "db.subscription_plans.fetch",
        message: "This plan is currently disabled.",
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

    const { data: libraryRow, error: libraryError } = await supabase
      .from("libraries")
      .select("total_seats, total_lockers")
      .eq("id", libraryId)
      .single();
    if (libraryError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: libraryError,
        hint: "Confirm the selected library exists in the active Supabase project.",
        layer: "db.libraries.fetch_capacity",
        message: "Failed to load the library capacity required for billing validation.",
        requestId: trace.requestId,
      });
    }

    const currentSeats = Math.max(0, Number((libraryRow as LibraryCapacityRow | null)?.total_seats ?? 0));
    const currentLockers = Math.max(0, Number((libraryRow as LibraryCapacityRow | null)?.total_lockers ?? 0));
    const capacityError = buildCapacityLimitError({
      currentLockers,
      currentSeats,
      plan,
    });
    if (capacityError) {
      throw createBillingFunctionError({
        code: "PLAN_CAPACITY_EXCEEDED",
        diagnostics: {
          ...diagnostics,
          currentLockers,
          currentSeats,
          planLockersLimit: plan.lockers_limit,
          planSeatsLimit: plan.seats_limit,
        },
        hint: "Reduce library seat or locker capacity before switching to this plan.",
        layer: "billing.capacity_validation",
        message: capacityError,
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

    const unitPrice = safeNumber(plan.price, 0);
    const subtotal = Math.max(1, Math.floor(unitPrice * months));

    const { data: acquisition, error: acquisitionError } = await supabase
      .from("library_acquisition")
      .select("referred_by, affiliate_id")
      .eq("library_id", libraryId)
      .maybeSingle();
    if (acquisitionError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: acquisitionError,
        hint: "Check library_acquisition visibility in the current Supabase project.",
        layer: "db.library_acquisition.fetch",
        message: "Failed to load referral state for payment creation.",
        requestId: trace.requestId,
      });
    }

    const { count: paidCount, error: paidCountError } = await supabase
      .from("subscription_payments")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .eq("status", "paid");
    if (paidCountError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: paidCountError,
        hint: "Check subscription_payments access and indexes in the active Supabase project.",
        layer: "db.subscription_payments.count_paid",
        message: "Failed to determine whether this is the library's first paid billing cycle.",
        requestId: trace.requestId,
      });
    }

    const isFirstPurchase = Number(paidCount ?? 0) === 0;
    let discountKind: "coupon" | "referral" | null = null;
    let discountAmount = 0;
    let coupon: CouponRow | null = null;

    if (couponCodeInput) {
      const { data: couponRow, error: couponError } = await supabase
        .from("coupons")
        .select("id, code, discount_type, discount_value, expires_at, max_uses, is_active")
        .eq("code", couponCodeInput)
        .maybeSingle();
      if (couponError) {
        throw createSupabaseOperationError({
          diagnostics,
          error: couponError,
          hint: "Check coupons table access and the selected coupon code.",
          layer: "db.coupons.fetch",
          message: "Failed to validate the supplied coupon code.",
          requestId: trace.requestId,
        });
      }
      if (!couponRow) {
        throw createBillingFunctionError({
          code: "COUPON_NOT_FOUND",
          diagnostics,
          hint: "Enter an active coupon code that exists in the coupons table.",
          layer: "db.coupons.fetch",
          message: "Invalid coupon code.",
          requestId: trace.requestId,
          retryable: false,
          status: 400,
        });
      }

      coupon = couponRow as CouponRow;
      if (!coupon.is_active) {
        throw createBillingFunctionError({
          code: "COUPON_DISABLED",
          diagnostics,
          hint: "Choose an enabled coupon or remove the coupon from checkout.",
          layer: "billing.coupon_validation",
          message: "This coupon is disabled.",
          requestId: trace.requestId,
          retryable: false,
          status: 400,
        });
      }

      if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
        throw createBillingFunctionError({
          code: "COUPON_EXPIRED",
          diagnostics,
          hint: "Use an unexpired coupon code or continue without a coupon.",
          layer: "billing.coupon_validation",
          message: "This coupon has expired.",
          requestId: trace.requestId,
          retryable: false,
          status: 400,
        });
      }

      if (coupon.max_uses) {
        const { count: usesCount, error: usesError } = await supabase
          .from("coupon_redemptions")
          .select("id", { count: "exact", head: true })
          .eq("coupon_id", coupon.id)
          .in("status", ["reserved", "captured"]);
        if (usesError) {
          throw createSupabaseOperationError({
            diagnostics,
            error: usesError,
            hint: "Check coupon_redemptions access and data consistency in the current project.",
            layer: "db.coupon_redemptions.count",
            message: "Failed to validate coupon usage limits.",
            requestId: trace.requestId,
          });
        }
        if (Number(usesCount ?? 0) >= Number(coupon.max_uses)) {
          throw createBillingFunctionError({
            code: "COUPON_MAX_USES_REACHED",
            diagnostics,
            hint: "Use a coupon with remaining redemptions or continue without one.",
            layer: "billing.coupon_validation",
            message: "Coupon max uses reached.",
            requestId: trace.requestId,
            retryable: false,
            status: 400,
          });
        }
      }

      discountKind = "coupon";
      discountAmount = computeCouponDiscount(subtotal, coupon);
    } else if (isFirstPurchase && acquisition?.referred_by) {
      discountKind = "referral";
      discountAmount = Math.min(
        REFERRAL_SIGNUP_DISCOUNT_MAX,
        Math.floor((subtotal * REFERRAL_SIGNUP_DISCOUNT_PERCENT) / 100),
      );
    }

    const finalAmount = Math.max(1, Math.floor(subtotal - discountAmount));
    const amountInPaise = Math.max(100, Math.round(finalAmount * 100));
    const quotePayload = {
      couponCode: (coupon?.code ?? couponCodeInput) || null,
      discountAmount,
      discountKind,
      finalAmount,
      months,
      subtotal,
      unitPrice,
    };

    const idempotencyKey = buildSubscriptionPaymentIdempotencyKey({
      couponCode: coupon?.code ?? couponCodeInput,
      currentPlanCode,
      libraryId,
      months,
      planCode: plan.code,
    });
    diagnostics = {
      ...diagnostics,
      idempotencyKey,
      quotePayload,
    };

    const { data: activeCreatedRows, error: activeCreatedRowsError } = await supabase
      .from("subscription_payments")
      .select("id, amount, currency, created_at, idempotency_key, metadata, razorpay_order_id, status")
      .eq("library_id", libraryId)
      .eq("status", "created")
      .order("created_at", { ascending: false })
      .limit(8);
    if (activeCreatedRowsError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: activeCreatedRowsError,
        hint: "Check subscription_payments reads in the active Supabase project.",
        layer: "db.subscription_payments.lookup_reusable",
        message: "Failed to inspect recent payment sessions for reuse.",
        requestId: trace.requestId,
      });
    }

    const reusablePayment = findReusableSubscriptionPayment(
      (activeCreatedRows ?? []) as ReusableSubscriptionPayment[],
      idempotencyKey,
    );
    if (reusablePayment?.razorpay_order_id) {
      const reusedAmount = Math.max(100, Math.round(safeNumber(reusablePayment.amount, finalAmount) * 100));
      logBillingFunctionEvent("info", "create_payment_reused_order", {
        ...diagnostics,
        reusedOrderId: reusablePayment.razorpay_order_id,
      });

      await recordBillingLifecycleEvent(
        supabase,
        {
          type: "PAYMENT_INITIATED",
          status: "SUCCESS",
          user: observabilityUser,
          entityId: String(reusablePayment.razorpay_order_id),
          metadata: {
            ...diagnostics,
            amount: safeNumber(reusablePayment.amount, finalAmount),
            currency: reusablePayment.currency ?? "INR",
            libraryId,
            orderId: reusablePayment.razorpay_order_id,
            requestedPlanCode,
            reused_order: true,
            severity: "INFO",
          },
          message: "Reused an active Razorpay order for the same billing request.",
        },
        diagnostics,
      );

      return json({
        amount: reusedAmount,
        currency: reusablePayment.currency ?? "INR",
        keyId: Deno.env.get("RAZORPAY_KEY_ID"),
        orderId: reusablePayment.razorpay_order_id,
        requestId: trace.requestId,
        reused: true,
      });
    }

    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID") as string;
    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET") as string;
    const basic = btoa(`${razorpayKeyId}:${razorpaySecret}`);
    const razorpayAbortController = new AbortController();
    const razorpayTimeout = setTimeout(() => razorpayAbortController.abort("razorpay_order_timeout"), 12_000);

    const providerRequestPayload = {
      amount: amountInPaise,
      currency: "INR",
      notes: {
        coupon: coupon?.code ?? "",
        idempotency_key: idempotencyKey,
        library_id: libraryId,
        months: String(months),
        plan_code: plan.code,
        plan_id: plan.id,
      },
      receipt: `${libraryId.slice(0, 8)}-${Date.now()}`,
    };
    logBillingFunctionEvent("info", "create_payment_provider_request", {
      ...diagnostics,
      providerRequestPayload,
    });

    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(providerRequestPayload),
      signal: razorpayAbortController.signal,
    }).finally(() => clearTimeout(razorpayTimeout));

    const providerResponseText = await razorpayResponse.text();
    logBillingFunctionEvent("info", "create_payment_provider_response", {
      ...diagnostics,
      providerResponseText,
      providerStatus: razorpayResponse.status,
    });

    if (!razorpayResponse.ok) {
      let providerDetail: string | null = null;
      let providerCode = "RAZORPAY_ORDER_CREATION_FAILED";
      try {
        const parsed = JSON.parse(providerResponseText) as Record<string, unknown>;
        const errorRecord =
          parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error)
            ? (parsed.error as Record<string, unknown>)
            : null;
        providerDetail =
          typeof errorRecord?.description === "string"
            ? errorRecord.description
            : typeof parsed.message === "string"
              ? parsed.message
              : null;
        if (typeof errorRecord?.code === "string" && errorRecord.code.trim()) {
          providerCode = errorRecord.code.trim();
        }
      } catch {
        providerDetail = providerResponseText || null;
      }

      throw createBillingFunctionError({
        code: providerCode,
        detail: providerDetail ?? `Razorpay returned HTTP ${razorpayResponse.status}.`,
        diagnostics: {
          ...diagnostics,
          providerResponseText,
          providerStatus: razorpayResponse.status,
        },
        hint: "Check Razorpay credentials, account mode, and order payload validity.",
        layer: "provider.razorpay.create_order",
        message: "Razorpay order creation failed.",
        requestId: trace.requestId,
        retryable: razorpayResponse.status >= 500,
        status: 502,
      });
    }

    let order: { id?: string; amount?: number; currency?: string };
    try {
      order = JSON.parse(providerResponseText) as { id?: string; amount?: number; currency?: string };
    } catch (error) {
      throw createBillingFunctionError({
        code: "RAZORPAY_INVALID_RESPONSE",
        detail: error instanceof Error ? error.message : "Razorpay returned non-JSON order data.",
        diagnostics: {
          ...diagnostics,
          providerResponseText,
        },
        hint: "Retry the request and inspect the provider response in billing logs if this persists.",
        layer: "provider.razorpay.parse_response",
        message: "Razorpay returned an invalid order response.",
        requestId: trace.requestId,
        retryable: true,
        status: 502,
      });
    }

    if (!order?.id || typeof order.amount !== "number" || !order.currency) {
      throw createBillingFunctionError({
        code: "RAZORPAY_INVALID_RESPONSE",
        detail: "Razorpay did not return a valid order id, amount, or currency.",
        diagnostics: {
          ...diagnostics,
          providerOrder: order,
        },
        hint: "Inspect the provider response in billing logs and verify Razorpay order creation settings.",
        layer: "provider.razorpay.validate_response",
        message: "Razorpay returned an invalid order response.",
        requestId: trace.requestId,
        retryable: true,
        status: 502,
      });
    }

    const { data: paymentRow, error: paymentInsertError } = await supabase
      .from("subscription_payments")
      .insert({
        amount: finalAmount,
        currency: "INR",
        idempotency_key: idempotencyKey,
        library_id: libraryId,
        metadata: {
          affiliate_id: acquisition?.affiliate_id ?? null,
          coupon_code: coupon?.code ?? null,
          coupon_discount_type: coupon?.discount_type ?? null,
          coupon_discount_value: coupon ? safeNumber(coupon.discount_value, 0) : null,
          coupon_id: coupon?.id ?? null,
          created_by: userId,
          discount_amount: discountAmount,
          discount_kind: discountKind,
          idempotency_key: idempotencyKey,
          plan_id: plan.id,
          plan_code: plan.code,
          plan_description: plan.description,
          plan_features: plan.features,
          plan_lockers_limit: plan.lockers_limit,
          plan_name: plan.name,
          plan_price: safeNumber(plan.price, 0),
          plan_seats_limit: plan.seats_limit,
          referral_referred_by: acquisition?.referred_by ?? null,
          source_correlation_id: trace.correlationId,
          source_request_id: trace.requestId,
          source_trace_id: trace.traceId,
          subtotal_amount: subtotal,
          total_amount: finalAmount,
        },
        months_purchased: Number(months),
        razorpay_order_id: order.id,
        status: "pending",
        subscription_id: sub.id,
      })
      .select("id")
      .single();
    if (paymentInsertError) {
      throw createSupabaseOperationError({
        diagnostics: {
          ...diagnostics,
          providerOrder: order,
        },
        error: paymentInsertError,
        hint: "Check subscription_payments grants, foreign keys, and billing migration status.",
        layer: "db.subscription_payments.insert",
        message: "Failed to persist the new payment session in Supabase.",
        requestId: trace.requestId,
      });
    }

    if (coupon && paymentRow?.id) {
      const { error: redemptionError } = await supabase.from("coupon_redemptions").insert({
        code: coupon.code,
        coupon_id: coupon.id,
        discount_amount: discountAmount,
        library_id: libraryId,
        razorpay_order_id: order.id,
        status: "reserved",
        subscription_payment_id: paymentRow.id,
        user_id: userId,
      });
      if (redemptionError) {
        throw createSupabaseOperationError({
          diagnostics: {
            ...diagnostics,
            couponId: coupon.id,
            paymentRowId: paymentRow.id,
            providerOrderId: order.id,
          },
          error: redemptionError,
          hint: "Check coupon_redemptions grants and foreign keys in the active Supabase project.",
          layer: "db.coupon_redemptions.insert",
          message: "Failed to reserve the coupon redemption for this billing session.",
          requestId: trace.requestId,
        });
      }
    }

    const successDiagnostics = {
      ...diagnostics,
      orderId: order.id,
      providerAmount: order.amount,
      providerCurrency: order.currency,
      subscriptionPaymentId: paymentRow?.id ?? null,
    };
    logBillingFunctionEvent("info", "create_payment_succeeded", successDiagnostics);

    await recordBillingLifecycleEvent(
      supabase,
      {
        type: "PAYMENT_INITIATED",
        status: "SUCCESS",
        user: observabilityUser,
        entityId: order.id,
        metadata: {
          ...successDiagnostics,
          amount: finalAmount,
          currency: order.currency,
          severity: "INFO",
        },
        message: "Razorpay order created successfully.",
      },
      successDiagnostics,
    );

    return json({
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId,
      orderId: order.id,
      requestId: trace.requestId,
      reused: false,
    });
  } catch (error) {
    return await respondWithError(error);
  }
});
