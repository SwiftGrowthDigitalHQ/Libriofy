import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { logEdgeEvent, sendEdgeAdminAlert } from "../_shared/observability.ts";
import {
  buildBillingErrorBody,
  createBillingFunctionError,
  createSupabaseOperationError,
  isBillingFunctionError,
  logBillingFunctionEvent,
  readJsonRequestBody,
  resolveBillingTraceContext,
  safeNumber,
  serializeSupabaseError,
  validateBillingRuntimeEnv,
} from "../_shared/billing-runtime.ts";
import { mergePaymentTraceMetadata } from "../_shared/payment-runtime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-correlation-id, x-trace-id",
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

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const listOwnedLibraryIds = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
  requestId: string,
) => {
  const { data, error } = await supabase
    .from("libraries")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw createSupabaseOperationError({
      diagnostics: {
        requestId,
        userId,
      },
      error,
      hint: "Confirm the libraries table is readable in the active Supabase project.",
      layer: "db.libraries.lookup_owned",
      message: "Failed to resolve library ownership for payment verification.",
      requestId,
    });
  }

  return (data ?? []).map((library) => String(library.id));
};

const recordBillingLifecycleEvent = async (
  supabase: ReturnType<typeof createClient> | null,
  payload: Parameters<typeof logEdgeEvent>[1],
  diagnostics: Record<string, unknown>,
) => {
  if (!supabase) return;

  try {
    await logEdgeEvent(supabase, payload);
  } catch (error) {
    logBillingFunctionEvent("warn", "verify_payment_observability_failed", {
      ...diagnostics,
      observabilityError: serializeSupabaseError(error),
      payload,
    });
  }
};

const recordBillingAdminAlert = async (
  payload: Parameters<typeof sendEdgeAdminAlert>[0],
  diagnostics: Record<string, unknown>,
) => {
  try {
    await sendEdgeAdminAlert(payload);
  } catch (error) {
    logBillingFunctionEvent("warn", "verify_payment_admin_alert_failed", {
      ...diagnostics,
      observabilityError: serializeSupabaseError(error),
      payload,
    });
  }
};

