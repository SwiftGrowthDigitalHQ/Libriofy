import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import {
  buildRecoveryScript,
  deriveRecoveryCandidates,
  formatInr,
  groupPaymentsByStudent,
  normalizePhone,
  type RecoveryPaymentRow,
  type RecoveryPlanRow,
  type RecoveryStudentRow,
} from "../_shared/payment-recovery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RECOVERY_CALL_AUDIO_BUCKET = "recovery-call-audio";

type StartRecoveryCallRequest = {
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
  owner_id: string | null;
};

type InsertedCallRow = {
  id: string;
};

type GeneratedAudio = {
  bytes: Uint8Array;
  contentType: string;
  fileExtension: string;
  provider: string;
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

const encodeWebhookUrl = ({
  baseUrl,
  callId,
  mode,
  secret,
}: {
  baseUrl: string;
  callId: string;
  mode: "ivr" | "status" | "twiml";
  secret: string | null;
}) => {
  const url = new URL(baseUrl);
  url.searchParams.set("callId", callId);
  url.searchParams.set("mode", mode);

  if (secret) {
    url.searchParams.set("secret", secret);
  }

  return url.toString();
};

const generateElevenLabsAudio = async (scriptText: string): Promise<GeneratedAudio | null> => {
  const apiKey = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim();
  const voiceId = (Deno.env.get("ELEVENLABS_VOICE_ID") || "").trim();
  if (!apiKey || !voiceId) return null;

  const modelId = (Deno.env.get("ELEVENLABS_MODEL_ID") || "eleven_turbo_v2_5").trim();
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      model_id: modelId,
      text: scriptText,
      voice_settings: {
        similarity_boost: 0.72,
        stability: 0.4,
        style: 0.2,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const rawError = await response.text();
    const payload = parseJsonSafely(rawError);
    throw new Error(payload?.detail?.message || payload?.message || `ElevenLabs TTS failed with status ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    contentType: "audio/mpeg",
    fileExtension: "mp3",
    provider: "elevenlabs",
  };
};

const base64ToBytes = (raw: string) => Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));

const generateGoogleAudio = async (scriptText: string): Promise<GeneratedAudio | null> => {
  const apiKey = (Deno.env.get("GOOGLE_TTS_API_KEY") || "").trim();
  if (!apiKey) return null;

  const voiceName = (Deno.env.get("GOOGLE_TTS_VOICE_NAME") || "en-IN-Wavenet-A").trim();
  const languageCode = (Deno.env.get("GOOGLE_TTS_LANGUAGE_CODE") || "en-IN").trim();
  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 0.98,
      },
      input: {
        text: scriptText,
      },
      voice: {
        languageCode,
        name: voiceName,
      },
    }),
  });

  const rawText = await response.text();
  const payload = parseJsonSafely(rawText);

  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Google TTS failed with status ${response.status}`);
  }

  if (!payload?.audioContent || typeof payload.audioContent !== "string") {
    throw new Error("Google TTS did not return audio content.");
  }

  return {
    bytes: base64ToBytes(payload.audioContent),
    contentType: "audio/mpeg",
    fileExtension: "mp3",
    provider: "google_tts",
  };
};

const generateSpeechAudio = async (scriptText: string): Promise<GeneratedAudio | null> => {
  const elevenLabsAudio = await generateElevenLabsAudio(scriptText);
  if (elevenLabsAudio) return elevenLabsAudio;

  const googleAudio = await generateGoogleAudio(scriptText);
  if (googleAudio) return googleAudio;

  return null;
};

const createTwilioCall = async ({
  accountSid,
  authToken,
  from,
  statusCallbackUrl,
  to,
  twimlUrl,
}: {
  accountSid: string;
  authToken: string;
  from: string;
  statusCallbackUrl: string;
  to: string;
  twimlUrl: string;
}) => {
  const payload = new URLSearchParams();
  payload.set("To", to);
  payload.set("From", from);
  payload.set("Url", twimlUrl);
  payload.set("Method", "POST");
  payload.set("StatusCallback", statusCallbackUrl);
  payload.set("StatusCallbackMethod", "POST");
  payload.append("StatusCallbackEvent", "initiated");
  payload.append("StatusCallbackEvent", "ringing");
  payload.append("StatusCallbackEvent", "answered");
  payload.append("StatusCallbackEvent", "completed");

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  const rawText = await response.text();
  const responsePayload = parseJsonSafely(rawText);

  if (!response.ok) {
    throw new Error(responsePayload?.message || `Twilio call failed with status ${response.status}`);
  }

  return {
    sid: responsePayload?.sid ? String(responsePayload.sid) : null,
    status: responsePayload?.status ? String(responsePayload.status) : "queued",
  };
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

    const body = (await req.json().catch(() => ({}))) as StartRecoveryCallRequest;
    const requestedLibraryId = String(body?.libraryId ?? "").trim();
    const limit = clampInt(body?.limit, 1, 25, 5);
    const requestedStudentIds = Array.isArray(body?.studentIds)
      ? body.studentIds.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const source = String(body?.source ?? "payments_page").trim() || "payments_page";

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const twilioAccountSid = (Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
    const twilioAuthToken = (Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();
    const twilioCallFrom = (Deno.env.get("TWILIO_CALL_FROM") || Deno.env.get("TWILIO_PHONE_NUMBER") || "").trim();
    const callbackSecret = (Deno.env.get("PAYMENT_CALL_WEBHOOK_SECRET") || "").trim() || null;
    const defaultCountryCode = (Deno.env.get("DEFAULT_COUNTRY_CODE") || "+91").trim();

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase secrets missing" }, 500);
    }

    if (!twilioAccountSid || !twilioAuthToken || !twilioCallFrom) {
      return json(
        {
          error: "Twilio calling is not configured.",
          hint: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_CALL_FROM.",
        },
        500,
      );
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

    const [libraryRes, studentsRes, plansRes, paymentsRes] = await Promise.all([
      supabase.from("libraries").select("id, name, owner_id").eq("id", libraryId).maybeSingle(),
      supabase
        .from("students")
        .select("id, expiry_date, full_name, phone, plan, plan_id, seat_number, slot, start_date, status")
        .eq("library_id", libraryId)
        .eq("status", "active"),
      supabase.from("plans").select("id, name, price").eq("library_id", libraryId),
      supabase
        .from("payments")
        .select("amount, created_at, id, payment_method, period_end, period_start, plan, status, student_id")
        .eq("library_id", libraryId)
        .order("created_at", { ascending: false }),
    ]);

    if (libraryRes.error) throw libraryRes.error;
    if (studentsRes.error) throw studentsRes.error;
    if (plansRes.error) throw plansRes.error;
    if (paymentsRes.error) throw paymentsRes.error;

    const library = libraryRes.data as LibraryRow | null;
    if (!library) {
      return json({ error: "Library not found" }, 404);
    }

    const students = (studentsRes.data ?? []) as RecoveryStudentRow[];
    const plans = (plansRes.data ?? []) as RecoveryPlanRow[];
    const payments = (paymentsRes.data ?? []) as RecoveryPaymentRow[];
    const paymentsByStudent = groupPaymentsByStudent(payments);
    const recoveryCandidates = deriveRecoveryCandidates({
      plans,
      studentPayments: paymentsByStudent,
      students,
      today: new Date(),
    });

    const candidatePool = requestedStudentIds.length > 0
      ? recoveryCandidates.filter((candidate) => requestedStudentIds.includes(candidate.studentId))
      : recoveryCandidates.slice(0, limit);

    const callableCandidates = candidatePool.filter((candidate) => normalizePhone(candidate.phone, defaultCountryCode));
    const skipped = candidatePool
      .filter((candidate) => !normalizePhone(candidate.phone, defaultCountryCode))
      .map((candidate) => ({
        reason: "Missing phone number",
        studentId: candidate.studentId,
        studentName: candidate.fullName,
      }));

    if (callableCandidates.length === 0) {
      return json({
        error: "No callable unpaid students found.",
        skipped,
      }, 400);
    }

    const webhookBaseUrl = `${supabaseUrl}/functions/v1/payment-recovery-call-status`;
    const started: Array<{
      amountDue: number;
      callId: string;
      callStatus: string;
      providerCallSid: string | null;
      studentId: string;
      studentName: string;
      ttsProvider: string;
    }> = [];
    const failed: Array<{
      error: string;
      studentId: string;
      studentName: string;
    }> = [];

    for (const candidate of callableCandidates) {
      const normalizedPhone = normalizePhone(candidate.phone, defaultCountryCode);
      if (!normalizedPhone) continue;

      const scriptText = buildRecoveryScript({
        amountDue: candidate.amountDue,
        libraryName: library.name,
        studentName: candidate.fullName,
      });

      const insertPayload = {
        called_phone: normalizedPhone,
        call_provider: "twilio",
        created_by: userId,
        estimated_recovery_impact: candidate.amountDue,
        library_id: libraryId,
        library_name_snapshot: library.name,
        metadata: {
          initiated_from: source,
          plan_name: candidate.planName,
          seat_number: candidate.seatNumber,
          slot_label: candidate.slotLabel,
          total_fees: candidate.totalFees,
        },
        overdue_days_snapshot: candidate.overdueDays,
        payment_status_snapshot: candidate.paymentStatus,
        pending_amount_snapshot: candidate.amountDue,
        pickup_status: "pending",
        recovery_stage_label: candidate.recoveryUrgencyLabel,
        script_text: scriptText,
        student_id: candidate.studentId,
        student_name_snapshot: candidate.fullName,
        trigger_source: source,
        tts_provider: "twilio_say",
      };

      const { data: insertedCall, error: insertError } = await supabase
        .from("automated_calls")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError) {
        failed.push({
          error: insertError.message,
          studentId: candidate.studentId,
          studentName: candidate.fullName,
        });
        continue;
      }

      const callRow = insertedCall as InsertedCallRow;
      let ttsProvider = "twilio_say";
      let metadataUpdate: Record<string, unknown> = insertPayload.metadata;

      try {
        const generatedAudio = await generateSpeechAudio(scriptText);
        if (generatedAudio) {
          const audioPath = `${libraryId}/${callRow.id}.${generatedAudio.fileExtension}`;
          const audioBlob = new Blob([generatedAudio.bytes], { type: generatedAudio.contentType });
          const { error: uploadError } = await supabase.storage
            .from(RECOVERY_CALL_AUDIO_BUCKET)
            .upload(audioPath, audioBlob, {
              contentType: generatedAudio.contentType,
              upsert: true,
            });

          if (uploadError) {
            throw uploadError;
          }

          ttsProvider = generatedAudio.provider;
          metadataUpdate = {
            ...metadataUpdate,
            audio_generated: true,
          };

          await supabase
            .from("automated_calls")
            .update({
              audio_bucket: RECOVERY_CALL_AUDIO_BUCKET,
              audio_path: audioPath,
              metadata: metadataUpdate,
              tts_provider: generatedAudio.provider,
            })
            .eq("id", callRow.id);
        }
      } catch (ttsError) {
        metadataUpdate = {
          ...metadataUpdate,
          audio_generated: false,
          tts_warning: ttsError instanceof Error ? ttsError.message : "Audio generation failed",
        };

        await supabase
          .from("automated_calls")
          .update({
            metadata: metadataUpdate,
            tts_provider: "twilio_say",
          })
          .eq("id", callRow.id);
      }

      try {
        const twimlUrl = encodeWebhookUrl({
          baseUrl: webhookBaseUrl,
          callId: callRow.id,
          mode: "twiml",
          secret: callbackSecret,
        });
        const statusCallbackUrl = encodeWebhookUrl({
          baseUrl: webhookBaseUrl,
          callId: callRow.id,
          mode: "status",
          secret: callbackSecret,
        });

        const callResult = await createTwilioCall({
          accountSid: twilioAccountSid,
          authToken: twilioAuthToken,
          from: twilioCallFrom,
          statusCallbackUrl,
          to: normalizedPhone,
          twimlUrl,
        });

        await supabase
          .from("automated_calls")
          .update({
            call_status: callResult.status || "queued",
            metadata: metadataUpdate,
            provider_call_sid: callResult.sid,
            status_callback_payload: {
              initiated_at: new Date().toISOString(),
              twilio_status: callResult.status || "queued",
            },
            tts_provider: ttsProvider,
          })
          .eq("id", callRow.id);

        started.push({
          amountDue: candidate.amountDue,
          callId: callRow.id,
          callStatus: callResult.status || "queued",
          providerCallSid: callResult.sid,
          studentId: candidate.studentId,
          studentName: candidate.fullName,
          ttsProvider,
        });
      } catch (callError) {
        const errorMessage = callError instanceof Error ? callError.message : "Call trigger failed";

        await supabase
          .from("automated_calls")
          .update({
            call_status: "failed",
            error_message: errorMessage,
            metadata: metadataUpdate,
            pickup_status: "not_picked",
            tts_provider: ttsProvider,
          })
          .eq("id", callRow.id);

        failed.push({
          error: errorMessage,
          studentId: candidate.studentId,
          studentName: candidate.fullName,
        });
      }
    }

    if (started.length === 0) {
      return json(
        {
          error: "Unable to start any automated recovery calls.",
          failed,
          skipped,
        },
        500,
      );
    }

    return json({
      estimatedRecoveryImpact: started.reduce((sum, item) => sum + item.amountDue, 0),
      failed,
      message:
        started.length === 1
          ? `Started 1 recovery call for ${started[0].studentName}.`
          : `Started ${started.length} recovery calls worth ${formatInr(started.reduce((sum, item) => sum + item.amountDue, 0))}.`,
      queuedCalls: started.length,
      skipped,
      started,
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
