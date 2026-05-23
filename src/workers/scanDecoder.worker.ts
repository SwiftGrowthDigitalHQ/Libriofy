/// <reference lib="webworker" />

import jsQR from "jsqr";

type BarcodeDetectorResult = {
  cornerPoints?: Array<{
    x: number;
    y: number;
  }>;
  rawValue?: string;
};

type BarcodeDetectorInstance = {
  detect: (source: ImageBitmapSource | OffscreenCanvas) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

type InitMessage = {
  type: "init";
};

type DecodeMessage = {
  type: "decode-bitmap";
  requestId: number;
  bitmap: ImageBitmap;
};

type DecodeImageDataMessage = {
  type: "decode-image-data";
  requestId: number;
  imageData: ImageData;
};

type WorkerIncomingMessage = InitMessage | DecodeMessage | DecodeImageDataMessage;

type ReadyMessage = {
  type: "ready";
  support: {
    barcodeDetector: boolean;
    offscreenCanvas: boolean;
  };
};

type DecodeResultMessage = {
  type: "result";
  requestId: number;
  rawValue: string | null;
  detector: "barcode_detector" | "jsqr" | null;
  decodePass: string | null;
  confidence: number | null;
  failureReason: "blur" | "glare" | "low_light" | "not_found" | "worker_error" | null;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
    points: Array<{
      x: number;
      y: number;
    }>;
  } | null;
  timingMs: number;
  brightness: number;
  blurry: boolean;
  edgeScore: number;
  glare: boolean;
  lowLight: boolean;
};

let barcodeDetector: BarcodeDetectorInstance | null = null;
let decodeCanvas: OffscreenCanvas | null = null;
let decodeContext: OffscreenCanvasRenderingContext2D | null = null;

const MIN_SHARP_EDGE_SCORE = 11.5;
const MIN_SHARP_EDGE_SCORE_LOW_LIGHT = 9.5;

