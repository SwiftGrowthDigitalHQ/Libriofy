import {
  getReadableCameraError,
  normalizeCameraStartupError,
  type CameraStartupErrorSummary,
} from "@/lib/cameraStartup";
import type {
  CameraDeviceKind,
  CameraDeviceOption,
  CameraFacingPreference,
  ScanControllerLogLevel,
} from "./types";

type CameraServiceLog = (
  level: ScanControllerLogLevel,
  event: string,
  detail?: Record<string, unknown>,
) => void;

type StartCameraOptions = {
  cameraId?: string | null;
  facingPreference?: CameraFacingPreference;
};

type CameraStartResult = {
  activeCameraId: string | null;
  activeCameraLabel: string | null;
  devices: CameraDeviceOption[];
  permissionState: PermissionState | null;
  torchEnabled: boolean;
  torchSupported: boolean;
};

type CameraTrackCapabilities = MediaTrackCapabilities & {
  exposureMode?: string[];
  focusMode?: string[];
  torch?: boolean;
  whiteBalanceMode?: string[];
  zoom?: MediaSettingsRange;
};

type CameraTrackConstraintSet = MediaTrackConstraintSet & {
  exposureMode?: ConstrainDOMString;
  focusMode?: ConstrainDOMString;
  torch?: boolean;
  whiteBalanceMode?: ConstrainDOMString;
  zoom?: ConstrainDouble;
};

type CameraTrackConstraints = MediaTrackConstraints & {
  advanced?: CameraTrackConstraintSet[];
};

type CameraTrackSettings = MediaTrackSettings & {
  exposureMode?: string;
  focusMode?: string;
  whiteBalanceMode?: string;
  zoom?: number;
};

type CameraProfile = {
  label: string;
  trackConstraints: CameraTrackConstraints;
};

const CAMERA_ASPECT_RATIO = 16 / 9;
const CAMERA_TARGET_HEIGHT = 720;
const CAMERA_TARGET_WIDTH = 1280;
const CAMERA_FALLBACK_HEIGHT = 540;
const CAMERA_FALLBACK_WIDTH = 960;
const CAMERA_MAX_AUTO_ZOOM = 2;
const CAMERA_MIN_AUTO_ZOOM = 1.5;
const CAMERA_TARGET_ZOOM = 1.75;

const buildContinuousControlHints = (): CameraTrackConstraintSet => ({
  exposureMode: "continuous",
  focusMode: "continuous",
  whiteBalanceMode: "continuous",
});

const CAMERA_PROFILES: CameraProfile[] = [
  {
    label: "preferred-720p",
    trackConstraints: {
      advanced: [buildContinuousControlHints()],
      aspectRatio: { ideal: CAMERA_ASPECT_RATIO },
      height: { ideal: CAMERA_TARGET_HEIGHT, max: CAMERA_TARGET_HEIGHT, min: CAMERA_FALLBACK_HEIGHT },
      frameRate: { ideal: 24, max: 30 },
      width: { ideal: CAMERA_TARGET_WIDTH, max: CAMERA_TARGET_WIDTH, min: CAMERA_FALLBACK_WIDTH },
    },
  },
  {
    label: "steady-720p",
    trackConstraints: {
      advanced: [buildContinuousControlHints()],
      aspectRatio: { ideal: CAMERA_ASPECT_RATIO },
      height: { ideal: CAMERA_TARGET_HEIGHT, max: CAMERA_TARGET_HEIGHT },
      frameRate: { ideal: 30, max: 30 },
      width: { ideal: CAMERA_TARGET_WIDTH, max: CAMERA_TARGET_WIDTH },
    },
  },
  {
    label: "fallback-540p",
    trackConstraints: {
      advanced: [buildContinuousControlHints()],
      aspectRatio: { ideal: CAMERA_ASPECT_RATIO },
      height: { ideal: CAMERA_FALLBACK_HEIGHT, max: CAMERA_TARGET_HEIGHT, min: CAMERA_FALLBACK_HEIGHT },
      frameRate: { ideal: 24, max: 30 },
      width: { ideal: CAMERA_FALLBACK_WIDTH, max: CAMERA_TARGET_WIDTH, min: CAMERA_FALLBACK_WIDTH },
    },
  },
];

const REAR_CAMERA_LABEL_PATTERN = /\b(rear|back|environment|world)\b/i;
const FRONT_CAMERA_LABEL_PATTERN = /\b(front|user|selfie|facetime)\b/i;
const EXTERNAL_CAMERA_LABEL_PATTERN = /\b(external|usb|webcam|camera)\b/i;

