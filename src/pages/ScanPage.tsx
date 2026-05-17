import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  CheckCircle,
  Flashlight,
  FlashlightOff,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Volume2,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type Html5QrcodeCameraScanConfig,
} from "html5-qrcode";
import jsQR from "jsqr";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearStoredLibraryBinding,
  parseStudentQrPayload,
  readStoredLibraryAccessKey,
  readStoredLibraryId,
  writeDeviceSetupNotice,
} from "@/lib/deviceKiosk";
import {
  type AttendanceQueueEntry,
  AttendanceScanPayload,
  createAttendanceQueueEntry,
  countAttendanceQueueEntries,
  enqueueAttendanceQueueEntry,
  readLastAttendanceSyncAt,
  submitAttendanceScan,
  syncQueuedAttendance,
} from "@/lib/attendanceSync";
import { sendDeviceHeartbeat } from "@/lib/deviceHeartbeat";
import { pullDeviceCommands, recordDeviceCommandStatus } from "@/lib/deviceCommands";
import {
  readOfflineVerifiedStudent,
  rememberOfflineVerifiedStudent,
} from "@/lib/offlineVerifiedStudentCache";
import {
  getReadableCameraError,
  normalizeCameraStartupError,
} from "@/lib/cameraStartup";
import {
  DEVICE_COMMAND_POLL_INTERVAL_MS,
  getDeviceCommandTypeLabel,
  resolveDeviceCommandMessage,
  type DeviceCommandRecord,
} from "@/lib/deviceControl";
import { cn } from "@/lib/utils";

type KioskPhase = "idle" | "scanning" | "success" | "error" | "queued";
type RabbitMood = "idle" | "focus" | "happy" | "sad" | "offline";

type ScanPayload = AttendanceScanPayload;
type CameraErrorState = {
  title: string;
  detail: string;
};

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", listener: () => void) => void;
};

type WakeLockLike = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

type AudioContextConstructor = typeof AudioContext;
type ExtendedMediaTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};
type ExtendedTrackConstraintSet = MediaTrackConstraintSet & {
  focusMode?: ConstrainDOMString;
  exposureMode?: ConstrainDOMString;
  whiteBalanceMode?: ConstrainDOMString;
};
type ExtendedTrackConstraints = MediaTrackConstraints & {
  focusMode?: ConstrainDOMString;
  exposureMode?: ConstrainDOMString;
  whiteBalanceMode?: ConstrainDOMString;
  advanced?: ExtendedTrackConstraintSet[];
};
type CameraProfile = {
  label: string;
  constraints: ExtendedTrackConstraints;
};
type CameraSourceSelection = {
  cameraSource: MediaTrackConstraints;
  constraints: MediaTrackConstraints | null;
  profileLabel: string;
  selectedCameraId: string | null;
  sourceType: "cameraId" | "constraints";
};
type CameraSourceOption = {
  constraints: MediaTrackConstraints;
  label: string;
};
type FrameAnalysis = {
  brightness: number;
  glareRatio: number;
  shadowRatio: number;
  edgeScore: number;
};
type DeviceTier = "entry" | "balanced" | "performance";
type ScanDetectionSource = "barcode_detector" | "jsqr";
type WatchdogRecoveryReason =
  | "camera_stream_lost"
  | "no_frames"
  | "scan_verification_stalled";
type RecentFrameSignal = {
  brightness: number;
  edgeScore: number;
  lowLight: boolean;
  glare: boolean;
  partialDetection: boolean;
  at: number;
};
type DetectionFrameMeta = {
  rawValue: string;
  detectedAtMs: number;
  decodeMs: number;
  detectionSource: ScanDetectionSource;
  captureEdge: number;
  intervalMs: number;
  brightness: number;
  edgeScore: number;
  lowLight: boolean;
  cameraProfileLabel: string;
  deviceTier: DeviceTier;
};
type ScanLatencyMetric = {
  status: KioskPhase | "duplicate" | "invalid";
  detectionSource: ScanDetectionSource;
  decodeMs: number;
  verificationMs: number | null;
  totalMs: number | null;
  captureEdge: number;
  intervalMs: number;
  brightness: number;
  edgeScore: number;
  lowLight: boolean;
  cameraProfileLabel: string;
  deviceTier: DeviceTier;
  recordedAt: string;
};
type ScanMetricsSnapshot = {
  total: number;
  success: number;
  queued: number;
  errors: number;
  duplicates: number;
  invalid: number;
  avgDecodeMs: number;
  avgVerifyMs: number | null;
  avgTotalMs: number | null;
  lastStatus: ScanLatencyMetric["status"] | "idle";
  lastRecordedAt: string | null;
  lastCaptureEdge: number | null;
  lastIntervalMs: number | null;
  lastCameraProfileLabel: string | null;
  lastLowLight: boolean | null;
};
type ScanWorkerSupport = {
  barcodeDetector: boolean;
  offscreenCanvas: boolean;
};
type ScanWorkerReadyMessage = {
  type: "ready";
  support: ScanWorkerSupport;
};
type ScanWorkerResultMessage = {
  type: "result";
  requestId: number;
  generation: number;
  rawValue: string | null;
  detector: ScanDetectionSource | null;
  timingMs: number;
  brightness: number;
  edgeScore: number;
  lowLight: boolean;
};
type ScanWorkerMessage = ScanWorkerReadyMessage | ScanWorkerResultMessage;
type ScanDecoderWorker = Worker;

const DEVICE_ID = import.meta.env.VITE_SCAN_DEVICE_ID ?? "LIB_GATE_01";
const DEVICE_NAME = import.meta.env.VITE_SCAN_DEVICE_NAME ?? "Library ID Scanner";
const SCAN_API_URL = import.meta.env.VITE_SCAN_API_URL ?? "/api/attendance/scan";
const DEVICE_HEARTBEAT_API_URL = import.meta.env.VITE_DEVICE_HEARTBEAT_API_URL ?? "/api/device-heartbeat";
const SCAN_DEVICE_TOKEN = import.meta.env.VITE_SCAN_DEVICE_TOKEN ?? "";
const ENABLE_DEVICE_COMMANDS = import.meta.env.VITE_ENABLE_DEVICE_COMMANDS === "true";
const STUDENT_QR_PUBLIC_KEY = import.meta.env.VITE_QR_PUBLIC_KEY ?? import.meta.env.VITE_STUDENT_QR_PUBLIC_KEY ?? "";
const DEVICE_RESET_PIN = import.meta.env.VITE_SCAN_ADMIN_PIN ?? import.meta.env.VITE_DEVICE_ADMIN_PIN ?? "";
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "scanner-web";
const SCANNER_REGION_ID = "libriofy-smart-entry-scanner";
const KIOSK_FULLSCREEN_RETRY_MS = 1000;
const KIOSK_CAMERA_RETRY_BASE_MS = 2500;
const KIOSK_CAMERA_RETRY_MAX_MS = 15000;
const CAMERA_START_TIMEOUT_MS = 5000;
const CAMERA_START_DELAY_MS = 300;
const CAMERA_CONTAINER_WAIT_TIMEOUT_MS = 5000;
const DEVICE_HEARTBEAT_INTERVAL_MS = 30000;
const RESULT_HOLD_MS = 700;
const DUPLICATE_SCAN_WINDOW_MS = 5000;
const SCAN_PROCESSING_UNLOCK_DELAY_MS = 650;
const SCAN_SUBMIT_TIMEOUT_MS = 2500;
const RECENT_SCAN_CACHE_LIMIT = 256;
const SCAN_ASSIST_INTERVAL_MS = 850;
const DETECTION_HIGH_FPS_INTERVAL_MS = 32;
const DETECTION_BALANCED_INTERVAL_MS = 50;
const DETECTION_SLOW_INTERVAL_MS = 78;
const DETECTION_CAPTURE_EDGE = 360;
const DETECTION_CAPTURE_EDGE_ENTRY = 320;
const DETECTION_CAPTURE_EDGE_BALANCED = 360;
const DETECTION_CAPTURE_EDGE_PERFORMANCE = 392;
const DETECTION_CAPTURE_LOW_LIGHT_BOOST = 56;
const DETECTION_CAPTURE_PARTIAL_BOOST = 28;
const DETECTION_CAPTURE_SLOW_REDUCTION = 24;
const DETECTION_INTERVAL_SETTLE_MS = 8;
const DETECTION_INTERVAL_LOW_LIGHT_PENALTY_MS = 12;
const DETECTION_INTERVAL_PARTIAL_PENALTY_MS = 8;
const DETECTION_INTERVAL_OVERLOAD_PENALTY_MS = 12;
const DETECTION_MISS_STREAK_SETTLE_THRESHOLD = 16;
const LOW_LIGHT_STREAK_THRESHOLD = 2;
const PARTIAL_DETECTION_STREAK_THRESHOLD = 2;
const SCAN_METRICS_HISTORY_LIMIT = 30;
const SCAN_METRICS_SUMMARY_LOG_EVERY = 5;
const FALLBACK_SCAN_MAX_EDGE = 720;
const SCAN_BOX_DEFAULT_EDGE = 280;
const SCAN_BOX_MIN_EDGE = 250;
const SCAN_BOX_MAX_EDGE = 280;
const SCAN_BOX_VIEWPORT_PADDING = 36;
const GUIDANCE_ROTATION_MS = 1800;
const DEFAULT_GUIDANCE_HINT = "Align QR inside frame";
const GUIDANCE_ROTATION = ["Move closer", "Hold steady", "Adjust angle"] as const;
const DEVICE_BINDING_RESET_CODES = new Set([
  "INVALID_LIBRARY_ID",
  "WRONG_LIBRARY",
  "DEVICE_BLOCKED",
  "LIBRARY_MISMATCH",
  "DEVICE_MISMATCH",
]);
const WATCHDOG_POLL_INTERVAL_MS = 2000;
const WATCHDOG_RECOVERY_COOLDOWN_MS = 15000;
const WATCHDOG_SCAN_VERIFICATION_STALL_MS = 15000;
const WATCHDOG_NO_FRAME_STALL_MS = 8000;
const ADAPTIVE_PROFILE_SLOW_SCAN_MS = 72;
const ADAPTIVE_PROFILE_SLOW_STREAK_LIMIT = 18;
const ADAPTIVE_PROFILE_FAST_SCAN_MS = 40;
const ADAPTIVE_PROFILE_FAST_STREAK_LIMIT = 42;
const ADAPTIVE_PROFILE_CHANGE_COOLDOWN_MS = 30000;
const ADAPTIVE_PROFILE_UPGRADE_COOLDOWN_MS = 120000;
const SCAN_LOG_PREFIX = "[scan-kiosk]";
const CAMERA_SOURCE_OPTIONS: CameraSourceOption[] = [
  {
    label: "Rear camera",
    constraints: {
      facingMode: { ideal: "environment" },
    },
  },
  {
    label: "Front camera",
    constraints: {
      facingMode: "user",
    },
  },
];
const CAMERA_PROFILES: CameraProfile[] = [
  {
    label: "Low-latency rear camera",
    constraints: {
      facingMode: { ideal: "environment" },
      width: { ideal: 640, max: 800 },
      height: { ideal: 480, max: 600 },
      frameRate: { ideal: 15, max: 15 },
      focusMode: "continuous",
      exposureMode: "continuous",
      whiteBalanceMode: "continuous",
    },
  },
  {
    label: "Balanced rear camera",
    constraints: {
      facingMode: { ideal: "environment" },
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: 12, max: 15 },
      focusMode: "continuous",
      exposureMode: "continuous",
      whiteBalanceMode: "continuous",
    },
  },
  {
    label: "Low-power rear camera",
    constraints: {
      facingMode: { ideal: "environment" },
      width: { ideal: 480, max: 640 },
      height: { ideal: 360, max: 480 },
      frameRate: { ideal: 10, max: 12 },
      focusMode: "continuous",
      exposureMode: "continuous",
      whiteBalanceMode: "continuous",
    },
  },
];
const REAR_CAMERA_LABEL_PATTERN = /\b(rear|back|environment|world)\b/i;
const FRONT_CAMERA_LABEL_PATTERN = /\b(front|user|selfie|facetime)\b/i;
const isRearCameraLabel = (label: string) =>
  REAR_CAMERA_LABEL_PATTERN.test(label) && !FRONT_CAMERA_LABEL_PATTERN.test(label);

const getDefaultCameraProfileIndex = () => {
  if (typeof navigator === "undefined") {
    return 0;
  }

  const navigatorWithDeviceMemory = navigator as Navigator & { deviceMemory?: number };
  const cores = navigator.hardwareConcurrency ?? 6;
  const memory = navigatorWithDeviceMemory.deviceMemory ?? 4;

  if (cores <= 2 || memory <= 3) {
    return 2;
  }

  return cores <= 4 || memory <= 4 ? 1 : 0;
};

const getDeviceTier = (): DeviceTier => {
  if (typeof navigator === "undefined") {
    return "balanced";
  }

  const navigatorWithHints = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: {
      mobile?: boolean;
    };
  };
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = navigatorWithHints.deviceMemory ?? 4;
  const userAgent = navigator.userAgent.toLowerCase();
  const mobile = navigatorWithHints.userAgentData?.mobile ?? /android|iphone|mobile/.test(userAgent);
  const tablet = /ipad|tablet/.test(userAgent) || (/android/.test(userAgent) && !/mobile/.test(userAgent));

  if (cores <= 4 || memory <= 4) {
    return "entry";
  }

  if ((tablet && cores >= 6 && memory >= 6) || (!mobile && cores >= 8 && memory >= 8)) {
    return "performance";
  }

  return "balanced";
};

const getCaptureEdgeForDeviceTier = (deviceTier: DeviceTier) => {
  if (deviceTier === "performance") {
    return DETECTION_CAPTURE_EDGE_PERFORMANCE;
  }

  if (deviceTier === "entry") {
    return DETECTION_CAPTURE_EDGE_ENTRY;
  }

  return DETECTION_CAPTURE_EDGE_BALANCED;
};

const getDetectionIntervalsForDeviceTier = (deviceTier: DeviceTier) => {
  if (deviceTier === "performance") {
    return {
      fast: 28,
      balanced: 44,
      slow: 68,
    };
  }

  if (deviceTier === "entry") {
    return {
      fast: 40,
      balanced: 62,
      slow: 92,
    };
  }

  return {
    fast: DETECTION_HIGH_FPS_INTERVAL_MS,
    balanced: DETECTION_BALANCED_INTERVAL_MS,
    slow: DETECTION_SLOW_INTERVAL_MS,
  };
};

const averageRounded = (values: number[]) => {
  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
};

const createEmptyScanMetricsSnapshot = (): ScanMetricsSnapshot => ({
  total: 0,
  success: 0,
  queued: 0,
  errors: 0,
  duplicates: 0,
  invalid: 0,
  avgDecodeMs: 0,
  avgVerifyMs: null,
  avgTotalMs: null,
  lastStatus: "idle",
  lastRecordedAt: null,
  lastCaptureEdge: null,
  lastIntervalMs: null,
  lastCameraProfileLabel: null,
  lastLowLight: null,
});

const createScanMetricsSnapshot = (history: ScanLatencyMetric[]): ScanMetricsSnapshot => {
  if (!history.length) {
    return createEmptyScanMetricsSnapshot();
  }

  const verifyValues = history
    .map((entry) => entry.verificationMs)
    .filter((value): value is number => typeof value === "number");
  const totalValues = history
    .map((entry) => entry.totalMs)
    .filter((value): value is number => typeof value === "number");
  const lastEntry = history[history.length - 1];

  return {
    total: history.length,
    success: history.filter((entry) => entry.status === "success").length,
    queued: history.filter((entry) => entry.status === "queued").length,
    errors: history.filter((entry) => entry.status === "error").length,
    duplicates: history.filter((entry) => entry.status === "duplicate").length,
    invalid: history.filter((entry) => entry.status === "invalid").length,
    avgDecodeMs: averageRounded(history.map((entry) => entry.decodeMs)) ?? 0,
    avgVerifyMs: averageRounded(verifyValues),
    avgTotalMs: averageRounded(totalValues),
    lastStatus: lastEntry.status,
    lastRecordedAt: lastEntry.recordedAt,
    lastCaptureEdge: lastEntry.captureEdge,
    lastIntervalMs: lastEntry.intervalMs,
    lastCameraProfileLabel: lastEntry.cameraProfileLabel,
    lastLowLight: lastEntry.lowLight,
  };
};

const backgroundParticles = [
  { left: "8%", top: "14%", size: 8, duration: 14, delay: 0 },
  { left: "22%", top: "30%", size: 5, duration: 16, delay: 2.4 },
  { left: "12%", top: "72%", size: 7, duration: 18, delay: 1.2 },
  { left: "38%", top: "18%", size: 4, duration: 13, delay: 1.8 },
  { left: "47%", top: "78%", size: 6, duration: 20, delay: 0.6 },
  { left: "58%", top: "12%", size: 8, duration: 17, delay: 2.2 },
  { left: "71%", top: "28%", size: 6, duration: 14, delay: 1 },
  { left: "86%", top: "16%", size: 5, duration: 16, delay: 2.8 },
  { left: "82%", top: "64%", size: 7, duration: 19, delay: 0.2 },
  { left: "66%", top: "84%", size: 5, duration: 15, delay: 2 },
  { left: "29%", top: "88%", size: 4, duration: 12, delay: 0.8 },
  { left: "91%", top: "43%", size: 7, duration: 21, delay: 3 },
];

const confettiPieces = [
  { left: "14%", color: "#54f6be", delay: 0.05, rotate: -8 },
  { left: "28%", color: "#66e3ff", delay: 0.18, rotate: 12 },
  { left: "39%", color: "#a6f86f", delay: 0.1, rotate: -14 },
  { left: "51%", color: "#f9ff8f", delay: 0.3, rotate: 18 },
  { left: "64%", color: "#5ff4d3", delay: 0.16, rotate: -10 },
  { left: "76%", color: "#7ae8ff", delay: 0.24, rotate: 8 },
  { left: "88%", color: "#6dffb0", delay: 0.08, rotate: -18 },
];

const withBase = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const summarizeQrForLog = (value: string) => {
  const normalized = trimText(value);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= 48) {
    return normalized;
  }

  return `${normalized.slice(0, 20)}...${normalized.slice(-12)}`;
};
const logScanInfo = (event: string, detail?: Record<string, unknown>) => {
  console.info(SCAN_LOG_PREFIX, event, detail ?? {});
};
const logScanWarn = (event: string, detail?: Record<string, unknown>) => {
  console.warn(SCAN_LOG_PREFIX, event, detail ?? {});
};

const getReadableError = (error: unknown, fallback = "Unable to verify this ID right now.") =>
  getReadableCameraError(error, fallback);

