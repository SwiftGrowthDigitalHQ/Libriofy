import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  Loader2,
  RefreshCcw,
  ScanLine,
  ShieldCheck,
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
import {
  clearStoredLibraryBinding,
  parseStudentQrPayload,
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
  type AttendanceScanPayload,
} from "@/lib/attendanceSync";
import { cn } from "@/lib/utils";

type CameraErrorState = { title: string; detail: string };

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
  advanced?: ExtendedTrackConstraintSet[];
};
type CameraProfile = {
  label: string;
  constraints: ExtendedTrackConstraints;
  preferRear?: boolean;
};

const DEVICE_ID = import.meta.env.VITE_SCAN_DEVICE_ID ?? "LIB_GATE_01";
const SCAN_API_URL = import.meta.env.VITE_SCAN_API_URL ?? "/api/scan-attendance";
const SCAN_DEVICE_TOKEN = import.meta.env.VITE_SCAN_DEVICE_TOKEN ?? "";
const STUDENT_QR_PUBLIC_KEY = import.meta.env.VITE_QR_PUBLIC_KEY ?? import.meta.env.VITE_STUDENT_QR_PUBLIC_KEY ?? "";
const SCANNER_REGION_ID = "libriofy-smart-entry-scanner";
const RESULT_RESET_DELAY_MS = 1800;
const DUPLICATE_SCAN_WINDOW_MS = 3000;
const SYNC_INTERVAL_MS = 30000;
const FALLBACK_SCAN_INTERVAL_MS = 140;
const DEVICE_BINDING_RESET_CODES = new Set(["INVALID_LIBRARY_ID", "WRONG_LIBRARY", "DEVICE_BLOCKED"]);
const REAR_CAMERA_LABEL_PATTERN = /back|rear|environment|world|traseira|trasera|camera 0/i;

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const CAMERA_PROFILES: CameraProfile[] = [
  {
    label: "Preferred rear camera",
    preferRear: true,
    constraints: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 12, max: 15 },
    },
  },
  {
    label: "Balanced rear camera",
    preferRear: true,
    constraints: {
      facingMode: { ideal: "environment" },
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 12, max: 15 },
    },
  },
  {
    label: "Any camera fallback",
    constraints: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 12, max: 15 },
    },
  },
  {
    label: "Basic camera fallback",
    constraints: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 10, max: 12 },
    },
  },
];

const buildCameraScanConfig = (): Html5QrcodeCameraScanConfig => ({
  fps: 12,
  qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
    const edge = Math.max(240, Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.76));
    return { width: edge, height: edge };
  },
  disableFlip: false,
});

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
      detail: "Open this scanner over HTTPS to use the camera.",
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
        detail: "Please allow camera permission to scan ID cards.",
      };
    }

    if (
      error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError" ||
      error.name === "OverconstrainedError"
    ) {
      return {
        title: "No camera detected",
        detail: "This device could not expose a usable camera.",
      };
    }

    if (
      error.name === "NotReadableError" ||
      error.name === "TrackStartError" ||
      error.name === "AbortError"
    ) {
      return {
        title: "Camera busy",
        detail: "The camera is already in use by another app or tab.",
      };
    }
  }

  if (error instanceof Error) {
    const message = error.message.replaceAll("_", " ").toLowerCase();

    if (
      message.includes("permission") ||
      message.includes("notallowed") ||
      message.includes("denied")
    ) {
      return {
        title: "Camera access required",
        detail: "Please allow camera permission to scan ID cards.",
      };
    }

    if (message.includes("secure context") || message.includes("https")) {
      return {
        title: "Camera access required",
        detail: "Open this scanner over HTTPS to use the camera.",
      };
    }

    if (
      message.includes("overconstrained") ||
      message.includes("constraint") ||
      message.includes("notfound") ||
      message.includes("devicesnotfound") ||
      message.includes("requested device") ||
      message.includes("no supported camera profile")
    ) {
      return {
        title: "No camera detected",
        detail: "This device could not expose a usable camera.",
      };
    }

    if (
      message.includes("camera") && message.includes("use") ||
      message.includes("notreadable") ||
      message.includes("trackstart") ||
      message.includes("aborterror") ||
      message.includes("already in use") ||
      message.includes("could not start video source")
    ) {
      return {
        title: "Camera busy",
        detail: "The camera is already in use by another app or tab.",
      };
    }
  }

  return {
    title: "Camera unavailable",
    detail: "Unable to start the camera right now.",
  };
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

