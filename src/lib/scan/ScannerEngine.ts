import jsQR from "jsqr";

import { getReadableCameraError } from "@/lib/cameraStartup";
import type {
  ScanControllerLogLevel,
  ScanDetectionPayload,
  ScanFrameAnalysis,
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
  intervalMs?: number;
  onAnalysis?: (analysis: ScanFrameAnalysis) => void;
  onDetect: (payload: ScanDetectionPayload) => void;
  onError?: (error: unknown) => void;
  log: EngineLog;
};

const DEFAULT_SCAN_INTERVAL_MS = 60;
const PREVIEW_ANALYSIS_INTERVAL_MS = 250;
const PREVIEW_SAMPLE_EDGE = 84;
const SCAN_BOX_MAX_EDGE = 640;
const SCAN_BOX_MIN_EDGE = 340;
const SCAN_BOX_PADDING = 12;
const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const clampEdge = (value: number) => Math.max(SCAN_BOX_MIN_EDGE, Math.min(SCAN_BOX_MAX_EDGE, Math.round(value)));

const analyzeImageData = (imageData: ImageData): ScanFrameAnalysis => {
  const grayscale = new Float32Array(imageData.width * imageData.height);
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
  for (let y = 1; y < imageData.height; y += 1) {
    for (let x = 1; x < imageData.width; x += 1) {
      const index = y * imageData.width + x;
      edgeTotal += Math.abs(grayscale[index] - grayscale[index - 1]);
      edgeTotal += Math.abs(grayscale[index] - grayscale[index - imageData.width]);
    }
  }

  const pixelCount = grayscale.length || 1;
  const edgeSamples = Math.max(1, (imageData.width - 1) * (imageData.height - 1) * 2);
  const brightness = brightnessTotal / pixelCount;
  const edgeScore = edgeTotal / edgeSamples;
  const glareRatio = glarePixels / pixelCount;
  const shadowRatio = shadowPixels / pixelCount;

  return {
    brightness,
    edgeScore,
    glare: brightness > 212 || glareRatio > 0.22,
    lowLight: brightness < 80 || shadowRatio > 0.42 || (brightness < 98 && shadowRatio > 0.34),
  };
};

export class ScannerEngine {
  private analysisCanvas: HTMLCanvasElement | null = null;
  private captureCanvas: HTMLCanvasElement | null = null;
  private detectionLoopTimer: number | null = null;
  private paused = false;
  private previewAnalysisTimer: number | null = null;
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
    this.startPreviewAnalysisLoop();
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
    this.requestId = 0;
    this.lastFrameAt = null;
    this.clearTimers();
    this.worker?.terminate();
    this.worker = null;
    this.videoElement = null;
    this.resetCanvas(this.captureCanvas);
    this.resetCanvas(this.analysisCanvas);
    this.captureCanvas = null;
    this.analysisCanvas = null;
    this.workerSupport = {
      barcodeDetector: false,
      offscreenCanvas: false,
    };
  }

  private clearTimers() {
    if (this.detectionLoopTimer !== null) {
      window.clearInterval(this.detectionLoopTimer);
      this.detectionLoopTimer = null;
    }

    if (this.previewAnalysisTimer !== null) {
      window.clearInterval(this.previewAnalysisTimer);
      this.previewAnalysisTimer = null;
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
    this.detectionLoopTimer = window.setInterval(() => {
      void this.captureAndDecode().catch((error) => {
        this.options.log("warn", "decode-fail", {
          message: getReadableCameraError(error, "Unable to capture frame."),
        });
        this.options.onError?.(error);
      });
    }, this.options.intervalMs ?? DEFAULT_SCAN_INTERVAL_MS);
  }

  private startPreviewAnalysisLoop() {
    this.previewAnalysisTimer = window.setInterval(() => {
      if (!this.running || this.paused) {
        return;
      }

      const analysis = this.readPreviewAnalysis();
      if (analysis) {
        this.options.onAnalysis?.(analysis);
      }
    }, PREVIEW_ANALYSIS_INTERVAL_MS);
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
    const scanBoxEdge = clampEdge(Math.min(previewWidth, previewHeight) - SCAN_BOX_PADDING);
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
    const targetEdge = Math.max(420, Math.min(820, cropEdge));
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

  private readPreviewAnalysis() {
    const video = this.getVideoElement();
    if (!video) {
      return null;
    }

    const { cropEdge, sourceX, sourceY } = this.resolveScanCropRect(video);
    const canvas = this.analysisCanvas ?? document.createElement("canvas");
    this.analysisCanvas = canvas;
    canvas.width = PREVIEW_SAMPLE_EDGE;
    canvas.height = PREVIEW_SAMPLE_EDGE;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return null;
    }

    context.drawImage(video, sourceX, sourceY, cropEdge, cropEdge, 0, 0, PREVIEW_SAMPLE_EDGE, PREVIEW_SAMPLE_EDGE);
    const imageData = context.getImageData(0, 0, PREVIEW_SAMPLE_EDGE, PREVIEW_SAMPLE_EDGE);
    return analyzeImageData(imageData);
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
