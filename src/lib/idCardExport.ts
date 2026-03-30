import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const cardPdfSize = { width: 85.6, height: 54 };

const buildFileSafeName = (value: string) =>
  value
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

const getPngDataUrl = async (node: HTMLElement) =>
  toPng(node, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: undefined,
  });

export const downloadIdCardPng = async (node: HTMLElement, filename: string) => {
  const dataUrl = await getPngDataUrl(node);
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = `${buildFileSafeName(filename)}.png`;
  link.click();
};

export const downloadIdCardPdf = async (node: HTMLElement, filename: string) => {
  const dataUrl = await getPngDataUrl(node);
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [cardPdfSize.width, cardPdfSize.height],
  });
  pdf.addImage(dataUrl, "PNG", 0, 0, cardPdfSize.width, cardPdfSize.height);
  pdf.save(`${buildFileSafeName(filename)}.pdf`);
};

export const downloadBulkIdCardZip = async ({
  items,
  zipName,
  onProgress,
}: {
  items: Array<{ name: string; node: HTMLElement }>;
  zipName: string;
  onProgress?: (progress: number) => void;
}) => {
  const zip = new JSZip();
  const total = items.length;

  for (let i = 0; i < total; i += 1) {
    const item = items[i];
    const dataUrl = await getPngDataUrl(item.node);
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [cardPdfSize.width, cardPdfSize.height],
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, cardPdfSize.width, cardPdfSize.height);
    const pdfBlob = pdf.output("blob");
    zip.file(`${buildFileSafeName(item.name)}.pdf`, pdfBlob);
    onProgress?.(Math.round(((i + 1) / total) * 100));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `${buildFileSafeName(zipName)}.zip`);
};
