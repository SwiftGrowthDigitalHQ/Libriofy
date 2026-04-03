import { createClient } from "@supabase/supabase-js";
import { logAttendanceFailure } from "./attendanceFailureLogger";
import { getLibraryAccessKeySuffix, normalizeLibraryAccessKey } from "./libraryAccessKey";

type EnvLike = Record<string, string | undefined>;

type DeviceHeartbeatRequestBody = Record<string, unknown>;

type DeviceHeartbeatResponseBody =
  | {
      valid: true;
      deviceId: string;
      libraryId: string;
      deviceName: string | null;
      heartbeatAt: string;
      lastSeenAt: string;
    }
  | {
      valid: false;
      message: string;
      code?: string;
    };

export type DeviceHeartbeatServiceResponse = {
  statusCode: number;
  body: DeviceHeartbeatResponseBody;
};

const DEVICE_HEARTBEAT_ROUTE = "/api/device-heartbeat";

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

const normalizeBoolean = (value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return null;
};

const normalizeInteger = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return null;
};

const normalizeIsoString = (value: unknown) => {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const toMetadataRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

const buildError = (
  message: string,
  statusCode: number,
  code?: string,
): DeviceHeartbeatServiceResponse => ({
  statusCode,
  body: {
    valid: false,
    message,
    ...(code ? { code } : {}),
  },
});

export const resolveDeviceHeartbeatRequest = async (
  env: EnvLike,
  requestBody: unknown,
): Promise<DeviceHeartbeatServiceResponse> => {
  const body =
    requestBody && typeof requestBody === "object" && !Array.isArray(requestBody)
      ? (requestBody as DeviceHeartbeatRequestBody)
      : {};

  const deviceId = normalizeString(body.device_id ?? body.deviceId);
  const clientLibraryId = normalizeString(body.library_id ?? body.libraryId);
  const libraryAccessKey = normalizeLibraryAccessKey(
    body.library_access_key ?? body.libraryAccessKey,
  );
  const deviceName = normalizeString(body.device_name ?? body.deviceName) || null;
  const pendingCount = normalizeInteger(body.pending_count ?? body.pendingCount);
  const lastSyncAt = normalizeIsoString(body.last_sync_at ?? body.lastSyncAt);
  const isOnline = normalizeBoolean(body.is_online ?? body.isOnline);
  const cameraReady = normalizeBoolean(body.camera_ready ?? body.cameraReady);
  const phase = normalizeString(body.phase);
  const userAgent = normalizeString(body.user_agent ?? body.userAgent) || null;
  const appVersion = normalizeString(body.app_version ?? body.appVersion) || null;
  const libraryAccessKeySuffix = getLibraryAccessKeySuffix(libraryAccessKey) || null;

  if (!deviceId || !libraryAccessKey) {
    return buildError("Device ID and Library ID are required.", 400, "DEVICE_BLOCKED");
  }

  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return buildError("Scanner heartbeat is not configured on the server.", 500, "CONFIG_ERROR");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const heartbeatAt = new Date().toISOString();

  const { data: accessKeyRecord, error: accessKeyError } = await supabase
    .from("library_access_keys")
    .select("library_id")
    .eq("access_key", libraryAccessKey)
    .maybeSingle();

  if (accessKeyError) {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: accessKeyError.message || "Unable to validate the Library ID",
      code: "SERVER_ERROR",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: clientLibraryId || null,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "library_access_key_lookup",
      },
    });

    return buildError("Unable to validate the Library ID.", 500, "SERVER_ERROR");
  }

  if (!accessKeyRecord?.library_id) {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: "Library ID invalid",
      code: "INVALID_LIBRARY_ID",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: clientLibraryId || null,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "invalid_library_access_key",
      },
    });

    return buildError("Library ID rotated or invalid. Reconnect this device.", 403, "INVALID_LIBRARY_ID");
  }

  const resolvedLibraryId = accessKeyRecord.library_id;

  const { data: deviceData, error: deviceError } = await supabase
    .from("entry_devices")
    .select("id, device_id, device_name, is_active, library_id, metadata")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (deviceError) {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: deviceError.message || "Unable to validate the device",
      code: "SERVER_ERROR",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "device_lookup",
      },
    });

    return buildError("Unable to validate the device.", 500, "SERVER_ERROR");
  }

  if (!deviceData) {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: "Device not bound",
      code: "DEVICE_BLOCKED",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "device_missing",
      },
    });

    return buildError("Device not bound. Reconnect this kiosk.", 403, "DEVICE_BLOCKED");
  }

  if (clientLibraryId && clientLibraryId !== resolvedLibraryId) {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: "Wrong Library",
      code: "WRONG_LIBRARY",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: clientLibraryId,
        expected_library_id: resolvedLibraryId,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "client_library_mismatch",
      },
    });

    return buildError("Device is assigned to another library. Reconnect this kiosk.", 403, "WRONG_LIBRARY");
  }

  if (deviceData.library_id !== resolvedLibraryId) {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: "Wrong Library",
      code: "WRONG_LIBRARY",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: resolvedLibraryId,
        expected_library_id: deviceData.library_id,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "device_library_mismatch",
      },
    });

    return buildError("Device is assigned to another library. Reconnect this kiosk.", 403, "WRONG_LIBRARY");
  }

  if (!deviceData.is_active) {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: "Device disabled",
      code: "DEVICE_BLOCKED",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "device_inactive",
      },
    });

    return buildError("Device access has been disabled. Reconnect this kiosk.", 403, "DEVICE_BLOCKED");
  }

  const metadata = toMetadataRecord(deviceData.metadata);
  const runtimeMetadata = toMetadataRecord(metadata.device_runtime);
  const controlMetadata = toMetadataRecord(metadata.device_control);

  if (String(controlMetadata.status ?? "").trim() === "disabled") {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: "Device disabled",
      code: "DEVICE_BLOCKED",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "device_disabled",
      },
    });

    return buildError("Device access has been disabled by the owner. Reactivate this kiosk from the control center.", 403, "DEVICE_BLOCKED");
  }

  const nextMetadata = {
    ...metadata,
    device_runtime: {
      ...runtimeMetadata,
      camera_ready: cameraReady,
      is_online: isOnline,
      last_heartbeat_at: heartbeatAt,
      last_sync_at: lastSyncAt,
      library_access_key_suffix: libraryAccessKeySuffix,
      pending_count: pendingCount,
      phase: phase || runtimeMetadata.phase || null,
      app_version: appVersion || runtimeMetadata.app_version || null,
      user_agent: userAgent || runtimeMetadata.user_agent || null,
    },
  };

  const updatePayload: Record<string, unknown> = {
    last_seen_at: heartbeatAt,
    metadata: nextMetadata,
  };

  if (deviceName && deviceName !== deviceData.device_name) {
    updatePayload.device_name = deviceName;
  }

  const { error: updateError } = await supabase
    .from("entry_devices")
    .update(updatePayload)
    .eq("id", deviceData.id);

  if (updateError) {
    await logAttendanceFailure({
      client: supabase,
      route: DEVICE_HEARTBEAT_ROUTE,
      message: updateError.message || "Unable to update the device heartbeat",
      code: "SERVER_ERROR",
      source: "device-heartbeat-server",
      metadata: {
        device_id: deviceId,
        library_id: resolvedLibraryId,
        library_access_key_suffix: libraryAccessKeySuffix,
        stage: "heartbeat_update",
      },
    });

    return buildError("Unable to update the device heartbeat.", 500, "SERVER_ERROR");
  }

  return {
    statusCode: 200,
    body: {
      valid: true,
      deviceId,
      libraryId: resolvedLibraryId,
      deviceName: deviceName ?? deviceData.device_name ?? null,
      heartbeatAt,
      lastSeenAt: heartbeatAt,
    },
  };
};
