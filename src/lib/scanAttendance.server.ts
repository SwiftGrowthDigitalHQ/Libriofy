import { createClient } from "@supabase/supabase-js";
import { expandPhoneCandidates } from "./auth.shared.js";
import { getLibraryAccessKeySuffix, normalizeLibraryAccessKey } from "./libraryAccessKey.js";
import { resolvePublicScanDenial } from "./scanDenial.js";
import {
  createStudentQrClaims,
  inspectStudentQrPayload,
  parseStudentQrPayload,
  signStudentQrToken,
} from "./studentQr.js";
import { logAttendanceFailure } from "./attendanceFailureLogger.js";
import { createInstrumentedServerSupabaseFetch } from "./observability/serverSupabaseFetch.server.js";
import { resolveSupabaseAdminConfig } from "./observability/supabaseAdminConfig.server.js";

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
  debug?: Record<string, unknown>;
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
  fn: "process_attendance_scan";
  variant: "process_attendance_scan";
  args: Record<string, unknown>;
};

type ValidStudentQrPayload = Extract<Awaited<ReturnType<typeof parseStudentQrPayload>>, { valid: true }>;

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

type ScanDebugStage = {
  at: string;
  details?: Record<string, unknown>;
  stage: string;
  status: "error" | "info" | "ok";
};

type ScanStudentRecord = {
  expiry_date: string | null;
  full_name: string | null;
  id: string;
  library_id: string;
  phone: string | null;
  qr_code: string | null;
  seat_number: string | null;
  status: string | null;
};

const LIBRARY_ACCESS_KEY_CACHE_TTL_MS = 60_000;
const DEVICE_LOOKUP_CACHE_TTL_MS = 60_000;
const STUDENT_QR_PARSE_CACHE_TTL_MS = 45_000;
const STUDENT_QR_INVALID_CACHE_TTL_MS = 5_000;
const SUBSCRIPTION_CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 256;

const libraryAccessKeyCache = new Map<string, CacheEntry<string | null>>();
const deviceLookupCache = new Map<string, CacheEntry<DeviceLookupRecord | null>>();
const studentQrParseCache = new Map<string, CacheEntry<StudentQrParseResult>>();
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
const nowIso = () => new Date().toISOString();
const readBooleanField = (body: ScanAttendanceRequestBody, ...keys: string[]) => {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = normalizeString(value).toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }

    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }

  return false;
};

const pushDebugStage = (
  debug: Record<string, unknown> | null,
  stage: string,
  status: ScanDebugStage["status"],
  details?: Record<string, unknown>,
) => {
  if (!debug) {
    return;
  }

  const stages = Array.isArray(debug.stages) ? (debug.stages as ScanDebugStage[]) : [];
  const entry: ScanDebugStage = {
    at: nowIso(),
    stage,
    status,
    ...(details ? { details } : {}),
  };
  stages.push(entry);
  debug.stages = stages;
  console.info("[scan-debug]", {
    requestId: debug.requestId ?? null,
    ...entry,
  });
};

const fingerprintValue = async (value: string | undefined) => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)),
  );

  return [...digest].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

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

