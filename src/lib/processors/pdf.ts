import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export interface NamedBlob {
  name: string;
  blob: Blob;
}

export class ProcessorError extends Error {}

async function loadPdf(file: File): Promise<PDFDocument> {
  const bytes = await file.arrayBuffer();
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new ProcessorError(
      "We couldn't read this PDF. It may be damaged, encrypted, or incomplete."
    );
  }
}

export async function getPdfPageCount(file: File): Promise<number> {
  const doc = await loadPdf(file);
  return doc.getPageCount();
}

export interface PdfBasicMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  pageCount: number;
}

export async function getPdfMetadata(file: File): Promise<PdfBasicMetadata> {
  const doc = await loadPdf(file);
  return {
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: doc.getKeywords() ?? "",
    creator: doc.getCreator() ?? "",
    producer: doc.getProducer() ?? "",
    pageCount: doc.getPageCount(),
  };
}

export async function removePdfMetadata(file: File): Promise<Blob> {
  const doc = await loadPdf(file);
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setCreator("");
  doc.setProducer("");
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/** Lossless re-save with compressed cross-reference streams. Real, modest savings; safe on any PDF. */
export async function compressPdf(file: File): Promise<Blob> {
  const doc = await loadPdf(file);
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export async function mergePdfs(files: File[]): Promise<Blob> {
  if (files.length < 2) {
    throw new ProcessorError("Add at least two PDFs to merge.");
  }
  const merged = await PDFDocument.create();
  for (const file of files) {
    const doc = await loadPdf(file);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  const bytes = await merged.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/** Parses ranges like "1-3,5,8-10" (1-indexed, inclusive) into a sorted, deduped 0-indexed list. */
export function parsePageRanges(input: string, pageCount: number): number[] {
  const indices = new Set<number>();
  const cleaned = input.trim();
  if (!cleaned) throw new ProcessorError("Enter at least one page or range.");

  for (const rawPart of cleaned.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      let start = parseInt(rangeMatch[1], 10);
      let end = parseInt(rangeMatch[2], 10);
      if (start > end) [start, end] = [end, start];
      for (let p = start; p <= end; p++) {
        if (p >= 1 && p <= pageCount) indices.add(p - 1);
      }
      continue;
    }
    const single = parseInt(part, 10);
    if (Number.isNaN(single)) {
      throw new ProcessorError(`"${part}" isn't a valid page number or range.`);
    }
    if (single >= 1 && single <= pageCount) indices.add(single - 1);
  }

  if (indices.size === 0) {
    throw new ProcessorError("None of the pages you entered exist in this PDF.");
  }
  return [...indices].sort((a, b) => a - b);
}

export async function extractPages(file: File, pageRanges: string): Promise<Blob> {
  const source = await loadPdf(file);
  const indices = parsePageRanges(pageRanges, source.getPageCount());
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, indices);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export async function deletePages(file: File, pageRanges: string): Promise<Blob> {
  const source = await loadPdf(file);
  const pageCount = source.getPageCount();
  const toDelete = new Set(parsePageRanges(pageRanges, pageCount));
  if (toDelete.size >= pageCount) {
    throw new ProcessorError("You can't delete every page in the document.");
  }
  const keep = Array.from({ length: pageCount }, (_, i) => i).filter(
    (i) => !toDelete.has(i)
  );
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, keep);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export async function splitPdfEveryNPages(file: File, n: number): Promise<NamedBlob[]> {
  const source = await loadPdf(file);
  const pageCount = source.getPageCount();
  if (n < 1) throw new ProcessorError("Pages per file must be at least 1.");
  const results: NamedBlob[] = [];
  let partNumber = 1;
  for (let start = 0; start < pageCount; start += n) {
    const end = Math.min(start + n, pageCount);
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await out.copyPages(source, indices);
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    results.push({
      name: `part-${partNumber}.pdf`,
      blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    });
    partNumber++;
  }
  return results;
}

export async function rotatePages(
  file: File,
  rotationDegrees: 90 | 180 | 270,
  pageRanges?: string
): Promise<Blob> {
  const doc = await loadPdf(file);
  const pageCount = doc.getPageCount();
  const targetIndices = pageRanges
    ? new Set(parsePageRanges(pageRanges, pageCount))
    : new Set(Array.from({ length: pageCount }, (_, i) => i));

  doc.getPages().forEach((page, i) => {
    if (targetIndices.has(i)) {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + rotationDegrees) % 360));
    }
  });
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export async function reorderPages(file: File, newOrder: number[]): Promise<Blob> {
  const source = await loadPdf(file);
  const pageCount = source.getPageCount();
  if (
    newOrder.length !== pageCount ||
    new Set(newOrder).size !== pageCount ||
    newOrder.some((i) => i < 0 || i >= pageCount)
  ) {
    throw new ProcessorError("The new page order must include every page exactly once.");
  }
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, newOrder);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export interface ImagesToPdfOptions {
  pageSize: "a4" | "letter" | "fit";
  margin: number;
}

const PAGE_SIZES: Record<"a4" | "letter", [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export async function imagesToPdf(files: File[], options: ImagesToPdfOptions): Promise<Blob> {
  if (files.length === 0) throw new ProcessorError("Add at least one image.");
  const doc = await PDFDocument.create();

  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
    const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);

    if (options.pageSize === "fit") {
      const page = doc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      continue;
    }

    const [pageWidth, pageHeight] = PAGE_SIZES[options.pageSize];
    const page = doc.addPage([pageWidth, pageHeight]);
    const margin = options.margin;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    page.drawImage(image, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
  }

  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export interface WatermarkOptions {
  text: string;
  opacity: number;
  fontSize: number;
  rotationDegrees: number;
}

/**
 * Where to start drawing a watermark so its *center* lands on the page's center after being
 * rotated by `rotationDegrees`. pdf-lib rotates text about its starting point (the left end of
 * the baseline), so simply starting at (centerX - width/2, centerY) leaves anything but a
 * horizontal watermark pushed off-center — a diagonal one drifts up, a vertical one left.
 */
export function watermarkOrigin(
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  fontSize: number,
  rotationDegrees: number
): { x: number; y: number } {
  const theta = (rotationDegrees * Math.PI) / 180;
  const halfW = textWidth / 2;
  const halfH = fontSize * 0.35; // ~ half the height of lowercase/cap letters above the baseline
  return {
    x: pageWidth / 2 - (halfW * Math.cos(theta) - halfH * Math.sin(theta)),
    y: pageHeight / 2 - (halfW * Math.sin(theta) + halfH * Math.cos(theta)),
  };
}

export async function addWatermark(file: File, options: WatermarkOptions): Promise<Blob> {
  const doc = await loadPdf(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(options.text, options.fontSize);
    const origin = watermarkOrigin(width, height, textWidth, options.fontSize, options.rotationDegrees);
    page.drawText(options.text, {
      x: origin.x,
      y: origin.y,
      size: options.fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: options.opacity,
      rotate: degrees(options.rotationDegrees),
    });
  }
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export interface PageNumberOptions {
  position: "bottom-center" | "bottom-right" | "bottom-left" | "top-center";
  startAt: number;
  fontSize: number;
}

function pageNumberCoords(
  position: PageNumberOptions["position"],
  width: number,
  height: number,
  textWidth: number
): { x: number; y: number } {
  const margin = 24;
  switch (position) {
    case "bottom-left":
      return { x: margin, y: margin };
    case "bottom-right":
      return { x: width - textWidth - margin, y: margin };
    case "top-center":
      return { x: width / 2 - textWidth / 2, y: height - margin };
    case "bottom-center":
    default:
      return { x: width / 2 - textWidth / 2, y: margin };
  }
}

export async function addPageNumbers(file: File, options: PageNumberOptions): Promise<Blob> {
  const doc = await loadPdf(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const label = String(options.startAt + index);
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(label, options.fontSize);
    const { x, y } = pageNumberCoords(options.position, width, height, textWidth);
    page.drawText(label, { x, y, size: options.fontSize, font, color: rgb(0.2, 0.2, 0.2) });
  });
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export interface HeaderFooterOptions {
  /** May contain the "{page}" token, replaced with each page's 1-indexed number. */
  text: string;
  position: "header" | "footer";
  align: "left" | "center" | "right";
  fontSize: number;
}

/** Stamps the same header/footer text onto every page — reuses the exact drawText
 * approach as addWatermark/addPageNumbers rather than introducing a second rendering
 * system. */
export async function addHeaderFooter(file: File, options: HeaderFooterOptions): Promise<Blob> {
  if (!options.text.trim()) {
    throw new ProcessorError("Enter header or footer text.");
  }
  const doc = await loadPdf(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const margin = 24;
  doc.getPages().forEach((page, index) => {
    const label = options.text.replace(/\{page\}/g, String(index + 1));
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(label, options.fontSize);
    let x: number;
    if (options.align === "left") x = margin;
    else if (options.align === "right") x = width - textWidth - margin;
    else x = width / 2 - textWidth / 2;
    const y = options.position === "header" ? height - margin : margin;
    page.drawText(label, { x, y, size: options.fontSize, font, color: rgb(0.2, 0.2, 0.2) });
  });
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export async function pdfToImages(
  file: File,
  format: "png" | "jpeg",
  scale: number
): Promise<NamedBlob[]> {
  const { loadPdfJsDocument, renderPageToCanvas } = await import("./pdfjs-utils");
  const doc = await loadPdfJsDocument(file);
  const results: NamedBlob[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const canvas = await renderPageToCanvas(doc, pageNum, scale);
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ProcessorError("Rendering failed for this page."))),
        mime,
        0.92
      );
    });
    results.push({ name: `page-${pageNum}.${format === "png" ? "png" : "jpg"}`, blob });
  }

  return results;
}
