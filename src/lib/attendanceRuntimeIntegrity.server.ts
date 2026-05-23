import { createClient } from "@supabase/supabase-js";

import { createInstrumentedServerSupabaseFetch } from "./observability/serverSupabaseFetch.server.js";
import { resolveSupabaseAdminConfig } from "./observability/supabaseAdminConfig.server.js";

type EnvLike = Record<string, string | undefined>;

type AttendanceRuntimeIntegrityStatus = "ok" | "degraded" | "failed";

type AttendanceRuntimeIntegrityPayload = {
  checked_at: string;
  compatibility_gaps: string[];
  detail: string;
  diagnostics: Record<string, unknown>;
  env: {
    adminConfigOk: boolean;
    adminProjectRef: string | null;
    clientProjectRef: string | null;
    detail: string | null;
    hasAnonKey: boolean;
    hasServiceRoleKey: boolean;
    serverProjectRef: string | null;
    urlsAligned: boolean;
  };
  requested_student: Record<string, unknown> | null;
  runtime_missing: string[];
  source: "rpc" | "fallback";
  status: AttendanceRuntimeIntegrityStatus;
  suspected_issue: string | null;
};

type AttendanceRuntimeIntegrityResponse = {
  body: AttendanceRuntimeIntegrityPayload;
  statusCode: number;
};

type FallbackCheckResult = {
  compatibility_gaps: string[];
  diagnostics: Record<string, unknown>;
  requested_student: Record<string, unknown> | null;
  runtime_missing: string[];
  suspected_issue: string | null;
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const readField = (input: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = trimText(input[key]);
    if (value) {
      return value;
    }
  }

  return "";
};

const normalizeUrl = (value: string | undefined) => trimText(value).replace(/\/+$/, "").toLowerCase();

const projectRefFromUrl = (value: string | undefined) => {
  const normalized = trimText(value);
  if (!normalized) {
    return null;
  }

  try {
    const host = new URL(normalized).hostname.trim().toLowerCase();
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
};

const buildEnvSummary = (env: EnvLike) => {
  const adminConfig = resolveSupabaseAdminConfig(env);
  const serverUrl = trimText(env.SUPABASE_URL);
  const clientUrl = trimText(env.VITE_SUPABASE_URL);

  return {
    adminConfig,
    summary: {
      adminConfigOk: adminConfig.ok,
      adminProjectRef: adminConfig.ok ? projectRefFromUrl(adminConfig.config.supabaseUrl) : null,
      clientProjectRef: projectRefFromUrl(clientUrl),
      detail: adminConfig.ok ? null : adminConfig.detail,
      hasAnonKey: Boolean(trimText(env.SUPABASE_ANON_KEY) || trimText(env.VITE_SUPABASE_ANON_KEY)),
      hasServiceRoleKey: Boolean(trimText(env.SUPABASE_SERVICE_ROLE_KEY) || trimText(env.VITE_SUPABASE_SERVICE_ROLE_KEY)),
      serverProjectRef: projectRefFromUrl(serverUrl),
      urlsAligned: Boolean(serverUrl) && Boolean(clientUrl) && normalizeUrl(serverUrl) === normalizeUrl(clientUrl),
    },
  };
};

const getRpcErrorRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as {
        code?: string | null;
        details?: string | null;
        hint?: string | null;
        message?: string | null;
      })
    : {};

const isMissingRpcFunctionError = (error: unknown) => {
  const record = getRpcErrorRecord(error);
  const code = trimText(record.code);
  const message = trimText(record.message).toLowerCase();
  const details = trimText(record.details).toLowerCase();

  return (
    code === "PGRST202" ||
    message.includes("could not find the function") ||
    details.includes("no matches were found in the schema cache")
  );
};

const isMissingTableError = (error: unknown) => {
  const record = getRpcErrorRecord(error);
  const code = trimText(record.code);
  const message = trimText(record.message).toLowerCase();

  return code === "PGRST205" || message.includes("could not find the table");
};

const looksLikeUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimText(value));

const checkTableExists = async (supabase: any, tableName: string) => {
  const response = await supabase.from(tableName).select("*").limit(1);
  return {
    error: response.error ? getRpcErrorRecord(response.error) : null,
    exists: !response.error || !isMissingTableError(response.error),
  };
};

const checkColumnExists = async (supabase: any, tableName: string, columnName: string) => {
  const response = await supabase.from(tableName).select(columnName).limit(1);
  return {
    error: response.error ? getRpcErrorRecord(response.error) : null,
    exists: !response.error,
  };
};

const checkRpcExists = async (supabase: any, rpcName: string) => {
  const response = await supabase.rpc(rpcName, {});
  return {
    error: response.error ? getRpcErrorRecord(response.error) : null,
    exists: !response.error || !isMissingRpcFunctionError(response.error),
  };
};

