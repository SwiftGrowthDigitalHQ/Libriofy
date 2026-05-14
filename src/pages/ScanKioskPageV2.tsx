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
import { readOfflineVerifiedStudent, rememberOfflineVerifiedStudent } from "@/lib/offlineVerifiedStudentCache";
import { ScanController } from "@/lib/scan/ScanController";
import type { ScanControllerState, ScanDetectionPayload } from "@/lib/scan/types";
import { cn } from "@/lib/utils";

// ─── Config ──────────────────────────────────────────────────────────────────
const DEVICE_ID = import.meta.env.VITE_SCAN_DEVICE_ID ?? "LIB_GATE_01";
const DEVICE_NAME = import.meta.env.VITE_SCAN_DEVICE_NAME ?? "Library ID Scanner";
const SCAN_API_URL = import.meta.env.VITE_SCAN_API_URL ?? "/api/attendance/scan";
const HEARTBEAT_URL = import.meta.env.VITE_DEVICE_HEARTBEAT_API_URL ?? "/api/device-heartbeat";
const DEVICE_TOKEN = import.meta.env.VITE_SCAN_DEVICE_TOKEN ?? "";
const QR_PUBLIC_KEY = import.meta.env.VITE_QR_PUBLIC_KEY ?? import.meta.env.VITE_STUDENT_QR_PUBLIC_KEY ?? "";
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "scanner-web";

const BINDING_RESET_CODES = new Set(["INVALID_LIBRARY_ID", "WRONG_LIBRARY", "DEVICE_BLOCKED"]);
const DUP_WINDOW_MS = 3000;
const DEBOUNCE_MS = 350;
const HOLD_MS = 350;
const HEARTBEAT_MS = 30000;
const SYNC_MS = 25000;
const MAX_HISTORY = 6;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const initials = (s: string) => s.split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
const clockFmt = (ms: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(ms);
const dateFmt = (ms: number) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(ms);
const timeFmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "--:--" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };

type Phase = "idle" | "scanning" | "success" | "queued" | "error";
type HistoryItem = { id: string; name: string; seat: string | null; tone: ScannerUiTone; at: string; label: string };

const toneOf = (p: AttendanceScanPayload): ScannerUiTone =>
  p.status === "success" ? (p.duplicate ? "warning" : "success") : p.status === "queued" ? "info" : "danger";
