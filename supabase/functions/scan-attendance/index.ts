import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { blockIfMaintenanceMode } from "../_shared/maintenance.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getLibraryAccessKeySuffix, normalizeLibraryAccessKey } from "../../../src/lib/libraryAccessKey.ts";
import { parseStudentQrPayload } from "../../../src/lib/studentQr.ts";
import { logAttendanceFailure } from "../../../src/lib/attendanceFailureLogger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-token",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const resolveErrorStatusCode = (code?: string) => {
  switch (code) {
    case "EXPIRED":
      return 410;
    case "WRONG_LIBRARY":
    case "INVALID_LIBRARY_ID":
    case "DEVICE_BLOCKED":
      return 403;
    case "ALREADY_INSIDE":
      return 409;
    case "TOO_FREQUENT":
      return 429;
    case "ENTRY_CONFLICT":
      return 409;
    case "SERVER_ERROR":
      return 500;
    default:
      return 400;
  }
};

type RpcErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
};

type RpcAttempt = {
  fn: "scan_attendance_entry" | "qr_check_in";
  variant: "scan_attendance_entry" | "qr_check_in_modern" | "qr_check_in_legacy";
  args: Record<string, unknown>;
};

type ValidStudentQrPayload = Extract<Awaited<ReturnType<typeof parseStudentQrPayload>>, { valid: true }>;

type StudentRpcTarget = {
  fallbackQrCode: string;
  resolvedStudentIdentifier: string;
  rpcArgs: Record<string, unknown>;
};

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const looksLikeUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeString(value));

const getRpcErrorRecord = (value: unknown): RpcErrorLike =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RpcErrorLike) : {};

const isMissingRpcFunctionError = (error: unknown) => {
  const record = getRpcErrorRecord(error);
  const code = normalizeString(record.code);
  const message = normalizeString(record.message).toLowerCase();
  const details = normalizeString(record.details).toLowerCase();

  return (
    code === "PGRST202" ||
    message.includes("could not find the function") ||
    details.includes("no matches were found in the schema cache")
  );
};

const normalizeRpcPayload = (result: unknown) => {
  const record =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  const status = normalizeString(record.status).toLowerCase();
  const hasLegacySuccess = typeof record.success === "boolean";
  const isSuccess = status === "success" || (hasLegacySuccess && record.success === true);
  const isError = status === "error" || (hasLegacySuccess && record.success === false);
  const name = normalizeString(record.name) || normalizeString(record.student_name);
  const seat = normalizeString(record.seat);
  const time = normalizeString(record.time);
  const message = normalizeString(record.message) || normalizeString(record.error);
  const code = normalizeString(record.code);
  const actionValue = normalizeString(record.action).toLowerCase().replace(/_/g, "-");
  const action = actionValue === "check-out" ? "check-out" : "check-in";
  const duplicate = record.duplicate === true || normalizeString(record.action) === "duplicate";

  if (isSuccess) {
    return {
      status: "success",
      success: true,
      action,
      ...(name ? { name } : {}),
      ...(name ? { studentName: name, student_name: name } : {}),
      ...(seat ? { seat } : {}),
      ...(time ? { time } : {}),
      ...(message ? { message } : {}),
      ...(duplicate ? { duplicate: true } : {}),
    };
  }

  if (isError) {
    return {
      status: "error",
      success: false,
      message: message || "Invalid ID",
      ...(code ? { code } : {}),
    };
  }

  return {
    status: "error",
    success: false,
    message: "Unexpected scan response",
    code: "SERVER_ERROR",
  };
};

