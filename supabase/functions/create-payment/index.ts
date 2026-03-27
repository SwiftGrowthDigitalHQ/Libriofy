import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

const normalizePlanCode = (value: unknown) => String(value ?? "").trim().toLowerCase();
const normalizeCouponCode = (value: unknown) => String(value ?? "").trim().toUpperCase();

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

const listOwnedLibraryIds = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
) => {
  const { data: ownedLibraries, error: ownedLibrariesError } = await supabase
    .from("libraries")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (ownedLibrariesError) throw ownedLibrariesError;

  return ownedLibraries?.map((library) => String(library.id)) ?? [];
};

const resolveLibraryId = (
  roles: UserRoleRow[] | null | undefined,
  libraryIdInput: string,
  ownedLibraryIds: string[],
) => {
  if (libraryIdInput) return libraryIdInput;

  const ownedLibraryId = ownedLibraryIds[0] ?? "";
  if (ownedLibraryId) return ownedLibraryId;

  const ownerRoleLibraryId = roles?.find((row) => row.role === "library_owner" && row.library_id)?.library_id ?? null;
  if (ownerRoleLibraryId) return String(ownerRoleLibraryId);

  const staffRoleLibraryId = roles?.find((row) => row.role === "staff" && row.library_id)?.library_id ?? null;
  if (staffRoleLibraryId) return String(staffRoleLibraryId);

  return "";
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return json({ error: "Missing auth token" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const libraryIdInput = String(body?.libraryId ?? "").trim();
    const months = clampInt(body?.months, 1, 12, 1);
    const planCodeInput = normalizePlanCode(body?.planName ?? body?.plan);
    const couponCodeInput = normalizeCouponCode(body?.couponCode);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

    if (!supabaseUrl || !serviceRoleKey) {
      return json(
        { error: "Supabase secrets missing", hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for this Edge Function." },
        500,
      );
    }

    if (!razorpayKeyId || !razorpaySecret) {
      return json(
        {
          error: "Razorpay secrets missing",
          hint: "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Supabase Function secrets (Test Mode keys start with rzp_test_...).",
        },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) throw new Error("Unauthorized");

    const userId = authData.user.id;
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role, library_id")
      .eq("user_id", userId);
    if (roleError) throw roleError;

    const roles = (roleData ?? []) as UserRoleRow[];
    const isSuperAdmin = roles.some((r) => r.role === "super_admin");
    const ownedLibraryIds = await listOwnedLibraryIds(supabase, userId);
    const ownedLibraryIdSet = new Set(ownedLibraryIds);

    const libraryId = resolveLibraryId(roles, libraryIdInput, ownedLibraryIds);
    if (!libraryId) {
      return json({ error: "libraryId is required" }, 400);
    }

    const canAccessLibrary =
      ownedLibraryIdSet.has(libraryId) ||
      roles.some((r) => r.library_id === libraryId && (r.role === "library_owner" || r.role === "staff"));
    if (!isSuperAdmin && !canAccessLibrary) {
      return json({ error: "Forbidden" }, 403);
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
      return json({ error: "plan is required" }, 400);
    }

    const { data: planRow, error: planError } = await supabase
      .from("subscription_plans")
      .select("code, name, description, price, seats_limit, lockers_limit, features, is_active")
      .eq("code", requestedPlanCode)
      .maybeSingle();
    if (planError) throw planError;
    if (!planRow) {
      return json({ error: "Invalid plan selected" }, 400);
    }

    const plan = planRow as SubscriptionPlanRow;
    const canPurchaseInactive = isSuperAdmin || requestedPlanCode === currentPlanCode;
    if (!plan.is_active && !canPurchaseInactive) {
      return json({ error: "This plan is currently disabled" }, 400);
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
      return json({ error: capacityError }, 400);
    }

    const unitPrice = safeNumber(plan.price, 0);
    const subtotal = Math.max(1, Math.floor(unitPrice * months));

    const { data: acquisition, error: acquisitionError } = await supabase
      .from("library_acquisition")
      .select("referred_by, affiliate_id")
      .eq("library_id", libraryId)
      .maybeSingle();
    if (acquisitionError) throw acquisitionError;

    const { count: capturedCount, error: capturedCountError } = await supabase
      .from("subscription_payments")
      .select("id", { count: "exact", head: true })
      .eq("library_id", libraryId)
      .eq("status", "captured");
    if (capturedCountError) throw capturedCountError;
    const isFirstPurchase = Number(capturedCount ?? 0) === 0;

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
        return json({ error: "Invalid coupon code" }, 400);
      }

      coupon = couponRow as CouponRow;
      if (!coupon.is_active) {
        return json({ error: "This coupon is disabled" }, 400);
      }

      if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
        return json({ error: "This coupon has expired" }, 400);
      }

      if (coupon.max_uses) {
        const { count: usesCount, error: usesError } = await supabase
          .from("coupon_redemptions")
          .select("id", { count: "exact", head: true })
          .eq("coupon_id", coupon.id)
          .in("status", ["reserved", "captured"]);
        if (usesError) throw usesError;
        if (Number(usesCount ?? 0) >= Number(coupon.max_uses)) {
          return json({ error: "Coupon max uses reached" }, 400);
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
          plan: plan.code,
          coupon: coupon?.code ?? "",
        },
      }),
    });

    if (!razorpayResponse.ok) {
      const errBody = await razorpayResponse.text();
      console.error("Razorpay order creation failed", { status: razorpayResponse.status, body: errBody });
      let detail: string | null = null;
      try {
        const parsed = JSON.parse(errBody);
        detail = parsed?.error?.description ? String(parsed.error.description) : null;
      } catch {
        // ignore
      }
      return json(
        {
          error: "Razorpay order creation failed",
          status: razorpayResponse.status,
          detail: detail ?? (errBody.length > 400 ? `${errBody.slice(0, 400)}...` : errBody),
        },
        502,
      );
    }

    const order = (await razorpayResponse.json()) as { id?: string; amount?: number; currency?: string };
    if (!order?.id || typeof order.amount !== "number" || !order.currency) {
      console.error("Unexpected Razorpay order response", order);
      return json({ error: "Invalid Razorpay order response" }, 502);
    }

    const { data: paymentRow, error: paymentInsertError } = await supabase
      .from("subscription_payments")
      .insert({
        library_id: libraryId,
        subscription_id: sub.id,
        amount: finalAmount,
        currency: "INR",
        razorpay_order_id: order.id,
        status: "created",
        months_purchased: Number(months),
        metadata: {
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

    return json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
