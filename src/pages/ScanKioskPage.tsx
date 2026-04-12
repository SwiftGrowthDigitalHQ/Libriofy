import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  type AttendanceQueueEntry,
  type AttendanceScanPayload,
  countAttendanceQueueEntries,
  createAttendanceQueueEntry,
  enqueueAttendanceQueueEntry,
  readLastAttendanceSyncAt,
  submitAttendanceScan,
  syncQueuedAttendance,
} from "@/lib/attendanceSync";
import { getReadableCameraError } from "@/lib/cameraStartup";
import {
  clearStoredLibraryBinding,
  parseStudentQrPayload,
  readStoredLibraryAccessKey,
  readStoredLibraryId,
  writeDeviceSetupNotice,
} from "@/lib/deviceKiosk";
import { sendDeviceHeartbeat } from "@/lib/deviceHeartbeat";
import {
  readOfflineVerifiedStudent,
  rememberOfflineVerifiedStudent,
} from "@/lib/offlineVerifiedStudentCache";
import { ScanController } from "@/lib/scan/ScanController";
import type {
  ScanControllerLogLevel,
  ScanControllerState,
  ScanDetectionPayload,
} from "@/lib/scan/types";
import { cn } from "@/lib/utils";

const DEVICE_ID = import.meta.env.VITE_SCAN_DEVICE_ID ?? "LIB_GATE_01";
const DEVICE_NAME = import.meta.env.VITE_SCAN_DEVICE_NAME ?? "Library ID Scanner";
const SCAN_API_URL = import.meta.env.VITE_SCAN_API_URL ?? "/api/attendance/scan";
const DEVICE_HEARTBEAT_API_URL = import.meta.env.VITE_DEVICE_HEARTBEAT_API_URL ?? "/api/device-heartbeat";
const SCAN_DEVICE_TOKEN = import.meta.env.VITE_SCAN_DEVICE_TOKEN ?? "";
const STUDENT_QR_PUBLIC_KEY = import.meta.env.VITE_QR_PUBLIC_KEY ?? import.meta.env.VITE_STUDENT_QR_PUBLIC_KEY ?? "";
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "scanner-web";

const DEVICE_BINDING_RESET_CODES = new Set(["INVALID_LIBRARY_ID", "WRONG_LIBRARY", "DEVICE_BLOCKED"]);
const DUPLICATE_SCAN_WINDOW_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_SCAN_VALUE_LENGTH = 4096;
const RESULT_HOLD_MS = 1500;
const SYNC_INTERVAL_MS = 25000;
const MAX_LOG_ENTRIES = 12;

let pendingShutdown: Promise<void> | null = null;

const waitForPendingShutdown = async () => {
  if (!pendingShutdown) {
    return;
  }

  try {
    await pendingShutdown;
  } catch {
    // ignore shutdown errors
  } finally {
    pendingShutdown = null;
  }
};

type KioskPhase = "idle" | "scanning" | "success" | "queued" | "error";

