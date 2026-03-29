import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { formatInr, normalizePhone } from "../_shared/payment-recovery.ts";
import {
  getUpgradeMessageForFeature,
  hasAutomationAccess,
  type LibrarySubscriptionAccessRow,
} from "../_shared/subscription-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SendRecoveryReminderRequest = {
  libraryId?: string | null;
  limit?: number;
  source?: string | null;
  studentIds?: string[] | null;
};

type UserRoleRow = {
  library_id: string | null;
  role: string;
};

type LibraryRow = {
  id: string;
  name: string;
};

type RecoveryQueueCandidateRow = {
  amount_due: number | string | null;
  due_date: string | null;
  overdue_days: number | string | null;
  phone: string | null;
  plan_name: string | null;
  recovery_urgency_label: string | null;
  seat_number: string | null;
  student_id: string | null;
  student_name: string | null;
  total_fees: number | string | null;
};

type DeliverablePayload = {
  id: string;
  message: string | null;
  metadata?: Record<string, unknown> | null;
  type: string;
};

type DeliveryResult = {
  channel: string;
  providerMessageId: string | null;
  providerName: string;
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const parseJsonSafely = (raw: string) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
};

const listOwnedLibraryIds = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
) => {
  const { data, error } = await supabase
    .from("libraries")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((item) => String(item.id));
};