const trimText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const getBarcodeDetector = () => {
  if (barcodeDetector) {
    return barcodeDetector;
  }

  const BarcodeDetectorCtor = (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;

  if (!BarcodeDetectorCtor) {
    return null;
  }

  try {
    barcodeDetector = new BarcodeDetectorCtor({ formats: ["qr_code"] });
  } catch {
    barcodeDetector = null;
  }

  return barcodeDetector;
};

const getDecodeContext = (width: number, height: number) => {
  if (typeof OffscreenCanvas === "undefined") {
    return null;
  }

  if (!decodeCanvas || decodeCanvas.width !== width || decodeCanvas.height !== height) {
    decodeCanvas = new OffscreenCanvas(width, height);
    decodeContext = decodeCanvas.getContext("2d", { willReadFrequently: true });
  }

  return decodeContext;
};

const clampRatio = (value: number) => Math.max(0, Math.min(1, Number(value.toFixed(4))));

const buildNormalizedBounds = (
  points: Array<{
    x: number;
    y: number;
  }>,
  width: number,
  height: number,
) => {
  if (!points.length || width <= 0 || height <= 0) {
    return null;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.max(0, Math.min(...xs));
  const right = Math.min(width, Math.max(...xs));
  const top = Math.max(0, Math.min(...ys));
  const bottom = Math.min(height, Math.max(...ys));

  return {
    left: clampRatio(left / width),
    top: clampRatio(top / height),
    width: clampRatio((right - left) / width),
    height: clampRatio((bottom - top) / height),
    points: points.map((point) => ({
      x: clampRatio(point.x / width),
      y: clampRatio(point.y / height),
    })),
  };
};

const resolveFailureReason = ({
  blurry,
  glare,
  lowLight,
}: {
  blurry: boolean;
  glare: boolean;
  lowLight: boolean;
}) => {
  if (lowLight) {
    return "low_light" as const;
  }

  if (blurry) {
    return "blur" as const;
  }

  if (glare) {
    return "glare" as const;
  }

  return "not_found" as const;
};

const computeConfidence = ({
  detector,
  blurry,
  edgeScore,
  glare,
  lowLight,
}: {
  detector: "barcode_detector" | "jsqr";
  blurry: boolean;
  edgeScore: number;
  glare: boolean;
  lowLight: boolean;
}) => {
  let confidence = detector === "barcode_detector" ? 0.96 : 0.88;

  if (blurry) {
    confidence -= 0.2;
  }

  if (lowLight) {
    confidence -= 0.12;
  }

  if (glare) {
    confidence -= 0.08;
  }

  confidence += Math.min(edgeScore / 60, 0.08);
  return Number(Math.max(0.2, Math.min(0.99, confidence)).toFixed(2));
};

const detectWithBarcodeDetector = async (source: ImageBitmapSource | OffscreenCanvas) => {
  const detector = getBarcodeDetector();
  if (!detector) {
    return null;
  }

  try {
    const nativeResults = await detector.detect(source);
    const detection = nativeResults.find((entry) => typeof entry.rawValue === "string" && entry.rawValue.trim());
    if (!detection) {
      return null;
    }

    const width = "width" in source ? source.width : 0;
    const height = "height" in source ? source.height : 0;

    return {
      rawValue: trimText(detection.rawValue),
      bounds: buildNormalizedBounds(detection.cornerPoints ?? [], width, height),
      decodePass: "barcode_detector" as const,
    };
  } catch {
    return null;
  }
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const createEnhancedImageData = (
  source: ImageData,
  {
    contrast,
    brightnessOffset,
    threshold,
  }: {
    contrast: number;
    brightnessOffset: number;
    threshold?: number;
  },
) => {
  const output = new Uint8ClampedArray(source.data.length);

  for (let index = 0; index < source.data.length; index += 4) {
    const luminance =
      source.data[index] * 0.299 +
      source.data[index + 1] * 0.587 +
      source.data[index + 2] * 0.114;
    const adjusted = clampByte((luminance - 128) * contrast + 128 + brightnessOffset);
    const finalValue = typeof threshold === "number" ? (adjusted >= threshold ? 255 : 0) : adjusted;

    output[index] = finalValue;
    output[index + 1] = finalValue;
    output[index + 2] = finalValue;
    output[index + 3] = 255;
  }

  return new ImageData(output, source.width, source.height);
};

const analyzeImageData = (imageData: ImageData) => {
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
  const glareRatio = glarePixels / pixelCount;
  const shadowRatio = shadowPixels / pixelCount;
  const edgeScore = edgeTotal / edgeSamples;

  return {
    brightness,
    edgeScore,
    lowLight: brightness < 80 || shadowRatio > 0.42 || (brightness < 98 && shadowRatio > 0.34),
    glare: brightness > 212 || glareRatio > 0.22,
  };
};

const isFrameBlurry = (analysis: ReturnType<typeof analyzeImageData>) =>
  analysis.edgeScore < (analysis.lowLight ? MIN_SHARP_EDGE_SCORE_LOW_LIGHT : MIN_SHARP_EDGE_SCORE);

const buildJsQrBounds = (
  location:
    | {
        bottomLeftCorner: { x: number; y: number };
        bottomRightCorner: { x: number; y: number };
        topLeftCorner: { x: number; y: number };
        topRightCorner: { x: number; y: number };
      }
    | undefined,
  width: number,
  height: number,
) => {
  if (!location) {
    return null;
  }

  return buildNormalizedBounds(
    [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomRightCorner,
      location.bottomLeftCorner,
    ],
    width,
    height,
  );
};

const decodeWithJsQr = (imageData: ImageData, brightness: number) => {
  // First attempt: direct read with both inversion modes
  const directResult = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  const directRead = trimText(directResult?.data);
  if (directRead) {
    return {
      rawValue: directRead,
      bounds: buildJsQrBounds(directResult?.location, imageData.width, imageData.height),
      decodePass: "jsqr_direct" as const,
    };
  }

  // Second attempt: enhanced contrast
  const enhanced = createEnhancedImageData(imageData, {
    contrast: brightness < 96 ? 1.4 : 1.25,
    brightnessOffset: brightness < 96 ? 12 : 6,
  });
  const enhancedResult = jsQR(enhanced.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  const enhancedRead = trimText(enhancedResult?.data);
  if (enhancedRead) {
    return {
      rawValue: enhancedRead,
      bounds: buildJsQrBounds(enhancedResult?.location, imageData.width, imageData.height),
      decodePass: "jsqr_enhanced" as const,
    };
  }

  // Third attempt: high contrast for screen-displayed QR codes
  const highContrast = createEnhancedImageData(imageData, {
    contrast: 1.6,
    brightnessOffset: -10,
  });
  const highContrastResult = jsQR(highContrast.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  const highContrastRead = trimText(highContrastResult?.data);

  if (!highContrastRead) {
    return null;
  }

  return {
    rawValue: highContrastRead,
    bounds: buildJsQrBounds(highContrastResult?.location, imageData.width, imageData.height),
    decodePass: "jsqr_high_contrast" as const,
  };
};

const decodePreparedFrame = async (
  imageData: ImageData,
  nativeSource?: OffscreenCanvas,
) => {
  const analysis = analyzeImageData(imageData);
  const blurry = isFrameBlurry(analysis);

  // Always attempt decode regardless of blur — let jsQR/BarcodeDetector decide
  const nativeValue = nativeSource ? await detectWithBarcodeDetector(nativeSource) : null;
  if (nativeValue) {
    return {
      rawValue: nativeValue.rawValue,
      detector: "barcode_detector" as const,
      decodePass: nativeValue.decodePass,
      bounds: nativeValue.bounds,
      confidence: computeConfidence({
        detector: "barcode_detector",
        blurry,
        edgeScore: analysis.edgeScore,
        glare: analysis.glare,
        lowLight: analysis.lowLight,
      }),
      failureReason: null,
      brightness: analysis.brightness,
      blurry,
      edgeScore: analysis.edgeScore,
      glare: analysis.glare,
      lowLight: analysis.lowLight,
    };
  }

  const rawValue = decodeWithJsQr(imageData, analysis.brightness);

  return {
    rawValue: rawValue?.rawValue ?? null,
    detector: rawValue ? ("jsqr" as const) : null,
    decodePass: rawValue?.decodePass ?? null,
    bounds: rawValue?.bounds ?? null,
    confidence: rawValue
      ? computeConfidence({
          detector: "jsqr",
          blurry,
          edgeScore: analysis.edgeScore,
          glare: analysis.glare,
          lowLight: analysis.lowLight,
        })
      : null,
    failureReason: rawValue ? null : resolveFailureReason(analysis),
    brightness: analysis.brightness,
    blurry,
    edgeScore: analysis.edgeScore,
    glare: analysis.glare,
    lowLight: analysis.lowLight,
  };
};

const decodeBitmap = async (bitmap: ImageBitmap) => {
  const context = getDecodeContext(bitmap.width, bitmap.height);
  if (!context || !decodeCanvas) {
    return {
      rawValue: null,
      detector: null,
      decodePass: null,
      bounds: null,
      confidence: null,
      failureReason: "worker_error" as const,
      brightness: 0,
      blurry: false,
      edgeScore: 0,
      glare: false,
      lowLight: false,
    };
  }

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
  const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return decodePreparedFrame(imageData, decodeCanvas);
};

const decodeImageData = async (imageData: ImageData) => {
  const context = getDecodeContext(imageData.width, imageData.height);
  if (context && decodeCanvas) {
    context.imageSmoothingEnabled = false;
    context.putImageData(imageData, 0, 0);
    return decodePreparedFrame(imageData, decodeCanvas);
  }

  return decodePreparedFrame(imageData);
};

const postWorkerMessage = (message: ReadyMessage | DecodeResultMessage) => {
  (globalThis as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

const postEmptyDecodeResult = (requestId: number, startedAt: number) => {
  const timingMs = Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
  );

  postWorkerMessage({
    type: "result",
    requestId,
    rawValue: null,
    detector: null,
    decodePass: null,
    confidence: null,
    failureReason: "worker_error",
    bounds: null,
    timingMs,
    brightness: 0,
    blurry: false,
    edgeScore: 0,
    glare: false,
    lowLight: false,
  });
};

const handleDecodeMessage = async (message: DecodeMessage) => {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const result = await decodeBitmap(message.bitmap);
    const timingMs = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
    );

    postWorkerMessage({
      type: "result",
      requestId: message.requestId,
      rawValue: result.rawValue,
      detector: result.detector,
      decodePass: result.decodePass,
      confidence: result.confidence,
      failureReason: result.failureReason,
      bounds: result.bounds,
      timingMs,
      brightness: result.brightness,
      blurry: result.blurry,
      edgeScore: result.edgeScore,
      glare: result.glare,
      lowLight: result.lowLight,
    });
  } catch {
    postEmptyDecodeResult(message.requestId, startedAt);
  } finally {
    message.bitmap.close();
  }
};

let frameCount = 0;
let lastLogAt = 0;

const handleImageDataDecodeMessage = async (message: DecodeImageDataMessage) => {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  frameCount++;
  try {
    const result = await decodeImageData(message.imageData);
    const timingMs = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
    );

    // Debug: log every 50 frames
    const now = Date.now();
    if (now - lastLogAt > 3000) {
      lastLogAt = now;
      console.log(`[scan-worker] frames=${frameCount} size=${message.imageData.width}x${message.imageData.height} brightness=${Math.round(result.brightness)} edge=${result.edgeScore.toFixed(1)} blurry=${result.blurry} found=${!!result.rawValue}`);
    }

    postWorkerMessage({
      type: "result",
      requestId: message.requestId,
      rawValue: result.rawValue,
      detector: result.detector,
      decodePass: result.decodePass,
      confidence: result.confidence,
      failureReason: result.failureReason,
      bounds: result.bounds,
      timingMs,
      brightness: result.brightness,
      blurry: result.blurry,
      edgeScore: result.edgeScore,
      glare: result.glare,
      lowLight: result.lowLight,
    });
  } catch {
    postEmptyDecodeResult(message.requestId, startedAt);
  }
};

globalThis.onmessage = (event: MessageEvent<WorkerIncomingMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    postWorkerMessage({
      type: "ready",
      support: {
        barcodeDetector: Boolean(getBarcodeDetector()),
        offscreenCanvas: typeof OffscreenCanvas !== "undefined",
      },
    });
    return;
  }

  if (message.type === "decode-bitmap") {
    void handleDecodeMessage(message);
    return;
  }

  if (message.type === "decode-image-data") {
    void handleImageDataDecodeMessage(message);
  }
};
