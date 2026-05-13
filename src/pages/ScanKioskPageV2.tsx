/**
 * ScanKioskPageV2 — Premium Access Gate UI
 *
 * This is a clean redesign of the scanner kiosk interface.
 * It reuses all existing scanner logic from the original ScanKioskPage
 * but provides a modular, responsive, world-class UI.
 *
 * Architecture:
 * - UI components in src/components/scanner/v2/
 * - Scanner logic stays in this file (same as original)
 * - No fake/demo data — all real-time
 */
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { QrCode, ScanLine, Shield, Wifi, WifiOff } from "lucide-react";
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
  ActivityFeed,
  MetricCard,
  ScannerFrame,
  StatusPulse,
  VerificationCard,
} from "@/components/scanner/v2";
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

// ─── Constants ───────────────────────────────────────────────────────────────
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
const MAX_SCAN_HISTORY = 8;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const getInitials = (value: string) =>
  value.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "ID";
const createUiId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const formatClockLabel = (ts: string) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};
const formatScanTime = (ts: string) => formatClockLabel(ts);

type KioskPhase = "idle" | "scanning" | "success" | "queued" | "error";
type ScanHistoryItem = {
  at: string; confidence: number; detail: string; id: string;
  name: string; seat: string | null; statusLabel: string; studentKey: string | null; tone: ScannerUiTone;
};
type ActivityRailItem = ActivityFeedItem & { seat?: string | null };

const getToneFromPayload = (p: AttendanceScanPayload): ScannerUiTone => {
  if (p.status === "success") return p.duplicate ? "warning" : "success";
  if (p.status === "queued") return p.verifiedOffline ? "info" : "warning";
  return "danger";
};
const getConfidenceFromPayload = (p: AttendanceScanPayload) => {
  if (p.status === "success") return p.duplicate ? 88 : 99;
  if (p.status === "queued") return p.verifiedOffline ? 93 : 78;
  return 34;
};
const describeScanPayload = (p: AttendanceScanPayload) => {
  if (p.status === "success") return p.duplicate ? "Already recorded." : p.seat ? `Verified — Seat ${p.seat}` : "Verified.";
  if (p.status === "queued") return p.verifiedOffline ? "Verified offline, queued for sync." : "Queued for sync.";
  return p.message || "Verification failed.";
};
const getPayloadDisplayName = (p: AttendanceScanPayload) => p.status === "error" ? null : trimText(p.studentName) || trimText(p.name) || null;
const getPayloadSeat = (p: AttendanceScanPayload) => p.status === "error" ? null : trimText(p.seat) || null;

const triggerDetectionHaptic = () => { try { navigator?.vibrate?.(22); } catch {} };

const createInitialControllerState = (): ScanControllerState => ({
  activeCameraId: null, activeCameraLabel: null, devices: [], error: null,
  lastFrameAt: null, permissionState: null, status: "idle",
  torchBusy: false, torchEnabled: false, torchSupported: false,
});

const buildOfflineQueuedPayload = ({ entry, libraryId, parsedSource, studentId }: {
  entry: AttendanceQueueEntry; libraryId: string; parsedSource: string; studentId: string;
}): Extract<AttendanceScanPayload, { status: "queued" }> => {
  const cached = readOfflineVerifiedStudent({ libraryId, studentId });
  const verifiedOffline = Boolean(cached) || parsedSource === "signed";
  return {
    status: "queued", message: verifiedOffline ? "Verified offline." : "Saved offline.",
    time: formatScanTime(entry.timestamp), entry_id: entry.entry_id,
    ...(verifiedOffline ? { verifiedOffline: true } : {}),
    ...(cached?.name ? { name: cached.name, studentName: cached.name } : {}),
    ...(cached?.seat ? { seat: cached.seat } : {}),
  };
};

