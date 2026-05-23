import jsQR from "jsqr";

import { getReadableCameraError } from "@/lib/cameraStartup";
import type {
  ScanControllerLogLevel,
  ScanDecodeMode,
  ScanDetectionPayload,
} from "./types";

type WorkerReadyMessage = {
  type: "ready";
  support: {
    barcodeDetector: boolean;
    offscreenCanvas: boolean;
  };
};

type WorkerResultMessage = {
  type: "result";
  requestId: number;
  rawValue: string | null;
  detector: "barcode_detector" | "jsqr" | null;
  decodePass: string | null;
  confidence: number | null;
  failureReason: "blur" | "glare" | "low_light" | "not_found" | "worker_error" | null;
  bounds: ScanDetectionPayload["bounds"];
  timingMs: number;
  brightness: number;
  blurry: boolean;
  edgeScore: number;
  glare: boolean;
  lowLight: boolean;
};

type WorkerMessage = WorkerReadyMessage | WorkerResultMessage;

type WorkerDecodeBitmapMessage = {
  type: "decode-bitmap";
  requestId: number;
  bitmap: ImageBitmap;
};

type WorkerDecodeImageDataMessage = {
  type: "decode-image-data";
  requestId: number;
  imageData: ImageData;
};

type EngineLog = (
  level: ScanControllerLogLevel,
  event: string,
  detail?: Record<string, unknown>,
) => void;

type PendingDecodeRequest = {
  captureMode: ScanDecodeMode;
  requestId: number;
  sourceRect: {
    height: number;
    left: number;
    top: number;
    width: number;
  };
  targetSize: {
    height: number;
    width: number;
  };
  transport: "bitmap" | "image_data";
  videoSize: {
    height: number;
    width: number;
  };
};

type ScannerEngineOptions = {
  onDetect: (payload: ScanDetectionPayload) => void;
  onError?: (error: unknown) => void;
  onFrameAnalysis?: (analysis: ScanDetectionPayload["analysis"]) => void;
  log: EngineLog;
};

const MOBILE_PREVIEW_BREAKPOINT = 640;
const MOBILE_SCAN_BOX_MAX_EDGE = 480;
const MOBILE_SCAN_BOX_MIN_EDGE = 280;
const MOBILE_SCAN_BOX_RATIO = 0.82;
const MOBILE_WIDE_SCAN_BOX_RATIO = 0.92;
const DESKTOP_SCAN_BOX_MAX_EDGE = 600;
const DESKTOP_SCAN_BOX_MIN_EDGE = 320;
const DESKTOP_SCAN_BOX_RATIO = 0.78;
const DESKTOP_WIDE_SCAN_BOX_RATIO = 0.9;
const TARGET_SCAN_INTERVAL_MS = 60;
const TARGET_DECODE_MAX_EDGE = 600;
const TARGET_FULL_FRAME_MAX_EDGE = 720;
const TARGET_DECODE_MIN_EDGE = 360;
const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;
const MISS_STREAK_WIDE_SCAN_THRESHOLD = 4;
const MISS_STREAK_FULL_FRAME_THRESHOLD = 10;
const REQUIRED_VIDEO_READY_STATE =
  typeof HTMLMediaElement !== "undefined" ? HTMLMediaElement.HAVE_ENOUGH_DATA : 4;

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const clampScanBoxEdge = (value: number, isMobilePreview: boolean) => {
  const minEdge = isMobilePreview ? MOBILE_SCAN_BOX_MIN_EDGE : DESKTOP_SCAN_BOX_MIN_EDGE;
  const maxEdge = isMobilePreview ? MOBILE_SCAN_BOX_MAX_EDGE : DESKTOP_SCAN_BOX_MAX_EDGE;
  return Math.max(minEdge, Math.min(maxEdge, Math.round(value)));
};

export class ScannerEngine {
  private captureCanvas: HTMLCanvasElement | null = null;
  private detectionFrameHandle: number | null = null;
  private lastDecodeAttemptAt = 0;
  private missStreak = 0;
  private pendingDecodeRequest: PendingDecodeRequest | null = null;
  private paused = false;
  private requestId = 0;
  private running = false;
  private runToken = 0;
  private videoElement: HTMLVideoElement | null = null;
  private worker: Worker | null = null;
  private workerBusy = false;
  private workerSupport = {
    barcodeDetector: false,
    offscreenCanvas: false,
  };