type ScannerLogEntry = {
  at: string;
  detail?: unknown;
  event: string;
  level: ScanControllerLogLevel;
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const createInitialControllerState = (): ScanControllerState => ({
  activeCameraId: null,
  activeCameraLabel: null,
  devices: [],
  error: null,
  lastFrameAt: null,
  permissionState: null,
  status: "idle",
  torchBusy: false,
  torchEnabled: false,
  torchSupported: false,
});

const formatScanTime = (timestamp: string) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

const serializeLogDetail = (value: unknown, depth = 0): unknown => {
  if (depth > 3) {
    return "[depth-limit]";
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack ?? null,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((entry) => serializeLogDetail(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 24)
        .map(([key, entry]) => [key, serializeLogDetail(entry, depth + 1)]),
    );
  }

  if (typeof value === "function") {
    return "[function]";
  }

  return value;
};

const buildOfflineQueuedPayload = ({
  entry,
  fallbackMessage,
  libraryId,
  parsedSource,
  studentId,
}: {
  entry: AttendanceQueueEntry;
  fallbackMessage?: string;
  libraryId: string;
  parsedSource: "legacy" | "structured" | "signed";
  studentId: string;
}): Extract<AttendanceScanPayload, { status: "queued" }> => {
  const cachedStudent = readOfflineVerifiedStudent({
    libraryId,
    studentId,
  });
  const verifiedOffline = Boolean(cachedStudent) || parsedSource === "signed";
  const cachedName = cachedStudent?.name || null;

  return {
    status: "queued",
    message:
      fallbackMessage ||
      (verifiedOffline
        ? "Offline verified. Attendance is saved locally and will sync automatically."
        : "Saved offline. The scan will sync automatically when the connection returns."),
    time: formatScanTime(entry.timestamp),
    entry_id: entry.entry_id,
    ...(verifiedOffline ? { verifiedOffline: true } : {}),
    ...(cachedName ? { name: cachedName, studentName: cachedName } : {}),
    ...(cachedStudent?.seat ? { seat: cachedStudent.seat } : {}),
  };
};

const ScanKioskPage = () => {
  const navigate = useNavigate();
  const bindingRedirectInFlightRef = useRef(false);
  const controllerRef = useRef<ScanController | null>(null);
  const heartbeatInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const processingRef = useRef(false);
  const lastAcceptedScanRef = useRef({
    at: 0,
    value: "",
  });
  const resumeTimerRef = useRef<number | null>(null);
  const scanHandlerRef = useRef<(payload: ScanDetectionPayload) => void>(() => undefined);
  const syncInFlightRef = useRef(false);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  const [controllerState, setControllerState] = useState<ScanControllerState>(() => createInitialControllerState());
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [, setLogEntries] = useState<ScannerLogEntry[]>([]);
  const [phase, setPhase] = useState<KioskPhase>("idle");
  const [scanPayload, setScanPayload] = useState<AttendanceScanPayload | null>(null);
  const [statusMessage, setStatusMessage] = useState("Starting scanner...");
  const [resultFading, setResultFading] = useState(false);

  useEffect(() => {
    if (!scanPayload) {
      setResultFading(false);
      return;
    }

    setResultFading(false);
    const timer = window.setTimeout(() => {
      setResultFading(true);
    }, Math.max(200, RESULT_HOLD_MS - 300));

    return () => {
      window.clearTimeout(timer);
    };
  }, [scanPayload]);

  const appendLog = useCallback(
    (level: ScanControllerLogLevel, event: string, detail?: Record<string, unknown>) => {
      const nextEntry: ScannerLogEntry = {
        at: new Date().toISOString(),
        detail: detail ? serializeLogDetail(detail) : undefined,
        event,
        level,
      };

      startTransition(() => {
        setLogEntries((current) => [nextEntry, ...current].slice(0, MAX_LOG_ENTRIES));
      });
    },
    [],
  );

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const redirectToDeviceSetup = useCallback(
    async (message: string) => {
      if (bindingRedirectInFlightRef.current) {
        return;
      }

      bindingRedirectInFlightRef.current = true;
      processingRef.current = false;
      clearResumeTimer();
      writeDeviceSetupNotice(message || "Reconnect this kiosk to continue scanning.");
      clearStoredLibraryBinding();

      const controller = controllerRef.current;
      try {
        await controller?.stop("binding-reset");
      } finally {
        if (mountedRef.current) {
          navigate("/setup-device", { replace: true });
        }
      }
    },
    [clearResumeTimer, navigate],
  );

  const releaseScanner = useCallback(
    (reason: string) => {
      processingRef.current = false;
      if (!mountedRef.current) {
        return;
      }

      setPhase("idle");
      setScanPayload(null);
      setStatusMessage(isOnline ? "Show QR to scan" : "Offline mode active.");

      const controller = controllerRef.current;
      if (!controller) {
        return;
      }

      const currentState = controller.getState();
      if (currentState.status === "paused") {
        controller.resume(reason);
        return;
      }

      if (currentState.status === "error" || currentState.status === "stopped") {
        void controller.retry(reason).catch((error) => {
          appendLog("error", "scanner-release-retry-failed", {
            error,
            message: getReadableCameraError(error, "Unable to recover the camera."),
          });
        });
      }
    },
    [appendLog, isOnline],
  );

  const scheduleResume = useCallback(
    (reason: string) => {
      clearResumeTimer();
      resumeTimerRef.current = window.setTimeout(() => {
        releaseScanner(reason);
      }, RESULT_HOLD_MS);
    },
    [clearResumeTimer, releaseScanner],
  );

  const sendScannerHeartbeat = useCallback(
    async (reason: string) => {
      if (!isOnline || heartbeatInFlightRef.current || bindingRedirectInFlightRef.current) {
        return true;
      }

      const libraryId = readStoredLibraryId();
      const libraryAccessKey = readStoredLibraryAccessKey();
      if (!libraryId || !libraryAccessKey) {
        await redirectToDeviceSetup("Reconnect this kiosk to continue scanning.");
        return false;
      }

      heartbeatInFlightRef.current = true;

      try {
        const queueSize = await countAttendanceQueueEntries();
        const heartbeat = await sendDeviceHeartbeat({
          apiUrl: DEVICE_HEARTBEAT_API_URL,
          deviceId: DEVICE_ID,
          libraryAccessKey,
          libraryId,
          status: {
            appVersion: APP_VERSION,
            cameraReady:
              (controllerState.status === "ready" || controllerState.status === "paused") && !controllerState.error,
            deviceName: DEVICE_NAME,
            isOnline,
            lastSyncAt: readLastAttendanceSyncAt(),
            pendingCount: queueSize,
            phase,
          },
        });

        if (!heartbeat.valid) {
          await redirectToDeviceSetup(heartbeat.message || "Reconnect this kiosk to continue scanning.");
          return false;
        }

        appendLog("info", "heartbeat-ok", {
          deviceId: heartbeat.deviceId,
          heartbeatAt: heartbeat.heartbeatAt,
          reason,
        });
        return true;
      } catch (error) {
        appendLog("warn", "heartbeat-failed", {
          message: getReadableCameraError(error, "Heartbeat request failed."),
          reason,
        });
        return true;
      } finally {
        heartbeatInFlightRef.current = false;
      }
    },
    [appendLog, controllerState.error, controllerState.status, isOnline, phase, redirectToDeviceSetup],
  );

  const syncQueuedScans = useCallback(
    async (reason: string) => {
      if (!isOnline || syncInFlightRef.current || bindingRedirectInFlightRef.current) {
        return;
      }

      const queueSize = await countAttendanceQueueEntries().catch(() => 0);
      if (queueSize === 0) {
        return;
      }

      syncInFlightRef.current = true;

      try {
        const result = await syncQueuedAttendance({
          deviceToken: SCAN_DEVICE_TOKEN,
          scanApiUrl: SCAN_API_URL,
        });

        appendLog("info", "queue-sync-complete", {
          attemptedCount: result.attemptedCount,
          failedCount: result.failedCount,
          reason,
          remainingCount: result.remainingCount,
          syncedCount: result.syncedCount,
        });
      } catch (error) {
        appendLog("warn", "queue-sync-failed", {
          message: getReadableCameraError(error, "Unable to sync queued attendance."),
          reason,
        });
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [appendLog, isOnline],
  );

  const submitScan = useCallback(
    async (entry: AttendanceQueueEntry) => {
      const payload = await submitAttendanceScan({
        deviceToken: SCAN_DEVICE_TOKEN,
        entry,
        scanApiUrl: SCAN_API_URL,
      });

      return payload;
    },
    [],
  );

  const processScannedValue = useCallback(
    async (rawValue: string, source: ScanDetectionPayload["source"] | "manual") => {
      if (processingRef.current) {
        return;
      }

      const normalizedRawValue = trimText(rawValue);
      if (!normalizedRawValue) {
        return;
      }

      if (normalizedRawValue.length > MAX_SCAN_VALUE_LENGTH) {
        setPhase("error");
        setScanPayload({
          code: "QR_TOO_LARGE",
          message: "This QR payload is too large to process safely.",
          status: "error",
          success: false,
        });
        setStatusMessage("Invalid QR");
        scheduleResume("oversized-qr");
        return;
      }

      processingRef.current = true;
      clearResumeTimer();
      controllerRef.current?.pause("scan-processing");
      setPhase("scanning");
      setScanPayload(null);
      setStatusMessage(isOnline ? "Scanning..." : "Saving offline...");
      appendLog("info", "scan-processing-start", {
        preview: normalizedRawValue.slice(0, 18),
        source,
      });

      let scannerHeld = false;

      try {
        const parsed = await parseStudentQrPayload(normalizedRawValue, {
          allowLegacy: true,
          expectedLibraryId: readStoredLibraryId(),
          now: new Date(),
          publicKeyPem: STUDENT_QR_PUBLIC_KEY,
        });

        if (!mountedRef.current) {
          return;
        }

        if (!parsed) {
          setPhase("error");
          setScanPayload({
            code: "INVALID_QR",
            message: "Invalid ID.",
            status: "error",
            success: false,
          });
          setStatusMessage("Invalid QR");
          scannerHeld = true;
          scheduleResume("invalid-qr");
          return;
        }

        const libraryId = readStoredLibraryId();
        const libraryAccessKey = readStoredLibraryAccessKey();
        if (!libraryId || !libraryAccessKey) {
          await redirectToDeviceSetup("Device setup is missing. Reconnect this kiosk.");
          return;
        }

        if (!parsed.valid) {
          setPhase("error");
          setScanPayload({
            code: parsed.code,
            message: parsed.message,
            status: "error",
            success: false,
          });
          setStatusMessage("Scan Failed");
          scannerHeld = true;
          scheduleResume(`scan-invalid:${parsed.code}`);
          return;
        }

        const scanIdentifier = parsed.source === "legacy" ? parsed.qrCode : parsed.studentId;
        if (!scanIdentifier) {
          setPhase("error");
          setScanPayload({
            code: "INVALID_QR",
            message: "Invalid ID.",
            status: "error",
            success: false,
          });
          setStatusMessage("Invalid QR");
          scannerHeld = true;
          scheduleResume("scan-invalid");
          return;
        }

        const nowTs = Date.now();
        if (
          lastAcceptedScanRef.current.value === scanIdentifier &&
          nowTs - lastAcceptedScanRef.current.at < DUPLICATE_SCAN_WINDOW_MS
        ) {
          appendLog("info", "duplicate-scan-ignored", {
            scanIdentifier,
            source,
          });
          processingRef.current = false;
          setPhase("idle");
          setStatusMessage("Already Marked \u26A0");
          controllerRef.current?.resume("duplicate-scan");
          return;
        }

        lastAcceptedScanRef.current = {
          at: nowTs,
          value: scanIdentifier,
        };

        const timestamp = new Date().toISOString();
        const scanEntry = createAttendanceQueueEntry({
          deviceId: DEVICE_ID,
          libraryAccessKey,
          libraryId,
          qrCode: parsed.rawValue,
          studentId: scanIdentifier,
          timestamp,
        });

        let payload: AttendanceScanPayload;
        if (!isOnline) {
          await enqueueAttendanceQueueEntry(scanEntry);
          payload = buildOfflineQueuedPayload({
            entry: scanEntry,
            libraryId,
            parsedSource: parsed.source,
            studentId: scanIdentifier,
          });
        } else {
          payload = await submitScan(scanEntry);
          if (payload.status === "queued") {
            payload = buildOfflineQueuedPayload({
              entry: scanEntry,
              fallbackMessage: payload.message,
              libraryId,
              parsedSource: parsed.source,
              studentId: scanIdentifier,
            });
          }
        }

        if (!mountedRef.current) {
          return;
        }

        setScanPayload(payload);

        if (payload.status === "success") {
          rememberOfflineVerifiedStudent({
            libraryId,
            name: payload.studentName || payload.name,
            seat: payload.seat,
            studentId: scanIdentifier,
            verifiedAt: timestamp,
          });
          setPhase("success");
          setStatusMessage("Attendance Marked");
        } else if (payload.status === "queued") {
          setPhase("queued");
          setStatusMessage("Saved Offline");
        } else {
          setPhase("error");
          setStatusMessage("Scan Failed");

          if (payload.code && DEVICE_BINDING_RESET_CODES.has(payload.code)) {
            await redirectToDeviceSetup(payload.message || "Reconnect this kiosk to continue scanning.");
            return;
          }
        }

        appendLog("info", "scan-submit-result", {
          code: "code" in payload ? payload.code ?? null : null,
          status: payload.status,
        });
        scannerHeld = true;
        scheduleResume(`result:${payload.status}`);
        void sendScannerHeartbeat("post-scan");
        if (isOnline) {
          void syncQueuedScans("post-scan");
        }
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        appendLog("error", "scan-processing-exception", {
          error,
          message: getReadableCameraError(error, "Unable to verify this QR right now."),
        });
        setPhase("error");
        setScanPayload({
          code: "SCAN_PROCESSING_FAILED",
          message: getReadableCameraError(error, "Unable to verify this QR right now."),
          status: "error",
          success: false,
        });
        setStatusMessage("Scan Failed");
        scannerHeld = true;
        scheduleResume("scan-exception");
      } finally {
        if (!scannerHeld) {
          processingRef.current = false;
        }
      }
    },
    [
      appendLog,
      clearResumeTimer,
      isOnline,
      redirectToDeviceSetup,
      scheduleResume,
      sendScannerHeartbeat,
      submitScan,
      syncQueuedScans,
    ],
  );

  scanHandlerRef.current = (payload) => {
    void processScannedValue(payload.rawValue, payload.source);
  };

  const handleVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoElementRef.current = node;
    controllerRef.current?.attachVideoElement(node);
  }, []);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    const controller = new ScanController({
      onDetect: (payload) => {
        scanHandlerRef.current(payload);
      },
      onLog: (level, event, detail) => {
        if (mountedRef.current) {
          appendLog(level, event, detail);
        }
      },
      onStateChange: (nextState) => {
        if (mountedRef.current) {
          setControllerState(nextState);
        }
      },
    });

    controllerRef.current = controller;
    controller.attachVideoElement(videoElementRef.current);

    const boot = async () => {
      await waitForPendingShutdown();
      if (cancelled) {
        return;
      }
      await controller.init();
      if (cancelled) {
        return;
      }
      await controller.start("page-load");
    };

    void boot().catch((error) => {
      appendLog("error", "scanner-bootstrap-failed", {
        error,
        message: getReadableCameraError(error, "Unable to start the scanner."),
      });
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearResumeTimer();
      const activeController = controllerRef.current;
      controllerRef.current = null;
      pendingShutdown = activeController
        ? activeController.stop("page-unmount").catch(() => undefined)
        : Promise.resolve();
    };
  }, [appendLog, clearResumeTimer]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setStatusMessage("Show QR to scan");
      void syncQueuedScans("network-online");
      void sendScannerHeartbeat("network-online");
    };

    const handleOffline = () => {
      setIsOnline(false);
      setStatusMessage("Offline mode active.");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [sendScannerHeartbeat, syncQueuedScans]);

  useEffect(() => {
    const visibilityHandler = () => {
      const controller = controllerRef.current;
      if (!controller) {
        return;
      }

      if (document.hidden) {
        controller.pause("document-hidden");
        return;
      }

      if (processingRef.current) {
        return;
      }

      const currentState = controller.getState();
      if (currentState.status === "paused") {
        controller.resume("document-visible");
      } else if (currentState.status === "error" || currentState.status === "stopped") {
        void controller.retry("document-visible");
      }
    };

    document.addEventListener("visibilitychange", visibilityHandler);
    return () => {
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, []);

  useEffect(() => {
    const heartbeatTimer = window.setInterval(() => {
      void sendScannerHeartbeat("interval");
    }, HEARTBEAT_INTERVAL_MS);

    const syncTimer = window.setInterval(() => {
      void syncQueuedScans("interval");
    }, SYNC_INTERVAL_MS);

    void sendScannerHeartbeat("initial");
    void syncQueuedScans("initial");

    return () => {
      window.clearInterval(heartbeatTimer);
      window.clearInterval(syncTimer);
    };
  }, [sendScannerHeartbeat, syncQueuedScans]);

  const resultPrimary = useMemo(() => {
    if (scanPayload) {
      if (scanPayload.status === "success") {
        if (scanPayload.duplicate) {
          return "ALREADY MARKED";
        }

        return (scanPayload.studentName || scanPayload.name || "STUDENT").toUpperCase();
      }

      if (scanPayload.status === "error") {
        const message = scanPayload.message ?? "";
        const code = scanPayload.code?.toUpperCase() ?? "";
        if (code.includes("DUPLICATE") || code.includes("ALREADY") || /already|duplicate/i.test(message)) {
          return "ALREADY MARKED";
        }
        if (code === "INVALID_QR" || code === "QR_TOO_LARGE" || /invalid/i.test(message)) {
          return "INVALID QR";
        }
        return "SCAN FAILED";
      }

      return "SAVED OFFLINE";
    }

    if (phase === "scanning") {
      return "SCANNING...";
    }

    if (controllerState.status === "starting") {
      return "STARTING...";
    }

    if (controllerState.error) {
      return "CAMERA ERROR";
    }

    return "SCANNER READY";
  }, [controllerState.error, controllerState.status, phase, scanPayload]);

  const resultSecondary = useMemo(() => {
    if (scanPayload) {
      if (scanPayload.status === "success") {
        if (scanPayload.duplicate) {
          return "Already Marked \u26A0";
        }

        return "\u2714 ATTENDANCE MARKED";
      }

      if (scanPayload.status === "error") {
        const message = scanPayload.message ?? "";
        const code = scanPayload.code?.toUpperCase() ?? "";
        if (code.includes("DUPLICATE") || code.includes("ALREADY") || /already|duplicate/i.test(message)) {
          return "Already Marked \u26A0";
        }
        if (code === "INVALID_QR" || code === "QR_TOO_LARGE" || /invalid/i.test(message)) {
          return "Invalid QR \u274C";
        }
        return "Scan Failed \u274C";
      }

      return "SYNCING LATER";
    }

    if (phase === "scanning") {
      return "Hold steady";
    }

    return statusMessage;
  }, [phase, scanPayload, statusMessage]);

  const resultTone = useMemo(() => {
    if (scanPayload) {
      if (scanPayload.status === "success") {
        return scanPayload.duplicate ? "warning" : "success";
      }

      if (scanPayload.status === "error") {
        const message = scanPayload.message ?? "";
        const code = scanPayload.code?.toUpperCase() ?? "";
        if (code.includes("DUPLICATE") || code.includes("ALREADY") || /already|duplicate/i.test(message)) {
          return "warning";
        }
        if (code === "INVALID_QR" || code === "QR_TOO_LARGE" || /invalid/i.test(message)) {
          return "error";
        }
        return "error";
      }

      return "warning";
    }

    if (phase === "scanning") {
      return "scanning";
    }

    return "idle";
  }, [phase, scanPayload]);

  const cameraLive = controllerState.status === "ready" || controllerState.status === "paused";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#15314d_0%,#071120_55%,#020617_100%)] text-white">
      <style>{`
        @keyframes scanline {
          0% { transform: translateY(-10%); opacity: 0.2; }
          50% { opacity: 0.9; }
          100% { transform: translateY(220%); opacity: 0.2; }
        }
      `}</style>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_360px]">
          <section className="rounded-[32px] border border-white/10 bg-slate-950/45 p-4 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur sm:p-6">
            <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/80">
              <div className="relative aspect-[4/3] overflow-hidden md:aspect-[16/11]">
                <video
                  ref={handleVideoRef}
                  autoPlay
                  className={cn(
                    "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
                    cameraLive ? "opacity-100" : "opacity-25",
                  )}
                  muted
                  playsInline
                />

                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(15,23,42,0.08),rgba(2,6,23,0.72))]" />

                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute left-8 right-8 top-8 h-0.5 bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent animate-[scanline_2.2s_ease-in-out_infinite]" />
                </div>

                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <div
                    className={cn(
                      "relative h-[min(70vw,22rem)] w-[min(70vw,22rem)] max-h-[68%] max-w-[68%] rounded-[30px] border border-white/20 shadow-[0_0_0_2000px_rgba(2,6,23,0.34)] transition-all duration-200 ease-out",
                      resultTone === "success" && "scale-[1.03] shadow-[0_0_55px_rgba(16,185,129,0.65)]",
                      resultTone === "error" && "scale-[1.02] shadow-[0_0_55px_rgba(248,113,113,0.65)]",
                      resultTone === "warning" && "scale-[1.02] shadow-[0_0_55px_rgba(251,191,36,0.6)]",
                    )}
                  >
                    <div
                      className={cn(
                        "absolute inset-0 rounded-[30px] opacity-0 transition-opacity duration-200",
                        resultTone === "success" && "opacity-100 shadow-[0_0_45px_rgba(16,185,129,0.75)]",
                        resultTone === "error" && "opacity-100 shadow-[0_0_45px_rgba(248,113,113,0.7)]",
                        resultTone === "warning" && "opacity-100 shadow-[0_0_45px_rgba(251,191,36,0.7)]",
                      )}
                    />
                    <div className="absolute inset-0 rounded-[30px] border border-cyan-300/40 shadow-[0_0_30px_rgba(34,211,238,0.35)] opacity-80 animate-pulse" />
                    <div className="absolute -left-px -top-px h-10 w-10 rounded-tl-[30px] border-l-2 border-t-2 border-cyan-300" />
                    <div className="absolute -right-px -top-px h-10 w-10 rounded-tr-[30px] border-r-2 border-t-2 border-cyan-300" />
                    <div className="absolute -bottom-px -left-px h-10 w-10 rounded-bl-[30px] border-b-2 border-l-2 border-cyan-300" />
                    <div className="absolute -bottom-px -right-px h-10 w-10 rounded-br-[30px] border-b-2 border-r-2 border-cyan-300" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="flex min-h-[180px] flex-col justify-center rounded-[28px] border border-white/10 bg-slate-950/45 p-6 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-emerald-300">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]" />
              Scanner Ready
            </div>
            <p
              className={cn(
                "mt-4 text-3xl font-semibold tracking-wide text-white transition-all duration-200 ease-out sm:text-4xl",
                scanPayload ? "opacity-100 scale-100" : "opacity-80 scale-100",
                resultFading ? "opacity-0 scale-95" : "",
              )}
            >
              {resultPrimary}
            </p>
            <p
              className={cn(
                "mt-2 text-base font-semibold text-cyan-100 transition-all duration-200 ease-out sm:text-lg",
                resultFading ? "opacity-0" : "opacity-90",
              )}
            >
              {resultSecondary}
            </p>
            <p className="mt-4 text-xs uppercase tracking-[0.24em] text-slate-500">System Active - Scanning</p>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default ScanKioskPage;