const buildError = (
  message: string,
  statusCode: number,
  code?: string,
  debug?: Record<string, unknown> | null,
): ScanAttendanceServiceResponse => {
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
      ...(debug ? { debug } : {}),
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
    case "SIGNATURE_INVALID":
      return 401;
    case "WRONG_LIBRARY":
    case "INVALID_LIBRARY_ID":
    case "DEVICE_BLOCKED":
    case "LIBRARY_MISMATCH":
    case "DEVICE_MISMATCH":
    case "ACCESS_DENIED":
    case "SUBSCRIPTION_EXPIRED":
    case "RLS_DENIED":
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
    case "RPC_MISSING":
    case "SCHEMA_MISSING":
    case "INTERNAL_ERROR":
      return 500;
    case "STUDENT_NOT_FOUND":
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

const isSchemaContractError = (error: unknown) => {
  const record = getRpcErrorRecord(error);
  const code = normalizeString(record.code).toUpperCase();
  const message = normalizeString(record.message).toLowerCase();
  const details = normalizeString(record.details).toLowerCase();

  return (
    code === "42703" ||
    code === "42P01" ||
    code === "PGRST205" ||
    isMissingRpcFunctionError(error) ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("could not find the function") ||
    details.includes("schema cache")
  );
};

const isRlsDeniedError = (error: unknown) => {
  const record = getRpcErrorRecord(error);
  const code = normalizeString(record.code).toUpperCase();
  const message = normalizeString(record.message).toLowerCase();
  const details = normalizeString(record.details).toLowerCase();

  return (
    code === "42501" ||
    message.includes("permission denied") ||
    message.includes("row level security") ||
    details.includes("row level security")
  );
};

const classifyAttendanceRuntimeError = (error: unknown) => {
  if (isMissingRpcFunctionError(error)) {
    return {
      code: "RPC_MISSING",
      message: "Attendance RPC missing in this Supabase project.",
    };
  }

  if (isSchemaContractError(error)) {
    return {
      code: "SCHEMA_MISSING",
      message: "Attendance schema is missing required tables or columns.",
    };
  }

  if (isRlsDeniedError(error)) {
    return {
      code: "RLS_DENIED",
      message: "Attendance access is blocked by Supabase permissions.",
    };
  }

  return {
    code: "SERVER_ERROR",
    message: normalizeString(getRpcErrorRecord(error).message) || "Unable to record the scan",
  };
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

const resolveStudentRecordForDebug = async ({
  supabase,
  libraryId,
  parsedQr,
}: {
  supabase: any;
  libraryId: string;
  parsedQr: ValidStudentQrPayload;
}): Promise<ScanStudentRecord | null> => {
  const studentIdentifier =
    parsedQr.source === "legacy"
      ? normalizeString(parsedQr.qrCode)
      : normalizeString(parsedQr.studentId);

  if (!studentIdentifier) {
    return null;
  }

  let query = supabase
    .from("students")
    .select("id, library_id, full_name, phone, qr_code, seat_number, status, expiry_date")
    .eq("library_id", libraryId);

  if (looksLikeUuid(studentIdentifier)) {
    query = query.eq("id", studentIdentifier);
  } else {
    query = query.eq("qr_code", studentIdentifier);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }

  if (!data?.id) {
    return null;
  }

  return {
    expiry_date: normalizeString(data.expiry_date) || null,
    full_name: normalizeString(data.full_name) || null,
    id: normalizeString(data.id),
    library_id: normalizeString(data.library_id),
    phone: normalizeString(data.phone) || null,
    qr_code: normalizeString(data.qr_code) || null,
    seat_number: normalizeString(data.seat_number) || null,
    status: normalizeString(data.status) || null,
  } satisfies ScanStudentRecord;
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
  const debugEnabled = readBooleanField(body, "debug", "scan_debug", "scanDebug");
  const debug = debugEnabled
    ? ({
        enabled: true,
        requestId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`,
        stages: [] as ScanDebugStage[],
      } satisfies Record<string, unknown>)
    : null;
  const route = "/api/attendance/scan";
  const publicKey =
    readEnv(
      env,
      "STUDENT_QR_PUBLIC_KEY",
      "VITE_QR_PUBLIC_KEY",
      "VITE_STUDENT_QR_PUBLIC_KEY",
      "QR_VERIFY_PUBLIC_KEY",
    ) ?? "";
  const adminConfig = resolveSupabaseAdminConfig(env);

  if (debug) {
    const qrCode = readStringField(body, "qr_code", "qrCode");
    debug.request = {
      deviceId: readStringField(body, "device_id", "deviceId") || null,
      entryId: readStringField(body, "entry_id", "entryId") || null,
      hasDeviceToken: Boolean(normalizeString(headers.deviceToken) || normalizeString(body.device_token) || normalizeString(body.deviceToken)),
      libraryAccessKeySuffix:
        getLibraryAccessKeySuffix(
          normalizeLibraryAccessKey(readStringField(body, "library_access_key", "libraryAccessKey")),
        ) || null,
      libraryId: readStringField(body, "library_id", "libraryId") || null,
      qrLength: qrCode.length,
      rawQrValue: qrCode || null,
      studentId: readStringField(body, "student_id", "studentId") || null,
      timestamp:
        readStringField(body, "timestamp", "entry_timestamp", "entryTimestamp") || null,
    };
    debug.qrInspection = inspectStudentQrPayload(qrCode);
    debug.env = {
      hasPublicKey: Boolean(publicKey),
      publicKeyFingerprint: await fingerprintValue(publicKey),
      publicKeySource: publicKey
        ? ["STUDENT_QR_PUBLIC_KEY", "VITE_QR_PUBLIC_KEY", "VITE_STUDENT_QR_PUBLIC_KEY", "QR_VERIFY_PUBLIC_KEY"].find(
            (name) => normalizeString(env[name]),
          ) ?? null
        : null,
      serviceRoleKeySource: adminConfig.ok ? adminConfig.config.serviceRoleKeyEnvName : null,
      supabaseUrlSource: adminConfig.ok ? adminConfig.config.supabaseUrlEnvName : null,
    };
    pushDebugStage(debug, "request_received", "info", {
      qrLength: qrCode.length,
      route,
    });
  }

  if (!adminConfig.ok) {
    pushDebugStage(debug, "env_validation", "error", {
      detail: adminConfig.detail,
    });
    return buildError(adminConfig.detail, 500, "CONFIG_ERROR", debug);
  }

  const supabase = createClient(adminConfig.config.supabaseUrl, adminConfig.config.serviceRoleKey, {
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
    pushDebugStage(debug, "request_validation", "error", {
      deviceIdPresent: Boolean(deviceId),
      entryIdPresent: Boolean(entryId),
      qrPresent: Boolean(qrCode),
    });
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

    return buildError("Missing scan data, device_id, or entry_id", 400, "INVALID_QR", debug);
  }

  if (!clientLibraryAccessKey) {
    pushDebugStage(debug, "library_access_key_validation", "error", {
      libraryId: clientLibraryId || null,
    });
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

    return buildError("Library ID missing", 403, "INVALID_LIBRARY_ID", debug);
  }

  let resolvedLibraryId = "";
  try {
    resolvedLibraryId = (await resolveLibraryIdFromAccessKey({
      accessKey: clientLibraryAccessKey,
      supabase,
    })) ?? "";
  } catch (libraryAccessKeyError) {
    pushDebugStage(debug, "library_access_key_lookup", "error", {
      message:
        libraryAccessKeyError instanceof Error
          ? libraryAccessKeyError.message || "Unable to validate the Library ID"
          : "Unable to validate the Library ID",
    });
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

    return buildError("Unable to validate the Library ID", 500, "SERVER_ERROR", debug);
  }

  if (!resolvedLibraryId) {
    pushDebugStage(debug, "library_access_key_lookup", "error", {
      result: "no_library_match",
    });
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

    return buildError("Library ID invalid. Reconnect this device.", 403, "INVALID_LIBRARY_ID", debug);
  }

  pushDebugStage(debug, "library_access_key_lookup", "ok", {
    resolvedLibraryId,
  });

  let device: DeviceLookupRecord | null = null;
  try {
    device = await resolveDeviceLookup({
      deviceId,
      supabase,
    });
  } catch (deviceError) {
    pushDebugStage(debug, "device_lookup", "error", {
      message:
        deviceError instanceof Error
          ? deviceError.message || "Unable to validate the scanning device"
          : "Unable to validate the scanning device",
    });
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

    return buildError("Unable to validate the scanning device", 500, "SERVER_ERROR", debug);
  }

  if (!device || !device.is_active) {
    pushDebugStage(debug, "device_lookup", "error", {
      deviceFound: Boolean(device),
      isActive: device?.is_active ?? null,
    });
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

    return buildError("Device not allowed", 403, "DEVICE_BLOCKED", debug);
  }

  pushDebugStage(debug, "device_lookup", "ok", {
    deviceId: device.id,
    libraryId: device.library_id,
  });

  if (clientLibraryId && clientLibraryId !== resolvedLibraryId) {
    pushDebugStage(debug, "library_match", "error", {
      expectedLibraryId: resolvedLibraryId,
      providedLibraryId: clientLibraryId,
    });
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

    return buildError("Wrong Library", 403, "WRONG_LIBRARY", debug);
  }

  try {
    const subscriptionBlocked = await resolveSubscriptionBlockedState({
      libraryId: resolvedLibraryId,
      supabase,
    });

    if (subscriptionBlocked) {
      pushDebugStage(debug, "subscription_check", "error", {
        resolvedLibraryId,
      });
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

      return buildError("Library subscription has expired. Please renew to continue scanning.", 403, "SUBSCRIPTION_EXPIRED", debug);
    }
  } catch {
    // Fail open for subscription-cache lookup issues and let scan verification continue.
  }

  pushDebugStage(debug, "subscription_check", "ok", {
    resolvedLibraryId,
  });

  if (device.library_id !== resolvedLibraryId) {
    pushDebugStage(debug, "device_library_match", "error", {
      deviceLibraryId: device.library_id,
      resolvedLibraryId,
    });
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

    return buildError("Wrong Library", 403, "WRONG_LIBRARY", debug);
  }

  const providedToken =
    normalizeString(headers.deviceToken) ||
    normalizeString(body.device_token) ||
    normalizeString(body.deviceToken);

  if (device.secret_token_hash) {
    if (!providedToken) {
      pushDebugStage(debug, "device_token_validation", "error", {
        reason: "missing_token",
      });
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

      return buildError("Device token missing", 401, "DEVICE_BLOCKED", debug);
    }

    const tokenHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(providedToken)),
    );
    const incomingHash = [...tokenHash].map((byte) => byte.toString(16).padStart(2, "0")).join("");

    if (incomingHash !== device.secret_token_hash) {
      pushDebugStage(debug, "device_token_validation", "error", {
        reason: "hash_mismatch",
      });
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

      return buildError("Device token invalid", 403, "DEVICE_BLOCKED", debug);
    }
  }

  pushDebugStage(debug, "device_token_validation", "ok", {
    required: Boolean(device.secret_token_hash),
  });

  const parsedQrNow = new Date(entryTimestamp);
  const resolvedParsedQrNow = Number.isNaN(parsedQrNow.getTime()) ? new Date() : parsedQrNow;

  const parsedQr = await resolveParsedStudentQr({
    rawValue: qrCode,
    expectedLibraryId: device.library_id,
    publicKeyPem: publicKey,
    now: resolvedParsedQrNow,
  });

  if (debug) {
    debug.qrVerification = parsedQr
      ? {
          code: "code" in parsedQr ? parsedQr.code ?? null : null,
          libraryId:
            parsedQr.valid === true
              ? ("libraryId" in parsedQr ? normalizeString(parsedQr.libraryId) || null : null)
              : null,
          message: "message" in parsedQr ? parsedQr.message ?? null : null,
          source: parsedQr.source,
          studentId:
            parsedQr.valid === true && "studentId" in parsedQr
              ? normalizeString(parsedQr.studentId) || null
              : null,
          valid: parsedQr.valid,
        }
      : {
          code: "INVALID_QR",
          message: "QR parsing returned no payload.",
          source: "unknown",
          studentId: null,
          valid: false,
        };
  }

  if (!parsedQr || !parsedQr.valid) {
    const code = parsedQr && "code" in parsedQr ? parsedQr.code : "INVALID_QR";
    const message = parsedQr && "message" in parsedQr ? parsedQr.message : "Invalid ID";
    const statusCode = resolveErrorStatusCode(code);
    pushDebugStage(debug, "qr_verification", "error", {
      code,
      message,
      parsed: Boolean(parsedQr),
    });

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

    return buildError(message, statusCode, code, debug);
  }

  pushDebugStage(debug, "qr_verification", "ok", {
    libraryId: "libraryId" in parsedQr ? normalizeString(parsedQr.libraryId) || null : null,
    source: parsedQr.source,
    studentId: "studentId" in parsedQr ? normalizeString(parsedQr.studentId) || null : null,
  });

  const resolvedStudentIdentifier = parsedQr.source === "legacy" ? parsedQr.qrCode : parsedQr.studentId;

  if (studentId && studentId !== resolvedStudentIdentifier) {
    pushDebugStage(debug, "student_identifier_match", "error", {
      expectedStudentId: resolvedStudentIdentifier,
      providedStudentId: studentId,
    });
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

    return buildError("Invalid ID", 400, "INVALID_QR", debug);
  }

  if (debug) {
    let matchedStudentRecord: ScanStudentRecord | null = null;
    try {
      matchedStudentRecord = await resolveStudentRecordForDebug({
        supabase,
        libraryId: resolvedLibraryId,
        parsedQr,
      });
    } catch (error) {
      pushDebugStage(debug, "student_lookup_debug", "error", {
        message: error instanceof Error ? error.message : "Unable to inspect the matched student record.",
      });
    }

    debug.studentLookup = matchedStudentRecord
      ? {
          exists: true,
          fullName: matchedStudentRecord.full_name,
          libraryId: matchedStudentRecord.library_id,
          matchedStudentId: matchedStudentRecord.id,
          phone: matchedStudentRecord.phone,
          qrCode: matchedStudentRecord.qr_code,
          seatAssigned: Boolean(matchedStudentRecord.seat_number),
          seatNumber: matchedStudentRecord.seat_number,
          status: matchedStudentRecord.status,
          studentArchived: matchedStudentRecord.status === "archived",
        }
      : {
          exists: false,
          matchedStudentId: null,
          seatAssigned: false,
          studentArchived: false,
        };
  }

  const rpcArgs: Record<string, unknown> = {
    p_failure_route: route,
    p_device_id: deviceId,
    p_library_id: resolvedLibraryId,
    p_entry_id: entryId,
    p_entry_timestamp: entryTimestamp,
    ...(parsedQr.source === "legacy" || !looksLikeUuid(resolvedStudentIdentifier)
      ? { p_qr_code: resolvedStudentIdentifier }
      : { p_student_id: resolvedStudentIdentifier }),
  };
  const rpcAttempt: RpcAttempt = {
    fn: "process_attendance_scan",
    variant: "process_attendance_scan",
    args: rpcArgs,
  };
  let result: unknown = null;
  let scanError: unknown = null;
  let rpcVariant: RpcAttempt["variant"] | null = rpcAttempt.variant;
  const rpcResponse = await supabase.rpc(rpcAttempt.fn, rpcAttempt.args);
  const rpcDebugAttempts: Record<string, unknown>[] = [{
    args: Object.keys(rpcAttempt.args),
    fn: rpcAttempt.fn,
    hasError: Boolean(rpcResponse.error),
    variant: rpcAttempt.variant,
    ...(rpcResponse.error
      ? {
          errorCode: normalizeString(getRpcErrorRecord(rpcResponse.error).code) || null,
          errorMessage: normalizeString(getRpcErrorRecord(rpcResponse.error).message) || null,
        }
      : {}),
  }];

  if (!rpcResponse.error) {
    result = rpcResponse.data;
    scanError = null;
  } else {
    scanError = rpcResponse.error;
  }

  if (debug) {
    debug.attendanceRpc = {
      attempts: rpcDebugAttempts,
      selectedVariant: rpcVariant,
    };
  }

  if (scanError) {
    const classifiedError = classifyAttendanceRuntimeError(scanError);
    const scanErrorRecord = getRpcErrorRecord(scanError);
    const scanErrorMessage = normalizeString(scanErrorRecord.message) || classifiedError.message;
    const scanErrorCode = normalizeString(scanErrorRecord.code);
    const scanErrorDetails = normalizeString(scanErrorRecord.details);
    pushDebugStage(debug, "attendance_write", "error", {
      classifiedCode: classifiedError.code,
      message: scanErrorMessage,
      rpcErrorCode: scanErrorCode || null,
      rpcVariant,
    });

    await logAttendanceFailure({
      client: supabase,
      route,
      message: scanErrorMessage,
      code: classifiedError.code,
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

    return buildError(
      classifiedError.message,
      resolveErrorStatusCode(classifiedError.code),
      classifiedError.code,
      debug,
    );
  }

  await supabase
    .from("entry_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id);

  const payload = normalizeRpcPayload(result);
  pushDebugStage(debug, "attendance_write", payload.status === "error" ? "error" : "ok", {
    code: payload.code ?? null,
    duplicate: payload.duplicate ?? false,
    status: payload.status,
  });

  const payloadStatusCode = payload.status === "error" ? resolveErrorStatusCode(payload.code) : 200;

  return {
    statusCode: payloadStatusCode,
    body: {
      ...payload,
      ...(debug ? { debug } : {}),
    },
  };
};

const resolveManualDebugStudent = async ({
  libraryId,
  phone,
  studentId,
  supabase,
}: {
  libraryId: string;
  phone: string;
  studentId: string;
  supabase: any;
}): Promise<{ matchedBy: "phone" | "student_id"; student: ScanStudentRecord } | null> => {
  const normalizedStudentId = normalizeString(studentId);
  if (normalizedStudentId) {
    const { data, error } = await supabase
      .from("students")
      .select("id, library_id, full_name, phone, qr_code, seat_number, status, expiry_date")
      .eq("library_id", libraryId)
      .eq("id", normalizedStudentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data?.id) {
      return {
        matchedBy: "student_id",
        student: {
          expiry_date: normalizeString(data.expiry_date) || null,
          full_name: normalizeString(data.full_name) || null,
          id: normalizeString(data.id),
          library_id: normalizeString(data.library_id),
          phone: normalizeString(data.phone) || null,
          qr_code: normalizeString(data.qr_code) || null,
          seat_number: normalizeString(data.seat_number) || null,
          status: normalizeString(data.status) || null,
        },
      };
    }
  }

  const phoneCandidates = expandPhoneCandidates(phone);
  if (!phoneCandidates.length) {
    return null;
  }

  const { data, error } = await supabase
    .from("students")
    .select("id, library_id, full_name, phone, qr_code, seat_number, status, expiry_date")
    .eq("library_id", libraryId)
    .in("phone", phoneCandidates)
    .limit(2);

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || data.length !== 1 || !data[0]?.id) {
    return null;
  }

  return {
    matchedBy: "phone",
    student: {
      expiry_date: normalizeString(data[0].expiry_date) || null,
      full_name: normalizeString(data[0].full_name) || null,
      id: normalizeString(data[0].id),
      library_id: normalizeString(data[0].library_id),
      phone: normalizeString(data[0].phone) || null,
      qr_code: normalizeString(data[0].qr_code) || null,
      seat_number: normalizeString(data[0].seat_number) || null,
      status: normalizeString(data[0].status) || null,
    },
  };
};

export const resolveScanAttendanceDebugRequest = async (
  env: EnvLike,
  requestBody: unknown,
  headers: ScanAttendanceHeaders = {},
): Promise<ScanAttendanceServiceResponse> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as ScanAttendanceRequestBody)
      : {};
  const action = normalizeString(body.action) || normalizeString(body.mode) || "inspect";
  const qrCode = readStringField(body, "qr_code", "qrCode");
  const deviceId = readStringField(body, "device_id", "deviceId");
  const clientLibraryId = readStringField(body, "library_id", "libraryId");
  const clientLibraryAccessKey = normalizeLibraryAccessKey(
    readStringField(body, "library_access_key", "libraryAccessKey"),
  );
  const studentId = readStringField(body, "student_id", "studentId");
  const phone = readStringField(body, "phone", "student_phone", "studentPhone");
  const writeAttendance = readBooleanField(
    body,
    "write_attendance",
    "writeAttendance",
    "mark_attendance",
    "markAttendance",
  );
  const publicKey =
    readEnv(
      env,
      "STUDENT_QR_PUBLIC_KEY",
      "VITE_QR_PUBLIC_KEY",
      "VITE_STUDENT_QR_PUBLIC_KEY",
      "QR_VERIFY_PUBLIC_KEY",
    ) ?? "";
  const privateKey =
    readEnv(env, "STUDENT_QR_PRIVATE_KEY", "QR_SIGNING_PRIVATE_KEY", "VITE_QR_PRIVATE_KEY") ?? "";
  const adminConfig = resolveSupabaseAdminConfig(env);
  const debug: Record<string, unknown> = {
    action,
    enabled: true,
    requestId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`,
    stages: [] as ScanDebugStage[],
  };

  pushDebugStage(debug, "debug_request_received", "info", {
    action,
    hasQrCode: Boolean(qrCode),
    hasStudentId: Boolean(studentId),
    hasPhone: Boolean(phone),
    writeAttendance,
  });

  if (!adminConfig.ok) {
    pushDebugStage(debug, "debug_env_validation", "error", {
      detail: adminConfig.detail,
    });
    return buildError(adminConfig.detail, 500, "CONFIG_ERROR", debug);
  }

  debug.env = {
    hasPrivateKey: Boolean(privateKey),
    hasPublicKey: Boolean(publicKey),
    privateKeyFingerprint: await fingerprintValue(privateKey),
    publicKeyFingerprint: await fingerprintValue(publicKey),
    privateKeySource: privateKey ? ["STUDENT_QR_PRIVATE_KEY", "QR_SIGNING_PRIVATE_KEY", "VITE_QR_PRIVATE_KEY"].find((name) => normalizeString(env[name])) ?? null : null,
    publicKeySource: publicKey ? ["STUDENT_QR_PUBLIC_KEY", "VITE_QR_PUBLIC_KEY", "VITE_STUDENT_QR_PUBLIC_KEY", "QR_VERIFY_PUBLIC_KEY"].find((name) => normalizeString(env[name])) ?? null : null,
    serviceRoleKeySource: adminConfig.config.serviceRoleKeyEnvName,
    supabaseUrlSource: adminConfig.config.supabaseUrlEnvName,
  };

  const supabase = createClient(adminConfig.config.supabaseUrl, adminConfig.config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createInstrumentedServerSupabaseFetch("scan_attendance_debug_server"),
    },
  });

  let resolvedLibraryId = clientLibraryId;
  if (clientLibraryAccessKey) {
    try {
      resolvedLibraryId = (await resolveLibraryIdFromAccessKey({
        accessKey: clientLibraryAccessKey,
        supabase,
      })) ?? resolvedLibraryId;
      pushDebugStage(debug, "debug_library_resolution", "ok", {
        resolvedLibraryId: resolvedLibraryId || null,
      });
    } catch (error) {
      pushDebugStage(debug, "debug_library_resolution", "error", {
        message: error instanceof Error ? error.message : "Unable to resolve debug library access key.",
      });
    }
  }

  let manualStudent: Awaited<ReturnType<typeof resolveManualDebugStudent>> | null = null;
  if ((studentId || phone) && resolvedLibraryId) {
    try {
      manualStudent = await resolveManualDebugStudent({
        libraryId: resolvedLibraryId,
        phone,
        studentId,
        supabase,
      });
      pushDebugStage(debug, "manual_student_lookup", manualStudent ? "ok" : "error", {
        matchedBy: manualStudent?.matchedBy ?? null,
        matchedStudentId: manualStudent?.student.id ?? null,
      });
    } catch (error) {
      pushDebugStage(debug, "manual_student_lookup", "error", {
        message: error instanceof Error ? error.message : "Manual student lookup failed.",
      });
      return buildError("Unable to resolve the requested student", 500, "SERVER_ERROR", debug);
    }
  }

  let generatedQrCode: string | null = null;
  let effectiveQrCode = qrCode;
  if (!effectiveQrCode && manualStudent) {
    if (!privateKey) {
      pushDebugStage(debug, "qr_generation", "error", {
        reason: "missing_private_key",
      });
      return buildError("QR signing key is not configured.", 500, "CONFIG_ERROR", debug);
    }

    const claims = createStudentQrClaims({
      expiresAt:
        manualStudent.student.expiry_date
          ? `${manualStudent.student.expiry_date}T23:59:59.999Z`
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      issuedAt: new Date(),
      libraryId: manualStudent.student.library_id,
      studentId: manualStudent.student.id,
    });
    generatedQrCode = await signStudentQrToken(claims, privateKey);
    effectiveQrCode = generatedQrCode;
    debug.generatedQr = {
      claims,
      token: generatedQrCode,
    };
    debug.env = {
      ...(debug.env && typeof debug.env === "object" ? (debug.env as Record<string, unknown>) : {}),
      hasPrivateKey: true,
      hasPublicKey: Boolean(publicKey),
      privateKeyFingerprint: await fingerprintValue(privateKey),
      privateKeySource: ["STUDENT_QR_PRIVATE_KEY", "QR_SIGNING_PRIVATE_KEY", "VITE_QR_PRIVATE_KEY"].find(
        (name) => normalizeString(env[name]),
      ) ?? null,
      publicKeyFingerprint: await fingerprintValue(publicKey),
      serviceRoleKeySource: adminConfig.config.serviceRoleKeyEnvName,
      supabaseUrlSource: adminConfig.config.supabaseUrlEnvName,
    };
    pushDebugStage(debug, "qr_generation", "ok", {
      exp: claims.exp,
      iat: claims.iat,
      studentId: claims.student_id,
    });
  }

  if (!effectiveQrCode) {
    pushDebugStage(debug, "debug_request_validation", "error", {
      reason: "missing_qr_or_student_input",
    });
    return buildError("Provide a QR value, student ID, or phone number.", 400, "INVALID_QR", debug);
  }

  debug.qrInspection = inspectStudentQrPayload(effectiveQrCode);

  const parsedPreview = await parseStudentQrPayload(effectiveQrCode, {
    allowLegacy: true,
    expectedLibraryId: resolvedLibraryId || null,
    now: new Date(),
    publicKeyPem: publicKey,
  });
  debug.previewVerification = parsedPreview
    ? {
        code: "code" in parsedPreview ? parsedPreview.code ?? null : null,
        message: "message" in parsedPreview ? parsedPreview.message ?? null : null,
        source: parsedPreview.source,
        valid: parsedPreview.valid,
      }
    : null;
  pushDebugStage(debug, "preview_verification", parsedPreview?.valid ? "ok" : "error", {
    code: parsedPreview && "code" in parsedPreview ? parsedPreview.code ?? null : null,
    source: parsedPreview?.source ?? null,
  });

  if (!writeAttendance && action !== "manual_verify") {
    return {
      statusCode: parsedPreview?.valid ? 200 : 400,
      body: {
        status: parsedPreview?.valid ? "success" : "error",
        success: parsedPreview?.valid ?? false,
        code: parsedPreview && "code" in parsedPreview ? parsedPreview.code : undefined,
        message:
          parsedPreview?.valid
            ? "Debug verification completed."
            : parsedPreview && "message" in parsedPreview
              ? parsedPreview.message
              : "Unable to verify the QR value.",
        debug,
      },
    };
  }

  const scanResult = await resolveScanAttendanceRequest(
    env,
    {
      ...body,
      debug: true,
      device_id: deviceId || readStringField(body, "device_id", "deviceId"),
      entry_id: readStringField(body, "entry_id", "entryId") || (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`),
      library_access_key: clientLibraryAccessKey,
      library_id: resolvedLibraryId || clientLibraryId,
      qr_code: effectiveQrCode,
      student_id: manualStudent?.student.id || studentId || undefined,
      timestamp: readStringField(body, "timestamp", "entry_timestamp", "entryTimestamp") || new Date().toISOString(),
    },
    headers,
  );

  return {
    statusCode: scanResult.statusCode,
    body: {
      ...scanResult.body,
      debug: {
        ...(scanResult.body.debug ?? {}),
        debugRoute: debug,
      },
    },
  };
};
