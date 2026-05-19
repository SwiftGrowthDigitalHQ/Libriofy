export const SUPER_ADMIN_LIGHTWEIGHT_MODE_ENABLED = true;
export const SUPER_ADMIN_DEFAULT_AUTO_REFRESH_ENABLED = false;
export const SUPER_ADMIN_SNAPSHOT_STALE_TIME_MS = 3 * 60_000;
export const SUPER_ADMIN_SNAPSHOT_REFRESH_INTERVAL_MS = 3 * 60_000;

export const resolveSuperAdminSnapshotRefresh = (
  enabled: boolean,
  intervalMs = SUPER_ADMIN_SNAPSHOT_REFRESH_INTERVAL_MS,
) => (enabled ? intervalMs : false);
