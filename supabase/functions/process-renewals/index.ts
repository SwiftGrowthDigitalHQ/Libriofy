import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const REMINDER_TYPES = [
  "renewal_2day",
  "renewal_1day",
  "renewal_due_today",
  "subscription_reminder_3day",
  "subscription_expired_today",
];

type ReminderRow = {
  id: string;
  delivery_status: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  recipient_phone: string | null;
  student_id: string | null;
  type: string;
  students:
    | {
        expiry_date: string | null;
        full_name: string | null;
        phone: string | null;
        seat_number: string | null;
      }
    | {
        expiry_date: string | null;
        full_name: string | null;
        phone: string | null;
        seat_number: string | null;
      }[]
    | null;
};

type DeliveryResult = {
  channel: string;
  providerMessageId: string | null;
  providerName: string;
};

const parseJsonSafely = (raw: string) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const getStudentRecord = (students: ReminderRow["students"]) =>
  Array.isArray(students) ? students[0] ?? null : students;

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

const sendViaWebhook = async (
  url: string,
  reminder: ReminderRow,
  phone: string,
  student: ReturnType<typeof getStudentRecord>,
): Promise<DeliveryResult> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phone,
      message: reminder.message,
      reminder_type: reminder.type,
      notification_id: reminder.id,
      metadata: reminder.metadata ?? {},
      student: {
        full_name: student?.full_name ?? null,
        phone: student?.phone ?? null,
        seat_number: student?.seat_number ?? null,
        expiry_date: student?.expiry_date ?? null,
      },
    }),
  });

  const rawText = await response.text();
  const payload = parseJsonSafely(rawText);

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Webhook delivery failed with status ${response.status}`);
  }

  return {
    channel: String(payload?.channel || "webhook"),
    providerMessageId: payload?.messageId ? String(payload.messageId) : null,
    providerName: "custom_webhook",
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
  reminder: ReminderRow,
  phone: string,
  student: ReturnType<typeof getStudentRecord>,
): Promise<DeliveryResult> => {
  const webhookUrl = Deno.env.get("REMINDER_WEBHOOK_URL");
  if (webhookUrl) {
    return sendViaWebhook(webhookUrl, reminder, phone, student);
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
        body: reminder.message ?? "",
        channel: "whatsapp",
        from: whatsappFrom,
        to: phone,
      });
    } catch (whatsAppError) {
      if (smsFrom) {
        return sendViaTwilioMessage({
          accountSid,
          authToken,
          body: reminder.message ?? "",
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
      body: reminder.message ?? "",
      channel: "sms",
      from: smsFrom,
      to: phone,
    });
  }

  throw new Error("No reminder delivery provider configured.");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const defaultCountryCode = (Deno.env.get("REMINDER_DEFAULT_COUNTRY_CODE") || "+91").trim();

    const [{ data: membershipData, error: membershipError }, { data: subscriptionData, error: subscriptionError }] = await Promise.all([
      supabase.rpc("process_renewals"),
      supabase.rpc("process_library_subscription_renewals"),
    ]);
    if (membershipError) throw membershipError;
    if (subscriptionError) throw subscriptionError;

    const today = new Date();
    const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    const { data: pendingReminders, error: remindersError } = await supabase
      .from("notifications")
      .select("id, type, message, recipient_phone, delivery_status, metadata, student_id, students:student_id(full_name, phone, seat_number, expiry_date)")
      .in("type", REMINDER_TYPES)
      .is("sent_at", null)
      .in("delivery_status", ["queued", "failed", "skipped"])
      .gte("created_at", todayStart.toISOString())
      .lt("created_at", tomorrowStart.toISOString())
      .order("created_at", { ascending: true });

    if (remindersError) throw remindersError;

    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const reminder of (pendingReminders ?? []) as ReminderRow[]) {
      const student = getStudentRecord(reminder.students);
      const phone = normalizePhone(reminder.recipient_phone ?? student?.phone ?? null, defaultCountryCode);

      if (!phone) {
        skippedCount += 1;
        const { error: updateError } = await supabase
          .from("notifications")
          .update({
            delivery_status: "skipped",
            provider_error: "Student phone number missing.",
            provider_name: null,
            recipient_phone: null,
          })
          .eq("id", reminder.id);

        if (updateError) throw updateError;
        continue;
      }

      if (!reminder.message) {
        failedCount += 1;
        const { error: updateError } = await supabase
          .from("notifications")
          .update({
            channel: null,
            delivery_status: "failed",
            provider_error: "Reminder message body is empty.",
            provider_name: null,
            recipient_phone: phone,
          })
          .eq("id", reminder.id);

        if (updateError) throw updateError;
        continue;
      }

      try {
        const delivery = await deliverReminder(reminder, phone, student);
        sentCount += 1;

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
          .eq("id", reminder.id);

        if (updateError) throw updateError;
      } catch (deliveryError) {
        const errorMessage = deliveryError instanceof Error ? deliveryError.message : "Reminder delivery failed.";
        const status = errorMessage === "No reminder delivery provider configured." ? "skipped" : "failed";

        if (status === "skipped") {
          skippedCount += 1;
        } else {
          failedCount += 1;
        }

        const { error: updateError } = await supabase
          .from("notifications")
          .update({
            delivery_status: status,
            provider_error: errorMessage,
            recipient_phone: phone,
            sent_at: null,
          })
          .eq("id", reminder.id);

        if (updateError) throw updateError;
      }
    }

    console.log("Renewal processing completed:", {
      membershipData,
      subscriptionData,
      reminderDelivery: {
        pending: pendingReminders?.length ?? 0,
        sent: sentCount,
        failed: failedCount,
        skipped: skippedCount,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        results: {
          membership: membershipData,
          subscriptions: subscriptionData,
          reminders: {
            processed: pendingReminders?.length ?? 0,
            sent: sentCount,
            failed: failedCount,
            skipped: skippedCount,
          },
        },
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Renewal processing error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