const resolveResultTitle = (result: AttendanceScanPayload) => {
  if (result.status === "success") {
    return result.duplicate ? "Already Recorded" : "Entry Complete";
  }

  if (result.status === "queued") {
    return "Saved Offline";
  }

  switch (result.code) {
    case "WRONG_LIBRARY":
      return "Wrong Library";
    case "EXPIRED":
      return "Expired ID";
    case "DEVICE_BLOCKED":
      return "Device Blocked";
    case "INVALID_LIBRARY_ID":
      return "Library Not Bound";
    default:
      return "Invalid ID";
  }
};

const resolveResultMessage = (result: AttendanceScanPayload) => {
  if (result.status === "success") {
    return result.message ?? "Attendance logged instantly.";
  }

  if (result.status === "queued") {
    return result.message;
  }

  return result.message || "This ID could not be verified.";
};

const IdCardScanPage = () => {
  const navigate = useNavigate();
  const [cameraInitializing, setCameraInitializing] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<CameraErrorState | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [scanResult, setScanResult] = useState<AttendanceScanPayload | null>(null);
  const [statusMessage, setStatusMessage] = useState("Starting camera...");
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() => readLastAttendanceSyncAt());
  const [syncing, setSyncing] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchBusy, setTorchBusy] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerReadyRef = useRef(false);
  const mountedRef = useRef(false);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const lastDecodedRef = useRef<{ value: string; at: number } | null>(null);
  const torchBusyRef = useRef(false);
  const desiredTorchRef = useRef(false);
  const handleDecodedRef = useRef<((rawValue: string) => Promise<void>) | null>(null);
  const cameraProfileIndexRef = useRef(0);
  const activeVideoConstraintsRef = useRef<ExtendedTrackConstraints>(CAMERA_PROFILES[0].constraints);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackScanFrameRef = useRef<number | null>(null);
  const fallbackScanAtRef = useRef(0);

  const clearTimer = useCallback((timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearRestartTimer = useCallback(() => {
    clearTimer(restartTimerRef);
  }, [clearTimer]);

  const clearFallbackScanLoop = useCallback(() => {
    if (fallbackScanFrameRef.current !== null) {
      window.cancelAnimationFrame(fallbackScanFrameRef.current);
      fallbackScanFrameRef.current = null;
    }
  }, []);

  const getScannerVideoElement = useCallback(() => {
    const scannerRegion = document.getElementById(SCANNER_REGION_ID);
    const video = scannerRegion?.querySelector("video");
    return video instanceof HTMLVideoElement ? video : null;
  }, []);

  const readFallbackQrFromFrame = useCallback(() => {
    const video = getScannerVideoElement();
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    const canvas = fallbackCanvasRef.current ?? document.createElement("canvas");
    fallbackCanvasRef.current = canvas;

    const maxScanWidth = 960;
    const scale = width > maxScanWidth ? maxScanWidth / width : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, targetWidth, targetHeight);
    const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });

    return trimText(code?.data);
  }, [getScannerVideoElement]);

  const startFallbackScanLoop = useCallback(() => {
    clearFallbackScanLoop();
    fallbackScanAtRef.current = 0;

    const loop = () => {
      if (!mountedRef.current || !scannerReadyRef.current || processingRef.current) {
        fallbackScanFrameRef.current = null;
        return;
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - fallbackScanAtRef.current >= FALLBACK_SCAN_INTERVAL_MS) {
        fallbackScanAtRef.current = now;

        // html5-qrcode can miss glossy on-screen IDs, so read raw frames as a fallback.
        const rawValue = readFallbackQrFromFrame();
        if (rawValue) {
          fallbackScanFrameRef.current = null;
          void handleDecodedRef.current?.(rawValue).catch(() => undefined);
          return;
        }
      }

      fallbackScanFrameRef.current = window.requestAnimationFrame(loop);
    };

    fallbackScanFrameRef.current = window.requestAnimationFrame(loop);
  }, [clearFallbackScanLoop, readFallbackQrFromFrame]);

  const stopScanner = useCallback(async () => {
    clearRestartTimer();
    clearFallbackScanLoop();
    fallbackScanAtRef.current = 0;
    torchBusyRef.current = false;

    const scanner = scannerRef.current;
    if (!scanner) {
      scannerReadyRef.current = false;
      if (mountedRef.current) {
        setCameraReady(false);
        setTorchBusy(false);
        setTorchEnabled(false);
        setTorchSupported(false);
      }
      return;
    }

    try {
      if (scannerReadyRef.current) {
        await scanner.stop();
      }
    } catch {
      // Ignore stop failures and continue cleanup.
    }

    try {
      scanner.clear();
    } catch {
      // Ignore renderer cleanup failures.
    }

    scannerRef.current = null;
    scannerReadyRef.current = false;

    if (mountedRef.current) {
      setCameraReady(false);
      setTorchBusy(false);
      setTorchEnabled(false);
      setTorchSupported(false);
    }
  }, [clearRestartTimer]);

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

  const applyTrackTuning = useCallback(async (scanner: Html5Qrcode) => {
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
        ...activeVideoConstraintsRef.current,
        advanced: [supportedControls],
      } as MediaTrackConstraints);
    } catch {
      // Ignore post-start track tuning failures.
    }
  }, []);

  const chooseCameraSource = useCallback(async (): Promise<string | MediaTrackConstraints> => {
    if (!window.isSecureContext) {
      throw new Error("HTTPS_REQUIRED");
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MEDIA_DEVICES_UNSUPPORTED");
    }

    let warmupStream: MediaStream | null = null;
    let lastError: unknown = null;
    let selectedProfile = CAMERA_PROFILES[cameraProfileIndexRef.current] ?? CAMERA_PROFILES[0];

    try {
      for (let offset = 0; offset < CAMERA_PROFILES.length; offset += 1) {
        const profileIndex = (cameraProfileIndexRef.current + offset) % CAMERA_PROFILES.length;
        const candidateProfile = CAMERA_PROFILES[profileIndex];

        try {
          warmupStream = await navigator.mediaDevices.getUserMedia({
            video: candidateProfile.constraints,
            audio: false,
          });
          cameraProfileIndexRef.current = profileIndex;
          activeVideoConstraintsRef.current = candidateProfile.constraints;
          selectedProfile = candidateProfile;
          break;
        } catch (error) {
          lastError = error;

          if (
            error instanceof DOMException &&
            (error.name === "OverconstrainedError" ||
              error.name === "NotFoundError" ||
              error.name === "DevicesNotFoundError")
          ) {
            continue;
          }

          throw error;
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

      const preferredRearCamera = selectedProfile.preferRear
        ? videoInputs.find((device) => REAR_CAMERA_LABEL_PATTERN.test(device.label))
        : null;

      if (preferredRearCamera?.deviceId) {
        return preferredRearCamera.deviceId;
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
  }, []);

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
    if (!scanner || !scannerReadyRef.current || torchBusyRef.current) {
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
      desiredTorchRef.current = enabled;
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

  const redirectToDeviceSetup = useCallback(
    async (message: string) => {
      clearRestartTimer();
      processingRef.current = false;
      setIsVerifying(false);
      await stopScanner();
      clearStoredLibraryBinding();
      writeDeviceSetupNotice(message || "Reconnect this kiosk to continue scanning.");
      navigate("/setup-device", { replace: true });
    },
    [clearRestartTimer, navigate, stopScanner],
  );

  const startScanner = useCallback(async () => {
    if (!mountedRef.current || processingRef.current) {
      return;
    }

    if (startPromiseRef.current) {
      await startPromiseRef.current;
      return;
    }

    const startup = (async () => {
      setCameraInitializing(true);
      setCameraReady(false);
      setCameraError(null);
      setStatusMessage("Starting camera...");

      await stopScanner();
      if (!mountedRef.current) {
        return;
      }

      const scanner = new Html5Qrcode(SCANNER_REGION_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      });

      scannerRef.current = scanner;

      try {
        const cameraSource = await chooseCameraSource();
        const scanConfig = buildCameraScanConfig();

        if (typeof cameraSource === "string") {
          const { facingMode: _unusedFacingMode, ...scannerVideoConstraints } = activeVideoConstraintsRef.current;
          scanConfig.videoConstraints = scannerVideoConstraints;
        }

        await scanner.start(
          cameraSource,
          scanConfig,
          (decodedText) => {
            void handleDecodedRef.current?.(decodedText).catch(() => undefined);
          },
          () => undefined,
        );
        await applyTrackTuning(scanner);

        if (!mountedRef.current) {
          await stopScanner();
          return;
        }

        scannerReadyRef.current = true;
        setCameraInitializing(false);
        setCameraReady(true);
        setCameraError(null);
        setStatusMessage(isOnline ? "Ready to scan" : "Offline queue ready");
        syncTorchState(scanner);
        startFallbackScanLoop();

        if (desiredTorchRef.current) {
          void setTorchState(true);
        }
      } catch (error) {
        await stopScanner();
        if (!mountedRef.current) {
          return;
        }

        setCameraInitializing(false);
        setCameraReady(false);
        setCameraError(getCameraErrorState(error));
        setStatusMessage("Camera unavailable");
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        startPromiseRef.current = null;
      });

    startPromiseRef.current = startup;
    await startup;
  }, [applyTrackTuning, chooseCameraSource, isOnline, setTorchState, stopScanner, syncTorchState]);

  const syncQueuedScans = useCallback(async () => {
    if (!isOnline || !mountedRef.current) {
      return;
    }

    setSyncing(true);
    try {
      await syncQueuedAttendance({ scanApiUrl: SCAN_API_URL, deviceToken: SCAN_DEVICE_TOKEN });
      await syncQueueStats();
    } catch {
      // Keep the scanner running if queued scans fail to sync.
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
      }
    }
  }, [isOnline, syncQueueStats]);

  const restartScannerAfterResult = useCallback(
    (delayMs: number) => {
      clearRestartTimer();
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!mountedRef.current) {
          return;
        }

        processingRef.current = false;
        setScanResult(null);
        void startScanner();
      }, delayMs);
    },
    [clearRestartTimer, startScanner],
  );

  const handleDecoded = useCallback(
    async (rawValue: string) => {
      if (!mountedRef.current || processingRef.current) {
        return;
      }

      const normalizedRawValue = trimText(rawValue);
      const now = Date.now();
      const lastDecoded = lastDecodedRef.current;
      if (lastDecoded && lastDecoded.value === normalizedRawValue && now - lastDecoded.at < DUPLICATE_SCAN_WINDOW_MS) {
        return;
      }

      lastDecodedRef.current = { value: normalizedRawValue, at: now };
      processingRef.current = true;
      setIsVerifying(true);
      setStatusMessage("Verifying ID...");
      vibrateFeedback(18);

      await stopScanner();

      try {
        const parsed = await parseStudentQrPayload(normalizedRawValue, {
          expectedLibraryId: readStoredLibraryId(),
          allowLegacy: true,
          publicKeyPem: STUDENT_QR_PUBLIC_KEY,
          now: new Date(),
        });

        if (!mountedRef.current) {
          return;
        }

        const deviceLibraryId = readStoredLibraryId();
        const deviceLibraryAccessKey = readStoredLibraryAccessKey();
        if (!deviceLibraryId || !deviceLibraryAccessKey) {
          await redirectToDeviceSetup("Reconnect this kiosk to continue scanning.");
          return;
        }

        if (!parsed || !parsed.valid) {
          const code = parsed && "code" in parsed ? parsed.code : "INVALID_QR";
          const message = parsed && "message" in parsed ? parsed.message : "Invalid ID";
          const result: AttendanceScanPayload = {
            status: "error",
            code,
            message:
              code === "WRONG_LIBRARY"
                ? "Wrong Library"
                : code === "EXPIRED"
                  ? "Expired ID"
                  : message,
          };

          setScanResult(result);
          setStatusMessage(result.message);
          vibrateFeedback([28, 60, 22]);
          restartScannerAfterResult(RESULT_RESET_DELAY_MS);
          return;
        }

        const scanIdentifier = parsed.source === "legacy" ? parsed.qrCode : parsed.studentId;
        if (!scanIdentifier) {
          const result: AttendanceScanPayload = { status: "error", code: "INVALID_QR", message: "Invalid ID" };
          setScanResult(result);
          setStatusMessage(result.message);
          vibrateFeedback([28, 60, 22]);
          restartScannerAfterResult(RESULT_RESET_DELAY_MS);
          return;
        }

        const scanEntry = createAttendanceQueueEntry({
          deviceId: DEVICE_ID,
          studentId: scanIdentifier,
          libraryId: deviceLibraryId,
          libraryAccessKey: deviceLibraryAccessKey,
          qrCode: parsed.rawValue,
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

        setScanResult(payload);
        setStatusMessage(
          payload.status === "success"
            ? payload.duplicate
              ? "Already recorded"
              : "Entry complete"
            : payload.status === "queued"
              ? "Saved offline"
              : payload.code === "WRONG_LIBRARY"
                ? "Wrong Library"
                : payload.message || "Invalid ID",
        );

        if (payload.status === "success") {
          vibrateFeedback([22, 40, 16]);
        } else if (payload.status === "queued") {
          vibrateFeedback([18, 30, 18]);
        } else {
          vibrateFeedback([28, 60, 22]);
          if (payload.code && DEVICE_BINDING_RESET_CODES.has(payload.code)) {
            await redirectToDeviceSetup(payload.message || "Reconnect this kiosk to continue scanning.");
            return;
          }
        }

        await syncQueueStats();
        if (isOnline) {
          void syncQueuedScans();
        }

        restartScannerAfterResult(RESULT_RESET_DELAY_MS);
      } catch (error) {
        if (!mountedRef.current) {
          return;
        }

        const result: AttendanceScanPayload = { status: "error", message: getReadableError(error) };
        setScanResult(result);
        setStatusMessage(result.message);
        vibrateFeedback([28, 60, 22]);
        restartScannerAfterResult(RESULT_RESET_DELAY_MS);
      } finally {
        if (mountedRef.current) {
          setIsVerifying(false);
        }

        processingRef.current = false;
      }
    },
    [isOnline, redirectToDeviceSetup, restartScannerAfterResult, stopScanner, syncQueueStats, syncQueuedScans, vibrateFeedback],
  );

  handleDecodedRef.current = handleDecoded;

  const handleRetryCamera = useCallback(() => {
    void startScanner();
  }, [startScanner]);

  const cameraLive = cameraReady && !cameraInitializing && !cameraError && !isVerifying && !scanResult;
  const helperText = cameraError
    ? cameraError.detail
    : scanResult
      ? resolveResultMessage(scanResult)
      : isVerifying
        ? "The scanner stopped and the QR is being verified now."
        : !isOnline
          ? "Offline queue mode is active. Scans will sync when the connection returns."
          : torchSupported && !torchEnabled
            ? "Low light? Turn on the torch for a sharper read."
            : "Hold your ID card steady inside the frame.";
  const formattedLastSyncAt = useMemo(() => formatLastSyncLabel(lastSyncAt), [lastSyncAt]);

  useEffect(() => {
    mountedRef.current = true;
    document.body.classList.add("kiosk-mode");
      void syncQueueStats();
      void startScanner();

    return () => {
      mountedRef.current = false;
      document.body.classList.remove("kiosk-mode");
      clearRestartTimer();
      void stopScanner();
    };
  }, [clearRestartTimer, startScanner, stopScanner, syncQueueStats]);

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
    if (!isOnline) {
      return;
    }

    let cancelled = false;
    const runSync = async () => {
      if (!cancelled) {
        await syncQueuedScans();
      }
    };

    void runSync();
    const interval = window.setInterval(() => {
      void runSync();
    }, SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isOnline, syncQueuedScans]);

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#020611] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.12),transparent_26%),radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.14),transparent_28%),radial-gradient(circle_at_80%_16%,rgba(16,185,129,0.1),transparent_28%),linear-gradient(180deg,#030816_0%,#050b19_54%,#020611_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.14),rgba(2,6,23,0.62)_40%,rgba(2,6,23,0.94)_100%)]" />
      <div className="absolute left-[-10%] top-[8%] h-72 w-72 rounded-full bg-cyan-400/12 blur-[120px]" />
      <div className="absolute right-[-12%] top-[14%] h-80 w-80 rounded-full bg-emerald-400/12 blur-[130px]" />
      <div className="absolute bottom-[-12%] left-[16%] h-80 w-80 rounded-full bg-sky-500/10 blur-[140px]" />

      <div className="relative flex min-h-[100dvh] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] border border-white/10 bg-white/6 px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/18 bg-cyan-300/12 shadow-[0_0_24px_rgba(56,189,248,0.18)]">
              <ScanLine className="h-5 w-5 text-cyan-50" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-100/70">
                Libriofy
              </p>
              <h1 className="text-[clamp(28px,4.8vw,48px)] font-semibold tracking-[-0.07em]">
                Scan Your ID Card
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-white/70 sm:text-[15px]">
                {helperText}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] backdrop-blur-xl",
                isOnline
                  ? "border-emerald-300/20 bg-emerald-300/12 text-emerald-50"
                  : "border-rose-300/20 bg-rose-300/12 text-rose-50",
              )}
            >
              {isOnline ? <ShieldCheck className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              <span>{isOnline ? "Online" : "Offline"}</span>
            </div>
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] backdrop-blur-xl",
                syncing || pendingCount > 0
                  ? "border-cyan-300/20 bg-cyan-300/12 text-cyan-50"
                  : "border-white/10 bg-white/6 text-white/75",
              )}
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", syncing ? "animate-spin" : "")} />
              <span>{syncing ? "Syncing" : pendingCount > 0 ? `${pendingCount} queued` : "Synced"}</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 backdrop-blur-xl">
              <Loader2 className="h-3.5 w-3.5 opacity-0" />
              <span>Last sync {formattedLastSyncAt}</span>
            </div>
          </div>
        </header>

        <section className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[760px]">
            <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/55 shadow-[0_34px_120px_rgba(0,0,0,0.45)]">
              <div
                id={SCANNER_REGION_ID}
                className={cn("absolute inset-0 transition-opacity duration-200", cameraLive ? "opacity-100" : "opacity-50")}
              />

              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_42%),radial-gradient(circle_at_bottom,rgba(34,197,94,0.1),transparent_36%),linear-gradient(180deg,rgba(2,6,23,0.02),rgba(2,6,23,0.22))]" />
              <div className="pointer-events-none absolute inset-[12%] rounded-[1.7rem] border border-cyan-100/22" />
              <div className="pointer-events-none absolute inset-[12%]">
                <span className="absolute left-0 top-0 h-14 w-14 rounded-tl-[1.35rem] border-l-[4px] border-t-[4px] border-cyan-200/90" />
                <span className="absolute right-0 top-0 h-14 w-14 rounded-tr-[1.35rem] border-r-[4px] border-t-[4px] border-cyan-200/90" />
                <span className="absolute bottom-0 left-0 h-14 w-14 rounded-bl-[1.35rem] border-b-[4px] border-l-[4px] border-emerald-200/90" />
                <span className="absolute bottom-0 right-0 h-14 w-14 rounded-br-[1.35rem] border-b-[4px] border-r-[4px] border-emerald-200/90" />
              </div>
              <div className="pointer-events-none absolute inset-x-[12%] top-[18%] h-[2px] rounded-full bg-gradient-to-r from-transparent via-cyan-200 to-transparent opacity-85" />

              {torchSupported && cameraLive ? (
                <Button
                  type="button"
                  variant={torchEnabled ? "secondary" : "outline"}
                  size="sm"
                  className={cn(
                    "absolute right-4 top-4 z-20 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] shadow-lg backdrop-blur-xl",
                    torchEnabled
                      ? "border-amber-200/25 bg-amber-300/15 text-amber-50 hover:bg-amber-300/20"
                      : "border-white/12 bg-black/30 text-white/85 hover:bg-white/10",
                  )}
                  onClick={() => void toggleTorch()}
                  disabled={torchBusy}
                >
                  {torchEnabled ? <Flashlight className="h-4 w-4" /> : <FlashlightOff className="h-4 w-4" />}
                  <span>{torchEnabled ? "Torch on" : "Torch"}</span>
                </Button>
              ) : null}

              {cameraInitializing && !cameraError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 px-6 backdrop-blur-sm">
                  <div className="w-full max-w-sm rounded-[1.8rem] border border-white/10 bg-slate-950/90 p-6 text-center shadow-[0_28px_100px_rgba(0,0,0,0.45)]">
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-cyan-100" />
                    <p className="mt-4 text-2xl font-semibold tracking-[-0.04em]">Starting camera...</p>
                    <p className="mt-2 text-sm leading-6 text-white/70">Please allow camera permission if prompted.</p>
                  </div>
                </div>
              ) : null}

              {isVerifying && !cameraError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 px-6 backdrop-blur-sm">
                  <div className="w-full max-w-sm rounded-[1.8rem] border border-cyan-300/14 bg-slate-950/90 p-6 text-center shadow-[0_28px_100px_rgba(0,0,0,0.45)]">
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-cyan-100" />
                    <p className="mt-4 text-2xl font-semibold tracking-[-0.04em]">Verifying ID...</p>
                    <p className="mt-2 text-sm leading-6 text-white/70">
                      The scanner stopped and the QR is being verified now.
                    </p>
                  </div>
                </div>
              ) : null}

              {cameraError ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-6 backdrop-blur-sm">
                  <div className="w-full max-w-sm rounded-[1.8rem] border border-rose-300/18 bg-slate-950/92 p-6 text-center shadow-[0_28px_100px_rgba(0,0,0,0.45)]">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-rose-200/18 bg-rose-400/12 text-rose-50">
                      <X className="h-8 w-8" strokeWidth={2.6} />
                    </div>
                    <p className="mt-4 text-2xl font-semibold tracking-[-0.04em]">{cameraError.title}</p>
                    <p className="mt-2 text-sm leading-6 text-white/70">{cameraError.detail}</p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-5 rounded-full px-5"
                      onClick={handleRetryCamera}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      Retry camera
                    </Button>
                  </div>
                </div>
              ) : null}

              {scanResult ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
                  <div
                    className={cn(
                      "w-full max-w-sm rounded-[1.8rem] border p-6 text-center shadow-[0_28px_100px_rgba(0,0,0,0.45)]",
                      scanResult.status === "success"
                        ? "border-emerald-300/18 bg-emerald-500/10 text-emerald-50"
                        : scanResult.status === "queued"
                          ? "border-amber-300/18 bg-amber-500/10 text-amber-50"
                          : "border-rose-300/18 bg-rose-500/10 text-rose-50",
                    )}
                  >
                    <div
                      className={cn(
                        "mx-auto flex h-16 w-16 items-center justify-center rounded-full border",
                        scanResult.status === "success"
                          ? "border-emerald-200/20 bg-emerald-400/12 text-emerald-50"
                          : scanResult.status === "queued"
                            ? "border-amber-200/20 bg-amber-400/12 text-amber-50"
                            : "border-rose-200/20 bg-rose-400/12 text-rose-50",
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
                    <p className="mt-4 text-2xl font-semibold tracking-[-0.04em]">{resolveResultTitle(scanResult)}</p>
                    <p className="mt-2 text-sm leading-6 opacity-90">{resolveResultMessage(scanResult)}</p>

                    {scanResult.status === "success" ? (
                      <div className="mt-5 space-y-3 rounded-[1.35rem] border border-white/10 bg-black/10 p-4 text-left text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/60">Student</span>
                          <span className="font-semibold text-white">{scanResult.name}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/60">Seat</span>
                          <span className="font-semibold text-white">{scanResult.seat}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-white/60">Time</span>
                          <span className="font-semibold text-white">{scanResult.time}</span>
                        </div>
                        {scanResult.duplicate ? (
                          <p className="pt-1 text-xs text-emerald-50/80">Already recorded recently.</p>
                        ) : null}
                      </div>
                    ) : scanResult.status === "queued" ? (
                      <div className="mt-5 rounded-[1.35rem] border border-white/10 bg-black/10 p-4 text-left text-sm">
                        <p className="font-semibold">Queued for sync</p>
                        <p className="mt-1 text-white/80">Time: {scanResult.time}</p>
                        <p className="mt-1 text-xs text-white/65">
                          It will be sent automatically when connectivity returns.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex items-center gap-2 text-sm text-white/75">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] backdrop-blur-xl">
                {cameraError ? (
                  <X className="h-3.5 w-3.5 text-rose-50" />
                ) : cameraLive ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-50" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-50" />
                )}
                <span>{statusMessage}</span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-xs text-white/60 sm:grid-cols-3">
              <div className="rounded-[1.1rem] border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
                Rear camera first
              </div>
              <div className="rounded-[1.1rem] border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
                FPS 10-15 for stability
              </div>
              <div className="rounded-[1.1rem] border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
                Device {DEVICE_ID}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default IdCardScanPage;