serve(async (req) => {
  const trace = resolveBillingTraceContext(req.headers);
  let observabilitySupabase: ReturnType<typeof createClient> | null = null;
  let observabilityUser = "anonymous";
  let requestLibraryId = "";
  let requestOrderId = "";
  let requestPaymentId = "";
  let diagnostics: Record<string, unknown> = {
    correlationId: trace.correlationId,
    functionName: "verify-razorpay-payment",
    paymentProvider: "razorpay",
    requestId: trace.requestId,
    source: "verify_payment_edge",
    traceId: trace.traceId,
  };

  const respondWithError = async (error: unknown) => {
    const billingError = isBillingFunctionError(error)
      ? error
      : createBillingFunctionError({
          code: "UNEXPECTED_BILLING_ERROR",
          detail: error instanceof Error ? error.message : String(error),
          diagnostics: {
            ...diagnostics,
            unexpectedError: serializeSupabaseError(error),
          },
          hint: "Inspect the request diagnostics and billing logs for the failing backend layer.",
          layer: "verify_payment.unhandled",
          message: "Payment verification failed unexpectedly.",
          requestId: trace.requestId,
          retryable: true,
          status: 500,
        });

    const errorBody = buildBillingErrorBody(billingError.payload);
    logBillingFunctionEvent("error", "verify_payment_failed", {
      ...diagnostics,
      error: errorBody,
    });

    await Promise.all([
      recordBillingLifecycleEvent(
        observabilitySupabase,
        {
          type: "PAYMENT_FAILED",
          status: "FAILED",
          user: observabilityUser,
          entityId: requestPaymentId || requestOrderId || requestLibraryId,
          metadata: {
            ...diagnostics,
            severity: "CRITICAL",
            stage: billingError.payload.layer,
          },
          message: billingError.payload.message,
        },
        diagnostics,
      ),
      recordBillingAdminAlert(
        {
          type: "PAYMENT_FAILED",
          severity: "CRITICAL",
          user: observabilityUser,
          message: billingError.payload.message,
          metadata: {
            ...diagnostics,
            stage: billingError.payload.layer,
          },
        },
        diagnostics,
      ),
    ]);

    return json(errorBody, billingError.payload.status);
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  try {
    if (req.method !== "POST") {
      throw createBillingFunctionError({
        code: "METHOD_NOT_ALLOWED",
        detail: `Received ${req.method}.`,
        diagnostics,
        hint: "Send this payment verification request as POST.",
        layer: "http.method",
        message: "Method not allowed.",
        requestId: trace.requestId,
        retryable: false,
        status: 405,
      });
    }

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "").trim() ?? "";
    if (!token) {
      throw createBillingFunctionError({
        code: "MISSING_AUTH_TOKEN",
        diagnostics,
        hint: "Refresh the page, sign in again, and retry verification.",
        layer: "auth.header",
        message: "Payment verification requires an authenticated session.",
        requestId: trace.requestId,
        retryable: false,
        status: 401,
      });
    }

    const envValidation = validateBillingRuntimeEnv({
      RAZORPAY_KEY_SECRET: Deno.env.get("RAZORPAY_KEY_SECRET"),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
    }, {
      provider: "razorpay",
      requireWebhookSecret: false,
    });
    logBillingFunctionEvent("info", "verify_payment_env_validation", {
      ...diagnostics,
      envValidation,
    });
    if (!envValidation.ok) {
      throw createBillingFunctionError({
        code: "BILLING_ENV_INVALID",
        detail: "The payment verification runtime is missing required billing secrets.",
        diagnostics: {
          ...diagnostics,
          envValidation,
        },
        hint: "Configure Supabase and Razorpay secrets in the active billing runtime before verifying payments.",
        layer: "runtime.env",
        message: "Billing payment verification is not configured correctly.",
        requestId: trace.requestId,
        retryable: false,
        status: 500,
      });
    }

    const body = await readJsonRequestBody<{
      libraryId?: string | null;
      razorpay_order_id?: string | null;
      razorpay_payment_id?: string | null;
      razorpay_signature?: string | null;
    }>(req, {
      diagnostics,
      layer: "request.json",
      message: "Payment verification payload is invalid.",
      requestId: trace.requestId,
    });

    requestLibraryId = body?.libraryId ? String(body.libraryId).trim() : "";
    requestOrderId = body?.razorpay_order_id ? String(body.razorpay_order_id).trim() : "";
    requestPaymentId = body?.razorpay_payment_id ? String(body.razorpay_payment_id).trim() : "";
    const requestSignature = body?.razorpay_signature ? String(body.razorpay_signature).trim() : "";
    diagnostics = mergePaymentTraceMetadata({
      functionName: "verify-razorpay-payment",
      libraryId: requestLibraryId || null,
      orderId: requestOrderId || null,
      paymentId: requestPaymentId || null,
      paymentProvider: "razorpay",
      source: "verify_payment_edge",
    }, trace);

    if (!requestLibraryId || !requestOrderId || !requestPaymentId || !requestSignature) {
      throw createBillingFunctionError({
        code: "MISSING_PAYMENT_FIELDS",
        diagnostics,
        hint: "Provide libraryId, razorpay_order_id, razorpay_payment_id, and razorpay_signature.",
        layer: "request.validation",
        message: "Missing required payment fields.",
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") as string,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string,
    );
    observabilitySupabase = supabase;

    logBillingFunctionEvent("info", "verify_payment_request_received", diagnostics);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: authError,
        hint: "The billing token could not be validated. Ask the user to sign in again.",
        layer: "auth.get_user",
        message: "Failed to validate the authenticated billing user.",
        requestId: trace.requestId,
        retryable: false,
        status: 401,
      });
    }
    if (!authData.user) {
      throw createBillingFunctionError({
        code: "UNAUTHORIZED",
        diagnostics,
        hint: "Sign in again before verifying the payment.",
        layer: "auth.get_user",
        message: "Unauthorized payment verification request.",
        requestId: trace.requestId,
        retryable: false,
        status: 401,
      });
    }

    const userId = authData.user.id;
    observabilityUser = `user:${userId}`;
    diagnostics = {
      ...diagnostics,
      userId,
    };

    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role, library_id")
      .eq("user_id", userId);
    if (roleError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: roleError,
        hint: "Check the user_roles table permissions and data in the active Supabase project.",
        layer: "db.user_roles.fetch",
        message: "Failed to load billing roles for the authenticated user.",
        requestId: trace.requestId,
      });
    }

    const roles = (roleData ?? []) as Array<{ role: string; library_id: string | null }>;
    const isSuperAdmin = roles.some((row) => row.role === "super_admin");
    const ownedLibraryIds = await listOwnedLibraryIds(supabase, userId, trace.requestId);
    const canAccessLibrary =
      ownedLibraryIds.includes(requestLibraryId) ||
      roles.some((row) => row.library_id === requestLibraryId && (row.role === "library_owner" || row.role === "staff"));

    diagnostics = {
      ...diagnostics,
      ownedLibraryIds,
      roleLibraryIds: roles.map((role) => role.library_id).filter(Boolean),
      roles: roles.map((role) => role.role),
    };

    if (!isSuperAdmin && !canAccessLibrary) {
      throw createBillingFunctionError({
        code: "FORBIDDEN",
        diagnostics,
        hint: "Use the library owner or staff account linked to this library.",
        layer: "auth.library_access",
        message: "This account cannot verify payments for the selected library.",
        requestId: trace.requestId,
        retryable: false,
        status: 403,
      });
    }

    await recordBillingLifecycleEvent(
      supabase,
      {
        type: "PAYMENT_SUCCESS",
        status: "START",
        user: observabilityUser,
        entityId: requestOrderId,
        metadata: {
          ...diagnostics,
          severity: "INFO",
          stage: "verification",
        },
        message: "Payment verification started.",
      },
      diagnostics,
    );

    const razorpaySecret = Deno.env.get("RAZORPAY_KEY_SECRET") as string;
    const expectedSignature = await signHmacSha256(
      razorpaySecret,
      `${requestOrderId}|${requestPaymentId}`,
    );

    if (expectedSignature !== requestSignature) {
      throw createBillingFunctionError({
        code: "INVALID_PAYMENT_SIGNATURE",
        diagnostics,
        hint: "Do not trust this payment response. Retry checkout if the client payload was corrupted.",
        layer: "billing.signature_validation",
        message: "Invalid payment signature.",
        requestId: trace.requestId,
        retryable: false,
        status: 400,
      });
    }

    const { data: paymentRow, error: paymentFetchError } = await supabase
      .from("subscription_payments")
      .select("id, amount, library_id, status")
      .eq("library_id", requestLibraryId)
      .eq("razorpay_order_id", requestOrderId)
      .maybeSingle();
    if (paymentFetchError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: paymentFetchError,
        hint: "Check subscription_payments reads in the active Supabase project.",
        layer: "db.subscription_payments.fetch",
        message: "Failed to load the payment session for verification.",
        requestId: trace.requestId,
      });
    }
    if (!paymentRow) {
      throw createBillingFunctionError({
        code: "PAYMENT_ORDER_NOT_FOUND",
        diagnostics,
        hint: "Confirm the order was created in the same Supabase project before verification.",
        layer: "db.subscription_payments.fetch",
        message: "Payment order not found.",
        requestId: trace.requestId,
        retryable: false,
        status: 404,
      });
    }

    const { data: captureResult, error: captureError } = await supabase.rpc("process_subscription_payment_capture", {
      p_capture_source: "verify_payment_edge",
      p_correlation_id: trace.correlationId,
      p_razorpay_order_id: requestOrderId,
      p_razorpay_payment_id: requestPaymentId,
      p_razorpay_signature: requestSignature,
      p_request_id: trace.requestId,
      p_trace_id: trace.traceId,
    });
    if (captureError) {
      throw createSupabaseOperationError({
        diagnostics,
        error: captureError,
        hint: "Check the billing capture RPC, grants, and subscription/payment row integrity.",
        layer: "db.rpc.process_subscription_payment_capture",
        message: "Failed to capture the verified payment in Supabase billing records.",
        requestId: trace.requestId,
      });
    }

    const processed = (captureResult ?? {}) as Record<string, unknown>;
    const processedPlan =
      processed.plan && typeof processed.plan === "object" && !Array.isArray(processed.plan)
        ? (processed.plan as Record<string, unknown>)
        : {};
    const alreadyCaptured = Boolean(processed.already_captured);
    const processedAmount = safeNumber(processed.amount, safeNumber(paymentRow.amount, 0));
    const processedExpiry = typeof processed.expires_at === "string" ? processed.expires_at : null;
    const processedPaymentId = String(processed.payment_id ?? requestPaymentId).trim() || requestPaymentId;
    const processedPlanCode = String(processedPlan.code ?? "").trim();
    const processedPlanName = String(processedPlan.name ?? processedPlanCode).trim();
    const processedPlanDescription =
      processedPlan.description == null ? null : String(processedPlan.description).trim() || null;

    diagnostics = {
      ...diagnostics,
      alreadyCaptured,
      captureResult: processed,
      processedPlanCode: processedPlanCode || null,
      subscriptionPaymentId: processed.subscription_payment_id ?? null,
    };
    logBillingFunctionEvent("info", "verify_payment_capture_succeeded", diagnostics);

    await recordBillingLifecycleEvent(
      supabase,
      {
        type: "PAYMENT_SUCCESS",
        status: "SUCCESS",
        user: observabilityUser,
        entityId: processedPaymentId,
        metadata: {
          ...diagnostics,
          amount: processedAmount,
          planCode: processedPlanCode,
          planName: processedPlanName,
          severity: "INFO",
          stage: alreadyCaptured ? "already_captured" : "verification",
        },
        message: alreadyCaptured
          ? "Payment had already been captured before verification completed."
          : "Payment verified and subscription activated.",
      },
      diagnostics,
    );

    return json({
      amount: processedAmount,
      expires_at: processedExpiry,
      payment_id: processedPaymentId,
      plan: {
        code: processedPlanCode,
        description: processedPlanDescription,
        name: processedPlanName,
      },
      requestId: trace.requestId,
      success: true,
    });
  } catch (error) {
    return await respondWithError(error);
  }
});
