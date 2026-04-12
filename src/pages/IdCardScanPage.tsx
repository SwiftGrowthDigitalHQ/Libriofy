import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  type Html5QrcodeCameraScanConfig,
} from "html5-qrcode";
import {
  CameraOff,
  CheckCircle2,
  Loader2,
  LogIn,
  LogOut,
  RefreshCcw,
  ScanLine,
  ShieldCheck,
  StopCircle,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  clearStoredLibraryBinding,
  readStoredLibraryAccessKey,
  readStoredLibraryId,
  writeDeviceSetupNotice,
} from "@/lib/deviceKiosk";
import {
  createAttendanceQueueEntry,
  countAttendanceQueueEntries,
  readLastAttendanceSyncAt,
  submitAttendanceScan,
  syncQueuedAttendance,
  type AttendanceQueueEntry,
  type AttendanceScanPayload,
} from "@/lib/attendanceSync";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";

type CameraErrorState = {
  title: string;
  detail: string;
};

type AudioContextConstructor = typeof AudioContext;

type ExtendedMediaTrackCapabilities = MediaTrackCapabilities & {
  exposureMode?: string[];
  focusMode?: string[];
  whiteBalanceMode?: string[];
};

type ExtendedTrackConstraintSet = MediaTrackConstraintSet & {
  exposureMode?: ConstrainDOMString;
  focusMode?: ConstrainDOMString;
  whiteBalanceMode?: ConstrainDOMString;
};

type CameraSourceSelection = {
  cameraSource: string | MediaTrackConstraints;
  profileLabel: string;
};
type CameraSourceOption = {
  constraints: MediaTrackConstraints;
  label: string;
};

type TodayAttendanceItem = {
  action: "check-in" | "check-out";
  createdAt: string;
  id: string;
  name: string;
  seat: string;
  time: string;
};

const DEVICE_ID = import.meta.env.VITE_SCAN_DEVICE_ID ?? "LIB_GATE_01";
const SCAN_API_URL = import.meta.env.VITE_SCAN_API_URL ?? "/api/attendance/scan";
const SCAN_DEVICE_TOKEN = import.meta.env.VITE_SCAN_DEVICE_TOKEN ?? "";
const SCANNER_REGION_ID = "libriofy-phonepe-scanner";
const RESULT_RESET_DELAY_MS = 3000;
const DUPLICATE_SCAN_WINDOW_MS = 3000;
const SYNC_INTERVAL_MS = 30000;
const WATCHDOG_INTERVAL_MS = 4500;
const WATCHDOG_STALL_MS = 14000;
const CAMERA_START_TIMEOUT_MS = 5000;
const CAMERA_START_DELAY_MS = 300;
const CAMERA_CONTAINER_WAIT_TIMEOUT_MS = 5000;
const TODAY_LOG_LIMIT = 18;
const SOUND_STORAGE_KEY = "libriofy:scanner-sound-enabled";
const TODAY_STORAGE_PREFIX = "libriofy:attendance:today";
const SCAN_BOX_DEFAULT_EDGE = 292;
const SCAN_BOX_MIN_EDGE = 250;
const SCAN_BOX_MAX_EDGE = 320;
const SCAN_BOX_PADDING = 42;
const DEVICE_BINDING_RESET_CODES = new Set(["INVALID_LIBRARY_ID", "WRONG_LIBRARY", "DEVICE_BLOCKED"]);
const CAMERA_SOURCE_OPTIONS: CameraSourceOption[] = [
  {
    label: "Rear camera",
    constraints: {
      facingMode: "environment",
    },
  },
  {
    label: "Front camera",
    constraints: {
      facingMode: "user",
    },
  },
];
const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

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

