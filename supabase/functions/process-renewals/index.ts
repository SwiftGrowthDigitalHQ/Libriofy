import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
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
  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

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
