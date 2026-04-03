import { formatDistanceToNowStrict } from "date-fns";

export const DEVICE_ONLINE_WINDOW_MS = 90_000;
export const DEVICE_IDLE_WINDOW_MS = 10 * 60 * 1000;
export const DEVICE_COMMAND_POLL_INTERVAL_MS = 2_000;

export type DevicePresence = "online" | "idle" | "offline" | "disabled";
export type DeviceCommandType = "disable_device" | "force_logout" | "restart_scanner" | "push_config_update";
export type DeviceCommandStatus = "pending" | "acknowledged" | "completed" | "failed" | "cancelled";

export type EntryDeviceRecord = {
  device_id: string;
  device_name: string | null;
  id: string;
  is_active: boolean;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

export type DeviceCommandRecord = {
  acknowledged_at: string | null;
  completed_at: string | null;
  command_type: DeviceCommandType;
  device_id: string;
  error_message: string | null;
  failed_at: string | null;
  id: string;
  library_id: string;
  metadata: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  requested_at: string;
  requested_by: string | null;
  requested_by_role: string | null;
  status: DeviceCommandStatus | string;
  updated_at: string;
};

export type DeviceControlState = {
  currentCommandError: string | null;
  currentCommandId: string | null;
  currentCommandRequestedAt: string | null;
  currentCommandStatus: string | null;
  currentCommandType: DeviceCommandType | null;
  lastCommandAt: string | null;
  lastCommandError: string | null;
  lastCommandStatus: DeviceCommandStatus | string | null;
  lastCommandType: DeviceCommandType | null;
  status: string;
};

const trimText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const toMetadataRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
};

export const formatRelativeTime = (value: string | null | undefined, fallback = "Never") => {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return formatDistanceToNowStrict(parsed, { addSuffix: true });
};

export const resolveDevicePresence = (device: Pick<EntryDeviceRecord, "is_active" | "last_seen_at">): DevicePresence => {
  if (!device.is_active) {
    return "disabled";
  }

  const lastSeenMs = Date.parse(device.last_seen_at ?? "");
  if (Number.isNaN(lastSeenMs)) {
    return "offline";
  }

  const elapsed = Date.now() - lastSeenMs;
  if (elapsed <= DEVICE_ONLINE_WINDOW_MS) {
    return "online";
  }

  if (elapsed <= DEVICE_IDLE_WINDOW_MS) {
    return "idle";
  }

  return "offline";
};

export const getPresenceBadgeProps = (presence: DevicePresence) => {
  switch (presence) {
    case "online":
      return {
        className: "border-emerald-300/30 bg-emerald-50 text-emerald-700",
        label: "Online",
      };
    case "idle":
      return {
        className: "border-amber-300/30 bg-amber-50 text-amber-700",
        label: "Idle",
      };
    case "disabled":
      return {
        className: "border-slate-300/30 bg-slate-100 text-slate-700",
        label: "Disabled",
      };
    default:
      return {
        className: "border-rose-300/30 bg-rose-50 text-rose-700",
        label: "Offline",
      };
  }
};

export const getDeviceCommandTypeLabel = (commandType: DeviceCommandType | string | null | undefined) => {
  switch (trimText(commandType)) {
    case "disable_device":
      return "Disable device";
    case "force_logout":
      return "Force logout";
    case "restart_scanner":
      return "Restart scanner";
    case "push_config_update":
      return "Push config update";
    default:
      return "Command";
  }
};

export const getDeviceCommandTypeDescription = (commandType: DeviceCommandType | string | null | undefined) => {
  switch (trimText(commandType)) {
    case "disable_device":
      return "Takes the kiosk out of service until it is reactivated.";
    case "force_logout":
      return "Clears the kiosk session and sends it back to setup.";
    case "restart_scanner":
      return "Restarts the live camera scanner without changing the binding.";
    case "push_config_update":
      return "Refreshes the kiosk so it pulls the latest runtime settings.";
    default:
      return "Remote device action.";
  }
};

