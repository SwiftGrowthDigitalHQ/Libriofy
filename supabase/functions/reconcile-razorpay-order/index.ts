import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { getCapturedPayment } from "../_shared/razorpay-reconciliation.ts";

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

type UserRoleRow = { role: string; library_id: string | null };
type SubscriptionPaymentRow = {
  amount: number | string;
  currency: string | null;
  id: string;
  library_id: string;
  months_purchased: number | null;
  metadata: Record<string, unknown> | null;
  paid_at: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  status: string;
  subscription_id: string;
  capture_source: string | null;
  capture_request_id: string | null;
  capture_correlation_id: string | null;
  capture_trace_id: string | null;
  last_processing_error: string | null;
};
type LibrarySubscriptionRow = {
  expires_at: string | null;
  id: string;
  library_id: string;
  lockers_limit: number | null;
  payment_status: string | null;
  plan_expiry_date: string | null;
  plan_name: string | null;
  plan_price: number | string | null;
  price: number | string | null;
  seats_limit: number | null;
  started_at: string | null;
  status: string | null;
  updated_at: string | null;
};
type CouponRedemptionRow = {
  captured_at: string | null;
  code: string | null;
  coupon_id: string | null;
  created_at: string;
  discount_amount: number | string | null;
  id: string;
  library_id: string;
  razorpay_order_id: string | null;
  status: string | null;
  subscription_payment_id: string | null;
};
type RazorpayPayment = {
  amount?: number;
  captured?: boolean;
  created_at?: number;
  currency?: string;
  id?: string;
  order_id?: string;
  status?: string;
};
type RazorpayOrder = {
  amount?: number;
  currency?: string;
  id?: string;
  status?: string;
};
type RazorpayOrderPaymentsResponse = {
  count?: number;
  entity?: string;
  items?: RazorpayPayment[];
};

const normalizeText = (value: unknown) => String(value ?? "").trim();

const describeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      code: record.code ?? null,
      details: record.details ?? null,
      hint: record.hint ?? null,
      message: String(record.message ?? record.msg ?? record.error ?? "[object Object]"),
    };
  }

  return {
    message: String(error),
  };
};

const parseRequestBody = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const getBearerToken = (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
};

const listOwnedLibraryIds = async (supabase: ReturnType<typeof createClient>, userId: string) => {
  const { data, error } = await supabase
    .from("libraries")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => String(row.id));
};

const ensureRequestCanAccessLibrary = async (
  supabase: ReturnType<typeof createClient>,
  accessToken: string | null,
  libraryId: string,
) => {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (accessToken && accessToken === serviceRoleKey) {
    return { isAdmin: true, userIdentifier: "service_role_reconcile" };
  }

  if (!accessToken) {
    throw new Error("Authentication is required to reconcile a payment.");
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) throw new Error("Unable to verify the current user session.");

  const [ownedLibrary, scopedRole, superAdminRole] = await Promise.all([
    supabase
      .from("libraries")
      .select("id")
      .eq("id", libraryId)
      .eq("owner_id", user.id)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("library_id")
      .eq("user_id", user.id)
      .eq("library_id", libraryId)
      .in("role", ["library_owner", "staff"])
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("role", "super_admin")
      .maybeSingle(),
  ]);

  const hasAccess = Boolean(ownedLibrary.data || scopedRole.data || superAdminRole.data);
  if (!hasAccess) {
    throw new Error("You are not allowed to reconcile payments for this library.");
  }

  return { isAdmin: false, userIdentifier: `user:${user.id}` };
};