  public lastFrameAt: number | null = null;

  constructor(private readonly options: ScannerEngineOptions) {}

  async start(videoElement: HTMLVideoElement) {
    this.stop();
    this.videoElement = videoElement;
    this.running = true;
    this.paused = false;
    this.ensureWorker(this.runToken);
    this.startDetectionLoop();
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  stop() {
    this.runToken += 1;
    this.running = false;
    this.paused = false;
    this.workerBusy = false;
    this.lastDecodeAttemptAt = 0;
    this.missStreak = 0;
    this.pendingDecodeRequest = null;
    this.requestId = 0;
    this.lastFrameAt = null;
    this.clearTimers();
    this.worker?.terminate();
    this.worker = null;
    this.videoElement = null;
    this.resetCanvas(this.captureCanvas);
    this.captureCanvas = null;
    this.workerSupport = {
      barcodeDetector: false,
      offscreenCanvas: false,
    };
  }

  private clearTimers() {
    if (this.detectionFrameHandle !== null) {
      window.cancelAnimationFrame(this.detectionFrameHandle);
      this.detectionFrameHandle = null;
    }
  }

  private resetCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) {
      return;
    }

    canvas.width = 0;
    canvas.height = 0;
  }

  private ensureWorker(runToken: number) {
    if (this.worker) {
      return;
    }

    this.worker = new Worker(new URL("../../workers/scanDecoder.worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (runToken !== this.runToken) {
        return;
      }

      const message = event.data;
      if (message.type === "ready") {
        this.workerSupport = message.support;
        this.options.log("info", "worker-ready", message.support);
        return;
      }

      this.workerBusy = false;
      const pendingRequest =
        this.pendingDecodeRequest?.requestId === message.requestId ? this.pendingDecodeRequest : null;
      this.pendingDecodeRequest = null;
      if (!this.running || this.paused) {
        return;
      }

      const analysis = {
        brightness: message.brightness,
        blurry: message.blurry,
        edgeScore: message.edgeScore,
        glare: message.glare,
        lowLight: message.lowLight,
      };
      this.options.onFrameAnalysis?.(analysis);

      const attemptDetail = {
        analysis: {
          brightness: Math.round(message.brightness),
          blurry: message.blurry,
          edgeScore: Number(message.edgeScore.toFixed(1)),
          glare: message.glare,
          lowLight: message.lowLight,
        },
        bounds: message.bounds ?? null,
        captureMode: pendingRequest?.captureMode ?? null,
        confidence: message.confidence ?? null,
        decodePass: message.decodePass ?? null,
        failureReason: message.failureReason ?? null,
        rawValuePreview: message.rawValue ? message.rawValue.slice(0, 40) : null,
        requestId: message.requestId,
        source: message.detector,
        sourceRect: pendingRequest?.sourceRect ?? null,
        targetSize: pendingRequest?.targetSize ?? null,
        timingMs: message.timingMs,
        transport: pendingRequest?.transport ?? null,
        videoSize: pendingRequest?.videoSize ?? null,
      };

      if (!message.rawValue || !message.detector) {
        this.missStreak += 1;
        this.options.log("warn", "decode-miss", attemptDetail);
        return;
      }

      this.missStreak = 0;
      this.options.log("info", "decode-success", attemptDetail);

      this.options.onDetect({
        analysis,
        bounds: message.bounds ?? null,
        captureMode: pendingRequest?.captureMode ?? "focused-square",
        confidence: message.confidence ?? null,
        decodePass: message.decodePass ?? null,
        detectedAt: new Date().toISOString(),
        rawValue: message.rawValue,
        source: message.detector,
        timingMs: message.timingMs,
      });
    };

    this.worker.onerror = (error) => {
      if (runToken !== this.runToken) {
        return;
      }

      this.workerBusy = false;
      this.options.log("error", "decode-fail", {
        message: error.message || "Worker failed",
      });
      this.options.onError?.(error);
    };

    this.worker.postMessage({ type: "init" });
  }

  private startDetectionLoop() {
    const loop = (now: number) => {
      if (!this.running) {
        this.detectionFrameHandle = null;
        return;
      }

      this.detectionFrameHandle = window.requestAnimationFrame(loop);
      if (this.paused || this.workerBusy) {
        return;
      }

      if (now - this.lastDecodeAttemptAt < TARGET_SCAN_INTERVAL_MS) {
        return;
      }

      this.lastDecodeAttemptAt = now;
      void this.captureAndDecode().catch((error) => {
        this.options.log("warn", "decode-fail", {
          message: getReadableCameraError(error, "Unable to capture frame."),
        });
        this.options.onError?.(error);
      });
    };

    this.detectionFrameHandle = window.requestAnimationFrame(loop);
  }

  private getVideoElement() {
    if (!this.videoElement) {
      return null;
    }

    if (
      this.videoElement.readyState < REQUIRED_VIDEO_READY_STATE ||
      !this.videoElement.videoWidth ||
      !this.videoElement.videoHeight
    ) {
      return null;
    }

    return this.videoElement;
  }

  private resolveCaptureMode(nextRequestId: number): ScanDecodeMode {
    if (this.missStreak >= MISS_STREAK_FULL_FRAME_THRESHOLD) {
      return nextRequestId % 2 === 0 ? "full-frame" : "wide-square";
    }

    if (this.missStreak >= MISS_STREAK_WIDE_SCAN_THRESHOLD) {
      return "wide-square";
    }

    return "focused-square";
  }

  private resolveScanCropRect(video: HTMLVideoElement, captureMode: ScanDecodeMode) {
    const previewWidth = video.clientWidth || video.videoWidth;
    const previewHeight = video.clientHeight || video.videoHeight;
    const isMobilePreview = previewWidth < MOBILE_PREVIEW_BREAKPOINT;
    if (captureMode === "full-frame") {
      return {
        captureMode,
        sourceHeight: video.videoHeight,
        sourceWidth: video.videoWidth,
        sourceX: 0,
        sourceY: 0,
      };
    }

    const scanRatio =
      captureMode === "wide-square"
        ? isMobilePreview
          ? MOBILE_WIDE_SCAN_BOX_RATIO
          : DESKTOP_WIDE_SCAN_BOX_RATIO
        : isMobilePreview
          ? MOBILE_SCAN_BOX_RATIO
          : DESKTOP_SCAN_BOX_RATIO;
    const scanBoxEdge = clampScanBoxEdge(
      Math.min(previewWidth, previewHeight) * scanRatio,
      isMobilePreview,
    );
    const widthScale = previewWidth ? video.videoWidth / previewWidth : 1;
    const heightScale = previewHeight ? video.videoHeight / previewHeight : 1;
    const cropEdge = Math.min(
      video.videoWidth,
      video.videoHeight,
      Math.round(scanBoxEdge * Math.max(widthScale, heightScale)),
    );

    return {
      captureMode,
      sourceHeight: cropEdge,
      sourceWidth: cropEdge,
      sourceX: Math.max(0, Math.floor((video.videoWidth - cropEdge) / 2)),
      sourceY: Math.max(0, Math.floor((video.videoHeight - cropEdge) / 2)),
    };
  }

  private resolveTargetSize(sourceWidth: number, sourceHeight: number, captureMode: ScanDecodeMode) {
    const longestEdge = Math.max(sourceWidth, sourceHeight);
    const maxTargetEdge = captureMode === "full-frame" ? TARGET_FULL_FRAME_MAX_EDGE : TARGET_DECODE_MAX_EDGE;
    const targetLongestEdge = Math.max(TARGET_DECODE_MIN_EDGE, Math.min(maxTargetEdge, longestEdge));
    const scale = targetLongestEdge / longestEdge;

    return {
      targetHeight: Math.max(1, Math.round(sourceHeight * scale)),
      targetWidth: Math.max(1, Math.round(sourceWidth * scale)),
    };
  }

  private async captureAndDecode() {
    if (!this.running || this.paused || this.workerBusy || !this.worker) {
      return;
    }

    const runToken = this.runToken;
    const worker = this.worker;
    const video = this.getVideoElement();
    if (!video) {
      return;
    }

    this.lastFrameAt = Date.now();
    const nextRequestId = this.requestId + 1;
    const captureMode = this.resolveCaptureMode(nextRequestId);
    const { sourceHeight, sourceWidth, sourceX, sourceY } = this.resolveScanCropRect(video, captureMode);
    const { targetHeight, targetWidth } = this.resolveTargetSize(sourceWidth, sourceHeight, captureMode);
    this.requestId = nextRequestId;
    this.workerBusy = true;
    this.pendingDecodeRequest = {
      captureMode,
      requestId: nextRequestId,
      sourceRect: {
        height: sourceHeight,
        left: sourceX,
        top: sourceY,
        width: sourceWidth,
      },
      targetSize: {
        height: targetHeight,
        width: targetWidth,
      },
      transport: this.workerSupport.offscreenCanvas && typeof createImageBitmap === "function" ? "bitmap" : "image_data",
      videoSize: {
        height: video.videoHeight,
        width: video.videoWidth,
      },
    };
    this.options.log("info", "decode-attempt", {
      captureMode,
      requestId: nextRequestId,
      sourceRect: this.pendingDecodeRequest.sourceRect,
      targetSize: this.pendingDecodeRequest.targetSize,
      transport: this.pendingDecodeRequest.transport,
      videoSize: this.pendingDecodeRequest.videoSize,
    });

    if (this.workerSupport.offscreenCanvas && typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(video, sourceX, sourceY, sourceWidth, sourceHeight, {
          resizeHeight: targetHeight,
          resizeQuality: "high",
          resizeWidth: targetWidth,
        });
        const message: WorkerDecodeBitmapMessage = {
          type: "decode-bitmap",
          requestId: nextRequestId,
          bitmap,
        };
        if (!this.isRunActive(runToken, worker)) {
          this.workerBusy = false;
          this.pendingDecodeRequest = null;
          bitmap.close();
          return;
        }

        worker.postMessage(message, [bitmap]);
        return;
      } catch (error) {
        this.options.log("warn", "decode-bitmap-fallback", {
          captureMode,
          message: getReadableCameraError(error, "Unable to transfer frame as bitmap."),
          requestId: nextRequestId,
        });
        if (this.pendingDecodeRequest) {
          this.pendingDecodeRequest = {
            ...this.pendingDecodeRequest,
            transport: "image_data",
          };
        }
        // Fall through to ImageData transfer below.
      }
    }

    const imageData = this.captureImageData(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
    );
    if (!imageData) {
      this.workerBusy = false;
      this.pendingDecodeRequest = null;
      return;
    }

    const message: WorkerDecodeImageDataMessage = {
      type: "decode-image-data",
      requestId: nextRequestId,
      imageData,
    };
    if (!this.isRunActive(runToken, worker)) {
      this.workerBusy = false;
      this.pendingDecodeRequest = null;
      return;
    }

    worker.postMessage(message, [imageData.data.buffer]);
  }

  private isRunActive(runToken: number, worker: Worker | null) {
    return this.running && !this.paused && this.runToken === runToken && this.worker === worker && Boolean(worker);
  }

  private captureImageData(
    video: HTMLVideoElement,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
  ) {
    const canvas = this.captureCanvas ?? document.createElement("canvas");
    this.captureCanvas = canvas;
    if (canvas.width !== targetWidth) {
      canvas.width = targetWidth;
    }
    if (canvas.height !== targetHeight) {
      canvas.height = targetHeight;
    }

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
    return context.getImageData(0, 0, targetWidth, targetHeight);
  }
}

export const decodeQrFromImageFile = async (file: File) => {
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error("QR image is too large. Use an image smaller than 8 MB.");
  }

  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot decode uploaded QR images.");
  }

  const imageBitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const longestEdge = Math.max(imageBitmap.width, imageBitmap.height);
  const scale = longestEdge > 1200 ? 1200 / longestEdge : 1;
  const targetWidth = Math.max(1, Math.round(imageBitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(imageBitmap.height * scale));
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    imageBitmap.close();
    throw new Error("Unable to read QR image.");
  }

  try {
    context.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);
    const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
    const decodedValue = trimText(
      jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      })?.data,
    );

    if (!decodedValue) {
      throw new Error("No QR code found in the uploaded image.");
    }

    return decodedValue;
  } finally {
    imageBitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
};
