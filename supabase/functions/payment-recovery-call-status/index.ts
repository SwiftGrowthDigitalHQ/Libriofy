import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const xmlHeaders = {
  ...corsHeaders,
  "Content-Type": "text/xml; charset=utf-8",
};

type AutomatedCallRow = {
  audio_bucket: string | null;
  audio_path: string | null;
  id: string;
  library_id: string;
  pending_amount_snapshot: number | string;
  script_text: string;
  student_id: string | null;
  student_name_snapshot: string;
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const xml = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: xmlHeaders,
  });

const parseJsonSafely = (raw: string) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const getRequestParams = async (req: Request) => {
  if (req.method === "GET") {
    return new URL(req.url).searchParams;
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  const rawBody = await req.text();

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(rawBody);
  }

  if (contentType.includes("application/json")) {
    const payload = parseJsonSafely(rawBody);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) continue;
      params.set(key, String(value));
    }
    return params;
  }

  return new URLSearchParams(rawBody);
};

const buildFollowupMessage = (ivrChoice: string | null) => {
  if (ivrChoice === "1") {
    return {
      ivrAction: "payment_confirmed",
      notificationMessage: "Student confirmed payment intent on the automated recovery call.",
      notificationTitle: "Payment confirmation received",
      spokenMessage: "Thank you. Please complete the payment today. The library team has been informed.",
    };
  }

  if (ivrChoice === "2") {
    return {
      ivrAction: "admin_callback_requested",
      notificationMessage: "Student requested a callback from the library admin during the automated recovery call.",
      notificationTitle: "Callback requested",
      spokenMessage: "Thank you. The library admin will contact you shortly.",
    };
  }

  return {
    ivrAction: "no_input",
    notificationMessage: null,
    notificationTitle: null,
    spokenMessage: "No input was received. Please pay your pending fee today or contact the library admin.",
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "status";
    const callId = url.searchParams.get("callId") || "";
    const secret = url.searchParams.get("secret");

    const requiredSecret = (Deno.env.get("PAYMENT_CALL_WEBHOOK_SECRET") || "").trim();
    if (requiredSecret && secret !== requiredSecret) {
      return json({ error: "Unauthorized webhook request" }, 401);
    }

    if (!callId) {
      return json({ error: "callId is required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase secrets missing" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: callRowData, error: callRowError } = await supabase
      .from("automated_calls")
      .select("audio_bucket, audio_path, id, library_id, pending_amount_snapshot, script_text, student_id, student_name_snapshot")
      .eq("id", callId)
      .maybeSingle();

    if (callRowError) throw callRowError;
    const callRow = callRowData as AutomatedCallRow | null;

    if (!callRow) {
      if (mode === "twiml" || mode === "ivr") {
        return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Recovery call record not found.</Say><Hangup/></Response>`, 404);
      }
      return json({ error: "Recovery call record not found" }, 404);
    }

    if (mode === "twiml") {
      const ivrUrl = new URL(url.toString());
      ivrUrl.searchParams.set("mode", "ivr");

      let audioSignedUrl: string | null = null;
      if (callRow.audio_bucket && callRow.audio_path) {
        const { data: signedAudio, error: signedAudioError } = await supabase.storage
          .from(callRow.audio_bucket)
          .createSignedUrl(callRow.audio_path, 3600);
        if (!signedAudioError) {
          audioSignedUrl = signedAudio?.signedUrl ?? null;
        }
      }

      await supabase
        .from("automated_calls")
        .update({
          call_status: "in_progress",
          twiml_requested_at: new Date().toISOString(),
        })
        .eq("id", callId);

      const sayLanguage = (Deno.env.get("TWILIO_SAY_LANGUAGE") || "en-IN").trim();
      const sayVoice = (Deno.env.get("TWILIO_SAY_VOICE") || "alice").trim();
      const escapedScript = escapeXml(callRow.script_text);
      const instructions = escapeXml("Press 1 to confirm payment. Press 2 to talk to admin.");

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather action="${escapeXml(ivrUrl.toString())}" method="POST" numDigits="1" timeout="5">
    ${
      audioSignedUrl
        ? `<Play>${escapeXml(audioSignedUrl)}</Play>`
        : `<Say voice="${escapeXml(sayVoice)}" language="${escapeXml(sayLanguage)}">${escapedScript}</Say>`
    }
    <Pause length="1" />
    <Say voice="${escapeXml(sayVoice)}" language="${escapeXml(sayLanguage)}">${instructions}</Say>
  </Gather>
  <Say voice="${escapeXml(sayVoice)}" language="${escapeXml(sayLanguage)}">No input received. Please pay today or contact the library admin.</Say>
  <Hangup />
</Response>`;

      return xml(twiml);
    }

    const params = await getRequestParams(req);

    if (mode === "ivr") {
      const ivrChoice = params.get("Digits");
      const followup = buildFollowupMessage(ivrChoice);
      const nowIso = new Date().toISOString();

      await supabase
        .from("automated_calls")
        .update({
          answered_at: nowIso,
          ivr_action: followup.ivrAction,
          ivr_choice: ivrChoice,
          pickup_status: "picked",
        })
        .eq("id", callId);

      if (followup.notificationTitle && followup.notificationMessage) {
        await supabase.from("notifications").insert({
          library_id: callRow.library_id,
          message: `${callRow.student_name_snapshot}: ${followup.notificationMessage}`,
          student_id: callRow.student_id,
          title: followup.notificationTitle,
          type: "payment_recovery_call",
        });
      }

      const sayLanguage = (Deno.env.get("TWILIO_SAY_LANGUAGE") || "en-IN").trim();
      const sayVoice = (Deno.env.get("TWILIO_SAY_VOICE") || "alice").trim();
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${escapeXml(sayVoice)}" language="${escapeXml(sayLanguage)}">${escapeXml(followup.spokenMessage)}</Say>
  <Hangup />
</Response>`;

      return xml(twiml);
    }

    const callStatus = params.get("CallStatus") || "unknown";
    const callSid = params.get("CallSid");
    const pickupStatus =
      callStatus === "in-progress" || callStatus === "completed" || callStatus === "answered"
        ? "picked"
        : callStatus === "busy" || callStatus === "failed" || callStatus === "canceled" || callStatus === "no-answer"
          ? "not_picked"
          : "pending";

    const nowIso = new Date().toISOString();
    const isAnswered = pickupStatus === "picked";
    const isComplete =
      callStatus === "completed" ||
      callStatus === "busy" ||
      callStatus === "failed" ||
      callStatus === "canceled" ||
      callStatus === "no-answer";

    await supabase
      .from("automated_calls")
      .update({
        answered_at: isAnswered ? nowIso : null,
        call_status: callStatus,
        completed_at: isComplete ? nowIso : null,
        pickup_status: pickupStatus,
        provider_call_sid: callSid,
        status_callback_payload: Object.fromEntries(params.entries()),
      })
      .eq("id", callId);

    return json({ ok: true });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
});
