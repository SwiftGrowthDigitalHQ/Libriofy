import { createClient } from "@supabase/supabase-js";
import { getLibraryAccessKeySuffix, normalizeLibraryAccessKey } from "./libraryAccessKey.js";
import { resolvePublicScanDenial } from "./scanDenial.js";
import { parseStudentQrPayload } from "./studentQr.js";
import { logAttendanceFailure } from "./attendanceFailureLogger.js";
import { createInstrumentedServerSupabaseFetch } from "./observability/serverSupabaseFetch.server.js";

type EnvLike = Record<string, string | undefined>;

export type ScanAttendanceResponseBody = {
  status: "success" | "error";
  success?: boolean;
  action?: "check-in" | "check-out";
  name?: string;
  studentName?: string;
  student_name?: string;
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

type StudentQrParseResult = Awaited<ReturnType<typeof parseStudentQrPayload>>;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type DeviceLookupRecord = {
  id: string;
  library_id: string;
  secret_token_hash: string | null;
  is_active: boolean | null;
};

const LIBRARY_ACCESS_KEY_CACHE_TTL_MS = 60_000;
const DEVICE_LOOKUP_CACHE_TTL_MS = 60_000;
const STUDENT_QR_PARSE_CACHE_TTL_MS = 45_000;
const STUDENT_QR_INVALID_CACHE_TTL_MS = 5_000;
const STUDENT_LOOKUP_CACHE_TTL_MS = 60_000;
const SUBSCRIPTION_CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 256;

const libraryAccessKeyCache = new Map<string, CacheEntry<string | null>>();
const deviceLookupCache = new Map<string, CacheEntry<DeviceLookupRecord | null>>();
const studentQrParseCache = new Map<string, CacheEntry<StudentQrParseResult>>();
const studentRpcTargetCache = new Map<string, CacheEntry<StudentRpcTarget>>();
const subscriptionStateCache = new Map<string, CacheEntry<{ blocked: boolean }>>();

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

const getCacheValue = <T>(cache: Map<string, CacheEntry<T>>, key: string) => {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return entry.value;
};

const setCacheValue = <T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) => {
  if (ttlMs <= 0) {
    return value;
  }

  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });

  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }

    cache.delete(oldestKey);
  }

  return value;
};

const looksLikeUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeString(value));