const getTodayStorageKey = (libraryId: string | null) => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${TODAY_STORAGE_PREFIX}:${libraryId || "unknown"}:${today}`;
};

const readTodayEntries = (libraryId: string | null): TodayAttendanceItem[] => {
  if (typeof window === "undefined" || !libraryId) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getTodayStorageKey(libraryId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as TodayAttendanceItem[];
    return Array.isArray(parsed) ? parsed.slice(0, TODAY_LOG_LIMIT) : [];
  } catch {
    return [];
  }
};

const writeTodayEntries = (libraryId: string | null, entries: TodayAttendanceItem[]) => {
  if (typeof window === "undefined" || !libraryId) {
    return;
  }

  try {
    window.localStorage.setItem(getTodayStorageKey(libraryId), JSON.stringify(entries.slice(0, TODAY_LOG_LIMIT)));
  } catch {
    // Ignore local persistence failures.
  }
};

const readSoundPreference = () => {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    const stored = window.localStorage.getItem(SOUND_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
};

const formatLastSyncLabel = (value: string | null) => {
  if (!value) {
    return "--";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(parsed);
};

const normalizeAction = (value: unknown): "check-in" | "check-out" => {
  const normalized = trimText(value).toLowerCase().replace(/_/g, "-");
  return normalized === "check-out" ? "check-out" : "check-in";
};

const resolveResultTitle = (result: AttendanceScanPayload) => {
  if (result.status === "success") {
    return "Access Granted";
  }

  if (result.status === "queued") {
    return "Saved Offline";
  }

  switch (result.code) {
    case "WRONG_LIBRARY":
      return "Wrong Library";
    case "EXPIRED":
      return "Plan Expired";
    case "DEVICE_BLOCKED":
      return "Device Blocked";
    case "INVALID_LIBRARY_ID":
      return "Reconnect Scanner";
    case "TOO_FREQUENT":
      return "Hold A Moment";
    default:
      return "Invalid QR";
  }
};

const resolveResultMessage = (result: AttendanceScanPayload) => {
  if (result.status === "success") {
    return result.message ?? (result.action === "check-out" ? "Checked out successfully." : "Checked in successfully.");
  }

  if (result.status === "queued") {
    return result.message;
  }

  return result.message || "Invalid QR";
};

const getCameraErrorState = (error: unknown): CameraErrorState => {
  if (!window.isSecureContext) {
    return {
      title: "Camera needs HTTPS",
      detail: "Open this scanner over HTTPS so the browser can grant camera access.",
    };
  }

  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return {
        title: "Camera permission denied",
        detail: "Allow camera access to keep scanning cards automatically.",
      };
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return {
        title: "No camera found",
        detail: "This device does not expose a usable camera.",
      };
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return {
        title: "Camera busy",
        detail: "Another app or tab is already using the camera. Close it and retry.",
      };
    }

    if (error.name === "SecurityError") {
      return {
        title: "Camera blocked",
        detail: "Browser security settings blocked camera access for this page.",
      };
    }
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("camera_start_timeout") || message.includes("scanner_container_missing")) {
      return {
        title: "Camera failed to start",
        detail: "Camera failed to start. Please retry.",
      };
    }
  }

  return {
    title: "Camera unavailable",
    detail: getSafeErrorMessage(error, "Unable to start the camera right now."),
  };
};

const IdCardScanPage = () => {
  const navigate = useNavigate();
  const [cameraInitializing, setCameraInitializing] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<CameraErrorState | null>(null);
  const [cameraStopped, setCameraStopped] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [scanResult, setScanResult] = useState<AttendanceScanPayload | null>(null);
  const [statusMessage, setStatusMessage] = useState("Starting camera...");
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() => readLastAttendanceSyncAt());
  const [syncing, setSyncing] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(readSoundPreference);
  const [todayEntries, setTodayEntries] = useState<TodayAttendanceItem[]>([]);
  const [scanBoxEdge, setScanBoxEdge] = useState(SCAN_BOX_DEFAULT_EDGE);
  const [cameraProfileLabel, setCameraProfileLabel] = useState(CAMERA_SOURCE_OPTIONS[0].label);

  const mountedRef = useRef(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerStartedRef = useRef(false);
  const scannerPausedRef = useRef(false);
  const scannerStartPromiseRef = useRef<Promise<void> | null>(null);
  const isStartingRef = useRef(false);
  const scannerReadyAtRef = useRef(0);
  const lastAcceptedScanRef = useRef<{ at: number; value: string }>({ at: 0, value: "" });
  const resultResetTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const cameraStoppedRef = useRef(false);
  const resumeScannerRef = useRef<() => Promise<void>>(async () => undefined);
  const handleDecodedRef = useRef<(rawValue: string) => Promise<void>>(async () => undefined);

  const deviceLibraryId = readStoredLibraryId();

  const clearResultResetTimer = useCallback(() => {
    if (resultResetTimerRef.current !== null) {
      window.clearTimeout(resultResetTimerRef.current);
      resultResetTimerRef.current = null;
    }
  }, []);

  const syncQueueStats = useCallback(async () => {
    try {
      const [count, syncAt] = await Promise.all([countAttendanceQueueEntries(), Promise.resolve(readLastAttendanceSyncAt())]);
      if (mountedRef.current) {
        setPendingCount(count);
        setLastSyncAt(syncAt);
      }
    } catch {
      if (mountedRef.current) {
        setPendingCount(0);
        setLastSyncAt(readLastAttendanceSyncAt());
      }
    }
  }, []);

  const getAudioContext = useCallback(async () => {
    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;

    if (!AudioContextCtor || !soundEnabled) {
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
  }, [soundEnabled]);

  const playFeedbackTone = useCallback(
    async (tone: "detect" | "error" | "success") => {
      const context = await getAudioContext();
      if (!context) {
        return;
      }

      const now = context.currentTime + 0.01;
      const notes =
        tone === "success"
          ? [
              { duration: 0.08, frequency: 660 },
              { duration: 0.11, frequency: 880 },
            ]
          : tone === "error"
            ? [
                { duration: 0.14, frequency: 260 },
                { duration: 0.18, frequency: 180 },
              ]
            : [{ duration: 0.05, frequency: 920 }];

      let cursor = now;
      for (const note of notes) {
        const oscillator = context.createOscillator();
        const gainNode = context.createGain();

        oscillator.type = tone === "error" ? "sawtooth" : "sine";
        oscillator.frequency.setValueAtTime(note.frequency, cursor);

        gainNode.gain.setValueAtTime(0.0001, cursor);
        gainNode.gain.exponentialRampToValueAtTime(0.12, cursor + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, cursor + note.duration);

        oscillator.connect(gainNode);
        gainNode.connect(context.destination);
        oscillator.start(cursor);
        oscillator.stop(cursor + note.duration + 0.03);

        cursor += note.duration * 0.86;
      }
    },
    [getAudioContext],
  );

  const vibrateFeedback = useCallback((pattern: number | number[]) => {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  }, []);

  const persistTodayEntries = useCallback((entries: TodayAttendanceItem[]) => {
    writeTodayEntries(readStoredLibraryId(), entries);
  }, []);

  const appendTodayEntry = useCallback(
    (payload: Extract<AttendanceScanPayload, { status: "success" }>) => {
      if (payload.duplicate) {
        return;
      }

      const nextEntry: TodayAttendanceItem = {
        action: payload.action,
        createdAt: new Date().toISOString(),
        id: `${payload.action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: payload.studentName,
        seat: payload.seat,
        time: payload.time,
      };

      setTodayEntries((current) => {
        const next = [nextEntry, ...current].slice(0, TODAY_LOG_LIMIT);
        persistTodayEntries(next);
        return next;
      });
    },
    [persistTodayEntries],
  );

  const resolveScanBoxEdge = useCallback((viewfinderWidth: number, viewfinderHeight: number) => {
    const shortestEdge = Math.max(0, Math.floor(Math.min(viewfinderWidth, viewfinderHeight)));
    const minEdge = Math.min(SCAN_BOX_MIN_EDGE, shortestEdge || SCAN_BOX_MIN_EDGE);
    const availableEdge = Math.max(0, shortestEdge - SCAN_BOX_PADDING);
    return Math.max(minEdge, Math.min(SCAN_BOX_MAX_EDGE, availableEdge || SCAN_BOX_DEFAULT_EDGE));
  }, []);

  const clearScannerRegion = useCallback(() => {
    const scannerRegion = document.getElementById(SCANNER_REGION_ID);
    if (!scannerRegion) {
      return;
    }

    scannerRegion.innerHTML = "";
  }, []);

  const hideHtml5Dashboard = useCallback(() => {
    const scannerRegion = document.getElementById(SCANNER_REGION_ID);
    if (!scannerRegion) {
      return;
    }

    const dashboardIds = [`${SCANNER_REGION_ID}__dashboard`, `${SCANNER_REGION_ID}__dashboard_section`];
    for (const dashboardId of dashboardIds) {
      const element = document.getElementById(dashboardId);
      if (element) {
        element.style.display = "none";
      }
    }

    const directWrapper = scannerRegion.firstElementChild;
    if (directWrapper instanceof HTMLElement) {
      directWrapper.style.width = "100%";
      directWrapper.style.height = "100%";
      directWrapper.style.border = "none";
    }

    const scanRegion = document.getElementById(`${SCANNER_REGION_ID}__scan_region`);
    if (scanRegion instanceof HTMLElement) {
      scanRegion.style.width = "100%";
      scanRegion.style.height = "100%";
      scanRegion.style.border = "none";
    }

    scannerRegion.querySelectorAll("video").forEach((element) => {
      if (!(element instanceof HTMLVideoElement)) {
        return;
      }

      element.style.width = "100%";
      element.style.height = "100%";
      element.style.objectFit = "cover";
    });
  }, []);

  const applyPreferredTrackControls = useCallback(
    async (scanner: Html5Qrcode) => {
      try {
        const capabilities = scanner.getRunningTrackCapabilities() as ExtendedMediaTrackCapabilities;
        const supportedControls: ExtendedTrackConstraintSet = {};

        if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
          supportedControls.focusMode = "continuous";
        }

        if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("continuous")) {
          supportedControls.exposureMode = "continuous";
        }

        if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes("continuous")) {
          supportedControls.whiteBalanceMode = "continuous";
        }

        if (!Object.keys(supportedControls).length) {
          return;
        }

        await scanner.applyVideoConstraints({
          advanced: [supportedControls],
        } as MediaTrackConstraints);
      } catch {
        // Ignore unsupported focus/exposure tuning.
      }
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

    return CAMERA_SOURCE_OPTIONS.map((option) => ({
      cameraSource: option.constraints,
      profileLabel: option.label,
    }));
  }, []);

  const stopScanner = useCallback(async () => {
    scannerStartPromiseRef.current = null;
    isStartingRef.current = false;

    const scanner = scannerRef.current;
    scannerRef.current = null;

    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        // Ignore stop failures and continue with cleanup.
      }

      try {
        await scanner.clear();
      } catch {
        // Ignore renderer cleanup failures.
      }
    }

    scannerStartedRef.current = false;
    scannerPausedRef.current = false;
    scannerReadyAtRef.current = 0;
    clearScannerRegion();

    if (mountedRef.current) {
      setCameraReady(false);
      setCameraInitializing(false);
    }
  }, [clearScannerRegion]);

  const pauseScanner = useCallback((pauseVideo = true) => {
    const scanner = scannerRef.current;
    if (!scanner || !scannerStartedRef.current || scannerPausedRef.current) {
      return;
    }

    try {
      scanner.pause(pauseVideo);
      scannerPausedRef.current = true;
    } catch {
      // Let the next retry recover if pause fails.
    }
  }, []);

  const startScanner = useCallback(async () => {
    if (!mountedRef.current || cameraStoppedRef.current) {
      return;
    }

    if (isStartingRef.current) {
      return;
    }

    if (scannerStartPromiseRef.current) {
      await scannerStartPromiseRef.current;
      return;
    }

    isStartingRef.current = true;
    const startup = (async () => {
      console.info("Starting camera...");
      setCameraInitializing(true);
      setCameraReady(false);
      setCameraError(null);
      setStatusMessage("Starting camera...");

      const libraryId = readStoredLibraryId();
      const libraryAccessKey = readStoredLibraryAccessKey();

      if (!libraryId || !libraryAccessKey) {
        clearStoredLibraryBinding();
        writeDeviceSetupNotice("Reconnect this scanner to keep attendance scanning active.");
        navigate("/setup-device", { replace: true });
        return;
      }

      await stopScanner();
      await waitForElementById(SCANNER_REGION_ID, CAMERA_CONTAINER_WAIT_TIMEOUT_MS);
      await sleep(CAMERA_START_DELAY_MS);

      const cameraSources = await chooseRearCameraSource();
      if (!mountedRef.current || cameraStoppedRef.current) {
        return;
      }

      const scanConfig: Html5QrcodeCameraScanConfig = {
        fps: 12,
        aspectRatio: 1,
        disableFlip: false,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const edge = resolveScanBoxEdge(viewfinderWidth, viewfinderHeight);
          if (mountedRef.current) {
            setScanBoxEdge(edge);
          }

          return { width: edge, height: edge };
        },
      };

      let startedScanner: Html5Qrcode | null = null;
      let startedProfileLabel: string | null = null;
      let lastStartError: unknown = null;

      for (const cameraSource of cameraSources) {
        const scanner = new Html5Qrcode(SCANNER_REGION_ID, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        });

        scannerRef.current = scanner;
        setCameraProfileLabel(cameraSource.profileLabel);

        try {
          await withCameraTimeout(
            scanner.start(
              cameraSource.cameraSource,
              scanConfig,
              (decodedText) => {
                void handleDecodedRef.current(decodedText).catch(() => undefined);
              },
              () => undefined,
            ),
            CAMERA_START_TIMEOUT_MS,
            "CAMERA_START_TIMEOUT",
          );
          startedScanner = scanner;
          startedProfileLabel = cameraSource.profileLabel;
          console.info("Camera stream received");
          hideHtml5Dashboard();
          await applyPreferredTrackControls(scanner);
          break;
        } catch (error) {
          lastStartError = error;
          console.warn("Camera failed", error);
          scannerRef.current = null;
          try {
            await scanner.stop();
          } catch {
            // Ignore stream shutdown failures during camera startup recovery.
          }

          try {
            await scanner.clear();
          } catch {
            // Ignore cleanup failures.
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

      if (!mountedRef.current || cameraStoppedRef.current) {
        await stopScanner();
        return;
      }

      scannerRef.current = startedScanner;
      scannerStartedRef.current = true;
      scannerPausedRef.current = false;
      scannerReadyAtRef.current = Date.now();
      setCameraReady(true);
      setCameraInitializing(false);
      setCameraError(null);
      setCameraProfileLabel(startedProfileLabel);
      setStatusMessage(isOnline ? "Ready to scan" : "Offline queue ready");
    })()
      .catch(async (error) => {
        await stopScanner();

        if (!mountedRef.current) {
          return;
        }

        setCameraInitializing(false);
        setCameraReady(false);
        setCameraError(getCameraErrorState(error));
        setStatusMessage("Camera failed to start. Please retry.");
      })
      .finally(() => {
        isStartingRef.current = false;
        if (scannerStartPromiseRef.current === startup) {
          scannerStartPromiseRef.current = null;
        }
      });

    scannerStartPromiseRef.current = startup;
    await startup;
  }, [
    applyPreferredTrackControls,
    chooseRearCameraSource,
    hideHtml5Dashboard,
    isOnline,
    navigate,
    resolveScanBoxEdge,
    stopScanner,
  ]);

  const resumeScanner = useCallback(async () => {
    if (!mountedRef.current || cameraStoppedRef.current) {
      return;
    }

    const scanner = scannerRef.current;
    if (scanner && scannerStartedRef.current && scannerPausedRef.current) {
      try {
        scanner.resume();
        scannerPausedRef.current = false;
        scannerReadyAtRef.current = Date.now();
        setCameraReady(true);
        setCameraError(null);
        setStatusMessage(isOnline ? "Ready to scan" : "Offline queue ready");
        return;
      } catch {
        await stopScanner();
      }
    }

    await startScanner();
  }, [isOnline, startScanner, stopScanner]);

  resumeScannerRef.current = resumeScanner;

  const redirectToDeviceSetup = useCallback(
    async (message: string) => {
      clearResultResetTimer();
      await stopScanner();
      clearStoredLibraryBinding();
      writeDeviceSetupNotice(message || "Reconnect this scanner to continue.");
      navigate("/setup-device", { replace: true });
    },
    [clearResultResetTimer, navigate, stopScanner],
  );

  const syncQueuedScans = useCallback(async () => {
    if (!isOnline || !mountedRef.current) {
      return;
    }

    setSyncing(true);
    try {
      await syncQueuedAttendance({ scanApiUrl: SCAN_API_URL, deviceToken: SCAN_DEVICE_TOKEN });
      await syncQueueStats();
    } catch {
      // Keep the scanner usable even if sync fails.
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
      }
    }
  }, [isOnline, syncQueueStats]);

  const scheduleScannerReset = useCallback(
    (delayMs = RESULT_RESET_DELAY_MS) => {
      clearResultResetTimer();
      resultResetTimerRef.current = window.setTimeout(() => {
        resultResetTimerRef.current = null;
        if (!mountedRef.current) {
          return;
        }

        setScanResult(null);
        setStatusMessage(cameraStopped ? "Camera stopped" : isOnline ? "Ready to scan" : "Offline queue ready");

        if (!cameraStopped) {
          void resumeScannerRef.current();
        }
      }, delayMs);
    },
    [cameraStopped, clearResultResetTimer, isOnline],
  );

  const handleDecoded = useCallback(
    async (rawValue: string) => {
      const normalizedRawValue = trimText(rawValue);
      if (!normalizedRawValue || isVerifying) {
        return;
      }

      const now = Date.now();
      if (
        lastAcceptedScanRef.current.value === normalizedRawValue &&
        now - lastAcceptedScanRef.current.at < DUPLICATE_SCAN_WINDOW_MS
      ) {
        return;
      }

      lastAcceptedScanRef.current = {
        value: normalizedRawValue,
        at: now,
      };

      clearResultResetTimer();
      setScanResult(null);
      setIsVerifying(true);
      setStatusMessage("Verifying attendance...");
      pauseScanner(false);
      vibrateFeedback(16);
      void playFeedbackTone("detect");

      try {
        const libraryId = readStoredLibraryId();
        const libraryAccessKey = readStoredLibraryAccessKey();

        if (!libraryId || !libraryAccessKey) {
          await redirectToDeviceSetup("Reconnect this scanner to continue scanning.");
          return;
        }

        const scanEntry: AttendanceQueueEntry = createAttendanceQueueEntry({
          deviceId: DEVICE_ID,
          studentId: "",
          libraryId,
          libraryAccessKey,
          qrCode: normalizedRawValue,
          timestamp: new Date().toISOString(),
        });

        const payload = await submitAttendanceScan({
          entry: scanEntry,
          scanApiUrl: SCAN_API_URL,
          deviceToken: SCAN_DEVICE_TOKEN,
        });

        if (!mountedRef.current) {
          return;
        }

        const normalizedPayload =
          payload.status === "error" && (!payload.code || payload.code === "INVALID_QR")
            ? { ...payload, message: "Invalid QR" }
            : payload;

        setScanResult(normalizedPayload);

        if (normalizedPayload.status === "success") {
          setStatusMessage("Access Granted");
          appendTodayEntry(normalizedPayload);
          vibrateFeedback([20, 36, 18]);
          await playFeedbackTone("success");
        } else if (normalizedPayload.status === "queued") {
          setStatusMessage("Saved offline");
          vibrateFeedback([18, 32, 16]);
          await playFeedbackTone("success");
        } else {
          setStatusMessage(normalizedPayload.message || "Invalid QR");
          vibrateFeedback([28, 60, 20]);
          await playFeedbackTone("error");

          if (normalizedPayload.code && DEVICE_BINDING_RESET_CODES.has(normalizedPayload.code)) {
            await redirectToDeviceSetup(normalizedPayload.message || "Reconnect this scanner to continue.");
            return;
          }
        }

        await syncQueueStats();
        if (isOnline) {
          void syncQueuedScans();
        }

        scheduleScannerReset();
      } catch {
        if (!mountedRef.current) {
          return;
        }

        setScanResult({
          code: "SERVER_ERROR",
          message: "API failure. Please retry.",
          status: "error",
          success: false,
        });
        setStatusMessage("API failure");
        vibrateFeedback([28, 60, 20]);
        await playFeedbackTone("error");
        scheduleScannerReset();
      } finally {
        if (mountedRef.current) {
          setIsVerifying(false);
        }
      }
    },
    [
      appendTodayEntry,
      clearResultResetTimer,
      isOnline,
      isVerifying,
      pauseScanner,
      playFeedbackTone,
      redirectToDeviceSetup,
      scheduleScannerReset,
      syncQueueStats,
      syncQueuedScans,
      vibrateFeedback,
    ],
  );

  handleDecodedRef.current = handleDecoded;

  const handleRetryCamera = useCallback(() => {
    cameraStoppedRef.current = false;
    setCameraStopped(false);
    setCameraError(null);
    setStatusMessage("Starting camera...");
    void stopScanner()
      .catch(() => undefined)
      .finally(() => {
        void startScanner();
      });
  }, [startScanner, stopScanner]);

  const handleStopCamera = useCallback(() => {
    clearResultResetTimer();
    cameraStoppedRef.current = true;
    setCameraStopped(true);
    setStatusMessage("Camera stopped");
    void stopScanner();
  }, [clearResultResetTimer, stopScanner]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((current) => {
      const next = !current;

      try {
        window.localStorage.setItem(SOUND_STORAGE_KEY, String(next));
      } catch {
        // Ignore preference persistence failures.
      }

      return next;
    });
  }, []);

  const helperText = cameraError
    ? cameraError.detail
    : isVerifying
      ? "QR detected. Verifying attendance..."
      : scanResult
        ? resolveResultMessage(scanResult)
        : cameraStopped
          ? "Camera paused. Tap retry to resume scanning."
          : !isOnline
            ? "Offline queue mode is active. Scans will sync when connectivity returns."
            : "Show the QR clearly inside the scanning frame.";

  const formattedLastSyncAt = useMemo(() => formatLastSyncLabel(lastSyncAt), [lastSyncAt]);
  const cameraLive = cameraReady && !cameraInitializing && !cameraError && !cameraStopped;
  const scanAction = scanResult?.status === "success" ? normalizeAction(scanResult.action) : null;

  useEffect(() => {
    mountedRef.current = true;
    setTodayEntries(readTodayEntries(deviceLibraryId));
    void syncQueueStats();
    void startScanner();

    return () => {
      mountedRef.current = false;
      clearResultResetTimer();
      void stopScanner();
    };
  }, [clearResultResetTimer, deviceLibraryId, startScanner, stopScanner, syncQueueStats]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (!cameraStoppedRef.current && !isVerifying && !scanResult) {
          void startScanner();
        }
      } else {
        void stopScanner();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isVerifying, scanResult, startScanner, stopScanner]);

  useEffect(() => {
    cameraStoppedRef.current = cameraStopped;
  }, [cameraStopped]);

  useEffect(() => {
    if (!mountedRef.current) {
      return;
    }

    if (!deviceLibraryId) {
      setTodayEntries([]);
      return;
    }

    setTodayEntries(readTodayEntries(deviceLibraryId));
  }, [deviceLibraryId]);

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    void syncQueuedScans();
    const intervalId = window.setInterval(() => {
      void syncQueuedScans();
    }, SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOnline, syncQueuedScans]);

  useEffect(() => {
    if (!cameraLive || isVerifying) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!scannerStartedRef.current || scannerPausedRef.current) {
        return;
      }

      if (Date.now() - scannerReadyAtRef.current > WATCHDOG_STALL_MS) {
        void startScanner();
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [cameraLive, isVerifying, startScanner]);

  useEffect(() => {
    if (!cameraLive || cameraStopped || isVerifying || scanResult) {
      return;
    }

    const idleTimer = window.setTimeout(() => {
      if (mountedRef.current) {
        setStatusMessage(isOnline ? "No QR detected yet. Hold steady inside frame." : "Offline queue ready");
      }
    }, 2600);

    return () => {
      window.clearTimeout(idleTimer);
    };
  }, [cameraLive, cameraStopped, isOnline, isVerifying, scanResult]);

  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_28%),linear-gradient(180deg,_#04070f_0%,_#07111d_52%,_#03060e_100%)] px-4 py-4 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-7xl flex-col gap-4">
        <header className="rounded-[28px] border border-white/10 bg-white/[0.05] px-5 py-5 shadow-[0_18px_70px_rgba(2,8,23,0.35)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-[260px] items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                <ScanLine className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-100/70">Libriofy</p>
                <h1 className="text-[clamp(28px,4vw,42px)] font-semibold tracking-[-0.04em] text-white">Scan Your ID Card</h1>
                <p className="mt-1 text-sm text-white/70">{helperText}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full border border-white/15 bg-white/[0.07] px-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/85 hover:bg-white/[0.12]"
                onClick={handleRetryCamera}
                disabled={cameraInitializing || isVerifying}
              >
                <RefreshCcw className={cn("h-3.5 w-3.5", cameraInitializing ? "animate-spin" : "")} />
                Retry Camera
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full border border-white/15 bg-white/[0.07] px-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/85 hover:bg-white/[0.12]"
                onClick={handleStopCamera}
                disabled={!cameraLive || isVerifying}
              >
                <StopCircle className="h-3.5 w-3.5" />
                Stop Camera
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="rounded-full border border-white/15 bg-white/[0.07] px-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/85 hover:bg-white/[0.12]"
                onClick={toggleSound}
              >
                {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                {soundEnabled ? "Sound On" : "Sound Off"}
              </Button>

              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em]",
                  isOnline ? "border-emerald-300/25 bg-emerald-300/12 text-emerald-50" : "border-amber-300/25 bg-amber-300/12 text-amber-50",
                )}
              >
                {isOnline ? <ShieldCheck className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                <span>{isOnline ? "Online" : "Offline"}</span>
              </div>

              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em]",
                  syncing || pendingCount > 0 ? "border-cyan-300/25 bg-cyan-300/12 text-cyan-50" : "border-white/12 bg-white/[0.08] text-white/75",
                )}
              >
                <RefreshCcw className={cn("h-3.5 w-3.5", syncing ? "animate-spin" : "")} />
                <span>{syncing ? "Syncing" : pendingCount > 0 ? `${pendingCount} queued` : "Synced"}</span>
              </div>

              <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.08] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                <span>Last Sync {formattedLastSyncAt}</span>
              </div>
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_360px]">
          <div className="rounded-[32px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_24px_80px_rgba(2,8,23,0.32)] backdrop-blur">
            <div className="relative aspect-[0.84] overflow-hidden rounded-[28px] border border-white/10 bg-black">
              <div
                id={SCANNER_REGION_ID}
                className={cn(
                  "absolute inset-0 overflow-hidden [&>div]:!h-full [&>div]:!w-full [&_video]:!h-full [&_video]:!w-full [&_video]:!object-cover",
                  cameraLive ? "opacity-100" : "opacity-55",
                )}
              />

              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(8,47,73,0.06),_transparent_58%)]" />

              <div
                className="pointer-events-none absolute left-1/2 top-1/2 rounded-[28px] border border-cyan-100/18 bg-transparent"
                style={{
                  height: `${scanBoxEdge}px`,
                  transform: "translate(-50%, -50%)",
                  width: `${scanBoxEdge}px`,
                }}
              />

              <div
                className="pointer-events-none absolute left-1/2 top-1/2"
                style={{
                  height: `${scanBoxEdge}px`,
                  transform: "translate(-50%, -50%)",
                  width: `${scanBoxEdge}px`,
                }}
              >
                <span className="absolute left-0 top-0 h-16 w-16 rounded-tl-[22px] border-l-4 border-t-4 border-cyan-200/95" />
                <span className="absolute right-0 top-0 h-16 w-16 rounded-tr-[22px] border-r-4 border-t-4 border-cyan-200/95" />
                <span className="absolute bottom-0 left-0 h-16 w-16 rounded-bl-[22px] border-b-4 border-l-4 border-emerald-200/95" />
                <span className="absolute bottom-0 right-0 h-16 w-16 rounded-br-[22px] border-b-4 border-r-4 border-emerald-200/95" />
              </div>

              {cameraLive && !isVerifying && !scanResult && !cameraStopped ? (
                <motion.div
                  className="pointer-events-none absolute left-1/2 top-1/2 overflow-hidden rounded-[28px]"
                  style={{
                    height: `${scanBoxEdge}px`,
                    transform: "translate(-50%, -50%)",
                    width: `${scanBoxEdge}px`,
                  }}
                >
                  <motion.div
                    className="absolute left-5 right-5 h-[2px] rounded-full bg-gradient-to-r from-transparent via-cyan-200 to-transparent shadow-[0_0_22px_rgba(103,232,249,0.7)]"
                    animate={{ y: [12, scanBoxEdge - 18, 12] }}
                    transition={{ duration: 2.35, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
                  />
                </motion.div>
              ) : null}

              {cameraInitializing && !cameraError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/42 px-6">
                  <div className="w-full max-w-sm rounded-[26px] border border-white/10 bg-slate-950/92 p-6 text-center shadow-[0_20px_60px_rgba(2,8,23,0.45)]">
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-cyan-100" />
                    <p className="mt-4 text-2xl font-semibold tracking-tight">Starting camera...</p>
                    <p className="mt-2 text-sm text-white/70">Rear camera is being prepared for continuous QR scanning.</p>
                  </div>
                </div>
              ) : null}

              {isVerifying && !cameraError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 px-6">
                  <div className="w-full max-w-sm rounded-[26px] border border-cyan-300/20 bg-slate-950/92 p-6 text-center shadow-[0_20px_60px_rgba(2,8,23,0.45)]">
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-cyan-100" />
                    <p className="mt-4 text-2xl font-semibold tracking-tight">Verifying attendance...</p>
                    <p className="mt-2 text-sm text-white/70">QR detected. Matching the student in real time.</p>
                  </div>
                </div>
              ) : null}

              {cameraStopped && !cameraError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 px-6">
                  <div className="w-full max-w-sm rounded-[26px] border border-white/10 bg-slate-950/92 p-6 text-center shadow-[0_20px_60px_rgba(2,8,23,0.45)]">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-white/85">
                      <CameraOff className="h-8 w-8" />
                    </div>
                    <p className="mt-4 text-2xl font-semibold tracking-tight">Camera paused</p>
                    <p className="mt-2 text-sm text-white/70">Tap retry camera when you want scanning to resume.</p>
                  </div>
                </div>
              ) : null}

              {cameraError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/52 px-6">
                  <div className="w-full max-w-sm rounded-[26px] border border-rose-300/20 bg-slate-950/92 p-6 text-center shadow-[0_20px_60px_rgba(2,8,23,0.45)]">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-rose-200/20 bg-rose-400/15 text-rose-50">
                      <X className="h-8 w-8" />
                    </div>
                    <p className="mt-4 text-2xl font-semibold tracking-tight">{cameraError.title}</p>
                    <p className="mt-2 text-sm text-white/70">{cameraError.detail}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-5 rounded-full px-5"
                      onClick={handleRetryCamera}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Retry Camera
                    </Button>
                  </div>
                </div>
              ) : null}

              {scanResult ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/26 px-4">
                  <div
                    className={cn(
                      "w-full max-w-md rounded-[28px] border p-6 text-center shadow-[0_24px_70px_rgba(2,8,23,0.48)] backdrop-blur",
                      scanResult.status === "success"
                        ? "border-emerald-300/25 bg-emerald-500/14 text-emerald-50"
                        : scanResult.status === "queued"
                          ? "border-amber-300/25 bg-amber-500/14 text-amber-50"
                          : "border-rose-300/25 bg-rose-500/14 text-rose-50",
                    )}
                  >
                    <div
                      className={cn(
                        "mx-auto flex h-16 w-16 items-center justify-center rounded-full border",
                        scanResult.status === "success"
                          ? "border-emerald-200/20 bg-emerald-400/12"
                          : scanResult.status === "queued"
                            ? "border-amber-200/20 bg-amber-400/12"
                            : "border-rose-200/20 bg-rose-400/12",
                      )}
                    >
                      {scanResult.status === "success" ? (
                        <CheckCircle2 className="h-8 w-8" />
                      ) : scanResult.status === "queued" ? (
                        <ShieldCheck className="h-8 w-8" />
                      ) : (
                        <X className="h-8 w-8" />
                      )}
                    </div>

                    <p className="mt-4 text-2xl font-semibold tracking-tight">{resolveResultTitle(scanResult)}</p>
                    <p className="mt-2 text-sm leading-6 opacity-90">{resolveResultMessage(scanResult)}</p>

                    {scanResult.status === "success" ? (
                      <div className="mt-4 rounded-2xl border border-white/15 bg-black/15 p-4 text-left text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/65">Student</span>
                          <span className="font-semibold text-white">{scanResult.studentName}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-white/65">Seat</span>
                          <span className="font-semibold text-white">{scanResult.seat}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-white/65">Action</span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/10 px-3 py-1 font-semibold text-white">
                            {scanAction === "check-out" ? <LogOut className="h-3.5 w-3.5" /> : <LogIn className="h-3.5 w-3.5" />}
                            {scanAction === "check-out" ? "Check Out" : "Check In"}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-white/65">Time</span>
                          <span className="font-semibold text-white">{scanResult.time}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <div className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-2 font-semibold uppercase tracking-[0.18em] text-white/75">
                {cameraLive ? "Continuous Scan Active" : "Scanner Idle"}
              </div>
              <div className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-2 font-semibold uppercase tracking-[0.18em] text-cyan-50">
                12 FPS
              </div>
              <div className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-2 font-semibold uppercase tracking-[0.18em] text-white/75">
                {cameraProfileLabel}
              </div>
              <div className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-2 font-semibold uppercase tracking-[0.18em] text-white/75">
                Worker Assist: Native Detector
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">
              <span className="font-semibold text-white">{statusMessage}</span>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.045] p-5 shadow-[0_24px_80px_rgba(2,8,23,0.32)] backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-100/70">Today</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">Attendance Feed</h2>
                <span className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                  {todayEntries.length} scans
                </span>
              </div>
              <p className="mt-2 text-sm text-white/65">Every successful scan lands here instantly and stays visible for the rest of the day on this kiosk.</p>

              <div className="mt-5 space-y-3">
                {todayEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/12 bg-black/15 px-4 py-8 text-center text-sm text-white/55">
                    No attendance scans yet today.
                  </div>
                ) : (
                  todayEntries.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/18 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{entry.name}</p>
                          <p className="mt-1 text-xs text-white/55">Seat {entry.seat}</p>
                        </div>
                        <div
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                            entry.action === "check-out"
                              ? "border-amber-300/20 bg-amber-300/12 text-amber-50"
                              : "border-emerald-300/20 bg-emerald-300/12 text-emerald-50",
                          )}
                        >
                          {entry.action === "check-out" ? <LogOut className="h-3 w-3" /> : <LogIn className="h-3 w-3" />}
                          {entry.action === "check-out" ? "Check Out" : "Check In"}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/55">
                        <span>{entry.time}</span>
                        <span>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_50px_rgba(2,8,23,0.28)] backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Network</p>
                <p className="mt-2 text-lg font-semibold text-white">{isOnline ? "Online" : "Offline"}</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_50px_rgba(2,8,23,0.28)] backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Queue</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {syncing ? "Syncing" : pendingCount > 0 ? `${pendingCount} pending` : "Synced"}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_50px_rgba(2,8,23,0.28)] backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Device</p>
                <p className="mt-2 text-lg font-semibold text-white">{DEVICE_ID}</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_18px_50px_rgba(2,8,23,0.28)] backdrop-blur">
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Feedback</p>
                <p className="mt-2 text-lg font-semibold text-white">{soundEnabled ? "Sound + Vibration" : "Vibration Only"}</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
};

export default IdCardScanPage;