// ─── Page Component ──────────────────────────────────────────────────────────
const ScanKioskPageV2 = () => {
  const navigate = useNavigate();
  const bindingRedirectRef = useRef(false);
  const controllerRef = useRef<ScanController | null>(null);
  const cooldownRef = useRef(0);
  const heartbeatRef = useRef(false);
  const mountedRef = useRef(false);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ at: 0, value: "" });
  const resumeTimerRef = useRef<number | null>(null);
  const syncRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [controllerState, setControllerState] = useState<ScanControllerState>(createInitialControllerState);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [phase, setPhase] = useState<KioskPhase>("idle");
  const [scanPayload, setScanPayload] = useState<AttendanceScanPayload | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState(() => readLastAttendanceSyncAt());
  const [nowMs, setNowMs] = useState(Date.now);

  // ─── Clock tick ────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // ─── Online/offline ────────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ─── Queue telemetry ───────────────────────────────────────────────────────
  const refreshQueue = useCallback(async () => {
    const count = await countAttendanceQueueEntries().catch(() => 0);
    if (mountedRef.current) { setPendingCount(count); setLastSyncAt(readLastAttendanceSyncAt()); }
    return count;
  }, []);

  // ─── Scanner lifecycle ─────────────────────────────────────────────────────
  const clearResume = useCallback(() => {
    if (resumeTimerRef.current !== null) { window.clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
  }, []);

  const redirectToSetup = useCallback(async (msg: string) => {
    if (bindingRedirectRef.current) return;
    bindingRedirectRef.current = true;
    processingRef.current = false;
    clearResume();
    writeDeviceSetupNotice(msg || "Reconnect kiosk.");
    clearStoredLibraryBinding();
    try { await controllerRef.current?.stop("binding-reset"); } finally { if (mountedRef.current) navigate("/setup-device", { replace: true }); }
  }, [clearResume, navigate]);

  const releaseScanner = useCallback((reason: string) => {
    processingRef.current = false;
    if (!mountedRef.current) return;
    setPhase("idle"); setScanPayload(null);
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const st = ctrl.getState();
    if (st.status === "paused" && !document.hidden) { ctrl.resume(reason); return; }
    if (st.status === "error" || st.status === "stopped") { void ctrl.retry(reason).catch(() => {}); }
  }, []);

  const scheduleResume = useCallback((reason: string) => {
    clearResume();
    resumeTimerRef.current = window.setTimeout(() => releaseScanner(reason), RESULT_HOLD_MS);
  }, [clearResume, releaseScanner]);

  // ─── Heartbeat ─────────────────────────────────────────────────────────────
  const sendHeartbeat = useCallback(async () => {
    if (!isOnline || heartbeatRef.current || bindingRedirectRef.current) return true;
    const libId = readStoredLibraryId();
    const libKey = readStoredLibraryAccessKey();
    if (!libId || !libKey) { await redirectToSetup("Reconnect kiosk."); return false; }
    heartbeatRef.current = true;
    try {
      const queueSize = await refreshQueue();
      const hb = await sendDeviceHeartbeat({
        apiUrl: DEVICE_HEARTBEAT_API_URL, deviceId: DEVICE_ID, libraryAccessKey: libKey, libraryId: libId,
        status: { appVersion: APP_VERSION, cameraReady: controllerState.status === "ready", deviceName: DEVICE_NAME, isOnline, lastSyncAt: readLastAttendanceSyncAt(), pendingCount: queueSize, phase },
      });
      if (!hb.valid) { await redirectToSetup(hb.message || "Reconnect kiosk."); return false; }
      return true;
    } catch { return true; } finally { heartbeatRef.current = false; }
  }, [controllerState.status, isOnline, phase, redirectToSetup, refreshQueue]);

  // ─── Queue sync ────────────────────────────────────────────────────────────
  const syncQueue = useCallback(async () => {
    if (!isOnline || syncRef.current || bindingRedirectRef.current) return;
    const count = await countAttendanceQueueEntries().catch(() => 0);
    if (mountedRef.current) setPendingCount(count);
    if (count === 0) return;
    syncRef.current = true;
    try { await syncQueuedAttendance({ deviceToken: SCAN_DEVICE_TOKEN, scanApiUrl: SCAN_API_URL }); } catch {} finally { syncRef.current = false; void refreshQueue(); }
  }, [isOnline, refreshQueue]);

  // ─── Process scan ──────────────────────────────────────────────────────────
  const processScan = useCallback(async (rawValue: string) => {
    if (processingRef.current) return;
    const val = trimText(rawValue);
    if (!val || val.length > MAX_SCAN_VALUE_LENGTH || Date.now() < cooldownRef.current) return;

    processingRef.current = true;
    clearResume();
    triggerDetectionHaptic();
    setPhase("scanning"); setScanPayload(null);

    try {
      const parsed = await parseStudentQrPayload(val, {
        allowLegacy: true, expectedLibraryId: readStoredLibraryId(), now: new Date(), publicKeyPem: STUDENT_QR_PUBLIC_KEY,
      });
      if (!mountedRef.current) return;
      if (!parsed || !parsed.valid) {
        setPhase("error"); setScanPayload({ code: parsed?.code ?? "INVALID_QR", message: parsed?.message ?? "Invalid ID.", status: "error", success: false });
        scheduleResume("invalid"); cooldownRef.current = Date.now() + SCAN_DEBOUNCE_MS; return;
      }

      const libId = readStoredLibraryId(); const libKey = readStoredLibraryAccessKey();
      if (!libId || !libKey) { await redirectToSetup("Reconnect kiosk."); return; }

      const scanId = parsed.source === "legacy" ? parsed.qrCode : parsed.studentId;
      if (!scanId) { setPhase("error"); setScanPayload({ code: "INVALID_QR", message: "Invalid ID.", status: "error", success: false }); scheduleResume("no-id"); cooldownRef.current = Date.now() + SCAN_DEBOUNCE_MS; return; }

      if (lastScanRef.current.value === scanId && Date.now() - lastScanRef.current.at < DUPLICATE_SCAN_WINDOW_MS) {
        setPhase("idle"); scheduleResume("dup"); cooldownRef.current = Date.now() + SCAN_DEBOUNCE_MS; return;
      }
      lastScanRef.current = { at: Date.now(), value: scanId };

      const entry = createAttendanceQueueEntry({ deviceId: DEVICE_ID, libraryAccessKey: libKey, libraryId: libId, qrCode: parsed.rawValue, studentId: scanId, timestamp: new Date().toISOString() });
      let payload: AttendanceScanPayload;

      if (isOnline) {
        try {
          payload = await submitAttendanceScan({ deviceToken: SCAN_DEVICE_TOKEN, entry, scanApiUrl: SCAN_API_URL });
          if (DEVICE_BINDING_RESET_CODES.has(payload.code ?? "")) { await redirectToSetup(payload.message || "Reconnect kiosk."); return; }
        } catch {
          await enqueueAttendanceQueueEntry(entry);
          payload = buildOfflineQueuedPayload({ entry, libraryId: libId, parsedSource: parsed.source, studentId: scanId });
        }
      } else {
        await enqueueAttendanceQueueEntry(entry);
        payload = buildOfflineQueuedPayload({ entry, libraryId: libId, parsedSource: parsed.source, studentId: scanId });
      }

      if (!mountedRef.current) return;
      if (payload.status === "success" && !payload.duplicate) { rememberOfflineVerifiedStudent({ libraryId: libId, name: getPayloadDisplayName(payload) ?? scanId, seat: getPayloadSeat(payload), studentId: scanId }); }

      setScanPayload(payload);
      setPhase(payload.status === "error" ? "error" : payload.status === "queued" ? "queued" : "success");

      startTransition(() => {
        setScanHistory((prev) => [{
          at: new Date().toISOString(), confidence: getConfidenceFromPayload(payload), detail: describeScanPayload(payload),
          id: createUiId("scan"), name: getPayloadDisplayName(payload) || scanId, seat: getPayloadSeat(payload),
          statusLabel: payload.status === "success" ? (payload.duplicate ? "Already Marked" : "Verified") : payload.status === "queued" ? "Queued" : "Rejected",
          studentKey: scanId, tone: getToneFromPayload(payload),
        }, ...prev].slice(0, MAX_SCAN_HISTORY));
      });

      scheduleResume("done");
      cooldownRef.current = Date.now() + SCAN_DEBOUNCE_MS;
    } finally { processingRef.current = false; void refreshQueue(); }
  }, [clearResume, isOnline, redirectToSetup, refreshQueue, scheduleResume]);

  // ─── Scanner controller setup ──────────────────────────────────────────────
  const handleVideoRef = useCallback((el: HTMLVideoElement | null) => { videoRef.current = el; }, []);

  useEffect(() => {
    mountedRef.current = true;
    const ctrl = new ScanController({
      onDetection: (det: ScanDetectionPayload) => { void processScan(det.value); },
      onLog: () => {},
      onStateChange: (s: ScanControllerState) => { if (mountedRef.current) setControllerState(s); },
      preferredFacing: "environment",
    });
    controllerRef.current = ctrl;
    const startScanner = async () => {
      if (videoRef.current) { try { await ctrl.start(videoRef.current); } catch {} }
    };
    const timer = window.setTimeout(startScanner, 400);

    const hbInterval = window.setInterval(() => { void sendHeartbeat(); }, HEARTBEAT_INTERVAL_MS);
    const syncInterval = window.setInterval(() => { void syncQueue(); }, SYNC_INTERVAL_MS);
    void refreshQueue();

    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      window.clearInterval(hbInterval);
      window.clearInterval(syncInterval);
      clearResume();
      void ctrl.stop("unmount");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived UI state ──────────────────────────────────────────────────────
  const cameraLive = controllerState.status === "ready" || controllerState.status === "paused";
  const liveState: ScannerLiveState = phase === "scanning" ? "scanning" : scanPayload?.status === "success" ? "matched" : scanPayload?.status === "error" ? "failed" : !isOnline ? "offline" : cameraLive ? "ready" : "ready";

  const tone: ScannerUiTone = useMemo(() => {
    if (controllerState.error || scanPayload?.status === "error") return "danger";
    if (!isOnline || scanPayload?.status === "queued") return "info";
    if (phase === "scanning") return "info";
    if (scanPayload?.status === "success") return "success";
    return "success";
  }, [controllerState.error, isOnline, phase, scanPayload]);

  const statusLabel = useMemo(() => {
    if (scanPayload?.status === "success") return scanPayload.duplicate ? "Already marked" : "Access granted";
    if (scanPayload?.status === "queued") return "Saved offline";
    if (scanPayload?.status === "error") return "Scan failed";
    if (phase === "scanning") return "Verifying...";
    if (controllerState.error) return "Camera error";
    if (!isOnline) return "Offline mode";
    return "Ready to scan";
  }, [controllerState.error, isOnline, phase, scanPayload]);

  const statusMessage = useMemo(() => {
    if (scanPayload) return describeScanPayload(scanPayload);
    if (controllerState.error) return controllerState.error.detail ?? "Camera needs attention";
    if (!cameraLive) return "Initializing camera...";
    if (!isOnline) return "Offline — scans will sync when connected";
    return "Position QR code 6–10 inches from camera";
  }, [cameraLive, controllerState.error, isOnline, scanPayload]);

  const timeLabel = useMemo(() => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(nowMs), [nowMs]);
  const dateLabel = useMemo(() => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(nowMs), [nowMs]);

  const checkedIn = scanHistory.filter((i) => i.tone === "success").length;
  const denied = scanHistory.filter((i) => i.tone === "danger").length;
  const syncPending = pendingCount + scanHistory.filter((i) => i.tone === "warning" || i.tone === "info").length;

  const lastScan = scanHistory[0] ?? null;
  const verificationData = lastScan ? {
    avatarLabel: getInitials(lastScan.name), name: lastScan.name,
    plan: lastScan.tone === "danger" ? "Retry" : "--", seat: lastScan.seat || "--",
    statusLabel: lastScan.tone === "success" ? "ACCESS GRANTED" : lastScan.tone === "danger" ? "ACCESS DENIED" : "QUEUED",
    subtitle: lastScan.detail, tone: lastScan.tone,
  } : { avatarLabel: "ID", name: "Waiting for scan", plan: "--", seat: "--", statusLabel: "STANDBY", subtitle: "System ready", tone: "success" as ScannerUiTone };

  const activityItems: ActivityRailItem[] = scanHistory.slice(0, 6).map((i) => ({
    detail: i.tone === "success" ? "Access Granted" : i.tone === "danger" ? "Access Denied" : i.statusLabel,
    id: i.id, seat: i.seat, timestampLabel: formatClockLabel(i.at), title: i.name, tone: i.tone,
  }));

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#030810] text-white">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(6,78,130,0.15),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(6,95,70,0.08),transparent_40%)]" />
        <div className="absolute inset-0 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.5)_1px,transparent_1px)] [background-size:60px_60px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1600px] flex-col">
        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-500/20 bg-cyan-500/5">
              <QrCode className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Access Gate</h1>
              <p className="text-[11px] text-white/40">Libriofy Smart Entry</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium",
              isOnline ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-amber-500/20 bg-amber-500/5 text-amber-300"
            )}>
              {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {isOnline ? "Live" : "Offline"}
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">{timeLabel}</p>
              <p className="text-[11px] text-white/40">{dateLabel}</p>
            </div>
          </div>
        </header>

        {/* ─── Main Content ───────────────────────────────────────────────── */}
        <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:gap-6">
          {/* Left: Scanner */}
          <div className="flex flex-col items-center justify-center gap-5 lg:flex-1">
            {/* Status */}
            <StatusPulse label={statusLabel} message={statusMessage} online={isOnline} tone={tone} />

            {/* Scanner frame */}
            <ScannerFrame
              cameraLive={cameraLive}
              liveState={liveState}
              onVideoRef={handleVideoRef}
              statusLabel={statusLabel}
              tone={tone}
            />

            {/* Instruction */}
            <div className="flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.02] px-4 py-2">
              <ScanLine className="h-4 w-4 text-cyan-400/60" />
              <span className="text-xs text-white/50">Position QR 6–10 inches from camera</span>
            </div>
          </div>

          {/* Right: Info panels */}
          <div className="flex flex-col gap-4 lg:w-[380px] xl:w-[420px]">
            {/* Metrics row */}
            <div className="grid grid-cols-3 gap-3">
              <MetricCard label="Checked In" tone="success" value={String(checkedIn)} />
              <MetricCard label="Denied" tone="danger" value={String(denied)} />
              <MetricCard label="Pending" tone="info" value={String(syncPending)} />
            </div>

            {/* Last verification */}
            <VerificationCard {...verificationData} />

            {/* Activity feed */}
            <div className="flex-1 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.01] p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">Live Activity</p>
                <motion.div
                  className="h-2 w-2 rounded-full bg-emerald-400"
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </div>
              <ActivityFeed items={activityItems} />
            </div>
          </div>
        </main>

        {/* ─── Footer ─────────────────────────────────────────────────────── */}
        <footer className="border-t border-white/5 px-4 py-3 text-center sm:px-6">
          <div className="flex items-center justify-center gap-2 text-white/25">
            <Shield className="h-3.5 w-3.5" />
            <span className="text-[11px] tracking-wider">Secure · Smart · Seamless</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ScanKioskPageV2;