const readStringField = (body: ScanAttendanceRequestBody, ...keys: string[]) => {
  for (const key of keys) {
    const normalized = normalizeString(body[key]);
    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const buildError = (message: string, statusCode: number, code?: string): ScanAttendanceServiceResponse => {
  const publicDenial = resolvePublicScanDenial({
    code,
    message,
  });

  return {
    statusCode,
    body: {
      status: "error",
      success: false,
      code: publicDenial.code,
      message: publicDenial.message,
    },
  };
};

const resolveStudentQrParseCacheTtlMs = (parsedQr: StudentQrParseResult, now: Date) => {
  if (!parsedQr) {
    return STUDENT_QR_INVALID_CACHE_TTL_MS;
  }

  if (parsedQr.valid && parsedQr.source === "signed") {
    const remainingMs = parsedQr.exp * 1000 - now.getTime() - 2_000;
    return Math.max(0, Math.min(STUDENT_QR_PARSE_CACHE_TTL_MS, remainingMs));
  }

  return parsedQr.valid ? STUDENT_QR_PARSE_CACHE_TTL_MS : STUDENT_QR_INVALID_CACHE_TTL_MS;
};

const resolveErrorStatusCode = (code?: string) => {
  switch (code) {
    case "EXPIRED":
    case "TOKEN_EXPIRED":
      return 410;
    case "WRONG_LIBRARY":
    case "INVALID_LIBRARY_ID":
    case "DEVICE_BLOCKED":
    case "LIBRARY_MISMATCH":
    case "DEVICE_MISMATCH":
    case "ACCESS_DENIED":
    case "SUBSCRIPTION_EXPIRED":
      return 403;
    case "ALREADY_INSIDE":
    case "ALREADY_CHECKED_IN":
    case "DUPLICATE_SCAN":
      return 409;
    case "TOO_FREQUENT":
    case "RATE_LIMITED":
      return 429;
    case "ENTRY_CONFLICT":
      return 409;
    case "SERVER_ERROR":
    case "INTERNAL_ERROR":
      return 500;
    case "USER_NOT_FOUND":
      return 404;
    default:
      return 400;
  }
};

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

const normalizeRpcPayload = (result: unknown): ScanAttendanceResponseBody => {
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
    const publicDenial = resolvePublicScanDenial({
      code,
      message,
    });

    return {
      status: "error",
      success: false,
      code: publicDenial.code,
      message: publicDenial.message,
    };
  }

  const publicDenial = resolvePublicScanDenial({
    code: "SERVER_ERROR",
    message: "Unexpected scan response",
  });

  return {
    status: "error",
    success: false,
    code: publicDenial.code,
    message: publicDenial.message,
  };
};

const resolveLibraryIdFromAccessKey = async ({
  accessKey,
  supabase,
}: {
  accessKey: string;
  supabase: any;
}) => {
  const cachedLibraryId = getCacheValue(libraryAccessKeyCache, accessKey);
  if (cachedLibraryId !== undefined) {
    return cachedLibraryId;
  }

  const { data, error } = await supabase
    .from("library_access_keys")
    .select("library_id")
    .eq("access_key", accessKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return setCacheValue(
    libraryAccessKeyCache,
    accessKey,
    normalizeString(data?.library_id) || null,
    LIBRARY_ACCESS_KEY_CACHE_TTL_MS,
  );
};

const resolveDeviceLookup = async ({
  deviceId,
  supabase,
}: {
  deviceId: string;
  supabase: any;
}) => {
  const cachedDevice = getCacheValue(deviceLookupCache, deviceId);
  if (cachedDevice !== undefined) {
    return cachedDevice;
  }

  const { data, error } = await supabase
    .from("entry_devices")
    .select("id, library_id, secret_token_hash, is_active")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const normalizedDevice = data
    ? ({
        id: normalizeString(data.id),
        library_id: normalizeString(data.library_id),
        secret_token_hash: normalizeString(data.secret_token_hash) || null,
        is_active: data.is_active === false ? false : Boolean(data.is_active),
      } satisfies DeviceLookupRecord)
    : null;

  return setCacheValue(deviceLookupCache, deviceId, normalizedDevice, DEVICE_LOOKUP_CACHE_TTL_MS);
};

const resolveSubscriptionBlockedState = async ({
  libraryId,
  supabase,
}: {
  libraryId: string;
  supabase: any;
}) => {
  const cachedState = getCacheValue(subscriptionStateCache, libraryId);
  if (cachedState !== undefined) {
    return cachedState.blocked;
  }

  const { data: subscriptionRecord, error } = await supabase
    .from("library_subscriptions")
    .select("status, payment_status, updated_at")
    .eq("library_id", libraryId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const subStatus = normalizeString(subscriptionRecord?.status).toLowerCase();
  const paymentStatus = normalizeString(subscriptionRecord?.payment_status).toLowerCase();
  const blocked = subStatus === "expired" || subStatus === "cancelled" || paymentStatus === "failed";

  setCacheValue(subscriptionStateCache, libraryId, { blocked }, SUBSCRIPTION_CACHE_TTL_MS);
  return blocked;
};

const resolveParsedStudentQr = async ({
  expectedLibraryId,
  now,
  publicKeyPem,
  rawValue,
}: {
  expectedLibraryId: string;
  now: Date;
  publicKeyPem?: string;
  rawValue: string;
}) => {
  const cacheKey = `${expectedLibraryId}::${rawValue}`;
  const cachedParsedQr = getCacheValue(studentQrParseCache, cacheKey);
  if (cachedParsedQr !== undefined) {
    return cachedParsedQr;
  }

  const parsedQr = await parseStudentQrPayload(rawValue, {
    expectedLibraryId,
    publicKeyPem,
    allowLegacy: true,
    now,
  });

  const ttlMs = resolveStudentQrParseCacheTtlMs(parsedQr, now);
  if (ttlMs > 0) {
    setCacheValue(studentQrParseCache, cacheKey, parsedQr, ttlMs);
  }

  return parsedQr;
};

const resolveStudentRpcTargetUncached = async ({
  supabase,
  libraryId,
  parsedQr,
}: {
  supabase: any;
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

const resolveStudentRpcTarget = async ({
  supabase,
  libraryId,
  parsedQr,
}: {
  supabase: any;
  libraryId: string;
  parsedQr: ValidStudentQrPayload;
}) => {
  const lookupIdentifier =
    parsedQr.source === "legacy"
      ? parsedQr.qrCode
      : normalizeString("studentId" in parsedQr ? parsedQr.studentId : parsedQr.rawValue) || parsedQr.rawValue;
  const cacheKey = `${libraryId}::${parsedQr.source}::${lookupIdentifier}`;
  const cachedTarget = getCacheValue(studentRpcTargetCache, cacheKey);
  if (cachedTarget !== undefined) {
    return cachedTarget;
  }

  const resolvedTarget = await resolveStudentRpcTargetUncached({
    supabase,
    libraryId,
    parsedQr,
  });

  return setCacheValue(studentRpcTargetCache, cacheKey, resolvedTarget, STUDENT_LOOKUP_CACHE_TTL_MS);
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
  const route = "/api/attendance/scan";
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
    global: {
      fetch: createInstrumentedServerSupabaseFetch("scan_attendance_server"),
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

  let resolvedLibraryId = "";
  try {
    resolvedLibraryId = (await resolveLibraryIdFromAccessKey({
      accessKey: clientLibraryAccessKey,
      supabase,
    })) ?? "";
  } catch (libraryAccessKeyError) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message:
        libraryAccessKeyError instanceof Error
          ? libraryAccessKeyError.message || "Unable to validate the Library ID"
          : "Unable to validate the Library ID",
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

  if (!resolvedLibraryId) {
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

  let device: DeviceLookupRecord | null = null;
  try {
    device = await resolveDeviceLookup({
      deviceId,
      supabase,
    });
  } catch (deviceError) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message:
        deviceError instanceof Error
          ? deviceError.message || "Unable to validate the scanning device"
          : "Unable to validate the scanning device",
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

  try {
    const subscriptionBlocked = await resolveSubscriptionBlockedState({
      libraryId: resolvedLibraryId,
      supabase,
    });

    if (subscriptionBlocked) {
      await logAttendanceFailure({
        client: supabase,
        route,
        message: "Subscription expired",
        code: "SUBSCRIPTION_EXPIRED",
        source: "scan-attendance-server",
        metadata: {
          device_id: deviceId,
          entry_id: entryId,
          library_id: resolvedLibraryId,
          stage: "subscription_check",
        },
      });

      return buildError("Library subscription has expired. Please renew to continue scanning.", 403, "SUBSCRIPTION_EXPIRED");
    }
  } catch {
    // Fail open for subscription-cache lookup issues and let scan verification continue.
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

  const parsedQrNow = new Date(entryTimestamp);
  const resolvedParsedQrNow = Number.isNaN(parsedQrNow.getTime()) ? new Date() : parsedQrNow;

  const parsedQr = await resolveParsedStudentQr({
    rawValue: qrCode,
    expectedLibraryId: device.library_id,
    publicKeyPem: readEnv(
      env,
      "STUDENT_QR_PUBLIC_KEY",
      "VITE_QR_PUBLIC_KEY",
      "VITE_STUDENT_QR_PUBLIC_KEY",
      "QR_VERIFY_PUBLIC_KEY",
    ),
    now: resolvedParsedQrNow,
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
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: resolvedLibraryId,
        student_id: resolvedStudentIdentifier,
        stage: "student_resolution",
      },
    });

    return buildError("Unable to verify this QR right now.", 500, "SERVER_ERROR");
  }

  const modernRpcArgs: Record<string, unknown> = {
    p_device_id: deviceId,
    p_library_id: resolvedLibraryId,
    ...studentRpcTarget.rpcArgs,
    p_entry_id: entryId,
    p_entry_timestamp: entryTimestamp,
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
      rpcVariant = attempt.variant;
      scanError = null;
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
      source: "scan-attendance-server",
      metadata: {
        device_id: deviceId,
        entry_id: entryId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: getLibraryAccessKeySuffix(clientLibraryAccessKey) || null,
        student_id: resolvedStudentIdentifier,
        stage: "rpc_failure",
        rpc_variant: rpcVariant,
        rpc_error_code: scanErrorCode || null,
        rpc_error_details: scanErrorDetails || null,
      },
    });

    return buildError(scanErrorMessage || "Unable to record the scan", 500, "SERVER_ERROR");
  }

  await supabase
    .from("entry_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id);

  const payload = normalizeRpcPayload(result);

  const payloadStatusCode = payload.status === "error" ? resolveErrorStatusCode(payload.code) : 200;

  return {
    statusCode: payloadStatusCode,
    body: payload,
  };
};
