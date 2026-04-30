import { createClient } from "@supabase/supabase-js";
import { logAttendanceFailure } from "./attendanceFailureLogger.js";
import { getLibraryAccessKeySuffix, normalizeLibraryAccessKey } from "./libraryAccessKey.js";

type EnvLike = Record<string, string | undefined>;

type LibrarySetupRow = {
  id: string;
  name: string;
  library_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
};

type DeviceSetupAttemptRow = {
  attempt_count: number | null;
  locked_until: string | null;
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
const nowIso = () => new Date().toISOString();
const MAX_INVALID_SETUP_ATTEMPTS = 5;
const SETUP_LOCK_DURATION_MS = 15 * 60 * 1000;

const toMetadataRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

export type DeviceSetupResult =
  | {
      valid: true;
      bound: boolean;
      deviceId: string;
      libraryAccessKey: string;
      library: LibrarySetupRow;
    }
  | {
      valid: false;
      message: string;
      code?: string;
      lockedUntil?: string | null;
    };

export const validateAndBindScannerDevice = async (
  env: EnvLike,
  requestedLibraryAccessKey: string,
  requestedDeviceId?: string,
): Promise<DeviceSetupResult> => {
  const libraryAccessKey = normalizeLibraryAccessKey(requestedLibraryAccessKey);
  const scannerDeviceId =
    normalizeString(requestedDeviceId) ||
    readEnv(env, "VITE_SCAN_DEVICE_ID", "SCAN_DEVICE_ID") ||
    "LIB_GATE_01";

  if (!libraryAccessKey) {
    return {
      valid: false,
      message: "Library ID is required.",
      code: "INVALID_LIBRARY_ID",
    };
  }

  if (!scannerDeviceId) {
    return {
      valid: false,
      message: "Device ID is required.",
      code: "DEVICE_BLOCKED",
    };
  }

  const supabaseUrl = readEnv(env, "SUPABASE_URL", "VITE_SUPABASE_URL");
  const serviceRoleKey = readEnv(env, "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      valid: false,
      message: "Scanner setup is not configured on the server.",
    };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const route = "/api/device-setup";

  const { data: attemptRowData, error: attemptError } = await supabase
    .from("device_setup_attempts")
    .select("attempt_count, locked_until")
    .eq("device_id", scannerDeviceId)
    .maybeSingle();

  if (attemptError) {
    throw attemptError;
  }

  const attemptRow = (attemptRowData ?? null) as DeviceSetupAttemptRow | null;
  if (attemptRow?.locked_until && new Date(attemptRow.locked_until).getTime() > Date.now()) {
    await logAttendanceFailure({
      client: supabase,
      route,
      message: "Device setup temporarily locked",
      code: "DEVICE_SETUP_LOCKED",
      source: "device-setup-server",
      metadata: {
        device_id: scannerDeviceId,
        locked_until: attemptRow.locked_until,
        library_access_key_suffix: getLibraryAccessKeySuffix(libraryAccessKey) || null,
        stage: "device_locked",
      },
    });

    return {
      valid: false,
      message: `Too many invalid attempts. Try again after ${new Date(attemptRow.locked_until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
      code: "DEVICE_SETUP_LOCKED",
      lockedUntil: attemptRow.locked_until,
    };
  }

  const deviceName = readEnv(env, "VITE_SCAN_DEVICE_NAME", "SCAN_DEVICE_NAME");

  const { data: accessKeyRecord, error: accessKeyError } = await supabase
    .from("library_access_keys")
    .select("library_id")
    .eq("access_key", libraryAccessKey)
    .maybeSingle();

  if (accessKeyError) {
    throw accessKeyError;
  }

  if (!accessKeyRecord?.library_id) {
    const currentAttempts =
      attemptRow?.locked_until && new Date(attemptRow.locked_until).getTime() <= Date.now()
        ? 0
        : attemptRow?.attempt_count ?? 0;
    const nextAttempts = currentAttempts + 1;
    const lockedUntil =
      nextAttempts >= MAX_INVALID_SETUP_ATTEMPTS
        ? new Date(Date.now() + SETUP_LOCK_DURATION_MS).toISOString()
        : null;

    const { error: upsertAttemptError } = await supabase.from("device_setup_attempts").upsert({
      device_id: scannerDeviceId,
      attempt_count: lockedUntil ? 0 : nextAttempts,
      first_failed_at: currentAttempts === 0 ? nowIso() : undefined,
      last_failed_at: nowIso(),
      locked_until: lockedUntil,
      last_access_key_suffix: getLibraryAccessKeySuffix(libraryAccessKey) || null,
    });

    if (upsertAttemptError) {
      throw upsertAttemptError;
    }

    await logAttendanceFailure({
      client: supabase,
      route,
      message: lockedUntil ? "Too many invalid Library ID attempts" : "Library ID not found",
      code: lockedUntil ? "DEVICE_SETUP_LOCKED" : "INVALID_LIBRARY_ID",
      source: "device-setup-server",
      metadata: {
        attempt_count: nextAttempts,
        device_id: scannerDeviceId,
        library_access_key_suffix: getLibraryAccessKeySuffix(libraryAccessKey) || null,
        locked_until: lockedUntil,
        stage: "invalid_library_access_key",
      },
    });

    return {
      valid: false,
      message: lockedUntil
        ? `Too many invalid attempts. Device locked until ${new Date(lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
        : `Library ID not found. ${MAX_INVALID_SETUP_ATTEMPTS - nextAttempts} attempt${MAX_INVALID_SETUP_ATTEMPTS - nextAttempts === 1 ? "" : "s"} remaining.`,
      code: lockedUntil ? "DEVICE_SETUP_LOCKED" : "INVALID_LIBRARY_ID",
      lockedUntil,
    };
  }

  const { data: library, error: libraryError } = await supabase
    .from("libraries")
    .select("id, name, library_name, logo_url, primary_color")
    .eq("id", accessKeyRecord.library_id)
    .maybeSingle();

  if (libraryError) {
    throw libraryError;
  }

  if (!library) {
    return {
      valid: false,
      message: "Library ID not found.",
      code: "INVALID_LIBRARY_ID",
    };
  }

  const { data: existingDeviceData, error: deviceError } = await supabase
    .from("entry_devices")
    .select("metadata")
    .eq("device_id", scannerDeviceId)
    .maybeSingle();

  if (deviceError) {
    throw deviceError;
  }

  const existingDevice = existingDeviceData as { metadata: Record<string, unknown> | null } | null;
  const currentMetadata = toMetadataRecord(existingDevice?.metadata);
  const currentControl = toMetadataRecord(currentMetadata.device_control);

  if (existingDevice && String(currentControl.status ?? "").trim() === "disabled") {
    return {
      valid: false,
      message: "This kiosk has been disabled by the owner. Reactivate it from the device control center before reconnecting.",
      code: "DEVICE_BLOCKED",
    };
  }

  const nextMetadata = {
    ...currentMetadata,
    device_setup: {
      library_id: library.id,
      library_access_key_suffix: getLibraryAccessKeySuffix(libraryAccessKey),
      configured_at: new Date().toISOString(),
      source: "device-setup",
    },
    device_control: {
      ...currentControl,
      current_command_error: null,
      current_command_id: null,
      current_command_requested_at: null,
      current_command_status: null,
      current_command_type: null,
      status: "active",
    },
  };

  if (existingDevice) {
    const updatePayload: Record<string, unknown> = {
      library_id: library.id,
      is_active: true,
      metadata: nextMetadata,
    };

    if (deviceName) {
      updatePayload.device_name = deviceName;
    }

    const { error: updateError } = await supabase
      .from("entry_devices")
      .update(updatePayload)
      .eq("device_id", scannerDeviceId);

    if (updateError) {
      throw updateError;
    }
  } else {
    const insertPayload: Record<string, unknown> = {
      device_id: scannerDeviceId,
      library_id: library.id,
      is_active: true,
      metadata: nextMetadata,
    };

    if (deviceName) {
      insertPayload.device_name = deviceName;
    }

    const { error: insertError } = await supabase.from("entry_devices").insert(insertPayload);

    if (insertError) {
      throw insertError;
    }
  }

  if (attemptRow) {
    const { error: deleteAttemptError } = await supabase
      .from("device_setup_attempts")
      .delete()
      .eq("device_id", scannerDeviceId);

    if (deleteAttemptError) {
      throw deleteAttemptError;
    }
  }

  return {
    valid: true,
    bound: true,
    deviceId: scannerDeviceId,
    libraryAccessKey: libraryAccessKey,
    library: {
      id: library.id,
      name: library.name,
      library_name: library.library_name,
      logo_url: library.logo_url,
      primary_color: library.primary_color,
    },
  };
};
