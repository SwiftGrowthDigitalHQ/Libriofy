import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { logEdgeEvent, sendEdgeAdminAlert } from "../_shared/observability.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUBSCRIPTION_BILLING_DAYS = 30;
const REFERRAL_REWARD_PERCENT = 10;
const REFERRAL_REWARD_MAX = 1000;

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

const signHmacSha256 = async (key: string, message: string): Promise<string> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return toHex(signature);
};

type SubscriptionPaymentRow = {
  id: string;
  amount: number | string;
  months_purchased: number | null;
  subscription_id: string;
  status: "created" | "captured" | "failed";
  metadata: Record<string, unknown> | null;
};

type LibrarySubscriptionRow = {
  id: string;
  plan_expiry_date: string | null;
  expires_at: string | null;
};

type SubscriptionPlanRow = {
  code: string;
  name: string;
  description: string | null;
  price: number | string;
  seats_limit: number | null;
  lockers_limit: number | null;
  features: unknown;
  is_active: boolean;
};

const normalizePlanCode = (value: unknown) => String(value ?? "").trim().toLowerCase();

const safeNumber = (value: unknown, fallback: number) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
};

const round2 = (value: number) => Math.round(value * 100) / 100;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;
  let observabilitySupabase: ReturnType<typeof createClient> | null = null;
  let observabilityUser = "anonymous";
  let requestLibraryId = "";
  let requestOrderId = "";
  let requestPaymentId = "";
  let observabilityMetadata: Record<string, unknown> = {
    source: "verify_payment_edge",
  };

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      libraryId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json();
    requestLibraryId = libraryId ? String(libraryId) : "";
    requestOrderId = razorpay_order_id ? String(razorpay_order_id) : "";
    requestPaymentId = razorpay_payment_id ? String(razorpay_payment_id) : "";
    observabilityMetadata = {
      libraryId: requestLibraryId || null,
      orderId: requestOrderId || null,
      paymentId: requestPaymentId || null,
      source: "verify_payment_edge",
    };

    if (!libraryId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return new Response(JSON.stringify({ error: "Missing required payment fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    observabilitySupabase = supabase;

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authData.user.id;
    observabilityUser = `user:${userId}`;
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

    await logEdgeEvent(supabase, {
      type: "PAYMENT_SUCCESS",
      status: "START",
      user: observabilityUser,
      entityId: String(razorpay_order_id),
      metadata: {
        ...observabilityMetadata,
        severity: "INFO",
        stage: "verification",
      },
      message: "Payment verification started.",
    });

    const expectedSignature = await signHmacSha256(
      razorpaySecret,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );

    if (expectedSignature !== razorpay_signature) {
      await Promise.allSettled([
        logEdgeEvent(supabase, {
          type: "PAYMENT_FAILED",
          status: "FAILED",
          user: observabilityUser,
          entityId: String(razorpay_order_id),
          metadata: {
            ...observabilityMetadata,
            severity: "CRITICAL",
            stage: "signature_validation",
          },
          message: "Invalid payment signature",
        }),
        sendEdgeAdminAlert({
          type: "PAYMENT_FAILED",
          severity: "CRITICAL",
          user: observabilityUser,
          message: "Invalid payment signature",
          metadata: {
            ...observabilityMetadata,
            stage: "signature_validation",
          },
        }),
      ]);
      return new Response(JSON.stringify({ error: "Invalid payment signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: paymentRow, error: paymentFetchError } = await supabase
      .from("subscription_payments")
      .select("id, amount, months_purchased, subscription_id, status, metadata")
      .eq("library_id", libraryId)
      .eq("razorpay_order_id", razorpay_order_id)
      .single();
    if (paymentFetchError) throw paymentFetchError;

    const { data: subscription, error: subFetchError } = await supabase
      .from("library_subscriptions")
      .select("id, plan_expiry_date, expires_at")
      .eq("library_id", libraryId)
      .single();
    if (subFetchError) throw subFetchError;

    const payment = paymentRow as SubscriptionPaymentRow;
    const subscriptionRow = subscription as LibrarySubscriptionRow;
    const metadata = (payment.metadata ?? {}) as Record<string, unknown>;

    const planCode = normalizePlanCode(metadata.plan_code ?? metadata.plan_name ?? metadata.plan ?? "");
    if (!planCode) throw new Error("Payment metadata does not contain plan_code.");

    const planPriceFromMeta = safeNumber(metadata.plan_price, NaN);
    const planSeatsLimitFromMeta = metadata.plan_seats_limit === null ? null : safeNumber(metadata.plan_seats_limit, NaN);
    const planLockersLimitFromMeta = metadata.plan_lockers_limit === null ? null : safeNumber(metadata.plan_lockers_limit, NaN);
    const planFeaturesFromMeta = safeStringArray(metadata.plan_features);
    const planNameFromMeta = String(metadata.plan_name ?? planCode).trim();
    const planDescriptionFromMeta = metadata.plan_description === null ? null : String(metadata.plan_description ?? "").trim() || null;

    if (payment.status === "captured") {
      // The payment was already processed (for example via webhook). Do not extend the subscription again.
      const { error: paymentIdUpdateError } = await supabase
        .from("subscription_payments")
        .update({ razorpay_payment_id, razorpay_signature })
        .eq("id", payment.id);
      if (paymentIdUpdateError) throw paymentIdUpdateError;

      const existingExpiry = subscriptionRow.plan_expiry_date ?? subscriptionRow.expires_at;
      await logEdgeEvent(supabase, {
        type: "PAYMENT_SUCCESS",
        status: "SUCCESS",
        user: observabilityUser,
        entityId: String(razorpay_payment_id),
        metadata: {
          ...observabilityMetadata,
          amount: payment.amount,
          planCode,
          planName: planNameFromMeta,
          severity: "INFO",
          stage: "already_captured",
        },
        message: "Payment had already been captured before verification completed.",
      });
      return new Response(
        JSON.stringify({
          success: true,
          payment_id: razorpay_payment_id,
          amount: payment.amount,
          expires_at: existingExpiry,
          plan: {
            code: planCode,
            name: planNameFromMeta,
            description: planDescriptionFromMeta,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let planFallback: SubscriptionPlanRow | null = null;
    if (
      !Number.isFinite(planPriceFromMeta) ||
      !Number.isFinite(planSeatsLimitFromMeta as number) ||
      !Number.isFinite(planLockersLimitFromMeta as number) ||
      planFeaturesFromMeta.length === 0
    ) {
      const { data: planRow, error: planError } = await supabase
        .from("subscription_plans")
        .select("code, name, description, price, seats_limit, lockers_limit, features, is_active")
        .eq("code", planCode)
        .maybeSingle();
      if (planError) throw planError;
      planFallback = (planRow ?? null) as SubscriptionPlanRow | null;
    }

    const planPrice = Number.isFinite(planPriceFromMeta) ? planPriceFromMeta : safeNumber(planFallback?.price, 0);
    const planSeatsLimit =
      planSeatsLimitFromMeta === null
        ? null
        : Number.isFinite(planSeatsLimitFromMeta as number)
          ? (planSeatsLimitFromMeta as number)
          : planFallback?.seats_limit ?? null;
    const planLockersLimit =
      planLockersLimitFromMeta === null
        ? null
        : Number.isFinite(planLockersLimitFromMeta as number)
          ? (planLockersLimitFromMeta as number)
          : planFallback?.lockers_limit ?? null;
    const planFeatures = planFeaturesFromMeta.length > 0 ? planFeaturesFromMeta : safeStringArray(planFallback?.features ?? []);

    const currentPlanExpiry = subscriptionRow.plan_expiry_date ?? subscriptionRow.expires_at;
    const baseDate = currentPlanExpiry && new Date(currentPlanExpiry) > new Date()
      ? new Date(currentPlanExpiry)
      : new Date();
    const nextExpiry = new Date(baseDate);
    nextExpiry.setDate(nextExpiry.getDate() + (SUBSCRIPTION_BILLING_DAYS * Number(payment.months_purchased || 1)));
    const activatedAt = new Date().toISOString();

    const paymentCapturedAt = new Date().toISOString();

    const planSeatsLimitNormalized = planSeatsLimit == null ? 0 : Number(planSeatsLimit);
    const planLockersLimitNormalized = planLockersLimit == null ? 0 : Number(planLockersLimit);

    const rewardAndCommissionPromises: Array<Promise<{ error: unknown }>> = [];

    const [{ error: paymentUpdateError }, { error: subUpdateError }, { error: redemptionUpdateError }, { error: notificationError }] =
      await Promise.all([
        supabase
          .from("subscription_payments")
          .update({
            razorpay_payment_id,
            razorpay_signature,
            status: "captured",
            paid_at: paymentCapturedAt,
          })
          .eq("id", payment.id),
        supabase
          .from("library_subscriptions")
          .update({
            plan_name: planCode,
            plan_price: planPrice,
            plan_start_date: activatedAt,
            plan_expiry_date: nextExpiry.toISOString(),
            payment_status: "paid",
            price: planPrice,
            seats_limit: planSeatsLimitNormalized,
            lockers_limit: planLockersLimitNormalized,
            features: planFeatures,
            status: "active",
            started_at: activatedAt,
            expires_at: nextExpiry.toISOString(),
          })
          .eq("id", subscriptionRow.id),
        supabase
          .from("coupon_redemptions")
          .update({
            status: "captured",
            captured_at: paymentCapturedAt,
            subscription_payment_id: payment.id,
          })
          .eq("razorpay_order_id", razorpay_order_id)
          .eq("status", "reserved"),
        supabase.from("notifications").insert({
          library_id: libraryId,
          type: "subscription_payment_success",
          title: "Subscription renewed successfully",
          message: `Payment captured (Razorpay: ${razorpay_payment_id}). ${planNameFromMeta || planCode} plan extended to ${nextExpiry.toDateString()}.`,
        }),
      ]);
    if (paymentUpdateError) throw paymentUpdateError;
    if (subUpdateError) throw subUpdateError;
    if (redemptionUpdateError) throw redemptionUpdateError;
    if (notificationError) throw notificationError;

    const { count: priorCapturedCount, error: priorCapturedCountError } = await supabase
      .from("subscription_payments")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .eq("status", "captured")
      .neq("id", payment.id);
    if (priorCapturedCountError) throw priorCapturedCountError;

    const isFirstCapturedPayment = Number(priorCapturedCount ?? 0) === 0;

    if (isFirstCapturedPayment) {
      const { data: acquisition, error: acquisitionError } = await supabase
        .from("library_acquisition")
        .select("owner_id, referred_by, affiliate_id")
        .eq("library_id", libraryId)
        .maybeSingle();
      if (acquisitionError) throw acquisitionError;

      const ownerId = acquisition?.owner_id ? String(acquisition.owner_id) : null;
      const referredBy = acquisition?.referred_by ? String(acquisition.referred_by) : null;
      const affiliateId = acquisition?.affiliate_id ? String(acquisition.affiliate_id) : null;

      if (ownerId && referredBy && referredBy !== ownerId) {
        const rewardAmount = Math.min(
          REFERRAL_REWARD_MAX,
          Math.floor((safeNumber(payment.amount, 0) * REFERRAL_REWARD_PERCENT) / 100),
        );

        if (rewardAmount > 0) {
          rewardAndCommissionPromises.push(
            supabase
              .from("referral_rewards")
              .upsert(
                {
                  referrer_user_id: referredBy,
                  referred_user_id: ownerId,
                  library_id: libraryId,
                  subscription_payment_id: payment.id,
                  amount: rewardAmount,
                  status: "pending",
                },
                { onConflict: "subscription_payment_id", ignoreDuplicates: true },
              ),
          );
        }
      }

      if (ownerId && affiliateId) {
        const { data: affiliateRow, error: affiliateError } = await supabase
          .from("affiliates")
          .select("id, commission_rate, is_active")
          .eq("id", affiliateId)
          .maybeSingle();
        if (affiliateError) throw affiliateError;

        if (affiliateRow?.is_active) {
          const commissionRate = safeNumber(affiliateRow.commission_rate, 0);
          const commissionEarned = round2((safeNumber(payment.amount, 0) * commissionRate) / 100);

          if (commissionEarned > 0) {
            rewardAndCommissionPromises.push(
              supabase
                .from("affiliate_commissions")
                .upsert(
                  {
                    affiliate_id: affiliateId,
                    library_id: libraryId,
                    user_id: ownerId,
                    subscription_payment_id: payment.id,
                    commission_rate: commissionRate,
                    commission_earned: commissionEarned,
                    status: "pending",
                  },
                  { onConflict: "subscription_payment_id", ignoreDuplicates: true },
                ),
            );
          }
        }
      }
    }

    if (rewardAndCommissionPromises.length > 0) {
      const results = await Promise.all(rewardAndCommissionPromises);
      const firstError = results.find((res) => res.error)?.error as { message?: string } | undefined;
      if (firstError?.message) {
        console.warn("Reward/commission insert warning:", firstError.message);
      }
    }

    await logEdgeEvent(supabase, {
      type: "PAYMENT_SUCCESS",
      status: "SUCCESS",
      user: observabilityUser,
      entityId: String(razorpay_payment_id),
      metadata: {
        ...observabilityMetadata,
        amount: payment.amount,
        planCode,
        planName: planNameFromMeta,
        severity: "INFO",
        stage: "verification",
      },
      message: "Payment verified and subscription activated.",
    });

    return new Response(
      JSON.stringify({
        success: true,
        payment_id: razorpay_payment_id,
        amount: payment.amount,
        expires_at: nextExpiry.toISOString(),
        plan: {
          code: planCode,
          name: planNameFromMeta,
          description: planDescriptionFromMeta,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (observabilitySupabase) {
      await Promise.allSettled([
        logEdgeEvent(observabilitySupabase, {
          type: "PAYMENT_FAILED",
          status: "FAILED",
          user: observabilityUser,
          entityId: requestPaymentId || requestOrderId || requestLibraryId,
          metadata: {
            ...observabilityMetadata,
            severity: "CRITICAL",
            stage: "unexpected_exception",
          },
          message,
        }),
        sendEdgeAdminAlert({
          type: "PAYMENT_FAILED",
          severity: "CRITICAL",
          user: observabilityUser,
          message,
          metadata: {
            ...observabilityMetadata,
            stage: "unexpected_exception",
          },
        }),
      ]);
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
