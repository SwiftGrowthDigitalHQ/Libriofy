import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  BadgeCheck,
  CircleX,
  Clock3,
  QrCode,
  ScanLine,
  Shield,
  ShieldCheck,
  UserRound,
  WifiOff,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
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
const RESULT_HOLD_MS = 300;
const SCAN_DEBOUNCE_MS = 350;
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

type VerificationCardData = {
  avatarLabel: string;
  liveLabel: string;
  name: string;
  plan: string;
  seat: string;
  statusLabel: string;
  subtitle: string;
  timeSlot: string;
  tone: ScannerUiTone;
  validTill: string;
};

type ActivityRailItem = ActivityFeedItem & {
  seat?: string | null;
};

const scanFrameToneClasses: Record<ScannerLiveState, string> = {
  detected: "border-cyan-300/80 shadow-[0_0_0_1px_rgba(103,232,249,0.34),0_0_34px_rgba(34,211,238,0.26)]",
  failed: "border-rose-300/78 shadow-[0_0_0_1px_rgba(253,164,175,0.28),0_0_28px_rgba(251,113,133,0.18)]",
  matched: "border-emerald-300/80 shadow-[0_0_0_1px_rgba(110,231,183,0.32),0_0_34px_rgba(16,185,129,0.24)]",
  offline: "border-amber-200/78 shadow-[0_0_0_1px_rgba(253,230,138,0.28),0_0_28px_rgba(251,191,36,0.18)]",
  ready: "border-cyan-300/72 shadow-[0_0_0_1px_rgba(103,232,249,0.28),0_0_30px_rgba(34,211,238,0.18)]",
  scanning: "border-cyan-200/82 shadow-[0_0_0_1px_rgba(165,243,252,0.34),0_0_36px_rgba(34,211,238,0.28)]",
};

const scanCornerToneClasses: Record<ScannerLiveState, string> = {
  detected: "border-cyan-200 shadow-[0_0_22px_rgba(103,232,249,0.52)]",
  failed: "border-rose-300 shadow-[0_0_20px_rgba(251,113,133,0.42)]",
  matched: "border-emerald-300 shadow-[0_0_22px_rgba(110,231,183,0.48)]",
  offline: "border-amber-200 shadow-[0_0_20px_rgba(253,230,138,0.38)]",
  ready: "border-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.42)]",
  scanning: "border-cyan-200 shadow-[0_0_24px_rgba(103,232,249,0.56)]",
};

const scanLineToneClasses: Record<ScannerLiveState, string> = {
  detected: "via-cyan-200 shadow-[0_0_24px_rgba(103,232,249,0.72)]",
  failed: "via-rose-200 shadow-[0_0_20px_rgba(251,113,133,0.58)]",
  matched: "via-emerald-200 shadow-[0_0_24px_rgba(110,231,183,0.7)]",
  offline: "via-amber-100 shadow-[0_0_20px_rgba(253,230,138,0.55)]",
  ready: "via-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.62)]",
  scanning: "via-cyan-100 shadow-[0_0_26px_rgba(103,232,249,0.8)]",
};