const resolveRequestedStudent = async ({
  qrCode,
  studentId,
  supabase,
}: {
  qrCode: string;
  studentId: string;
  supabase: any;
}): Promise<Record<string, unknown> | null> => {
  if (!studentId && !qrCode) {
    return null;
  }

  let query = supabase
    .from("students")
    .select("id, library_id, full_name, status, qr_code");

  if (studentId) {
    query = query.eq("id", studentId);
  } else {
    query = query.eq("qr_code", qrCode);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    return {
      error: getRpcErrorRecord(error),
      exists: false,
      lookup: studentId ? "student_id" : "qr_code",
      requested_value: studentId || qrCode,
    };
  }

  return {
    exists: Boolean(data?.id),
    lookup: studentId ? "student_id" : "qr_code",
    requested_value: studentId || qrCode,
    student: data && data.id ? data : null,
  };
};

const buildDetail = ({
  compatibilityGaps,
  envSummary,
  requestedStudent,
  runtimeMissing,
}: {
  compatibilityGaps: string[];
  envSummary: AttendanceRuntimeIntegrityPayload["env"];
  requestedStudent: Record<string, unknown> | null;
  runtimeMissing: string[];
}) => {
  const issues: string[] = [];

  if (!envSummary.adminConfigOk || !envSummary.urlsAligned) {
    issues.push(
      envSummary.detail || "Supabase admin configuration is incomplete or points to inconsistent projects.",
    );
  }

  if (runtimeMissing.length > 0) {
    issues.push(`Current attendance runtime is missing: ${runtimeMissing.join(", ")}.`);
  }

  if (requestedStudent && requestedStudent.exists === false) {
    issues.push(
      `Requested student reference ${trimText(requestedStudent.requested_value) || "unknown"} was not found in the configured Supabase project.`,
    );
  }

  if (compatibilityGaps.length > 0) {
    issues.push(`Compatibility gaps detected: ${compatibilityGaps.join(", ")}.`);
  }

  return issues.length > 0 ? issues.join(" ") : "Attendance runtime integrity verified.";
};

const buildStatus = ({
  compatibilityGaps,
  envSummary,
  requestedStudent,
  runtimeMissing,
}: {
  compatibilityGaps: string[];
  envSummary: AttendanceRuntimeIntegrityPayload["env"];
  requestedStudent: Record<string, unknown> | null;
  runtimeMissing: string[];
}): AttendanceRuntimeIntegrityStatus => {
  if (!envSummary.adminConfigOk || !envSummary.urlsAligned || runtimeMissing.length > 0) {
    return "failed";
  }

  if (requestedStudent && requestedStudent.exists === false) {
    return "failed";
  }

  if (compatibilityGaps.length > 0) {
    return "degraded";
  }

  return "ok";
};

