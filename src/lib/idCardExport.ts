import { toCanvas } from "html-to-image";
import jsPDF from "jspdf";
import JSZip from "jszip";

type IdCardExportOptions = {
  backgroundColor?: string;
  pixelRatio?: number;
};

type BulkIdCardExportItem = {
  name: string;
  node: HTMLElement;
};

const CARD_WIDTH_MM = 85.6;
const DEFAULT_EXPORT_PIXEL_RATIO = 2;
const MAX_EXPORT_PIXEL_RATIO = 2;
const EXPORT_READY_TIMEOUT_MS = 8_000;
const EXPORT_RENDER_TIMEOUT_MS = 10_000;
const EXPORT_BLOB_TIMEOUT_MS = 4_000;
const EXPORT_ARCHIVE_TIMEOUT_MS = 30_000;
const EXPORT_SCENE_GAP_PX = 20;
const EXPORT_TIMEOUT_ERROR_MESSAGE = "Export timed out. Please try again.";
const EXPORT_LOCK_ERROR_MESSAGE = "Another export is already running. Please wait for it to finish.";

let exportInProgress = false;

const buildFileSafeName = (value: string) =>
  value
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

const getNodeRect = (node: HTMLElement) => {
  const rect = node.getBoundingClientRect();

  return {
    height: Math.max(1, Math.round(rect.height)),
    width: Math.max(1, Math.round(rect.width)),
  };
};

const waitForAnimationFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const waitForTimeout = (timeoutMs: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), timeoutMs);
  });

const runWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) => {
  let timeoutId = 0;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(errorMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
};

const runWithExportLock = async <T>(task: () => Promise<T>) => {
  if (exportInProgress) {
    throw new Error(EXPORT_LOCK_ERROR_MESSAGE);
  }

  exportInProgress = true;

  try {
    return await task();
  } finally {
    exportInProgress = false;
  }
};

const waitForFonts = async () => {
  if (typeof document === "undefined" || !("fonts" in document)) return;

  await Promise.race([document.fonts.ready, waitForTimeout(2_000)]);
};

const waitForImageDecode = async (image: HTMLImageElement) => {
  if (image.complete && image.naturalWidth > 0) {
    if (typeof image.decode === "function") {
      try {
        await image.decode();
      } catch {
        // The browser can reject decode for already-usable images.
      }
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timerId = 0;

    const cleanup = () => {
      if (timerId) {
        window.clearTimeout(timerId);
      }
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };

    const handleLoad = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const handleError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Image failed to load for export: ${image.currentSrc || image.src || "unknown"}`));
    };

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    timerId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Image timed out before export: ${image.currentSrc || image.src || "unknown"}`));
    }, 6_000);
  });
};

const waitForImages = async (node: HTMLElement) => {
  const images = Array.from(node.querySelectorAll("img"));
  if (images.length === 0) return;

  await Promise.all(images.map((image) => waitForImageDecode(image)));
};

const waitForExportReady = async (node: HTMLElement) => {
  if (!node.isConnected) {
    throw new Error("Export component is not mounted.");
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < EXPORT_READY_TIMEOUT_MS) {
    const { width, height } = getNodeRect(node);
    if (width > 0 && height > 0) {
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      await waitForFonts();
      await waitForImages(node);
      return;
    }

    await waitForAnimationFrame();
  }

  throw new Error("Export component has no measurable size.");
};

const resolvePixelRatio = (pixelRatio?: number) =>
  Math.min(MAX_EXPORT_PIXEL_RATIO, Math.max(1, pixelRatio ?? DEFAULT_EXPORT_PIXEL_RATIO));

const isHtmlElement = (value: Element | ChildNode | null): value is HTMLElement => value instanceof HTMLElement;

const shouldNeutralizeTransform = (transform: string) =>
  /rotate(?:x|y|3d)\(/i.test(transform) || /scaleX\(-1\)/i.test(transform) || /matrix3d\(/i.test(transform);

const assertExportNode = (node: HTMLElement) => {
  if (!node) {
    throw new Error("Export component is not available.");
  }

  if (!node.isConnected) {
    throw new Error("Export component is no longer mounted.");
  }
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Unable to convert export image into PDF data."));
    };
    reader.onerror = () => reject(new Error("Unable to read export image blob."));
    reader.readAsDataURL(blob);
  });

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("PNG generation returned an empty file."));
    }, "image/png");
  });

const disposeCanvas = (canvas: HTMLCanvasElement | null) => {
  if (!canvas) return;

  canvas.width = 0;
  canvas.height = 0;
  canvas.remove();
};