const triggerDetectionHaptic = () => {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }

  try {
    navigator.vibrate(22);
  } catch {
    // Ignore browsers that expose the API but block vibration.
  }
};

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getInitials = (value: string) => {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "ID";
};

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
  const detectionCooldownUntilRef = useRef(0);
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
      if (currentState.status === "paused" && !document.hidden) {
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

      if (Date.now() < detectionCooldownUntilRef.current) {
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
        detectionCooldownUntilRef.current = Date.now() + SCAN_DEBOUNCE_MS;
        return;
      }

      processingRef.current = true;
      clearResumeTimer();
      triggerDetectionHaptic();
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
          detectionCooldownUntilRef.current = Date.now() + SCAN_DEBOUNCE_MS;
          scannerHeld = false;
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
          detectionCooldownUntilRef.current = Date.now() + SCAN_DEBOUNCE_MS;
          scannerHeld = false;
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
          detectionCooldownUntilRef.current = Date.now() + SCAN_DEBOUNCE_MS;
          scannerHeld = false;
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
          setPhase("idle");
          setStatusMessage("Already Marked \u26A0");
          scannerHeld = true;
          scheduleResume("duplicate-scan");
          detectionCooldownUntilRef.current = Date.now() + SCAN_DEBOUNCE_MS;
          scannerHeld = false;
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
        detectionCooldownUntilRef.current = Date.now() + SCAN_DEBOUNCE_MS;
        scannerHeld = false;
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
        detectionCooldownUntilRef.current = Date.now() + SCAN_DEBOUNCE_MS;
        scannerHeld = false;
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
    const previousTitle = document.title;
    const rootElement = document.documentElement;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const previousThemeColor = themeMeta?.getAttribute("content");

    document.title = "Libriofy Access Gate";
    rootElement.classList.add("kiosk-mode");
    document.body.classList.add("kiosk-mode");
    themeMeta?.setAttribute("content", "#030816");

    return () => {
      document.title = previousTitle;
      rootElement.classList.remove("kiosk-mode");
      document.body.classList.remove("kiosk-mode");

      if (previousThemeColor) {
        themeMeta?.setAttribute("content", previousThemeColor);
      }
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
        ? "QR frame me hai. QR ko 6–10 inch distance pe rakh kar ek second steady rakho."
        : "Student record verify ho raha hai. QR ko 6–10 inch distance aur sharp framing me rakho.";
    }

    if (!cameraLive) {
      return "Rear camera ko sharp 720p QR scanning ke liye prepare kiya ja raha hai.";
    }

    if (!isOnline) {
      return "Offline mode active hai. QR ko 6–10 inch distance pe rakho; valid scans safely sync ho jayenge.";
    }

    return "QR ko 6–10 inch distance pe rakho, frame ke beech me align karo, aur feed sharp dikhe tab tak steady rakho.";
  }, [cameraLive, controllerState.error, isOnline, phase, scanFeedbackStage, scanPayload]);

  const dashboardTimeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(nowMs),
    [nowMs],
  );
  const dashboardDateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(nowMs),
    [nowMs],
  );
  const gateTone = useMemo<ScannerUiTone>(() => {
    if (controllerState.error || scanPayload?.status === "error") {
      return "danger";
    }

    if (!isOnline || scanPayload?.status === "queued") {
      return "info";
    }

    if (phase === "scanning" || controllerState.status === "starting") {
      return "info";
    }

    return "success";
  }, [controllerState.error, controllerState.status, isOnline, phase, scanPayload]);
  const frameInstructionLabel = useMemo(() => {
    if (phase === "scanning") {
      return "QR ko 6–10 inch distance pe rakh kar steady rakho";
    }

    if (controllerState.error) {
      return "Camera pipeline needs attention";
    }

    if (!cameraLive) {
      return "Preparing sharp rear camera feed";
    }

    if (!isOnline) {
      return "Offline mode active. QR ko 6–10 inch pe rakho";
    }

    return "QR ko 6–10 inch distance pe rakho";
  }, [cameraLive, controllerState.error, isOnline, phase]);
  const displaySummaryStats = useMemo<ScannerStatItem[]>(() => {
    const checkedIn = scanHistory.filter((item) => item.tone === "success").length;
    const denied = scanHistory.filter((item) => item.tone === "danger").length;
    const syncPending =
      pendingCount + scanHistory.filter((item) => item.tone === "warning" || item.tone === "info").length;

    return [
      {
        helper: "Checked In",
        label: "Checked In",
        tone: "success",
        value: String(checkedIn),
      },
      {
        helper: "Denied",
        label: "Denied",
        tone: "danger",
        value: String(denied),
      },
      {
        helper: "Pending Sync",
        label: "Pending Sync",
        tone: "info",
        value: String(syncPending),
      },
    ];
  }, [pendingCount, scanHistory]);
  const displayVerification = useMemo<VerificationCardData>(() => {
    if (!activeResultCard) {
      return {
        avatarLabel: "ID",
        liveLabel: "LIVE",
        name: "Waiting for scan",
        plan: "--",
        seat: "--",
        statusLabel: "STANDBY",
        subtitle: "System is active and waiting for student ID",
        timeSlot: "--",
        tone: "success",
        validTill: "--",
      };
    }

    const isRejected = activeResultCard.tone === "danger";
    const isQueued = activeResultCard.tone === "info";

    return {
      avatarLabel: getInitials(activeResultCard.name),
      liveLabel: isRejected ? "REVIEW" : isQueued ? "SYNC" : "LIVE",
      name: activeResultCard.name,
      plan:
        isRejected
          ? "Retry Scan"
          : isQueued
            ? "Offline Hold"
            : activeResultCard.statusLabel === "Already Marked"
              ? "Already Logged"
              : activeResultCard.plan || "--",
      seat: activeResultCard.seat || "--",
      statusLabel:
        isRejected
          ? "ACCESS DENIED"
          : isQueued
            ? "SYNC PENDING"
            : activeResultCard.statusLabel === "Already Marked"
              ? "ALREADY MARKED"
              : "ACCESS GRANTED",
      subtitle: activeResultCard.subtitle,
      timeSlot: isRejected
        ? "Rescan required"
        : isQueued
          ? "Awaiting background sync"
          : activeResultCard.statusLabel === "Already Marked"
            ? "Attendance already recorded"
            : activeResultCard.timeSlot || "--",
      tone: activeResultCard.tone,
      validTill: isRejected
        ? "Manual review"
        : new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(new Date(nowMs + (isQueued ? 86400000 : 172800000))),
    };
  }, [activeResultCard, nowMs]);
  const liveActivityItems = useMemo<ActivityRailItem[]>(() => {
    return scanHistory.slice(0, 5).map((item) => ({
      detail:
        item.tone === "success"
          ? item.statusLabel === "Already Marked"
            ? "Already Marked"
            : "Access Granted"
          : item.tone === "danger"
            ? "Access Denied"
            : item.statusLabel,
      id: item.id,
      seat: item.seat,
      timestampLabel: formatClockLabel(item.at),
      title: item.name,
      tone: item.tone,
    }));
  }, [scanHistory]);

  const shellBorder = "rgba(56, 189, 248, 0.18)";
  const panelBorder = "rgba(34, 211, 238, 0.18)";
  const panelSurface =
    "linear-gradient(180deg, rgba(2, 10, 21, 0.98) 0%, rgba(3, 12, 24, 0.95) 100%)";
  const panelSurfaceBright =
    "radial-gradient(circle at top, rgba(8,40,66,0.34), transparent 38%), linear-gradient(180deg, rgba(2,8,16,0.98), rgba(2,8,16,0.98))";
  const systemStatusLabel =
    gateTone === "danger" ? "System Attention" : gateTone === "info" ? "System Monitoring" : "System Secure";

  return (
    <div
      className="h-[100dvh] overflow-hidden text-white"
      style={{ background: "radial-gradient(circle at top, #051321 0%, #020814 38%, #02050d 100%)" }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(6,65,104,0.34),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(6,120,102,0.12),transparent_30%),linear-gradient(180deg,#01060f_0%,#020814_58%,#01040a_100%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(45,88,125,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(45,88,125,0.12)_1px,transparent_1px)] [background-size:120px_120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.07),transparent_34%)]" />
        <div className="absolute left-[8%] top-[8%] h-[26rem] w-[26rem] rounded-full bg-cyan-500/10 blur-[130px]" />
        <div className="absolute bottom-[8%] right-[8%] h-[24rem] w-[24rem] rounded-full bg-emerald-500/8 blur-[130px]" />
      </div>

      <div className="relative z-10 flex h-[100dvh] w-full flex-col px-1 py-0.5 sm:px-2 sm:py-1 lg:px-3.5 lg:py-1.5 xl:px-4">
        <div
          className="scan-dashboard-shell flex w-full flex-col rounded-[18px] border bg-[rgba(3,9,18,0.9)] shadow-[0_32px_140px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(148,233,255,0.06)] backdrop-blur-2xl sm:rounded-[24px] lg:rounded-[28px]"
          style={{ borderColor: shellBorder }}
        >
          <header className="grid gap-2 border-b border-cyan-400/14 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center lg:grid-cols-[minmax(0,1.1fr)_auto_auto_minmax(0,0.78fr)] lg:gap-3.5 xl:gap-4 xl:px-6 xl:py-4">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4 md:col-span-2 lg:col-span-1">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-cyan-400/30 bg-cyan-400/8 shadow-[0_0_36px_rgba(34,211,238,0.14)] sm:h-12 sm:w-12">
                <div className="grid h-8 w-8 place-items-center rounded-[13px] bg-[linear-gradient(180deg,rgba(34,211,238,0.24),rgba(34,211,238,0.08))] text-cyan-100 sm:h-9 sm:w-9">
                  <QrCode className="h-5 w-5" />
                </div>
              </div>

              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.4em] text-white/78">LIBRIOFY</p>
                <h1 className="mt-0.5 font-display text-[clamp(1.1rem,3vw,1.7rem)] font-semibold tracking-[-0.04em] text-white">
                  Access Gate
                </h1>
                <p className="mt-1 text-[clamp(0.72rem,1.65vw,0.9rem)] text-slate-300">
                  Premium QR verification console for secure library entry.
                </p>
              </div>
            </div>

            <div className="hidden sm:block justify-self-start">
              <div className="inline-flex w-full max-w-full items-center justify-center gap-2 rounded-full border border-cyan-400/22 bg-cyan-500/8 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-4 sm:py-2 sm:text-[11px] sm:tracking-[0.24em] sm:w-auto">
                <ShieldCheck className="h-3.5 w-3.5" />
                Secure Kiosk Mode
              </div>
            </div>

            <div className="hidden md:block justify-self-start md:justify-self-end lg:justify-self-center">
              <div
                className={cn(
                  "inline-flex w-full max-w-full items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-4 sm:py-2 sm:text-[11px] sm:tracking-[0.24em] sm:w-auto",
                  gateTone === "danger"
                    ? "border-rose-400/22 bg-rose-500/10 text-rose-100"
                    : gateTone === "info"
                      ? "border-cyan-400/22 bg-cyan-500/10 text-cyan-100"
                      : "border-emerald-400/22 bg-emerald-500/10 text-emerald-100",
                )}
              >
                <Shield className="h-3.5 w-3.5" />
                {systemStatusLabel}
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:justify-end md:col-span-2 lg:col-span-1 lg:justify-self-end">
              <div
                className={cn(
                  "inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] sm:w-auto sm:justify-self-end",
                  gateTone === "danger"
                    ? "border-rose-400/24 bg-rose-500/10 text-rose-100"
                    : gateTone === "info"
                      ? "border-cyan-400/24 bg-cyan-500/10 text-cyan-100"
                      : "border-emerald-400/24 bg-emerald-500/10 text-emerald-100",
                )}
              >
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    gateTone === "danger"
                      ? "bg-rose-400 shadow-[0_0_16px_rgba(251,113,133,0.9)]"
                      : gateTone === "info"
                        ? "bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.9)]"
                        : "bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.9)]",
                  )}
                />
                {scannerFeedbackLabel}
              </div>

              <div className="border-t border-white/10 pt-2.5 text-left sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 sm:text-right">
                <p className="font-display text-[clamp(1.2rem,3vw,1.7rem)] font-semibold tracking-[-0.04em] text-white">
                  {dashboardTimeLabel}
                </p>
                <p className="text-[clamp(0.72rem,1.7vw,0.92rem)] text-slate-300">{dashboardDateLabel}</p>
              </div>
            </div>
          </header>

          <div className="scan-dashboard-main flex-1 overflow-y-auto overflow-x-hidden px-3 py-2.5 sm:px-3.5 sm:py-3 xl:px-4 xl:py-3.5">
            <div className="scan-dashboard-top main-layout items-start">
              <section
                className="scan-dashboard-primary flex min-h-0 min-w-0 flex-col rounded-[20px] p-3 sm:rounded-[28px] sm:p-4 xl:p-5"
                style={{
                  background: panelSurfaceBright,
                  border: `1px solid ${panelBorder}`,
                  boxShadow: "inset 0 1px 0 rgba(148,233,255,0.04)",
                }}
              >
                <div className="mx-auto max-w-3xl text-center">
                  <h2 className="font-display text-[clamp(1.5rem,2.8vw,1.75rem)] font-semibold tracking-[-0.05em] text-white">
                    SCAN YOUR LIBRIOFY ID
                  </h2>
                  <p className="mt-2 text-[clamp(0.86rem,1.75vw,1rem)] text-slate-300">
                    Place the student ID QR code inside the frame
                  </p>
                </div>

                <div className="mt-4 grid gap-3 lg:hidden md:grid-cols-2">
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/52">Scanner State</p>
                    <h3 className="mt-3 font-display text-[clamp(1.4rem,4vw,2rem)] font-semibold tracking-[-0.04em] text-white">
                      {resultPrimary}
                    </h3>
                    <p className="mt-2 text-sm text-slate-300">{resultSecondary}</p>
                  </div>

                  <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/52">Active Camera</p>
                    <p className="mt-3 text-base font-medium text-white">
                      {controllerState.activeCameraLabel ?? "Rear camera preference enabled"}
                    </p>
                    <p className="mt-2 text-sm text-slate-400">{scannerMessage}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap justify-center gap-2 lg:hidden sm:gap-3">
                  {scannerBadges.map((badge) => (
                    <div
                      key={badge.label}
                      className={cn(
                        "w-full rounded-full border px-4 py-2 text-center text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:w-auto",
                        badge.tone === "danger"
                          ? "border-rose-400/22 bg-rose-500/10 text-rose-100"
                          : badge.tone === "warning"
                            ? "border-amber-300/22 bg-amber-500/10 text-amber-100"
                            : badge.tone === "success"
                              ? "border-emerald-400/22 bg-emerald-500/10 text-emerald-100"
                              : badge.tone === "info"
                                ? "border-cyan-400/22 bg-cyan-500/10 text-cyan-100"
                                : "border-white/10 bg-white/[0.03] text-slate-200",
                      )}
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/54">{badge.label}</span>
                      <span className="ml-3 font-medium text-white">{badge.value}</span>
                    </div>
                  ))}
                </div>

                <div className="scan-dashboard-scanner-wrap mt-4 flex w-full justify-center sm:mt-5">
                  <div className="scan-dashboard-frame-wrap relative w-full">
                    <div
                      className="scan-dashboard-scanner-shell scanner relative rounded-[24px] border"
                      style={{
                        background: "linear-gradient(180deg, rgba(4,14,27,0.95), rgba(2,9,18,0.98))",
                        border: "1px solid rgba(56, 189, 248, 0.18)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 24px 80px rgba(0,0,0,0.34)",
                      }}
                    >
                      <div className="scan-dashboard-frame scanner-container relative aspect-square w-full rounded-[22px] border border-cyan-400/12 bg-[#020913]">
                        <div
                          className="absolute inset-0 z-[1] bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.2),transparent_44%),linear-gradient(180deg,rgba(3,10,20,0.96),rgba(2,7,15,0.98))]"
                          style={{ borderRadius: "inherit" }}
                        />
                        <div
                          className="absolute inset-0 z-[2] opacity-20 [background-image:linear-gradient(rgba(34,211,238,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.14)_1px,transparent_1px)] [background-size:44px_44px]"
                          style={{ borderRadius: "inherit" }}
                        />

                        <video
                          id="camera-feed"
                          ref={handleVideoRef}
                          autoPlay
                          className={cn(
                            "absolute inset-0 z-[3] h-full w-full object-cover transition-opacity duration-300 [transform:translateZ(0)]",
                            cameraLive ? "opacity-[0.84]" : "opacity-0",
                          )}
                          muted
                          playsInline
                          style={{ borderRadius: "inherit" }}
                        />

                        <div
                          className="absolute inset-0 z-[4] bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.16),transparent_46%)] mix-blend-screen"
                          style={{ borderRadius: "inherit" }}
                        />

                        {!cameraLive ? (
                          <div
                            className="absolute inset-0 z-[5] grid place-items-center bg-[radial-gradient(circle_at_top,rgba(10,38,58,0.68),rgba(2,9,18,0.98))]"
                            style={{ borderRadius: "inherit" }}
                          >
                            <div className="rounded-full border border-cyan-400/18 bg-[#04111d]/90 px-6 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100 shadow-[0_10px_40px_rgba(0,0,0,0.32)]">
                              {scannerFeedbackLabel}
                            </div>
                          </div>
                        ) : null}

                        <div
                          className="scan-overlay pointer-events-none absolute inset-0 z-[6]"
                          style={{ borderRadius: "inherit" }}
                        >
                          <div className="scan-dashboard-focus-frame absolute bg-transparent">
                            <div
                              className={cn(
                                "absolute inset-0 rounded-[16px] border bg-transparent",
                                scanFrameToneClasses[liveState],
                              )}
                            />

                            {cameraLive ? (
                              <motion.div
                                className={cn(
                                  "absolute inset-x-4 h-[2px] rounded-full bg-gradient-to-r from-transparent to-transparent sm:inset-x-6 md:inset-x-8",
                                  scanLineToneClasses[liveState],
                                )}
                                animate={{ opacity: [0.55, 1, 0.55], top: ["16%", "82%", "16%"] }}
                                transition={{
                                  duration: liveState === "scanning" ? 1.7 : liveState === "matched" ? 2.1 : 2.5,
                                  ease: "linear",
                                  repeat: Number.POSITIVE_INFINITY,
                                }}
                              />
                            ) : null}

                            <div className={cn("absolute left-[6%] top-[6%] h-10 w-10 rounded-tl-[16px] border-l-[4px] border-t-[4px] sm:h-12 sm:w-12 sm:rounded-tl-[18px] sm:border-l-[5px] sm:border-t-[5px]", scanCornerToneClasses[liveState])} />
                            <div className={cn("absolute right-[6%] top-[6%] h-10 w-10 rounded-tr-[16px] border-r-[4px] border-t-[4px] sm:h-12 sm:w-12 sm:rounded-tr-[18px] sm:border-r-[5px] sm:border-t-[5px]", scanCornerToneClasses[liveState])} />
                            <div className={cn("absolute bottom-[6%] left-[6%] h-10 w-10 rounded-bl-[16px] border-b-[4px] border-l-[4px] sm:h-12 sm:w-12 sm:rounded-bl-[18px] sm:border-b-[5px] sm:border-l-[5px]", scanCornerToneClasses[liveState])} />
                            <div className={cn("absolute bottom-[6%] right-[6%] h-10 w-10 rounded-br-[16px] border-b-[4px] border-r-[4px] sm:h-12 sm:w-12 sm:rounded-br-[18px] sm:border-b-[5px] sm:border-r-[5px]", scanCornerToneClasses[liveState])} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex justify-center sm:mt-5">
                  <div className="inline-flex w-full max-w-[30rem] items-center justify-center gap-3 rounded-full border border-cyan-400/16 bg-[#071220]/92 px-4 py-2.5 text-center text-[clamp(0.8rem,2vw,1rem)] text-slate-200 shadow-[0_12px_42px_rgba(0,0,0,0.28)]">
                    <div className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-400/24 bg-cyan-500/10 text-cyan-200">
                      <ScanLine className="h-[1.125rem] w-[1.125rem]" />
                    </div>
                    <span>{frameInstructionLabel}</span>
                  </div>
                </div>

                <p className="mx-auto mt-2.5 max-w-2xl text-center text-[clamp(0.78rem,1.8vw,0.95rem)] leading-6 text-slate-400">
                  {scannerMessage}
                </p>
              </section>

              <div className="scan-dashboard-side right-panel min-w-0">
                <section
                  className="scan-dashboard-side-card scan-dashboard-side-status rounded-[20px] p-3 sm:rounded-[28px] sm:p-4 md:col-span-2 lg:col-span-1"
                  style={{
                    background:
                      "radial-gradient(circle at top right, rgba(18,53,87,0.22), transparent 34%), linear-gradient(180deg, rgba(3,9,18,0.98), rgba(3,9,18,0.96))",
                    border: `1px solid ${panelBorder}`,
                    boxShadow: "inset 0 1px 0 rgba(148,233,255,0.03)",
                  }}
                >
                  <div className="scan-dashboard-status-body grid gap-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/56">GATE STATUS</p>
                      <h3
                        className={cn(
                          "mt-3.5 font-display text-[clamp(1.3rem,3vw,1.85rem)] font-semibold tracking-[-0.05em]",
                          gateTone === "danger"
                            ? "text-rose-200"
                            : gateTone === "info"
                              ? "text-cyan-200"
                              : "text-emerald-200",
                        )}
                      >
                        {scannerFeedbackLabel}
                      </h3>
                      <p className="mt-2.5 break-words text-[clamp(0.78rem,1.7vw,0.9rem)] leading-6 text-slate-300">{scannerMessage}</p>
                    </div>

                    <div className="relative mx-auto grid h-24 w-24 shrink-0 place-items-center sm:h-28 sm:w-28">
                      {[0, 1, 2].map((ring) => (
                        <motion.div
                          key={ring}
                          className={cn(
                            "absolute rounded-full border",
                            gateTone === "danger"
                              ? "border-rose-400/28"
                              : gateTone === "info"
                                ? "border-cyan-400/28"
                                : "border-emerald-400/28",
                          )}
                          style={{
                            height: `${96 - ring * 18}px`,
                            width: `${96 - ring * 18}px`,
                          }}
                          animate={{ opacity: [0.22, 0.8, 0.22], scale: [0.94, 1.03, 0.94] }}
                          transition={{
                            delay: ring * 0.22,
                            duration: 3.1,
                            ease: "easeInOut",
                            repeat: Number.POSITIVE_INFINITY,
                          }}
                        />
                      ))}
                      <div
                        className={cn(
                          "relative grid h-12 w-12 place-items-center rounded-full border bg-[#08111f]",
                          gateTone === "danger"
                            ? "border-rose-400/35 text-rose-200"
                            : gateTone === "info"
                              ? "border-cyan-400/35 text-cyan-200"
                              : "border-emerald-400/35 text-emerald-200",
                        )}
                      >
                        <Shield className="h-5 w-5" />
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  className="scan-dashboard-side-card scan-dashboard-side-verification rounded-[20px] p-3 sm:rounded-[28px] sm:p-4"
                  style={{
                    background:
                      "radial-gradient(circle at top left, rgba(20,67,109,0.16), transparent 34%), linear-gradient(180deg, rgba(3,9,18,0.98), rgba(3,9,18,0.96))",
                    border: `1px solid ${panelBorder}`,
                    boxShadow: "inset 0 1px 0 rgba(148,233,255,0.03)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/56">
                      LAST VERIFICATION
                    </p>
                    <div
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em]",
                        displayVerification.tone === "danger"
                          ? "border-rose-400/22 bg-rose-500/10 text-rose-100"
                          : displayVerification.tone === "info"
                            ? "border-cyan-400/22 bg-cyan-500/10 text-cyan-100"
                            : "border-emerald-400/22 bg-emerald-500/10 text-emerald-100",
                      )}
                    >
                      {displayVerification.liveLabel}
                    </div>
                  </div>

                  <div className="scan-dashboard-verification-body mt-4 grid gap-4 md:grid-cols-[72px_minmax(0,1fr)] md:items-start">
                    <div className="relative mx-auto shrink-0 md:mx-0">
                      <div
                        className={cn(
                          "grid h-[72px] w-[72px] place-items-center rounded-full border-2 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22),transparent_30%),linear-gradient(180deg,#0b1e2f,#07111d)] text-[1.6rem] font-semibold shadow-[0_0_30px_rgba(34,211,238,0.16)]",
                          displayVerification.tone === "danger"
                            ? "border-rose-400/80 text-rose-50"
                            : displayVerification.tone === "info"
                              ? "border-cyan-400/80 text-cyan-50"
                              : "border-emerald-300/90 text-white",
                        )}
                      >
                        {displayVerification.avatarLabel}
                      </div>
                      <div
                        className={cn(
                          "absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-full border-2 bg-[#06111d]",
                          displayVerification.tone === "danger"
                            ? "border-rose-400 text-rose-200"
                            : displayVerification.tone === "info"
                              ? "border-cyan-400 text-cyan-200"
                              : "border-emerald-300 text-emerald-200",
                        )}
                      >
                        {displayVerification.tone === "danger" ? (
                          <CircleX className="h-[1.125rem] w-[1.125rem]" />
                        ) : displayVerification.tone === "info" ? (
                          <WifiOff className="h-[1.125rem] w-[1.125rem]" />
                        ) : (
                          <BadgeCheck className="h-[1.125rem] w-[1.125rem]" />
                        )}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-[0.78rem] font-semibold uppercase tracking-[0.16em]",
                          displayVerification.tone === "danger"
                            ? "text-rose-200"
                            : displayVerification.tone === "info"
                              ? "text-cyan-200"
                              : "text-emerald-200",
                        )}
                      >
                        {displayVerification.statusLabel}
                      </p>
                      <h3 className="mt-1.5 break-words font-display text-[clamp(1.15rem,2.4vw,1.45rem)] font-semibold tracking-[-0.05em] text-white">
                        {displayVerification.name}
                      </h3>
                      <p className="mt-2 break-words text-[0.88rem] leading-6 text-slate-300">{displayVerification.subtitle}</p>

                      <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[0.72rem] uppercase tracking-[0.12em] text-slate-400">Seat</p>
                          <p className="mt-1 text-[1rem] font-semibold text-white">{displayVerification.seat}</p>
                        </div>
                        <div>
                          <p className="text-[0.72rem] uppercase tracking-[0.12em] text-slate-400">Plan</p>
                          <p className="mt-1 text-[1rem] font-semibold text-white">{displayVerification.plan}</p>
                        </div>
                        <div>
                          <p className="text-[0.72rem] uppercase tracking-[0.12em] text-slate-400">Time Slot</p>
                          <p className="mt-1 text-[0.9rem] font-medium text-white">{displayVerification.timeSlot}</p>
                        </div>
                        <div>
                          <p className="text-[0.72rem] uppercase tracking-[0.12em] text-slate-400">Valid Till</p>
                          <p className="mt-1 text-[0.9rem] font-medium text-white">{displayVerification.validTill}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  className="scan-dashboard-side-card scan-dashboard-side-summary rounded-[20px] p-3 sm:rounded-[28px] sm:p-4"
                  style={{
                    background: panelSurface,
                    border: `1px solid ${panelBorder}`,
                    boxShadow: "inset 0 1px 0 rgba(148,233,255,0.03)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/56">
                      TODAY'S SUMMARY
                    </p>
                    <button
                      className="w-full rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 sm:w-auto"
                      type="button"
                    >
                      View All
                    </button>
                  </div>

                  <div className="scan-dashboard-summary-grid mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3 lg:grid-cols-3">
                    {displaySummaryStats.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(7,18,30,0.98),rgba(5,13,22,0.98))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                      >
                        <div
                          className={cn(
                            "grid h-9 w-9 place-items-center rounded-full border",
                            item.tone === "danger"
                              ? "border-rose-400/24 bg-rose-500/10 text-rose-200"
                              : item.tone === "info"
                                ? "border-cyan-400/24 bg-cyan-500/10 text-cyan-200"
                                : "border-emerald-400/24 bg-emerald-500/10 text-emerald-200",
                          )}
                        >
                          {item.tone === "danger" ? (
                            <CircleX className="h-[1.125rem] w-[1.125rem]" />
                          ) : item.tone === "info" ? (
                            <Clock3 className="h-[1.125rem] w-[1.125rem]" />
                          ) : (
                            <UserRound className="h-[1.125rem] w-[1.125rem]" />
                          )}
                        </div>
                        <p className="mt-2.5 font-display text-[clamp(1.25rem,3vw,1.6rem)] font-semibold tracking-[-0.05em] text-white">
                          {item.value}
                        </p>
                        <p className="mt-1 text-[clamp(0.7rem,1.5vw,0.8rem)] text-slate-300">{item.helper}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            <section
              className="scan-dashboard-activity-section mt-3 rounded-[20px] p-3 sm:mt-4 sm:rounded-[28px] sm:p-4 lg:mt-0 xl:p-5"
              style={{
                background: panelSurface,
                border: `1px solid ${panelBorder}`,
                boxShadow: "inset 0 1px 0 rgba(148,233,255,0.03)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-white/56">LIVE ACTIVITY</p>
                <motion.div
                  className="text-emerald-300"
                  animate={{ opacity: [0.45, 1, 0.45], scale: [1, 1.08, 1] }}
                  transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                >
                  <Activity className="h-5 w-5" />
                </motion.div>
              </div>

              <div className="scan-dashboard-activity-rail mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
                {liveActivityItems.length === 0 ? (
                  <div className="col-span-full rounded-[22px] border border-white/8 bg-white/[0.02] px-6 py-8 text-center">
                    <p className="text-sm text-slate-400">No scans recorded yet. Activity will appear here in real time.</p>
                  </div>
                ) : null}
                {liveActivityItems.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "scan-dashboard-activity-card h-full rounded-[22px] border px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
                      item.tone === "danger"
                        ? "border-rose-400/14 bg-[linear-gradient(180deg,rgba(47,12,24,0.65),rgba(17,7,14,0.92))]"
                        : item.tone === "info"
                          ? "border-cyan-400/14 bg-[linear-gradient(180deg,rgba(8,38,58,0.68),rgba(5,13,22,0.94))]"
                          : "border-emerald-400/14 bg-[linear-gradient(180deg,rgba(7,42,35,0.68),rgba(5,13,22,0.94))]",
                    )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "grid h-10 w-10 shrink-0 place-items-center rounded-full border",
                            item.tone === "danger"
                              ? "border-rose-400/30 bg-rose-500/10 text-rose-200"
                              : item.tone === "info"
                              ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                              : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
                        )}
                        >
                          {item.tone === "danger" ? (
                            <CircleX className="h-[1.125rem] w-[1.125rem]" />
                          ) : item.tone === "info" ? (
                            <WifiOff className="h-[1.125rem] w-[1.125rem]" />
                          ) : (
                            <UserRound className="h-[1.125rem] w-[1.125rem]" />
                          )}
                        </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-[clamp(0.95rem,2.2vw,1.1rem)] font-semibold tracking-[-0.03em] text-white">{item.title}</p>
                          <p className="whitespace-nowrap text-[clamp(0.72rem,1.8vw,0.82rem)] text-slate-300">{item.timestampLabel}</p>
                        </div>
                        <p className="mt-1 text-[clamp(0.78rem,1.8vw,0.88rem)] text-slate-200">{item.detail}</p>
                        {item.seat ? <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/46">Seat {item.seat}</p> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <footer className="border-t border-cyan-400/12 px-4 py-4 text-center sm:px-5 xl:px-6">
            <div className="inline-flex items-center gap-3 text-slate-400">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-[clamp(0.75rem,2vw,1rem)]">Secure. Smart. Seamless.</span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default ScanKioskPage;