const buildFallbackAudit = async ({
  qrCode,
  studentId,
  supabase,
}: {
  qrCode: string;
  studentId: string;
  supabase: any;
}): Promise<FallbackCheckResult> => {
  const tableChecks = {
    attendance: await checkTableExists(supabase, "attendance"),
    attendance_logs: await checkTableExists(supabase, "attendance_logs"),
    entry_devices: await checkTableExists(supabase, "entry_devices"),
    libraries: await checkTableExists(supabase, "libraries"),
    payments: await checkTableExists(supabase, "payments"),
    profiles: await checkTableExists(supabase, "profiles"),
    renewals: await checkTableExists(supabase, "renewals"),
    students: await checkTableExists(supabase, "students"),
  };

  const studentsColumns = {
    archived_at: await checkColumnExists(supabase, "students", "archived_at"),
    full_name: await checkColumnExists(supabase, "students", "full_name"),
    id: await checkColumnExists(supabase, "students", "id"),
    library_id: await checkColumnExists(supabase, "students", "library_id"),
    qr_code: await checkColumnExists(supabase, "students", "qr_code"),
    status: await checkColumnExists(supabase, "students", "status"),
  };
  const attendanceColumns = {
    library_id: await checkColumnExists(supabase, "attendance", "library_id"),
    scanned_at: await checkColumnExists(supabase, "attendance", "scanned_at"),
    student_id: await checkColumnExists(supabase, "attendance", "student_id"),
  };
  const attendanceLogsColumns = {
    check_in: await checkColumnExists(supabase, "attendance_logs", "check_in"),
    date: await checkColumnExists(supabase, "attendance_logs", "date"),
    device_id: await checkColumnExists(supabase, "attendance_logs", "device_id"),
    entry_id: await checkColumnExists(supabase, "attendance_logs", "entry_id"),
    library_id: await checkColumnExists(supabase, "attendance_logs", "library_id"),
    student_id: await checkColumnExists(supabase, "attendance_logs", "student_id"),
  };

  const rpcChecks = {
    mark_attendance: await checkRpcExists(supabase, "mark_attendance"),
    qr_check_in: await checkRpcExists(supabase, "qr_check_in"),
    scan_attendance: await checkRpcExists(supabase, "scan_attendance"),
    scan_attendance_entry: await checkRpcExists(supabase, "scan_attendance_entry"),
    verify_student: await checkRpcExists(supabase, "verify_student"),
  };

  const requestedStudent = await resolveRequestedStudent({
    qrCode,
    studentId,
    supabase,
  });

  const runtimeMissing = [
    !tableChecks.students.exists ? "table:students" : null,
    !tableChecks.attendance_logs.exists ? "table:attendance_logs" : null,
    !tableChecks.libraries.exists ? "table:libraries" : null,
    !tableChecks.entry_devices.exists ? "table:entry_devices" : null,
    !studentsColumns.id.exists ? "column:students.id" : null,
    !studentsColumns.library_id.exists ? "column:students.library_id" : null,
    !studentsColumns.qr_code.exists ? "column:students.qr_code" : null,
    !studentsColumns.full_name.exists ? "column:students.full_name" : null,
    !studentsColumns.status.exists ? "column:students.status" : null,
    !attendanceLogsColumns.student_id.exists ? "column:attendance_logs.student_id" : null,
    !attendanceLogsColumns.library_id.exists ? "column:attendance_logs.library_id" : null,
    !attendanceLogsColumns.check_in.exists ? "column:attendance_logs.check_in" : null,
    !attendanceLogsColumns.date.exists ? "column:attendance_logs.date" : null,
    !rpcChecks.scan_attendance_entry.exists && !rpcChecks.qr_check_in.exists
      ? "rpc:scan_attendance_entry|qr_check_in"
      : null,
  ].filter((value): value is string => Boolean(value));

  const compatibilityGaps = [
    !tableChecks.attendance.exists ? "table:attendance" : null,
    !tableChecks.profiles.exists ? "table:profiles" : null,
    !tableChecks.payments.exists ? "table:payments" : null,
    !tableChecks.renewals.exists ? "table:renewals" : null,
    !studentsColumns.archived_at.exists ? "column:students.archived_at" : null,
    !attendanceColumns.student_id.exists ? "column:attendance.student_id" : null,
    !attendanceColumns.library_id.exists ? "column:attendance.library_id" : null,
    !attendanceColumns.scanned_at.exists ? "column:attendance.scanned_at" : null,
    !rpcChecks.mark_attendance.exists ? "rpc:mark_attendance" : null,
    !rpcChecks.verify_student.exists ? "rpc:verify_student" : null,
    !rpcChecks.scan_attendance.exists ? "rpc:scan_attendance" : null,
  ].filter((value): value is string => Boolean(value));

  const suspectedIssue =
    runtimeMissing.some((entry) => entry.startsWith("rpc:"))
      ? "rpc_missing"
      : runtimeMissing.length > 0
        ? "schema_missing"
        : requestedStudent && requestedStudent.exists === false
          ? "student_not_found"
          : compatibilityGaps.length > 0
            ? "legacy_compatibility_gap"
            : null;

  return {
    compatibility_gaps: compatibilityGaps,
    diagnostics: {
      columns: {
        attendance: attendanceColumns,
        attendance_logs: attendanceLogsColumns,
        students: studentsColumns,
      },
      requested_student: requestedStudent,
      rpcs: rpcChecks,
      tables: tableChecks,
    },
    requested_student: requestedStudent,
    runtime_missing: runtimeMissing,
    suspected_issue: suspectedIssue,
  };
};

const createSupabaseClient = (env: EnvLike, source: string) => {
  const envSummary = buildEnvSummary(env);
  if (!envSummary.adminConfig.ok) {
    return {
      client: null,
      envSummary: envSummary.summary,
    };
  }

  return {
    client: createClient(envSummary.adminConfig.config.supabaseUrl, envSummary.adminConfig.config.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: createInstrumentedServerSupabaseFetch(source),
      },
    }),
    envSummary: envSummary.summary,
  };
};

