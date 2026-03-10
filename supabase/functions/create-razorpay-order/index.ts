import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getSubscriptionPlan, SUBSCRIPTION_PLANS } from "../_shared/subscription-plans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const { libraryId, months = 1, planName } = await req.json();
    if (!libraryId) {
      return new Response(JSON.stringify({ error: "libraryId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!planName) {
      return new Response(JSON.stringify({ error: "planName is required" }), {
        status: 400,
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

    const plan = getSubscriptionPlan(planName);
    if (!plan) {
      return new Response(JSON.stringify({ error: "Invalid plan selected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sub, error: subError } = await supabase
      .from("library_subscriptions")
      .select("id, plan_name, price")
      .eq("library_id", libraryId)
      .single();
    if (subError) throw subError;

    const unitPrice = Number(plan.price);
    const finalAmount = Math.max(1, Math.floor(unitPrice * Number(months)));
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
          plan: plan.name,
        },
      }),
    });

    if (!razorpayResponse.ok) {
      const errBody = await razorpayResponse.text();
      throw new Error(`Razorpay order creation failed: ${errBody}`);
    }

    const order = await razorpayResponse.json();

    const { error: paymentInsertError } = await supabase
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
          plan_name: plan.name,
          plan_price: plan.price,
          plan_seats_limit: plan.seatsLimit,
          plan_features: plan.features,
          created_by: userId,
          available_plans: Object.keys(SUBSCRIPTION_PLANS),
        },
      });
    if (paymentInsertError) throw paymentInsertError;

    return new Response(
      JSON.stringify({
        success: true,
        order,
        keyId: razorpayKeyId,
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
