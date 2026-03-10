import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getSubscriptionPlan, SUBSCRIPTION_BILLING_DAYS } from "../_shared/subscription-plans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const {
      libraryId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json();

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

    const expectedSignature = await signHmacSha256(
      razorpaySecret,
      `${razorpay_order_id}|${razorpay_payment_id}`,
    );

    if (expectedSignature !== razorpay_signature) {
      return new Response(JSON.stringify({ error: "Invalid payment signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: paymentRow, error: paymentFetchError } = await supabase
      .from("subscription_payments")
      .select("id, amount, months_purchased, subscription_id, metadata")
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

    const plan = getSubscriptionPlan(String(paymentRow.metadata?.plan_name || ""));
    if (!plan) throw new Error("Payment metadata does not contain a valid plan.");

    const currentPlanExpiry = subscription.plan_expiry_date ?? subscription.expires_at;
    const baseDate = currentPlanExpiry && new Date(currentPlanExpiry) > new Date()
      ? new Date(currentPlanExpiry)
      : new Date();
    const nextExpiry = new Date(baseDate);
    nextExpiry.setDate(nextExpiry.getDate() + (SUBSCRIPTION_BILLING_DAYS * Number(paymentRow.months_purchased || 1)));
    const activatedAt = new Date().toISOString();

    const [{ error: paymentUpdateError }, { error: subUpdateError }, { error: notificationError }] = await Promise.all([
      supabase
        .from("subscription_payments")
        .update({
          razorpay_payment_id,
          razorpay_signature,
          status: "captured",
          paid_at: new Date().toISOString(),
        })
        .eq("id", paymentRow.id),
      supabase
        .from("library_subscriptions")
        .update({
          plan_name: plan.name,
          plan_price: plan.price,
          plan_start_date: activatedAt,
          plan_expiry_date: nextExpiry.toISOString(),
          payment_status: "paid",
          price: plan.price,
          seats_limit: plan.seatsLimit ?? 0,
          features: plan.features,
          status: "active",
          started_at: activatedAt,
          expires_at: nextExpiry.toISOString(),
        })
        .eq("id", subscription.id),
      supabase.from("notifications").insert({
        library_id: libraryId,
        type: "subscription_payment_success",
        title: "Subscription renewed successfully",
        message: `Payment captured (Razorpay: ${razorpay_payment_id}). ${plan.name} plan extended to ${nextExpiry.toDateString()}.`,
      }),
    ]);
    if (paymentUpdateError) throw paymentUpdateError;
    if (subUpdateError) throw subUpdateError;
    if (notificationError) throw notificationError;

    return new Response(
      JSON.stringify({
        success: true,
        payment_id: razorpay_payment_id,
        amount: paymentRow.amount,
        expires_at: nextExpiry.toISOString(),
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