export const getAttendanceRuntimeIntegrity = async (
  env: EnvLike = process.env,
  requestInput: Record<string, unknown> = {},
): Promise<AttendanceRuntimeIntegrityPayload> => {
  const studentId = readField(requestInput, "student_id", "studentId");
  const qrCode = readField(requestInput, "qr_code", "qrCode");
  const { client, envSummary } = createSupabaseClient(env, "attendance_runtime_integrity");

  if (!client) {
    const detail = buildDetail({
      compatibilityGaps: [],
      envSummary,
      requestedStudent: null,
      runtimeMissing: ["env:supabase_admin_config"],
    });

    return {
      checked_at: new Date().toISOString(),
      compatibility_gaps: [],
      detail,
      diagnostics: {},
      env: envSummary,
      requested_student: null,
      runtime_missing: ["env:supabase_admin_config"],
      source: "fallback",
      status: "failed",
      suspected_issue: "env_mismatch",
    };
  }

  const rpcArgs: Record<string, unknown> = {};
  if (looksLikeUuid(studentId)) {
    rpcArgs.p_student_id = studentId;
  }
  if (qrCode) {
    rpcArgs.p_qr_code = qrCode;
  }

  const diagnosticsResponse = await client.rpc("get_attendance_runtime_diagnostics" as never, rpcArgs as never);
  if (!diagnosticsResponse.error && diagnosticsResponse.data && typeof diagnosticsResponse.data === "object") {
    const diagnostics = diagnosticsResponse.data as Record<string, unknown>;
    const runtimeMissing = Array.isArray(diagnostics.runtime_missing)
      ? diagnostics.runtime_missing.filter((value): value is string => typeof value === "string")
      : [];
    const compatibilityGaps = Array.isArray(diagnostics.compatibility_gaps)
      ? diagnostics.compatibility_gaps.filter((value): value is string => typeof value === "string")
      : [];
    const requestedStudent =
      diagnostics.requested_student && typeof diagnostics.requested_student === "object" && !Array.isArray(diagnostics.requested_student)
        ? (diagnostics.requested_student as Record<string, unknown>)
        : null;
    const status = buildStatus({
      compatibilityGaps,
      envSummary,
      requestedStudent,
      runtimeMissing,
    });

    return {
      checked_at: new Date().toISOString(),
      compatibility_gaps: compatibilityGaps,
      detail: buildDetail({
        compatibilityGaps,
        envSummary,
        requestedStudent,
        runtimeMissing,
      }),
      diagnostics,
      env: envSummary,
      requested_student: requestedStudent,
      runtime_missing: runtimeMissing,
      source: "rpc",
      status,
      suspected_issue: trimText(diagnostics.suspected_issue) || null,
    };
  }

  const fallbackAudit = await buildFallbackAudit({
    qrCode,
    studentId,
    supabase: client,
  });
  const status = buildStatus({
    compatibilityGaps: fallbackAudit.compatibility_gaps,
    envSummary,
    requestedStudent: fallbackAudit.requested_student,
    runtimeMissing: fallbackAudit.runtime_missing,
  });

  return {
    checked_at: new Date().toISOString(),
    compatibility_gaps: fallbackAudit.compatibility_gaps,
    detail: buildDetail({
      compatibilityGaps: fallbackAudit.compatibility_gaps,
      envSummary,
      requestedStudent: fallbackAudit.requested_student,
      runtimeMissing: fallbackAudit.runtime_missing,
    }),
    diagnostics: {
      fallback_reason: diagnosticsResponse.error ? getRpcErrorRecord(diagnosticsResponse.error) : null,
      ...fallbackAudit.diagnostics,
    },
    env: envSummary,
    requested_student: fallbackAudit.requested_student,
    runtime_missing: fallbackAudit.runtime_missing,
    source: "fallback",
    status,
    suspected_issue: fallbackAudit.suspected_issue,
  };
};

let startupWarmInFlight: Promise<void> | null = null;

export const warmAttendanceRuntimeIntegrity = (env: EnvLike = process.env) => {
  if (startupWarmInFlight) {
    return startupWarmInFlight;
  }

  startupWarmInFlight = getAttendanceRuntimeIntegrity(env)
    .then((report) => {
      if (report.status === "failed") {
        console.error("[attendance-integrity] failed", {
          detail: report.detail,
          runtimeMissing: report.runtime_missing,
          source: report.source,
          suspectedIssue: report.suspected_issue,
        });
        return;
      }

      if (report.status === "degraded") {
        console.warn("[attendance-integrity] degraded", {
          compatibilityGaps: report.compatibility_gaps,
          detail: report.detail,
          source: report.source,
          suspectedIssue: report.suspected_issue,
        });
      }
    })
    .catch((error) => {
      console.error("[attendance-integrity] warm failed", error);
    })
    .finally(() => {
      startupWarmInFlight = null;
    });

  return startupWarmInFlight;
};

export const resolveAttendanceRuntimeIntegrityRequest = async (
  env: EnvLike = process.env,
  requestInput: Record<string, unknown> = {},
): Promise<AttendanceRuntimeIntegrityResponse> => {
  const report = await getAttendanceRuntimeIntegrity(env, requestInput);
  return {
    body: report,
    statusCode: report.status === "failed" ? 503 : 200,
  };
};
