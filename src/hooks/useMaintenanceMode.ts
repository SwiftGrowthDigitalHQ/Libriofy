import { useCallback, useEffect, useRef, useState } from "react";
import { loadMaintenanceStatus } from "@/lib/maintenanceClient";
import type { MaintenanceStatus } from "@/lib/maintenance";

export type MaintenanceModeState = MaintenanceStatus & {
  loading: boolean;
};

type UseMaintenanceModeOptions = {
  enabled?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const DEFAULT_STATE: MaintenanceModeState = {
  maintenanceMode: false,
  source: "fallback",
  updatedAt: null,
  loading: true,
};

export const useMaintenanceMode = ({
  enabled = true,
  pollIntervalMs = 30000,
  timeoutMs = 3500,
}: UseMaintenanceModeOptions = {}) => {
  const [state, setState] = useState<MaintenanceModeState>(DEFAULT_STATE);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const status = await loadMaintenanceStatus({ timeoutMs });

      if (requestIdRef.current === requestId) {
        setState({
          ...status,
          loading: false,
        });
      }

      return status;
    } catch {
      const fallbackStatus: MaintenanceModeState = {
        maintenanceMode: false,
        source: "fallback",
        updatedAt: null,
        loading: false,
      };

      if (requestIdRef.current === requestId) {
        setState(fallbackStatus);
      }

      return fallbackStatus;
    }
  }, [timeoutMs]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let mounted = true;

    void refresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && mounted) {
        void refresh();
      }
    };

    const intervalId =
      pollIntervalMs > 0
        ? window.setInterval(() => {
            if (mounted) {
              void refresh();
            }
          }, pollIntervalMs)
        : null;

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleVisibilityChange);

    return () => {
      mounted = false;

      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }

      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleVisibilityChange);
    };
  }, [enabled, pollIntervalMs, refresh]);

  return {
    ...state,
    refresh,
  };
};