const resolveLibraryId = (
  roles: UserRoleRow[],
  requestedLibraryId: string,
  ownedLibraryIds: string[],
) => {
  if (requestedLibraryId) return requestedLibraryId;

  const ownedLibraryId = ownedLibraryIds[0] ?? "";
  if (ownedLibraryId) return ownedLibraryId;

  const ownerRoleLibraryId = roles.find((row) => row.role === "library_owner" && row.library_id)?.library_id ?? "";
  if (ownerRoleLibraryId) return ownerRoleLibraryId;

  const staffRoleLibraryId = roles.find((row) => row.role === "staff" && row.library_id)?.library_id ?? "";
  if (staffRoleLibraryId) return staffRoleLibraryId;

  return "";
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
    ""
  ).trim();

  if (!accessToken || !phoneNumberId) {
    return null;
  }

  return {
    accessToken,
    endpoint: `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
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

const formatDueDate = (dueDate: string | null) => {
  if (!dueDate) return null;
  const parsed = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
};

const buildRecoveryReminderMessage = ({
  amountDue,
  dueDate,
  libraryName,
  studentName,
}: {
  amountDue: number;
  dueDate: string | null;
  libraryName: string;
  studentName: string;
}) => {
  const formattedDueDate = formatDueDate(dueDate);
  return [
    `Hello ${studentName}, this is from ${libraryName}.`,
    `Your ${formatInr(amountDue)} fee is still pending.`,
    formattedDueDate ? `Due date: ${formattedDueDate}.` : null,
    "Please clear the payment today to avoid interruption.",
    "Reply here if you need help from the library team.",
  ]
    .filter(Boolean)
    .join(" ");
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

    const body = (await req.json().catch(() => ({}))) as SendRecoveryReminderRequest;
    const requestedLibraryId = String(body?.libraryId ?? "").trim();
    const limit = clampInt(body?.limit, 1, 50, 5);
    const requestedStudentIds = Array.isArray(body?.studentIds)
      ? body.studentIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const source = String(body?.source ?? "payments_page").trim() || "payments_page";

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const defaultCountryCode = (Deno.env.get("DEFAULT_COUNTRY_CODE") || "+91").trim();

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase secrets missing" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userId = authData.user.id;
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role, library_id")
      .eq("user_id", userId);
    if (roleError) throw roleError;

    const roles = (roleData ?? []) as UserRoleRow[];
    const isSuperAdmin = roles.some((row) => row.role === "super_admin");
    const ownedLibraryIds = await listOwnedLibraryIds(supabase, userId);
    const ownedLibraryIdSet = new Set(ownedLibraryIds);
    const libraryId = resolveLibraryId(roles, requestedLibraryId, ownedLibraryIds);

    if (!libraryId) {
      return json({ error: "libraryId is required" }, 400);
    }

    const canAccessLibrary =
      ownedLibraryIdSet.has(libraryId) ||
      roles.some((row) => row.library_id === libraryId && (row.role === "library_owner" || row.role === "staff"));

    if (!isSuperAdmin && !canAccessLibrary) {
      return json({ error: "Forbidden" }, 403);
    }

    const [libraryRes, subscriptionRes] = await Promise.all([
      supabase.from("libraries").select("id, name").eq("id", libraryId).maybeSingle(),
      supabase
        .from("library_subscriptions")
        .select("plan_name, plan_type, whatsapp_enabled, ai_call_enabled")
        .eq("library_id", libraryId)
        .maybeSingle(),
    ]);

    if (libraryRes.error) throw libraryRes.error;
    if (subscriptionRes.error) throw subscriptionRes.error;

    const library = libraryRes.data as LibraryRow | null;
    if (!library) {
      return json({ error: "Library not found" }, 404);
    }

    const subscription = (subscriptionRes.data ?? null) as LibrarySubscriptionAccessRow | null;
    if (!hasAutomationAccess(subscription, "whatsapp")) {
      return json(
        {
          error: "Upgrade to access this feature",
          feature: "whatsapp",
          hint: getUpgradeMessageForFeature("whatsapp"),
        },
        403,
      );
    }

    let recoveryQuery = supabase
      .from("recovery_queue")
      .select("amount_due, due_date, overdue_days, phone, plan_name, recovery_urgency_label, seat_number, student_id, student_name, total_fees")
      .eq("library_id", libraryId)
      .gt("amount_due", 0)
      .order("overdue_days", { ascending: false })
      .order("amount_due", { ascending: false })
      .order("due_date", { ascending: true });

    if (requestedStudentIds.length > 0) {
      recoveryQuery = recoveryQuery.in("student_id", requestedStudentIds);
    } else {
      recoveryQuery = recoveryQuery.limit(limit);
    }

    const { data: recoveryData, error: recoveryError } = await recoveryQuery;
    if (recoveryError) throw recoveryError;

    const candidatePool = (recoveryData ?? []) as RecoveryQueueCandidateRow[];
    const callableCandidates = candidatePool
      .map((candidate) => ({
        amountDue: Number(candidate.amount_due || 0),
        dueDate: candidate.due_date,
        overdueDays: Number(candidate.overdue_days || 0),
        phone: normalizePhone(candidate.phone, defaultCountryCode),
        planName: candidate.plan_name || "Plan",
        recoveryUrgencyLabel: candidate.recovery_urgency_label || "Pending",
        seatNumber: candidate.seat_number,
        studentId: candidate.student_id || "",
        studentName: candidate.student_name || "Student",
        totalFees: Number(candidate.total_fees || 0),
      }))
      .filter((candidate) => candidate.studentId && candidate.amountDue > 0);

    const skipped = callableCandidates
      .filter((candidate) => !candidate.phone)
      .map((candidate) => ({
        reason: "Missing phone number",
        studentId: candidate.studentId,
        studentName: candidate.studentName,
      }));

    const sendableCandidates = callableCandidates.filter((candidate) => !!candidate.phone);

    if (sendableCandidates.length === 0) {
      return json(
        {
          error: "No recovery reminders could be sent.",
          skipped,
        },
        400,
      );
    }

    const sent: Array<{
      amountDue: number;
      channel: string;
      providerMessageId: string | null;
      providerName: string;
      studentId: string;
      studentName: string;
    }> = [];
    const failed: Array<{
      error: string;
      studentId: string;
      studentName: string;
    }> = [];

    for (const candidate of sendableCandidates) {
      const message = buildRecoveryReminderMessage({
        amountDue: candidate.amountDue,
        dueDate: candidate.dueDate,
        libraryName: library.name,
        studentName: candidate.studentName,
      });
      const payload: DeliverablePayload = {
        id: crypto.randomUUID(),
        message,
        metadata: {
          amount_due: candidate.amountDue,
          initiated_from: source,
          overdue_days: candidate.overdueDays,
          plan_name: candidate.planName,
          recovery_stage_label: candidate.recoveryUrgencyLabel,
          seat_number: candidate.seatNumber,
          total_fees: candidate.totalFees,
        },
        type: "payment_recovery_whatsapp",
      };

      try {
        const delivery = await deliverReminder(payload, candidate.phone || "");
        sent.push({
          amountDue: candidate.amountDue,
          channel: delivery.channel,
          providerMessageId: delivery.providerMessageId,
          providerName: delivery.providerName,
          studentId: candidate.studentId,
          studentName: candidate.studentName,
        });

        try {
          const { data: notificationRow, error: notificationError } = await supabase
            .from("notifications")
            .insert({
              channel: delivery.channel,
              delivery_status: "sent",
              library_id: libraryId,
              message,
              metadata: payload.metadata ?? {},
              provider_message_id: delivery.providerMessageId,
              provider_name: delivery.providerName,
              recipient_phone: candidate.phone,
              sent_at: new Date().toISOString(),
              student_id: candidate.studentId,
              title: "Payment reminder sent",
              type: "payment_recovery_whatsapp",
              user_id: userId,
            })
            .select("id")
            .single();

          if (notificationError) throw notificationError;

          const notificationId = notificationRow?.id ? String(notificationRow.id) : null;
          const { error: reminderLogError } = await supabase
            .from("reminder_logs")
            .insert({
              delivery_channel: delivery.channel,
              library_id: libraryId,
              message,
              notification_id: notificationId,
              phone: candidate.phone,
              reminder_date: new Date().toISOString().slice(0, 10),
              reminder_type: "payment_recovery_whatsapp",
              sent_at: new Date().toISOString(),
              status: "sent",
              student_id: candidate.studentId,
            });

          if (reminderLogError) throw reminderLogError;
        } catch (loggingError) {
          console.error("Failed to log payment recovery reminder", loggingError);
        }
      } catch (deliveryError) {
        const errorMessage = deliveryError instanceof Error ? deliveryError.message : "Reminder delivery failed";
        failed.push({
          error: errorMessage,
          studentId: candidate.studentId,
          studentName: candidate.studentName,
        });

        try {
          const { data: notificationRow, error: notificationError } = await supabase
            .from("notifications")
            .insert({
              channel: "whatsapp",
              delivery_status: "failed",
              library_id: libraryId,
              message,
              metadata: payload.metadata ?? {},
              provider_error: errorMessage,
              recipient_phone: candidate.phone,
              student_id: candidate.studentId,
              title: "Payment reminder failed",
              type: "payment_recovery_whatsapp",
              user_id: userId,
            })
            .select("id")
            .single();

          if (notificationError) throw notificationError;

          const notificationId = notificationRow?.id ? String(notificationRow.id) : null;
          const { error: reminderLogError } = await supabase
            .from("reminder_logs")
            .insert({
              delivery_channel: "whatsapp",
              error_message: errorMessage,
              library_id: libraryId,
              message,
              notification_id: notificationId,
              phone: candidate.phone,
              reminder_date: new Date().toISOString().slice(0, 10),
              reminder_type: "payment_recovery_whatsapp",
              status: "failed",
              student_id: candidate.studentId,
            });

          if (reminderLogError) throw reminderLogError;
        } catch (loggingError) {
          console.error("Failed to log payment recovery reminder failure", loggingError);
        }
      }
    }

    if (sent.length === 0) {
      return json(
        {
          error: "No payment reminders were sent.",
          failed,
          skipped,
        },
        500,
      );
    }

    const totalImpact = sent.reduce((sum, item) => sum + item.amountDue, 0);

    return json({
      failed,
      message:
        sent.length === 1
          ? `Sent 1 payment reminder for ${sent[0].studentName}.`
          : `Sent ${sent.length} payment reminders worth ${formatInr(totalImpact)}.`,
      sent,
      sentCount: sent.length,
      skipped,
      targetedStudents: candidatePool.length,
    });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
});
