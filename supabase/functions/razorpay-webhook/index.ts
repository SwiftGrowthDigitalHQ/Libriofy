import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { logEdgeEvent, sendEdgeAdminAlert } from "../_shared/observability.ts";
import { readPaymentTraceHeaders } from "../_shared/payment-runtime.ts";
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

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
};

const getNested = (value: unknown, path: string[]) => {
  let cursor: unknown = value;
  for (const key of path) {
    const record = asRecord(cursor);
    if (!record) return undefined;
    cursor = record[key];
  }
  return cursor;
};

type SubscriptionPaymentRow = {
  id: string;
  library_id: string;
  amount: number | string;
  months_purchased: number | null;
  status: "pending" | "paid" | "failed" | "expired";
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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  let observabilitySupabase: ReturnType<typeof createClient> | null = null;
  let observabilityEntityId = "";
  let observabilityLibraryId = "";
  const trace = readPaymentTraceHeaders(req.headers);

  try {
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";
    if (!webhookSecret) throw new Error("Missing RAZORPAY_WEBHOOK_SECRET.");

    const headerSignature = req.headers.get("x-razorpay-signature") ?? "";
    if (!headerSignature) {
      console.warn("[razorpay-webhook] missing signature", {
        requestId: trace.requestId,
        source: "razorpay_webhook",
      });
      return new Response(JSON.stringify({ error: "Missing webhook signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedSignature = await signHmacSha256(webhookSecret, rawBody);
    if (!timingSafeEqual(expectedSignature, headerSignature)) {
      console.warn("[razorpay-webhook] invalid signature", {
        requestId: trace.requestId,
        source: "razorpay_webhook",
      });
      return new Response(JSON.stringify({ error: "Invalid webhook signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const event = String(payload?.event ?? "").trim();

    if (event !== "payment.captured") {
      return new Response(JSON.stringify({ success: true, ignored: true, event }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentEntity =
      getNested(payload, ["payload", "payment", "entity"]) ??
      getNested(payload, ["payload", "payment"]) ??
      getNested(payload, ["payment"]) ??
      null;

    const paymentEntityRecord = asRecord(paymentEntity) ?? {};
    const razorpay_order_id = String(paymentEntityRecord.order_id ?? "").trim();
    const razorpay_payment_id = String(paymentEntityRecord.id ?? "").trim();
    observabilityEntityId = razorpay_payment_id || razorpay_order_id;

    if (!razorpay_order_id || !razorpay_payment_id) {
      return new Response(JSON.stringify({ success: true, ignored: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    observabilitySupabase = supabase;

    const { data: paymentRow, error: paymentFetchError } = await supabase
      .from("subscription_payments")
      .select("id, library_id, amount, status")
      .eq("razorpay_order_id", razorpay_order_id)
      .maybeSingle();
    if (paymentFetchError) throw paymentFetchError;

    if (!paymentRow) {
      return new Response(JSON.stringify({ success: true, ignored: true, reason: "order_not_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payment = paymentRow as SubscriptionPaymentRow;
    const libraryId = String(payment.library_id ?? "").trim();
    observabilityLibraryId = libraryId;
    if (!libraryId) throw new Error("Payment row missing library_id.");

    const { data: captureResult, error: captureError } = await supabase.rpc("process_subscription_payment_capture", {
      p_capture_source: "razorpay_webhook",
      p_correlation_id: trace.correlationId,
      p_razorpay_order_id: razorpay_order_id,
      p_razorpay_payment_id: razorpay_payment_id,
      p_request_id: trace.requestId,
      p_trace_id: trace.traceId,
    });
    if (captureError) throw captureError;

    const processed = (captureResult ?? {}) as Record<string, unknown>;
    const processedPlan =
      processed.plan && typeof processed.plan === "object" && !Array.isArray(processed.plan)
        ? (processed.plan as Record<string, unknown>)
        : {};
    const processedAmount = safeNumber(processed.amount, safeNumber(payment.amount, 0));
    const processedExpiry = typeof processed.expires_at === "string" ? processed.expires_at : null;
    const processedPaymentId = String(processed.payment_id ?? razorpay_payment_id).trim() || razorpay_payment_id;
    const processedPlanId = String(processedPlan.id ?? processed.plan_id ?? "").trim();
    const processedPlanCode = String(processedPlan.code ?? "").trim();
    const processedPlanName = String(processedPlan.name ?? processedPlanCode).trim();
    const processedPlanDescription =
      processedPlan.description == null ? null : String(processedPlan.description).trim() || null;

    await logEdgeEvent(supabase, {
      type: "PAYMENT_SUCCESS",
      status: "SUCCESS",
      user: `library:${libraryId}`,
      entityId: processedPaymentId,
      metadata: {
        alreadyCaptured: Boolean(processed.already_captured),
        amount: processedAmount,
        libraryId,
        orderId: razorpay_order_id,
        paymentId: processedPaymentId,
        planId: processedPlanId || null,
        planCode: processedPlanCode,
        planName: processedPlanName,
        requestId: trace.requestId,
        severity: "INFO",
        source: "razorpay_webhook",
        traceId: trace.traceId,
      },
      message: Boolean(processed.already_captured)
        ? "Payment was already captured before the webhook completed."
        : "Payment captured through Razorpay webhook.",
    });

    return new Response(
      JSON.stringify({
        success: true,
        order_id: razorpay_order_id,
        payment_id: processedPaymentId,
        expires_at: processedExpiry,
        plan: {
          id: processedPlanId,
          code: processedPlanCode,
          name: processedPlanName,
          description: processedPlanDescription,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[razorpay-webhook] failed", {
      error: message,
      libraryId: observabilityLibraryId || null,
      orderId: observabilityEntityId || null,
      requestId: trace.requestId,
      source: "razorpay_webhook",
    });
    if (observabilitySupabase) {
      await logEdgeEvent(observabilitySupabase, {
        type: "PAYMENT_FAILED",
        status: "FAILED",
        user: observabilityLibraryId ? `library:${observabilityLibraryId}` : "razorpay_webhook",
        entityId: observabilityEntityId || observabilityLibraryId,
        metadata: {
          libraryId: observabilityLibraryId || null,
          paymentReference: observabilityEntityId || null,
          severity: "CRITICAL",
          source: "razorpay_webhook",
          stage: "unexpected_exception",
        },
        message,
      });
    }
    await sendEdgeAdminAlert({
      type: "PAYMENT_FAILED",
      severity: "CRITICAL",
      user: observabilityLibraryId ? `library:${observabilityLibraryId}` : "razorpay_webhook",
      message,
      metadata: {
        libraryId: observabilityLibraryId || null,
        paymentReference: observabilityEntityId || null,
        source: "razorpay_webhook",
        stage: "unexpected_exception",
      },
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