const neutralizeExportTree = (root: HTMLElement) => {
  root.querySelectorAll("style").forEach((styleNode) => styleNode.remove());

  const nodes = [root, ...Array.from(root.querySelectorAll("*")).filter(isHtmlElement)];
  for (const element of nodes) {
    element.style.animation = "none";
    element.style.transition = "none";

    if (element.style.transformStyle) {
      element.style.transformStyle = "flat";
    }

    if (element.style.perspective) {
      element.style.perspective = "none";
    }

    if (element.style.backfaceVisibility) {
      element.style.backfaceVisibility = "visible";
    }

    element.style.setProperty("-webkit-backface-visibility", "visible");

    if (shouldNeutralizeTransform(element.style.transform)) {
      element.style.transform = "none";
    }
  }
};

const createOffscreenExportHost = (width: number) => {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = `${width}px`;
  host.style.padding = "0";
  host.style.margin = "0";
  host.style.opacity = "1";
  host.style.pointerEvents = "none";
  host.style.background = "#ffffff";
  host.style.zIndex = "-1";
  host.style.isolation = "isolate";
  return host;
};

const createPreparedFaceNode = (faceTemplate: HTMLElement, width: number, height: number) => {
  const shell = document.createElement("div");
  shell.style.position = "relative";
  shell.style.width = `${width}px`;
  shell.style.height = `${height}px`;
  shell.style.overflow = "hidden";
  shell.style.background = "transparent";

  const face = faceTemplate.cloneNode(true) as HTMLElement;
  neutralizeExportTree(face);
  face.style.position = "absolute";
  face.style.inset = "0";
  face.style.width = "100%";
  face.style.height = "100%";
  face.style.transform = "none";
  face.style.backfaceVisibility = "visible";
  face.style.setProperty("-webkit-backface-visibility", "visible");
  face.style.transition = "none";

  shell.appendChild(face);
  return shell;
};

type PreparedIdCardExportScene = {
  cleanup: () => void;
  pageNodes: [HTMLElement, HTMLElement];
  stackedNode: HTMLElement;
};

const buildPreparedIdCardExportScene = (node: HTMLElement): PreparedIdCardExportScene => {
  assertExportNode(node);

  const { width, height } = getNodeRect(node);
  const clonedNode = node.cloneNode(true) as HTMLElement;
  clonedNode.removeAttribute("aria-pressed");
  clonedNode.removeAttribute("tabindex");
  clonedNode.removeAttribute("role");

  const shell = Array.from(clonedNode.children).find((child) => isHtmlElement(child) && child.tagName !== "STYLE");
  const flipStage = shell ? Array.from(shell.children).find(isHtmlElement) : null;

  if (!flipStage) {
    throw new Error("Unable to prepare a static ID card export.");
  }

  const [frontFace, backFace] = Array.from(flipStage.children).filter(isHtmlElement);

  if (!frontFace || !backFace) {
    throw new Error("ID card front and back faces are not available for export.");
  }

  const host = createOffscreenExportHost(width);
  const stackedNode = document.createElement("div");
  stackedNode.style.display = "flex";
  stackedNode.style.flexDirection = "column";
  stackedNode.style.alignItems = "flex-start";
  stackedNode.style.gap = `${EXPORT_SCENE_GAP_PX}px`;
  stackedNode.style.width = `${width}px`;
  stackedNode.style.background = "#ffffff";

  const frontNode = createPreparedFaceNode(frontFace, width, height);
  const backNode = createPreparedFaceNode(backFace, width, height);

  stackedNode.append(frontNode, backNode);
  host.appendChild(stackedNode);
  document.body.appendChild(host);

  return {
    cleanup: () => {
      stackedNode.replaceChildren();
      host.remove();
    },
    pageNodes: [frontNode, backNode],
    stackedNode,
  };
};

const withPreparedIdCardExportScene = async <T>(
  node: HTMLElement,
  task: (scene: PreparedIdCardExportScene) => Promise<T>,
) => {
  const scene = buildPreparedIdCardExportScene(node);

  try {
    return await task(scene);
  } finally {
    scene.cleanup();
  }
};

const triggerBlobDownload = (blob: Blob, filename: string) => {
  if (typeof document === "undefined") {
    throw new Error("Download is only available in the browser.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    anchor.remove();
  }, 1_000);
};