const inferDeviceKind = (label: string): CameraDeviceKind => {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) {
    return "unknown";
  }

  if (REAR_CAMERA_LABEL_PATTERN.test(normalizedLabel) && !FRONT_CAMERA_LABEL_PATTERN.test(normalizedLabel)) {
    return "rear";
  }

  if (FRONT_CAMERA_LABEL_PATTERN.test(normalizedLabel)) {
    return "front";
  }

  if (EXTERNAL_CAMERA_LABEL_PATTERN.test(normalizedLabel)) {
    return "external";
  }

  return "unknown";
};

const sortDevices = (devices: CameraDeviceOption[], facingPreference: CameraFacingPreference) =>
  [...devices].sort((left, right) => {
    const score = (device: CameraDeviceOption) => {
      if (facingPreference === "environment") {
        if (device.kind === "rear") return 0;
        if (device.kind === "external") return 1;
        if (device.kind === "unknown") return 2;
        return 3;
      }

      if (device.kind === "front") return 0;
      if (device.kind === "unknown") return 1;
      if (device.kind === "external") return 2;
      return 3;
    };

    const leftScore = score(left);
    const rightScore = score(right);
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.label.localeCompare(right.label);
  });

const stopStream = (stream: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

const getDeviceMemory = () => {
  const navigatorWithHints = navigator as Navigator & { deviceMemory?: number };
  return navigatorWithHints.deviceMemory ?? 4;
};

const roundZoomToStep = (value: number, range: MediaSettingsRange) => {
  if (!Number.isFinite(range.step) || range.step <= 0) {
    return Number(value.toFixed(2));
  }

  const snapped = range.min + Math.round((value - range.min) / range.step) * range.step;
  return Number(snapped.toFixed(2));
};

const resolvePreferredZoom = (range: MediaSettingsRange | undefined) => {
  if (!range || !Number.isFinite(range.max) || range.max < CAMERA_MIN_AUTO_ZOOM) {
    return null;
  }

  const min = Number.isFinite(range.min) ? range.min : 1;
  const max = Math.min(range.max, CAMERA_MAX_AUTO_ZOOM);
  const zoomValue = Math.max(min, Math.min(max, CAMERA_TARGET_ZOOM));
  return roundZoomToStep(zoomValue, {
    ...range,
    min,
    max,
  });
};

const selectProfileOrder = () => {
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = getDeviceMemory();
  const [preferredProfile, steadyProfile, fallbackProfile] = CAMERA_PROFILES;

  if (cores <= 2 || memory <= 3) {
    return [preferredProfile, fallbackProfile, steadyProfile];
  }

  if (cores <= 4 || memory <= 4) {
    return [preferredProfile, fallbackProfile, steadyProfile];
  }

  return [preferredProfile, steadyProfile, fallbackProfile];
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

type CameraCandidate = {
  cameraId: string | null;
  constraints: CameraTrackConstraints;
  label: string;
};

const CAMERA_START_CANCELLED = "CAMERA_START_CANCELLED";

const isCameraStartCancelledError = (error: unknown) =>
  error instanceof Error && error.message === CAMERA_START_CANCELLED;

export class CameraService {
  private activeCameraId: string | null = null;
  private devices: CameraDeviceOption[] = [];
  private sessionToken = 0;
  private stream: MediaStream | null = null;
  private torchEnabled = false;
  private videoElement: HTMLVideoElement | null = null;

  constructor(private readonly log: CameraServiceLog) {}

  attach(videoElement: HTMLVideoElement | null) {
    if (this.videoElement && this.videoElement !== videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }

    this.videoElement = videoElement;

    if (this.videoElement && this.stream) {
      this.videoElement.srcObject = this.stream;
    }
  }

  getActiveTrack() {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  getActiveCameraId() {
    return this.activeCameraId;
  }

  getStream() {
    return this.stream;
  }

  async listDevices(facingPreference: CameraFacingPreference = "environment") {
    await this.ensureSupport();
    const devices = await this.readDevices();
    this.devices = devices;
    return sortDevices(devices, facingPreference);
  }

  async start(options: StartCameraOptions = {}): Promise<CameraStartResult> {
    await this.ensureSupport();

    const startSessionToken = ++this.sessionToken;
    const facingPreference = options.facingPreference ?? "environment";
    const permissionState = await readCameraPermissionState();
    this.ensureSessionActive(startSessionToken);

    if (permissionState !== "granted") {
      const warmupStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          advanced: [buildContinuousControlHints()],
          facingMode: facingPreference === "environment" ? { ideal: "environment" } : "user",
          height: { ideal: CAMERA_TARGET_HEIGHT, max: CAMERA_TARGET_HEIGHT, min: CAMERA_FALLBACK_HEIGHT },
          width: { ideal: CAMERA_TARGET_WIDTH, max: CAMERA_TARGET_WIDTH, min: CAMERA_FALLBACK_WIDTH },
        },
      });
      if (!this.isSessionActive(startSessionToken)) {
        stopStream(warmupStream);
        throw new Error(CAMERA_START_CANCELLED);
      }

      stopStream(warmupStream);
    }

    const devices = await this.readDevices();
    this.ensureSessionActive(startSessionToken);
    this.devices = devices;

    const preferredDeviceId = options.cameraId ?? this.activeCameraId;
    const candidates = this.buildCandidates(devices, preferredDeviceId, facingPreference);
    let lastStartupError: unknown = null;

    for (const candidate of candidates) {
      try {
        this.log("info", "camera-start-attempt", {
          cameraId: candidate.cameraId,
          constraints: candidate.constraints,
          label: candidate.label,
        });

        await this.replaceStream(candidate.constraints, startSessionToken);
        const track = this.getActiveTrack();
        if (!track) {
          throw new Error("Camera track missing after startup.");
        }

        await this.bindStreamToVideo(startSessionToken);
        this.ensureSessionActive(startSessionToken);
        await this.applyPreferredTrackControls(track);
        this.ensureSessionActive(startSessionToken);
        const trackSettings = track.getSettings() as CameraTrackSettings;
        const activeCameraId = typeof trackSettings.deviceId === "string" ? trackSettings.deviceId : candidate.cameraId;
        const activeCamera = devices.find((device) => device.id === activeCameraId) ?? null;
        this.activeCameraId = activeCameraId ?? null;
        this.torchEnabled = false;

        const torchSupported = await this.isTorchSupported();
        this.log("info", "camera-started", {
          activeCameraId: this.activeCameraId,
          activeCameraLabel: activeCamera?.label ?? candidate.label,
          activeExposureMode: trackSettings.exposureMode ?? null,
          activeFocusMode: trackSettings.focusMode ?? null,
          activeHeight: typeof trackSettings.height === "number" ? trackSettings.height : null,
          activeWhiteBalanceMode: trackSettings.whiteBalanceMode ?? null,
          activeWidth: typeof trackSettings.width === "number" ? trackSettings.width : null,
          activeZoom: typeof trackSettings.zoom === "number" ? Number(trackSettings.zoom.toFixed(2)) : null,
          torchSupported,
        });

        return {
          activeCameraId: this.activeCameraId,
          activeCameraLabel: activeCamera?.label ?? candidate.label,
          devices,
          permissionState,
          torchEnabled: this.torchEnabled,
          torchSupported,
        };
      } catch (error) {
        if (isCameraStartCancelledError(error)) {
          throw error;
        }

        lastStartupError = error;
        const normalized = normalizeCameraStartupError(error, {
          isSecureContext: window.isSecureContext,
          supportsMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
        });

        this.log("warn", "camera-start-attempt-failed", {
          cameraId: candidate.cameraId,
          code: normalized.code,
          detail: normalized.detail,
          label: candidate.label,
          rawMessage: normalized.rawMessage,
        });
        this.resetActiveStream();
      }
    }

    throw lastStartupError ?? new Error("Unable to start camera.");
  }

  async switchCamera(cameraId?: string | null) {
    const devices = this.devices.length ? this.devices : await this.readDevices();
    this.devices = devices;

    if (!devices.length) {
      throw new Error("No camera available to switch.");
    }

    if (cameraId) {
      return this.start({
        cameraId,
        facingPreference: "environment",
      });
    }

    const ordered = sortDevices(devices, "environment");
    const currentIndex = ordered.findIndex((device) => device.id === this.activeCameraId);
    const nextDevice = ordered[(currentIndex + 1 + ordered.length) % ordered.length];
    return this.start({
      cameraId: nextDevice?.id ?? null,
      facingPreference: "environment",
    });
  }

  async setTorch(enabled: boolean) {
    const track = this.getActiveTrack();
    if (!track) {
      throw new Error("Camera is not active.");
    }

    const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
    if (!capabilities.torch) {
      throw new Error("Torch is not supported on this camera.");
    }

    await track.applyConstraints({
      advanced: [{ torch: enabled } as MediaTrackConstraintSet & { torch: boolean }],
    });
    this.torchEnabled = enabled;
    return {
      torchEnabled: this.torchEnabled,
      torchSupported: true,
    };
  }

  async stop() {
    this.sessionToken += 1;
    this.activeCameraId = null;
    this.resetActiveStream();
  }

  private async ensureSupport() {
    if (!window.isSecureContext) {
      throw normalizeCameraStartupError(new Error("HTTPS_REQUIRED"), {
        isSecureContext: false,
        supportsMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      });
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw normalizeCameraStartupError(new Error("MEDIA_DEVICES_UNSUPPORTED"), {
        isSecureContext: window.isSecureContext,
        supportsMediaDevices: false,
      });
    }
  }

  private async readDevices() {
    try {
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();

      return mediaDevices
        .filter((device): device is MediaDeviceInfo => device.kind === "videoinput" && Boolean(device.deviceId))
        .map((device, index) => ({
          id: device.deviceId,
          kind: inferDeviceKind(device.label),
          label: device.label.trim() || `Camera ${index + 1}`,
        }));
    } catch (error) {
      this.log("warn", "camera-device-enumeration-failed", {
        message: getReadableCameraError(error, "Unable to enumerate cameras."),
      });
      return [];
    }
  }

  private buildCandidates(
    devices: CameraDeviceOption[],
    preferredDeviceId: string | null,
    facingPreference: CameraFacingPreference,
  ): CameraCandidate[] {
    const deviceMap = new Map(devices.map((device) => [device.id, device] as const));
    const orderedDevices = sortDevices(devices, facingPreference);
    const chosenDevices = preferredDeviceId
      ? [deviceMap.get(preferredDeviceId), ...orderedDevices.filter((device) => device.id !== preferredDeviceId)]
          .filter((device): device is CameraDeviceOption => Boolean(device))
      : orderedDevices;

    const profileOrder = selectProfileOrder();
    const candidates: CameraCandidate[] = [];

    chosenDevices.forEach((device) => {
      profileOrder.forEach((profile) => {
        candidates.push({
          cameraId: device.id,
          constraints: {
            ...profile.trackConstraints,
            deviceId: { exact: device.id },
          },
          label: `${device.label} / ${profile.label}`,
        });
      });
    });

    profileOrder.forEach((profile) => {
      candidates.push({
        cameraId: null,
        constraints: {
          ...profile.trackConstraints,
          facingMode: facingPreference === "environment" ? { ideal: "environment" } : "user",
        },
        label: `${facingPreference} / ${profile.label}`,
      });
    });

    return candidates;
  }

  private isSessionActive(sessionToken: number) {
    return this.sessionToken === sessionToken;
  }

  private ensureSessionActive(sessionToken: number) {
    if (!this.isSessionActive(sessionToken)) {
      throw new Error(CAMERA_START_CANCELLED);
    }
  }

  private resetActiveStream() {
    stopStream(this.stream);
    this.stream = null;
    this.torchEnabled = false;

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
    }
  }

  private async replaceStream(videoConstraints: CameraTrackConstraints, sessionToken: number) {
    const nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    });
    if (!this.isSessionActive(sessionToken)) {
      stopStream(nextStream);
      throw new Error(CAMERA_START_CANCELLED);
    }

    const previousStream = this.stream;
    this.stream = nextStream;
    stopStream(previousStream);
  }

  private async bindStreamToVideo(sessionToken: number) {
    if (!this.videoElement || !this.stream) {
      return;
    }

    const videoElement = this.videoElement;
    const stream = this.stream;

    videoElement.srcObject = stream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    this.ensureSessionActive(sessionToken);

    await videoElement.play();

    if (!this.isSessionActive(sessionToken) && videoElement.srcObject === stream) {
      videoElement.pause();
      videoElement.srcObject = null;
      throw new Error(CAMERA_START_CANCELLED);
    }
  }

  private async applyPreferredTrackControls(track: MediaStreamTrack) {
    let capabilities: CameraTrackCapabilities;
    try {
      capabilities = track.getCapabilities() as CameraTrackCapabilities;
    } catch (error) {
      this.log("warn", "camera-track-capabilities-unavailable", {
        message: getReadableCameraError(error, "Unable to inspect camera controls."),
      });
      return;
    }

    const nextControls: CameraTrackConstraintSet = {};

    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) {
      nextControls.focusMode = "continuous";
    }

    if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("continuous")) {
      nextControls.exposureMode = "continuous";
    }

    if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes("continuous")) {
      nextControls.whiteBalanceMode = "continuous";
    }

    const preferredZoom = resolvePreferredZoom(capabilities.zoom);
    if (preferredZoom !== null) {
      nextControls.zoom = preferredZoom;
    }

    if (!Object.keys(nextControls).length) {
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [nextControls],
      });
    } catch (error) {
      this.log("warn", "camera-track-controls-unsupported", {
        message: getReadableCameraError(error, "Unable to apply focus controls."),
      });
    }
  }

  private async isTorchSupported() {
    const track = this.getActiveTrack();
    if (!track) {
      return false;
    }

    try {
      const capabilities = track.getCapabilities() as CameraTrackCapabilities;
      return capabilities.torch === true;
    } catch (error) {
      this.log("warn", "camera-torch-capability-read-failed", {
        message: getReadableCameraError(error, "Unable to inspect torch support."),
      });
      return false;
    }
  }
}

export type { CameraStartResult, StartCameraOptions };
