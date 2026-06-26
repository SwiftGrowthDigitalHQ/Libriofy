/**
 * ScanKioskPageV2 — Clean Minimal Access Gate
 * 
 * Architecture: Single file with inline UI. No complex nested layouts.
 * Layout: CSS Grid with `grid-template-rows: auto 1fr auto` for header/main/footer.
 * Desktop: Two columns (scanner | info). Mobile: Single column scroll.
 * No fixed heights. No overflow issues. Pure flex/grid flow.
 */
import { startTransition, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, CircleX, Clock, QrCode, Shield, Wifi, WifiOff } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { ScannerLiveState, ScannerUiTone } from "@/components/scanner/types";
import {
  type AttendanceQueueEntry,
  type AttendanceScanDebugPayload,
  type AttendanceScanPayload,
  countAttendanceQueueEntries,
  createAttendanceQueueEntry,
  enqueueAttendanceQueueEntry,
  readLastAttendanceSyncAt,
  submitAttendanceScanDetailed,
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
import { readOfflineVerifiedStudent, rememberOfflineVerifiedStudent } from "@/lib/offlineVerifiedStudentCache";
import { resolvePublicScanDenial, sanitizeScanDisplayText, SCAN_BINDING_RESET_CODES } from "@/lib/scanDenial";
import { ScanController } from "@/lib/scan/ScanController";
import type {
  ScanControllerLogLevel,
  ScanControllerState,
  ScanDecodeMode,
  ScanDetectionPayload,
} from "@/lib/scan/types";
import { cn } from "@/lib/utils";

// ─── Config ──────────────────────────────────────────────────────────────────
const DEVICE_ID = import.meta.env.VITE_SCAN_DEVICE_ID ?? "LIB_GATE_01";
const DEVICE_NAME = import.meta.env.VITE_SCAN_DEVICE_NAME ?? "Library ID Scanner";
const SCAN_API_URL = import.meta.env.VITE_SCAN_API_URL ?? "/api/attendance/scan";
const SCAN_DEBUG_API_URL = import.meta.env.VITE_SCAN_DEBUG_API_URL ?? "/api/attendance/scan-debug";
const HEARTBEAT_URL = import.meta.env.VITE_DEVICE_HEARTBEAT_API_URL ?? "/api/device-heartbeat";
const DEVICE_TOKEN = import.meta.env.VITE_SCAN_DEVICE_TOKEN ?? "";
const QR_PUBLIC_KEY = import.meta.env.VITE_QR_PUBLIC_KEY ?? import.meta.env.VITE_STUDENT_QR_PUBLIC_KEY ?? "";
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "scanner-web";

const DUP_WINDOW_MS = 3000;
const DEBOUNCE_MS = 350;
const HOLD_MS = 350;
const HEARTBEAT_MS = 300000;
const SYNC_MS = 25000;
const MAX_HISTORY = 6;
const SUCCESS_FALLBACK_TITLE = "Verified Student";
const QUEUED_FALLBACK_TITLE = "Saved Offline";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const initials = (s: string) => s.split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
const clockFmt = (ms: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(ms);
const dateFmt = (ms: number) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(ms);
const timeFmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };

type Phase = "idle" | "scanning" | "success" | "queued" | "error";
type HistoryItem = { id: string; title: string; seat: string | null; tone: ScannerUiTone; at: string; label: string };
type DebugStage = { at: string; detail?: Record<string, unknown>; stage: string };
type ScanDebugState = {
  attendanceResponse: Record<string, unknown> | null;
  clientStages: DebugStage[];
  failureReason: string | null;
  manualResponse: Record<string, unknown> | null;
  matchedStudentId: string | null;
  metrics: {
    attendanceMs: number | null;
    decodeMs: number | null;
    roundTripMs: number | null;
    verificationMs: number | null;
  };
  parsedPayload: Record<string, unknown> | null;
  rawQrValue: string | null;
  serverDebug: AttendanceScanDebugPayload | null;
  verificationStatus: string;
};

type LiveScannerDebugState = {
  activeCameraId: string | null;
  activeCameraLabel: string | null;
  blurry: boolean | null;
  bounds: NonNullable<ScanDetectionPayload["bounds"]> | null;
  brightness: number | null;
  decodeAttempts: number;
  decodeSuccesses: number;
  edgeScore: number | null;
  facingMode: string | null;
  focusMode: string | null;
  frameRate: number | null;
  glare: boolean | null;
  lastCaptureMode: ScanDecodeMode | null;
  lastConfidence: number | null;
  lastDecodePass: string | null;
  lastFailureReason: string | null;
  lastRawPreview: string | null;
  lastTimingMs: number | null;
  lowLight: boolean | null;
  mirrored: boolean | null;
  resolutionHeight: number | null;
  resolutionWidth: number | null;
  torchEnabled: boolean;
  torchSupported: boolean;
  workerSupport: {
    barcodeDetector: boolean;
    offscreenCanvas: boolean;
  } | null;
};

const createEmptyDebugState = (): ScanDebugState => ({
  attendanceResponse: null,
  clientStages: [],
  failureReason: null,
  manualResponse: null,
  matchedStudentId: null,
  metrics: {
    attendanceMs: null,
    decodeMs: null,
    roundTripMs: null,
    verificationMs: null,
  },
  parsedPayload: null,
  rawQrValue: null,
  serverDebug: null,
  verificationStatus: "idle",
});

const createLiveScannerDebugState = (): LiveScannerDebugState => ({
  activeCameraId: null,
  activeCameraLabel: null,
  blurry: null,
  bounds: null,
  brightness: null,
  decodeAttempts: 0,
  decodeSuccesses: 0,
  edgeScore: null,
  facingMode: null,
  focusMode: null,
  frameRate: null,
  glare: null,
  lastCaptureMode: null,
  lastConfidence: null,
  lastDecodePass: null,
  lastFailureReason: null,
  lastRawPreview: null,
  lastTimingMs: null,
  lowLight: null,
  mirrored: null,
  resolutionHeight: null,
  resolutionWidth: null,
  torchEnabled: false,
  torchSupported: false,
  workerSupport: null,
});

const toneOf = (p: AttendanceScanPayload): ScannerUiTone =>
  p.status === "success" ? (p.duplicate ? "warning" : "success") : p.status === "queued" ? "info" : "danger";
const nameOf = (p: AttendanceScanPayload) => sanitizeScanDisplayText(trim(p.studentName) || trim(p.name));
const seatOf = (p: AttendanceScanPayload) => p.status === "error" ? null : trim(p.seat) || null;
const buildDeniedPayload = (code?: string, message?: string): AttendanceScanPayload => {
  const denial = resolvePublicScanDenial({
    code,
    message,
  });

  return {
    status: "error",
    success: false,
    code: denial.code,
    message: denial.message,
  };
};
const titleOf = (p: AttendanceScanPayload) => {
  if (p.status === "success") {
    return nameOf(p) || SUCCESS_FALLBACK_TITLE;
  }

  if (p.status === "queued") {
    return nameOf(p) || QUEUED_FALLBACK_TITLE;
  }

  return resolvePublicScanDenial(p).message;
};
const labelOf = (p: AttendanceScanPayload) => {
  if (p.status === "success") {
    return p.duplicate ? "Already Marked" : "Access Granted";
  }

  if (p.status === "queued") {
    return "Saved Offline";
  }

  return resolvePublicScanDenial(p).activityLabel;
};

// ─── Component ───────────────────────────────────────────────────────────────
const ScanKioskPageV2 = () => {
  const navigate = useNavigate();
  const ctrlRef = useRef<ScanController | null>(null);
  const mountRef = useRef(false);
  const procRef = useRef(false);
  const coolRef = useRef(0);
  const lastRef = useRef({ at: 0, val: "" });
  const resumeRef = useRef<number | null>(null);
  const hbRef = useRef(false);
  const syncRef = useRef(false);
  const redirectRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveScannerDebugRef = useRef<LiveScannerDebugState>(createLiveScannerDebugState());
  const liveScannerSyncAtRef = useRef(0);

  const [ctrl, setCtrl] = useState<ScanControllerState>({ activeCameraId: null, activeCameraLabel: null, devices: [], error: null, lastFrameAt: null, permissionState: null, status: "idle", torchBusy: false, torchEnabled: false, torchSupported: false });
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [phase, setPhase] = useState<Phase>("idle");
  const [payload, setPayload] = useState<AttendanceScanPayload | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pending, setPending] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [debugPanel, setDebugPanel] = useState<ScanDebugState>(() => createEmptyDebugState());
  const [liveScannerDebug, setLiveScannerDebug] = useState<LiveScannerDebugState>(() => createLiveScannerDebugState());
  const [manualStudentId, setManualStudentId] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualLoading, setManualLoading] = useState<"attendance" | "roundtrip" | null>(null);
  const debugMode = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const search = new URLSearchParams(window.location.search);
    return search.get("scanDebug") === "1" || search.get("debugScan") === "1";
  }, []);

  // Responsive activity count: 10 desktop, 5 tablet, 2 mobile
  const [visibleActivityCount, setVisibleActivityCount] = useState(() => typeof window === "undefined" ? 10 : window.innerWidth >= 1024 ? 10 : window.innerWidth >= 768 ? 5 : 2);
  useEffect(() => {
    const update = () => { const w = window.innerWidth; setVisibleActivityCount(w >= 1024 ? 10 : w >= 768 ? 5 : 2); };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Clock
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  // Online
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []);

  const refreshQ = useCallback(async () => { const c = await countAttendanceQueueEntries().catch(() => 0); if (mountRef.current) setPending(c); }, []);
  const clearResume = useCallback(() => { if (resumeRef.current !== null) { clearTimeout(resumeRef.current); resumeRef.current = null; } }, []);
  const commitLiveScannerDebug = useCallback((force = false) => {
    const timestamp = Date.now();
    if (!force && timestamp - liveScannerSyncAtRef.current < 220) {
      return;
    }

    liveScannerSyncAtRef.current = timestamp;
    setLiveScannerDebug({ ...liveScannerDebugRef.current });
  }, []);
  const updateLiveScannerDebug = useCallback((
    updater: (current: LiveScannerDebugState) => LiveScannerDebugState,
    force = false,
  ) => {
    liveScannerDebugRef.current = updater(liveScannerDebugRef.current);
    commitLiveScannerDebug(force);
  }, [commitLiveScannerDebug]);
  useEffect(() => {
    updateLiveScannerDebug((current) => ({
      ...current,
      activeCameraId: ctrl.activeCameraId,
      activeCameraLabel: ctrl.activeCameraLabel,
      torchEnabled: ctrl.torchEnabled,
      torchSupported: ctrl.torchSupported,
    }), true);
  }, [ctrl.activeCameraId, ctrl.activeCameraLabel, ctrl.torchEnabled, ctrl.torchSupported, updateLiveScannerDebug]);
  useEffect(() => {
    const syncTrackSettings = () => {
      const track = ctrlRef.current?.getActiveTrack();
      if (!track) {
        return;
      }

      const settings = track.getSettings() as MediaTrackSettings & {
        focusMode?: string;
      };
      updateLiveScannerDebug((current) => ({
        ...current,
        activeCameraId:
          typeof settings.deviceId === "string" && settings.deviceId.trim()
            ? settings.deviceId
            : current.activeCameraId,
        facingMode: typeof settings.facingMode === "string" ? settings.facingMode : current.facingMode,
        focusMode: typeof settings.focusMode === "string" ? settings.focusMode : current.focusMode,
        frameRate: typeof settings.frameRate === "number" ? Number(settings.frameRate.toFixed(1)) : current.frameRate,
        mirrored: settings.facingMode === "user",
        resolutionHeight: typeof settings.height === "number" ? settings.height : current.resolutionHeight,
        resolutionWidth: typeof settings.width === "number" ? settings.width : current.resolutionWidth,
      }));
    };

    syncTrackSettings();
    const intervalId = window.setInterval(syncTrackSettings, 1200);
    return () => window.clearInterval(intervalId);
  }, [updateLiveScannerDebug]);
  const appendDebugStage = useCallback((stage: string, detail?: Record<string, unknown>) => {
    if (!debugMode) {
      return;
    }

    console.info("[scan-debug-ui]", {
      at: new Date().toISOString(),
      detail: detail ?? null,
      stage,
    });
    setDebugPanel((prev) => ({
      ...prev,
      clientStages: [...prev.clientStages, { at: new Date().toISOString(), stage, ...(detail ? { detail } : {}) }].slice(-18),
    }));
  }, [debugMode]);
  const resetDebugPanel = useCallback((rawQrValue: string | null, decodeMs: number | null) => {
    if (!debugMode) {
      return;
    }

    setDebugPanel({
      ...createEmptyDebugState(),
      metrics: {
        attendanceMs: null,
        decodeMs,
        roundTripMs: null,
        verificationMs: null,
      },
      rawQrValue,
      verificationStatus: rawQrValue ? "detected" : "idle",
    });
  }, [debugMode]);
  const handleScannerLog = useCallback((
    level: ScanControllerLogLevel,
    event: string,
    detail?: Record<string, unknown>,
  ) => {
    const detailRecord = detail ?? {};

    updateLiveScannerDebug((current) => {
      const next: LiveScannerDebugState = {
        ...current,
      };

      if (event === "worker-ready") {
        next.workerSupport = {
          barcodeDetector: Boolean(detailRecord.barcodeDetector),
          offscreenCanvas: Boolean(detailRecord.offscreenCanvas),
        };
      }

      if (event === "camera-started") {
        next.activeCameraId =
          typeof detailRecord.activeCameraId === "string" ? detailRecord.activeCameraId : current.activeCameraId;
        next.activeCameraLabel =
          typeof detailRecord.activeCameraLabel === "string"
            ? detailRecord.activeCameraLabel
            : current.activeCameraLabel;
        next.focusMode =
          typeof detailRecord.activeFocusMode === "string" ? detailRecord.activeFocusMode : current.focusMode;
        next.frameRate =
          typeof detailRecord.activeFrameRate === "number" ? detailRecord.activeFrameRate : current.frameRate;
        next.resolutionWidth =
          typeof detailRecord.activeWidth === "number" ? detailRecord.activeWidth : current.resolutionWidth;
        next.resolutionHeight =
          typeof detailRecord.activeHeight === "number" ? detailRecord.activeHeight : current.resolutionHeight;
        next.torchSupported =
          typeof detailRecord.torchSupported === "boolean" ? detailRecord.torchSupported : current.torchSupported;
      }

      if (event === "camera-ready") {
        next.activeCameraId =
          typeof detailRecord.activeCameraId === "string" ? detailRecord.activeCameraId : next.activeCameraId;
        next.activeCameraLabel =
          typeof detailRecord.activeCameraLabel === "string"
            ? detailRecord.activeCameraLabel
            : next.activeCameraLabel;
      }

      if (event === "decode-attempt" || event === "decode-miss" || event === "decode-success") {
        next.decodeAttempts = event === "decode-attempt" ? current.decodeAttempts + 1 : current.decodeAttempts;
        next.lastCaptureMode =
          typeof detailRecord.captureMode === "string"
            ? (detailRecord.captureMode as ScanDecodeMode)
            : current.lastCaptureMode;
        next.lastRawPreview =
          typeof detailRecord.rawValuePreview === "string" ? detailRecord.rawValuePreview : current.lastRawPreview;
        next.lastTimingMs =
          typeof detailRecord.timingMs === "number" ? detailRecord.timingMs : current.lastTimingMs;
      }

      if (event === "decode-miss" || event === "decode-success") {
        const analysis =
          detailRecord.analysis && typeof detailRecord.analysis === "object" && !Array.isArray(detailRecord.analysis)
            ? (detailRecord.analysis as Record<string, unknown>)
            : null;
        next.brightness =
          typeof analysis?.brightness === "number" ? analysis.brightness : current.brightness;
        next.blurry = typeof analysis?.blurry === "boolean" ? analysis.blurry : current.blurry;
        next.edgeScore = typeof analysis?.edgeScore === "number" ? analysis.edgeScore : current.edgeScore;
        next.glare = typeof analysis?.glare === "boolean" ? analysis.glare : current.glare;
        next.lowLight = typeof analysis?.lowLight === "boolean" ? analysis.lowLight : current.lowLight;
        next.lastConfidence =
          typeof detailRecord.confidence === "number" ? detailRecord.confidence : current.lastConfidence;
        next.lastDecodePass =
          typeof detailRecord.decodePass === "string" ? detailRecord.decodePass : current.lastDecodePass;
        next.lastFailureReason =
          typeof detailRecord.failureReason === "string"
            ? detailRecord.failureReason
            : event === "decode-success"
              ? null
              : current.lastFailureReason;
        next.bounds =
          detailRecord.bounds && typeof detailRecord.bounds === "object" && !Array.isArray(detailRecord.bounds)
            ? (detailRecord.bounds as NonNullable<ScanDetectionPayload["bounds"]>)
            : event === "decode-success"
              ? current.bounds
              : null;
      }

      if (event === "decode-success") {
        next.decodeSuccesses = current.decodeSuccesses + 1;
      }

      if (event === "engine-error" || event === "decode-fail") {
        next.lastFailureReason =
          typeof detailRecord.message === "string" ? detailRecord.message : current.lastFailureReason;
      }

      return next;
    }, event === "decode-success" || event === "camera-started" || event === "worker-ready" || level === "error");
  }, [updateLiveScannerDebug]);
  const playFeedbackTone = useCallback(async (variant: "success" | "error") => {
    if (typeof window === "undefined") {
      return;
    }

    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch {
        return;
      }
    }

    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const startAt = context.currentTime;
    const stopAt = startAt + (variant === "success" ? 0.1 : 0.14);

    oscillator.type = variant === "success" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(variant === "success" ? 880 : 320, startAt);
    if (variant === "error") {
      oscillator.frequency.exponentialRampToValueAtTime(220, startAt + 0.12);
    }

    gainNode.gain.setValueAtTime(0.0001, startAt);
    gainNode.gain.exponentialRampToValueAtTime(0.028, startAt + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(stopAt);
  }, []);
  const logVerificationOutcome = useCallback((result: AttendanceScanPayload) => {
    const denial = result.status === "error" ? resolvePublicScanDenial(result) : null;
    console.info("[scan] verification-result", {
      timestamp: new Date().toISOString(),
      result:
        result.status === "success"
          ? result.duplicate
            ? "duplicate"
            : "success"
          : result.status,
      denialCode: denial?.code ?? null,
      deviceId: DEVICE_ID,
      libraryId: readStoredLibraryId() || null,
    });
  }, []);

  const goSetup = useCallback(async (msg: string) => {
    if (redirectRef.current) return; redirectRef.current = true; procRef.current = false; clearResume();
    writeDeviceSetupNotice(msg); clearStoredLibraryBinding();
    try { await ctrlRef.current?.stop("reset"); } finally { if (mountRef.current) navigate("/setup-device", { replace: true }); }
  }, [clearResume, navigate]);

  const release = useCallback(() => {
    procRef.current = false; if (!mountRef.current) return;
    setPhase("idle"); setPayload(null);
    const c = ctrlRef.current; if (!c) return;
    const s = c.getState();
    if (s.status === "paused" && !document.hidden) c.resume("release");
    else if (s.status === "error" || s.status === "stopped") void c.retry("release").catch(() => {});
  }, []);

  const schedResume = useCallback(() => { clearResume(); resumeRef.current = window.setTimeout(release, HOLD_MS) as unknown as number; }, [clearResume, release]);

  // Heartbeat
  const heartbeat = useCallback(async () => {
    if (!online || hbRef.current || redirectRef.current) return;
    const lid = readStoredLibraryId(); const lk = readStoredLibraryAccessKey();
    if (!lid || !lk) { await goSetup("Reconnect kiosk."); return; }
    hbRef.current = true;
    try {
      const hb = await sendDeviceHeartbeat({ apiUrl: HEARTBEAT_URL, deviceId: DEVICE_ID, libraryAccessKey: lk, libraryId: lid, status: { appVersion: APP_VERSION, cameraReady: ctrl.status === "ready", deviceName: DEVICE_NAME, isOnline: online, lastSyncAt: readLastAttendanceSyncAt(), pendingCount: pending, phase } });
      if (!hb.valid) await goSetup(hb.message || "Reconnect.");
    } catch {} finally { hbRef.current = false; }
  }, [ctrl.status, goSetup, online, pending, phase]);

  // Sync
  const sync = useCallback(async () => {
    if (!online || syncRef.current || redirectRef.current) return;
    const c = await countAttendanceQueueEntries().catch(() => 0); if (c === 0) return;
    syncRef.current = true;
    try { await syncQueuedAttendance({ deviceToken: DEVICE_TOKEN, scanApiUrl: SCAN_API_URL }); } catch {} finally { syncRef.current = false; void refreshQ(); }
  }, [online, refreshQ]);

  // Process scan — use ref to avoid stale closure in scanner callback
  const runManualDebugRequest = useCallback(async (mode: "attendance" | "roundtrip") => {
    const libraryId = readStoredLibraryId();
    const libraryAccessKey = readStoredLibraryAccessKey();
    if (!libraryId || !libraryAccessKey) {
      await goSetup("Reconnect.");
      return;
    }

    const trimmedStudentId = trim(manualStudentId);
    const trimmedPhone = trim(manualPhone);
    if (!trimmedStudentId && !trimmedPhone) {
      setDebugPanel((prev) => ({
        ...prev,
        failureReason: "Enter a student ID or phone number for manual verification.",
        manualResponse: {
          status: "error",
          message: "Enter a student ID or phone number for manual verification.",
        },
      }));
      return;
    }

    setManualLoading(mode);
    appendDebugStage("manual_debug_request_started", {
      mode,
      usingPhone: Boolean(trimmedPhone),
      usingStudentId: Boolean(trimmedStudentId),
    });

    try {
      const response = await fetch(SCAN_DEBUG_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(DEVICE_TOKEN ? { "x-device-token": DEVICE_TOKEN } : {}),
        },
        body: JSON.stringify({
          action: mode === "roundtrip" ? "roundtrip" : "manual_verify",
          debug: true,
          device_id: DEVICE_ID,
          library_access_key: libraryAccessKey,
          library_id: libraryId,
          phone: trimmedPhone || undefined,
          student_id: trimmedStudentId || undefined,
          write_attendance: mode === "attendance",
        }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      appendDebugStage("manual_debug_response_received", {
        mode,
        ok: response.ok,
        status: response.status,
      });
      setDebugPanel((prev) => ({
        ...prev,
        failureReason: typeof body?.message === "string" ? body.message : prev.failureReason,
        manualResponse: body,
        serverDebug:
          body && typeof body.debug === "object" && !Array.isArray(body.debug)
            ? (body.debug as AttendanceScanDebugPayload)
            : prev.serverDebug,
        verificationStatus:
          typeof body?.status === "string"
            ? body.status
            : mode === "roundtrip"
              ? "roundtrip_complete"
              : prev.verificationStatus,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Manual debug request failed.";
      appendDebugStage("manual_debug_request_failed", {
        message,
        mode,
      });
      setDebugPanel((prev) => ({
        ...prev,
        failureReason: message,
        manualResponse: {
          status: "error",
          message,
        },
      }));
    } finally {
      setManualLoading(null);
    }
  }, [appendDebugStage, goSetup, manualPhone, manualStudentId]);
  const handleToggleTorch = useCallback(async () => {
    const controller = ctrlRef.current;
    if (!controller || !ctrl.torchSupported || ctrl.torchBusy) {
      return;
    }

    appendDebugStage("torch_toggle_requested", {
      enabled: !ctrl.torchEnabled,
    });
    try {
      await controller.toggleTorch();
    } catch (error) {
      appendDebugStage("torch_toggle_failed", {
        message: error instanceof Error ? error.message : "Unable to toggle torch.",
      });
    }
  }, [appendDebugStage, ctrl.torchBusy, ctrl.torchEnabled, ctrl.torchSupported]);
  const handleSwitchCamera = useCallback(async (cameraId?: string | null) => {
    const controller = ctrlRef.current;
    if (!controller) {
      return;
    }

    appendDebugStage("camera_switch_requested", {
      cameraId: cameraId ?? null,
    });
    try {
      await controller.switchCamera(cameraId ?? null);
    } catch (error) {
      appendDebugStage("camera_switch_failed", {
        message: error instanceof Error ? error.message : "Unable to switch camera.",
      });
    }
  }, [appendDebugStage]);
  const copyDebugLog = useCallback(async () => {
    const debugSnapshot = {
      copiedAt: new Date().toISOString(),
      controller: ctrl,
      device: {
        deviceId: DEVICE_ID,
        deviceName: DEVICE_NAME,
      },
      liveScannerDebug,
      panel: debugPanel,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(debugSnapshot, null, 2));
      appendDebugStage("debug_log_copied", {
        bytes: JSON.stringify(debugSnapshot).length,
      });
    } catch (error) {
      appendDebugStage("debug_log_copy_failed", {
        message: error instanceof Error ? error.message : "Unable to copy debug log.",
      });
    }
  }, [appendDebugStage, ctrl, debugPanel, liveScannerDebug]);

  const processRef = useRef<(raw: string, detection?: Pick<ScanDetectionPayload, "analysis" | "bounds" | "captureMode" | "confidence" | "decodePass" | "detectedAt" | "source" | "timingMs">) => void>(() => {});
  const process = useCallback(async (raw: string, detection?: Pick<ScanDetectionPayload, "analysis" | "bounds" | "captureMode" | "confidence" | "decodePass" | "detectedAt" | "source" | "timingMs">) => {
    if (procRef.current) return;
    const val = trim(raw);
    if (!val || val.length > 4096 || Date.now() < coolRef.current) return;

    procRef.current = true;
    clearResume();
    setPhase("scanning");
    setPayload(null);
    resetDebugPanel(val, detection?.timingMs ?? null);
    appendDebugStage("scan_detected", {
      captureMode: detection?.captureMode ?? null,
      confidence: detection?.confidence ?? null,
      decodeMs: detection?.timingMs ?? null,
      decodePass: detection?.decodePass ?? null,
      detector: detection?.source ?? null,
      hasAnalysis: Boolean(detection?.analysis),
    });

    try { if (typeof navigator?.vibrate === "function") navigator.vibrate(20); } catch {}
    if (import.meta.env.DEV) console.log("[scan] QR detected:", val.slice(0, 40));

    try {
      const verificationStartedAt = performance.now();
      const parsed = await parseStudentQrPayload(val, {
        allowLegacy: true,
        expectedLibraryId: readStoredLibraryId(),
        now: new Date(),
        publicKeyPem: QR_PUBLIC_KEY,
      });
      const verificationMs = Math.round(performance.now() - verificationStartedAt);
      if (import.meta.env.DEV) console.log("[scan] Parse result:", parsed ? { valid: parsed.valid, source: parsed.source, code: parsed.code } : "null");

      if (debugMode) {
        setDebugPanel((prev) => ({
          ...prev,
          failureReason: parsed && !parsed.valid ? parsed.message ?? null : null,
          matchedStudentId:
            parsed?.valid && parsed.source !== "legacy"
              ? parsed.studentId
              : parsed?.valid && parsed.source === "legacy"
                ? parsed.qrCode
                : null,
          metrics: {
            ...prev.metrics,
            verificationMs,
          },
          parsedPayload: parsed ? (parsed as unknown as Record<string, unknown>) : null,
          verificationStatus: parsed?.valid ? "parsed_valid" : "parsed_invalid",
        }));
      }
      appendDebugStage("qr_parsed", {
        code: parsed && !parsed.valid ? parsed.code ?? null : null,
        source: parsed?.source ?? null,
        valid: parsed?.valid ?? false,
        verificationMs,
      });

      if (!mountRef.current) return;
      if (!parsed || !parsed.valid) {
        const deniedPayload = buildDeniedPayload(parsed?.code ?? "INVALID_QR", parsed?.message ?? "Invalid ID");
        setPhase("error");
        setPayload(deniedPayload);
        logVerificationOutcome(deniedPayload);
        void playFeedbackTone("error");
        schedResume();
        coolRef.current = Date.now() + DEBOUNCE_MS;
        return;
      }

      const lid = readStoredLibraryId();
      const lk = readStoredLibraryAccessKey();
      if (!lid || !lk) {
        await goSetup("Reconnect.");
        return;
      }

      const sid = parsed.source === "legacy" ? parsed.qrCode : parsed.studentId;
      if (!sid) {
        const deniedPayload = buildDeniedPayload("INVALID_QR", "Invalid ID");
        setPhase("error");
        setPayload(deniedPayload);
        logVerificationOutcome(deniedPayload);
        void playFeedbackTone("error");
        schedResume();
        coolRef.current = Date.now() + DEBOUNCE_MS;
        return;
      }

      if (lastRef.current.val === sid && Date.now() - lastRef.current.at < DUP_WINDOW_MS) {
        appendDebugStage("duplicate_scan_blocked", {
          studentId: sid,
          windowMs: DUP_WINDOW_MS,
        });
        setPhase("idle");
        schedResume();
        coolRef.current = Date.now() + DEBOUNCE_MS;
        return;
      }
      lastRef.current = { at: Date.now(), val: sid };

      const entry = createAttendanceQueueEntry({
        deviceId: DEVICE_ID,
        libraryAccessKey: lk,
        libraryId: lid,
        qrCode: parsed.rawValue,
        studentId: sid,
        timestamp: new Date().toISOString(),
      });
      let res: AttendanceScanPayload;
      let serverDebug: AttendanceScanDebugPayload | null = null;
      let responseStatus: number | null = null;

      if (online) {
        try {
          if (import.meta.env.DEV) console.log("[scan] Submitting to API...");
          const attendanceStartedAt = performance.now();
          const detailed = await submitAttendanceScanDetailed({
            debug: debugMode,
            deviceToken: DEVICE_TOKEN,
            entry,
            scanApiUrl: SCAN_API_URL,
          });
          res = detailed.payload;
          serverDebug = detailed.debug;
          responseStatus = detailed.responseStatus;
          const attendanceMs = Math.round(performance.now() - attendanceStartedAt);
          if (import.meta.env.DEV) console.log("[scan] API response:", res.status, res.message);
          if (debugMode) {
            setDebugPanel((prev) => ({
              ...prev,
              attendanceResponse: {
                code: "code" in res ? res.code ?? null : null,
                message: "message" in res ? res.message ?? null : null,
                responseStatus,
                status: res.status,
              },
              failureReason: res.status === "error" ? res.message : prev.failureReason,
              metrics: {
                ...prev.metrics,
                attendanceMs,
                roundTripMs:
                  (prev.metrics.decodeMs ?? 0) + (prev.metrics.verificationMs ?? 0) + attendanceMs,
              },
              serverDebug,
              verificationStatus:
                res.status === "success"
                  ? res.duplicate
                    ? "duplicate_attendance"
                    : "attendance_saved"
                  : res.status === "queued"
                    ? "queued_offline"
                    : "attendance_denied",
            }));
          }
          appendDebugStage("attendance_api_completed", {
            attendanceMs,
            responseStatus,
            status: res.status,
          });
          if (SCAN_BINDING_RESET_CODES.has((res.code ?? "").toUpperCase())) {
            await goSetup(res.message || "Reconnect.");
            return;
          }
        } catch (err) {
          if (import.meta.env.DEV) console.log("[scan] API error, queuing:", err);
          await enqueueAttendanceQueueEntry(entry);
          const cached = readOfflineVerifiedStudent({ libraryId: lid, studentId: sid });
          res = {
            status: "queued",
            message: "Queued.",
            time: timeFmt(entry.timestamp),
            entry_id: entry.entry_id,
            ...(cached ? { verifiedOffline: true, name: cached.name, studentName: cached.name, seat: cached.seat } : {}),
          };
          appendDebugStage("attendance_api_failed", {
            message: err instanceof Error ? err.message : "Unable to submit live scan.",
          });
        }
      } else {
        await enqueueAttendanceQueueEntry(entry);
        const cached = readOfflineVerifiedStudent({ libraryId: lid, studentId: sid });
        res = {
          status: "queued",
          message: "Offline.",
          time: timeFmt(entry.timestamp),
          entry_id: entry.entry_id,
          ...(cached ? { verifiedOffline: true, name: cached.name, studentName: cached.name, seat: cached.seat } : {}),
        };
        appendDebugStage("offline_queue_write", {
          entryId: entry.entry_id,
        });
      }

      if (!mountRef.current) return;
      if (res.status === "success" && !res.duplicate) {
        rememberOfflineVerifiedStudent({
          libraryId: lid,
          name: nameOf(res) ?? SUCCESS_FALLBACK_TITLE,
          seat: seatOf(res),
          studentId: sid,
        });
      }
      appendDebugStage("ui_response_ready", {
        code: "code" in res ? res.code ?? null : null,
        message: "message" in res ? res.message ?? null : null,
        status: res.status,
      });
      setPayload(res);
      setPhase(res.status === "error" ? "error" : res.status === "queued" ? "queued" : "success");
      logVerificationOutcome(res);
      void playFeedbackTone(res.status === "error" ? "error" : "success");
      startTransition(() => {
        setHistory(prev => [{ id: uid(), title: titleOf(res), seat: seatOf(res), tone: toneOf(res), at: new Date().toISOString(), label: labelOf(res) }, ...prev].slice(0, MAX_HISTORY));
      });
      schedResume();
      coolRef.current = Date.now() + DEBOUNCE_MS;
    } finally {
      procRef.current = false;
      void refreshQ();
    }
  }, [appendDebugStage, clearResume, debugMode, goSetup, logVerificationOutcome, online, playFeedbackTone, refreshQ, resetDebugPanel, schedResume]);

  // Keep ref in sync so scanner callback always calls latest version
  useEffect(() => { processRef.current = process; }, [process]);

  // Scanner init
  useEffect(() => {
    mountRef.current = true;
    const sc = new ScanController({
      onDetect: (d: ScanDetectionPayload) => {
        if (import.meta.env.DEV) console.log("[scan] onDetect fired:", d.rawValue?.slice(0, 30));
        processRef.current(d.rawValue, {
          analysis: d.analysis,
          bounds: d.bounds,
          captureMode: d.captureMode,
          confidence: d.confidence,
          decodePass: d.decodePass,
          detectedAt: d.detectedAt,
          source: d.source,
          timingMs: d.timingMs,
        });
      },
      onLog: handleScannerLog,
      onStateChange: (s: ScanControllerState) => { if (mountRef.current) setCtrl(s); },
    });
    ctrlRef.current = sc;

    const boot = async () => {
      // Wait for video element to be available
      await new Promise<void>(resolve => { const check = () => { if (videoRef.current || !mountRef.current) resolve(); else requestAnimationFrame(check); }; check(); });
      if (!mountRef.current || !videoRef.current) return;
      sc.attachVideoElement(videoRef.current);
      await sc.init();
      if (!mountRef.current) return;
      await sc.start("page-load");
      if (import.meta.env.DEV) console.log("[scan] Scanner started, status:", sc.getState().status);
    };
    void boot().catch((e) => { console.error("[scan] Boot failed:", e); });
    const hb = setInterval(() => { void heartbeat(); }, HEARTBEAT_MS);
    const sy = setInterval(() => { void sync(); }, SYNC_MS);
    void refreshQ();
    return () => {
      mountRef.current = false;
      clearInterval(hb);
      clearInterval(sy);
      clearResume();
      void sc.stop("unmount");
      audioContextRef.current?.close().catch(() => undefined);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleScannerLog]);

  // ─── Derived state ─────────────────────────────────────────────────────────
  const live = ctrl.status === "ready" || ctrl.status === "paused";
  const activeDenial = useMemo(() => (payload?.status === "error" ? resolvePublicScanDenial(payload) : null), [payload]);
  const tone: ScannerUiTone = ctrl.error ? "danger" : payload ? toneOf(payload) : !online ? "info" : "success";
  const status = payload?.status === "success" ? (payload.duplicate ? "Already Marked" : "Access Granted") : payload?.status === "queued" ? "Saved Offline" : activeDenial ? activeDenial.message : phase === "scanning" ? "Verifying..." : ctrl.error ? "Camera Error" : !online ? "Offline Mode" : "Ready to Scan";
  const checked = history.filter(i => i.tone === "success").length;
  const denied = history.filter(i => i.tone === "danger").length;

  const toneColor = tone === "danger" ? "text-rose-400" : tone === "warning" ? "text-amber-300" : tone === "info" ? "text-cyan-400" : "text-emerald-400";
  const toneBg = tone === "danger" ? "bg-rose-500/10 border-rose-500/20" : tone === "warning" ? "bg-amber-400/10 border-amber-400/20" : tone === "info" ? "bg-cyan-500/10 border-cyan-500/20" : "bg-emerald-500/10 border-emerald-500/20";
  const toneDot = tone === "danger" ? "bg-rose-400" : tone === "warning" ? "bg-amber-300" : tone === "info" ? "bg-cyan-400" : "bg-emerald-400";
  const frameFlashToneClass =
    payload?.status === "error"
      ? "bg-rose-500/14"
      : payload?.status === "queued"
        ? "bg-cyan-400/12"
        : payload?.status === "success"
          ? payload.duplicate
            ? "bg-amber-300/12"
            : "bg-emerald-400/12"
          : null;
  const resultHeadline = payload?.status === "error" ? activeDenial?.title ?? "ACCESS DENIED" : payload?.status === "queued" ? "SAVED OFFLINE" : payload?.status === "success" ? (payload.duplicate ? "ALREADY MARKED" : "ACCESS GRANTED") : null;
  const resultMessage = payload ? titleOf(payload) : null;
  const resultMeta = payload?.status === "success" ? `${payload.duplicate ? "Attendance already recorded" : "Granted"}${seatOf(payload) ? ` | Seat ${seatOf(payload)}` : ""}` : payload?.status === "queued" ? "Stored securely for background sync" : null;
  const parsedPayloadJson = useMemo(() => JSON.stringify(debugPanel.parsedPayload, null, 2), [debugPanel.parsedPayload]);
  const attendanceResponseJson = useMemo(() => JSON.stringify(debugPanel.attendanceResponse, null, 2), [debugPanel.attendanceResponse]);
  const serverDebugJson = useMemo(() => JSON.stringify(debugPanel.serverDebug, null, 2), [debugPanel.serverDebug]);
  const manualResponseJson = useMemo(() => JSON.stringify(debugPanel.manualResponse, null, 2), [debugPanel.manualResponse]);
  const rawQrMeta = useMemo(() => {
    const rawValue = trim(debugPanel.rawQrValue);
    if (!rawValue) {
      return {
        isJwtLike: false,
        length: 0,
        preview: "--",
        segments: 0,
      };
    }

    const segments = rawValue.split(".").filter(Boolean).length;
    return {
      isJwtLike: segments === 3,
      length: rawValue.length,
      preview: rawValue.slice(0, 20),
      segments,
    };
  }, [debugPanel.rawQrValue]);
  const isCompactPreview = typeof window !== "undefined" ? window.innerWidth < 640 : false;
  const guideSizePercent = liveScannerDebug.lastCaptureMode === "full-frame"
    ? 100
    : liveScannerDebug.lastCaptureMode === "wide-square"
      ? isCompactPreview
        ? 92
        : 90
      : isCompactPreview
        ? 82
        : 78;
  const guidanceMessage =
    ctrl.error?.detail ||
    (liveScannerDebug.lowLight
      ? "Increase lighting"
      : liveScannerDebug.blurry
        ? "Hold steady"
        : liveScannerDebug.lastFailureReason === "not_found" && liveScannerDebug.decodeAttempts > 4
          ? "Move closer and center the QR"
          : liveScannerDebug.mirrored
            ? "Switch to the rear camera"
            : null);
  const guidanceToneClass = ctrl.error
    ? "border-rose-400/30 bg-rose-500/14 text-rose-100"
    : liveScannerDebug.lowLight || liveScannerDebug.blurry || liveScannerDebug.lastFailureReason === "not_found"
      ? "border-amber-300/30 bg-amber-400/12 text-amber-100"
      : "border-cyan-400/25 bg-cyan-500/10 text-cyan-100";
  const detectionOverlayStyle = useMemo(() => {
    if (!liveScannerDebug.bounds) {
      return null;
    }

    const overlayPercent = liveScannerDebug.lastCaptureMode === "full-frame" ? 100 : guideSizePercent;
    const offset = liveScannerDebug.lastCaptureMode === "full-frame" ? 0 : (100 - overlayPercent) / 2;

    return {
      left: `${offset + liveScannerDebug.bounds.left * overlayPercent}%`,
      top: `${offset + liveScannerDebug.bounds.top * overlayPercent}%`,
      width: `${Math.max(4, liveScannerDebug.bounds.width * overlayPercent)}%`,
      height: `${Math.max(4, liveScannerDebug.bounds.height * overlayPercent)}%`,
    };
  }, [guideSizePercent, liveScannerDebug.bounds, liveScannerDebug.lastCaptureMode]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="grid h-[100dvh] grid-rows-[auto_1fr_auto] overflow-hidden bg-[#0a0f1a] text-white">
      {/* ── Header ── */}
      <header className="flex items-center justify-between border-b border-white/5 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/5"><QrCode className="h-4 w-4 text-cyan-400" /></div>
          <div><p className="text-sm font-semibold">Access Gate</p><p className="text-[10px] text-white/40">Libriofy Smart Entry</p></div>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium", toneBg)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", toneDot)} />
            <span className="max-w-[9rem] truncate sm:max-w-[16rem]">{status}</span>
          </div>
          <div className={cn("flex items-center gap-1 rounded-full border px-2 py-1 text-[10px]", online ? "border-emerald-500/20 text-emerald-400" : "border-amber-500/20 text-amber-400")}>
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}{online ? "Live" : "Offline"}
          </div>
          <div className="hidden text-right sm:block"><p className="text-xs font-medium tabular-nums">{clockFmt(now)}</p><p className="text-[10px] text-white/35">{dateFmt(now)}</p></div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="grid min-h-0 grid-cols-1 gap-3 overflow-hidden p-3 sm:p-4 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">
        {/* Scanner column */}
        <div className="flex min-h-0 flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-3">
          {/* Scanner frame */}
          <div className="relative w-full max-w-[min(100%,clamp(200px,50vh,400px))] aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/40">
            <video ref={(el) => { videoRef.current = el; }} autoPlay muted playsInline className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-500", live ? "opacity-90" : "opacity-0")} />
            {payload && frameFlashToneClass ? (
              <motion.div
                key={`frame-flash-${payload.status}-${history[0]?.id ?? phase}`}
                className={cn("pointer-events-none absolute inset-0 z-[1]", frameFlashToneClass)}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.85, 0] }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            ) : null}
            {guidanceMessage ? (
              <div className={cn("absolute left-3 top-3 z-[2] rounded-full border px-2.5 py-1 text-[10px] font-medium backdrop-blur-md", guidanceToneClass)}>
                {guidanceMessage}
              </div>
            ) : null}
            {debugMode ? (
              <div className="absolute right-3 top-3 z-[2] rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] text-white/70 backdrop-blur-md">
                {liveScannerDebug.lastCaptureMode ?? "focused-square"}{liveScannerDebug.lastDecodePass ? ` | ${liveScannerDebug.lastDecodePass}` : ""}
              </div>
            ) : null}
            {/* Corners */}
            <div className="absolute inset-0 flex items-center justify-center"><div className="relative" style={{ height: `${guideSizePercent}%`, width: `${guideSizePercent}%` }}>
              <div className={cn("absolute left-0 top-0 h-6 w-6 rounded-tl-lg border-l-2 border-t-2 sm:h-8 sm:w-8", tone === "danger" ? "border-rose-400" : tone === "warning" ? "border-amber-300" : tone === "info" ? "border-cyan-300" : "border-emerald-300")} />
              <div className={cn("absolute right-0 top-0 h-6 w-6 rounded-tr-lg border-r-2 border-t-2 sm:h-8 sm:w-8", tone === "danger" ? "border-rose-400" : tone === "warning" ? "border-amber-300" : tone === "info" ? "border-cyan-300" : "border-emerald-300")} />
              <div className={cn("absolute bottom-0 left-0 h-6 w-6 rounded-bl-lg border-b-2 border-l-2 sm:h-8 sm:w-8", tone === "danger" ? "border-rose-400" : tone === "warning" ? "border-amber-300" : tone === "info" ? "border-cyan-300" : "border-emerald-300")} />
              <div className={cn("absolute bottom-0 right-0 h-6 w-6 rounded-br-lg border-b-2 border-r-2 sm:h-8 sm:w-8", tone === "danger" ? "border-rose-400" : tone === "warning" ? "border-amber-300" : tone === "info" ? "border-cyan-300" : "border-emerald-300")} />
              {live && <motion.div className={cn("absolute inset-x-2 h-[2px] rounded-full bg-gradient-to-r from-transparent via-current to-transparent", toneColor)} animate={{ top: ["10%", "88%", "10%"] }} transition={{ duration: 2, ease: "linear", repeat: Infinity }} />}
            </div></div>
            {debugMode && detectionOverlayStyle ? (
              <div
                className="pointer-events-none absolute z-[2] rounded-lg border border-emerald-300/80 bg-emerald-400/10"
                style={detectionOverlayStyle}
              />
            ) : null}
            {/* Idle state */}
            {!live && <div className="absolute inset-0 z-10 grid place-items-center bg-black/50 backdrop-blur-sm"><p className="text-xs text-white/60">{ctrl.error ? "Camera error" : "Starting camera..."}</p></div>}
            {debugMode ? (
              <div className="absolute inset-x-3 bottom-3 z-[2] grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/40 p-2 text-[10px] text-white/65 backdrop-blur-md">
                <div>
                  <p className="text-white/30">Camera</p>
                  <p className="mt-0.5">
                    {liveScannerDebug.resolutionWidth && liveScannerDebug.resolutionHeight
                      ? `${liveScannerDebug.resolutionWidth}x${liveScannerDebug.resolutionHeight}`
                      : "--"}
                    {liveScannerDebug.frameRate ? ` | ${liveScannerDebug.frameRate} fps` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-white/30">Frame</p>
                  <p className="mt-0.5">
                    {liveScannerDebug.brightness !== null ? `B ${Math.round(liveScannerDebug.brightness)}` : "B --"}
                    {liveScannerDebug.edgeScore !== null ? ` | E ${liveScannerDebug.edgeScore.toFixed(1)}` : ""}
                  </p>
                </div>
              </div>
            ) : null}
            {payload ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 rounded-xl border border-white/10 bg-[#07111c]/86 px-4 py-3 text-center shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                <p className={cn("text-[11px] font-semibold tracking-[0.28em]", payload.status === "error" ? "text-rose-300" : payload.status === "queued" ? "text-cyan-300" : payload.duplicate ? "text-amber-200" : "text-emerald-200")}>{resultHeadline}</p>
                <p className={cn("mt-1 text-sm font-semibold", payload.status === "error" ? "text-rose-100" : "text-white")}>{resultMessage}</p>
                {resultMeta ? <p className={cn("mt-1 text-xs", payload.status === "error" ? "text-rose-200/80" : "text-white/50")}>{resultMeta}</p> : null}
              </div>
            ) : null}
          </div>
          {/* Instruction */}
          <p className="text-center text-xs text-white/40">Position QR code 6-10 inches from camera</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {ctrl.devices.length > 1 ? (
              <select
                value={ctrl.activeCameraId ?? ""}
                onChange={(event) => void handleSwitchCamera(event.target.value || null)}
                className="h-8 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[11px] text-white/75 outline-none transition hover:bg-white/[0.06] focus:border-cyan-400/35"
              >
                {ctrl.devices.map((device) => (
                  <option key={device.id} value={device.id} className="bg-[#0a0f1a] text-white">
                    {device.label}
                  </option>
                ))}
              </select>
            ) : null}
            {ctrl.torchSupported ? (
              <button
                type="button"
                onClick={() => void handleToggleTorch()}
                disabled={ctrl.torchBusy}
                className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[11px] font-medium text-white/75 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ctrl.torchBusy ? "Torch..." : ctrl.torchEnabled ? "Torch On" : "Torch Off"}
              </button>
            ) : null}
          </div>
        </div>

        {/* Info column */}
        <div className="flex min-h-0 flex-col gap-2.5 overflow-hidden">
          {/* Stats row */}
          <div className="grid shrink-0 grid-cols-3 gap-2">
            {[{ l: "Checked In", v: checked, c: "text-emerald-400 border-emerald-500/20" }, { l: "Denied", v: denied, c: "text-rose-400 border-rose-500/20" }, { l: "Pending", v: pending, c: "text-cyan-400 border-cyan-500/20" }].map(s => (
              <div key={s.l} className={cn("rounded-xl border bg-white/[0.02] px-3 py-2", s.c)}>
                <p className="text-lg font-bold tabular-nums">{s.v}</p>
                <p className="text-[10px] text-white/40">{s.l}</p>
              </div>
            ))}
          </div>

          {/* Last scan */}
          <div className="shrink-0 rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-white/30">Last Verification</p>
            {history[0] ? (
              <div className="mt-2 flex items-center gap-3">
                <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full border text-sm font-bold", history[0].tone === "danger" ? "border-rose-400/50 bg-rose-500/10 text-rose-300" : history[0].tone === "warning" ? "border-amber-300/50 bg-amber-400/10 text-amber-200" : history[0].tone === "info" ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-300" : "border-emerald-400/50 bg-emerald-500/10 text-emerald-300")}>{history[0].tone === "danger" ? "!" : history[0].tone === "warning" ? "!" : initials(history[0].title)}</div>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", history[0].tone === "danger" ? "text-rose-100" : "text-white")}>{history[0].title}</p>
                  <div className="flex items-center gap-2 text-[11px] text-white/40">
                    <span className={cn(history[0].tone === "danger" ? "text-rose-400" : history[0].tone === "warning" ? "text-amber-300" : history[0].tone === "info" ? "text-cyan-400" : "text-emerald-400")}>{history[0].label}</span>
                    {history[0].seat && <span>Seat {history[0].seat}</span>}
                    <span>{timeFmt(history[0].at)}</span>
                  </div>
                </div>
              </div>
            ) : <p className="mt-2 text-xs text-white/30">Waiting for first scan...</p>}
          </div>

          {/* Activity list */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <p className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-white/30">Recent Activity</p>
            <div className="mt-2 flex-1 space-y-1.5 overflow-hidden">
              {history.length === 0 && <p className="py-4 text-center text-xs text-white/20">Scans will appear here</p>}
              {history.slice(0, visibleActivityCount).map(item => (
                <div key={item.id} className="flex items-center gap-2.5 rounded-lg bg-white/[0.02] px-2.5 py-2">
                  <div className={cn("h-1.5 w-1.5 shrink-0 rounded-full", item.tone === "danger" ? "bg-rose-400" : item.tone === "warning" ? "bg-amber-300" : item.tone === "info" ? "bg-cyan-400" : "bg-emerald-400")} />
                  {item.tone === "success" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : item.tone === "danger" ? <CircleX className="h-3.5 w-3.5 shrink-0 text-rose-400" /> : <Clock className={cn("h-3.5 w-3.5 shrink-0", item.tone === "warning" ? "text-amber-300" : "text-cyan-400")} />}
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-xs font-medium", item.tone === "danger" ? "text-rose-100" : "text-white/70")}>{item.title}</p>
                    <p className="text-[10px] text-white/30">{item.label}{item.seat ? ` | Seat ${item.seat}` : ""}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-white/25">{timeFmt(item.at)}</span>
                </div>
              ))}
            </div>
          </div>

          {debugMode ? (
            <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-300/80">Debug Panel</p>
                  <p className="mt-1 text-[11px] text-white/45">Live scan diagnostics, manual fallback, and QR roundtrip probes.</p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void copyDebugLog()}
                    className="inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 text-[10px] font-medium text-white/75 transition hover:bg-white/[0.08]"
                  >
                    Copy Log
                  </button>
                  <div className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-200">
                    {debugPanel.verificationStatus}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-white/45">
                <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                  <p className="text-white/30">Decode</p>
                  <p className="mt-1 font-medium text-white">{debugPanel.metrics.decodeMs ?? "--"} ms</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                  <p className="text-white/30">Verify</p>
                  <p className="mt-1 font-medium text-white">{debugPanel.metrics.verificationMs ?? "--"} ms</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                  <p className="text-white/30">Attendance</p>
                  <p className="mt-1 font-medium text-white">{debugPanel.metrics.attendanceMs ?? "--"} ms</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                  <p className="text-white/30">Round Trip</p>
                  <p className="mt-1 font-medium text-white">{debugPanel.metrics.roundTripMs ?? "--"} ms</p>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-white/45">
                <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                  <p className="text-white/30">Camera</p>
                  <p className="mt-1 font-medium text-white">{liveScannerDebug.activeCameraLabel || ctrl.activeCameraLabel || "--"}</p>
                  <p className="mt-1 text-white/40">
                    {liveScannerDebug.resolutionWidth && liveScannerDebug.resolutionHeight
                      ? `${liveScannerDebug.resolutionWidth}x${liveScannerDebug.resolutionHeight}`
                      : "--"}
                    {liveScannerDebug.frameRate ? ` | ${liveScannerDebug.frameRate} fps` : ""}
                  </p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                  <p className="text-white/30">Scanner</p>
                  <p className="mt-1 font-medium text-white">
                    {liveScannerDebug.decodeSuccesses}/{liveScannerDebug.decodeAttempts} reads
                  </p>
                  <p className="mt-1 text-white/40">
                    {liveScannerDebug.lastCaptureMode || "--"}
                    {liveScannerDebug.lastFailureReason ? ` | ${liveScannerDebug.lastFailureReason}` : ""}
                  </p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                  <p className="text-white/30">Frame Quality</p>
                  <p className="mt-1 font-medium text-white">
                    {liveScannerDebug.brightness !== null ? Math.round(liveScannerDebug.brightness) : "--"} brightness
                  </p>
                  <p className="mt-1 text-white/40">
                    {liveScannerDebug.edgeScore !== null ? `edge ${liveScannerDebug.edgeScore.toFixed(1)}` : "edge --"}
                    {liveScannerDebug.blurry ? " | blurry" : ""}
                    {liveScannerDebug.lowLight ? " | low-light" : ""}
                  </p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2">
                  <p className="text-white/30">Support</p>
                  <p className="mt-1 font-medium text-white">
                    {liveScannerDebug.workerSupport?.barcodeDetector ? "Native QR" : "jsQR fallback"}
                  </p>
                  <p className="mt-1 text-white/40">
                    {liveScannerDebug.workerSupport?.offscreenCanvas ? "worker canvas" : "main-thread canvas"}
                    {liveScannerDebug.focusMode ? ` | focus ${liveScannerDebug.focusMode}` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  value={manualStudentId}
                  onChange={(event) => setManualStudentId(event.target.value)}
                  placeholder="Manual student ID"
                  className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-xs text-white outline-none transition focus:border-cyan-400/40"
                />
                <input
                  value={manualPhone}
                  onChange={(event) => setManualPhone(event.target.value)}
                  placeholder="Manual phone"
                  className="h-9 rounded-lg border border-white/10 bg-black/20 px-3 text-xs text-white outline-none transition focus:border-cyan-400/40"
                />
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runManualDebugRequest("attendance")}
                  disabled={manualLoading !== null}
                  className="inline-flex h-9 items-center rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 text-xs font-medium text-cyan-100 transition hover:bg-cyan-400/14 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {manualLoading === "attendance" ? "Marking..." : "Mark By ID / Phone"}
                </button>
                <button
                  type="button"
                  onClick={() => void runManualDebugRequest("roundtrip")}
                  disabled={manualLoading !== null}
                  className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs font-medium text-white/80 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {manualLoading === "roundtrip" ? "Testing..." : "Generate + Verify Test QR"}
                </button>
              </div>

              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Scanned Payload</p>
                  <p className="mt-1 text-[10px] text-white/40">
                    length {rawQrMeta.length} | first 20 {rawQrMeta.preview} | jwt {rawQrMeta.isJwtLike ? "yes" : "no"} | segments {rawQrMeta.segments}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-white/75">{debugPanel.rawQrValue || "--"}</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Matched Student</p>
                  <p className="mt-1 font-mono text-[11px] text-white/75">{debugPanel.matchedStudentId || "--"}</p>
                  <p className="mt-1 text-[11px] text-white/45">
                    confidence {liveScannerDebug.lastConfidence ?? "--"} | decode {liveScannerDebug.lastDecodePass || "--"}
                  </p>
                  <p className="mt-1 text-[11px] text-rose-200/80">{debugPanel.failureReason || liveScannerDebug.lastFailureReason || ""}</p>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Parsed JSON</p>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-white/65">{parsedPayloadJson}</pre>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Attendance API Response</p>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-white/65">{attendanceResponseJson}</pre>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Manual / Test Route</p>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-white/65">{manualResponseJson}</pre>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Server Debug</p>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-white/65">{serverDebugJson}</pre>
                </div>
                <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Client Stages</p>
                  <div className="mt-1 space-y-1">
                    {debugPanel.clientStages.length === 0 ? <p className="text-[10px] text-white/35">No scan debug events yet.</p> : null}
                    {debugPanel.clientStages.map((stage) => (
                      <div key={`${stage.at}-${stage.stage}`} className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5">
                        <p className="text-[10px] font-medium text-white/70">{stage.stage}</p>
                        <p className="text-[10px] text-white/30">{timeFmt(stage.at)}</p>
                        {stage.detail ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-white/50">{JSON.stringify(stage.detail, null, 2)}</pre> : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="flex items-center justify-center gap-2 border-t border-white/5 px-4 py-2">
        <Shield className="h-3 w-3 text-white/20" />
        <span className="text-[10px] tracking-wider text-white/20">Secure | Smart | Seamless</span>
      </footer>
    </div>
  );
};

export default ScanKioskPageV2;
