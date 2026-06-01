# Edge Function Source

This document contains the exact current source for the Edge Functions shown in the Supabase dashboard screenshot.

## create-payment

Source: "supabase/functions/create-payment/index.ts"

```ts
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
          hint: "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Supabase Function secrets. Live-mode keys are required for production checkout.",
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
      .select("code, name, description, price, seats_limit, features, is_active")
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

```

## process-renewals

Source: "supabase/functions/process-renewals/index.ts"

```ts
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REMINDER_DELIVERY_TYPES = [
  "renewal_7day",
  "renewal_1day",
  "renewal_due_today",
  "subscription_reminder_3day",
] as const;

const LEGACY_NOTIFICATION_TYPES = [
  "locker_assigned",
  "locker_payment_due",
] as const;

type DeliveryStudent = {
  expiry_date: string | null;
  full_name: string | null;
  phone: string | null;
  seat_number: string | null;
};

type DeliverablePayload = {
  id: string;
  message: string | null;
  metadata?: Record<string, unknown> | null;
  type: string;
};

type LegacyNotificationRow = DeliverablePayload & {
  delivery_status: string | null;
  recipient_phone: string | null;
  student_id: string | null;
  students:
    | DeliveryStudent
    | DeliveryStudent[]
    | null;
};

type ReminderLogRow = DeliverablePayload & {
  delivery_channel: string | null;
  error_message: string | null;
  library_id: string;
  notification_id: string | null;
  phone: string | null;
  status: string;
  student_id: string | null;
};

type DeliveryResult = {
  channel: string;
  providerMessageId: string | null;
  providerName: string;
};

type ProcessRenewalsRequest = {
  includeLockerRenewalScan?: boolean;
  includeRenewalScan?: boolean;
  libraryId?: string | null;
  source?: string | null;
};

const parseJsonSafely = (raw: string) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const getStudentRecord = (students: LegacyNotificationRow["students"] | null | undefined) =>
  Array.isArray(students) ? students[0] ?? null : students ?? null;

const normalizePhone = (raw: string | null | undefined, defaultCountryCode: string) => {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }

  if (digits.length === 10 && defaultCountryCode) {
    return `${defaultCountryCode}${digits}`;
  }

  return `+${digits}`;
};

const normalizeWhatsAppAddress = (raw: string) => {
  const normalized = raw.startsWith("whatsapp:") ? raw : `whatsapp:${raw}`;
  const channel = normalized.slice("whatsapp:".length);
  return `whatsapp:${channel.startsWith("+") ? channel : `+${channel.replace(/\D/g, "")}`}`;
};

const resolveMetaWhatsAppCloudConfig = () => {
  const accessToken = (
    Deno.env.get("ACCESS_TOKEN") ||
    Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") ||
    Deno.env.get("WHATSAPP_ACCESS_TOKEN") ||
    ""
  ).trim();
  const phoneNumberId = (
    Deno.env.get("PHONE_NUMBER_ID") ||
    Deno.env.get("META_WHATSAPP_PHONE_NUMBER_ID") ||
    "965662213307865"
  ).trim();

  if (!accessToken || !phoneNumberId) {
    return null;
  }

  return {
    accessToken,
    endpoint: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    phoneNumberId,
  };
};

const normalizeMetaWhatsAppRecipient = (phone: string) => {
  const digitsOnly = phone.replace(/\D/g, "");
  return digitsOnly || null;
};

const resolveLegacyWhatsAppApiUrl = () => {
  const explicit = (Deno.env.get("WHATSAPP_API_URL") || "").trim();
  if (explicit) {
    return explicit.endsWith("/send-message")
      ? explicit
      : `${explicit.replace(/\/+$/, "")}/send-message`;
  }

  const legacy = (Deno.env.get("REMINDER_WEBHOOK_URL") || "").trim();
  return legacy || null;
};

const sendViaMetaWhatsAppCloudApi = async (
  config: NonNullable<ReturnType<typeof resolveMetaWhatsAppCloudConfig>>,
  payload: DeliverablePayload,
  phone: string,
): Promise<DeliveryResult> => {
  const recipient = normalizeMetaWhatsAppRecipient(phone);
  if (!recipient) {
    throw new Error("Recipient phone number missing.");
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      text: {
        body: payload.message ?? "",
      },
      to: recipient,
      type: "text",
    }),
  });

  const rawText = await response.text();
  const responsePayload = parseJsonSafely(rawText);

  if (!response.ok) {
    const apiError = responsePayload?.error;
    throw new Error(
      apiError?.message ||
      responsePayload?.message ||
      `Meta WhatsApp Cloud API delivery failed with status ${response.status}`,
    );
  }

  const providerMessageId = Array.isArray(responsePayload?.messages) && responsePayload.messages[0]?.id
    ? String(responsePayload.messages[0].id)
    : null;

  return {
    channel: "whatsapp",
    providerMessageId,
    providerName: "meta_whatsapp_cloud",
  };
};

const sendViaWebhook = async (
  url: string,
  payload: DeliverablePayload,
  phone: string,
): Promise<DeliveryResult> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone,
      message: payload.message,
    }),
  });

  const rawText = await response.text();
  const responsePayload = parseJsonSafely(rawText);

  if (!response.ok) {
    throw new Error(responsePayload?.error || responsePayload?.message || `WhatsApp API delivery failed with status ${response.status}`);
  }

  return {
    channel: String(responsePayload?.channel || "whatsapp"),
    providerMessageId: responsePayload?.messageId ? String(responsePayload.messageId) : null,
    providerName: "whatsapp_api",
  };
};

const sendViaTwilioMessage = async ({
  accountSid,
  authToken,
  body,
  channel,
  from,
  to,
}: {
  accountSid: string;
  authToken: string;
  body: string;
  channel: "sms" | "whatsapp";
  from: string;
  to: string;
}): Promise<DeliveryResult> => {
  const payload = new URLSearchParams();
  payload.set("To", channel === "whatsapp" ? normalizeWhatsAppAddress(to) : to);
  payload.set("From", channel === "whatsapp" ? normalizeWhatsAppAddress(from) : from);
  payload.set("Body", body);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const rawText = await response.text();
  const payloadJson = parseJsonSafely(rawText);

  if (!response.ok) {
    throw new Error(payloadJson?.message || `Twilio ${channel} delivery failed with status ${response.status}`);
  }

  return {
    channel,
    providerMessageId: payloadJson?.sid ? String(payloadJson.sid) : null,
    providerName: channel === "whatsapp" ? "twilio_whatsapp" : "twilio_sms",
  };
};

const deliverReminder = async (
  payload: DeliverablePayload,
  phone: string,
): Promise<DeliveryResult> => {
  const metaConfig = resolveMetaWhatsAppCloudConfig();
  if (metaConfig) {
    return sendViaMetaWhatsAppCloudApi(metaConfig, payload, phone);
  }

  const webhookUrl = resolveLegacyWhatsAppApiUrl();
  if (webhookUrl) {
    return sendViaWebhook(webhookUrl, payload, phone);
  }

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const whatsappFrom = Deno.env.get("TWILIO_WHATSAPP_FROM");
  const smsFrom = Deno.env.get("TWILIO_SMS_FROM");

  if (accountSid && authToken && whatsappFrom) {
    try {
      return await sendViaTwilioMessage({
        accountSid,
        authToken,
        body: payload.message ?? "",
        channel: "whatsapp",
        from: whatsappFrom,
        to: phone,
      });
    } catch (whatsAppError) {
      if (smsFrom) {
        return sendViaTwilioMessage({
          accountSid,
          authToken,
          body: payload.message ?? "",
          channel: "sms",
          from: smsFrom,
          to: phone,
        });
      }

      throw whatsAppError;
    }
  }

  if (accountSid && authToken && smsFrom) {
    return sendViaTwilioMessage({
      accountSid,
      authToken,
      body: payload.message ?? "",
      channel: "sms",
      from: smsFrom,
      to: phone,
    });
  }

  throw new Error("No reminder delivery provider configured.");
};

const parseRequestBody = async (req: Request): Promise<ProcessRenewalsRequest> => {
  try {
    return (await req.json()) as ProcessRenewalsRequest;
  } catch {
    return {};
  }
};

const getBearerToken = (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

const ensureUserCanAccessLibrary = async (
  supabase: ReturnType<typeof createClient>,
  accessToken: string | null,
  libraryId: string | null,
) => {
  if (!libraryId) return;

  if (!accessToken) {
    throw new Error("Authentication is required to run reminders for a specific library.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    throw new Error("Unable to verify the current user session.");
  }

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
    throw new Error("You are not allowed to run reminders for this library.");
  }
};

const updateNotificationStatus = async (
  supabase: ReturnType<typeof createClient>,
  notificationId: string | null,
  values: Record<string, unknown>,
) => {
  if (!notificationId) return;

  const { error } = await supabase
    .from("notifications")
    .update(values)
    .eq("id", notificationId);

  if (error) throw error;
};

const loadStudentsByIds = async (
  supabase: ReturnType<typeof createClient>,
  studentIds: string[],
) => {
  if (studentIds.length === 0) {
    return new Map<string, DeliveryStudent>();
  }

  const { data, error } = await supabase
    .from("students")
    .select("id, full_name, phone, seat_number, expiry_date")
    .in("id", studentIds);

  if (error) throw error;

  return new Map(
    ((data ?? []) as Array<DeliveryStudent & { id: string }>).map((student) => [
      student.id,
      {
        expiry_date: student.expiry_date,
        full_name: student.full_name,
        phone: student.phone,
        seat_number: student.seat_number,
      },
    ]),
  );
};

const processReminderLogDeliveries = async ({
  defaultCountryCode,
  libraryId,
  supabase,
}: {
  defaultCountryCode: string;
  libraryId: string | null;
  supabase: ReturnType<typeof createClient>;
}) => {
  let query = supabase
    .from("reminder_logs")
    .select("id, library_id, student_id, notification_id, reminder_type, phone, message, status, delivery_channel, error_message")
    .in("reminder_type", [...REMINDER_DELIVERY_TYPES])
    .is("sent_at", null)
    .in("status", ["queued", "failed", "skipped"])
    .order("created_at", { ascending: true });

  if (libraryId) {
    query = query.eq("library_id", libraryId);
  }

  const { data, error } = await query;
  if (error) throw error;

  const reminders = (data ?? []) as ReminderLogRow[];
  const studentMap = await loadStudentsByIds(
    supabase,
    [...new Set(reminders.map((reminder) => reminder.student_id).filter((studentId): studentId is string => Boolean(studentId)))],
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const reminder of reminders) {
    const student = reminder.student_id ? studentMap.get(reminder.student_id) ?? null : null;
    const phone = normalizePhone(reminder.phone ?? student?.phone ?? null, defaultCountryCode);

    if (!phone) {
      skipped += 1;

      const { error: updateError } = await supabase
        .from("reminder_logs")
        .update({
          error_message: "Recipient phone number missing.",
          phone: null,
          status: "skipped",
        })
        .eq("id", reminder.id);

      if (updateError) throw updateError;

      await updateNotificationStatus(supabase, reminder.notification_id, {
        delivery_status: "skipped",
        provider_error: "Recipient phone number missing.",
        recipient_phone: null,
      });

      continue;
    }

    if (!reminder.message) {
      failed += 1;

      const { error: updateError } = await supabase
        .from("reminder_logs")
        .update({
          error_message: "Reminder message body is empty.",
          phone,
          status: "failed",
        })
        .eq("id", reminder.id);

      if (updateError) throw updateError;

      await updateNotificationStatus(supabase, reminder.notification_id, {
        delivery_status: "failed",
        provider_error: "Reminder message body is empty.",
        recipient_phone: phone,
      });

      continue;
    }

    try {
      const delivery = await deliverReminder(reminder, phone);
      const sentAt = new Date().toISOString();
      sent += 1;

      const { error: updateError } = await supabase
        .from("reminder_logs")
        .update({
          delivery_channel: delivery.channel,
          error_message: null,
          phone,
          sent_at: sentAt,
          status: "sent",
        })
        .eq("id", reminder.id);

      if (updateError) throw updateError;

      await updateNotificationStatus(supabase, reminder.notification_id, {
        channel: delivery.channel,
        delivery_status: "sent",
        provider_error: null,
        provider_message_id: delivery.providerMessageId,
        provider_name: delivery.providerName,
        recipient_phone: phone,
        sent_at: sentAt,
      });
    } catch (deliveryError) {
      const errorMessage = deliveryError instanceof Error ? deliveryError.message : "Reminder delivery failed.";
      const status = errorMessage === "No reminder delivery provider configured." ? "skipped" : "failed";

      if (status === "skipped") {
        skipped += 1;
      } else {
        failed += 1;
      }

      const { error: updateError } = await supabase
        .from("reminder_logs")
        .update({
          error_message: errorMessage,
          phone,
          status,
        })
        .eq("id", reminder.id);

      if (updateError) throw updateError;

      await updateNotificationStatus(supabase, reminder.notification_id, {
        delivery_status: status,
        provider_error: errorMessage,
        recipient_phone: phone,
        sent_at: null,
      });
    }
  }

  return {
    failed,
    processed: reminders.length,
    sent,
    skipped,
  };
};

const processLegacyNotificationDeliveries = async ({
  defaultCountryCode,
  libraryId,
  supabase,
}: {
  defaultCountryCode: string;
  libraryId: string | null;
  supabase: ReturnType<typeof createClient>;
}) => {
  let query = supabase
    .from("notifications")
    .select("id, type, message, recipient_phone, delivery_status, metadata, student_id, students:student_id(full_name, phone, seat_number, expiry_date)")
    .in("type", [...LEGACY_NOTIFICATION_TYPES])
    .is("sent_at", null)
    .in("delivery_status", ["queued", "failed", "skipped"])
    .order("created_at", { ascending: true });

  if (libraryId) {
    query = query.eq("library_id", libraryId);
  }

  const { data, error } = await query;
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of (data ?? []) as LegacyNotificationRow[]) {
    const student = getStudentRecord(notification.students);
    const phone = normalizePhone(notification.recipient_phone ?? student?.phone ?? null, defaultCountryCode);

    if (!phone) {
      skipped += 1;

      const { error: updateError } = await supabase
        .from("notifications")
        .update({
          delivery_status: "skipped",
          provider_error: "Recipient phone number missing.",
          recipient_phone: null,
        })
        .eq("id", notification.id);

      if (updateError) throw updateError;
      continue;
    }

    if (!notification.message) {
      failed += 1;

      const { error: updateError } = await supabase
        .from("notifications")
        .update({
          channel: null,
          delivery_status: "failed",
          provider_error: "Reminder message body is empty.",
          recipient_phone: phone,
        })
        .eq("id", notification.id);

      if (updateError) throw updateError;
      continue;
    }

    try {
      const delivery = await deliverReminder(notification, phone);
      sent += 1;

      const { error: updateError } = await supabase
        .from("notifications")
        .update({
          channel: delivery.channel,
          delivery_status: "sent",
          provider_error: null,
          provider_message_id: delivery.providerMessageId,
          provider_name: delivery.providerName,
          recipient_phone: phone,
          sent_at: new Date().toISOString(),
        })
        .eq("id", notification.id);

      if (updateError) throw updateError;
    } catch (deliveryError) {
      const errorMessage = deliveryError instanceof Error ? deliveryError.message : "Reminder delivery failed.";
      const status = errorMessage === "No reminder delivery provider configured." ? "skipped" : "failed";

      if (status === "skipped") {
        skipped += 1;
      } else {
        failed += 1;
      }

      const { error: updateError } = await supabase
        .from("notifications")
        .update({
          delivery_status: status,
          provider_error: errorMessage,
          recipient_phone: phone,
          sent_at: null,
        })
        .eq("id", notification.id);

      if (updateError) throw updateError;
    }
  }

  return {
    failed,
    processed: (data ?? []).length,
    sent,
    skipped,
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await parseRequestBody(req);
    const libraryId = typeof requestBody.libraryId === "string" && requestBody.libraryId.trim()
      ? requestBody.libraryId.trim()
      : null;
    const includeRenewalScan = requestBody.includeRenewalScan !== false;
    const includeLockerRenewalScan = requestBody.includeLockerRenewalScan !== false;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const defaultCountryCode = (Deno.env.get("REMINDER_DEFAULT_COUNTRY_CODE") || "+91").trim();

    await ensureUserCanAccessLibrary(supabase, getBearerToken(req), libraryId);

    const renewalScanPromise = includeRenewalScan
      ? supabase.rpc("run_renewal_reminder_scan", {
        p_library_id: libraryId,
      } as never)
      : Promise.resolve({ data: null, error: null });

    const lockerScanPromise = includeLockerRenewalScan
      ? supabase.rpc("process_locker_renewals")
      : Promise.resolve({ data: null, error: null });

    const [
      { data: renewalScanData, error: renewalScanError },
      { data: lockerScanData, error: lockerScanError },
    ] = await Promise.all([renewalScanPromise, lockerScanPromise]);

    if (renewalScanError) throw renewalScanError;
    if (lockerScanError) throw lockerScanError;

    const [reminderDelivery, legacyNotificationDelivery] = await Promise.all([
      processReminderLogDeliveries({
        defaultCountryCode,
        libraryId,
        supabase,
      }),
      processLegacyNotificationDeliveries({
        defaultCountryCode,
        libraryId,
        supabase,
      }),
    ]);

    console.log("Renewal processing completed:", {
      libraryId,
      renewalScanData,
      lockerScanData,
      reminderDelivery,
      legacyNotificationDelivery,
      source: requestBody.source ?? "manual",
    });

    return new Response(
      JSON.stringify({
        success: true,
        results: {
          lockerScan: lockerScanData,
          legacyNotifications: legacyNotificationDelivery,
          reminderDelivery,
          renewalScan: renewalScanData,
        },
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Renewal processing error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

```

