import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { logEdgeEvent, sendEdgeAdminAlert } from "../_shared/observability.ts";
import {
  evaluatePendingPaymentReconciliation,
  RECONCILIATION_SCAN_AFTER_MINUTES,
  selectPendingPaymentsForReconciliation,
  type PendingSubscriptionPaymentRow,
  type RazorpayOrder,
  type RazorpayOrderPaymentsResponse,
} from "../_shared/razorpay-reconciliation.ts";

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

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const parsedLimit = typeof body?.limit === "number"
      ? body.limit
      : typeof body?.limit === "string"
        ? Number(body.limit)
        : NaN;
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(200, Math.trunc(parsedLimit))) : 100;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase secrets missing." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const cutoffIso = new Date(Date.now() - RECONCILIATION_SCAN_AFTER_MINUTES * 60_000).toISOString();
    const { data: pendingPayments, error: pendingPaymentsError } = await supabase
      .from("subscription_payments")
      .select("id, library_id, subscription_id, created_at, metadata, months_purchased, razorpay_order_id, status")
      .eq("status", "pending")
      .lt("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (pendingPaymentsError) throw pendingPaymentsError;

    const scanRows = selectPendingPaymentsForReconciliation(
      (pendingPayments ?? []) as PendingSubscriptionPaymentRow[],
    );

    let captured = 0;
    let failures = 0;
    let staleAlerts = 0;
    let stillPending = 0;

    for (const paymentRow of scanRows) {
      const orderId = String(paymentRow.razorpay_order_id ?? "").trim();
      if (!orderId) {
        failures += 1;

        const message = "Pending payment is missing a Razorpay order reference.";
        await sendEdgeAdminAlert({
          type: "PAYMENT_FAILED",
          severity: "ERROR",
          user: `library:${paymentRow.library_id}`,
          message,
          metadata: {
            libraryId: paymentRow.library_id,
            paymentId: paymentRow.id,
            source: "reconcile_pending_payments",
            subscriptionId: paymentRow.subscription_id,
          },
        });

        continue;
      }

      let order: RazorpayOrder | null = null;
      let payments: RazorpayOrderPaymentsResponse | null = null;

      try {
        [order, payments] = await Promise.all([
          fetchRazorpayJson<RazorpayOrder>(`/orders/${orderId}`),
          fetchRazorpayJson<RazorpayOrderPaymentsResponse>(`/orders/${orderId}/payments`),
        ]);
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        await logEdgeEvent(supabase, {
          type: "PAYMENT_FAILED",
          status: "FAILED",
          user: `library:${paymentRow.library_id}`,
          entityId: paymentRow.id,
          metadata: {
            error: describeError(error),
            libraryId: paymentRow.library_id,
            orderId,
            paymentId: paymentRow.id,
            source: "reconcile_pending_payments",
            stage: "razorpay_lookup",
            subscriptionId: paymentRow.subscription_id,
          },
          message,
        });
        await sendEdgeAdminAlert({
          type: "PAYMENT_FAILED",
          severity: "CRITICAL",
          user: `library:${paymentRow.library_id}`,
          message,
          metadata: {
            libraryId: paymentRow.library_id,
            orderId,
            paymentId: paymentRow.id,
            source: "reconcile_pending_payments",
            stage: "razorpay_lookup",
            subscriptionId: paymentRow.subscription_id,
          },
        });
        continue;
      }

      const decision = evaluatePendingPaymentReconciliation(paymentRow, payments);
      if (decision.action === "skip") {
        stillPending += 1;
        continue;
      }

      if (decision.action === "alert") {
        stillPending += 1;

        if (decision.stale) {
          staleAlerts += 1;
          const alertMessage = "Pending payment older than 10 minutes is still awaiting capture.";

          await logEdgeEvent(supabase, {
            type: "PAYMENT_PENDING_RECONCILIATION",
            status: "FAILED",
            user: `library:${paymentRow.library_id}`,
            entityId: paymentRow.id,
            metadata: {
              ageMinutes: decision.ageMinutes,
              libraryId: paymentRow.library_id,
              orderId,
              orderStatus: order?.status ?? null,
              paymentId: paymentRow.id,
              paymentStatuses: (payments?.items ?? []).map((payment) => payment.status ?? null),
              source: "reconcile_pending_payments",
              subscriptionId: paymentRow.subscription_id,
            },
            message: alertMessage,
          });

          await sendEdgeAdminAlert({
            type: "PAYMENT_PENDING_RECONCILIATION",
            severity: "WARNING",
            user: `library:${paymentRow.library_id}`,
            message: alertMessage,
            metadata: {
              createdAt: paymentRow.created_at,
              libraryId: paymentRow.library_id,
              orderId,
              orderStatus: order?.status ?? null,
              paymentId: paymentRow.id,
              source: "reconcile_pending_payments",
              thresholdMinutes: 10,
              subscriptionId: paymentRow.subscription_id,
            },
          });
        }

        continue;
      }

      const { data: captureResult, error: captureError } = await supabase.rpc("process_subscription_payment_capture", {
        p_capture_source: "pending_payment_reconciliation",
        p_razorpay_order_id: orderId,
        p_razorpay_payment_id: String(decision.capturedPayment.id ?? ""),
      });

      if (captureError) {
        failures += 1;
        const message = captureError instanceof Error ? captureError.message : String(captureError);

        await logEdgeEvent(supabase, {
          type: "PAYMENT_FAILED",
          status: "FAILED",
          user: `library:${paymentRow.library_id}`,
          entityId: paymentRow.id,
          metadata: {
            captureError: describeError(captureError),
            captureResult: captureResult ?? null,
            libraryId: paymentRow.library_id,
            orderId,
            paymentId: paymentRow.id,
            providerPaymentId: decision.capturedPayment.id ?? null,
            source: "reconcile_pending_payments",
            stage: "capture_rpc",
            subscriptionId: paymentRow.subscription_id,
          },
          message,
        });

        await sendEdgeAdminAlert({
          type: "PAYMENT_FAILED",
          severity: "CRITICAL",
          user: `library:${paymentRow.library_id}`,
          message,
          metadata: {
            libraryId: paymentRow.library_id,
            orderId,
            paymentId: paymentRow.id,
            providerPaymentId: decision.capturedPayment.id ?? null,
            source: "reconcile_pending_payments",
            stage: "capture_rpc",
            subscriptionId: paymentRow.subscription_id,
          },
        });
        continue;
      }

      captured += 1;
      await logEdgeEvent(supabase, {
        type: "PAYMENT_SUCCESS",
        status: "SUCCESS",
        user: `library:${paymentRow.library_id}`,
        entityId: paymentRow.id,
        metadata: {
          ageMinutes: decision.ageMinutes,
          libraryId: paymentRow.library_id,
          orderId,
          orderStatus: order?.status ?? null,
          paymentId: String(decision.capturedPayment.id ?? paymentRow.id),
          paymentStatus: decision.capturedPayment.status ?? null,
          source: "reconcile_pending_payments",
          subscriptionId: paymentRow.subscription_id,
        },
        message: "Pending payment was reconciled and subscription activation completed.",
      });
    }

    return json({
      captured,
      failures,
      scanned: scanRows.length,
      staleAlerts,
      stillPending,
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
