import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
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
  resolveBillingCheckoutAvailability,
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
      hint: "Confirm the libraries table is reachable for the active Supabase project.",
      layer: "db.libraries.lookup_owned",
      message: "Failed to resolve library ownership for billing quote generation.",
      requestId,
    });
  }

  return (data ?? []).map((library) => String(library.id));
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
      message: "Failed to load the library subscription record required for quote generation.",
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

serve(async (req) => {
  const trace = resolveBillingTraceContext(req.headers);
  let diagnostics: Record<string, unknown> = {
    correlationId: trace.correlationId,
    functionName: "subscription-quote",
    paymentProvider: "razorpay",
    requestId: trace.requestId,
    traceId: trace.traceId,
  };

  const respondWithError = (error: unknown) => {
    const billingError = isBillingFunctionError(error)
      ? error
      : createBillingFunctionError({
          code: "UNEXPECTED_BILLING_ERROR",
          detail: error instanceof Error ? error.message : String(error),
          diagnostics: {
            ...diagnostics,
            unexpectedError: serializeSupabaseError(error),
          },
          hint: "Inspect the request diagnostics and server logs for the failing billing layer.",
          layer: "subscription_quote.unhandled",
          message: "Subscription quote generation failed unexpectedly.",
          requestId: trace.requestId,
          retryable: true,
          status: 500,
        });

    logBillingFunctionEvent("error", "subscription_quote_failed", {
      ...diagnostics,
      error: buildBillingErrorBody(billingError.payload),
    });

    return json(buildBillingErrorBody(billingError.payload), billingError.payload.status);
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  try {
    if (req.method !== "POST") {
      throw createBillingFunctionError({
        code: "METHOD_NOT_ALLOWED",
        detail: `Received ${req.method}.`,
        diagnostics,
        hint: "Send this billing quote request as POST.",
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
        hint: "Refresh the page, sign in again, and retry the billing request.",
        layer: "auth.header",
        message: "Billing quote generation requires an authenticated session.",
        requestId: trace.requestId,
        retryable: false,
        status: 401,
      });
    }

    const envValidation = validateBillingRuntimeEnv({
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    });
    logBillingFunctionEvent("info", "subscription_quote_env_validation", {
      ...diagnostics,
      envValidation,
    });
    if (!envValidation.ok) {
      throw createBillingFunctionError({
        code: "BILLING_ENV_INVALID",
        detail: "The quote function is missing required Supabase billing secrets.",
        diagnostics: {
          ...diagnostics,
          envValidation,
        },
        hint: "Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the active Supabase project secrets.",
        layer: "runtime.env",
        message: "Billing quote generation is not configured correctly.",
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
      message: "Billing quote payload is invalid.",
      requestId: trace.requestId,
    });

    const libraryId = String(body?.libraryId ?? "").trim();
    const months = clampInt(body?.months, 1, 12, 1);
    const planCodeInput = normalizePlanCode(body?.planName ?? body?.plan);
    const couponCodeInput = normalizeCouponCode(body?.couponCode);
    diagnostics = {
      ...diagnostics,
      couponCode: couponCodeInput || null,
      libraryId,
      months,
      planCode: planCodeInput || null,
    };

    if (!libraryId) {
      throw createBillingFunctionError({
        code: "LIBRARY_ID_REQUIRED",
        diagnostics,
        hint: "Select a library before requesting a billing quote.",
        layer: "request.validation",
        message: "libraryId is required.",
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") as string,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string,
    );

    logBillingFunctionEvent("info", "subscription_quote_request_received", diagnostics);

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
        hint: "Sign in again before requesting a billing quote.",
        layer: "auth.get_user",
        message: "Unauthorized billing quote request.",
        requestId: trace.requestId,
        retryable: false,
        status: 401,
      });
    }

    const userId = authData.user.id;
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
    const canAccessLibrary =
      ownedLibraryIds.includes(libraryId) ||
      roles.some((role) => role.library_id === libraryId && (role.role === "library_owner" || role.role === "staff"));

    diagnostics = {
      ...diagnostics,
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
        message: "This account cannot request billing quotes for the selected library.",
        requestId: trace.requestId,
        retryable: false,
        status: 403,
      });
    }

    const subscription = await ensureLibrarySubscription(supabase, libraryId, userId, trace.requestId);
    diagnostics = {
      ...diagnostics,
      ensuredSubscriptionId: subscription.id,
      ensuredSubscriptionPlan: subscription.plan_name,
    };
    logBillingFunctionEvent("info", "subscription_quote_subscription_ensured", diagnostics);

    const currentPlanCode = normalizePlanCode(subscription.plan_name);
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
        hint: "Choose a valid subscription plan before requesting a quote.",
        layer: "request.validation",
        message: "planName is required.",
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

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
        diagnostics: {
          ...diagnostics,
          requestedPlanCode,
        },
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

    const capacityError = buildCapacityLimitError({
      currentLockers: Math.max(0, Number((libraryRow as LibraryCapacityRow | null)?.total_lockers ?? 0)),
      currentSeats: Math.max(0, Number((libraryRow as LibraryCapacityRow | null)?.total_seats ?? 0)),
      plan,
    });
    if (capacityError) {
      throw createBillingFunctionError({
        code: "PLAN_CAPACITY_EXCEEDED",
        diagnostics: {
          ...diagnostics,
          currentLockers: Math.max(0, Number((libraryRow as LibraryCapacityRow | null)?.total_lockers ?? 0)),
          currentSeats: Math.max(0, Number((libraryRow as LibraryCapacityRow | null)?.total_seats ?? 0)),
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
        message: "Failed to load referral state for billing quote generation.",
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
          hint: "Choose an enabled coupon or remove the coupon from this quote.",
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

    const totalAmount = Math.max(1, Math.floor(subtotal - discountAmount));
    const checkout = resolveBillingCheckoutAvailability({
      BILLING_PROVIDER: Deno.env.get("BILLING_PROVIDER"),
      RAZORPAY_KEY_ID: Deno.env.get("RAZORPAY_KEY_ID"),
      RAZORPAY_KEY_SECRET: Deno.env.get("RAZORPAY_KEY_SECRET"),
      RAZORPAY_WEBHOOK_SECRET: Deno.env.get("RAZORPAY_WEBHOOK_SECRET"),
      STRIPE_SECRET_KEY: Deno.env.get("STRIPE_SECRET_KEY"),
      STRIPE_WEBHOOK_SECRET: Deno.env.get("STRIPE_WEBHOOK_SECRET"),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    });
    const responseBody = {
      checkout,
      pricing: {
        coupon_code: coupon?.code ?? null,
        discount_amount: discountAmount,
        discount_kind: discountKind,
        months,
        subtotal_amount: subtotal,
        total_amount: totalAmount,
        unit_price: unitPrice,
      },
      plan: {
        code: plan.code,
        description: plan.description,
        features: plan.features,
        is_active: plan.is_active,
        lockers_limit: plan.lockers_limit,
        name: plan.name,
        price: unitPrice,
        seats_limit: plan.seats_limit,
      },
      requestId: trace.requestId,
      success: true as const,
    };

    logBillingFunctionEvent("info", "subscription_quote_succeeded", {
      ...diagnostics,
      quotePayload: responseBody.pricing,
    });

    return json(responseBody);
  } catch (error) {
    return respondWithError(error);
  }
});