## razorpay-webhook

Source: "supabase/functions/razorpay-webhook/index.ts"

```ts
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();

  try {
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";
    if (!webhookSecret) throw new Error("Missing RAZORPAY_WEBHOOK_SECRET.");

    const headerSignature = req.headers.get("x-razorpay-signature") ?? "";
    if (!headerSignature) {
      return new Response(JSON.stringify({ error: "Missing webhook signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedSignature = await signHmacSha256(webhookSecret, rawBody);
    if (!timingSafeEqual(expectedSignature, headerSignature)) {
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

    if (!razorpay_order_id || !razorpay_payment_id) {
      return new Response(JSON.stringify({ success: true, ignored: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: paymentRow, error: paymentFetchError } = await supabase
      .from("subscription_payments")
      .select("id, library_id, amount, months_purchased, status, metadata")
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
    if (!libraryId) throw new Error("Payment row missing library_id.");

    if (payment.status === "captured") {
      return new Response(JSON.stringify({ success: true, already_captured: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subscription, error: subFetchError } = await supabase
      .from("library_subscriptions")
      .select("id, plan_expiry_date, expires_at")
      .eq("library_id", libraryId)
      .single();
    if (subFetchError) throw subFetchError;

    const subscriptionRow = subscription as LibrarySubscriptionRow;
    const metadata = (payment.metadata ?? {}) as Record<string, unknown>;

    const planCode = normalizePlanCode(metadata.plan_code ?? metadata.plan_name ?? metadata.plan ?? "");
    if (!planCode) throw new Error("Payment metadata does not contain plan_code.");

    const planPriceFromMeta = safeNumber(metadata.plan_price, NaN);
    const planSeatsLimitFromMeta = metadata.plan_seats_limit === null ? null : safeNumber(metadata.plan_seats_limit, NaN);
    const planFeaturesFromMeta = safeStringArray(metadata.plan_features);
    const planNameFromMeta = String(metadata.plan_name ?? planCode).trim();
    const planDescriptionFromMeta = metadata.plan_description === null ? null : String(metadata.plan_description ?? "").trim() || null;

    let planFallback: SubscriptionPlanRow | null = null;
    if (
      !Number.isFinite(planPriceFromMeta) ||
      !Number.isFinite(planSeatsLimitFromMeta as number) ||
      planFeaturesFromMeta.length === 0
    ) {
      const { data: planRow, error: planError } = await supabase
        .from("subscription_plans")
        .select("code, name, description, price, seats_limit, features, is_active")
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

    const rewardAndCommissionPromises: Array<Promise<{ error: unknown }>> = [];

    const [{ error: paymentUpdateError }, { error: subUpdateError }, { error: redemptionUpdateError }, { error: notificationError }] =
      await Promise.all([
        supabase
          .from("subscription_payments")
          .update({
            razorpay_payment_id,
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

    return new Response(
      JSON.stringify({
        success: true,
        order_id: razorpay_order_id,
        payment_id: razorpay_payment_id,
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
    console.error("razorpay-webhook error", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

```

## subscription-quote

Source: "supabase/functions/subscription-quote/index.ts"

```ts
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

```
