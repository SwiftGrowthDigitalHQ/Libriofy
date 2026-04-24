import {
  normalizeCameraStartupError,
  type CameraStartupErrorSummary,
} from "@/lib/cameraStartup";
import { CameraService, type CameraStartResult } from "./CameraService";
import { ScannerEngine } from "./ScannerEngine";
import type {
  CameraDeviceOption,
  CameraFacingPreference,
  ScanControllerError,
  ScanControllerLogLevel,
  ScanControllerState,
  ScanDetectionPayload,
} from "./types";

type ScanControllerOptions = {
  onDetect: (payload: ScanDetectionPayload) => void;
  onLog?: (
    level: ScanControllerLogLevel,
    event: string,
    detail?: Record<string, unknown>,
  ) => void;
  onStateChange?: (state: ScanControllerState) => void;
};

const CONTROLLER_LOG_PREFIX = "[scan]";
const CAMERA_IN_USE_RETRY_MS = 3000;
const START_FAILED_RETRY_MS = 2000;
const START_FAILED_MAX_RETRIES = 2;
const WATCHDOG_INTERVAL_MS = 3000;
const WATCHDOG_NO_FRAME_MS = 10000;
const CAMERA_START_CANCELLED = "CAMERA_START_CANCELLED";

const createInitialState = (): ScanControllerState => ({
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

export class ScanController {
  private readonly cameraService: CameraService;
  private readonly engine: ScannerEngine;
  private lifecycleToken = 0;
  private retryCount = 0;
  private retryTimer: number | null = null;
  private startPromise: Promise<void> | null = null;
  private state = createInitialState();
  private videoElement: HTMLVideoElement | null = null;
  private watchdogTimer: number | null = null;

  constructor(private readonly options: ScanControllerOptions) {
    this.cameraService = new CameraService(this.log);
    this.engine = new ScannerEngine({
      onDetect: (payload) => {
        this.options.onDetect(payload);
      },
      onError: (error) => {
        this.log("warn", "engine-error", {
          message: error instanceof Error ? error.message : "Unknown scanner engine error",
        });
      },
      log: this.log,
    });
  }

  attachVideoElement(videoElement: HTMLVideoElement | null) {
    this.videoElement = videoElement;
    this.cameraService.attach(videoElement);
  }

  getState() {
    return this.state;
  }

  async init() {
    const devices = await this.safeListDevices();
    this.patchState({
      devices,
      status: "idle",
    });
  }

  async start(reason = "manual-start", cameraId?: string | null) {
    if (!this.videoElement) {
      throw new Error("Scanner video element is not mounted.");
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.clearRetryTimer();
    this.patchState({
      error: null,
      status: "starting",
    });

    this.log("info", "camera-start", {
      cameraId,
      reason,
    });

    const lifecycleToken = ++this.lifecycleToken;
    const startPromise = this.startInternal(reason, cameraId, lifecycleToken)
      .catch((error) => {
        if (!this.isLifecycleCurrent(lifecycleToken) || this.isCancelledError(error)) {
          return;
        }

        throw error;
      })
      .finally(() => {
        if (this.startPromise === startPromise) {
          this.startPromise = null;
        }
      });

    this.startPromise = startPromise;
    return startPromise;
  }

  pause(reason = "manual-pause") {
    this.log("info", "scan-pause", { reason });
    this.engine.pause();
    this.patchState({
      status: "paused",
    });
  }

  resume(reason = "manual-resume") {
    this.log("info", "scan-resume", { reason });
    this.engine.resume();
    this.patchState({
      error: null,
      status: "ready",
    });
  }

  async retry(reason = "manual-retry") {
    const activeCameraId = this.state.activeCameraId;
    this.retryCount = 0;
    await this.stop("retry-reset");
    await this.start(reason, activeCameraId);
  }

  async stop(reason = "manual-stop") {
    const lifecycleToken = ++this.lifecycleToken;
    this.log("info", "camera-stop", { reason });
    this.clearRetryTimer();
    this.stopWatchdog();
    this.startPromise = null;
    this.engine.stop();
    await this.cameraService.stop();

    if (!this.isLifecycleCurrent(lifecycleToken)) {
      return;
    }

    this.patchState({
      activeCameraId: null,
      activeCameraLabel: null,
      error: null,
      lastFrameAt: null,
      status: "stopped",
      torchBusy: false,
      torchEnabled: false,
      torchSupported: false,
    });
  }

  async switchCamera(cameraId?: string | null) {
    const lifecycleToken = ++this.lifecycleToken;
    this.clearRetryTimer();
    this.patchState({
      error: null,
      status: "starting",
    });
    this.engine.pause();

    try {
      const result = await this.cameraService.switchCamera(cameraId);
      if (!this.isLifecycleCurrent(lifecycleToken)) {
        return;
      }

      this.applyCameraStartResult(result);
      this.engine.resume();
      this.patchState({
        error: null,
        status: "ready",
      });
    } catch (error) {
      if (!this.isLifecycleCurrent(lifecycleToken) || this.isCancelledError(error)) {
        return;
      }

      const normalized = normalizeCameraStartupError(error, {
        isSecureContext: window.isSecureContext,
        supportsMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      });
      this.handleCameraStartFailure(normalized, "switch-camera", error);
      throw error;
    }
  }

  async toggleTorch() {
    this.patchState({
      torchBusy: true,
    });

    try {
      const torchState = await this.cameraService.setTorch(!this.state.torchEnabled);
      this.patchState({
        torchBusy: false,
        torchEnabled: torchState.torchEnabled,
        torchSupported: torchState.torchSupported,
      });
    } catch (error) {
      this.patchState({
        torchBusy: false,
      });
      throw error;
    }
  }

  getActiveTrack() {
    return this.cameraService.getActiveTrack();
  }

  private async startInternal(reason: string, cameraId: string | null | undefined, lifecycleToken: number) {
    try {
      const result = await this.cameraService.start({
        cameraId,
        facingPreference: "environment",
      });

      if (!this.isLifecycleCurrent(lifecycleToken)) {
        await this.cameraService.stop();
        return;
      }

      await this.engine.start(this.videoElement!);
      if (!this.isLifecycleCurrent(lifecycleToken)) {
        this.engine.stop();
        await this.cameraService.stop();
        return;
      }

      this.engine.resume();
      this.retryCount = 0;
      this.applyCameraStartResult(result);
      this.patchState({
        error: null,
        lastFrameAt: Date.now(),
        status: "ready",
      });
      this.startWatchdog();
      this.log("info", "camera-ready", {
        activeCameraId: result.activeCameraId,
        activeCameraLabel: result.activeCameraLabel,
      });
    } catch (error) {
      if (!this.isLifecycleCurrent(lifecycleToken) || this.isCancelledError(error)) {
        return;
      }

      const normalized = normalizeCameraStartupError(error, {
        isSecureContext: window.isSecureContext,
        supportsMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      });
      this.handleCameraStartFailure(normalized, reason, error);
      if (normalized.retryable) {
        return;
      }
      throw error;
    }
  }

  private applyCameraStartResult(result: CameraStartResult) {
    this.patchState({
      activeCameraId: result.activeCameraId,
      activeCameraLabel: result.activeCameraLabel,
      devices: result.devices,
      error: null,
      permissionState: result.permissionState,
      torchEnabled: result.torchEnabled,
      torchSupported: result.torchSupported,
    });
  }

  private handleCameraStartFailure(
    normalized: CameraStartupErrorSummary,
    reason: string,
    rawError: unknown,
  ) {
    const error: ScanControllerError = {
      code: normalized.code,
      detail: normalized.detail,
      normalized,
      title: normalized.title,
    };

    this.patchState({
      error,
      status: "error",
      torchBusy: false,
      torchEnabled: false,
      torchSupported: false,
    });

    this.log("error", "camera-error", {
      code: normalized.code,
      detail: normalized.detail,
      rawError,
      rawMessage: normalized.rawMessage,
      reason,
      retryable: normalized.retryable,
    });

    if (normalized.code === "CAMERA_IN_USE") {
      this.scheduleRetry(CAMERA_IN_USE_RETRY_MS, "camera-in-use");
      return;
    }

    if (normalized.code === "START_FAILED" && this.retryCount < START_FAILED_MAX_RETRIES) {
      this.retryCount += 1;
      this.scheduleRetry(START_FAILED_RETRY_MS, `start-failed-${this.retryCount}`);
    }
  }

  private scheduleRetry(delayMs: number, reason: string) {
    this.clearRetryTimer();
    const lifecycleToken = this.lifecycleToken;
    this.log("info", "camera-retry-scheduled", {
      delayMs,
      reason,
    });
    this.retryTimer = window.setTimeout(() => {
      if (!this.isLifecycleCurrent(lifecycleToken)) {
        return;
      }

      void this.start(`auto-retry:${reason}`, this.state.activeCameraId);
    }, delayMs);
  }

  private clearRetryTimer() {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private startWatchdog() {
    this.stopWatchdog();
    this.watchdogTimer = window.setInterval(() => {
      if (this.state.status !== "ready") {
        return;
      }

      const activeTrack = this.cameraService.getActiveTrack();
      if (activeTrack && activeTrack.readyState !== "live") {
        this.log("warn", "watchdog-restart", {
          reason: "camera-track-lost",
        });
        void this.retry("watchdog:camera-track-lost");
        return;
      }

      const lastFrameAt = this.engine.lastFrameAt;
      if (lastFrameAt && Date.now() - lastFrameAt >= WATCHDOG_NO_FRAME_MS) {
        this.log("warn", "watchdog-restart", {
          reason: "no-frames",
        });
        void this.retry("watchdog:no-frames");
      } else if (lastFrameAt) {
        this.patchState({
          lastFrameAt,
        });
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog() {
    if (this.watchdogTimer !== null) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async safeListDevices(): Promise<CameraDeviceOption[]> {
    try {
      return await this.cameraService.listDevices("environment");
    } catch (error) {
      this.log("warn", "camera-list-failed", {
        message: error instanceof Error ? error.message : "Unable to list cameras.",
      });
      return [];
    }
  }

  private readonly log = (
    level: ScanControllerLogLevel,
    event: string,
    detail?: Record<string, unknown>,
  ) => {
    const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    logger(CONTROLLER_LOG_PREFIX, event, detail ?? {});
    this.options.onLog?.(level, event, detail);
  };

  private patchState(nextState: Partial<ScanControllerState>) {
    this.state = {
      ...this.state,
      ...nextState,
    };
    this.options.onStateChange?.(this.state);
  }

  private isLifecycleCurrent(lifecycleToken: number) {
    return this.lifecycleToken === lifecycleToken;
  }

  private isCancelledError(error: unknown) {
    return error instanceof Error && error.message === CAMERA_START_CANCELLED;
  }
}
