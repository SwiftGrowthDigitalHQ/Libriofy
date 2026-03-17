import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SubscriptionPlanRow = {
  code: string;
  name: string;
  description: string | null;
  price: number | string;
  seats_limit: number | null;
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

const listOwnedLibraryIds = async (supabase: ReturnType<typeof createClient>, userId: string) => {
  const { data: ownedLibraries, error: ownedLibrariesError } = await supabase
    .from("libraries")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (ownedLibrariesError) throw ownedLibrariesError;

  return ownedLibraries?.map((library) => String(library.id)) ?? [];
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    const canAccessLibrary =
      ownedLibraryIds.includes(libraryId) ||
      roles.some((r) => r.library_id === libraryId && (r.role === "library_owner" || r.role === "staff"));
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
      .select("code, name, description, price, seats_limit, features, is_active")
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

    const totalAmount = Math.max(1, Math.floor(subtotal - discountAmount));

    return new Response(
      JSON.stringify({
        success: true,
        plan: {
          code: plan.code,
          name: plan.name,
          description: plan.description,
          price: unitPrice,
          seats_limit: plan.seats_limit,
          features: plan.features,
          is_active: plan.is_active,
        },
        pricing: {
          months,
          unit_price: unitPrice,
          subtotal_amount: subtotal,
          discount_amount: discountAmount,
          total_amount: totalAmount,
          discount_kind: discountKind,
          coupon_code: coupon?.code ?? null,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