export const resolveDeviceControlState = (
  device: Pick<EntryDeviceRecord, "is_active" | "metadata">,
): DeviceControlState => {
  const metadata = toMetadataRecord(device.metadata);
  const control = toMetadataRecord(metadata.device_control);
  const status = trimText(control.status) || (device.is_active ? "active" : "disabled");
  const currentCommandType = trimText(control.current_command_type) as DeviceCommandType | "";
  const lastCommandType = trimText(control.last_command_type) as DeviceCommandType | "";
  const lastCommandStatus = trimText(control.last_command_status) as DeviceCommandStatus | "";

  return {
    currentCommandError: trimText(control.current_command_error) || null,
    currentCommandId: trimText(control.current_command_id) || null,
    currentCommandRequestedAt: trimText(control.current_command_requested_at) || null,
    currentCommandStatus: trimText(control.current_command_status) || null,
    currentCommandType: currentCommandType || null,
    lastCommandAt: trimText(control.last_command_at) || null,
    lastCommandError: trimText(control.last_command_error) || null,
    lastCommandStatus: lastCommandStatus || null,
    lastCommandType: lastCommandType || null,
    status,
  };
};

export const getDeviceControlBadgeProps = (status: string | null | undefined) => {
  switch (trimText(status)) {
    case "active":
      return {
        className: "border-emerald-300/30 bg-emerald-50 text-emerald-700",
        label: "Active",
      };
    case "disabled":
      return {
        className: "border-slate-300/30 bg-slate-100 text-slate-700",
        label: "Disabled",
      };
    case "logout_required":
      return {
        className: "border-amber-300/30 bg-amber-50 text-amber-700",
        label: "Logout required",
      };
    case "restart_requested":
      return {
        className: "border-sky-300/30 bg-sky-50 text-sky-700",
        label: "Restart requested",
      };
    case "config_update_requested":
      return {
        className: "border-cyan-300/30 bg-cyan-50 text-cyan-700",
        label: "Config update",
      };
    case "rebind_required":
      return {
        className: "border-rose-300/30 bg-rose-50 text-rose-700",
        label: "Rebind required",
      };
    default:
      return {
        className: "border-border bg-muted text-muted-foreground",
        label: trimText(status) || "Unknown",
      };
  }
};

export const getDeviceCommandStatusBadgeProps = (status: string | null | undefined) => {
  switch (trimText(status)) {
    case "pending":
      return {
        className: "border-amber-300/30 bg-amber-50 text-amber-700",
        label: "Pending",
      };
    case "acknowledged":
      return {
        className: "border-sky-300/30 bg-sky-50 text-sky-700",
        label: "Acknowledged",
      };
    case "completed":
      return {
        className: "border-emerald-300/30 bg-emerald-50 text-emerald-700",
        label: "Completed",
      };
    case "failed":
      return {
        className: "border-rose-300/30 bg-rose-50 text-rose-700",
        label: "Failed",
      };
    case "cancelled":
      return {
        className: "border-slate-300/30 bg-slate-100 text-slate-700",
        label: "Cancelled",
      };
    default:
      return {
        className: "border-border bg-muted text-muted-foreground",
        label: trimText(status) || "Unknown",
      };
  }
};

export const resolveDeviceCommandMessage = (command: Pick<DeviceCommandRecord, "command_type" | "payload">) => {
  const payload = toMetadataRecord(command.payload);
  const message = trimText(payload.message) || trimText(payload.reason);
  if (message) {
    return message;
  }

  switch (command.command_type) {
    case "disable_device":
      return "This kiosk was disabled by the owner.";
    case "force_logout":
      return "The owner requested a kiosk sign-out.";
    case "restart_scanner":
      return "The owner requested a scanner restart.";
    case "push_config_update":
      return "The owner pushed a kiosk configuration refresh.";
    default:
      return "Remote device command received.";
  }
};

export const getLatestCommandForDevice = (
  commands: DeviceCommandRecord[],
  deviceId: string,
) => commands.find((command) => command.device_id === deviceId) ?? null;