const fetchRazorpayJson = async <T>(path: string): Promise<T> => {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
  if (!keyId || !keySecret) {
    throw new Error("Razorpay secrets are missing.");
  }

  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      "Content-Type": "application/json",
    },
  });

  const rawText = await response.text();
  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errorRecord = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { error?: { description?: unknown; message?: unknown } })
      : null;
    const message = String(
      errorRecord?.error?.description ??
        errorRecord?.error?.message ??
        rawText ??
        `Razorpay request failed with status ${response.status}`,
    );
    throw new Error(message);
  }

  return parsed as T;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const body = await parseRequestBody(req);
    const libraryId = normalizeText(body?.libraryId);
    const orderId = normalizeText(body?.orderId);
    const subscriptionPaymentId = normalizeText(body?.subscriptionPaymentId);

    if (!libraryId || !orderId) {
      return json({ error: "libraryId and orderId are required." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase secrets missing." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const accessToken = getBearerToken(req);
    const requestScope = await ensureRequestCanAccessLibrary(supabase, accessToken, libraryId);

    const { data: existingPayment, error: existingPaymentError } = await supabase
      .from("subscription_payments")
      .select("id, library_id, subscription_id, amount, currency, months_purchased, metadata, paid_at, razorpay_order_id, razorpay_payment_id, status, capture_source, capture_request_id, capture_correlation_id, capture_trace_id, last_processing_error")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();
    if (existingPaymentError) throw existingPaymentError;
    if (!existingPayment) {
      return json({ error: "Subscription payment not found." }, 404);
    }

    if (existingPayment.library_id !== libraryId) {
      return json({ error: "Order does not belong to the requested library." }, 403);
    }
    if (subscriptionPaymentId && existingPayment.id !== subscriptionPaymentId) {
      return json({ error: "subscriptionPaymentId does not match the order." }, 400);
    }

    const order = await fetchRazorpayJson<RazorpayOrder>(`/orders/${orderId}`);
    const payments = await fetchRazorpayJson<RazorpayOrderPaymentsResponse>(`/orders/${orderId}/payments`);
    const capturedPayment = getCapturedPayment(payments);

    if (!capturedPayment?.id) {
      return json(
        {
          captured: false,
          order,
          payments: payments.items ?? [],
          payment: existingPayment,
          reason: "No captured Razorpay payment was found for this order.",
        },
        200,
      );
    }

    const { data: captureResult, error: captureError } = await supabase.rpc("process_subscription_payment_capture", {
      p_capture_source: "razorpay_reconcile",
      p_correlation_id: req.headers.get("x-correlation-id") ?? null,
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: String(capturedPayment.id),
      p_request_id: req.headers.get("x-request-id") ?? null,
      p_trace_id: req.headers.get("x-trace-id") ?? null,
    });
    if (captureError) {
      return json(
        {
          captured: true,
          captureError: describeError(captureError),
          capturedPayment,
          existingPayment,
          order,
          payments: payments.items ?? [],
          reason: "process_subscription_payment_capture failed.",
          stage: "capture_rpc",
        },
        502,
      );
    }

    const { data: paymentRow, error: paymentRowError } = await supabase
      .from("subscription_payments")
      .select("id, library_id, subscription_id, amount, currency, months_purchased, razorpay_order_id, razorpay_payment_id, status, paid_at, capture_source, capture_request_id, capture_correlation_id, capture_trace_id, metadata, last_processing_error")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();
    if (paymentRowError) throw paymentRowError;

    const { data: subscriptionRow, error: subscriptionRowError } = await supabase
      .from("library_subscriptions")
      .select("id, library_id, status, payment_status, plan_name, plan_price, price, seats_limit, lockers_limit, plan_start_date, plan_expiry_date, started_at, expires_at, updated_at")
      .eq("library_id", libraryId)
      .maybeSingle();
    if (subscriptionRowError) throw subscriptionRowError;

    const { data: redemptionRow, error: redemptionRowError } = await supabase
      .from("coupon_redemptions")
      .select("id, coupon_id, code, library_id, subscription_payment_id, razorpay_order_id, status, discount_amount, captured_at, created_at")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();
    if (redemptionRowError) throw redemptionRowError;

    const { data: notificationRows, error: notificationError } = await supabase
      .from("notifications")
      .select("id, type, title, message, channel, delivery_status, provider_name, provider_message_id, provider_error, recipient_phone, sent_at, created_at")
      .eq("library_id", libraryId)
      .eq("type", "subscription_payment_success")
      .order("created_at", { ascending: false })
      .limit(5);
    if (notificationError) throw notificationError;

    await supabase.from("app_event_logs").insert({
      event_type: "PAYMENT_SUCCESS",
      status: "SUCCESS",
      user_identifier: requestScope.userIdentifier,
      entity_id: capturedPayment.id,
      metadata: {
        captureResult,
        libraryId,
        orderId,
        orderStatus: order.status ?? null,
        paymentId: capturedPayment.id,
        providerPaymentStatus: capturedPayment.status ?? null,
        source: "razorpay_reconcile",
        subscriptionPaymentId: paymentRow?.id ?? existingPayment.id,
      },
      message: "Payment reconciled and subscription activation completed.",
    });

    return json({
      captured: true,
      order,
      payments: payments.items ?? [],
      capturedPayment,
      subscriptionPayment: paymentRow ?? existingPayment,
      subscription: subscriptionRow,
      couponRedemption: redemptionRow,
      notifications: notificationRows ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
