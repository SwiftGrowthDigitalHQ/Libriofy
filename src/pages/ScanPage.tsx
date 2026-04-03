import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Flashlight,
  FlashlightOff,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Volume2,
  WifiOff,
  X,
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
  readLastAttendanceSyncAt,
  submitAttendanceScan,
  syncQueuedAttendance,
} from "@/lib/attendanceSync";
import { sendDeviceHeartbeat } from "@/lib/deviceHeartbeat";
import { pullDeviceCommands, recordDeviceCommandStatus } from "@/lib/deviceCommands";
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
type FrameAnalysis = {
  brightness: number;
  glareRatio: number;
  shadowRatio: number;
  edgeScore: number;
};

const DEVICE_ID = import.meta.env.VITE_SCAN_DEVICE_ID ?? "LIB_GATE_01";
const DEVICE_NAME = import.meta.env.VITE_SCAN_DEVICE_NAME ?? "Library ID Scanner";
const SCAN_API_URL = import.meta.env.VITE_SCAN_API_URL ?? "/api/scan-attendance";
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
const KIOSK_STALL_RELOAD_MS = 60000;
const DEVICE_HEARTBEAT_INTERVAL_MS = 30000;
const RESULT_HOLD_MS = 2000;
const DUPLICATE_SCAN_WINDOW_MS = 25000;
const SCAN_ASSIST_INTERVAL_MS = 850;
const FALLBACK_SCAN_INTERVAL_MS = 120;
const FALLBACK_SCAN_MAX_EDGE = 720;
const SCAN_BOX_DEFAULT_EDGE = 280;
const SCAN_BOX_MIN_EDGE = 250;
const SCAN_BOX_MAX_EDGE = 280;
const SCAN_BOX_VIEWPORT_PADDING = 36;
const GUIDANCE_ROTATION_MS = 1800;
const DEFAULT_GUIDANCE_HINT = "Align QR inside frame";
const GUIDANCE_ROTATION = ["Move closer", "Hold steady", "Adjust angle"] as const;
const DEVICE_BINDING_RESET_CODES = new Set(["INVALID_LIBRARY_ID", "WRONG_LIBRARY", "DEVICE_BLOCKED"]);
const CAMERA_PROFILES: CameraProfile[] = [
  {
    label: "Sharp rear camera",
    constraints: {
      facingMode: "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 15, max: 24 },
      focusMode: "continuous",
      exposureMode: "continuous",
      whiteBalanceMode: "continuous",
    },
  },
  {
    label: "Balanced rear camera",
    constraints: {
      facingMode: "environment",
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 12, max: 20 },
      focusMode: "continuous",
      exposureMode: "continuous",
      whiteBalanceMode: "continuous",
    },
  },
  {
    label: "Performance rear camera",
    constraints: {
      facingMode: "environment",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 10, max: 15 },
      focusMode: "continuous",
      exposureMode: "continuous",
      whiteBalanceMode: "continuous",
    },
  },
];
const getDefaultCameraProfileIndex = () => {
  if (typeof navigator === "undefined") {
    return 0;
  }

  const cores = navigator.hardwareConcurrency ?? 6;
  return cores <= 4 ? 1 : 0;
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

const getReadableError = (error: unknown, fallback = "Unable to verify this ID right now.") => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const getCameraErrorState = (error: unknown): CameraErrorState => {
  if (!window.isSecureContext) {
    return {
      title: "Camera access required",
      detail: "Open this kiosk over HTTPS to use the camera.",
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      title: "Camera not available",
      detail: "This browser does not support live camera access.",
    };
  }

  if (error instanceof DOMException) {
    if (
      error.name === "NotAllowedError" ||
      error.name === "PermissionDeniedError" ||
      error.name === "SecurityError"
    ) {
      return {
        title: "Camera access required",
        detail: "Please allow camera permission.",
      };
    }

    if (
      error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError" ||
      error.name === "OverconstrainedError"
    ) {
      return {
        title: "No camera detected",
        detail: "No rear camera was found on this tablet.",
      };
    }

    if (
      error.name === "NotReadableError" ||
      error.name === "TrackStartError" ||
      error.name === "AbortError"
    ) {
      return {
        title: "Camera not available",
        detail: "Camera is already in use by another app or tab.",
      };
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("permission")) {
      return {
        title: "Camera access required",
        detail: "Please allow camera permission.",
      };
    }

    if (message.includes("https") || message.includes("secure context")) {
      return {
        title: "Camera access required",
        detail: "Open this kiosk over HTTPS to use the camera.",
      };
    }

    if (message.includes("camera") && message.includes("use")) {
      return {
        title: "Camera not available",
        detail: "Camera is already in use by another app or tab.",
      };
    }
  }

  return {
    title: "Camera not available",
    detail: "Unable to start the rear camera right now.",
  };
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
                <p className="text-sm font-semibold uppercase tracking-[0.26em] text-emerald-100/70">ID verified</p>
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
                  Stored locally
                </p>
                <h1 className="text-4xl font-bold tracking-[-0.04em] text-white sm:text-5xl">
                  Saved offline
                </h1>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/[0.05] px-6 py-5">
                <p className="text-2xl font-semibold tracking-[-0.03em] text-white">
                  Queueing for sync <span className="text-cyan-200/65">-</span> Entry stored
                </p>
                <p className="mt-2 text-base text-cyan-50/82">Time {payload.time}</p>
                <p className="mt-2 text-sm text-cyan-50/72">{payload.message}</p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/12 px-4 py-2 text-sm text-cyan-50/90">
                <Volume2 className="h-4 w-4" />
                <span>Will sync automatically</span>
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
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetPin, setResetPin] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [adminPanelUnlocked, setAdminPanelUnlocked] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerStartPromiseRef = useRef<Promise<void> | null>(null);
  const scannerStartedRef = useRef(false);
  const scannerPausedRef = useRef(false);
  const cameraProfileIndexRef = useRef(getDefaultCameraProfileIndex());
  const scanAssistTimerRef = useRef<number | null>(null);
  const previewAnalysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scannerReadyAtRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
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
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const lastAcceptedScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const audioContextRef = useRef<AudioContext | null>(null);
  const isOnlineRef = useRef(isOnline);
  const syncInFlightRef = useRef(false);
  const deviceHeartbeatInFlightRef = useRef(false);
  const deviceCommandPollInFlightRef = useRef(false);
  const deviceCommandProcessingIdsRef = useRef<Set<string>>(new Set());
  const bindingRedirectInFlightRef = useRef(false);
  const cameraRetryCountRef = useRef(0);
  const torchBusyRef = useRef(false);
  const handleScanResultRef = useRef<(rawValue: string) => Promise<void>>(async () => undefined);
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

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const clearResetHoldTimer = useCallback(() => {
    if (resetHoldTimerRef.current !== null) {
      window.clearTimeout(resetHoldTimerRef.current);
      resetHoldTimerRef.current = null;
    }
  }, []);

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

  const requestKioskFullscreen = useCallback(async () => {
    if (typeof document === "undefined" || document.fullscreenElement) {
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

  const getActiveCameraProfile = useCallback(
    () => CAMERA_PROFILES[cameraProfileIndexRef.current] ?? CAMERA_PROFILES[0],
    [],
  );

  const getActiveVideoConstraints = useCallback(
    () => getActiveCameraProfile().constraints,
    [getActiveCameraProfile],
  );

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

      return decodeFrame();
    } catch {
      return null;
    }
  }, [getScanCropRect, getScannerVideoElement]);

  const startFallbackScanLoop = useCallback(() => {
    clearFallbackScanFrame();
    fallbackScanAtRef.current = 0;

    const loop = () => {
      if (
        !mountedRef.current ||
        !scannerStartedRef.current ||
        scannerPausedRef.current ||
        processingRef.current ||
        cameraError
      ) {
        fallbackScanFrameRef.current = null;
        return;
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - fallbackScanAtRef.current >= FALLBACK_SCAN_INTERVAL_MS) {
        fallbackScanAtRef.current = now;

        // html5-qrcode stays primary; jsQR keeps glossy or slightly blurred QR cards readable.
        const rawValue = readFallbackQrFromFrame();
        if (rawValue) {
          fallbackScanFrameRef.current = null;
          void handleScanResultRef.current(rawValue).catch(() => undefined);
          return;
        }
      }

      fallbackScanFrameRef.current = window.requestAnimationFrame(loop);
    };

    fallbackScanFrameRef.current = window.requestAnimationFrame(loop);
  }, [cameraError, clearFallbackScanFrame, readFallbackQrFromFrame]);

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
          ...getActiveVideoConstraints(),
          advanced: [supportedControls],
        } as MediaTrackConstraints);
      } catch {
        // Ignore post-start track tuning failures.
      }
    },
    [getActiveVideoConstraints],
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

  const stopScanner = useCallback(async () => {
    scannerStartPromiseRef.current = null;
    clearCameraRecoveryTimer();
    clearFallbackScanFrame();
    fallbackScanAtRef.current = 0;
    torchBusyRef.current = false;

    const scanner = scannerRef.current;
    if (!scanner) {
      scannerStartedRef.current = false;
      scannerPausedRef.current = false;
      cameraRetryCountRef.current = 0;
      if (mountedRef.current) {
        setTorchBusy(false);
        setTorchEnabled(false);
        setTorchSupported(false);
      }
      clearScannerRegion();

      if (mountedRef.current) {
        setCameraReady(false);
      }

      return;
    }

    try {
      if (scannerStartedRef.current) {
        await scanner.stop();
      }
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

    if (mountedRef.current) {
      setCameraReady(false);
    }
  }, [clearCameraRecoveryTimer, clearFallbackScanFrame, clearScannerRegion]);

  const chooseRearCameraSource = useCallback(async (): Promise<string | MediaTrackConstraints> => {
    if (!window.isSecureContext) {
      throw new Error("HTTPS_REQUIRED");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MEDIA_DEVICES_UNSUPPORTED");
    }

    let warmupStream: MediaStream | null = null;
    let selectedProfile = getActiveCameraProfile();
    let lastError: unknown = null;

    try {
      for (let profileIndex = cameraProfileIndexRef.current; profileIndex < CAMERA_PROFILES.length; profileIndex += 1) {
        const candidateProfile = CAMERA_PROFILES[profileIndex];

        try {
          warmupStream = await navigator.mediaDevices.getUserMedia({
            video: candidateProfile.constraints,
            audio: false,
          });
          cameraProfileIndexRef.current = profileIndex;
          selectedProfile = candidateProfile;
          setCameraProfileLabel(candidateProfile.label);
          break;
        } catch (error) {
          lastError = error;

          if (!(error instanceof DOMException) || error.name !== "OverconstrainedError") {
            throw error;
          }
        }
      }

      if (!warmupStream) {
        throw lastError ?? new Error("No supported camera profile was accepted.");
      }

      const activeTrack = warmupStream.getVideoTracks()[0];
      const activeSettings = activeTrack?.getSettings();
      const videoInputs =
        typeof navigator.mediaDevices.enumerateDevices === "function"
          ? (await navigator.mediaDevices.enumerateDevices()).filter(
              (device) => device.kind === "videoinput",
            )
          : [];

      const rearCamera = videoInputs.find((device) =>
        /back|rear|environment|world|traseira|trasera|camera 0/i.test(device.label),
      );

      if (rearCamera?.deviceId) {
        return rearCamera.deviceId;
      }

      if (activeSettings?.deviceId) {
        return activeSettings.deviceId;
      }

      if (videoInputs[0]?.deviceId) {
        return videoInputs[0].deviceId;
      }

      return selectedProfile.constraints;
    } finally {
      warmupStream?.getTracks().forEach((track) => track.stop());

      if (warmupStream) {
        await sleep(120);
      }
    }
  }, [getActiveCameraProfile]);

  const pauseScanner = useCallback((shouldPauseVideo = true) => {
    const scanner = scannerRef.current;
    if (!scanner || !scannerStartedRef.current || scannerPausedRef.current) {
      return;
    }

    try {
      scanner.pause(shouldPauseVideo);
      scannerPausedRef.current = true;
      clearFallbackScanFrame();
    } catch {
      // Ignore pause errors and let the next restart recover.
    }
  }, [clearFallbackScanFrame]);

  const startScanner = useCallback(async () => {
    if (!mountedRef.current || processingRef.current) {
      return;
    }

    if (scannerStartPromiseRef.current) {
      await scannerStartPromiseRef.current;
      return;
    }

    const existingScanner = scannerRef.current;
    if (existingScanner && scannerStartedRef.current) {
      if (!scannerPausedRef.current) {
      if (mountedRef.current) {
        setCameraInitializing(false);
        setCameraReady(true);
        setCameraError(null);
        setGuidanceHint(DEFAULT_GUIDANCE_HINT);
          setLightingHint(null);
          setPartialDetectionActive(false);
          setStatusMessage(isOnlineRef.current ? "Ready to scan" : "Offline queue ready");
      }

      scannerReadyAtRef.current = Date.now();
      syncTorchState(existingScanner);
      cameraRetryCountRef.current = 0;
      clearCameraRecoveryTimer();
      startFallbackScanLoop();

      return;
    }

      try {
        existingScanner.resume();
        scannerPausedRef.current = false;

        if (mountedRef.current) {
          setCameraInitializing(false);
          setCameraReady(true);
          setCameraError(null);
          setGuidanceHint(DEFAULT_GUIDANCE_HINT);
          setLightingHint(null);
          setPartialDetectionActive(false);
          setStatusMessage(isOnlineRef.current ? "Ready to scan" : "Offline queue ready");
        }

        scannerReadyAtRef.current = Date.now();
        syncTorchState(existingScanner);
        startFallbackScanLoop();

        return;
      } catch {
        await stopScanner();
      }
    }

    const startup = (async () => {
      if (mountedRef.current) {
        setCameraInitializing(true);
        setCameraReady(false);
        setCameraError(null);
        setStatusMessage("Starting camera...");
      }

      await stopScanner();

      const cameraSource = await chooseRearCameraSource();
      if (!mountedRef.current) {
        return;
      }

      const scanner = new Html5Qrcode(SCANNER_REGION_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      });

      scannerRef.current = scanner;

      const scanConfig: Html5QrcodeCameraScanConfig = {
        fps: 12,
        aspectRatio: 1,
        disableFlip: false,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const edge = resolveScanBoxEdge(viewfinderWidth, viewfinderHeight);

          if (mountedRef.current) {
            setScanBoxEdge((currentEdge) => (currentEdge === edge ? currentEdge : edge));
          }

          return { width: edge, height: edge };
        },
        videoConstraints: getActiveVideoConstraints(),
      };

      try {
        await scanner.start(
          cameraSource,
          scanConfig,
          (decodedText) => {
            void handleScanResultRef.current(decodedText).catch(() => undefined);
          },
          () => undefined,
        );
        await applyPreferredTrackControls(scanner);
      } catch (error) {
        scannerRef.current = null;

        try {
          scanner.clear();
        } catch {
          // Ignore renderer cleanup failures.
        }

        throw error;
      }

      if (!mountedRef.current) {
        await stopScanner();
        return;
      }

      scannerStartedRef.current = true;
      scannerPausedRef.current = false;
      scannerReadyAtRef.current = Date.now();
      cameraRetryCountRef.current = 0;
      clearCameraRecoveryTimer();
      setCameraReady(true);
      setCameraInitializing(false);
      setCameraError(null);
      setGuidanceHint(DEFAULT_GUIDANCE_HINT);
      setLightingHint(null);
      setPartialDetectionActive(false);
      setStatusMessage(isOnlineRef.current ? "Ready to scan" : "Offline queue ready");
      syncTorchState(scanner);
      startFallbackScanLoop();

      const runningSettings = scanner.getRunningTrackSettings();
      if (runningSettings.width && runningSettings.height) {
        setCameraProfileLabel(
          `${getActiveCameraProfile().label} · ${runningSettings.width}x${runningSettings.height}`,
        );
      }

    })()
      .catch(async (error) => {
        await stopScanner();

        if (!mountedRef.current) {
          return;
        }

        setCameraInitializing(false);
        setCameraReady(false);
        setCameraError(getCameraErrorState(error));
        setStatusMessage("Camera unavailable");
      })
      .finally(() => {
        scannerStartPromiseRef.current = null;
      });

    scannerStartPromiseRef.current = startup;
    await startup;
  }, [
    applyPreferredTrackControls,
    chooseRearCameraSource,
    clearCameraRecoveryTimer,
    getActiveCameraProfile,
    getActiveVideoConstraints,
    startFallbackScanLoop,
    stopScanner,
    syncTorchState,
  ]);

  const resumeScanner = useCallback(async () => {
    if (!mountedRef.current || processingRef.current) {
      return;
    }

    const scanner = scannerRef.current;
    if (scanner && scannerStartedRef.current) {
      if (scannerPausedRef.current) {
        try {
          scanner.resume();
          scannerPausedRef.current = false;
          scannerReadyAtRef.current = Date.now();
          syncTorchState(scanner);

          if (mountedRef.current) {
            setCameraInitializing(false);
            setCameraReady(true);
          setCameraError(null);
          setGuidanceHint(DEFAULT_GUIDANCE_HINT);
          setLightingHint(null);
          setPartialDetectionActive(false);
          setStatusMessage(isOnlineRef.current ? "Ready to scan" : "Offline queue ready");
        }

        startFallbackScanLoop();
        return;
      } catch {
        await stopScanner();
        }
      } else {
        if (mountedRef.current) {
          setCameraInitializing(false);
          setCameraReady(true);
        setCameraError(null);
        setGuidanceHint(DEFAULT_GUIDANCE_HINT);
        setLightingHint(null);
        setPartialDetectionActive(false);
        setStatusMessage(isOnlineRef.current ? "Ready to scan" : "Offline queue ready");
      }

      scannerReadyAtRef.current = Date.now();
      syncTorchState(scanner);
      cameraRetryCountRef.current = 0;
      clearCameraRecoveryTimer();
      startFallbackScanLoop();

      return;
      }
    }

    await startScanner();
  }, [clearCameraRecoveryTimer, startFallbackScanLoop, startScanner, stopScanner, syncTorchState]);

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
            pauseScanner(true);
            await stopScanner().catch(() => undefined);
            await updateStatus("completed");
            await redirectToDeviceSetup(commandNotice);
            return "redirected" as const;
          }
          case "restart_scanner": {
            pauseScanner(true);
            await stopScanner().catch(() => undefined);
            await sleep(250);
            await startScanner();
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
      processingRef.current = false;

      if (cameraError) {
        setStatusMessage("Camera unavailable");
        return;
      }

      if (!isOnlineRef.current) {
        setStatusMessage("Offline queue ready");
        void resumeScanner();
        return;
      }

      setStatusMessage("Ready to scan");
      void resumeScanner();
    }, RESULT_HOLD_MS);
  }, [cameraError, clearResetTimer, resumeScanner]);

  const handleRetryCamera = useCallback(() => {
    clearCameraRecoveryTimer();
    setCameraError(null);
    setStatusMessage("Restarting camera...");
    void startScanner();
  }, [clearCameraRecoveryTimer, startScanner]);

  const handleScanResult = useCallback(
    async (rawValue: string) => {
      let scannerResetScheduled = false;

      try {
        if (processingRef.current) {
          return;
        }

        const normalizedRawValue = trimText(rawValue);
        if (!normalizedRawValue) {
          return;
        }

        processingRef.current = true;

        const showScanError = async (code: string, message: string) => {
          await stopScanner().catch(() => undefined);
          setScanPayload({
            status: "error",
            code,
            message,
          });
          setPhase("error");
          vibrateFeedback([28, 60, 22]);
          await playFeedbackTone("error");
          scheduleReturnToScanner();
          scannerResetScheduled = true;
        };

        const parsed = await parseStudentQrPayload(normalizedRawValue, {
          expectedLibraryId: readStoredLibraryId(),
          allowLegacy: true,
          publicKeyPem: STUDENT_QR_PUBLIC_KEY,
          now: new Date(),
        });

        if (!parsed) {
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
        if (
          lastAcceptedScanRef.current.value === scanIdentifier &&
          nowTs - lastAcceptedScanRef.current.at < DUPLICATE_SCAN_WINDOW_MS
        ) {
          return;
        }

        lastAcceptedScanRef.current = { value: scanIdentifier, at: nowTs };
        const scanTimestamp = new Date().toISOString();
        const scanEntry = createAttendanceQueueEntry({
          deviceId: DEVICE_ID,
          studentId: scanIdentifier,
          libraryId: deviceLibraryId,
          libraryAccessKey: deviceLibraryAccessKey,
          qrCode: parsed.rawValue,
          timestamp: scanTimestamp,
        });
        await stopScanner().catch(() => undefined);
        triggerScanFeedback();
        void playFeedbackTone("detect");
        vibrateFeedback(18);
        setPhase("scanning");
        setStatusMessage(isOnlineRef.current ? "Verifying attendance..." : "Saving offline...");

        let shouldReturnToScanner = true;
        try {
          const payload = await submitScan(scanEntry);
          setScanPayload(payload);

          if (payload.status === "success") {
            setPhase("success");
            vibrateFeedback([22, 40, 16]);
            await playFeedbackTone("success");
          } else if (payload.status === "queued") {
            setPhase("queued");
            vibrateFeedback([22, 40, 16]);
            await playFeedbackTone("success");
          } else {
            setPhase("error");
            vibrateFeedback([28, 60, 22]);
            await playFeedbackTone("error");

            if (payload.code && DEVICE_BINDING_RESET_CODES.has(payload.code)) {
              shouldReturnToScanner = false;
              scannerResetScheduled = true;
              await sleep(900);
              await redirectToDeviceSetup(
                payload.message || "Library credentials changed. Reconnect this kiosk.",
              );
            }
          }
        } catch (error) {
          setScanPayload({
            status: "error",
            message: getReadableError(error),
          });
          setPhase("error");
          vibrateFeedback([28, 60, 22]);
          await playFeedbackTone("error");
        } finally {
          if (shouldReturnToScanner) {
            scheduleReturnToScanner();
            scannerResetScheduled = true;
          }
        }
      } catch (error) {
        await stopScanner().catch(() => undefined);
        setScanPayload({
          status: "error",
          message: getReadableError(error),
        });
        setPhase("error");
        vibrateFeedback([28, 60, 22]);
        await playFeedbackTone("error");
        scheduleReturnToScanner();
        scannerResetScheduled = true;
      } finally {
        if (!scannerResetScheduled) {
          processingRef.current = false;
        }
      }
    },
    [
      playFeedbackTone,
      redirectToDeviceSetup,
      scheduleReturnToScanner,
      stopScanner,
      submitScan,
      triggerScanFeedback,
      vibrateFeedback,
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

        const lowLight = frame.brightness < 72 || frame.shadowRatio > 0.38;
        const glare = frame.brightness > 208 || frame.glareRatio > 0.2;
        const partialDetection = !lowLight && !glare && frame.edgeScore > 30;
        const needsCloserDistance = !lowLight && !glare && frame.edgeScore < 14;
        const needsSteadierHands = !lowLight && !glare && frame.edgeScore >= 14 && frame.edgeScore < 22;
        const needsAngleAdjustment = !lowLight && !glare && frame.edgeScore >= 22 && frame.edgeScore < 30;
        const lightingMessage = lowLight
          ? torchSupported
            ? "Low light detected - turn on torch"
            : "Low light detected - improve lighting"
          : glare
            ? "Reduce screen glare"
            : null;
        const elapsedSinceReady = Date.now() - scannerReadyAtRef.current;

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
    mountedRef.current = true;
    bindingRedirectInFlightRef.current = false;

    const initializeKiosk = async () => {
      await refreshQueueState();
      void requestKioskFullscreen();

      const cameraStartup = startScanner();
      if (window.navigator.onLine) {
        void sendScannerHeartbeat();
      }

      await cameraStartup;
    };

    void initializeKiosk().catch(() => undefined);

    return () => {
      mountedRef.current = false;
      clearResetTimer();
      clearFeedbackTimers();
      clearScanAssistTimer();
      clearFallbackScanFrame();
      clearFullscreenRetryTimer();
      clearCameraRecoveryTimer();
      clearKioskWatchdogTimer();
      void stopScanner();
      void releaseWakeLock();
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, [
    clearFeedbackTimers,
    clearCameraRecoveryTimer,
    clearFallbackScanFrame,
    clearFullscreenRetryTimer,
    clearResetTimer,
    clearScanAssistTimer,
    clearKioskWatchdogTimer,
    requestKioskFullscreen,
    releaseWakeLock,
    refreshQueueState,
    sendScannerHeartbeat,
    startScanner,
    stopScanner,
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
          void resumeScanner();
        }
      } else {
        pauseScanner(true);
        void releaseWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [
    acquireWakeLock,
    pauseScanner,
    releaseWakeLock,
    requestKioskFullscreen,
    pollDeviceCommands,
    resumeScanner,
    sendScannerHeartbeat,
    showResultOverlay,
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
        void resumeScanner();
      } else if (!scannerRef.current || cameraError) {
        void startScanner();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      if (!showResultOverlay && !processingRef.current) {
        setPhase("idle");
        setStatusMessage("Offline queue ready");
        void resumeScanner();
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
    if (!cameraError) {
      cameraRetryCountRef.current = 0;
      clearCameraRecoveryTimer();
      return;
    }

    clearCameraRecoveryTimer();

    const retryCount = Math.min(cameraRetryCountRef.current + 1, 6);
    cameraRetryCountRef.current = retryCount;
    const retryDelay = Math.min(KIOSK_CAMERA_RETRY_BASE_MS * retryCount, KIOSK_CAMERA_RETRY_MAX_MS);

    cameraRecoveryTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) {
        return;
      }

      void startScanner();
    }, retryDelay);

    return () => {
      clearCameraRecoveryTimer();
    };
  }, [cameraError, clearCameraRecoveryTimer, startScanner]);

  useEffect(() => {
    const shouldWatch = cameraInitializing || cameraError || phase === "scanning";
    if (!shouldWatch) {
      clearKioskWatchdogTimer();
      return;
    }

    clearKioskWatchdogTimer();
    kioskWatchdogTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) {
        return;
      }

      window.location.reload();
    }, phase === "scanning" ? KIOSK_STALL_RELOAD_MS : Math.min(KIOSK_STALL_RELOAD_MS, 45000));

    return () => {
      clearKioskWatchdogTimer();
    };
  }, [cameraError, cameraInitializing, clearKioskWatchdogTimer, phase]);

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
    themeMeta?.setAttribute("content", "#06091d");
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

  const cameraLive = cameraReady && !cameraInitializing && !cameraError;
  const assistHighlightActive = partialDetectionActive || frameReactionActive;
  const liveAssistHint = lightingHint ?? guidanceHint;
  const frameStatusLabel =
    cameraError?.title ?? (partialDetectionActive && phase === "idle" ? "Hold steady" : statusMessage);
  const heroDescription = cameraError
    ? cameraError.detail
    : !isOnline
      ? "Offline queue mode is active. Scans will keep working and sync later."
      : phase === "scanning"
        ? "Verifying the QR..."
        : cameraInitializing
          ? "Starting the rear camera for automatic QR scanning."
          : liveAssistHint;
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
      className="relative min-h-[100dvh] overflow-hidden bg-[#06091d] text-white touch-none overscroll-none"
      style={{ fontFamily: "'Sora', system-ui, sans-serif" }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(44,176,235,0.18),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(84,246,190,0.16),transparent_30%),radial-gradient(circle_at_50%_86%,rgba(72,84,255,0.18),transparent_32%),linear-gradient(180deg,#040817_0%,#0A1030_46%,#120B31_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.15),rgba(2,6,23,0.62)_45%,rgba(3,5,18,0.94)_100%)]" />
      <div className="absolute left-[-14%] top-[10%] h-72 w-72 rounded-full bg-cyan-400/14 blur-[120px]" />
      <div className="absolute right-[-10%] top-[16%] h-80 w-80 rounded-full bg-emerald-400/12 blur-[120px]" />
      <div className="absolute bottom-[-10%] left-[18%] h-72 w-72 rounded-full bg-violet-500/16 blur-[140px]" />
      <FloatingParticles />
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

      <div className="scan-kiosk-shell relative z-10">
        <motion.section
          className="scan-kiosk-card scan-kiosk-container relative overflow-hidden border border-white/10 bg-white/[0.04] shadow-[0_28px_110px_rgba(0,0,0,0.28)] backdrop-blur-[28px]"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(102,227,255,0.08),transparent_28%),radial-gradient(circle_at_bottom,rgba(84,246,190,0.08),transparent_26%)]" />
          <motion.div
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)] opacity-0 blur-xl"
            animate={{ x: ["0%", "430%"], opacity: [0, 0.18, 0] }}
            transition={{ duration: 7.2, repeat: Number.POSITIVE_INFINITY, repeatDelay: 1.2, ease: "easeInOut" }}
          />
          <div className="relative flex w-full flex-col items-center gap-[clamp(12px,2vw,24px)] text-center">
            <header className="flex w-full items-center justify-between gap-3 rounded-full border border-white/10 bg-white/[0.05] px-[clamp(14px,3vw,24px)] py-[clamp(12px,2vw,18px)] shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/12 shadow-[0_0_26px_rgba(102,227,255,0.22)] min-[481px]:h-11 min-[481px]:w-11 min-[1025px]:h-12 min-[1025px]:w-12">
              <ScanLine className="h-4 w-4 text-cyan-100 min-[1025px]:h-5 min-[1025px]:w-5" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold tracking-[-0.02em] text-white max-[480px]:block min-[481px]:hidden">Libriofy</p>
              <p className="hidden text-base font-semibold tracking-[-0.02em] text-white min-[481px]:block min-[1025px]:text-xl">
                Libriofy ID Check-In
              </p>
              <div className="scan-kiosk-small hidden items-center gap-2 text-white/60 min-[481px]:flex">
                <ShieldCheck className={cn("h-4 w-4", isOnline ? "text-emerald-300" : "text-cyan-300")} />
                <span>{isOnline ? "Library Open" : "Offline Queue Mode"}</span>
              </div>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[clamp(18px,3vw,32px)] font-semibold tracking-[-0.04em] text-white">{formattedTime}</p>
            <p className="scan-kiosk-small hidden text-white/55 min-[481px]:block">{formattedDate}</p>
          </div>
            </header>
          <div className="relative flex w-full flex-col items-center gap-[clamp(12px,2vw,24px)] pt-[clamp(10px,2vh,30px)] text-center">
                <div className="hidden items-center gap-2 rounded-full border border-cyan-300/18 bg-cyan-300/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.26em] text-cyan-50/90 min-[1025px]:inline-flex">
                  <ScanLine className="h-3.5 w-3.5" />
                  <span>ID Verification</span>
                </div>

                <div className="w-full max-w-[32rem] space-y-2">
                  <h1 className="scan-kiosk-title font-semibold tracking-[-0.07em] text-white">
                    Scan QR for Attendance
                  </h1>
                  <p className="scan-kiosk-helper mx-auto text-white/70">
                    {heroDescription}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/80 backdrop-blur-xl min-[1025px]:gap-3 min-[1025px]:px-4 min-[1025px]:py-3">
                  <span
                    className={cn(
                      "rounded-full border px-3 py-1",
                      isOnline
                        ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                        : "border-amber-300/20 bg-amber-300/12 text-amber-50",
                    )}
                  >
                    {isOnline ? "ONLINE" : "OFFLINE"}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-3 py-1",
                      isSyncing || pendingCount > 0
                        ? "border-cyan-300/20 bg-cyan-300/12 text-cyan-50"
                        : "border-white/10 bg-white/[0.06] text-white/70",
                    )}
                  >
                    {isSyncing ? "SYNCING" : pendingCount > 0 ? `${pendingCount} QUEUED` : "SYNCED"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-white/70">
                    Last sync {formattedLastSyncAt ?? "--"}
                  </span>
                </div>

                <div className="relative flex w-full justify-center pt-[clamp(10px,2vh,26px)]">
                  <motion.div
                    className="scan-kiosk-frame relative overflow-hidden rounded-[2rem] border border-white/12 bg-[#020816] shadow-[0_28px_90px_rgba(0,0,0,0.4)]"
                    animate={
                      frameReactionActive
                        ? {
                            scale: [0.985, 1.01, 0.995, 1],
                            boxShadow: [
                              "0 28px 90px rgba(0,0,0,0.4)",
                              "0 28px 120px rgba(84,246,190,0.18)",
                              "0 28px 90px rgba(0,0,0,0.4)",
                            ],
                          }
                        : {
                            scale: 1,
                            boxShadow: "0 28px 90px rgba(0,0,0,0.4)",
                          }
                    }
                    transition={frameReactionActive ? { duration: 0.4, ease: "easeOut" } : { duration: 0.2 }}
                  >
                    <div
                      id={SCANNER_REGION_ID}
                      className={cn(
                        "absolute inset-0 bg-black transition-opacity duration-200",
                        cameraLive ? "opacity-100" : "opacity-45",
                      )}
                    />
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.08),rgba(2,6,23,0.42))]" />

                    {!cameraError ? (
                      <motion.div
                        className="pointer-events-none absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rounded-[1.4rem] border border-white/20"
                        style={{ width: scanBoxEdge, height: scanBoxEdge }}
                        animate={
                          assistHighlightActive
                            ? {
                                scale: [0.986, 1.014, 1],
                                borderColor: [
                                  "rgba(255,255,255,0.2)",
                                  "rgba(134,255,221,0.96)",
                                  "rgba(255,255,255,0.2)",
                                ],
                                boxShadow: [
                                  "0 0 0 rgba(0,0,0,0)",
                                  "0 0 28px rgba(84,246,190,0.24)",
                                  "0 0 0 rgba(0,0,0,0)",
                                ],
                              }
                            : {
                                borderColor: cameraLive ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.12)",
                                boxShadow: cameraLive
                                  ? "0 0 0 1px rgba(255,255,255,0.06)"
                                  : "0 0 0 rgba(0,0,0,0)",
                              }
                        }
                        transition={assistHighlightActive ? { duration: 0.4, ease: "easeOut" } : { duration: 0.2 }}
                      >
                        <span className="absolute left-0 top-0 h-12 w-12 rounded-tl-[1.3rem] border-l-[4px] border-t-[4px] border-cyan-200/95" />
                        <span className="absolute right-0 top-0 h-12 w-12 rounded-tr-[1.3rem] border-r-[4px] border-t-[4px] border-cyan-200/95" />
                        <span className="absolute bottom-0 left-0 h-12 w-12 rounded-bl-[1.3rem] border-b-[4px] border-l-[4px] border-emerald-200/95" />
                        <span className="absolute bottom-0 right-0 h-12 w-12 rounded-br-[1.3rem] border-b-[4px] border-r-[4px] border-emerald-200/95" />
                        {cameraLive && phase !== "scanning" ? (
                          <motion.div
                            className="absolute left-4 right-4 top-4 h-[2px] rounded-full bg-gradient-to-r from-transparent via-cyan-100 to-transparent shadow-[0_0_18px_rgba(102,227,255,0.45)]"
                            animate={{
                              y: [0, Math.max(0, scanBoxEdge - 34), 0],
                              opacity: [0.55, 1, 0.55],
                            }}
                            transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                          />
                        ) : null}
                      </motion.div>
                    ) : null}

                    {torchSupported ? (
                      <motion.button
                        type="button"
                        className={cn(
                          "absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] backdrop-blur-xl transition",
                          torchEnabled
                            ? "border-amber-200/25 bg-amber-300/15 text-amber-50 shadow-[0_0_24px_rgba(251,191,36,0.22)]"
                            : "border-white/12 bg-black/30 text-white/85 hover:bg-white/10",
                          torchBusy ? "opacity-70" : "",
                        )}
                        onClick={() => void toggleTorch()}
                        disabled={torchBusy || !cameraLive || Boolean(cameraError)}
                        whileTap={{ scale: 0.96 }}
                      >
                        {torchEnabled ? <Flashlight className="h-3.5 w-3.5" /> : <FlashlightOff className="h-3.5 w-3.5" />}
                        <span>{torchEnabled ? "Torch on" : "Torch"}</span>
                      </motion.button>
                    ) : null}

                    <AnimatePresence>
                      {scanFlashVisible ? (
                        <motion.div
                          className="pointer-events-none absolute inset-0 z-[5] bg-[radial-gradient(circle,rgba(255,255,255,0.78),rgba(255,255,255,0.12)_35%,transparent_70%)] mix-blend-screen"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: [0, 1, 0] }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18, ease: "easeOut" }}
                        />
                      ) : null}
                    </AnimatePresence>

                    {cameraInitializing && !cameraError ? (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(2,6,23,0.58)] px-6 backdrop-blur-sm">
                        <div className="rounded-[1.75rem] border border-white/10 bg-[#071026]/88 px-8 py-7 text-center shadow-[0_24px_80px_rgba(0,0,0,0.36)]">
                          <Loader2 className="mx-auto h-11 w-11 animate-spin text-cyan-100" />
                          <p className="mt-4 text-[clamp(20px,3vw,30px)] font-semibold tracking-[-0.03em] text-white">
                            Starting camera...
                          </p>
                          <p className="scan-kiosk-small mt-2 max-w-xs text-white/68">
                            Please allow camera permission if prompted.
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {phase === "scanning" && !showResultOverlay ? (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(2,6,23,0.42)] px-6 backdrop-blur-[2px]">
                        <div className="rounded-[1.6rem] border border-cyan-300/16 bg-[#071026]/88 px-6 py-5 text-center shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
                          <Loader2 className="mx-auto h-10 w-10 animate-spin text-cyan-100" />
                          <p className="mt-3 text-lg font-semibold tracking-[-0.02em] text-white">
                            QR detected
                          </p>
                          <p className="scan-kiosk-small mt-1 text-white/68">
                            Verifying attendance...
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {cameraError ? (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(14,6,18,0.72)] px-6 backdrop-blur-sm">
                        <div className="max-w-sm rounded-[1.9rem] border border-rose-300/18 bg-[#110816]/92 px-7 py-7 text-center shadow-[0_24px_80px_rgba(66,8,28,0.42)]">
                          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-rose-200/20 bg-rose-400/12 text-rose-50">
                            <X className="h-8 w-8" strokeWidth={2.6} />
                          </div>
                          <p className="mt-4 text-[clamp(20px,3vw,30px)] font-semibold tracking-[-0.03em] text-white">
                            {cameraError.title}
                          </p>
                          <p className="scan-kiosk-helper mt-3 text-white/68">
                            {cameraError.detail}
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            className="mt-5 rounded-full px-5"
                            onClick={handleRetryCamera}
                          >
                            <RefreshCw className="h-4 w-4" />
                            Retry camera
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </motion.div>
                </div>

                <div className="w-full max-w-[34rem] space-y-3">
                  <p className="scan-kiosk-helper font-medium tracking-[-0.02em] text-white/82">
                    {framePrompt}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-white/76">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 backdrop-blur-xl">
                      <ScanLine className="h-4 w-4 text-cyan-100" />
                      <span>{frameStatusLabel}</span>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 backdrop-blur-xl">
                      <Sparkles className="h-4 w-4 text-cyan-100" />
                      <span>{cameraProfileLabel}</span>
                    </div>
                    <AnimatePresence mode="wait">
                      {mobileTransientNotice ? (
                        <motion.div
                          key={mobileTransientNotice}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 backdrop-blur-xl"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.25, ease: "easeOut" }}
                        >
                          <ShieldCheck className="h-4 w-4 text-emerald-200" />
                          <span>{mobileTransientNotice}</span>
                        </motion.div>
                      ) : (
                        <motion.div
                          key={liveAssistHint}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 backdrop-blur-xl"
                          initial={{ opacity: 0.8 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0.8 }}
                          transition={{ duration: 0.2 }}
                        >
                          <ShieldCheck className="h-4 w-4 text-emerald-200" />
                          <span>{liveAssistHint}</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="scan-kiosk-small uppercase tracking-[0.32em] text-white/36">
                  Device {DEVICE_ID}
                </div>
          </div>
          </div>
        </motion.section>
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
        {scanPayload && showResultOverlay ? (
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
    </main>
  );
};

export default ScanPage;