const formatScanTimeLabel = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const createCameraStartupError = (message: string) => {
  const error = new Error(message);
  error.name = "CameraStartupError";
  return error;
};
const withCameraTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string) => {
  let timeoutId: number | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(createCameraStartupError(errorMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};
const waitForElementById = async (id: string, timeoutMs: number) => {
  const startAt = Date.now();

  while (Date.now() - startAt < timeoutMs) {
    const element = document.getElementById(id);
    if (element) {
      return element;
    }

    await sleep(50);
  }

  throw createCameraStartupError("SCANNER_CONTAINER_MISSING");
};

const getCameraErrorState = (error: unknown): CameraErrorState => {
  const normalized = normalizeCameraStartupError(error, {
    isSecureContext: window.isSecureContext,
    supportsMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
  });

  return {
    title: normalized.title,
    detail: normalized.detail,
  };
};

const stopMediaStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const readCameraPermissionState = async (): Promise<PermissionState | null> => {
  const navigatorWithPermissions = navigator as Navigator & {
    permissions?: {
      query?: (descriptor: PermissionDescriptor) => Promise<{ state: PermissionState }>;
    };
  };

  if (typeof navigatorWithPermissions.permissions?.query !== "function") {
    return null;
  }

  try {
    const result = await navigatorWithPermissions.permissions.query({
      name: "camera" as PermissionName,
    });
    return result.state;
  } catch {
    return null;
  }
};

const rabbitSpeechByMood: Record<RabbitMood, string> = {
  idle: "Hi \u{1F44B} Show your ID card",
  focus: "Looking for your ID...",
  happy: "You are all set",
  sad: "Hmm. Let's try again",
  offline: "Offline queue ready",
};

const RabbitMascot = ({
  mood,
  className,
}: {
  mood: RabbitMood;
  className?: string;
}) => {
  const eyeScale =
    mood === "happy" ? 0.72 : mood === "sad" ? 0.9 : mood === "focus" ? 0.65 : 1;
  const mouthPath =
    mood === "happy"
      ? "M 50 63 Q 58 70 66 63"
      : mood === "sad"
        ? "M 50 68 Q 58 62 66 68"
        : mood === "focus"
          ? "M 51 65 Q 58 66 65 65"
          : "M 50 64 Q 58 68 66 64";
  const earRotation = mood === "sad" ? -12 : mood === "focus" ? -4 : 0;

  return (
    <motion.div
      className={cn("relative flex flex-col items-center gap-3 md:gap-4", className)}
      animate={
        mood === "happy"
          ? { y: [0, -16, 0], scale: [1, 1.03, 1] }
          : mood === "sad"
            ? { y: [0, -3, 0], rotate: [0, -2, 0] }
            : mood === "focus"
              ? { y: [0, -6, 0], scale: [1, 1.012, 1] }
              : { y: [0, -8, 0], rotate: [0, 1.2, 0] }
      }
      transition={{
        duration: mood === "happy" ? 0.8 : 3.4,
        ease: "easeInOut",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      <motion.div
        className="absolute inset-x-6 bottom-10 h-16 rounded-full bg-emerald-400/18 blur-2xl"
        animate={{
          opacity: mood === "happy" ? [0.45, 0.95, 0.45] : [0.35, 0.7, 0.35],
          scaleX: mood === "happy" ? [0.9, 1.12, 0.92] : [0.92, 1.04, 0.92],
        }}
        transition={{ duration: mood === "happy" ? 1.1 : 2.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute inset-4 rounded-full border border-white/10"
        animate={{ rotate: 360, opacity: mood === "happy" ? [0.35, 0.75, 0.35] : [0.18, 0.45, 0.18] }}
        transition={{
          rotate: { duration: 18, repeat: Number.POSITIVE_INFINITY, ease: "linear" },
          opacity: { duration: mood === "happy" ? 1.4 : 2.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" },
        }}
      />
      <motion.div
        className="relative h-36 w-36 rounded-[34px] border border-white/15 bg-white/[0.04] p-3.5 shadow-[0_24px_80px_rgba(0,0,0,0.38)] backdrop-blur-2xl md:h-40 md:w-40 md:rounded-[38px] md:p-4 xl:h-44 xl:w-44 xl:rounded-[42px]"
        animate={{
          boxShadow:
            mood === "sad"
              ? "0 20px 70px rgba(255, 92, 92, 0.2)"
              : mood === "happy"
                ? "0 20px 80px rgba(84, 246, 190, 0.3)"
                : "0 20px 70px rgba(102, 227, 255, 0.22)",
        }}
        transition={{ duration: 0.4 }}
      >
        <div className="absolute inset-6 rounded-[30px] bg-[radial-gradient(circle_at_30%_20%,rgba(102,227,255,0.22),transparent_42%),radial-gradient(circle_at_75%_75%,rgba(84,246,190,0.2),transparent_38%)]" />
        <svg
          viewBox="0 0 120 120"
          className="relative z-10 h-full w-full overflow-visible drop-shadow-[0_0_22px_rgba(90,255,210,0.25)]"
          fill="none"
        >
          <motion.g
            animate={{
              rotate: earRotation,
              x: mood === "sad" ? -2 : 0,
            }}
            transform-origin="24px 20px"
            transition={{ duration: 0.35 }}
          >
            <path d="M22 18C20 3 34 0 40 12L48 42C50 52 45 58 36 54C26 49 23 34 22 18Z" fill="url(#rabbitGlow)" />
            <path d="M31 17C30 10 35 8 38 14L43 33C45 40 41 44 36 41C32 39 31 28 31 17Z" fill="rgba(255,255,255,0.48)" />
          </motion.g>
          <motion.g
            animate={{
              rotate: mood === "sad" ? 12 : mood === "focus" ? 4 : 0,
              x: mood === "sad" ? 2 : 0,
            }}
            transform-origin="94px 20px"
            transition={{ duration: 0.35 }}
          >
            <path d="M98 18C100 3 86 0 80 12L72 42C70 52 75 58 84 54C94 49 97 34 98 18Z" fill="url(#rabbitGlow)" />
            <path d="M89 17C90 10 85 8 82 14L77 33C75 40 79 44 84 41C88 39 89 28 89 17Z" fill="rgba(255,255,255,0.48)" />
          </motion.g>
          <path
            d="M27 62C27 42 41 28 60 28C79 28 93 42 93 62C93 82 79 96 60 96C41 96 27 82 27 62Z"
            fill="rgba(227,244,255,0.92)"
          />
          <path
            d="M33 58C33 42 44 32 60 32C76 32 87 42 87 58C87 74 77 89 60 89C43 89 33 74 33 58Z"
            fill="url(#rabbitBody)"
          />
          <ellipse cx="46" cy="59" rx="5" ry="6" fill="#08243f" />
          <ellipse cx="70" cy="59" rx="5" ry="6" fill="#08243f" />
          <motion.g
            animate={{ scaleY: [1, 1, 0.12, 1, 1] }}
            transition={{ duration: 3.8, repeat: Number.POSITIVE_INFINITY, repeatDelay: 0.6 }}
            style={{ originX: "50%", originY: "50%" }}
          >
            <ellipse cx="46" cy="59" rx="5" ry={6 * eyeScale} fill="#08243f" />
            <ellipse cx="70" cy="59" rx="5" ry={6 * eyeScale} fill="#08243f" />
          </motion.g>
          {mood === "focus" ? (
            <>
              <path d="M40 49L50 46" stroke="#0b3449" strokeWidth="3" strokeLinecap="round" />
              <path d="M66 46L76 49" stroke="#0b3449" strokeWidth="3" strokeLinecap="round" />
            </>
          ) : null}
          <path d="M59 61L55 66H63L59 61Z" fill="#1ec7a6" />
          <path d={mouthPath} stroke="#0b3449" strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="37" cy="67" r="4.5" fill="rgba(113, 245, 220, 0.22)" />
          <circle cx="81" cy="67" r="4.5" fill="rgba(113, 245, 220, 0.22)" />
          <defs>
            <linearGradient id="rabbitBody" x1="30" y1="28" x2="91" y2="92" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F7FDFF" />
              <stop offset="0.45" stopColor="#D9F8FF" />
              <stop offset="1" stopColor="#BAFFF0" />
            </linearGradient>
            <linearGradient id="rabbitGlow" x1="22" y1="4" x2="46" y2="54" gradientUnits="userSpaceOnUse">
              <stop stopColor="#E9FFFF" />
              <stop offset="0.58" stopColor="#B5F7FF" />
              <stop offset="1" stopColor="#8BFFE1" />
            </linearGradient>
          </defs>
        </svg>
      </motion.div>
      <div className="max-w-[9rem] rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-center text-[11px] font-medium tracking-[0.02em] text-white/88 backdrop-blur-xl md:max-w-[11rem] md:px-4 md:py-2 md:text-sm">
        {rabbitSpeechByMood[mood]}
      </div>
    </motion.div>
  );
};

const FloatingParticles = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    {backgroundParticles.map((particle, index) => (
      <motion.span
        key={`${particle.left}-${particle.top}`}
        className="absolute rounded-full bg-white/30"
        style={{
          left: particle.left,
          top: particle.top,
          width: particle.size,
          height: particle.size,
          boxShadow: index % 2 === 0 ? "0 0 18px rgba(102, 227, 255, 0.4)" : "0 0 18px rgba(84, 246, 190, 0.4)",
        }}
        animate={{
          y: [0, -24, 0],
          x: [0, index % 2 === 0 ? 8 : -8, 0],
          opacity: [0.2, 0.9, 0.2],
          scale: [1, 1.25, 1],
        }}
        transition={{
          duration: particle.duration,
          delay: particle.delay,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      />
    ))}
  </div>
);

const ResultOverlay = ({
  phase,
  payload,
}: {
  phase: Extract<KioskPhase, "success" | "error" | "queued">;
  payload: ScanPayload;
}) => {
  const isSuccess = phase === "success" && payload.status === "success";
  const isQueued = phase === "queued" && payload.status === "queued";
  const failureTitle = payload.status === "error" ? "Invalid ID" : "";

  return (
    <motion.div
      key={phase}
      className={cn(
        "absolute inset-0 z-30 flex items-center justify-center overflow-hidden px-6 py-10 backdrop-blur-md",
        isSuccess || isQueued
          ? "bg-[radial-gradient(circle_at_top,rgba(84,246,190,0.3),transparent_42%),linear-gradient(180deg,rgba(6,39,31,0.86),rgba(3,12,19,0.94))]"
          : "bg-[radial-gradient(circle_at_top,rgba(255,98,98,0.24),transparent_42%),linear-gradient(180deg,rgba(54,7,20,0.88),rgba(18,3,13,0.96))]",
      )}
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {isSuccess ? (
        <>
          <div className="pointer-events-none absolute inset-0">
            <motion.div
              className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(134,255,221,0.2),transparent_22%),radial-gradient(circle_at_70%_18%,rgba(102,227,255,0.16),transparent_24%),radial-gradient(circle_at_50%_90%,rgba(84,246,190,0.16),transparent_26%)]"
              animate={{ opacity: [0.7, 1, 0.72], scale: [1, 1.03, 1] }}
              transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
            {confettiPieces.map((piece) => (
              <motion.span
                key={piece.left}
                className="absolute top-[-6%] h-4 w-2 rounded-full"
                style={{ left: piece.left, backgroundColor: piece.color }}
                initial={{ opacity: 0 }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  y: ["0vh", "34vh", "86vh"],
                  rotate: [0, piece.rotate, piece.rotate * -1.5],
                }}
                transition={{
                  duration: 2.2,
                  delay: piece.delay,
                  ease: "easeOut",
                }}
              />
            ))}
          </div>
          <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-5 rounded-[36px] border border-emerald-300/20 bg-white/[0.06] p-8 shadow-[0_30px_120px_rgba(28,175,122,0.22)] backdrop-blur-2xl lg:p-10">
              <motion.div
                className="flex h-24 w-24 items-center justify-center rounded-full border border-emerald-200/30 bg-emerald-300/18 text-emerald-100 shadow-[0_0_60px_rgba(84,246,190,0.35)]"
                initial={{ scale: 0.72, opacity: 0 }}
                animate={{ scale: [0.72, 1.08, 1], opacity: [0, 1, 1] }}
                transition={{ duration: 0.56, ease: "easeOut" }}
              >
                <Check className="h-12 w-12" strokeWidth={3.2} />
              </motion.div>
              <div className="space-y-3">
                <p className="text-sm font-semibold uppercase tracking-[0.26em] text-emerald-100/70">Access granted</p>
                <h1 className="text-4xl font-bold tracking-[-0.04em] text-white sm:text-5xl">
                  Welcome {payload.name}
                </h1>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/[0.05] px-6 py-5">
                <p className="text-2xl font-semibold tracking-[-0.03em] text-white">
                  Seat {payload.seat} <span className="text-emerald-200/65">•</span> Entry Logged
                </p>
                <p className="mt-2 text-base text-emerald-50/82">Time {payload.time}</p>
                {payload.message ? <p className="mt-2 text-sm text-emerald-50/72">{payload.message}</p> : null}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/12 px-4 py-2 text-sm text-emerald-50/90">
                <Volume2 className="h-4 w-4" />
                <span>Soft success tone</span>
              </div>
            </div>
          <div className="flex justify-center lg:justify-end">
            <RabbitMascot mood="happy" className="scale-[1.04]" />
          </div>
        </div>
        </>
      ) : isQueued ? (
        <>
          <div className="pointer-events-none absolute inset-0">
            <motion.div
              className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(134,255,221,0.18),transparent_22%),radial-gradient(circle_at_70%_18%,rgba(102,227,255,0.18),transparent_24%),radial-gradient(circle_at_50%_90%,rgba(84,246,190,0.15),transparent_26%)]"
              animate={{ opacity: [0.68, 1, 0.72], scale: [1, 1.03, 1] }}
              transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
          </div>
          <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="space-y-5 rounded-[36px] border border-cyan-300/20 bg-white/[0.06] p-8 shadow-[0_30px_120px_rgba(28,175,122,0.2)] backdrop-blur-2xl lg:p-10">
              <motion.div
                className="flex h-24 w-24 items-center justify-center rounded-full border border-cyan-200/30 bg-cyan-300/18 text-cyan-100 shadow-[0_0_60px_rgba(102,227,255,0.3)]"
                initial={{ scale: 0.72, opacity: 0 }}
                animate={{ scale: [0.72, 1.08, 1], opacity: [0, 1, 1] }}
                transition={{ duration: 0.56, ease: "easeOut" }}
              >
                <WifiOff className="h-12 w-12" strokeWidth={3.2} />
              </motion.div>
              <div className="space-y-3">
                <p className="text-sm font-semibold uppercase tracking-[0.26em] text-cyan-100/70">
                  {payload.verifiedOffline ? "Offline verified" : "Stored locally"}
                </p>
                <h1 className="text-4xl font-bold tracking-[-0.04em] text-white sm:text-5xl">
                  {payload.name || payload.studentName
                    ? payload.verifiedOffline
                      ? `Access granted for ${payload.name || payload.studentName}`
                      : "Saved offline"
                    : payload.verifiedOffline
                      ? "Access granted offline"
                      : "Saved offline"}
                </h1>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/[0.05] px-6 py-5">
                <p className="text-2xl font-semibold tracking-[-0.03em] text-white">
                  {payload.seat
                    ? `Seat ${payload.seat} `
                    : payload.verifiedOffline
                      ? "Offline verified "
                      : "Queueing for sync "}
                  <span className="text-cyan-200/65">-</span>{" "}
                  {payload.verifiedOffline ? "Sync pending" : "Entry stored"}
                </p>
                <p className="mt-2 text-base text-cyan-50/82">Time {payload.time}</p>
                <p className="mt-2 text-sm text-cyan-50/72">{payload.message}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/12 px-4 py-2 text-sm text-cyan-50/90">
                <Volume2 className="h-4 w-4" />
                <span>{payload.verifiedOffline ? "Verified locally, syncing later" : "Will sync automatically"}</span>
              </div>
            </div>
          <div className="flex justify-center lg:justify-end">
            <RabbitMascot mood="offline" className="scale-[1.04]" />
          </div>
        </div>
        </>
      ) : (
        <motion.div
          className="grid w-full max-w-5xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center"
          animate={{ x: [0, -10, 10, -7, 7, 0] }}
          transition={{ duration: 0.46 }}
        >
          <div className="space-y-5 rounded-[36px] border border-rose-300/20 bg-white/[0.05] p-8 shadow-[0_30px_120px_rgba(186,38,78,0.2)] backdrop-blur-2xl lg:p-10">
            <motion.div
              className="flex h-24 w-24 items-center justify-center rounded-full border border-rose-200/24 bg-rose-300/14 text-rose-50 shadow-[0_0_60px_rgba(255,98,98,0.25)]"
              animate={{ rotate: [0, -7, 7, -5, 5, 0], scale: [0.92, 1.02, 1] }}
              transition={{ duration: 0.44, ease: "easeInOut" }}
            >
              <X className="h-12 w-12" strokeWidth={3.2} />
            </motion.div>
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.26em] text-rose-100/65">ID could not be verified</p>
              <h1 className="text-4xl font-bold tracking-[-0.04em] text-white sm:text-5xl">
                {failureTitle}
              </h1>
            </div>
            <p className="max-w-2xl text-xl leading-relaxed text-rose-50/88">{payload.message}</p>
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-300/20 bg-rose-300/12 px-4 py-2 text-sm text-rose-50/90">
              <Volume2 className="h-4 w-4" />
              <span>Soft error tone</span>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <RabbitMascot mood="sad" />
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

const ScanPage = () => {
  const navigate = useNavigate();
  const deviceTier = useMemo(() => getDeviceTier(), []);
  const scanDebugEnabled = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("scanDebug") === "1";
  }, []);
  const [phase, setPhase] = useState<KioskPhase>("idle");
  const [scanPayload, setScanPayload] = useState<ScanPayload | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [isOnline, setIsOnline] = useState(() => window.navigator.onLine);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<CameraErrorState | null>(null);
  const [cameraInitializing, setCameraInitializing] = useState(true);
  const [statusMessage, setStatusMessage] = useState("Starting camera...");
  const [guidanceHint, setGuidanceHint] = useState(DEFAULT_GUIDANCE_HINT);
  const [lightingHint, setLightingHint] = useState<string | null>(null);
  const [partialDetectionActive, setPartialDetectionActive] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState(() => readLastAttendanceSyncAt());
  const [isSyncing, setIsSyncing] = useState(false);
  const [cameraProfileLabel, setCameraProfileLabel] = useState(
    () => CAMERA_PROFILES[getDefaultCameraProfileIndex()].label,
  );
  const [scanBoxEdge, setScanBoxEdge] = useState(SCAN_BOX_DEFAULT_EDGE);
  const [scanFlashVisible, setScanFlashVisible] = useState(false);
  const [frameReactionActive, setFrameReactionActive] = useState(false);
  const [scanMetricsSnapshot, setScanMetricsSnapshot] = useState<ScanMetricsSnapshot>(() =>
    createEmptyScanMetricsSnapshot(),
  );
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetPin, setResetPin] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [adminPanelUnlocked, setAdminPanelUnlocked] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerRunningRef = useRef(false);
  const scannerStartPromiseRef = useRef<Promise<void> | null>(null);
  const isStartingRef = useRef(false);
  const cameraStartFailureLockedRef = useRef(false);
  const fullscreenGestureReadyRef = useRef(false);
  const scannerStartedRef = useRef(false);
  const scannerPausedRef = useRef(false);
  const activeCameraModeLabelRef = useRef(CAMERA_SOURCE_OPTIONS[0].label);
  const cameraProfileIndexRef = useRef(getDefaultCameraProfileIndex());
  const cameraInitializingSinceRef = useRef(0);
  const cameraErrorSinceRef = useRef(0);
  const scanAssistTimerRef = useRef<number | null>(null);
  const previewAnalysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scannerReadyAtRef = useRef(0);
  const scanProcessingStartedAtRef = useRef(0);
  const activeScanRunIdRef = useRef(0);
  const lastWatchdogRecoveryAtRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
  const processingUnlockTimerRef = useRef<number | null>(null);
  const resetHoldTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const frameReactionTimerRef = useRef<number | null>(null);
  const mobileNoticeTimerRef = useRef<number | null>(null);
  const fullscreenRetryTimerRef = useRef<number | null>(null);
  const cameraRecoveryTimerRef = useRef<number | null>(null);
  const kioskWatchdogTimerRef = useRef<number | null>(null);
  const fallbackScanFrameRef = useRef<number | null>(null);
  const fallbackScanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackScanAtRef = useRef(0);
  const scanWorkerRef = useRef<ScanDecoderWorker | null>(null);
  const scanWorkerSupportRef = useRef<ScanWorkerSupport>({ barcodeDetector: false, offscreenCanvas: false });
  const workerDecodeInFlightRef = useRef(false);
  const workerDecodeRequestIdRef = useRef(0);
  const workerGenerationRef = useRef(0);
  const lastWorkerTimingMsRef = useRef(0);
  const lastResolvedScanIntervalMsRef = useRef(DETECTION_BALANCED_INTERVAL_MS);
  const lastCaptureEdgeRef = useRef(DETECTION_CAPTURE_EDGE);
  const lastFrameSeenAtRef = useRef(0);
  const lastVideoCurrentTimeRef = useRef(-1);
  const slowScanStreakRef = useRef(0);
  const fastScanStreakRef = useRef(0);
  const decodeMissStreakRef = useRef(0);
  const lowLightStreakRef = useRef(0);
  const partialDetectionStreakRef = useRef(0);
  const lastAdaptiveProfileChangeAtRef = useRef(0);
  const recentFrameSignalRef = useRef<RecentFrameSignal | null>(null);
  const lastDetectionMetaRef = useRef<DetectionFrameMeta | null>(null);
  const scanMetricsHistoryRef = useRef<ScanLatencyMetric[]>([]);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const recentAcceptedScansRef = useRef<Map<string, number>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const isOnlineRef = useRef(isOnline);
  const syncInFlightRef = useRef(false);
  const deviceHeartbeatInFlightRef = useRef(false);
  const deviceCommandPollInFlightRef = useRef(false);
  const deviceCommandProcessingIdsRef = useRef<Set<string>>(new Set());
  const bindingRedirectInFlightRef = useRef(false);
  const cameraRetryCountRef = useRef(0);
  const torchBusyRef = useRef(false);
  const handleScanResultRef = useRef<
    (rawValue: string, detectionSource: ScanDetectionSource) => Promise<void>
  >(async () => undefined);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchBusy, setTorchBusy] = useState(false);

  const showResultOverlay = phase === "success" || phase === "error" || phase === "queued";

  const formattedTime = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(now),
    [now],
  );

  const formattedDate = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(now),
    [now],
  );

  const publishScanMetric = useCallback(
    (metric: ScanLatencyMetric) => {
      const nextHistory = [...scanMetricsHistoryRef.current, metric].slice(-SCAN_METRICS_HISTORY_LIMIT);
      scanMetricsHistoryRef.current = nextHistory;

      const snapshot = createScanMetricsSnapshot(nextHistory);
      setScanMetricsSnapshot(snapshot);
      (window as Window & { __LIBRIOFY_SCAN_METRICS__?: ScanMetricsSnapshot }).__LIBRIOFY_SCAN_METRICS__ =
        snapshot;

      logScanInfo("scan-latency", {
        status: metric.status,
        source: metric.detectionSource,
        decodeMs: metric.decodeMs,
        verifyMs: metric.verificationMs,
        totalMs: metric.totalMs,
        captureEdge: metric.captureEdge,
        intervalMs: metric.intervalMs,
        brightness: Math.round(metric.brightness),
        edgeScore: Number(metric.edgeScore.toFixed(1)),
        lowLight: metric.lowLight,
        cameraProfile: metric.cameraProfileLabel,
        deviceTier: metric.deviceTier,
      });

      if (snapshot.total % SCAN_METRICS_SUMMARY_LOG_EVERY === 0) {
        logScanInfo("scan-session-metrics", snapshot as unknown as Record<string, unknown>);
      }
    },
    [],
  );

  const resolveDetectionMetaForRawValue = useCallback(
    (rawValue: string, detectionSource: ScanDetectionSource): DetectionFrameMeta => {
      const cachedMeta = lastDetectionMetaRef.current;
      if (cachedMeta && cachedMeta.rawValue === rawValue) {
        return cachedMeta;
      }

      return {
        rawValue,
        detectedAtMs: Date.now(),
        decodeMs: lastWorkerTimingMsRef.current,
        detectionSource,
        captureEdge: lastCaptureEdgeRef.current,
        intervalMs: lastResolvedScanIntervalMsRef.current,
        brightness: recentFrameSignalRef.current?.brightness ?? 0,
        edgeScore: recentFrameSignalRef.current?.edgeScore ?? 0,
        lowLight: recentFrameSignalRef.current?.lowLight ?? false,
        cameraProfileLabel: CAMERA_PROFILES[cameraProfileIndexRef.current]?.label ?? cameraProfileLabel,
        deviceTier,
      };
    },
    [cameraProfileLabel, deviceTier],
  );

  const resolveWorkerCaptureEdge = useCallback(
    (cropEdge: number) => {
      const recentSignal = recentFrameSignalRef.current;
      const lowLightActive =
        Boolean(recentSignal?.lowLight) || lowLightStreakRef.current >= LOW_LIGHT_STREAK_THRESHOLD;
      const partialDetectionActive =
        Boolean(recentSignal?.partialDetection) ||
        partialDetectionStreakRef.current >= PARTIAL_DETECTION_STREAK_THRESHOLD;
      let preferredEdge = getCaptureEdgeForDeviceTier(deviceTier);

      if (lowLightActive) {
        preferredEdge += DETECTION_CAPTURE_LOW_LIGHT_BOOST;
      } else if (partialDetectionActive) {
        preferredEdge += DETECTION_CAPTURE_PARTIAL_BOOST;
      }

      if (!lowLightActive && lastWorkerTimingMsRef.current > 88) {
        preferredEdge -= DETECTION_CAPTURE_SLOW_REDUCTION;
      }

      const proportionalEdge = Math.round(
        cropEdge *
          (lowLightActive ? 0.72 : partialDetectionActive ? 0.66 : deviceTier === "entry" ? 0.54 : 0.58),
      );
      const resolvedEdge = Math.max(
        260,
        Math.min(Math.min(cropEdge, FALLBACK_SCAN_MAX_EDGE), Math.max(preferredEdge, proportionalEdge)),
      );
      lastCaptureEdgeRef.current = resolvedEdge;
      return resolvedEdge;
    },
    [deviceTier],
  );

  const resolveTargetInterval = useCallback(() => {
    const intervals = getDetectionIntervalsForDeviceTier(deviceTier);
    const recentSignal = recentFrameSignalRef.current;
    const workerTimingMs = lastWorkerTimingMsRef.current;
    let intervalMs =
      workerTimingMs >= 70 ? intervals.slow : workerTimingMs >= 45 ? intervals.balanced : intervals.fast;

    if (recentSignal?.lowLight || lowLightStreakRef.current >= LOW_LIGHT_STREAK_THRESHOLD) {
      intervalMs += DETECTION_INTERVAL_LOW_LIGHT_PENALTY_MS;
    }

    if (recentSignal?.partialDetection || partialDetectionStreakRef.current >= PARTIAL_DETECTION_STREAK_THRESHOLD) {
      intervalMs += DETECTION_INTERVAL_PARTIAL_PENALTY_MS;
    }

    if (workerTimingMs >= 95) {
      intervalMs += DETECTION_INTERVAL_OVERLOAD_PENALTY_MS;
    }

    if (decodeMissStreakRef.current >= DETECTION_MISS_STREAK_SETTLE_THRESHOLD) {
      intervalMs += DETECTION_INTERVAL_SETTLE_MS;
    }

    const resolvedIntervalMs = Math.max(24, Math.min(110, intervalMs));
    lastResolvedScanIntervalMsRef.current = resolvedIntervalMs;
    return resolvedIntervalMs;
  }, [deviceTier]);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const clearProcessingUnlockTimer = useCallback(() => {
    if (processingUnlockTimerRef.current !== null) {
      window.clearTimeout(processingUnlockTimerRef.current);
      processingUnlockTimerRef.current = null;
    }
  }, []);

  const clearResetHoldTimer = useCallback(() => {
    if (resetHoldTimerRef.current !== null) {
      window.clearTimeout(resetHoldTimerRef.current);
      resetHoldTimerRef.current = null;
    }
  }, []);

  const pruneRecentAcceptedScans = useCallback((nowTs: number) => {
    const recentScans = recentAcceptedScansRef.current;

    for (const [scanKey, acceptedAt] of recentScans) {
      if (nowTs - acceptedAt >= DUPLICATE_SCAN_WINDOW_MS) {
        recentScans.delete(scanKey);
      }
    }

    while (recentScans.size > RECENT_SCAN_CACHE_LIMIT) {
      const oldestKey = recentScans.keys().next().value;
      if (!oldestKey) {
        break;
      }

      recentScans.delete(oldestKey);
    }
  }, []);

  const wasRecentAcceptedScan = useCallback(
    (scanKey: string, nowTs: number) => {
      pruneRecentAcceptedScans(nowTs);
      const acceptedAt = recentAcceptedScansRef.current.get(scanKey);
      return typeof acceptedAt === "number" && nowTs - acceptedAt < DUPLICATE_SCAN_WINDOW_MS;
    },
    [pruneRecentAcceptedScans],
  );

  const rememberAcceptedScan = useCallback(
    (scanKey: string, nowTs: number) => {
      pruneRecentAcceptedScans(nowTs);
      recentAcceptedScansRef.current.set(scanKey, nowTs);
    },
    [pruneRecentAcceptedScans],
  );

  const releaseProcessingLock = useCallback(
    (scanRunId: number, reason: string) => {
      clearProcessingUnlockTimer();

      if (scanRunId > 0 && activeScanRunIdRef.current !== scanRunId) {
        return;
      }

      processingRef.current = false;
      scanProcessingStartedAtRef.current = 0;
      logScanInfo("scan-processing-unlocked", {
        reason,
        scanRunId: scanRunId || null,
      });
    },
    [clearProcessingUnlockTimer],
  );

  const scheduleProcessingUnlock = useCallback(
    (scanRunId: number, reason: string, delayMs = SCAN_PROCESSING_UNLOCK_DELAY_MS) => {
      clearProcessingUnlockTimer();

      processingUnlockTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) {
          return;
        }

        releaseProcessingLock(scanRunId, reason);
      }, delayMs);
    },
    [clearProcessingUnlockTimer, releaseProcessingLock],
  );

  const clearFullscreenRetryTimer = useCallback(() => {
    if (fullscreenRetryTimerRef.current !== null) {
      window.clearTimeout(fullscreenRetryTimerRef.current);
      fullscreenRetryTimerRef.current = null;
    }
  }, []);

  const clearCameraRecoveryTimer = useCallback(() => {
    if (cameraRecoveryTimerRef.current !== null) {
      window.clearTimeout(cameraRecoveryTimerRef.current);
      cameraRecoveryTimerRef.current = null;
    }
  }, []);

  const clearKioskWatchdogTimer = useCallback(() => {
    if (kioskWatchdogTimerRef.current !== null) {
      window.clearTimeout(kioskWatchdogTimerRef.current);
      kioskWatchdogTimerRef.current = null;
    }
  }, []);

  const invalidateActiveScan = useCallback((reason: string) => {
    clearProcessingUnlockTimer();
    activeScanRunIdRef.current += 1;
    scanProcessingStartedAtRef.current = 0;
    logScanInfo("scan-invalidated", { reason, activeScanRunId: activeScanRunIdRef.current });
  }, [clearProcessingUnlockTimer]);

  useEffect(() => {
    if (cameraInitializing) {
      if (cameraInitializingSinceRef.current === 0) {
        cameraInitializingSinceRef.current = Date.now();
      }
      return;
    }

    cameraInitializingSinceRef.current = 0;
  }, [cameraInitializing]);

  useEffect(() => {
    if (cameraError) {
      if (cameraErrorSinceRef.current === 0) {
        cameraErrorSinceRef.current = Date.now();
      }
      return;
    }

    cameraErrorSinceRef.current = 0;
  }, [cameraError]);

  const requestKioskFullscreen = useCallback(async () => {
    if (
      typeof document === "undefined" ||
      document.fullscreenElement ||
      !fullscreenGestureReadyRef.current
    ) {
      return;
    }

    const target = document.documentElement as HTMLElement & {
      requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
    };

    if (typeof target.requestFullscreen !== "function") {
      return;
    }

    try {
      await target.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // Kiosk fullscreen is best-effort in browsers that require a gesture.
    }
  }, []);

  const clearFeedbackTimers = useCallback(() => {
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }

    if (frameReactionTimerRef.current !== null) {
      window.clearTimeout(frameReactionTimerRef.current);
      frameReactionTimerRef.current = null;
    }

    if (mountedRef.current) {
      setScanFlashVisible(false);
      setFrameReactionActive(false);
    }
  }, []);

  const clearMobileNoticeTimer = useCallback(() => {
    if (mobileNoticeTimerRef.current !== null) {
      window.clearTimeout(mobileNoticeTimerRef.current);
      mobileNoticeTimerRef.current = null;
    }
  }, []);

  const clearScanAssistTimer = useCallback(() => {
    if (scanAssistTimerRef.current !== null) {
      window.clearTimeout(scanAssistTimerRef.current);
      scanAssistTimerRef.current = null;
    }
  }, []);

  const clearFallbackScanFrame = useCallback(() => {
    if (fallbackScanFrameRef.current !== null) {
      window.cancelAnimationFrame(fallbackScanFrameRef.current);
      fallbackScanFrameRef.current = null;
    }
  }, []);

  const resolveScanBoxEdge = useCallback((viewfinderWidth: number, viewfinderHeight: number) => {
    const shortestEdge = Math.max(0, Math.floor(Math.min(viewfinderWidth, viewfinderHeight)));
    const minEdge = Math.min(SCAN_BOX_MIN_EDGE, shortestEdge || SCAN_BOX_MIN_EDGE);
    const availableEdge = Math.max(0, shortestEdge - SCAN_BOX_VIEWPORT_PADDING);
    return Math.max(minEdge, Math.min(SCAN_BOX_MAX_EDGE, availableEdge || SCAN_BOX_DEFAULT_EDGE));
  }, []);

  const getScannerVideoElement = useCallback(() => {
    const scannerRegion = document.getElementById(SCANNER_REGION_ID);
    const video = scannerRegion?.querySelector("video");
    return video instanceof HTMLVideoElement ? video : null;
  }, []);

  const getScanCropRect = useCallback(
    (video: HTMLVideoElement) => {
      const previewWidth = video.clientWidth || video.videoWidth;
      const previewHeight = video.clientHeight || video.videoHeight;
      const displayedEdge = resolveScanBoxEdge(previewWidth, previewHeight);
      const widthScale = previewWidth ? video.videoWidth / previewWidth : 1;
      const heightScale = previewHeight ? video.videoHeight / previewHeight : 1;
      const cropEdge = Math.min(
        video.videoWidth,
        video.videoHeight,
        Math.round(displayedEdge * Math.max(widthScale, heightScale)),
      );

      return {
        cropEdge,
        sourceX: Math.max(0, (video.videoWidth - cropEdge) / 2),
        sourceY: Math.max(0, (video.videoHeight - cropEdge) / 2),
      };
    },
    [resolveScanBoxEdge],
  );

  const getScannerMediaTrack = useCallback(() => {
    const video = getScannerVideoElement();
    const stream = video?.srcObject;
    if (!(stream instanceof MediaStream)) {
      return null;
    }

    return stream.getVideoTracks()[0] ?? null;
  }, [getScannerVideoElement]);

  const terminateScanWorker = useCallback(() => {
    scanWorkerRef.current?.terminate();
    scanWorkerRef.current = null;
    workerDecodeInFlightRef.current = false;
    workerDecodeRequestIdRef.current = 0;
    workerGenerationRef.current += 1;
    scanWorkerSupportRef.current = { barcodeDetector: false, offscreenCanvas: false };
  }, []);

  const ensureScanWorker = useCallback(() => {
    if (scanWorkerRef.current) {
      return scanWorkerRef.current;
    }

    const worker = new Worker(new URL("../workers/scanDecoder.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<ScanWorkerMessage>) => {
      const message = event.data;

      if (message.type === "ready") {
        scanWorkerSupportRef.current = message.support;
        logScanInfo("scan-worker-ready", {
          ...message.support,
          deviceTier,
        });
        return;
      }

      if (
        message.generation !== workerGenerationRef.current ||
        message.requestId !== workerDecodeRequestIdRef.current
      ) {
        return;
      }

      workerDecodeInFlightRef.current = false;
      lastWorkerTimingMsRef.current = message.timingMs;
      const recentSignal = recentFrameSignalRef.current;
      const resolvedBrightness = message.brightness > 0 ? message.brightness : recentSignal?.brightness ?? 0;
      const resolvedEdgeScore = message.edgeScore > 0 ? message.edgeScore : recentSignal?.edgeScore ?? 0;
      const lowLightActive = message.lowLight || Boolean(recentSignal?.lowLight);
      const partialDetectionActive =
        !lowLightActive && !(recentSignal?.glare ?? false) && resolvedEdgeScore >= 28;
      recentFrameSignalRef.current = {
        brightness: resolvedBrightness,
        edgeScore: resolvedEdgeScore,
        lowLight: lowLightActive,
        glare: recentSignal?.glare ?? false,
        partialDetection: partialDetectionActive,
        at: Date.now(),
      };

      lowLightStreakRef.current = lowLightActive ? Math.min(lowLightStreakRef.current + 1, 12) : 0;
      partialDetectionStreakRef.current = partialDetectionActive
        ? Math.min(partialDetectionStreakRef.current + 1, 12)
        : 0;

      if (
        message.timingMs > ADAPTIVE_PROFILE_SLOW_SCAN_MS &&
        !lowLightActive &&
        !partialDetectionActive &&
        cameraProfileIndexRef.current < CAMERA_PROFILES.length - 1
      ) {
        slowScanStreakRef.current += 1;
      } else {
        slowScanStreakRef.current = 0;
      }

      if (
        message.timingMs <= ADAPTIVE_PROFILE_FAST_SCAN_MS &&
        !lowLightActive &&
        !partialDetectionActive &&
        cameraProfileIndexRef.current > getDefaultCameraProfileIndex()
      ) {
        fastScanStreakRef.current += 1;
      } else {
        fastScanStreakRef.current = 0;
      }

      if (!message.rawValue) {
        decodeMissStreakRef.current += 1;
        return;
      }

      decodeMissStreakRef.current = 0;
      const detectionMeta: DetectionFrameMeta = {
        rawValue: message.rawValue,
        detectedAtMs: Date.now(),
        decodeMs: message.timingMs,
        detectionSource: message.detector ?? "jsqr",
        captureEdge: lastCaptureEdgeRef.current,
        intervalMs: lastResolvedScanIntervalMsRef.current,
        brightness: resolvedBrightness,
        edgeScore: resolvedEdgeScore,
        lowLight: lowLightActive,
        cameraProfileLabel: CAMERA_PROFILES[cameraProfileIndexRef.current]?.label ?? cameraProfileLabel,
        deviceTier,
      };
      lastDetectionMetaRef.current = detectionMeta;

      logScanInfo("qr-detected", {
        source: detectionMeta.detectionSource,
        length: message.rawValue.length,
        preview: summarizeQrForLog(message.rawValue),
        timingMs: message.timingMs,
        captureEdge: detectionMeta.captureEdge,
        intervalMs: detectionMeta.intervalMs,
        brightness: Math.round(detectionMeta.brightness),
        edgeScore: Number(detectionMeta.edgeScore.toFixed(1)),
        lowLight: detectionMeta.lowLight,
        cameraProfile: detectionMeta.cameraProfileLabel,
        deviceTier: detectionMeta.deviceTier,
      });
      void handleScanResultRef.current(message.rawValue, detectionMeta.detectionSource).catch(() => undefined);
    };

    worker.onerror = (error) => {
      workerDecodeInFlightRef.current = false;
      logScanWarn("scan-worker-error", {
        message: error.message || "Worker crashed",
      });
    };

    worker.postMessage({ type: "init" });
    scanWorkerRef.current = worker;
    return worker;
  }, [cameraProfileLabel, deviceTier]);

  const captureFrameForWorker = useCallback(async () => {
    const video = getScannerVideoElement();
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const { cropEdge, sourceX, sourceY } = getScanCropRect(video);
    const targetEdge = resolveWorkerCaptureEdge(cropEdge);

    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(video, sourceX, sourceY, cropEdge, cropEdge, {
          resizeWidth: targetEdge,
          resizeHeight: targetEdge,
          resizeQuality: "medium",
        });
      } catch {
        // Continue with the synchronous canvas fallback below.
      }
    }

    const canvas = fallbackScanCanvasRef.current ?? document.createElement("canvas");
    fallbackScanCanvasRef.current = canvas;

    if (canvas.width !== targetEdge) canvas.width = targetEdge;
    if (canvas.height !== targetEdge) canvas.height = targetEdge;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, targetEdge, targetEdge);
    context.drawImage(video, sourceX, sourceY, cropEdge, cropEdge, 0, 0, targetEdge, targetEdge);

    return createImageBitmap(canvas);
  }, [getScanCropRect, getScannerVideoElement, resolveWorkerCaptureEdge]);

  const readFallbackQrFromFrame = useCallback(() => {
    try {
      const video = getScannerVideoElement();
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        return null;
      }

      const { cropEdge, sourceX, sourceY } = getScanCropRect(video);
      const targetEdge = Math.max(320, Math.min(FALLBACK_SCAN_MAX_EDGE, Math.round(cropEdge)));
      const canvas = fallbackScanCanvasRef.current ?? document.createElement("canvas");
      fallbackScanCanvasRef.current = canvas;

      if (canvas.width !== targetEdge) canvas.width = targetEdge;
      if (canvas.height !== targetEdge) canvas.height = targetEdge;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return null;
      }

      context.imageSmoothingEnabled = false;

      const decodeFrame = () => {
        const imageData = context.getImageData(0, 0, targetEdge, targetEdge);
        return trimText(
          jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          })?.data,
        );
      };

      context.filter = "none";
      context.drawImage(video, sourceX, sourceY, cropEdge, cropEdge, 0, 0, targetEdge, targetEdge);
      const directRead = decodeFrame();
      if (directRead) {
        context.filter = "none";
        return directRead;
      }

      context.clearRect(0, 0, targetEdge, targetEdge);
      context.filter = "grayscale(1) contrast(1.22) brightness(1.05)";
      context.drawImage(video, sourceX, sourceY, cropEdge, cropEdge, 0, 0, targetEdge, targetEdge);
      context.filter = "none";
      const contrastRead = decodeFrame();
      if (contrastRead) {
        return contrastRead;
      }

      context.clearRect(0, 0, targetEdge, targetEdge);
      context.filter = "grayscale(1) contrast(1.42) brightness(1.12)";
      context.drawImage(video, sourceX, sourceY, cropEdge, cropEdge, 0, 0, targetEdge, targetEdge);
      context.filter = "none";

      return decodeFrame();
    } catch {
      return null;
    }
  }, [getScanCropRect, getScannerVideoElement]);

  const startFallbackScanLoop = useCallback(() => {
    clearFallbackScanFrame();
    fallbackScanAtRef.current = 0;
    workerDecodeInFlightRef.current = false;
    workerGenerationRef.current += 1;
    decodeMissStreakRef.current = 0;
    lastFrameSeenAtRef.current = Date.now();
    lastVideoCurrentTimeRef.current = -1;

    const decodeGeneration = workerGenerationRef.current;
    const worker = ensureScanWorker();

    const loop = () => {
      if (
        !mountedRef.current ||
        !scannerStartedRef.current ||
        scannerPausedRef.current ||
        cameraError
      ) {
        fallbackScanFrameRef.current = null;
        return;
      }

      const video = getScannerVideoElement();
      if (video && video.currentTime !== lastVideoCurrentTimeRef.current) {
        lastVideoCurrentTimeRef.current = video.currentTime;
        lastFrameSeenAtRef.current = Date.now();
      }

      if (processingRef.current) {
        fallbackScanFrameRef.current = window.requestAnimationFrame(loop);
        return;
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const targetIntervalMs = resolveTargetInterval();
      if (!workerDecodeInFlightRef.current && now - fallbackScanAtRef.current >= targetIntervalMs) {
        fallbackScanAtRef.current = now;

        workerDecodeInFlightRef.current = true;
        const requestId = workerDecodeRequestIdRef.current + 1;
        workerDecodeRequestIdRef.current = requestId;

        void captureFrameForWorker()
          .then((bitmap) => {
            if (!bitmap) {
              workerDecodeInFlightRef.current = false;
              return;
            }

            if (
              scanWorkerSupportRef.current.offscreenCanvas ||
              scanWorkerSupportRef.current.barcodeDetector
            ) {
              worker.postMessage(
                {
                  type: "decode",
                  requestId,
                  generation: decodeGeneration,
                  bitmap,
                },
                [bitmap],
              );
              return;
            }

            bitmap.close();
            const rawValue = readFallbackQrFromFrame();
            workerDecodeInFlightRef.current = false;
            if (!rawValue) {
              decodeMissStreakRef.current += 1;
              return;
            }

            decodeMissStreakRef.current = 0;
            const detectionMeta: DetectionFrameMeta = {
              rawValue,
              detectedAtMs: Date.now(),
              decodeMs: lastWorkerTimingMsRef.current,
              detectionSource: "jsqr",
              captureEdge: lastCaptureEdgeRef.current,
              intervalMs: targetIntervalMs,
              brightness: recentFrameSignalRef.current?.brightness ?? 0,
              edgeScore: recentFrameSignalRef.current?.edgeScore ?? 0,
              lowLight: recentFrameSignalRef.current?.lowLight ?? false,
              cameraProfileLabel: CAMERA_PROFILES[cameraProfileIndexRef.current]?.label ?? cameraProfileLabel,
              deviceTier,
            };
            lastDetectionMetaRef.current = detectionMeta;

            logScanInfo("qr-detected", {
              source: detectionMeta.detectionSource,
              length: rawValue.length,
              preview: summarizeQrForLog(rawValue),
              mode: "main-thread-fallback",
              captureEdge: detectionMeta.captureEdge,
              intervalMs: detectionMeta.intervalMs,
              cameraProfile: detectionMeta.cameraProfileLabel,
              deviceTier: detectionMeta.deviceTier,
            });
            void handleScanResultRef.current(rawValue, "jsqr").catch(() => undefined);
          })
          .catch((error) => {
            workerDecodeInFlightRef.current = false;
            logScanWarn("scan-capture-failed", {
              message: getReadableError(error, "Unable to capture a scan frame."),
            });
          });
      }

      fallbackScanFrameRef.current = window.requestAnimationFrame(loop);
    };

    fallbackScanFrameRef.current = window.requestAnimationFrame(loop);
  }, [
    cameraError,
    cameraProfileLabel,
    captureFrameForWorker,
    clearFallbackScanFrame,
    deviceTier,
    ensureScanWorker,
    getScannerVideoElement,
    readFallbackQrFromFrame,
    resolveTargetInterval,
  ]);

  const analyzePreviewFrame = useCallback((): FrameAnalysis | null => {
    try {
      const video = getScannerVideoElement();
      if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        return null;
      }

      const canvas = previewAnalysisCanvasRef.current ?? document.createElement("canvas");
      previewAnalysisCanvasRef.current = canvas;

      const sampleSize = 84;
      canvas.width = sampleSize;
      canvas.height = sampleSize;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return null;
      }

      const { cropEdge, sourceX, sourceY } = getScanCropRect(video);

      context.drawImage(video, sourceX, sourceY, cropEdge, cropEdge, 0, 0, sampleSize, sampleSize);
      const imageData = context.getImageData(0, 0, sampleSize, sampleSize);
      const grayscale = new Float32Array(sampleSize * sampleSize);

      let brightnessTotal = 0;
      let glarePixels = 0;
      let shadowPixels = 0;

      for (let index = 0; index < grayscale.length; index += 1) {
        const sourceIndex = index * 4;
        const luminance =
          imageData.data[sourceIndex] * 0.299 +
          imageData.data[sourceIndex + 1] * 0.587 +
          imageData.data[sourceIndex + 2] * 0.114;

        grayscale[index] = luminance;
        brightnessTotal += luminance;

        if (luminance > 218) {
          glarePixels += 1;
        }

        if (luminance < 52) {
          shadowPixels += 1;
        }
      }

      let edgeTotal = 0;
      for (let y = 1; y < sampleSize; y += 1) {
        for (let x = 1; x < sampleSize; x += 1) {
          const index = y * sampleSize + x;
          edgeTotal += Math.abs(grayscale[index] - grayscale[index - 1]);
          edgeTotal += Math.abs(grayscale[index] - grayscale[index - sampleSize]);
        }
      }

      const pixelCount = grayscale.length;
      const edgeSamples = (sampleSize - 1) * (sampleSize - 1) * 2;

      return {
        brightness: brightnessTotal / pixelCount,
        glareRatio: glarePixels / pixelCount,
        shadowRatio: shadowPixels / pixelCount,
        edgeScore: edgeTotal / edgeSamples,
      };
    } catch {
      return null;
    }
  }, [getScanCropRect, getScannerVideoElement]);

  const getAudioContext = useCallback(async () => {
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;

    if (!AudioContextCtor) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }

    if (audioContextRef.current.state === "suspended") {
      try {
        await audioContextRef.current.resume();
      } catch {
        return null;
      }
    }

    return audioContextRef.current;
  }, []);

  const playFeedbackTone = useCallback(
    async (tone: "detect" | "success" | "error") => {
      const context = await getAudioContext();
      if (!context) {
        return;
      }

      const notes =
        tone === "detect"
          ? [
              { frequency: 760, duration: 0.06, gain: 0.018, type: "sine" as OscillatorType },
              { frequency: 980, duration: 0.08, gain: 0.02, type: "triangle" as OscillatorType },
            ]
          : tone === "success"
          ? [
              { frequency: 660, duration: 0.12, gain: 0.03, type: "sine" as OscillatorType },
              { frequency: 880, duration: 0.18, gain: 0.035, type: "triangle" as OscillatorType },
              { frequency: 1048, duration: 0.22, gain: 0.03, type: "sine" as OscillatorType },
            ]
          : [
              { frequency: 310, duration: 0.16, gain: 0.03, type: "sawtooth" as OscillatorType },
              { frequency: 240, duration: 0.2, gain: 0.026, type: "triangle" as OscillatorType },
            ];

      let cursor = context.currentTime;

      for (const note of notes) {
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();

        oscillator.type = note.type;
        oscillator.frequency.setValueAtTime(note.frequency, cursor);

        gainNode.gain.setValueAtTime(0.0001, cursor);
        gainNode.gain.exponentialRampToValueAtTime(note.gain, cursor + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, cursor + note.duration);

        oscillator.connect(gainNode);
        gainNode.connect(context.destination);

        oscillator.start(cursor);
        oscillator.stop(cursor + note.duration + 0.04);

        cursor += note.duration * 0.82;
      }
    },
    [getAudioContext],
  );

  const acquireWakeLock = useCallback(async () => {
    const wakeLockApi = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLockApi || document.visibilityState !== "visible") {
      return;
    }

    try {
      wakeLockRef.current = await wakeLockApi.request("screen");
      wakeLockRef.current.addEventListener?.("release", () => {
        wakeLockRef.current = null;
      });
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release();
    } catch {
      // Ignore wake-lock cleanup failures.
    } finally {
      wakeLockRef.current = null;
    }
  }, []);

  const applyPreferredTrackControls = useCallback(
    async (scanner: Html5Qrcode) => {
      try {
        const capabilities = scanner.getRunningTrackCapabilities() as ExtendedMediaTrackCapabilities;
        const supportedControls: ExtendedTrackConstraintSet = {};

        if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
          supportedControls.focusMode = "continuous";
        }

        if (
          Array.isArray(capabilities.exposureMode) &&
          capabilities.exposureMode.includes("continuous")
        ) {
          supportedControls.exposureMode = "continuous";
        }

        if (
          Array.isArray(capabilities.whiteBalanceMode) &&
          capabilities.whiteBalanceMode.includes("continuous")
        ) {
          supportedControls.whiteBalanceMode = "continuous";
        }

        if (!Object.keys(supportedControls).length) {
          return;
        }

        await scanner.applyVideoConstraints({
          advanced: [supportedControls],
        } as MediaTrackConstraints);
      } catch {
        // Ignore post-start track tuning failures.
      }
    },
    [],
  );

  const syncTorchState = useCallback((scanner: Html5Qrcode | null) => {
    if (!scanner) {
      torchBusyRef.current = false;
      setTorchBusy(false);
      setTorchEnabled(false);
      setTorchSupported(false);
      return false;
    }

    try {
      const torchFeature = scanner.getRunningTrackCameraCapabilities().torchFeature();
      const supported = torchFeature.isSupported();
      const enabled = supported ? Boolean(torchFeature.value()) : false;

      setTorchSupported(supported);
      setTorchEnabled(enabled);

      if (!supported) {
        torchBusyRef.current = false;
        setTorchBusy(false);
      }

      return supported;
    } catch {
      torchBusyRef.current = false;
      setTorchBusy(false);
      setTorchEnabled(false);
      setTorchSupported(false);
      return false;
    }
  }, []);

  const setTorchState = useCallback(async (enabled: boolean) => {
    const scanner = scannerRef.current;
    if (!scanner || !scannerStartedRef.current || torchBusyRef.current) {
      return false;
    }

    try {
      const torchFeature = scanner.getRunningTrackCameraCapabilities().torchFeature();
      if (!torchFeature.isSupported()) {
        setTorchSupported(false);
        setTorchEnabled(false);
        return false;
      }

      torchBusyRef.current = true;
      setTorchBusy(true);
      await torchFeature.apply(enabled);
      setTorchEnabled(enabled);
      setTorchSupported(true);
      return true;
    } catch {
      setTorchEnabled(false);
      setTorchSupported(false);
      return false;
    } finally {
      torchBusyRef.current = false;
      setTorchBusy(false);
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!torchSupported || torchBusyRef.current) {
      return;
    }

    await setTorchState(!torchEnabled);
  }, [setTorchState, torchEnabled, torchSupported]);

  const vibrateFeedback = useCallback((pattern: number | number[]) => {
    if (typeof navigator.vibrate !== "function") {
      return;
    }

    navigator.vibrate(pattern);
  }, []);

  const triggerScanFeedback = useCallback(() => {
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }

    if (frameReactionTimerRef.current !== null) {
      window.clearTimeout(frameReactionTimerRef.current);
    }

    setScanFlashVisible(true);
    setFrameReactionActive(true);

    flashTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) {
        return;
      }

      setScanFlashVisible(false);
    }, 110);

    frameReactionTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) {
        return;
      }

      setFrameReactionActive(false);
    }, 520);
  }, []);

  const clearScannerRegion = useCallback(() => {
    const scannerRegion = document.getElementById(SCANNER_REGION_ID);
    if (scannerRegion) {
      scannerRegion.innerHTML = "";
    }
  }, []);

  const stopScanner = useCallback(async (reason = "unspecified") => {
    scannerStartPromiseRef.current = null;
    scannerRunningRef.current = false;
    isStartingRef.current = false;
    clearCameraRecoveryTimer();
    clearProcessingUnlockTimer();
    clearFallbackScanFrame();
    fallbackScanAtRef.current = 0;
    workerDecodeInFlightRef.current = false;
    workerGenerationRef.current += 1;
    lastFrameSeenAtRef.current = 0;
    lastVideoCurrentTimeRef.current = -1;
    lastResolvedScanIntervalMsRef.current = DETECTION_BALANCED_INTERVAL_MS;
    lastCaptureEdgeRef.current = getCaptureEdgeForDeviceTier(deviceTier);
    torchBusyRef.current = false;
    scannerReadyAtRef.current = 0;
    scanProcessingStartedAtRef.current = 0;
    slowScanStreakRef.current = 0;
    fastScanStreakRef.current = 0;
    decodeMissStreakRef.current = 0;
    lowLightStreakRef.current = 0;
    partialDetectionStreakRef.current = 0;
    recentFrameSignalRef.current = null;
    recentAcceptedScansRef.current.clear();
    lastDetectionMetaRef.current = null;
    logScanInfo("scanner-stop", {
      reason,
      started: scannerStartedRef.current,
      paused: scannerPausedRef.current,
    });

    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) {
      scannerStartedRef.current = false;
      scannerPausedRef.current = false;
      cameraRetryCountRef.current = 0;
      if (mountedRef.current) {
        setTorchBusy(false);
        setTorchEnabled(false);
        setTorchSupported(false);
      }

      cameraInitializingSinceRef.current = 0;
      cameraErrorSinceRef.current = 0;
      clearScannerRegion();

      if (mountedRef.current) {
        setCameraReady(false);
      }

      return;
    }

    try {
      await scanner.stop();
    } catch {
      // Ignore camera stop failures so the kiosk can recover.
    }

    try {
      scanner.clear();
    } catch {
      // Ignore renderer cleanup failures.
    }

    clearScannerRegion();
    scannerRef.current = null;
    scannerStartedRef.current = false;
    scannerPausedRef.current = false;
    cameraRetryCountRef.current = 0;
    if (mountedRef.current) {
      setTorchBusy(false);
      setTorchEnabled(false);
      setTorchSupported(false);
    }

    cameraInitializingSinceRef.current = 0;
    cameraErrorSinceRef.current = 0;

    if (mountedRef.current) {
      setCameraReady(false);
    }
  }, [clearCameraRecoveryTimer, clearFallbackScanFrame, clearProcessingUnlockTimer, clearScannerRegion, deviceTier]);

  const buildCameraStartConstraints = useCallback(
    (baseConstraints: MediaTrackConstraints, selectedCameraId: string | null): MediaTrackConstraints => {
      const activeProfile = CAMERA_PROFILES[cameraProfileIndexRef.current] ?? CAMERA_PROFILES[0];
      const { facingMode: _ignoredFacingMode, ...profileWithoutFacingMode } = activeProfile.constraints;

      if (selectedCameraId) {
        return {
          ...profileWithoutFacingMode,
          deviceId: { exact: selectedCameraId },
        };
      }

      return {
        ...activeProfile.constraints,
        ...baseConstraints,
      };
    },
    [],
  );

  const chooseRearCameraSource = useCallback(async (): Promise<CameraSourceSelection[]> => {
    if (!window.isSecureContext) {
      throw new Error("HTTPS_REQUIRED");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MEDIA_DEVICES_UNSUPPORTED");
    }

    const [rearCameraOption, frontCameraOption] = CAMERA_SOURCE_OPTIONS;
    const activeProfile = CAMERA_PROFILES[cameraProfileIndexRef.current] ?? CAMERA_PROFILES[0];
    const permissionState = await readCameraPermissionState();
    let warmupStream: MediaStream | null = null;
    let videoInputs: MediaDeviceInfo[] = [];
    let rearCameras: MediaDeviceInfo[] = [];

    if (permissionState !== "granted") {
      warmupStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoInputs = devices.filter(
        (device): device is MediaDeviceInfo => device.kind === "videoinput" && Boolean(device.deviceId),
      );
      rearCameras = videoInputs.filter((device) => isRearCameraLabel(device.label.trim()));
    } catch (error) {
      logScanWarn("camera-enumeration-failed", {
        message: getReadableError(error, "Unable to enumerate cameras."),
        permissionState,
      });
    } finally {
      stopMediaStream(warmupStream);
    }

    const exactCameraCandidates = [...videoInputs]
      .sort((left, right) => {
        const leftLabel = left.label.trim();
        const rightLabel = right.label.trim();
        const leftScore = isRearCameraLabel(leftLabel) ? 0 : FRONT_CAMERA_LABEL_PATTERN.test(leftLabel) ? 2 : 1;
        const rightScore = isRearCameraLabel(rightLabel) ? 0 : FRONT_CAMERA_LABEL_PATTERN.test(rightLabel) ? 2 : 1;

        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }

        return leftLabel.localeCompare(rightLabel);
      })
      .map((camera, index) => {
        const cameraLabel = camera.label.trim() || `Camera ${index + 1}`;
        const cameraConstraints = buildCameraStartConstraints({}, camera.deviceId);

        return {
          cameraSource: cameraConstraints,
          constraints: cameraConstraints,
          profileLabel: `${cameraLabel} / ${activeProfile.label}`,
          selectedCameraId: camera.deviceId,
          sourceType: "cameraId" as const,
        };
      });

    const fallbackCandidates: CameraSourceSelection[] = [
      {
        cameraSource: buildCameraStartConstraints(rearCameraOption.constraints, null),
        constraints: buildCameraStartConstraints(rearCameraOption.constraints, null),
        profileLabel: `${rearCameraOption.label} / ${activeProfile.label}`,
        selectedCameraId: null,
        sourceType: "constraints",
      },
      {
        cameraSource: buildCameraStartConstraints(frontCameraOption.constraints, null),
        constraints: buildCameraStartConstraints(frontCameraOption.constraints, null),
        profileLabel: `${frontCameraOption.label} / ${activeProfile.label}`,
        selectedCameraId: null,
        sourceType: "constraints",
      },
    ];

    const cameraSources = [...exactCameraCandidates, ...fallbackCandidates];

    logScanInfo("camera-source-candidates", {
      activeProfile: activeProfile.label,
      enumeratedVideoInputs: videoInputs.length,
      permissionState,
      rearCameraMatches: rearCameras.length,
      sources: cameraSources.map((source) => ({
        profileLabel: source.profileLabel,
        selectedCameraId: source.selectedCameraId,
        sourceType: source.sourceType,
      })),
    });

    return cameraSources;
  }, [buildCameraStartConstraints]);

  const pauseScanner = useCallback((shouldPauseVideo = true, reason = "unspecified") => {
    const scanner = scannerRef.current;
    if (!scanner || !scannerStartedRef.current || scannerPausedRef.current) {
      return;
    }

    try {
      scanner.pause(shouldPauseVideo);
      scannerPausedRef.current = true;
      clearFallbackScanFrame();
      clearProcessingUnlockTimer();
      workerDecodeInFlightRef.current = false;
      workerGenerationRef.current += 1;
      decodeMissStreakRef.current = 0;
      lastDetectionMetaRef.current = null;
      logScanInfo("scanner-pause", {
        reason,
        shouldPauseVideo,
      });
    } catch {
      // Ignore pause errors and let the next restart recover.
    }
  }, [clearFallbackScanFrame, clearProcessingUnlockTimer]);

  const applyScannerReadyState = useCallback(
    (scanner: Html5Qrcode, source: "start" | "resume" | "reuse") => {
      scannerRunningRef.current = true;
      cameraStartFailureLockedRef.current = false;
      scannerStartedRef.current = true;
      scannerPausedRef.current = false;
      scannerReadyAtRef.current = Date.now();
      lastFrameSeenAtRef.current = scannerReadyAtRef.current;
      lastVideoCurrentTimeRef.current = -1;
      cameraRetryCountRef.current = 0;
      slowScanStreakRef.current = 0;
      fastScanStreakRef.current = 0;
      decodeMissStreakRef.current = 0;
      lowLightStreakRef.current = 0;
      partialDetectionStreakRef.current = 0;
      recentFrameSignalRef.current = null;
      lastDetectionMetaRef.current = null;
      lastResolvedScanIntervalMsRef.current = DETECTION_BALANCED_INTERVAL_MS;
      lastCaptureEdgeRef.current = getCaptureEdgeForDeviceTier(deviceTier);
      cameraInitializingSinceRef.current = 0;
      cameraErrorSinceRef.current = 0;
      clearCameraRecoveryTimer();
      syncTorchState(scanner);
      try {
        startFallbackScanLoop();
      } catch (error) {
        logScanWarn("scanner-fallback-loop-start-failed", {
          source,
          message: getReadableError(error, "Unable to start scan assist."),
        });
      }

      let resolution: string | null = null;
      try {
        const runningSettings = scanner.getRunningTrackSettings();
        resolution =
          runningSettings.width && runningSettings.height
            ? `${runningSettings.width}x${runningSettings.height}`
            : null;
      } catch (error) {
        logScanWarn("scanner-track-settings-unavailable", {
          source,
          message: getReadableError(error, "Unable to read camera settings."),
        });
      }
      const profileLabel = activeCameraModeLabelRef.current;

      if (mountedRef.current) {
        setCameraInitializing(false);
        setCameraReady(true);
        setCameraError(null);
        setGuidanceHint(DEFAULT_GUIDANCE_HINT);
        setLightingHint(null);
        setPartialDetectionActive(false);
        setStatusMessage(isOnlineRef.current ? "Ready to scan" : "Offline queue ready");
        setCameraProfileLabel(resolution ? `${profileLabel} | ${resolution}` : profileLabel);
      }

      logScanInfo("scanner-ready", {
        source,
        profile: profileLabel,
        resolution,
        deviceTier,
      });
    },
    [clearCameraRecoveryTimer, deviceTier, startFallbackScanLoop, syncTorchState],
  );

  const startScanner = useCallback(async (reason = "unspecified") => {
    if (!mountedRef.current || processingRef.current) {
      return;
    }

    if (isStartingRef.current) {
      logScanInfo("scanner-start-skipped", { reason, cause: "already-starting" });
      return;
    }

    if (scannerStartPromiseRef.current) {
      await scannerStartPromiseRef.current;
      return;
    }

    const existingScanner = scannerRef.current;
    logScanInfo("scanner-start-requested", {
      reason,
      hasExistingScanner: Boolean(existingScanner),
      started: scannerStartedRef.current,
      paused: scannerPausedRef.current,
    });
    if (existingScanner && scannerStartedRef.current) {
      if (!scannerPausedRef.current) {
        applyScannerReadyState(existingScanner, "reuse");
        return;
      }

      try {
        existingScanner.resume();
        applyScannerReadyState(existingScanner, "resume");
        return;
      } catch (error) {
        logScanWarn("scanner-resume-failed", {
          reason,
          message: getReadableError(error, "Unable to resume the camera."),
        });
        await stopScanner("resume-failed");
      }
    }

    if (
      cameraStartFailureLockedRef.current &&
      reason !== "manual-retry" &&
      reason !== "device-command-restart"
    ) {
      logScanInfo("scanner-start-skipped", {
        reason,
        cause: "blocked-after-failure",
      });
      return;
    }

    if (scannerRunningRef.current) {
      logScanInfo("scanner-start-skipped", {
        reason,
        cause: "already-running",
      });
      return;
    }

    scannerRunningRef.current = true;
    let lastAttemptedCameraSource: CameraSourceSelection | null = null;
    isStartingRef.current = true;
    const startup = (async () => {
      console.info("Starting camera...");
      logScanInfo("Starting camera...", { reason });

      if (mountedRef.current) {
        setCameraInitializing(true);
        setCameraReady(false);
        setCameraError(null);
        setStatusMessage("Starting camera...");
      }

      if (scannerRef.current) {
        await scannerRef.current.stop().catch(() => undefined);
      }

      await stopScanner(`before-start:${reason}`);
      await waitForElementById(SCANNER_REGION_ID, CAMERA_CONTAINER_WAIT_TIMEOUT_MS);
      if (!document.getElementById(SCANNER_REGION_ID)) {
        logScanWarn("scanner-start-aborted", {
          reason,
          cause: "container-missing",
        });
        throw createCameraStartupError("SCANNER_CONTAINER_MISSING");
      }
      await sleep(CAMERA_START_DELAY_MS);

      const cameraSources = await chooseRearCameraSource();
      if (!mountedRef.current) {
        return;
      }

      const scanConfig: Html5QrcodeCameraScanConfig = {
        fps: 1,
        aspectRatio: 1,
        disableFlip: false,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const edge = resolveScanBoxEdge(viewfinderWidth, viewfinderHeight);

          if (mountedRef.current) {
            setScanBoxEdge((currentEdge) => (currentEdge === edge ? currentEdge : edge));
          }

          return { width: edge, height: edge };
        },
      };

      let startedScanner: Html5Qrcode | null = null;
      let startedCameraSource: CameraSourceSelection | null = null;
      let startedProfileLabel: string | null = null;
      let lastStartError: unknown = null;

      for (const cameraSource of cameraSources) {
        lastAttemptedCameraSource = cameraSource;
        const scanner = new Html5Qrcode(SCANNER_REGION_ID, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: false,
          verbose: false,
        });

        scannerRef.current = scanner;
        activeCameraModeLabelRef.current = cameraSource.profileLabel;
        setCameraProfileLabel(cameraSource.profileLabel);

        try {
          logScanInfo("scanner-start-attempt", {
            reason,
            profileLabel: cameraSource.profileLabel,
            selectedCameraId: cameraSource.selectedCameraId,
            constraints: cameraSource.constraints,
            sourceType: cameraSource.sourceType,
          });
          await withCameraTimeout(
            scanner.start(
              cameraSource.cameraSource,
              scanConfig,
              () => undefined,
              () => undefined,
            ),
            CAMERA_START_TIMEOUT_MS,
            "CAMERA_START_TIMEOUT",
          );
          startedScanner = scanner;
          startedCameraSource = cameraSource;
          startedProfileLabel = cameraSource.profileLabel;
          console.info("Camera stream received");
          logScanInfo("camera-stream-received", {
            reason,
            profileLabel: cameraSource.profileLabel,
            selectedCameraId: cameraSource.selectedCameraId,
            constraints: cameraSource.constraints,
            sourceType: cameraSource.sourceType,
          });
          await applyPreferredTrackControls(scanner);
          break;
        } catch (error) {
          const normalizedCameraError = normalizeCameraStartupError(error, {
            isSecureContext: window.isSecureContext,
            supportsMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
          });
          lastStartError = error;
          console.error(SCAN_LOG_PREFIX, "camera-start-attempt-failed-raw", error);
          logScanWarn("camera-start-attempt-failed", {
            browserErrorName: normalizedCameraError.browserErrorName,
            errorKind: normalizedCameraError.kind,
            reason,
            profileLabel: cameraSource.profileLabel,
            selectedCameraId: cameraSource.selectedCameraId,
            constraints: cameraSource.constraints,
            sourceType: cameraSource.sourceType,
            message: normalizedCameraError.rawMessage || normalizedCameraError.detail,
            retryable: normalizedCameraError.retryable,
            stack: normalizedCameraError.stack,
          });
          scannerRef.current = null;

          try {
            await scanner.stop();
          } catch {
            // Ignore stream shutdown failures during camera startup recovery.
          }

          try {
            scanner.clear();
          } catch {
            // Ignore renderer cleanup failures.
          }

          if (
            error instanceof DOMException &&
            ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error.name)
          ) {
            throw error;
          }

          await sleep(120);
        }
      }

      if (!startedScanner || !startedProfileLabel) {
        throw lastStartError ?? createCameraStartupError("CAMERA_START_TIMEOUT");
      }

      if (!mountedRef.current) {
        await stopScanner("component-unmounted");
        return;
      }

      setCameraProfileLabel(startedProfileLabel);
      applyScannerReadyState(startedScanner, "start");
      logScanInfo("scanner-start-success", {
        reason,
        profileLabel: startedCameraSource?.profileLabel ?? startedProfileLabel,
        selectedCameraId: startedCameraSource?.selectedCameraId ?? null,
        constraints: startedCameraSource?.constraints ?? null,
        sourceType: startedCameraSource?.sourceType ?? null,
      });

    })()
      .catch(async (error) => {
        const normalizedCameraError = normalizeCameraStartupError(error, {
          isSecureContext: window.isSecureContext,
          supportsMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
        });
        const retryAttempt = normalizedCameraError.retryable ? cameraRetryCountRef.current + 1 : 0;

        cameraStartFailureLockedRef.current = !normalizedCameraError.retryable;
        logScanWarn("scanner-start-failed", {
          browserErrorName: normalizedCameraError.browserErrorName,
          errorKind: normalizedCameraError.kind,
          reason,
          profileLabel: lastAttemptedCameraSource?.profileLabel ?? null,
          selectedCameraId: lastAttemptedCameraSource?.selectedCameraId ?? null,
          constraints: lastAttemptedCameraSource?.constraints ?? null,
          sourceType: lastAttemptedCameraSource?.sourceType ?? null,
          message: normalizedCameraError.rawMessage || normalizedCameraError.detail,
          retryable: normalizedCameraError.retryable,
          stack: normalizedCameraError.stack,
        });
        console.error(SCAN_LOG_PREFIX, "scanner-start-failed-raw", error);
        await stopScanner("start-failed");

        if (!mountedRef.current) {
          return;
        }

        setCameraInitializing(false);
        setCameraReady(false);
        setCameraError({
          title: normalizedCameraError.title,
          detail: normalizedCameraError.detail,
        });
        setStatusMessage(normalizedCameraError.title);

        if (normalizedCameraError.retryable) {
          cameraRetryCountRef.current = retryAttempt;
          const retryDelayMs = Math.min(
            KIOSK_CAMERA_RETRY_BASE_MS * 2 ** Math.max(0, retryAttempt - 1),
            KIOSK_CAMERA_RETRY_MAX_MS,
          );

          clearCameraRecoveryTimer();
          cameraRecoveryTimerRef.current = window.setTimeout(() => {
            if (!mountedRef.current || scannerStartedRef.current || processingRef.current) {
              return;
            }

            logScanInfo("camera-retry-scheduled", {
              attempt: retryAttempt,
              errorKind: normalizedCameraError.kind,
              retryDelayMs,
            });
            void startScanner(`auto-retry:${normalizedCameraError.kind}`);
          }, retryDelayMs);
        }
      })
      .finally(() => {
        scannerStartPromiseRef.current = null;
        isStartingRef.current = false;
        if (!scannerStartedRef.current) {
          scannerRunningRef.current = false;
        }
      });

    scannerStartPromiseRef.current = startup;
    await startup;
  }, [
    applyPreferredTrackControls,
    applyScannerReadyState,
    chooseRearCameraSource,
    clearCameraRecoveryTimer,
    resolveScanBoxEdge,
    stopScanner,
  ]);

  const resumeScanner = useCallback(async (reason = "unspecified") => {
    if (!mountedRef.current || processingRef.current) {
      return;
    }

    const scanner = scannerRef.current;
    if (scanner && scannerStartedRef.current) {
      if (scannerPausedRef.current) {
        try {
          logScanInfo("scanner-resume-requested", { reason, mode: "paused" });
          scanner.resume();
          applyScannerReadyState(scanner, "resume");
          return;
        } catch (error) {
          logScanWarn("scanner-resume-failed", {
            reason,
            message: getReadableError(error, "Unable to resume the camera."),
          });
          await stopScanner("resume-failed");
        }
      } else {
        logScanInfo("scanner-resume-requested", { reason, mode: "already-running" });
        applyScannerReadyState(scanner, "reuse");
        return;
      }
    }

    await startScanner(`resume:${reason}`);
  }, [applyScannerReadyState, startScanner, stopScanner]);

  const refreshQueueState = useCallback(async () => {
    try {
      const [queueTotal, storedLastSyncAt] = await Promise.all([
        countAttendanceQueueEntries(),
        Promise.resolve(readLastAttendanceSyncAt()),
      ]);

      if (mountedRef.current) {
        setPendingCount(queueTotal);
        setLastSyncAt(storedLastSyncAt);
      }
    } catch {
      if (mountedRef.current) {
        setPendingCount(0);
        setLastSyncAt(readLastAttendanceSyncAt());
      }
    }
  }, []);

  const redirectToDeviceSetup = useCallback(
    async (message: string) => {
      if (bindingRedirectInFlightRef.current) {
        return;
      }

      bindingRedirectInFlightRef.current = true;
      writeDeviceSetupNotice(message || "Reconnect this kiosk to continue scanning.");
      clearStoredLibraryBinding();
      clearResetTimer();
      clearResetHoldTimer();
      clearCameraRecoveryTimer();
      clearKioskWatchdogTimer();
      setResetDialogOpen(false);
      setAdminPanelUnlocked(false);
      setResetError(null);
      setResetPin("");
      setStatusMessage("Reconnect required");

      try {
        await stopScanner();
      } finally {
        if (mountedRef.current) {
          navigate("/setup-device", { replace: true });
        }
      }
    },
    [
      clearCameraRecoveryTimer,
      clearKioskWatchdogTimer,
      clearResetHoldTimer,
      clearResetTimer,
      navigate,
      stopScanner,
    ],
  );

  const sendScannerHeartbeat = useCallback(async () => {
    if (!isOnlineRef.current || deviceHeartbeatInFlightRef.current || bindingRedirectInFlightRef.current) {
      return true;
    }

    const deviceLibraryId = readStoredLibraryId();
    const deviceLibraryAccessKey = readStoredLibraryAccessKey();
    if (!deviceLibraryId || !deviceLibraryAccessKey) {
      await redirectToDeviceSetup("Device setup is missing. Reconnect this kiosk.");
      return false;
    }

    deviceHeartbeatInFlightRef.current = true;

    try {
      const queueSize = await countAttendanceQueueEntries();
      const heartbeat = await sendDeviceHeartbeat({
        apiUrl: DEVICE_HEARTBEAT_API_URL,
        deviceId: DEVICE_ID,
        libraryId: deviceLibraryId,
        libraryAccessKey: deviceLibraryAccessKey,
        status: {
          appVersion: APP_VERSION,
          cameraReady: cameraReady && !cameraInitializing && !cameraError,
          deviceName: DEVICE_NAME,
          isOnline: isOnlineRef.current,
          lastSyncAt: readLastAttendanceSyncAt(),
          pendingCount: queueSize,
          phase,
        },
      });

      if (!heartbeat.valid) {
        await redirectToDeviceSetup(heartbeat.message || "Reconnect this kiosk to continue scanning.");
        return false;
      }

      return true;
    } catch {
      return true;
    } finally {
      deviceHeartbeatInFlightRef.current = false;
    }
  }, [cameraError, cameraInitializing, cameraReady, phase, redirectToDeviceSetup]);

  const processDeviceCommand = useCallback(
    async (command: DeviceCommandRecord, bindingSnapshot: { libraryAccessKey: string; libraryId: string }) => {
      const commandLabel = getDeviceCommandTypeLabel(command.command_type);
      const commandNotice = resolveDeviceCommandMessage(command);
      const updateStatus = async (status: "acknowledged" | "completed" | "failed", errorMessage?: string) => {
        try {
          await recordDeviceCommandStatus({
            commandId: command.id,
            deviceId: DEVICE_ID,
            deviceToken: SCAN_DEVICE_TOKEN,
            errorMessage,
            libraryAccessKey: bindingSnapshot.libraryAccessKey,
            libraryId: bindingSnapshot.libraryId,
            metadata: {
              processed_from: "scanner-agent",
              command_type: command.command_type,
            },
            status,
          });
        } catch {
          // Best effort only. Command delivery should still continue locally.
        }
      };

      if (mountedRef.current) {
        setStatusMessage(`Owner command received: ${commandLabel}`);
      }

      await updateStatus("acknowledged");

      try {
        switch (command.command_type) {
          case "disable_device":
          case "force_logout": {
            pauseScanner(true, "device-command-disable");
            await stopScanner().catch(() => undefined);
            await updateStatus("completed");
            await redirectToDeviceSetup(commandNotice);
            return "redirected" as const;
          }
          case "restart_scanner": {
            pauseScanner(true, "device-command-restart");
            await stopScanner().catch(() => undefined);
            await sleep(250);
            await startScanner("device-command-restart");
            await updateStatus("completed");
            await sendScannerHeartbeat();
            if (mountedRef.current) {
              setStatusMessage("Scanner restarted by owner");
            }
            return "continued" as const;
          }
          case "push_config_update": {
            await updateStatus("completed");
            if (mountedRef.current) {
              setStatusMessage("Refreshing device configuration");
            }
            window.setTimeout(() => {
              if (mountedRef.current) {
                window.location.reload();
              }
            }, 150);
            return "reloading" as const;
          }
          default: {
            await updateStatus("completed");
            return "continued" as const;
          }
        }
      } catch (error) {
        const message = getReadableError(error, `Unable to execute ${commandLabel.toLowerCase()}.`);
        await updateStatus("failed", message);
        if (mountedRef.current) {
          setStatusMessage(message);
        }
        return "failed" as const;
      }
    },
    [pauseScanner, redirectToDeviceSetup, sendScannerHeartbeat, startScanner, stopScanner],
  );

  const pollDeviceCommands = useCallback(async () => {
    if (!isOnlineRef.current || deviceCommandPollInFlightRef.current || bindingRedirectInFlightRef.current) {
      return;
    }

    const deviceLibraryId = readStoredLibraryId();
    const deviceLibraryAccessKey = readStoredLibraryAccessKey();
    if (!deviceLibraryId || !deviceLibraryAccessKey) {
      return;
    }

    deviceCommandPollInFlightRef.current = true;

    try {
      const commands = await pullDeviceCommands({
        deviceId: DEVICE_ID,
        deviceToken: SCAN_DEVICE_TOKEN,
        libraryAccessKey: deviceLibraryAccessKey,
        libraryId: deviceLibraryId,
        limit: 5,
      });

      for (const command of commands) {
        if (bindingRedirectInFlightRef.current) {
          break;
        }

        if (deviceCommandProcessingIdsRef.current.has(command.id)) {
          continue;
        }

        deviceCommandProcessingIdsRef.current.add(command.id);
        const result = await processDeviceCommand(command, {
          libraryAccessKey: deviceLibraryAccessKey,
          libraryId: deviceLibraryId,
        });

        if (result === "redirected" || result === "reloading") {
          break;
        }

        deviceCommandProcessingIdsRef.current.delete(command.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (
        message.includes("library access key") ||
        message.includes("device token") ||
        message.includes("device not found")
      ) {
        await redirectToDeviceSetup(
          "This kiosk lost its secure binding. Reconnect it from the setup screen.",
        );
      }
    } finally {
      deviceCommandPollInFlightRef.current = false;
    }
  }, [processDeviceCommand, redirectToDeviceSetup]);

  const syncQueuedScans = useCallback(async () => {
    if (!window.navigator.onLine || syncInFlightRef.current) {
      return;
    }

    let queueTotal = 0;
    try {
      queueTotal = await countAttendanceQueueEntries();
    } catch {
      if (mountedRef.current) {
        setStatusMessage("Queue unavailable");
      }
      return;
    }

    if (queueTotal === 0) {
      await refreshQueueState();
      return;
    }

    syncInFlightRef.current = true;
    if (mountedRef.current) {
      setIsSyncing(true);
    }

    try {
      await syncQueuedAttendance({
        scanApiUrl: SCAN_API_URL,
        deviceToken: SCAN_DEVICE_TOKEN,
      });
    } catch {
      if (mountedRef.current) {
        setStatusMessage("Sync postponed");
      }
    } finally {
      syncInFlightRef.current = false;
      if (mountedRef.current) {
        setIsSyncing(false);
      }

      await refreshQueueState();
      void sendScannerHeartbeat();
    }
  }, [refreshQueueState, sendScannerHeartbeat]);

  const submitScan = useCallback(
    async (entry: AttendanceQueueEntry) => {
      const payload = await submitAttendanceScan({
        entry,
        scanApiUrl: SCAN_API_URL,
        deviceToken: SCAN_DEVICE_TOKEN,
        timeoutMs: SCAN_SUBMIT_TIMEOUT_MS,
      });

      if (payload.status === "queued") {
        await refreshQueueState();
      }

      return payload;
    },
    [refreshQueueState],
  );

  const openResetDialog = useCallback(() => {
    clearResetHoldTimer();
    clearCameraRecoveryTimer();
    clearKioskWatchdogTimer();
    pauseScanner(true);
    setResetPin("");
    setResetError(null);
    setAdminPanelUnlocked(false);
    setResetDialogOpen(true);
  }, [clearCameraRecoveryTimer, clearKioskWatchdogTimer, clearResetHoldTimer, pauseScanner]);

  const closeResetDialog = useCallback(() => {
    clearResetHoldTimer();
    setResetDialogOpen(false);
    setResetPin("");
    setResetError(null);
    setAdminPanelUnlocked(false);
    void requestKioskFullscreen();
    void resumeScanner();
  }, [clearResetHoldTimer, requestKioskFullscreen, resumeScanner]);

  const beginResetHold = useCallback(() => {
    if (resetDialogOpen || processingRef.current) {
      return;
    }

    clearResetHoldTimer();
    resetHoldTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        openResetDialog();
      }
    }, 5000);
  }, [clearResetHoldTimer, openResetDialog, resetDialogOpen]);

  const handleResetSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const expectedPin = DEVICE_RESET_PIN.trim();
      if (!expectedPin) {
        setResetError("Admin PIN is not configured.");
        return;
      }

      if (resetPin.trim() !== expectedPin) {
        setResetError("Invalid admin PIN.");
        setResetPin("");
        return;
      }

      setAdminPanelUnlocked(true);
      setResetError(null);
      setResetPin("");
    },
    [resetPin],
  );

  const handleOpenAdminDashboard = useCallback(() => {
    clearResetHoldTimer();
    clearCameraRecoveryTimer();
    clearKioskWatchdogTimer();
    setResetDialogOpen(false);
    setResetPin("");
    setResetError(null);
    setAdminPanelUnlocked(false);
    void stopScanner().finally(() => {
      navigate("/dashboard", { replace: true });
    });
  }, [clearCameraRecoveryTimer, clearKioskWatchdogTimer, clearResetHoldTimer, navigate, stopScanner]);

  const handleResetDevice = useCallback(() => {
    clearStoredLibraryBinding();
    clearResetHoldTimer();
    clearCameraRecoveryTimer();
    clearKioskWatchdogTimer();
    setResetDialogOpen(false);
    setResetPin("");
    setResetError(null);
    setAdminPanelUnlocked(false);

    void stopScanner().finally(() => {
      navigate("/setup-device", { replace: true });
    });
  }, [clearCameraRecoveryTimer, clearKioskWatchdogTimer, clearResetHoldTimer, navigate, stopScanner]);

  const scheduleReturnToScanner = useCallback(() => {
    clearResetTimer();

    resetTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) {
        return;
      }

      setScanPayload(null);
      setPhase("idle");

      if (cameraError) {
        setStatusMessage("Camera unavailable");
        return;
      }

      if (!isOnlineRef.current) {
        setStatusMessage("Offline queue ready");
        if (scannerPausedRef.current) {
          void resumeScanner("result-hold-complete-offline");
        }
        return;
      }

      setStatusMessage("Ready to scan");
      if (scannerPausedRef.current) {
        void resumeScanner("result-hold-complete");
      }
    }, RESULT_HOLD_MS);
  }, [cameraError, clearResetTimer, resumeScanner]);

  const handleRetryCamera = useCallback(() => {
    clearCameraRecoveryTimer();
    cameraStartFailureLockedRef.current = false;
    scannerRunningRef.current = false;
    setCameraError(null);
    setStatusMessage("Starting camera...");
    void stopScanner("manual-retry")
      .catch(() => undefined)
      .finally(() => {
        void startScanner("manual-retry");
      });
  }, [clearCameraRecoveryTimer, startScanner, stopScanner]);

  const buildOfflineQueuedPayload = useCallback(
    ({
      entry,
      libraryId,
      studentId,
      parsedSource,
      fallbackMessage,
    }: {
      entry: AttendanceQueueEntry;
      libraryId: string;
      studentId: string;
      parsedSource: "legacy" | "structured" | "signed";
      fallbackMessage?: string;
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
        time: formatScanTimeLabel(entry.timestamp),
        entry_id: entry.entry_id,
        ...(verifiedOffline ? { verifiedOffline: true } : {}),
        ...(cachedName ? { name: cachedName, studentName: cachedName } : {}),
        ...(cachedStudent?.seat ? { seat: cachedStudent.seat } : {}),
      };
    },
    [],
  );

  const recoverScannerFromWatchdog = useCallback(
    async (reason: WatchdogRecoveryReason) => {
      const nowTs = Date.now();
      if (nowTs - lastWatchdogRecoveryAtRef.current < WATCHDOG_RECOVERY_COOLDOWN_MS) {
        return;
      }

      lastWatchdogRecoveryAtRef.current = nowTs;
      logScanWarn("watchdog-trigger", {
        reason,
        phase,
        processing: processingRef.current,
        started: scannerStartedRef.current,
        paused: scannerPausedRef.current,
        lastFrameAgeMs: lastFrameSeenAtRef.current ? nowTs - lastFrameSeenAtRef.current : null,
      });

      if (reason === "scan_verification_stalled") {
        invalidateActiveScan(reason);
        clearProcessingUnlockTimer();
        processingRef.current = false;
        scanProcessingStartedAtRef.current = 0;

        if (mountedRef.current) {
          setScanPayload({
            status: "error",
            code: "SCAN_TIMEOUT",
            message: "Scanner recovered after a stalled verification. Please scan again.",
          });
          setPhase("error");
          setStatusMessage("Scanner recovered. Please scan again.");
        }

        scheduleReturnToScanner();
        return;
      }

      invalidateActiveScan(reason);
      clearProcessingUnlockTimer();
      processingRef.current = false;
      scanProcessingStartedAtRef.current = 0;

      if (mountedRef.current) {
        setStatusMessage("Recovering camera...");
        setCameraReady(false);
        setCameraInitializing(true);
        setCameraError(null);
      }

      await stopScanner(`watchdog:${reason}`);

      if (mountedRef.current && !resetDialogOpen && !bindingRedirectInFlightRef.current) {
        await startScanner(`watchdog:${reason}`);
      }
    },
    [
      clearProcessingUnlockTimer,
      invalidateActiveScan,
      phase,
      resetDialogOpen,
      scheduleReturnToScanner,
      startScanner,
      stopScanner,
    ],
  );

  const handleScanResult = useCallback(
    async (rawValue: string, detectionSource: ScanDetectionSource) => {
      let returnToIdleScheduled = false;
      let processingLockHandled = false;
      let scanRunId = 0;
      const normalizedRawValue = trimText(rawValue);
      const detectionMeta = normalizedRawValue
        ? resolveDetectionMetaForRawValue(normalizedRawValue, detectionSource)
        : null;
      let metricRecorded = false;
      const recordMetric = (status: ScanLatencyMetric["status"], verificationMs: number | null = null) => {
        if (metricRecorded || !detectionMeta) {
          return;
        }

        metricRecorded = true;
        publishScanMetric({
          status,
          detectionSource: detectionMeta.detectionSource,
          decodeMs: detectionMeta.decodeMs,
          verificationMs,
          totalMs: Math.max(0, Date.now() - detectionMeta.detectedAtMs),
          captureEdge: detectionMeta.captureEdge,
          intervalMs: detectionMeta.intervalMs,
          brightness: detectionMeta.brightness,
          edgeScore: detectionMeta.edgeScore,
          lowLight: detectionMeta.lowLight,
          cameraProfileLabel: detectionMeta.cameraProfileLabel,
          deviceTier: detectionMeta.deviceTier,
          recordedAt: new Date().toISOString(),
        });
      };

      const isActiveScan = () => scanRunId > 0 && activeScanRunIdRef.current === scanRunId;
      const releaseScanLockNow = (reason: string) => {
        if (processingLockHandled || scanRunId === 0) {
          return;
        }

        processingLockHandled = true;
        releaseProcessingLock(scanRunId, reason);
      };
      const releaseScanLockSoon = (reason: string, delayMs = SCAN_PROCESSING_UNLOCK_DELAY_MS) => {
        if (processingLockHandled || scanRunId === 0) {
          return;
        }

        processingLockHandled = true;
        scheduleProcessingUnlock(scanRunId, reason, delayMs);
      };

      try {
        if (processingRef.current) {
          return;
        }

        if (!normalizedRawValue) {
          return;
        }

        clearResetTimer();
        clearProcessingUnlockTimer();
        processingRef.current = true;
        scanRunId = activeScanRunIdRef.current + 1;
        activeScanRunIdRef.current = scanRunId;
        scanProcessingStartedAtRef.current = 0;
        logScanInfo("scan-processing-start", {
          scanRunId,
          source: detectionSource,
          length: normalizedRawValue.length,
          preview: summarizeQrForLog(normalizedRawValue),
        });

        const showScanError = async (code: string, message: string) => {
          if (!isActiveScan() || !mountedRef.current) {
            return;
          }

          setScanPayload({
            status: "error",
            code,
            message,
          });
          setPhase("error");
          setStatusMessage(message);
          logScanWarn("scan-processing-error", {
            scanRunId,
            code,
            source: detectionSource,
            message,
          });
          recordMetric(code === "INVALID_QR" ? "invalid" : "error");
          vibrateFeedback([28, 60, 22]);
          await playFeedbackTone("error");
          scheduleReturnToScanner();
          returnToIdleScheduled = true;
          releaseScanLockSoon(`scan-error:${code}`);
        };

        const parsed = await parseStudentQrPayload(normalizedRawValue, {
          expectedLibraryId: readStoredLibraryId(),
          allowLegacy: true,
          publicKeyPem: STUDENT_QR_PUBLIC_KEY,
          now: new Date(),
        });

        if (!isActiveScan() || !mountedRef.current) {
          return;
        }

        if (!parsed) {
          await showScanError("INVALID_QR", "Invalid ID.");
          return;
        }

        const deviceLibraryId = readStoredLibraryId();
        const deviceLibraryAccessKey = readStoredLibraryAccessKey();
        if (!deviceLibraryId || !deviceLibraryAccessKey) {
          await showScanError("DEVICE_BLOCKED", "Device not set up.");
          return;
        }

        if (!parsed.valid) {
          await showScanError(parsed.code, parsed.message);
          return;
        }

        const scanIdentifier = parsed.source === "legacy" ? parsed.qrCode : parsed.studentId;
        if (!scanIdentifier) {
          await showScanError("INVALID_QR", "Invalid ID.");
          return;
        }

        const nowTs = Date.now();
        const recentScanKey = `${deviceLibraryId}:${scanIdentifier}`;
        if (wasRecentAcceptedScan(recentScanKey, nowTs)) {
          logScanInfo("scan-duplicate-ignored", {
            scanRunId,
            source: detectionSource,
            scanIdentifier,
            windowMs: DUPLICATE_SCAN_WINDOW_MS,
          });
          recordMetric("duplicate", 0);
          releaseScanLockNow("duplicate-scan");
          return;
        }

        rememberAcceptedScan(recentScanKey, nowTs);
        const scanTimestamp = new Date().toISOString();
        const scanEntry = createAttendanceQueueEntry({
          deviceId: DEVICE_ID,
          studentId: scanIdentifier,
          libraryId: deviceLibraryId,
          libraryAccessKey: deviceLibraryAccessKey,
          qrCode: parsed.rawValue,
          timestamp: scanTimestamp,
        });

        triggerScanFeedback();
        void playFeedbackTone("detect");
        vibrateFeedback(18);
        setScanPayload(null);
        setPhase("scanning");
        setStatusMessage(isOnlineRef.current ? "Verifying attendance..." : "Saving offline...");
        scanProcessingStartedAtRef.current = Date.now();
        logScanInfo("scan-submit", {
          scanRunId,
          source: detectionSource,
          entryId: scanEntry.entry_id,
          scanIdentifier,
          online: isOnlineRef.current,
        });

        let shouldReturnToScanner = true;
        try {
          let payload: AttendanceScanPayload;

          if (!isOnlineRef.current) {
            await enqueueAttendanceQueueEntry(scanEntry);
            payload = buildOfflineQueuedPayload({
              entry: scanEntry,
              libraryId: deviceLibraryId,
              studentId: scanIdentifier,
              parsedSource: parsed.source,
            });
            await refreshQueueState();
          } else {
            payload = await submitScan(scanEntry);

            if (payload.status === "queued") {
              payload = buildOfflineQueuedPayload({
                entry: scanEntry,
                libraryId: deviceLibraryId,
                studentId: scanIdentifier,
                parsedSource: parsed.source,
                fallbackMessage: payload.message,
              });
            }
          }

          if (!isActiveScan() || !mountedRef.current) {
            return;
          }

          const verificationMs =
            scanProcessingStartedAtRef.current > 0 ? Math.max(0, Date.now() - scanProcessingStartedAtRef.current) : 0;
          scanProcessingStartedAtRef.current = 0;
          setScanPayload(payload);
          logScanInfo("scan-submit-result", {
            scanRunId,
            status: payload.status,
            code: "code" in payload ? payload.code ?? null : null,
          });

          if (payload.status === "success") {
            rememberOfflineVerifiedStudent({
              libraryId: deviceLibraryId,
              studentId: scanIdentifier,
              name: payload.studentName || payload.name,
              seat: payload.seat,
              verifiedAt: scanTimestamp,
            });
            setPhase("success");
            recordMetric("success", verificationMs);
            vibrateFeedback([22, 40, 16]);
            await playFeedbackTone("success");
          } else if (payload.status === "queued") {
            setPhase("queued");
            recordMetric("queued", verificationMs);
            vibrateFeedback([22, 40, 16]);
            await playFeedbackTone("success");
          } else {
            setPhase("error");
            recordMetric("error", verificationMs);
            vibrateFeedback([28, 60, 22]);
            await playFeedbackTone("error");

            if (payload.code && DEVICE_BINDING_RESET_CODES.has(payload.code)) {
              shouldReturnToScanner = false;
              returnToIdleScheduled = true;
              releaseScanLockNow("device-binding-reset");
              await sleep(900);

              if (!isActiveScan()) {
                return;
              }

              await redirectToDeviceSetup(
                payload.message || "Library credentials changed. Reconnect this kiosk.",
              );
            }
          }
        } catch (error) {
          if (!isActiveScan() || !mountedRef.current) {
            return;
          }

          const message = getReadableError(error);
          setScanPayload({
            status: "error",
            message,
          });
          setPhase("error");
          setStatusMessage(message);
          logScanWarn("scan-submit-failed", {
            scanRunId,
            source: detectionSource,
            message,
          });
          recordMetric("error");
          vibrateFeedback([28, 60, 22]);
          await playFeedbackTone("error");
          scheduleReturnToScanner();
          returnToIdleScheduled = true;
          shouldReturnToScanner = false;
          releaseScanLockSoon("scan-submit-failed");
        }

        if (shouldReturnToScanner && isActiveScan()) {
          scheduleReturnToScanner();
          returnToIdleScheduled = true;
          releaseScanLockSoon("scan-complete");
        }
      } catch (error) {
        const message = getReadableError(error);
        setScanPayload({
          status: "error",
          message,
        });
        setPhase("error");
        setStatusMessage(message);
        logScanWarn("scan-processing-failed", {
          scanRunId: scanRunId || null,
          source: detectionSource,
          message,
        });
        recordMetric("error");
        vibrateFeedback([28, 60, 22]);
        await playFeedbackTone("error");
        scheduleReturnToScanner();
        returnToIdleScheduled = true;
        releaseScanLockSoon("scan-processing-failed");
      } finally {
        if (!processingLockHandled) {
          const scanStillActive = scanRunId > 0 && activeScanRunIdRef.current === scanRunId;
          if (scanStillActive || scanRunId === 0) {
            releaseProcessingLock(
              scanRunId,
              returnToIdleScheduled ? "scan-cycle-waiting-for-idle-reset" : "scan-cycle-finalized",
            );
          }
        }
      }
    },
    [
      buildOfflineQueuedPayload,
      clearProcessingUnlockTimer,
      clearResetTimer,
      playFeedbackTone,
      publishScanMetric,
      refreshQueueState,
      releaseProcessingLock,
      redirectToDeviceSetup,
      rememberAcceptedScan,
      resolveDetectionMetaForRawValue,
      scheduleProcessingUnlock,
      scheduleReturnToScanner,
      submitScan,
      triggerScanFeedback,
      vibrateFeedback,
      wasRecentAcceptedScan,
    ],
  );

  handleScanResultRef.current = handleScanResult;

  useEffect(() => {
    const isCameraLive = cameraReady && !cameraInitializing && !cameraError;

    if (!isCameraLive || cameraError || phase === "scanning" || showResultOverlay) {
      clearScanAssistTimer();
      setPartialDetectionActive(false);

      if (!showResultOverlay) {
        setLightingHint(null);
        setGuidanceHint(DEFAULT_GUIDANCE_HINT);
      }

      return;
    }

    const runAnalysis = () => {
      try {
        const frame = analyzePreviewFrame();
        if (!mountedRef.current) {
          return;
        }

        if (!frame) {
          scanAssistTimerRef.current = window.setTimeout(runAnalysis, SCAN_ASSIST_INTERVAL_MS);
          return;
        }

        const lowLight =
          frame.brightness < 80 ||
          frame.shadowRatio > 0.42 ||
          (frame.brightness < 98 && frame.shadowRatio > 0.34);
        const glare = frame.brightness > 212 || frame.glareRatio > 0.22;
        const partialDetection = !lowLight && !glare && frame.edgeScore > 28;
        const needsCloserDistance = !lowLight && !glare && frame.edgeScore < 13;
        const needsSteadierHands = !lowLight && !glare && frame.edgeScore >= 13 && frame.edgeScore < 21;
        const needsAngleAdjustment = !lowLight && !glare && frame.edgeScore >= 21 && frame.edgeScore < 28;
        const lightingMessage = lowLight
          ? torchSupported
            ? "Low light detected - turn on torch"
            : "Low light detected - improve lighting"
          : glare
            ? "Reduce screen glare"
            : null;
        const elapsedSinceReady = Date.now() - scannerReadyAtRef.current;
        recentFrameSignalRef.current = {
          brightness: frame.brightness,
          edgeScore: frame.edgeScore,
          lowLight,
          glare,
          partialDetection,
          at: Date.now(),
        };
        lowLightStreakRef.current = lowLight ? Math.min(lowLightStreakRef.current + 1, 12) : 0;
        partialDetectionStreakRef.current = partialDetection
          ? Math.min(partialDetectionStreakRef.current + 1, 12)
          : 0;

        let nextGuidance = DEFAULT_GUIDANCE_HINT;
        if (lightingMessage) {
          nextGuidance = lightingMessage;
        } else if (needsCloserDistance) {
          nextGuidance = "Move closer";
        } else if (needsSteadierHands) {
          nextGuidance = "Hold steady";
        } else if (needsAngleAdjustment) {
          nextGuidance = "Adjust angle";
        } else if (partialDetection) {
          nextGuidance = "Align QR inside frame";
        } else if (elapsedSinceReady > GUIDANCE_ROTATION_MS) {
          const guidanceIndex =
            Math.floor((elapsedSinceReady - GUIDANCE_ROTATION_MS) / GUIDANCE_ROTATION_MS) %
            GUIDANCE_ROTATION.length;
          nextGuidance = GUIDANCE_ROTATION[guidanceIndex];
        }

        setLightingHint((current) => (current === lightingMessage ? current : lightingMessage));
        setPartialDetectionActive((current) =>
          current === partialDetection ? current : partialDetection,
        );
        setGuidanceHint((current) => (current === nextGuidance ? current : nextGuidance));
      } catch {
        if (mountedRef.current) {
          setLightingHint(null);
          setPartialDetectionActive(false);
        }
      } finally {
        if (mountedRef.current) {
          scanAssistTimerRef.current = window.setTimeout(runAnalysis, SCAN_ASSIST_INTERVAL_MS);
        }
      }
    };

    runAnalysis();

    return () => {
      clearScanAssistTimer();
    };
  }, [
    analyzePreviewFrame,
    cameraError,
    cameraInitializing,
    cameraReady,
    clearScanAssistTimer,
    phase,
    showResultOverlay,
    torchSupported,
  ]);

  useEffect(() => {
    const markGestureReady = () => {
      if (fullscreenGestureReadyRef.current) {
        return;
      }

      fullscreenGestureReadyRef.current = true;
      void requestKioskFullscreen();
    };

    window.addEventListener("pointerdown", markGestureReady, { passive: true });
    window.addEventListener("keydown", markGestureReady);

    return () => {
      window.removeEventListener("pointerdown", markGestureReady);
      window.removeEventListener("keydown", markGestureReady);
    };
  }, [requestKioskFullscreen]);

  useEffect(() => {
    mountedRef.current = true;
    bindingRedirectInFlightRef.current = false;

    const initializeKiosk = async () => {
      await refreshQueueState();
      void requestKioskFullscreen();

      const cameraStartup = startScanner("initial-mount");
      if (window.navigator.onLine) {
        void sendScannerHeartbeat();
      }

      await cameraStartup;
    };

    void initializeKiosk().catch(() => undefined);

    return () => {
      mountedRef.current = false;
      clearResetTimer();
      clearProcessingUnlockTimer();
      clearFeedbackTimers();
      clearScanAssistTimer();
      clearFallbackScanFrame();
      clearFullscreenRetryTimer();
      clearCameraRecoveryTimer();
      clearKioskWatchdogTimer();
      void stopScanner();
      terminateScanWorker();
      void releaseWakeLock();
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, [
    clearFeedbackTimers,
    clearCameraRecoveryTimer,
    clearFallbackScanFrame,
    clearFullscreenRetryTimer,
    clearProcessingUnlockTimer,
    clearResetTimer,
    clearScanAssistTimer,
    clearKioskWatchdogTimer,
    requestKioskFullscreen,
    releaseWakeLock,
    refreshQueueState,
    sendScannerHeartbeat,
    startScanner,
    stopScanner,
    terminateScanWorker,
  ]);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    if (isOnline) {
      void sendScannerHeartbeat();
      void syncQueuedScans();
    }
  }, [isOnline, sendScannerHeartbeat, syncQueuedScans]);

  useEffect(() => {
    if (!isOnline) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void sendScannerHeartbeat();
    }, DEVICE_HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOnline, sendScannerHeartbeat]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    void acquireWakeLock();
    void requestKioskFullscreen();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestKioskFullscreen();
        void acquireWakeLock();
        void sendScannerHeartbeat();
        if (ENABLE_DEVICE_COMMANDS) {
          void pollDeviceCommands();
        }
        if (!showResultOverlay && !processingRef.current) {
          if (cameraError || !scannerRef.current || !cameraReady) {
            void startScanner("tab-visible");
          } else {
            void resumeScanner("tab-visible");
          }
        }
      } else {
        void stopScanner("tab-hidden");
        void releaseWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [
    acquireWakeLock,
    cameraError,
    cameraReady,
    releaseWakeLock,
    requestKioskFullscreen,
    pollDeviceCommands,
    resumeScanner,
    sendScannerHeartbeat,
    showResultOverlay,
    startScanner,
    stopScanner,
  ]);

  useEffect(() => {
    let cancelled = false;
    let retryCount = 0;

    const attemptFullscreen = async () => {
      if (cancelled || document.fullscreenElement) {
        clearFullscreenRetryTimer();
        return;
      }

      await requestKioskFullscreen();

      if (cancelled || document.fullscreenElement) {
        clearFullscreenRetryTimer();
        return;
      }

      retryCount += 1;
      if (retryCount >= 4) {
        return;
      }

      clearFullscreenRetryTimer();
      fullscreenRetryTimerRef.current = window.setTimeout(() => {
        if (!cancelled) {
          void attemptFullscreen();
        }
      }, KIOSK_FULLSCREEN_RETRY_MS);
    };

    void attemptFullscreen().catch(() => undefined);

    return () => {
      cancelled = true;
      clearFullscreenRetryTimer();
    };
  }, [clearFullscreenRetryTimer, requestKioskFullscreen]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void sendScannerHeartbeat();
      if (ENABLE_DEVICE_COMMANDS) {
        void pollDeviceCommands();
      }
      if (!showResultOverlay && !processingRef.current) {
        setPhase("idle");
        setStatusMessage("Ready to scan");
        void resumeScanner("network-online");
      } else if (!scannerRef.current || cameraError) {
        void startScanner("network-online");
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      if (!showResultOverlay && !processingRef.current) {
        setPhase("idle");
        setStatusMessage("Offline queue ready");
        void resumeScanner("network-offline");
      }
      setStatusMessage("Offline queue ready");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [cameraError, pollDeviceCommands, resumeScanner, sendScannerHeartbeat, showResultOverlay, startScanner]);

  useEffect(() => {
    if (!ENABLE_DEVICE_COMMANDS) {
      return undefined;
    }

    void pollDeviceCommands();

    const intervalId = window.setInterval(() => {
      void pollDeviceCommands();
    }, DEVICE_COMMAND_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pollDeviceCommands]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        clearFullscreenRetryTimer();
        fullscreenRetryTimerRef.current = window.setTimeout(() => {
          if (mountedRef.current) {
            void requestKioskFullscreen();
          }
        }, KIOSK_FULLSCREEN_RETRY_MS);
      } else {
        clearFullscreenRetryTimer();
      }
    };

    const preventTouchGesture = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    const preventTouchMove = (event: TouchEvent) => {
      event.preventDefault();
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("touchstart", preventTouchGesture, { passive: false });
    document.addEventListener("touchmove", preventTouchMove, { passive: false });

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("touchstart", preventTouchGesture);
      document.removeEventListener("touchmove", preventTouchMove);
      clearFullscreenRetryTimer();
    };
  }, [clearFullscreenRetryTimer, requestKioskFullscreen]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const recentSignal = recentFrameSignalRef.current;
      if (
        !mountedRef.current ||
        processingRef.current ||
        scannerPausedRef.current ||
        !scannerStartedRef.current ||
        slowScanStreakRef.current < ADAPTIVE_PROFILE_SLOW_STREAK_LIMIT ||
        Boolean(recentSignal?.lowLight) ||
        Boolean(recentSignal?.partialDetection) ||
        cameraProfileIndexRef.current >= CAMERA_PROFILES.length - 1
      ) {
        return;
      }

      const nowTs = Date.now();
      if (nowTs - lastAdaptiveProfileChangeAtRef.current < ADAPTIVE_PROFILE_CHANGE_COOLDOWN_MS) {
        return;
      }

      const nextProfileIndex = Math.min(cameraProfileIndexRef.current + 1, CAMERA_PROFILES.length - 1);
      if (nextProfileIndex === cameraProfileIndexRef.current) {
        slowScanStreakRef.current = 0;
        return;
      }

      cameraProfileIndexRef.current = nextProfileIndex;
      lastAdaptiveProfileChangeAtRef.current = nowTs;
      slowScanStreakRef.current = 0;
      logScanWarn("adaptive-profile-downgrade", {
        nextProfile: CAMERA_PROFILES[nextProfileIndex]?.label ?? null,
      });

      void stopScanner("adaptive-profile-downgrade")
        .then(() => startScanner("adaptive-profile-downgrade"))
        .catch(() => undefined);
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [startScanner, stopScanner]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const baselineProfileIndex = getDefaultCameraProfileIndex();
      const recentSignal = recentFrameSignalRef.current;
      if (
        !mountedRef.current ||
        processingRef.current ||
        scannerPausedRef.current ||
        !scannerStartedRef.current ||
        fastScanStreakRef.current < ADAPTIVE_PROFILE_FAST_STREAK_LIMIT ||
        cameraProfileIndexRef.current <= baselineProfileIndex ||
        Boolean(recentSignal?.lowLight) ||
        Boolean(recentSignal?.partialDetection)
      ) {
        return;
      }

      const nowTs = Date.now();
      if (nowTs - lastAdaptiveProfileChangeAtRef.current < ADAPTIVE_PROFILE_UPGRADE_COOLDOWN_MS) {
        return;
      }

      const nextProfileIndex = Math.max(baselineProfileIndex, cameraProfileIndexRef.current - 1);
      if (nextProfileIndex === cameraProfileIndexRef.current) {
        fastScanStreakRef.current = 0;
        return;
      }

      cameraProfileIndexRef.current = nextProfileIndex;
      lastAdaptiveProfileChangeAtRef.current = nowTs;
      fastScanStreakRef.current = 0;
      logScanInfo("adaptive-profile-upgrade", {
        nextProfile: CAMERA_PROFILES[nextProfileIndex]?.label ?? null,
      });

      void stopScanner("adaptive-profile-upgrade")
        .then(() => startScanner("adaptive-profile-upgrade"))
        .catch(() => undefined);
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [startScanner, stopScanner]);

  useEffect(() => {
    if (resetDialogOpen || bindingRedirectInFlightRef.current) {
      clearKioskWatchdogTimer();
      return;
    }

    clearKioskWatchdogTimer();
    kioskWatchdogTimerRef.current = window.setInterval(() => {
      if (!mountedRef.current) {
        return;
      }

      const nowTs = Date.now();
      const activeTrack = getScannerMediaTrack();

      if (
        scannerStartedRef.current &&
        activeTrack &&
        activeTrack.readyState !== "live"
      ) {
        void recoverScannerFromWatchdog("camera_stream_lost");
        return;
      }

      if (
        scannerStartedRef.current &&
        !scannerPausedRef.current &&
        !processingRef.current &&
        lastFrameSeenAtRef.current > 0 &&
        nowTs - lastFrameSeenAtRef.current >= WATCHDOG_NO_FRAME_STALL_MS
      ) {
        void recoverScannerFromWatchdog("no_frames");
        return;
      }

      if (
        processingRef.current &&
        scanProcessingStartedAtRef.current > 0 &&
        nowTs - scanProcessingStartedAtRef.current >= WATCHDOG_SCAN_VERIFICATION_STALL_MS
      ) {
        void recoverScannerFromWatchdog("scan_verification_stalled");
      }
    }, WATCHDOG_POLL_INTERVAL_MS);

    return () => {
      clearKioskWatchdogTimer();
    };
  }, [clearKioskWatchdogTimer, getScannerMediaTrack, recoverScannerFromWatchdog, resetDialogOpen]);

  useEffect(() => {
    const previousTitle = document.title;
    const previousBodyClass = document.body.className;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const previousThemeColor = themeMeta?.getAttribute("content");
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    const previousViewport = viewportMeta?.getAttribute("content");
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const previousManifest = manifestLink?.getAttribute("href");
    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const previousAppleTitle = appleTitleMeta?.getAttribute("content");

    document.title = "Libriofy ID Check-In";
    document.body.classList.add("kiosk-mode");
    themeMeta?.setAttribute("content", "#05060f");
    viewportMeta?.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, viewport-fit=cover, user-scalable=no",
    );
    manifestLink?.setAttribute("href", withBase("scan-manifest.webmanifest"));
    appleTitleMeta?.setAttribute("content", "ID Check-In");

    return () => {
      document.title = previousTitle;
      document.body.className = previousBodyClass;

      if (previousThemeColor) {
        themeMeta?.setAttribute("content", previousThemeColor);
      }

      if (previousViewport) {
        viewportMeta?.setAttribute("content", previousViewport);
      }

      if (previousManifest) {
        manifestLink?.setAttribute("href", previousManifest);
      }

      if (previousAppleTitle) {
        appleTitleMeta?.setAttribute("content", previousAppleTitle);
      }
    };
  }, []);

  useEffect(() => {
    window.history.pushState({ kiosk: true }, "", window.location.href);

    const handlePopState = () => {
      window.history.pushState({ kiosk: true }, "", window.location.href);
    };

    const preventGesture = (event: Event) => event.preventDefault();
    const preventMultiTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    window.addEventListener("popstate", handlePopState);
    document.addEventListener("contextmenu", preventGesture);
    document.addEventListener("gesturestart", preventGesture);
    document.addEventListener("touchstart", preventMultiTouch, { passive: false });

    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("contextmenu", preventGesture);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("touchstart", preventMultiTouch);
    };
  }, []);

  useEffect(() => {
    (window as Window & { __LIBRIOFY_SCAN_METRICS__?: ScanMetricsSnapshot }).__LIBRIOFY_SCAN_METRICS__ =
      scanMetricsSnapshot;
  }, [scanMetricsSnapshot]);

  const cameraLive = cameraReady && !cameraInitializing && !cameraError;
  const liveAssistHint = lightingHint ?? guidanceHint;
  const scanDebugSummary = scanMetricsSnapshot.total
    ? [
        `tier ${deviceTier}`,
        `avg decode ${scanMetricsSnapshot.avgDecodeMs}ms`,
        scanMetricsSnapshot.avgVerifyMs !== null ? `avg verify ${scanMetricsSnapshot.avgVerifyMs}ms` : null,
        scanMetricsSnapshot.avgTotalMs !== null ? `avg total ${scanMetricsSnapshot.avgTotalMs}ms` : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" • ")
    : `tier ${deviceTier} • waiting for scans`;
  const lastScanDebugDetails =
    scanMetricsSnapshot.lastCaptureEdge !== null && scanMetricsSnapshot.lastIntervalMs !== null
      ? `ROI ${scanMetricsSnapshot.lastCaptureEdge}px • loop ${scanMetricsSnapshot.lastIntervalMs}ms • ${scanMetricsSnapshot.lastCameraProfileLabel ?? cameraProfileLabel}`
      : `Profile ${cameraProfileLabel}`;
  const frameStatusLabel =
    cameraError?.title ?? (partialDetectionActive && phase === "idle" ? "Hold steady" : statusMessage);
  const framePrompt = cameraError
    ? cameraError.detail
    : !isOnline
      ? "Offline queue mode active"
      : phase === "scanning"
        ? "Verifying the QR..."
        : cameraInitializing
          ? "Please allow camera permission if prompted."
          : liveAssistHint;
  const formattedLastSyncAt = useMemo(() => {
    if (!lastSyncAt) {
      return null;
    }

    const parsedDate = new Date(lastSyncAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    }).format(parsedDate);
  }, [lastSyncAt]);
  const hasResult = Boolean(scanPayload) && showResultOverlay;
  const isSuccess = scanPayload?.status === "success";
  const isQueued = scanPayload?.status === "queued";
  const isError = scanPayload?.status === "error";
  const resultName =
    scanPayload && scanPayload.status === "success"
      ? scanPayload.studentName || scanPayload.name || "Student"
      : scanPayload?.status === "queued"
        ? scanPayload.studentName || scanPayload.name || "Queued scan"
        : null;
  const actionLabel =
    scanPayload && scanPayload.status === "success"
      ? scanPayload.action === "check-in"
        ? "Checked In"
        : "Checked Out"
      : null;
  const statusLabel = !isOnline
    ? "Offline"
    : cameraError
      ? "Camera Error"
      : cameraInitializing
        ? "Starting..."
        : phase === "scanning"
          ? "Scanning..."
          : "Camera Active";
  const statusToneClass = !isOnline || cameraError ? "text-rose-300" : "text-emerald-300";
  const frameGlowClass = isSuccess
    ? "shadow-[0_0_70px_18px_rgba(34,197,94,0.35)]"
    : isError
      ? "shadow-[0_0_70px_18px_rgba(239,68,68,0.35)]"
      : "shadow-[0_0_70px_18px_rgba(99,102,241,0.25)]";
  const frameBorderClass = isSuccess
    ? "border-emerald-300/80"
    : isError
      ? "border-rose-300/80"
      : "border-indigo-300/60";
  const instructionText =
    !cameraError && isOnline && phase === "idle" && !hasResult
      ? "Place your QR code inside the frame"
      : framePrompt;
  const mobileInlineNotice = !cameraError && isOnline ? lightingHint : null;
  const [mobileTransientNotice, setMobileTransientNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!mobileInlineNotice) {
      clearMobileNoticeTimer();
      setMobileTransientNotice(null);
      return;
    }

    setMobileTransientNotice(mobileInlineNotice);
    clearMobileNoticeTimer();
    mobileNoticeTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        setMobileTransientNotice(null);
      }
    }, 3200);

    return () => {
      clearMobileNoticeTimer();
    };
  }, [clearMobileNoticeTimer, mobileInlineNotice]);

  useEffect(() => {
    return () => {
      clearResetHoldTimer();
    };
  }, [clearResetHoldTimer]);

  return (
    <main
      className="relative min-h-[100dvh] overflow-hidden bg-[#05060f] text-white touch-none overscroll-none"
      style={{ fontFamily: "'Sora', system-ui, sans-serif" }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(99,102,241,0.18),transparent_40%),radial-gradient(circle_at_50%_100%,rgba(2,6,23,0.85),transparent_70%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.2),rgba(2,6,23,0.72)_55%,rgba(3,5,18,0.96)_100%)]" />
      <div className="absolute inset-0 opacity-25">
        <FloatingParticles />
      </div>
      <button
        type="button"
        aria-label="Hidden device reset"
        className="absolute right-0 top-0 z-40 h-24 w-24 cursor-default bg-transparent opacity-0 outline-none"
        tabIndex={-1}
        onPointerDown={beginResetHold}
        onPointerUp={clearResetHoldTimer}
        onPointerLeave={clearResetHoldTimer}
        onPointerCancel={clearResetHoldTimer}
      />
      <AnimatePresence>
        {scanFlashVisible ? (
          <motion.div
            className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle,rgba(255,255,255,0.42),rgba(255,255,255,0.12)_36%,transparent_72%)] mix-blend-screen"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          />
        ) : null}
      </AnimatePresence>


      <div className="relative z-10 flex min-h-[100dvh] w-full flex-col items-center justify-center px-4 py-16">
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold tracking-wide text-white/85">Libriofy</span>
          <div className="flex items-center gap-2">
            {isOnline ? <Wifi className="h-4 w-4 text-emerald-300" /> : <WifiOff className="h-4 w-4 text-rose-300" />}
            <span className={cn("text-xs font-medium", statusToneClass)}>{statusLabel}</span>
          </div>
        </div>

        <div className="relative flex flex-col items-center gap-6">
          <div className={cn("absolute -inset-8 rounded-[36px] blur-3xl", frameGlowClass)} />
          <div
            className={cn(
              "relative w-[320px] rounded-3xl border border-white/10 bg-[#0b1124]/95 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.55)] transition-transform duration-300 sm:w-[360px]",
              frameReactionActive ? "scale-[1.01]" : "scale-100",
            )}
          >
            <div className="relative mx-auto flex items-center justify-center" style={{ width: scanBoxEdge, height: scanBoxEdge }}>
              <div className={cn("absolute -inset-[2px] rounded-[1.35rem] border", frameBorderClass)} />
              <div className="absolute inset-0 overflow-hidden rounded-[1.2rem] bg-black">
                <div
                  id={SCANNER_REGION_ID}
                  className={cn(
                    "absolute inset-0 transition-opacity duration-200 [&_video]:h-full [&_video]:w-full [&_video]:object-cover [&>div]:hidden",
                    cameraLive ? "opacity-100" : "opacity-45",
                  )}
                />
                {cameraLive && !showResultOverlay && !cameraError ? (
                  <div className="pointer-events-none absolute inset-0 z-10">
                    <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-indigo-300 to-transparent animate-[scanLine_2s_ease-in-out_infinite]" />
                  </div>
                ) : null}
                <div className="pointer-events-none absolute inset-0 border border-white/10" />
              </div>

              <div className="pointer-events-none absolute inset-0 z-10">
                <div className="absolute left-3 top-3 h-7 w-7 rounded-tl-md border-l-2 border-t-2 border-white/70" />
                <div className="absolute right-3 top-3 h-7 w-7 rounded-tr-md border-r-2 border-t-2 border-white/70" />
                <div className="absolute bottom-3 left-3 h-7 w-7 rounded-bl-md border-b-2 border-l-2 border-white/70" />
                <div className="absolute bottom-3 right-3 h-7 w-7 rounded-br-md border-b-2 border-r-2 border-white/70" />
              </div>

              {torchSupported ? (
                <motion.button
                  type="button"
                  className={cn(
                    "absolute right-3 top-3 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] backdrop-blur-xl transition",
                    torchEnabled
                      ? "border-amber-200/25 bg-amber-300/15 text-amber-50 shadow-[0_0_20px_rgba(251,191,36,0.22)]"
                      : "border-white/12 bg-black/30 text-white/85 hover:bg-white/10",
                    torchBusy ? "opacity-70" : "",
                  )}
                  onClick={() => void toggleTorch()}
                  disabled={torchBusy || !cameraLive || Boolean(cameraError)}
                  whileTap={{ scale: 0.96 }}
                >
                  {torchEnabled ? <Flashlight className="h-3 w-3" /> : <FlashlightOff className="h-3 w-3" />}
                  <span>{torchEnabled ? "Torch on" : "Torch"}</span>
                </motion.button>
              ) : null}

              {cameraInitializing && !cameraError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(2,6,23,0.6)] px-6 backdrop-blur-sm">
                  <div className="rounded-2xl border border-white/10 bg-[#071026]/90 px-6 py-5 text-center shadow-[0_24px_80px_rgba(0,0,0,0.36)]">
                    <Loader2 className="mx-auto h-9 w-9 animate-spin text-cyan-100" />
                    <p className="mt-3 text-lg font-semibold tracking-[-0.02em] text-white">Starting camera...</p>
                    <p className="mt-1 text-xs text-white/60">Please allow camera permission if prompted.</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-5 min-h-[110px] text-center">
              {cameraError ? (
                <div className="flex flex-col items-center gap-3">
                  <XCircle className="h-10 w-10 text-rose-300" />
                  <p className="text-base font-semibold text-rose-100">{cameraError.title}</p>
                  <p className="text-sm text-rose-200/80">{cameraError.detail}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-full px-5"
                    onClick={handleRetryCamera}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry camera
                  </Button>
                </div>
              ) : hasResult ? (
                <div className="flex flex-col items-center gap-2">
                  {isSuccess ? (
                    <CheckCircle className="h-10 w-10 text-emerald-300" />
                  ) : isQueued ? (
                    <WifiOff className="h-9 w-9 text-amber-300" />
                  ) : (
                    <XCircle className="h-10 w-10 text-rose-300" />
                  )}
                  <p
                    className={cn(
                      "text-lg font-semibold",
                      isSuccess
                        ? "text-emerald-200"
                        : isQueued
                          ? "text-amber-200"
                          : "text-rose-200",
                    )}
                  >
                    {resultName ?? (isQueued ? "Saved Offline" : "Scan Failed")}
                  </p>
                  <p
                    className={cn(
                      "text-sm font-medium",
                      isSuccess
                        ? "text-emerald-200/80"
                        : isQueued
                          ? "text-amber-200/80"
                          : "text-rose-200/80",
                    )}
                  >
                    {isSuccess
                      ? `${actionLabel ?? "Checked In"}${scanPayload?.seat ? " | Seat " + scanPayload.seat : ""}`
                      : scanPayload?.message ?? "Please try again."}
                  </p>
                </div>
              ) : !isOnline ? (
                <p className="text-sm text-rose-200/80">
                  No internet connection. Scans will queue and sync later.
                </p>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <ScanLine className="h-6 w-6 text-indigo-300 animate-pulse" />
                  <p className="text-sm text-white/70">{instructionText}</p>
                  <p className="text-xs text-white/45">{frameStatusLabel}</p>
                  {mobileTransientNotice ? (
                    <p className="text-xs text-emerald-200/80">{mobileTransientNotice}</p>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {scanDebugEnabled ? (
            <div className="w-full max-w-[34rem] rounded-[1.4rem] border border-cyan-300/14 bg-[#06101f]/84 px-4 py-3 text-left shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur-xl">
              <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-cyan-100/72">
                Scan Debug
              </div>
              <p className="mt-2 text-xs font-medium text-white/82">{scanDebugSummary}</p>
              <p className="mt-1 text-[11px] text-white/58">{lastScanDebugDetails}</p>
              <p className="mt-1 text-[11px] text-white/50">
                last status {scanMetricsSnapshot.lastStatus}
                {scanMetricsSnapshot.lastLowLight === null
                  ? ""
                  : scanMetricsSnapshot.lastLowLight
                    ? " - low-light assist"
                    : " - normal light"}
              </p>
            </div>
          ) : null}
          <p className="sr-only">
            {formattedTime} {formattedDate}
          </p>
        </div>
      </div>
      <AnimatePresence>
        {!isOnline ? (
          <motion.div
            className="absolute inset-x-[5vw] bottom-[max(calc(env(safe-area-inset-bottom)+5.5rem),5.5rem)] z-20 hidden items-center justify-center min-[1025px]:inset-x-auto min-[1025px]:left-1/2 min-[1025px]:flex min-[1025px]:-translate-x-1/2"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
          >
            <div className="inline-flex items-center gap-3 rounded-full border border-rose-300/16 bg-rose-500/10 px-5 py-3 text-base text-rose-50 shadow-[0_14px_40px_rgba(100,8,30,0.28)] backdrop-blur-xl">
              <WifiOff className="h-5 w-5" />
              <span>No Internet Connection</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {scanDebugEnabled && scanPayload && showResultOverlay ? (
          <ResultOverlay phase={phase} payload={scanPayload} />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {resetDialogOpen ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.84)] px-6 backdrop-blur-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {!adminPanelUnlocked ? (
              <motion.form
                className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#07111f]/92 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)]"
                initial={{ scale: 0.96, y: 12 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.96, y: 12 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                onSubmit={handleResetSubmit}
              >
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/18 bg-cyan-300/10 text-cyan-100 shadow-[0_0_40px_rgba(102,227,255,0.16)]">
                  <LockKeyhole className="h-7 w-7" />
                </div>
                <div className="mt-5 space-y-2 text-center">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-100/75">Hidden Admin Panel</p>
                  <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">Enter Admin PIN</h2>
                  <p className="text-sm leading-6 text-slate-300/80">
                    Unlock device controls, dashboard access, and a manual sync view.
                  </p>
                </div>

                <div className="mt-6 space-y-3">
                  <Input
                    type="password"
                    inputMode="numeric"
                    value={resetPin}
                    onChange={(event) => {
                      setResetPin(event.target.value);
                      if (resetError) {
                        setResetError(null);
                      }
                    }}
                    placeholder="Admin PIN"
                    autoComplete="off"
                    autoFocus
                    className="h-12 rounded-2xl border-white/12 bg-white/[0.06] px-4 text-center text-base tracking-[0.2em] text-white placeholder:text-white/30"
                  />

                  {resetError ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-50">
                      {resetError}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/65">
                      Long press stays hidden until someone with the PIN needs it.
                    </div>
                  )}
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-2xl border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    onClick={closeResetDialog}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="h-12 rounded-2xl bg-[linear-gradient(135deg,#06b6d4,#10b981)] text-slate-950 hover:opacity-95"
                  >
                    Unlock Panel
                  </Button>
                </div>
              </motion.form>
            ) : (
              <motion.div
                className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-[#07111f]/92 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.45)]"
                initial={{ scale: 0.96, y: 12 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.96, y: 12 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-300/18 bg-emerald-300/10 text-emerald-100 shadow-[0_0_40px_rgba(84,246,190,0.16)]">
                  <LayoutDashboard className="h-7 w-7" />
                </div>
                <div className="mt-5 space-y-2 text-center">
                  <p className="text-xs font-semibold uppercase tracking-[0.26em] text-emerald-100/75">Admin Panel</p>
                  <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">Device Controls</h2>
                  <p className="text-sm leading-6 text-slate-300/80">
                    Manage kiosk access without exposing the scanner to regular users.
                  </p>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Network</p>
                    <p className="mt-2 text-sm font-semibold text-white">{isOnline ? "Online" : "Offline"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Queue</p>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {isSyncing ? "Syncing" : pendingCount > 0 ? `${pendingCount} pending` : "Synced"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Device</p>
                    <p className="mt-2 text-sm font-semibold text-white">{DEVICE_ID}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/70">
                  Last sync {formattedLastSyncAt ?? "--"}
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <Button
                    type="button"
                    className="h-12 rounded-2xl bg-[linear-gradient(135deg,#38bdf8,#22c55e)] text-slate-950 hover:opacity-95"
                    onClick={handleOpenAdminDashboard}
                  >
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Open Dashboard
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-2xl border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                    onClick={() => void syncQueuedScans()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Queue
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-2xl border-rose-300/20 bg-rose-400/10 text-rose-50 hover:bg-rose-400/15"
                    onClick={handleResetDevice}
                  >
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Reset Device
                  </Button>
                </div>

                <div className="mt-6 flex justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full px-5 text-white/75 hover:bg-white/[0.08] hover:text-white"
                    onClick={closeResetDialog}
                  >
                    <LockKeyhole className="mr-2 h-4 w-4" />
                    Return to Scanner
                  </Button>
                </div>
              </motion.div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <style>{`
        @keyframes scanLine {
          0%, 100% { top: 18%; }
          50% { top: 82%; }
        }
      `}</style>
    </main>
  );
};

export default ScanPage;
