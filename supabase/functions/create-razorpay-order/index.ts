import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { logBillingFunctionEvent, validateBillingRuntimeEnv } from "../_shared/billing-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

type LibraryCapacityRow = {
  total_seats: number | null;
  total_lockers: number | null;
};

const normalizePlanCode = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();
const normalizeCouponCode = (value: string | null | undefined) => String(value ?? "").trim().toUpperCase();

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
};

const safeNumber = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const exceedsPlanLimit = (currentUsage: number, planLimit: number | null | undefined) =>
  typeof planLimit === "number" && planLimit > 0 && currentUsage > planLimit;

const buildCapacityLimitError = ({
  currentLockers,
  currentSeats,
  plan,
}: {
  currentLockers: number;
  currentSeats: number;
  plan: SubscriptionPlanRow;
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

const computeCouponDiscount = (subtotal: number, coupon: CouponRow) => {
  if (subtotal <= 0) return 0;
  if (coupon.discount_type === "percentage") {
    const pct = Math.max(0, Math.min(100, safeNumber(coupon.discount_value, 0)));
    return Math.floor((subtotal * pct) / 100);
  }

  const flat = Math.max(0, safeNumber(coupon.discount_value, 0));
  return Math.min(Math.floor(flat), Math.max(0, subtotal - 1));
};

const REFERRAL_SIGNUP_DISCOUNT_PERCENT = 10;
const REFERRAL_SIGNUP_DISCOUNT_MAX = 1000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const libraryId = String(body?.libraryId ?? "").trim();
    const months = clampInt(body?.months, 1, 12, 1);
    const planCodeInput = normalizePlanCode(body?.planName);
    const couponCodeInput = normalizeCouponCode(body?.couponCode);

    if (!libraryId) {
      return new Response(JSON.stringify({ error: "libraryId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const envValidation = validateBillingRuntimeEnv({
      RAZORPAY_KEY_ID: Deno.env.get("RAZORPAY_KEY_ID"),
      RAZORPAY_KEY_SECRET: Deno.env.get("RAZORPAY_KEY_SECRET"),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    }, {
      provider: "razorpay",
      requireWebhookSecret: false,
    });
    logBillingFunctionEvent("info", "create_razorpay_order_env_validation", {
      envValidation,
      libraryId,
    });
    if (!envValidation.ok) {
      console.error("[create-razorpay-order] missing billing secrets", {
        envValidation,
        libraryId,
      });
      return new Response(JSON.stringify({ error: "Razorpay secrets missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID")!;
    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) throw new Error("Unauthorized");

    const userId = authData.user.id;
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role, library_id")
      .eq("user_id", userId);
    if (roleError) throw roleError;

    const isSuperAdmin = roleData?.some((r) => r.role === "super_admin");
    const canAccessLibrary = roleData?.some((r) => r.library_id === libraryId && (r.role === "library_owner" || r.role === "staff"));
    if (!isSuperAdmin && !canAccessLibrary) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sub, error: subError } = await supabase
      .from("library_subscriptions")
      .select("id, plan_name")
      .eq("library_id", libraryId)
      .single();
    if (subError) throw subError;

    const currentPlanCode = normalizePlanCode(sub?.plan_name);
    const requestedPlanCode = planCodeInput || currentPlanCode;
    if (!requestedPlanCode) {
      return new Response(JSON.stringify({ error: "planName is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: planRow, error: planError } = await supabase
      .from("subscription_plans")
      .select("id, code, name, description, price, seats_limit, lockers_limit, features, is_active")
      .eq("code", requestedPlanCode)
      .maybeSingle();
    if (planError) throw planError;
    if (!planRow) {
      return new Response(JSON.stringify({ error: "Invalid plan selected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plan = planRow as SubscriptionPlanRow;
    const canPurchaseInactive = isSuperAdmin || requestedPlanCode === currentPlanCode;
    if (!plan.is_active && !canPurchaseInactive) {
      return new Response(JSON.stringify({ error: "This plan is currently disabled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: libraryRow, error: libraryError } = await supabase
      .from("libraries")
      .select("total_seats, total_lockers")
      .eq("id", libraryId)
      .single();
    if (libraryError) throw libraryError;

    const capacityError = buildCapacityLimitError({
      currentLockers: Math.max(0, Number((libraryRow as LibraryCapacityRow | null)?.total_lockers ?? 0)),
      currentSeats: Math.max(0, Number((libraryRow as LibraryCapacityRow | null)?.total_seats ?? 0)),
      plan,
    });
    if (capacityError) {
      return new Response(JSON.stringify({ error: capacityError }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const unitPrice = safeNumber(plan.price, 0);
    const subtotal = Math.max(1, Math.floor(unitPrice * months));

    const { data: acquisition, error: acquisitionError } = await supabase
      .from("library_acquisition")
      .select("referred_by, affiliate_id")
      .eq("library_id", libraryId)
      .maybeSingle();
    if (acquisitionError) throw acquisitionError;

    const { count: paidCount, error: paidCountError } = await supabase
      .from("subscription_payments")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .eq("status", "paid");
    if (paidCountError) throw paidCountError;
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
      if (couponError) throw couponError;
      if (!couponRow) {
        return new Response(JSON.stringify({ error: "Invalid coupon code" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      coupon = couponRow as CouponRow;
      if (!coupon.is_active) {
        return new Response(JSON.stringify({ error: "This coupon is disabled" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
        return new Response(JSON.stringify({ error: "This coupon has expired" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (coupon.max_uses) {
        const { count: usesCount, error: usesError } = await supabase
          .from("coupon_redemptions")
          .select("id", { count: "exact", head: true })
          .eq("coupon_id", coupon.id)
          .in("status", ["reserved", "captured"]);
        if (usesError) throw usesError;
        if (Number(usesCount ?? 0) >= Number(coupon.max_uses)) {
          return new Response(JSON.stringify({ error: "Coupon max uses reached" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    const amountInPaise = finalAmount * 100;

    const basic = btoa(`${razorpayKeyId}:${razorpaySecret}`);
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: "INR",
        receipt: `${libraryId.slice(0, 8)}-${Date.now()}`,
        notes: {
          library_id: libraryId,
          months: String(months),
          plan_code: plan.code,
          plan_id: plan.id,
          coupon: coupon?.code ?? "",
        },
      }),
    });

    if (!razorpayResponse.ok) {
      const errBody = await razorpayResponse.text();
      console.error("[create-razorpay-order] provider rejected order creation", {
        body: errBody,
        libraryId,
        providerStatus: razorpayResponse.status,
      });
      throw new Error(`Razorpay order creation failed: ${errBody}`);
    }

    const order = await razorpayResponse.json();

    const { data: paymentRow, error: paymentInsertError } = await supabase
      .from("subscription_payments")
      .insert({
        library_id: libraryId,
        subscription_id: sub.id,
        amount: finalAmount,
        currency: "INR",
        razorpay_order_id: order.id,
        status: "pending",
        months_purchased: Number(months),
        metadata: {
          plan_id: plan.id,
          plan_code: plan.code,
          plan_name: plan.name,
          plan_description: plan.description,
          plan_price: safeNumber(plan.price, 0),
          plan_seats_limit: plan.seats_limit,
          plan_lockers_limit: plan.lockers_limit,
          plan_features: plan.features,
          subtotal_amount: subtotal,
          discount_amount: discountAmount,
          total_amount: finalAmount,
          discount_kind: discountKind,
          coupon_id: coupon?.id ?? null,
          coupon_code: coupon?.code ?? null,
          coupon_discount_type: coupon?.discount_type ?? null,
          coupon_discount_value: coupon ? safeNumber(coupon.discount_value, 0) : null,
          referral_referred_by: acquisition?.referred_by ?? null,
          affiliate_id: acquisition?.affiliate_id ?? null,
          created_by: userId,
        },
      })
      .select("id")
      .single();
    if (paymentInsertError) throw paymentInsertError;

    if (coupon && paymentRow?.id) {
      const { error: redemptionError } = await supabase.from("coupon_redemptions").insert({
        coupon_id: coupon.id,
        code: coupon.code,
        user_id: userId,
        library_id: libraryId,
        subscription_payment_id: paymentRow.id,
        razorpay_order_id: order.id,
        status: "reserved",
        discount_amount: discountAmount,
      });
      if (redemptionError) throw redemptionError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        order,
        keyId: razorpayKeyId,
        pricing: {
          subtotal_amount: subtotal,
          discount_amount: discountAmount,
          total_amount: finalAmount,
          discount_kind: discountKind,
          coupon_code: coupon?.code ?? null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[create-razorpay-order] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
