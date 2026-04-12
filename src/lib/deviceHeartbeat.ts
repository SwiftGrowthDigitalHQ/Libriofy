export type DeviceHeartbeatStatus = {
  appVersion?: string | null;
  cameraReady?: boolean;
  deviceName?: string | null;
  isOnline?: boolean;
  lastSyncAt?: string | null;
  pendingCount?: number;
  phase?: string | null;
};

export type DeviceHeartbeatSuccess = {
  code?: undefined;
  valid: true;
  deviceId: string;
  libraryId: string;
  deviceName: string | null;
  heartbeatAt: string;
  lastSeenAt: string;
  message?: undefined;
};

export type DeviceHeartbeatFailure = {
  valid: false;
  message: string;
  code?: string;
};

export type DeviceHeartbeatResponse = DeviceHeartbeatSuccess | DeviceHeartbeatFailure;

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const sendDeviceHeartbeat = async ({
  apiUrl = "/api/device-heartbeat",
  deviceId,
  libraryAccessKey,
  libraryId,
  signal,
  status,
}: {
  apiUrl?: string;
  deviceId: string;
  libraryAccessKey: string;
  libraryId?: string | null;
  signal?: AbortSignal;
  status?: DeviceHeartbeatStatus;
}): Promise<DeviceHeartbeatResponse> => {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      device_id: trimText(deviceId),
      library_access_key: trimText(libraryAccessKey),
      library_id: trimText(libraryId),
      device_name: trimText(status?.deviceName),
      pending_count: status?.pendingCount ?? null,
      last_sync_at: trimText(status?.lastSyncAt),
      is_online: status?.isOnline ?? null,
      camera_ready: status?.cameraReady ?? null,
      phase: trimText(status?.phase),
      app_version: trimText(status?.appVersion),
      user_agent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    }),
    signal,
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (payload && typeof payload.valid === "boolean") {
    if (payload.valid) {
      return {
        valid: true,
        deviceId: trimText(payload.deviceId),
        libraryId: trimText(payload.libraryId),
        deviceName: trimText(payload.deviceName) || null,
        heartbeatAt: trimText(payload.heartbeatAt),
        lastSeenAt: trimText(payload.lastSeenAt),
      };
    }

    return {
      valid: false,
      message: trimText(payload.message) || "Unable to validate this kiosk.",
      ...(trimText(payload.code) ? { code: trimText(payload.code) } : {}),
    };
  }

  throw new Error(`Unexpected heartbeat response (${response.status}).`);
};
