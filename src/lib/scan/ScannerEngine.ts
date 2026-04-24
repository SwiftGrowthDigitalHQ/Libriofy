import jsQR from "jsqr";

import { getReadableCameraError } from "@/lib/cameraStartup";
import type {
  ScanControllerLogLevel,
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
  timingMs: number;
  brightness: number;
  edgeScore: number;
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

type ScannerEngineOptions = {
  onDetect: (payload: ScanDetectionPayload) => void;
  onError?: (error: unknown) => void;
  log: EngineLog;
};

const MOBILE_PREVIEW_BREAKPOINT = 640;
const MOBILE_SCAN_BOX_MAX_EDGE = 260;
const MOBILE_SCAN_BOX_MIN_EDGE = 220;
const MOBILE_SCAN_BOX_RATIO = 0.58;
const DESKTOP_SCAN_BOX_MAX_EDGE = 300;
const DESKTOP_SCAN_BOX_MIN_EDGE = 250;
const DESKTOP_SCAN_BOX_RATIO = 0.42;
const TARGET_SCAN_INTERVAL_MS = 80;
const TARGET_DECODE_MAX_EDGE = 400;
const TARGET_DECODE_MIN_EDGE = 300;
const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;

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
      if (!this.running || this.paused) {
        return;
      }

      if (!message.rawValue || !message.detector) {
        return;
      }

      this.options.log("info", "decode-success", {
        analysis: {
          brightness: Math.round(message.brightness),
          edgeScore: Number(message.edgeScore.toFixed(1)),
          lowLight: message.lowLight,
        },
        source: message.detector,
        timingMs: message.timingMs,
      });

      this.options.onDetect({
        analysis: {
          brightness: message.brightness,
          edgeScore: message.edgeScore,
          glare: false,
          lowLight: message.lowLight,
        },
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

    if (this.videoElement.readyState < 2 || !this.videoElement.videoWidth || !this.videoElement.videoHeight) {
      return null;
    }

    return this.videoElement;
  }

  private resolveScanCropRect(video: HTMLVideoElement) {
    const previewWidth = video.clientWidth || video.videoWidth;
    const previewHeight = video.clientHeight || video.videoHeight;
    const isMobilePreview = previewWidth < MOBILE_PREVIEW_BREAKPOINT;
    const scanBoxEdge = clampScanBoxEdge(
      Math.min(previewWidth, previewHeight) * (isMobilePreview ? MOBILE_SCAN_BOX_RATIO : DESKTOP_SCAN_BOX_RATIO),
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
      cropEdge,
      displayEdge: scanBoxEdge,
      sourceX: Math.max(0, Math.floor((video.videoWidth - cropEdge) / 2)),
      sourceY: Math.max(0, Math.floor((video.videoHeight - cropEdge) / 2)),
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
    const { cropEdge, sourceX, sourceY } = this.resolveScanCropRect(video);
    const targetEdge = Math.max(TARGET_DECODE_MIN_EDGE, Math.min(TARGET_DECODE_MAX_EDGE, Math.round(cropEdge * 1.6)));
    const nextRequestId = this.requestId + 1;
    this.requestId = nextRequestId;
    this.workerBusy = true;

    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(video, sourceX, sourceY, cropEdge, cropEdge, {
          resizeHeight: targetEdge,
          resizeQuality: "high",
          resizeWidth: targetEdge,
        });
        const message: WorkerDecodeBitmapMessage = {
          type: "decode-bitmap",
          requestId: nextRequestId,
          bitmap,
        };
        if (!this.isRunActive(runToken, worker)) {
          this.workerBusy = false;
          bitmap.close();
          return;
        }

        worker.postMessage(message, [bitmap]);
        return;
      } catch {
        // Fall through to ImageData transfer below.
      }
    }

    const imageData = this.captureImageData(video, sourceX, sourceY, cropEdge, targetEdge);
    if (!imageData) {
      this.workerBusy = false;
      return;
    }

    const message: WorkerDecodeImageDataMessage = {
      type: "decode-image-data",
      requestId: nextRequestId,
      imageData,
    };
    if (!this.isRunActive(runToken, worker)) {
      this.workerBusy = false;
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
    cropEdge: number,
    targetEdge: number,
  ) {
    const canvas = this.captureCanvas ?? document.createElement("canvas");
    this.captureCanvas = canvas;
    if (canvas.width !== targetEdge) {
      canvas.width = targetEdge;
    }
    if (canvas.height !== targetEdge) {
      canvas.height = targetEdge;
    }

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, targetEdge, targetEdge);
    context.drawImage(video, sourceX, sourceY, cropEdge, cropEdge, 0, 0, targetEdge, targetEdge);
    return context.getImageData(0, 0, targetEdge, targetEdge);
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
