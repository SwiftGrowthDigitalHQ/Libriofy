import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { DeviceCommandRecord, DeviceCommandStatus, DeviceCommandType } from "./deviceControl";

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

let deviceCommandsRpcUnavailable = false;

const isMissingRpcError = (error: unknown) => {
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : typeof error === "object" && error && "message" in error && typeof (error as { message?: unknown }).message === "string"
      ? String((error as { message?: unknown }).message).toLowerCase()
      : "";

  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("pgrst202")
  );
};

const normalizePayload = (value?: Record<string, unknown> | null): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

const resolveRpcError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error && error.message.trim()) {
    return new Error(error.message);
  }

  if (error && typeof error === "object") {
    const maybeError = error as { message?: unknown };
    if (typeof maybeError.message === "string") {
      const message = maybeError.message.trim();
      if (message) {
        return new Error(message);
      }
    }
  }

  return new Error(fallbackMessage);
};

export const issueDeviceCommand = async ({
  commandType,
  deviceId,
  libraryId,
  payload,
}: {
  commandType: DeviceCommandType;
  deviceId: string;
  libraryId: string;
  payload?: Record<string, unknown>;
}): Promise<DeviceCommandRecord> => {
  const { data, error } = await supabase.rpc("issue_device_command", {
    p_command_type: trimText(commandType),
    p_device_id: trimText(deviceId),
    p_library_id: trimText(libraryId),
    p_payload: normalizePayload(payload),
  });

  if (error) {
    throw resolveRpcError(error, "Unable to issue the device command.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Device command response was incomplete.");
  }

  return data as DeviceCommandRecord;
};

export const pullDeviceCommands = async ({
  deviceId,
  deviceToken,
  libraryAccessKey,
  libraryId,
  limit = 5,
}: {
  deviceId: string;
  deviceToken: string;
  libraryAccessKey: string;
  libraryId: string;
  limit?: number;
}): Promise<DeviceCommandRecord[]> => {
  if (deviceCommandsRpcUnavailable) {
    return [];
  }

  const { data, error } = await supabase.rpc("pull_device_commands", {
    p_device_id: trimText(deviceId),
    p_device_token: trimText(deviceToken),
    p_limit: Number.isFinite(limit) ? Math.max(1, Math.min(Math.round(limit), 25)) : 5,
    p_library_access_key: trimText(libraryAccessKey),
    p_library_id: trimText(libraryId),
  });

  if (error) {
    const resolvedError = resolveRpcError(error, "Unable to load device commands.");
    if (isMissingRpcError(resolvedError)) {
      deviceCommandsRpcUnavailable = true;
      return [];
    }

    throw resolvedError;
  }

  return (data ?? []) as DeviceCommandRecord[];
};

export const recordDeviceCommandStatus = async ({
  commandId,
  deviceId,
  deviceToken,
  errorMessage,
  libraryAccessKey,
  libraryId,
  metadata,
  status,
}: {
  commandId: string;
  deviceId: string;
  deviceToken: string;
  errorMessage?: string | null;
  libraryAccessKey: string;
  libraryId: string;
  metadata?: Record<string, unknown>;
  status: DeviceCommandStatus;
}): Promise<DeviceCommandRecord> => {
  const { data, error } = await supabase.rpc("record_device_command_status", {
    p_command_id: trimText(commandId),
    p_device_id: trimText(deviceId),
    p_device_token: trimText(deviceToken),
    p_error_message: trimText(errorMessage ?? ""),
    p_library_access_key: trimText(libraryAccessKey),
    p_library_id: trimText(libraryId),
    p_metadata: normalizePayload(metadata),
    p_status: trimText(status),
  });

  if (error) {
    throw resolveRpcError(error, "Unable to update the command status.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Device command update response was incomplete.");
  }

  return data as DeviceCommandRecord;
};
