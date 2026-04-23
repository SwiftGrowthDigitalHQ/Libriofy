import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ScannerCamera from "@/components/scanner/ScannerCamera";
import type {
  ActivityFeedItem,
  LastScanCardData,
  ScannerDetailBadge,
  ScannerLiveState,
  ScannerStatItem,
  ScannerUiTone,
} from "@/components/scanner/types";

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
const RESULT_HOLD_MS = 2000;
const SYNC_INTERVAL_MS = 25000;
const MAX_LOG_ENTRIES = 12;
const MAX_ACTIVITY_ITEMS = 12;
const MAX_SCAN_HISTORY = 8;

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

type RawActivityItem = {
  at: string;
  badge?: string;
  detail: string;
  id: string;
  title: string;
  tone: ScannerUiTone;
};

type ScanHistoryItem = {
  at: string;
  confidence: number;
  detail: string;
  id: string;
  name: string;
  seat: string | null;
  statusLabel: string;
  studentKey: string | null;
  tone: ScannerUiTone;
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

const createUiId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const formatRelativeTimestamp = (timestamp: string, nowMs: number) => {
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) {
    return "just now";
  }

  const diffMs = Math.max(0, nowMs - time);
  const diffSeconds = Math.round(diffMs / 1000);

  if (diffSeconds < 10) {
    return "just now";
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
};

const formatClockLabel = (timestamp: string) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

const getDetailRecord = (detail: unknown): Record<string, unknown> | null =>
  detail && typeof detail === "object" && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : null;

const getToneFromPayload = (payload: AttendanceScanPayload): ScannerUiTone => {
  if (payload.status === "success") {
    return payload.duplicate ? "warning" : "success";
  }

  if (payload.status === "queued") {
    return payload.verifiedOffline ? "info" : "warning";
  }

  const message = payload.message ?? "";
  const code = payload.code?.toUpperCase() ?? "";
  if (code.includes("DUPLICATE") || code.includes("ALREADY") || /already|duplicate/i.test(message)) {
    return "warning";
  }

  return "danger";
};

const getConfidenceFromPayload = (payload: AttendanceScanPayload) => {
  if (payload.status === "success") {
    return payload.duplicate ? 88 : 99;
  }

  if (payload.status === "queued") {
    return payload.verifiedOffline ? 93 : 78;
  }

  const code = payload.code?.toUpperCase() ?? "";
  if (code === "INVALID_QR" || code === "QR_TOO_LARGE") {
    return 18;
  }

  return 34;
};

const describeScanPayload = (payload: AttendanceScanPayload) => {
  if (payload.status === "success") {
    if (payload.duplicate) {
      return "Attendance was already recorded for this student.";
    }

    return payload.seat
      ? `Attendance verified and seat ${payload.seat} confirmed in the live ledger.`
      : "Attendance verified and committed to the live ledger.";
  }

  if (payload.status === "queued") {
    return payload.verifiedOffline
      ? "Verified locally and queued for background sync."
      : "Stored safely on-device and waiting for network sync.";
  }

  return payload.message || "The verification pipeline could not confirm this scan.";
};

const getPayloadDisplayName = (payload: AttendanceScanPayload) => {
  if (payload.status === "error") {
    return null;
  }

  return trimText(payload.studentName) || trimText(payload.name) || null;
};

const getPayloadSeat = (payload: AttendanceScanPayload) => {
  if (payload.status === "error") {
    return null;
  }

  return trimText(payload.seat) || null;
};

const getActivityFromLogEntry = (entry: ScannerLogEntry): Omit<RawActivityItem, "id"> | null => {
  const detail = getDetailRecord(entry.detail);

  switch (entry.event) {
    case "camera-start":
      return {
        at: entry.at,
        badge: "Boot",
        detail: "Secure camera pipeline is warming up for the kiosk session.",
        title: "Camera initialization started",
        tone: "info",
      };
    case "camera-ready":
      return {
        at: entry.at,
        badge: "Ready",
        detail:
          typeof detail?.activeCameraLabel === "string" && detail.activeCameraLabel
            ? `${detail.activeCameraLabel} locked and ready for continuous verification.`
            : "Camera is live and ready for continuous verification.",
        title: "Camera feed is online",
        tone: "success",
      };
    case "camera-error":
    case "scanner-bootstrap-failed":
      return {
        at: entry.at,
        badge: "Error",
        detail:
          typeof detail?.message === "string" && detail.message
            ? detail.message
            : "The camera pipeline needs attention before scanning can continue.",
        title: "Camera attention required",
        tone: "danger",
      };
    case "watchdog-restart":
      return {
        at: entry.at,
        badge: "Recovery",
        detail: "The watchdog restarted the scanner to restore a healthy live feed.",
        title: "Automatic recovery engaged",
        tone: "warning",
      };
    case "queue-sync-complete":
      return {
        at: entry.at,
        badge: "Sync",
        detail:
          typeof detail?.syncedCount === "number"
            ? `${detail.syncedCount} queued scans were pushed to the server.`
            : "Queued scans finished syncing.",
        title: "Background sync completed",
        tone: "info",
      };
    case "queue-sync-failed":
      return {
        at: entry.at,
        badge: "Sync",
        detail:
          typeof detail?.message === "string" && detail.message
            ? detail.message
            : "The queue could not sync right now and will retry automatically.",
        title: "Background sync delayed",
        tone: "warning",
      };
    case "scan-processing-start":
      return {
        at: entry.at,
        badge: "Verify",
        detail: "A new code was detected and is being verified.",
        title: "Verification started",
        tone: "info",
      };
    default:
      return null;
  }
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
  const seenLogKeysRef = useRef<Set<string>>(new Set());
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
  const [logEntries, setLogEntries] = useState<ScannerLogEntry[]>([]);
  const [phase, setPhase] = useState<KioskPhase>("idle");
  const [scanPayload, setScanPayload] = useState<AttendanceScanPayload | null>(null);
  const [scanFeedbackStage, setScanFeedbackStage] = useState<"idle" | "detected" | "verifying">("idle");
  const [statusMessage, setStatusMessage] = useState("Starting scanner...");
  const [resultFading, setResultFading] = useState(false);
  const [activityFeed, setActivityFeed] = useState<RawActivityItem[]>(() => [
    {
      at: new Date().toISOString(),
      badge: "Boot",
      detail: "Secure scanner session initialized. Waiting for camera and device heartbeat.",
      id: createUiId("activity"),
      title: "System boot sequence started",
      tone: "info",
    },
  ]);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState(() => readLastAttendanceSyncAt());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const appendActivity = useCallback((entry: Omit<RawActivityItem, "id">) => {
    startTransition(() => {
      setActivityFeed((current) => [
        {
          ...entry,
          id: createUiId("activity"),
        },
        ...current,
      ].slice(0, MAX_ACTIVITY_ITEMS));
    });
  }, []);

  const refreshQueueTelemetry = useCallback(async () => {
    const queueSize = await countAttendanceQueueEntries().catch(() => 0);
    if (mountedRef.current) {
      setPendingCount(queueSize);
      setLastSyncAt(readLastAttendanceSyncAt());
    }
    return queueSize;
  }, []);

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

  useEffect(() => {
    if (phase !== "scanning") {
      setScanFeedbackStage("idle");
      return;
    }

    setScanFeedbackStage("detected");
    const timer = window.setTimeout(() => {
      setScanFeedbackStage("verifying");
    }, 260);

    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

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
        const queueSize = await refreshQueueTelemetry();
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
    [appendLog, controllerState.error, controllerState.status, isOnline, phase, redirectToDeviceSetup, refreshQueueTelemetry],
  );

  const syncQueuedScans = useCallback(
    async (reason: string) => {
      if (!isOnline || syncInFlightRef.current || bindingRedirectInFlightRef.current) {
        return;
      }

      const queueSize = await countAttendanceQueueEntries().catch(() => 0);
      if (mountedRef.current) {
        setPendingCount(queueSize);
      }
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
        void refreshQueueTelemetry();
      }
    },
    [appendLog, isOnline, refreshQueueTelemetry],
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
          await refreshQueueTelemetry();
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
        void refreshQueueTelemetry();
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
      refreshQueueTelemetry,
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
      await refreshQueueTelemetry();
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
  }, [appendLog, clearResumeTimer, refreshQueueTelemetry]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setStatusMessage("Show QR to scan");
      appendActivity({
        at: new Date().toISOString(),
        badge: "Network",
        detail: "Connection restored. Any queued scans will sync in the background.",
        title: "Network connection restored",
        tone: "success",
      });
      void refreshQueueTelemetry();
      void syncQueuedScans("network-online");
      void sendScannerHeartbeat("network-online");
    };

    const handleOffline = () => {
      setIsOnline(false);
      setStatusMessage("Offline mode active.");
      appendActivity({
        at: new Date().toISOString(),
        badge: "Offline",
        detail: "The kiosk will keep collecting scans locally until the network returns.",
        title: "Scanner switched to offline mode",
        tone: "warning",
      });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [appendActivity, refreshQueueTelemetry, sendScannerHeartbeat, syncQueuedScans]);

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
    void refreshQueueTelemetry();

    return () => {
      window.clearInterval(heartbeatTimer);
      window.clearInterval(syncTimer);
    };
  }, [refreshQueueTelemetry, sendScannerHeartbeat, syncQueuedScans]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!scanPayload) {
      return;
    }

    const at = new Date().toISOString();
    const name = getPayloadDisplayName(scanPayload) || (scanPayload.status === "error" ? "Unknown identity" : "Queued scan");
    const statusLabel =
      scanPayload.status === "success"
        ? scanPayload.duplicate
          ? "Already Marked"
          : "Access Granted"
        : scanPayload.status === "queued"
          ? scanPayload.verifiedOffline
            ? "Verified Offline"
            : "Queued for Sync"
          : "Access Denied";
    const studentKey = getPayloadDisplayName(scanPayload) || "";
    const tone = getToneFromPayload(scanPayload);

    setScanHistory((current) => [
      {
        at,
        confidence: getConfidenceFromPayload(scanPayload),
        detail: describeScanPayload(scanPayload),
        id: createUiId("scan"),
        name,
        seat: getPayloadSeat(scanPayload),
        statusLabel,
        studentKey: studentKey || null,
        tone,
      },
      ...current,
    ].slice(0, MAX_SCAN_HISTORY));

    appendActivity({
      at,
      badge:
        scanPayload.status === "success"
          ? scanPayload.duplicate
            ? "Duplicate"
            : "Matched"
          : scanPayload.status === "queued"
            ? "Queued"
            : "Failed",
      detail: describeScanPayload(scanPayload),
      title:
        scanPayload.status === "success"
          ? `${name} checked in`
          : scanPayload.status === "queued"
            ? `${name} stored for sync`
            : "Verification failed",
      tone,
    });
  }, [appendActivity, scanPayload]);

  useEffect(() => {
    const unseen = [...logEntries].reverse().filter((entry) => {
      const key = `${entry.at}:${entry.event}`;
      if (seenLogKeysRef.current.has(key)) {
        return false;
      }
      seenLogKeysRef.current.add(key);
      return true;
    });

    for (const entry of unseen) {
      const activity = getActivityFromLogEntry(entry);
      if (!activity) {
        continue;
      }

      appendActivity(activity);
    }
  }, [appendActivity, logEntries]);

  const resultPrimary = useMemo(() => {
    if (scanPayload) {
      if (scanPayload.status === "success") {
        if (scanPayload.duplicate) {
          return "ALREADY MARKED";
        }

        return (getPayloadDisplayName(scanPayload) || "STUDENT").toUpperCase();
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

  const cameraLive = controllerState.status === "ready" || controllerState.status === "paused";
  const liveState = useMemo<ScannerLiveState>(() => {
    if (!isOnline && phase !== "scanning" && !scanPayload) {
      return "offline";
    }

    if (phase === "scanning" && scanFeedbackStage === "detected") {
      return "detected";
    }

    if (phase === "scanning" || controllerState.status === "starting") {
      return "scanning";
    }

    if (scanPayload?.status === "success") {
      return "matched";
    }

    if (scanPayload?.status === "error") {
      return "failed";
    }

    if (scanPayload?.status === "queued") {
      return "offline";
    }

    if (controllerState.error) {
      return "failed";
    }

    return "ready";
  }, [controllerState.error, controllerState.status, isOnline, phase, scanFeedbackStage, scanPayload]);

  const streamAgeMs =
    controllerState.lastFrameAt && Number.isFinite(controllerState.lastFrameAt)
      ? Math.max(0, nowMs - controllerState.lastFrameAt)
      : null;
  const lastSyncLabel = lastSyncAt ? formatClockLabel(lastSyncAt) : "waiting";
  const activeResultCard = useMemo<LastScanCardData | null>(() => {
    if (!scanPayload) {
      return null;
    }

    const capturedAt = new Date().toISOString();
    const name = getPayloadDisplayName(scanPayload) || (scanPayload.status === "error" ? "Unknown student" : "Queued scan");
    const statusLabel =
      scanPayload.status === "success"
        ? scanPayload.duplicate
          ? "Already Marked"
          : "Verified"
        : scanPayload.status === "queued"
          ? scanPayload.verifiedOffline
            ? "Verified Offline"
            : "Queued"
          : "Rejected";

    return {
      confidence: getConfidenceFromPayload(scanPayload),
      id: createUiId("active-result"),
      name,
      seat: getPayloadSeat(scanPayload),
      statusLabel,
      subtitle: describeScanPayload(scanPayload),
      timeLabel: "time" in scanPayload ? trimText(scanPayload.time) || formatClockLabel(capturedAt) : formatClockLabel(capturedAt),
      tone: getToneFromPayload(scanPayload),
    };
  }, [scanPayload]);
  const scannerBadges = useMemo<ScannerDetailBadge[]>(
    () => [
      {
        label: "Mode",
        tone: isOnline ? "success" : "warning",
        value: isOnline ? "Live" : "Offline",
      },
      {
        label: "Queue",
        tone: pendingCount > 0 ? "warning" : "neutral",
        value: pendingCount > 0 ? `${pendingCount} pending` : "Clear",
      },
      {
        label: "Camera",
        tone: controllerState.error ? "danger" : cameraLive ? "success" : "info",
        value: controllerState.error
          ? "Needs attention"
          : controllerState.status === "starting"
            ? "Starting"
            : streamAgeMs !== null && streamAgeMs < 4000
              ? "Live"
              : "Standby",
      },
      {
        label: "Last sync",
        tone: lastSyncLabel === "waiting" ? "neutral" : "info",
        value: lastSyncLabel === "waiting" ? "Pending" : lastSyncLabel,
      },
    ],
    [cameraLive, controllerState.error, controllerState.status, isOnline, lastSyncLabel, pendingCount, streamAgeMs],
  );
  const scannerFeedbackLabel = useMemo(() => {
    if (scanPayload?.status === "success") {
      return scanPayload.duplicate ? "Already marked" : "Access granted";
    }

    if (scanPayload?.status === "queued") {
      return "Saved offline";
    }

    if (scanPayload?.status === "error") {
      const code = scanPayload.code?.toUpperCase() ?? "";
      if (code === "INVALID_QR" || code === "QR_TOO_LARGE") {
        return "Invalid QR";
      }
      return "Scan failed";
    }

    if (phase === "scanning") {
      return scanFeedbackStage === "detected" ? "QR detected" : "Verifying...";
    }

    if (controllerState.error) {
      return "Camera error";
    }

    if (controllerState.status === "starting") {
      return "Starting camera";
    }

    return !isOnline ? "Offline capture" : "Ready to scan";
  }, [controllerState.error, controllerState.status, isOnline, phase, scanFeedbackStage, scanPayload]);
  const scannerMessage = useMemo(() => {
    if (controllerState.error) {
      return controllerState.error.detail;
    }

    if (scanPayload?.status === "success" || scanPayload?.status === "queued") {
      return describeScanPayload(scanPayload);
    }

    if (scanPayload?.status === "error") {
      return scanPayload.message;
    }

    if (phase === "scanning") {
      return scanFeedbackStage === "detected"
        ? "QR is inside the scan zone. Keep the card steady for a moment."
        : "Checking the student record and attendance status.";
    }

    if (!cameraLive) {
      return "Preparing the camera for continuous QR scanning.";
    }

    if (!isOnline) {
      return "Offline mode is active. Valid scans will be stored and synced automatically.";
    }

    return "Bring the student ID close to the camera until the QR code fills the center square.";
  }, [cameraLive, controllerState.error, isOnline, phase, scanFeedbackStage, scanPayload]);

  return (
    <ScannerCamera
      badges={scannerBadges}
      cameraLive={cameraLive}
      detectionState={liveState}
      feedbackLabel={scannerFeedbackLabel}
      instructionText="Align QR code inside the box"
      message={scannerMessage}
      result={activeResultCard}
      title="Student ID QR Scanner"
      torchEnabled={controllerState.torchEnabled}
      torchSupported={controllerState.torchSupported}
      videoRef={handleVideoRef}
    />
  );
};

export default ScanKioskPage;


