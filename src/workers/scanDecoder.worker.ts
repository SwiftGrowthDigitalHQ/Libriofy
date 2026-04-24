/// <reference lib="webworker" />

import jsQR from "jsqr";

type BarcodeDetectorResult = {
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
  timingMs: number;
  brightness: number;
  edgeScore: number;
  lowLight: boolean;
};

let barcodeDetector: BarcodeDetectorInstance | null = null;
let decodeCanvas: OffscreenCanvas | null = null;
let decodeContext: OffscreenCanvasRenderingContext2D | null = null;

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

const detectWithBarcodeDetector = async (source: ImageBitmapSource | OffscreenCanvas) => {
  const detector = getBarcodeDetector();
  if (!detector) {
    return null;
  }

  try {
    const nativeResults = await detector.detect(source);
    return trimText(
      nativeResults.find((entry) => typeof entry.rawValue === "string" && entry.rawValue.trim())?.rawValue,
    );
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

const decodeWithJsQr = (imageData: ImageData, brightness: number) => {
  const directRead = trimText(
    jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    })?.data,
  );
  if (directRead) {
    return directRead;
  }

  return trimText(
    jsQR(
      createEnhancedImageData(imageData, {
        contrast: brightness < 96 ? 1.28 : 1.18,
        brightnessOffset: brightness < 96 ? 8 : 4,
      }).data,
      imageData.width,
      imageData.height,
      {
        inversionAttempts: "attemptBoth",
      },
    )?.data,
  );
};

const decodeBitmap = async (bitmap: ImageBitmap) => {
  const nativeValue = await detectWithBarcodeDetector(bitmap);
  if (nativeValue) {
    return {
      rawValue: nativeValue,
      detector: "barcode_detector" as const,
      brightness: 0,
      edgeScore: 0,
      lowLight: false,
    };
  }

  const context = getDecodeContext(bitmap.width, bitmap.height);
  if (!context || !decodeCanvas) {
    return {
      rawValue: null,
      detector: null,
      brightness: 0,
      edgeScore: 0,
      lowLight: false,
    };
  }

  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
  const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const analysis = analyzeImageData(imageData);
  const rawValue = decodeWithJsQr(imageData, analysis.brightness);

  return {
    rawValue,
    detector: rawValue ? ("jsqr" as const) : null,
    brightness: analysis.brightness,
    edgeScore: analysis.edgeScore,
    lowLight: analysis.lowLight,
  };
};

const decodeImageData = async (imageData: ImageData) => {
  const context = getDecodeContext(imageData.width, imageData.height);
  if (context && decodeCanvas) {
    context.imageSmoothingEnabled = false;
    context.putImageData(imageData, 0, 0);
    const nativeValue = await detectWithBarcodeDetector(decodeCanvas);
    if (nativeValue) {
      return {
        rawValue: nativeValue,
        detector: "barcode_detector" as const,
        brightness: 0,
        edgeScore: 0,
        lowLight: false,
      };
    }
  }

  const analysis = analyzeImageData(imageData);
  const rawValue = decodeWithJsQr(imageData, analysis.brightness);

  return {
    rawValue,
    detector: rawValue ? ("jsqr" as const) : null,
    brightness: analysis.brightness,
    edgeScore: analysis.edgeScore,
    lowLight: analysis.lowLight,
  };
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
    timingMs,
    brightness: 0,
    edgeScore: 0,
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
      timingMs,
      brightness: result.brightness,
      edgeScore: result.edgeScore,
      lowLight: result.lowLight,
    });
  } catch {
    postEmptyDecodeResult(message.requestId, startedAt);
  } finally {
    message.bitmap.close();
  }
};

const handleImageDataDecodeMessage = async (message: DecodeImageDataMessage) => {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const result = await decodeImageData(message.imageData);
    const timingMs = Math.round(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
    );

    postWorkerMessage({
      type: "result",
      requestId: message.requestId,
      rawValue: result.rawValue,
      detector: result.detector,
      timingMs,
      brightness: result.brightness,
      edgeScore: result.edgeScore,
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