const nameOf = (p: AttendanceScanPayload) => trim(p.studentName) || trim(p.name) || null;
const seatOf = (p: AttendanceScanPayload) => p.status === "error" ? null : trim(p.seat) || null;

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

  const [ctrl, setCtrl] = useState<ScanControllerState>({ activeCameraId: null, activeCameraLabel: null, devices: [], error: null, lastFrameAt: null, permissionState: null, status: "idle", torchBusy: false, torchEnabled: false, torchSupported: false });
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [phase, setPhase] = useState<Phase>("idle");
  const [payload, setPayload] = useState<AttendanceScanPayload | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pending, setPending] = useState(0);
  const [now, setNow] = useState(Date.now);

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
  const processRef = useRef<(raw: string) => void>(() => {});
  const process = useCallback(async (raw: string) => {
    if (procRef.current) return;
    const val = trim(raw); if (!val || val.length > 4096 || Date.now() < coolRef.current) return;
    procRef.current = true; clearResume(); setPhase("scanning"); setPayload(null);
    try { if (typeof navigator?.vibrate === "function") navigator.vibrate(20); } catch {}
    console.log("[scan] QR detected:", val.slice(0, 40));

    try {
      const parsed = await parseStudentQrPayload(val, { allowLegacy: true, expectedLibraryId: readStoredLibraryId(), now: new Date(), publicKeyPem: QR_PUBLIC_KEY });
      console.log("[scan] Parse result:", parsed ? { valid: parsed.valid, source: parsed.source, code: parsed.code } : "null");
      if (!mountRef.current) return;
      if (!parsed || !parsed.valid) { setPhase("error"); setPayload({ code: parsed?.code ?? "INVALID_QR", message: parsed?.message ?? "Invalid ID", status: "error", success: false }); schedResume(); coolRef.current = Date.now() + DEBOUNCE_MS; return; }

      const lid = readStoredLibraryId(); const lk = readStoredLibraryAccessKey();
      if (!lid || !lk) { await goSetup("Reconnect."); return; }
      const sid = parsed.source === "legacy" ? parsed.qrCode : parsed.studentId;
      if (!sid) { setPhase("error"); setPayload({ code: "INVALID_QR", message: "Invalid ID", status: "error", success: false }); schedResume(); coolRef.current = Date.now() + DEBOUNCE_MS; return; }
      if (lastRef.current.val === sid && Date.now() - lastRef.current.at < DUP_WINDOW_MS) { setPhase("idle"); schedResume(); coolRef.current = Date.now() + DEBOUNCE_MS; return; }
      lastRef.current = { at: Date.now(), val: sid };

      const entry = createAttendanceQueueEntry({ deviceId: DEVICE_ID, libraryAccessKey: lk, libraryId: lid, qrCode: parsed.rawValue, studentId: sid, timestamp: new Date().toISOString() });
      let res: AttendanceScanPayload;

      if (online) {
        try {
          console.log("[scan] Submitting to API...");
          res = await submitAttendanceScan({ deviceToken: DEVICE_TOKEN, entry, scanApiUrl: SCAN_API_URL });
          console.log("[scan] API response:", res.status, res.message);
          if (BINDING_RESET_CODES.has(res.code ?? "")) { await goSetup(res.message || "Reconnect."); return; }
        } catch (err) { console.log("[scan] API error, queuing:", err); await enqueueAttendanceQueueEntry(entry); const cached = readOfflineVerifiedStudent({ libraryId: lid, studentId: sid }); res = { status: "queued", message: "Queued.", time: timeFmt(entry.timestamp), entry_id: entry.entry_id, ...(cached ? { verifiedOffline: true, name: cached.name, studentName: cached.name, seat: cached.seat } : {}) }; }
      } else { await enqueueAttendanceQueueEntry(entry); const cached = readOfflineVerifiedStudent({ libraryId: lid, studentId: sid }); res = { status: "queued", message: "Offline.", time: timeFmt(entry.timestamp), entry_id: entry.entry_id, ...(cached ? { verifiedOffline: true, name: cached.name, studentName: cached.name, seat: cached.seat } : {}) }; }

      if (!mountRef.current) return;
      if (res.status === "success" && !res.duplicate) rememberOfflineVerifiedStudent({ libraryId: lid, name: nameOf(res) ?? sid, seat: seatOf(res), studentId: sid });
      setPayload(res); setPhase(res.status === "error" ? "error" : res.status === "queued" ? "queued" : "success");
      startTransition(() => { setHistory(prev => [{ id: uid(), name: nameOf(res) || sid, seat: seatOf(res), tone: toneOf(res), at: new Date().toISOString(), label: res.status === "success" ? (res.duplicate ? "Already Marked" : "Granted") : res.status === "queued" ? "Queued" : "Denied" }, ...prev].slice(0, MAX_HISTORY)); });
      schedResume(); coolRef.current = Date.now() + DEBOUNCE_MS;
    } finally { procRef.current = false; void refreshQ(); }
  }, [clearResume, goSetup, online, refreshQ, schedResume]);

  // Keep ref in sync so scanner callback always calls latest version
  useEffect(() => { processRef.current = process; }, [process]);

  // Scanner init
  useEffect(() => {
    mountRef.current = true;
    const sc = new ScanController({ onDetect: (d: ScanDetectionPayload) => { console.log("[scan] onDetect fired:", d.rawValue?.slice(0, 30)); processRef.current(d.rawValue); }, onLog: () => {}, onStateChange: (s: ScanControllerState) => { if (mountRef.current) setCtrl(s); } });
    ctrlRef.current = sc;

    const boot = async () => {
      // Wait for video element to be available
      await new Promise<void>(resolve => { const check = () => { if (videoRef.current || !mountRef.current) resolve(); else requestAnimationFrame(check); }; check(); });
      if (!mountRef.current || !videoRef.current) return;
      sc.attachVideoElement(videoRef.current);
      await sc.init();
      if (!mountRef.current) return;
      await sc.start("page-load");
      console.log("[scan] Scanner started, status:", sc.getState().status);
    };
    void boot().catch((e) => { console.error("[scan] Boot failed:", e); });
    const hb = setInterval(() => { void heartbeat(); }, HEARTBEAT_MS);
    const sy = setInterval(() => { void sync(); }, SYNC_MS);
    void refreshQ();
    return () => { mountRef.current = false; clearInterval(hb); clearInterval(sy); clearResume(); void sc.stop("unmount"); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived state ─────────────────────────────────────────────────────────
  const live = ctrl.status === "ready" || ctrl.status === "paused";
  const tone: ScannerUiTone = ctrl.error || payload?.status === "error" ? "danger" : !online || payload?.status === "queued" ? "info" : payload?.status === "success" ? "success" : "success";
  const status = payload?.status === "success" ? (payload.duplicate ? "Already Marked" : "Access Granted") : payload?.status === "queued" ? "Saved Offline" : payload?.status === "error" ? "Denied" : phase === "scanning" ? "Verifying..." : ctrl.error ? "Camera Error" : !online ? "Offline Mode" : "Ready to Scan";
  const checked = history.filter(i => i.tone === "success").length;
  const denied = history.filter(i => i.tone === "danger").length;

  const toneColor = tone === "danger" ? "text-rose-400" : tone === "info" ? "text-cyan-400" : "text-emerald-400";
  const toneBg = tone === "danger" ? "bg-rose-500/10 border-rose-500/20" : tone === "info" ? "bg-cyan-500/10 border-cyan-500/20" : "bg-emerald-500/10 border-emerald-500/20";
  const toneDot = tone === "danger" ? "bg-rose-400" : tone === "info" ? "bg-cyan-400" : "bg-emerald-400";

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
            <span className={cn("h-1.5 w-1.5 rounded-full", toneDot)} />{status}
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
            {/* Corners */}
            <div className="absolute inset-0 flex items-center justify-center"><div className="relative h-[60%] w-[60%]">
              <div className={cn("absolute left-0 top-0 h-6 w-6 rounded-tl-lg border-l-2 border-t-2 sm:h-8 sm:w-8", tone === "danger" ? "border-rose-400" : tone === "info" ? "border-cyan-300" : "border-emerald-300")} />
              <div className={cn("absolute right-0 top-0 h-6 w-6 rounded-tr-lg border-r-2 border-t-2 sm:h-8 sm:w-8", tone === "danger" ? "border-rose-400" : tone === "info" ? "border-cyan-300" : "border-emerald-300")} />
              <div className={cn("absolute bottom-0 left-0 h-6 w-6 rounded-bl-lg border-b-2 border-l-2 sm:h-8 sm:w-8", tone === "danger" ? "border-rose-400" : tone === "info" ? "border-cyan-300" : "border-emerald-300")} />
              <div className={cn("absolute bottom-0 right-0 h-6 w-6 rounded-br-lg border-b-2 border-r-2 sm:h-8 sm:w-8", tone === "danger" ? "border-rose-400" : tone === "info" ? "border-cyan-300" : "border-emerald-300")} />
              {live && <motion.div className={cn("absolute inset-x-2 h-[2px] rounded-full bg-gradient-to-r from-transparent via-current to-transparent", toneColor)} animate={{ top: ["10%", "88%", "10%"] }} transition={{ duration: 2, ease: "linear", repeat: Infinity }} />}
            </div></div>
            {/* Idle state */}
            {!live && <div className="absolute inset-0 z-10 grid place-items-center bg-black/50 backdrop-blur-sm"><p className="text-xs text-white/60">{ctrl.error ? "Camera error" : "Starting camera..."}</p></div>}
          </div>
          {/* Instruction */}
          <p className="text-center text-xs text-white/40">Position QR code 6–10 inches from camera</p>
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
                <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full border text-sm font-bold", history[0].tone === "danger" ? "border-rose-400/50 text-rose-300" : history[0].tone === "info" ? "border-cyan-400/50 text-cyan-300" : "border-emerald-400/50 text-emerald-300")}>{initials(history[0].name)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{history[0].name}</p>
                  <div className="flex items-center gap-2 text-[11px] text-white/40">
                    <span className={cn(history[0].tone === "danger" ? "text-rose-400" : history[0].tone === "info" ? "text-cyan-400" : "text-emerald-400")}>{history[0].label}</span>
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
                  <div className={cn("h-1.5 w-1.5 shrink-0 rounded-full", item.tone === "danger" ? "bg-rose-400" : item.tone === "info" ? "bg-cyan-400" : "bg-emerald-400")} />
                  {item.tone === "success" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : item.tone === "danger" ? <CircleX className="h-3.5 w-3.5 shrink-0 text-rose-400" /> : <Clock className="h-3.5 w-3.5 shrink-0 text-cyan-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-white/70">{item.name}</p>
                    <p className="text-[10px] text-white/30">{item.label}{item.seat ? ` · Seat ${item.seat}` : ""}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-white/25">{timeFmt(item.at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="flex items-center justify-center gap-2 border-t border-white/5 px-4 py-2">
        <Shield className="h-3 w-3 text-white/20" />
        <span className="text-[10px] tracking-wider text-white/20">Secure · Smart · Seamless</span>
      </footer>
    </div>
  );
};

export default ScanKioskPageV2;
