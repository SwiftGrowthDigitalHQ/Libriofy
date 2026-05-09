import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { logEdgeEvent, sendEdgeAdminAlert } from "../_shared/observability.ts";
import { mergePaymentTraceMetadata, readPaymentTraceHeaders } from "../_shared/payment-runtime.ts";
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
  const trace = readPaymentTraceHeaders(req.headers);
  let observabilityMetadata: Record<string, unknown> = {
    correlationId: trace.correlationId,
    requestId: trace.requestId,
    source: "verify_payment_edge",
    traceId: trace.traceId,
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
    observabilityMetadata = mergePaymentTraceMetadata({
      libraryId: requestLibraryId || null,
      orderId: requestOrderId || null,
      paymentId: requestPaymentId || null,
      source: "verify_payment_edge",
    }, trace);

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
      .select("id, amount, library_id, status")
      .eq("library_id", libraryId)
      .eq("razorpay_order_id", razorpay_order_id)
      .maybeSingle();
    if (paymentFetchError) throw paymentFetchError;
    if (!paymentRow) {
      return new Response(JSON.stringify({ error: "Payment order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: captureResult, error: captureError } = await supabase.rpc("process_subscription_payment_capture", {
      p_capture_source: "verify_payment_edge",
      p_correlation_id: trace.correlationId,
      p_razorpay_order_id: razorpay_order_id,
      p_razorpay_payment_id: razorpay_payment_id,
      p_razorpay_signature: razorpay_signature,
      p_request_id: trace.requestId,
      p_trace_id: trace.traceId,
    });
    if (captureError) throw captureError;

    const processed = (captureResult ?? {}) as Record<string, unknown>;
    const processedPlan =
      processed.plan && typeof processed.plan === "object" && !Array.isArray(processed.plan)
        ? (processed.plan as Record<string, unknown>)
        : {};
    const alreadyCaptured = Boolean(processed.already_captured);
    const processedAmount = safeNumber(processed.amount, safeNumber(paymentRow.amount, 0));
    const processedExpiry = typeof processed.expires_at === "string" ? processed.expires_at : null;
    const processedPaymentId = String(processed.payment_id ?? razorpay_payment_id).trim() || razorpay_payment_id;
    const processedPlanCode = String(processedPlan.code ?? "").trim();
    const processedPlanName = String(processedPlan.name ?? processedPlanCode).trim();
    const processedPlanDescription =
      processedPlan.description == null ? null : String(processedPlan.description).trim() || null;

    await logEdgeEvent(supabase, {
      type: "PAYMENT_SUCCESS",
      status: "SUCCESS",
      user: observabilityUser,
      entityId: processedPaymentId,
      metadata: {
        ...observabilityMetadata,
        alreadyCaptured,
        amount: processedAmount,
        planCode: processedPlanCode,
        planName: processedPlanName,
        severity: "INFO",
        stage: alreadyCaptured ? "already_captured" : "verification",
      },
      message: alreadyCaptured
        ? "Payment had already been captured before verification completed."
        : "Payment verified and subscription activated.",
    });

    return new Response(
      JSON.stringify({
        success: true,
        payment_id: processedPaymentId,
        amount: processedAmount,
        expires_at: processedExpiry,
        plan: {
          code: processedPlanCode,
          name: processedPlanName,
          description: processedPlanDescription,
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