const renderNodeToBlob = async (node: HTMLElement, options: IdCardExportOptions = {}) => {
  assertExportNode(node);
  await waitForExportReady(node);
  await waitForAnimationFrame();

  let canvas: HTMLCanvasElement | null = null;

  try {
    canvas = await runWithTimeout(
      toCanvas(node, {
        backgroundColor: options.backgroundColor,
        cacheBust: true,
        pixelRatio: resolvePixelRatio(options.pixelRatio),
      }),
      EXPORT_RENDER_TIMEOUT_MS,
      EXPORT_TIMEOUT_ERROR_MESSAGE,
    );

    return await runWithTimeout(canvasToBlob(canvas), EXPORT_BLOB_TIMEOUT_MS, EXPORT_TIMEOUT_ERROR_MESSAGE);
  } finally {
    disposeCanvas(canvas);
  }
};

const getPdfDimensions = (node: HTMLElement) => {
  const { width, height } = getNodeRect(node);
  const mmPerPx = CARD_WIDTH_MM / width;

  return {
    heightMm: height * mmPerPx,
    orientation: width >= height ? "landscape" : "portrait",
    widthMm: width * mmPerPx,
  } as const;
};

const buildPdfFromPageNodes = async (pageNodes: HTMLElement[], options: IdCardExportOptions = {}) => {
  let pdf: jsPDF | null = null;

  for (let index = 0; index < pageNodes.length; index += 1) {
    const pageNode = pageNodes[index];
    const imageBlob = await renderNodeToBlob(pageNode, options);
    const imageDataUrl = await runWithTimeout(blobToDataUrl(imageBlob), EXPORT_BLOB_TIMEOUT_MS, EXPORT_TIMEOUT_ERROR_MESSAGE);
    const dimensions = getPdfDimensions(pageNode);

    if (!pdf) {
      pdf = new jsPDF({
        compress: true,
        format: [dimensions.widthMm, dimensions.heightMm],
        orientation: dimensions.orientation,
        unit: "mm",
      });
    } else {
      pdf.addPage([dimensions.widthMm, dimensions.heightMm], dimensions.orientation);
    }

    pdf.addImage(imageDataUrl, "PNG", 0, 0, dimensions.widthMm, dimensions.heightMm, undefined, "FAST");
    await waitForAnimationFrame();
  }

  if (!pdf) {
    throw new Error("Unable to build the ID card PDF.");
  }

  return pdf;
};

const buildPdfFromNode = async (node: HTMLElement, options: IdCardExportOptions = {}) =>
  withPreparedIdCardExportScene(node, async (scene) => buildPdfFromPageNodes(scene.pageNodes, options));

const buildPngBlobFromNode = async (node: HTMLElement, options: IdCardExportOptions = {}) =>
  withPreparedIdCardExportScene(node, async (scene) => renderNodeToBlob(scene.stackedNode, options));

export const downloadIdCardPng = async (node: HTMLElement, filename: string, options?: IdCardExportOptions) =>
  runWithExportLock(async () => {
    const blob = await buildPngBlobFromNode(node, options);
    triggerBlobDownload(blob, `${buildFileSafeName(filename)}.png`);
  });

export const downloadIdCardPdf = async (node: HTMLElement, filename: string, options?: IdCardExportOptions) =>
  runWithExportLock(async () => {
    const pdf = await buildPdfFromNode(node, options);
    const blob = pdf.output("blob");
    triggerBlobDownload(blob, `${buildFileSafeName(filename)}.pdf`);
  });

const buildPdfBlobFromNode = async (node: HTMLElement, options: IdCardExportOptions = {}) => {
  const pdf = await buildPdfFromNode(node, options);
  return pdf.output("blob");
};

export const downloadBulkIdCardZip = async ({
  items,
  options,
  zipName,
  onProgress,
}: {
  items: BulkIdCardExportItem[];
  options?: IdCardExportOptions;
  zipName: string;
  onProgress?: (progress: number) => void;
}) =>
  runWithExportLock(async () => {
    if (items.length === 0) {
      throw new Error("No ID cards are ready for export.");
    }

    const zip = new JSZip();

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const pdfBlob = await buildPdfBlobFromNode(item.node, options);
      zip.file(`${buildFileSafeName(item.name)}.pdf`, pdfBlob);
      onProgress?.(Math.round(((index + 1) / items.length) * 100));
      await waitForAnimationFrame();
    }

    const zipBlob = await runWithTimeout(zip.generateAsync({ type: "blob" }), EXPORT_ARCHIVE_TIMEOUT_MS, EXPORT_TIMEOUT_ERROR_MESSAGE);
    triggerBlobDownload(zipBlob, `${buildFileSafeName(zipName)}.zip`);
  });