const resolveStudentRpcTarget = async ({
  supabase,
  libraryId,
  parsedQr,
}: {
  supabase: ReturnType<typeof createClient>;
  libraryId: string;
  parsedQr: ValidStudentQrPayload;
}): Promise<StudentRpcTarget> => {
  if (parsedQr.source === "legacy") {
    return {
      fallbackQrCode: parsedQr.qrCode,
      resolvedStudentIdentifier: parsedQr.qrCode,
      rpcArgs: {
        p_qr_code: parsedQr.qrCode,
      },
    };
  }

  const submittedStudentIdentifier = normalizeString(parsedQr.studentId);
  if (!submittedStudentIdentifier) {
    return {
      fallbackQrCode: parsedQr.rawValue,
      resolvedStudentIdentifier: "",
      rpcArgs: {
        p_qr_code: parsedQr.rawValue,
      },
    };
  }

  if (parsedQr.source === "signed" && looksLikeUuid(submittedStudentIdentifier)) {
    return {
      fallbackQrCode: parsedQr.rawValue,
      resolvedStudentIdentifier: submittedStudentIdentifier,
      rpcArgs: {
        p_student_id: submittedStudentIdentifier,
      },
    };
  }

  if (looksLikeUuid(submittedStudentIdentifier)) {
    const { data: byId, error: byIdError } = await supabase
      .from("students")
      .select("id, qr_code")
      .eq("library_id", libraryId)
      .eq("id", submittedStudentIdentifier)
      .maybeSingle();

    if (byIdError) {
      throw byIdError;
    }

    if (byId?.id) {
      return {
        fallbackQrCode: normalizeString(byId.qr_code) || submittedStudentIdentifier,
        resolvedStudentIdentifier: submittedStudentIdentifier,
        rpcArgs: {
          p_student_id: byId.id,
        },
      };
    }
  }

  const { data: byQrCode, error: byQrCodeError } = await supabase
    .from("students")
    .select("id, qr_code")
    .eq("library_id", libraryId)
    .eq("qr_code", submittedStudentIdentifier)
    .maybeSingle();

  if (byQrCodeError) {
    throw byQrCodeError;
  }

  if (byQrCode?.id) {
    return {
      fallbackQrCode: normalizeString(byQrCode.qr_code) || submittedStudentIdentifier,
      resolvedStudentIdentifier: submittedStudentIdentifier,
      rpcArgs: {
        p_student_id: byQrCode.id,
      },
    };
  }

  return {
    fallbackQrCode: submittedStudentIdentifier,
    resolvedStudentIdentifier: submittedStudentIdentifier,
    rpcArgs: {
      p_qr_code: submittedStudentIdentifier,
    },
  };
};

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (value: string) => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(hash);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const maintenanceBlocked = await blockIfMaintenanceMode(corsHeaders);
  if (maintenanceBlocked) return maintenanceBlocked;

  if (req.method !== "POST") {
    return jsonResponse({ status: "error", message: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ status: "error", message: "Supabase environment is not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const route = "/functions/scan-attendance";

  try {
    const { qr_code, device_id, library_id, library_access_key, student_id, entry_id, timestamp } = await req.json();
    const qrCode = String(qr_code ?? "").trim();
    const deviceId = String(device_id ?? "").trim();
    const clientLibraryId = String(library_id ?? "").trim();
    const clientLibraryAccessKey = normalizeLibraryAccessKey(String(library_access_key ?? "").trim());
    const libraryAccessKeySuffix = getLibraryAccessKeySuffix(clientLibraryAccessKey) || null;
    const submittedStudentId = String(student_id ?? "").trim();
    const entryId = String(entry_id ?? "").trim();
    const entryTimestamp = String(timestamp ?? "").trim() || new Date().toISOString();
    const deviceTokenHeader = req.headers.get("x-device-token");
    const bearerHeader = req.headers.get("Authorization");
    const deviceToken = deviceTokenHeader?.trim() || bearerHeader?.replace("Bearer ", "").trim() || "";

    if (!qrCode || !deviceId || !entryId) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Missing scan data, device_id, or entry_id",
        code: "INVALID_QR",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId || null,
          entry_id: entryId || null,
          library_id: clientLibraryId || null,
          stage: "missing_input",
        },
      });

      return jsonResponse({ status: "error", message: "Missing scan data, device_id, or entry_id", code: "INVALID_QR" }, 400);
    }

    if (!clientLibraryAccessKey) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Library ID missing",
        code: "INVALID_LIBRARY_ID",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: clientLibraryId || null,
          stage: "missing_library_access_key",
        },
      });

      return jsonResponse({ status: "error", message: "Library ID missing", code: "INVALID_LIBRARY_ID" }, 403);
    }

    const { data: libraryAccessKeyRecord, error: libraryAccessKeyError } = await supabase
      .from("library_access_keys")
      .select("library_id")
      .eq("access_key", clientLibraryAccessKey)
      .maybeSingle();

    if (libraryAccessKeyError) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: libraryAccessKeyError.message || "Unable to validate the Library ID",
        code: "SERVER_ERROR",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: clientLibraryId || null,
          library_access_key_suffix: libraryAccessKeySuffix,
          stage: "library_access_key_lookup",
        },
      });

      return jsonResponse({ status: "error", message: "Unable to validate the Library ID", code: "SERVER_ERROR" }, 500);
    }

    if (!libraryAccessKeyRecord?.library_id) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Library ID invalid",
        code: "INVALID_LIBRARY_ID",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: clientLibraryId || null,
          library_access_key_suffix: libraryAccessKeySuffix,
          stage: "invalid_library_access_key",
        },
      });

      return jsonResponse(
        { status: "error", message: "Library ID invalid. Reconnect this device.", code: "INVALID_LIBRARY_ID" },
        403,
      );
    }

    const resolvedLibraryId = libraryAccessKeyRecord.library_id;

    const { data: device, error: deviceError } = await supabase
      .from("entry_devices")
      .select("id, library_id, secret_token_hash, is_active")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (deviceError) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: deviceError.message || "Unable to validate the scanning device",
        code: "SERVER_ERROR",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: resolvedLibraryId,
          library_access_key_suffix: libraryAccessKeySuffix,
          stage: "device_lookup",
        },
      });

      return jsonResponse({ status: "error", message: "Unable to validate the scanning device", code: "SERVER_ERROR" }, 500);
    }

    if (!device || !device.is_active) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Device not allowed",
        code: "DEVICE_BLOCKED",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: resolvedLibraryId,
          library_access_key_suffix: libraryAccessKeySuffix,
          stage: "device_blocked",
        },
      });

      return jsonResponse({ status: "error", message: "Device not allowed", code: "DEVICE_BLOCKED" }, 403);
    }

    if (clientLibraryId && clientLibraryId !== resolvedLibraryId) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Invalid Library",
        code: "WRONG_LIBRARY",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: clientLibraryId,
          expected_library_id: resolvedLibraryId,
          library_access_key_suffix: libraryAccessKeySuffix,
          stage: "library_mismatch",
        },
      });

      return jsonResponse({ status: "error", message: "Invalid Library", code: "WRONG_LIBRARY" }, 403);
    }

    if (device.library_id !== resolvedLibraryId) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Invalid Library",
        code: "WRONG_LIBRARY",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: resolvedLibraryId,
          expected_library_id: device.library_id,
          library_access_key_suffix: libraryAccessKeySuffix,
          stage: "device_library_mismatch",
        },
      });

      return jsonResponse({ status: "error", message: "Invalid Library", code: "WRONG_LIBRARY" }, 403);
    }

    if (device.secret_token_hash) {
      if (!deviceToken) {
        await logAttendanceFailure({
          client: supabase,
          route,
          message: "Device token missing",
          code: "DEVICE_BLOCKED",
          source: "scan-attendance-edge",
          metadata: {
            device_id: deviceId,
            entry_id: entryId,
            stage: "device_token_missing",
          },
        });

        return jsonResponse({ status: "error", message: "Device token missing", code: "DEVICE_BLOCKED" }, 401);
      }

      const incomingHash = await sha256(deviceToken);
      if (incomingHash !== device.secret_token_hash) {
        await logAttendanceFailure({
          client: supabase,
          route,
          message: "Device token invalid",
          code: "DEVICE_BLOCKED",
          source: "scan-attendance-edge",
          metadata: {
            device_id: deviceId,
            entry_id: entryId,
            stage: "device_token_invalid",
          },
        });

        return jsonResponse({ status: "error", message: "Device token invalid", code: "DEVICE_BLOCKED" }, 403);
      }
    }

    const parsedQr = await parseStudentQrPayload(qrCode, {
      expectedLibraryId: device.library_id,
      publicKeyPem:
        Deno.env.get("STUDENT_QR_PUBLIC_KEY") ??
        Deno.env.get("VITE_QR_PUBLIC_KEY") ??
        Deno.env.get("VITE_STUDENT_QR_PUBLIC_KEY") ??
        Deno.env.get("QR_VERIFY_PUBLIC_KEY"),
      allowLegacy: true,
      now: entryTimestamp,
    });

    if (!parsedQr || !parsedQr.valid) {
      const code = parsedQr && "code" in parsedQr ? parsedQr.code : "INVALID_QR";
      const message = parsedQr && "message" in parsedQr ? parsedQr.message : "Invalid ID";
      const status = resolveErrorStatusCode(code);

      await logAttendanceFailure({
        client: supabase,
        route,
        message,
        code,
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: device.library_id,
          library_access_key_suffix: libraryAccessKeySuffix,
          student_id: submittedStudentId || null,
          stage: "qr_validation",
        },
      });

      return jsonResponse({ status: "error", code, message }, status);
    }

    const resolvedStudentIdentifier = parsedQr.source === "legacy" ? parsedQr.qrCode : parsedQr.studentId;

    if (submittedStudentId && submittedStudentId !== resolvedStudentIdentifier) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Invalid ID",
        code: "INVALID_QR",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: device.library_id,
          library_access_key_suffix: libraryAccessKeySuffix,
          student_id: submittedStudentId,
          expected_student_id: resolvedStudentIdentifier,
          stage: "student_mismatch",
        },
      });

      return jsonResponse({ status: "error", code: "INVALID_QR", message: "Invalid ID" }, 400);
    }

    let studentRpcTarget: StudentRpcTarget;
    try {
      studentRpcTarget = await resolveStudentRpcTarget({
        supabase,
        libraryId: resolvedLibraryId,
        parsedQr,
      });
    } catch (error) {
      const lookupMessage = error instanceof Error ? error.message : "Unable to resolve the scanned student";

      await logAttendanceFailure({
        client: supabase,
        route,
        message: lookupMessage,
        code: "SERVER_ERROR",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: resolvedLibraryId,
          student_id: resolvedStudentIdentifier,
          stage: "student_resolution",
        },
      });

      return jsonResponse(
        { status: "error", success: false, message: "Unable to verify this QR right now.", code: "SERVER_ERROR" },
        500,
      );
    }

    const modernRpcArgs: Record<string, unknown> = {
      p_device_id: deviceId,
      p_entry_id: entryId,
      p_entry_timestamp: entryTimestamp,
      p_library_id: resolvedLibraryId,
      ...studentRpcTarget.rpcArgs,
    };
    const fallbackQrCode = studentRpcTarget.fallbackQrCode;
    const rpcAttempts: RpcAttempt[] = [
      {
        fn: "scan_attendance_entry",
        variant: "scan_attendance_entry",
        args: modernRpcArgs,
      },
      {
        fn: "qr_check_in",
        variant: "qr_check_in_modern",
        args: modernRpcArgs,
      },
      {
        fn: "qr_check_in",
        variant: "qr_check_in_legacy",
        args: {
          p_qr_code: fallbackQrCode,
          p_library_id: resolvedLibraryId,
        },
      },
    ];
    let result: unknown = null;
    let scanError: unknown = null;
    let rpcVariant: RpcAttempt["variant"] | null = null;

    for (const attempt of rpcAttempts) {
      const rpcResponse = await supabase.rpc(attempt.fn, attempt.args);

      if (!rpcResponse.error) {
        result = rpcResponse.data;
        scanError = null;
        rpcVariant = attempt.variant;
        break;
      }

      scanError = rpcResponse.error;
      rpcVariant = attempt.variant;

      const shouldTryNext =
        isMissingRpcFunctionError(rpcResponse.error) && attempt.variant !== "qr_check_in_legacy";

      if (!shouldTryNext) {
        break;
      }
    }

    if (scanError) {
      const scanErrorRecord = getRpcErrorRecord(scanError);
      const scanErrorMessage = normalizeString(scanErrorRecord.message) || "Unable to record the scan";
      const scanErrorCode = normalizeString(scanErrorRecord.code);
      const scanErrorDetails = normalizeString(scanErrorRecord.details);

      await logAttendanceFailure({
        client: supabase,
        route,
        message: scanErrorMessage,
        code: "SERVER_ERROR",
        source: "scan-attendance-edge",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: resolvedLibraryId,
          library_access_key_suffix: libraryAccessKeySuffix,
          student_id: resolvedStudentIdentifier,
          stage: "rpc_failure",
          rpc_variant: rpcVariant,
          rpc_error_code: scanErrorCode || null,
          rpc_error_details: scanErrorDetails || null,
        },
      });

      return jsonResponse(
        { status: "error", message: scanErrorMessage || "Unable to record the scan", code: "SERVER_ERROR" },
        500,
      );
    }

    await supabase
      .from("entry_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id);

    const payload = normalizeRpcPayload(result);
    const payloadCode = typeof payload.code === "string" ? payload.code : undefined;
    const payloadStatus = typeof payload.status === "string" ? payload.status : "success";

    return jsonResponse(payload, payloadStatus === "error" ? resolveErrorStatusCode(payloadCode) : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected scan failure";

    await logAttendanceFailure({
      client: supabase,
      route,
      message,
      code: "SERVER_ERROR",
      source: "scan-attendance-edge",
      metadata: {
        stage: "unexpected_exception",
      },
    });

    return jsonResponse({ status: "error", message, code: "SERVER_ERROR" }, 500);
  }
});
