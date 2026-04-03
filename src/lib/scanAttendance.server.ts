import { createClient } from "@supabase/supabase-js";
import { getLibraryAccessKeySuffix, normalizeLibraryAccessKey } from "./libraryAccessKey";
import { parseStudentQrPayload } from "./studentQr";
import { logAttendanceFailure } from "./attendanceFailureLogger";

type EnvLike = Record<string, string | undefined>;

export type ScanAttendanceResponseBody = {
  status: "success" | "error";
  name?: string;
  seat?: string;
  time?: string;
  message?: string;
  duplicate?: boolean;
  code?: string;
};

export type ScanAttendanceServiceResponse = {
  statusCode: number;
  body: ScanAttendanceResponseBody;
};

type ScanAttendanceRequestBody = Record<string, unknown>;

type ScanAttendanceHeaders = {
  deviceToken?: string;
};

const readEnv = (env: EnvLike, ...names: string[]) => {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const normalizeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const readStringField = (body: ScanAttendanceRequestBody, ...keys: string[]) => {
  for (const key of keys) {
    const normalized = normalizeString(body[key]);
    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const buildError = (message: string, statusCode: number, code?: string): ScanAttendanceServiceResponse => ({
  statusCode,
  body: {
    status: "error",
    message,
    ...(code ? { code } : {}),
  },
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

export const resolveScanAttendanceRequest = async (
  env: EnvLike,
  requestBody: unknown,
  headers: ScanAttendanceHeaders = {},
): Promise<ScanAttendanceServiceResponse> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as ScanAttendanceRequestBody)
      : {};
  const route = "/api/scan-attendance";
  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return buildError("Supabase environment is not configured", 500, "CONFIG_ERROR");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const qrCode = readStringField(body, "qr_code", "qrCode");
  const deviceId = readStringField(body, "device_id", "deviceId");
  const clientLibraryId = readStringField(body, "library_id", "libraryId");
  const clientLibraryAccessKey = normalizeLibraryAccessKey(
    readStringField(body, "library_access_key", "libraryAccessKey"),
  );
  const studentId = readStringField(body, "student_id", "studentId");
  const entryId = readStringField(body, "entry_id", "entryId");
  const entryTimestamp = readStringField(body, "timestamp", "entry_timestamp", "entryTimestamp") || new Date().toISOString();

  if (!qrCode || !deviceId || !entryId) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: "Missing scan data, device_id, or entry_id",
      code: "INVALID_QR",
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId || null,
        entry_id: entryId || null,
        library_id: clientLibraryId || null,
        stage: "missing_input",
      },
    });

    return buildError("Missing scan data, device_id, or entry_id", 400, "INVALID_QR");
  }

  if (!clientLibraryAccessKey) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: "Library ID missing",
      code: "INVALID_LIBRARY_ID",
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId || null,
        entry_id: entryId || null,
        library_id: clientLibraryId || null,
        stage: "missing_library_access_key",
      },
    });

    return buildError("Library ID missing", 403, "INVALID_LIBRARY_ID");
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
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: clientLibraryId || null,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        stage: "library_access_key_lookup",
      },
    });

    return buildError("Unable to validate the Library ID", 500, "SERVER_ERROR");
  }

  if (!libraryAccessKeyRecord?.library_id) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: "Library ID invalid",
      code: "INVALID_LIBRARY_ID",
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: clientLibraryId || null,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        stage: "invalid_library_access_key",
      },
    });

    return buildError("Library ID invalid. Reconnect this device.", 403, "INVALID_LIBRARY_ID");
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
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        stage: "device_lookup",
      },
    });

    return buildError("Unable to validate the scanning device", 500, "SERVER_ERROR");
  }

  if (!device || !device.is_active) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: "Device not allowed",
      code: "DEVICE_BLOCKED",
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        stage: "device_blocked",
      },
    });

    return buildError("Device not allowed", 403, "DEVICE_BLOCKED");
  }

  if (clientLibraryId && clientLibraryId !== resolvedLibraryId) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: "Wrong Library",
      code: "WRONG_LIBRARY",
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: clientLibraryId,
        expected_library_id: resolvedLibraryId,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        stage: "library_mismatch",
      },
    });

    return buildError("Wrong Library", 403, "WRONG_LIBRARY");
  }

  if (device.library_id !== resolvedLibraryId) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: "Wrong Library",
      code: "WRONG_LIBRARY",
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: resolvedLibraryId,
        expected_library_id: device.library_id,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        stage: "device_library_mismatch",
      },
    });

    return buildError("Wrong Library", 403, "WRONG_LIBRARY");
  }

  const providedToken =
    normalizeString(headers.deviceToken) ||
    normalizeString(body.device_token) ||
    normalizeString(body.deviceToken);

  if (device.secret_token_hash) {
    if (!providedToken) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Device token missing",
        code: "DEVICE_BLOCKED",
        source: "scan-attendance-server",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          stage: "device_token_missing",
        },
      });

      return buildError("Device token missing", 401, "DEVICE_BLOCKED");
    }

    const tokenHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(providedToken)),
    );
    const incomingHash = [...tokenHash].map((byte) => byte.toString(16).padStart(2, "0")).join("");

    if (incomingHash !== device.secret_token_hash) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Device token invalid",
        code: "DEVICE_BLOCKED",
        source: "scan-attendance-server",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          stage: "device_token_invalid",
        },
      });

      return buildError("Device token invalid", 403, "DEVICE_BLOCKED");
    }
  }

  const parsedQr = await parseStudentQrPayload(qrCode, {
    expectedLibraryId: device.library_id,
    publicKeyPem: readEnv(
      env,
      "STUDENT_QR_PUBLIC_KEY",
      "VITE_QR_PUBLIC_KEY",
      "VITE_STUDENT_QR_PUBLIC_KEY",
      "QR_VERIFY_PUBLIC_KEY",
    ),
    allowLegacy: true,
    now: entryTimestamp,
  });

  if (!parsedQr || !parsedQr.valid) {
    const code = parsedQr && "code" in parsedQr ? parsedQr.code : "INVALID_QR";
    const message = parsedQr && "message" in parsedQr ? parsedQr.message : "Invalid ID";
    const statusCode = resolveErrorStatusCode(code);

    await logAttendanceFailure({
      client: supabase,
      route,
      message,
      code,
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: device.library_id,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        student_id: studentId || null,
        stage: "qr_validation",
      },
    });

    return buildError(message, statusCode, code);
  }

  const resolvedStudentIdentifier = parsedQr.source === "legacy" ? parsedQr.qrCode : parsedQr.studentId;

  if (studentId && studentId !== resolvedStudentIdentifier) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: "Invalid ID",
      code: "INVALID_QR",
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: device.library_id,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        student_id: studentId,
        expected_student_id: resolvedStudentIdentifier,
        stage: "student_mismatch",
      },
    });

    return buildError("Invalid ID", 400, "INVALID_QR");
  }

  const { data: result, error: scanError } = await supabase.rpc("scan_attendance_entry", {
    p_device_id: deviceId,
    p_library_id: resolvedLibraryId,
    ...(parsedQr.source === "legacy"
      ? { p_qr_code: parsedQr.qrCode }
      : { p_student_id: parsedQr.studentId }),
    p_entry_id: entryId,
    p_entry_timestamp: entryTimestamp,
  });

  if (scanError) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: scanError.message || "Unable to record the scan",
      code: "SERVER_ERROR",
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        student_id: resolvedStudentIdentifier,
        stage: "rpc_failure",
      },
    });

    return buildError("Unable to record the scan", 500, "SERVER_ERROR");
  }

  await supabase
    .from("entry_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id);

  const payload =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as ScanAttendanceResponseBody)
      : {
          status: "error",
          message: "Unexpected scan response",
          code: "SERVER_ERROR",
        };

  const payloadStatusCode = payload.status === "error" ? resolveErrorStatusCode(payload.code) : 200;

  return {
    statusCode: payloadStatusCode,
    body: payload,
  };
};
