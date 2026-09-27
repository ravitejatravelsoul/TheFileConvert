import { savePdfChecked } from "@/lib/pdf/save";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { EncryptedPdfError, loadPdfForEditing } from "@/lib/pdf/load";
import { isCompleteImage } from "./image-integrity";

export interface NamedBlob {
  name: string;
  blob: Blob;
}

export class ProcessorError extends Error {}

async function loadPdf(file: File): Promise<PDFDocument> {
  const bytes = await file.arrayBuffer();
  try {
    return await loadPdfForEditing(bytes);
  } catch (e) {
    if (e instanceof EncryptedPdfError) throw new ProcessorError(e.message);
    throw new ProcessorError(
      "We couldn't read this PDF. It may be damaged, encrypted, or incomplete."
    );
  }
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
  const bytes = await savePdfChecked(merged);
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
  const bytes = await savePdfChecked(out);
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
    const bytes = await savePdfChecked(out);
    results.push({
      name: `part-${partNumber}.pdf`,
      blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    });
    partNumber++;
  }
  return results;
}

export interface PagePlan {
  /** 0-based page index in the source PDF. The same index may appear more than once (a duplicate). */
  index: number;
  /** Extra clockwise rotation, added to the page's own. */
  rotate: 0 | 90 | 180 | 270;
}

/** Builds a new PDF from an ordered list of source pages — reorder, rotate, duplicate and drop in one pass.
 * Pages are copied, not re-rendered, so text and images are untouched. */
export async function buildPdfFromPages(file: File, plan: PagePlan[]): Promise<Blob> {
  if (plan.length === 0) throw new ProcessorError("Keep at least one page.");
  const source = await loadPdf(file);
  const count = source.getPageCount();
  if (plan.some((p) => p.index < 0 || p.index >= count)) throw new ProcessorError("That page doesn't exist in this PDF.");
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, plan.map((p) => p.index));
  pages.forEach((page, i) => {
    const turn = plan[i].rotate;
    if (turn) page.setRotation(degrees((((page.getRotation().angle + turn) % 360) + 360) % 360));
    out.addPage(page);
  });
  const bytes = await savePdfChecked(out);
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
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Decide by content, not by name: a ".jpg" that is really a PNG still embeds correctly.
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpeg) throw new ProcessorError(`"${file.name}" isn't a JPG or PNG image.`);
    if (!isCompleteImage(bytes)) throw new ProcessorError(`"${file.name}" couldn't be read. It may be damaged.`);
    let image;
    try {
      image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      throw new ProcessorError(`"${file.name}" couldn't be read. It may be damaged.`);
    }

    if (options.pageSize === "fit") {
      // Pixels at the standard 96 dpi -> points (x0.75), so a 1600 px image is a 12-inch page, not a 22-inch one.
      const w = image.width * 0.75;
      const h = image.height * 0.75;
      const page = doc.addPage([w, h]);
      page.drawImage(image, { x: 0, y: 0, width: w, height: h });
      continue;
    }

    // Landscape images get a landscape page, so they aren't shrunk to fit a portrait one.
    const [shortSide, longSide] = PAGE_SIZES[options.pageSize];
    const [pageWidth, pageHeight] = image.width > image.height ? [longSide, shortSide] : [shortSide, longSide];
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

  const bytes = await savePdfChecked(doc);
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

/** The built-in PDF fonts only cover Latin-1-style text. Say which character can't be drawn instead of
 * failing with an internal encoding error. */
function assertDrawable(font: PDFFont, text: string, what: string) {
  for (const ch of text) {
    try {
      font.widthOfTextAtSize(ch, 10);
    } catch {
      throw new ProcessorError(`The ${what} contains "${ch}", which this tool can't draw (it supports standard Latin letters, digits and common punctuation). Please remove or replace it.`);
    }
  }
}

export async function addWatermark(file: File, options: WatermarkOptions): Promise<Blob> {
  const doc = await loadPdf(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  assertDrawable(font, options.text, "watermark text");
  for (const page of doc.getPages()) {
    const shown = displayedPage(page);
    const textWidth = font.widthOfTextAtSize(options.text, options.fontSize);
    // Centre and angle are worked out for the page as displayed, then mapped into the page's own space.
    const at = watermarkOrigin(shown.width, shown.height, textWidth, options.fontSize, options.rotationDegrees);
    const { x, y } = shown.toPage(at.x, at.y);
    page.drawText(options.text, {
      x,
      y,
      size: options.fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: options.opacity,
      rotate: degrees(options.rotationDegrees + shown.angle),
    });
  }
  const bytes = await savePdfChecked(doc);
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

/** The page as a viewer shows it: its visible box (CropBox, else MediaBox) with /Rotate applied. Stamps are
 * positioned in these *displayed* coordinates (origin bottom-left, y up) and then mapped back into the
 * page's own coordinate space, so "bottom center" is the bottom of what the reader sees even on a page
 * stored rotated. */
export function displayedPage(page: PDFPage): { width: number; height: number; toPage: (dx: number, dy: number) => { x: number; y: number }; angle: number } {
  const box = page.getCropBox();
  const angle = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  const W = box.width;
  const H = box.height;
  switch (angle) {
    case 90:
      return { width: H, height: W, angle, toPage: (dx, dy) => ({ x: box.x + W - dy, y: box.y + dx }) };
    case 180:
      return { width: W, height: H, angle, toPage: (dx, dy) => ({ x: box.x + W - dx, y: box.y + H - dy }) };
    case 270:
      return { width: H, height: W, angle, toPage: (dx, dy) => ({ x: box.x + dy, y: box.y + H - dx }) };
    default:
      return { width: W, height: H, angle: 0, toPage: (dx, dy) => ({ x: box.x + dx, y: box.y + dy }) };
  }
}

export async function addPageNumbers(file: File, options: PageNumberOptions): Promise<Blob> {
  const doc = await loadPdf(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const label = String(options.startAt + index);
    const shown = displayedPage(page);
    const textWidth = font.widthOfTextAtSize(label, options.fontSize);
    const at = pageNumberCoords(options.position, shown.width, shown.height, textWidth);
    const { x, y } = shown.toPage(at.x, at.y);
    page.drawText(label, { x, y, size: options.fontSize, font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(shown.angle) });
  });
  const bytes = await savePdfChecked(doc);
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
  assertDrawable(font, options.text.replace(/\{page\}/g, ""), "header/footer text");
  const margin = 24;
  doc.getPages().forEach((page, index) => {
    const label = options.text.replace(/\{page\}/g, String(index + 1));
    const shown = displayedPage(page);
    const textWidth = font.widthOfTextAtSize(label, options.fontSize);
    let dx: number;
    if (options.align === "left") dx = margin;
    else if (options.align === "right") dx = shown.width - textWidth - margin;
    else dx = shown.width / 2 - textWidth / 2;
    const dy = options.position === "header" ? shown.height - margin : margin;
    const { x, y } = shown.toPage(dx, dy);
    page.drawText(label, { x, y, size: options.fontSize, font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(shown.angle) });
  });
  const bytes = await savePdfChecked(doc);
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export interface PdfToImagesOptions {
  /** 0-based page indices to render, in order. All pages when omitted. */
  pages?: number[];
  /** Base for output names: "<base>-page-3.jpg". */
  baseName?: string;
  onPage?: (done: number, total: number) => void;
}

export async function pdfToImages(file: File, format: "png" | "jpeg", scale: number, options: PdfToImagesOptions = {}): Promise<NamedBlob[]> {
  const { loadPdfJsDocument, renderPageToCanvas } = await import("./pdfjs-utils");
  const doc = await loadPdfJsDocument(file);
  const indices = options.pages ?? Array.from({ length: doc.numPages }, (_, i) => i);
  const prefix = options.baseName ? `${options.baseName}-page` : "page";
  const results: NamedBlob[] = [];

  for (const [n, index] of indices.entries()) {
    if (index < 0 || index >= doc.numPages) throw new ProcessorError(`Page ${index + 1} doesn't exist in this PDF.`);
    const canvas = await renderPageToCanvas(doc, index + 1, scale);
    if (format === "jpeg") {
      // JPEG has no transparency: pages with a transparent background would otherwise turn black.
      const flat = document.createElement("canvas");
      flat.width = canvas.width;
      flat.height = canvas.height;
      const ctx = flat.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, flat.width, flat.height);
        ctx.drawImage(canvas, 0, 0);
      }
      canvas.width = 0;
      results.push({ name: `${prefix}-${index + 1}.jpg`, blob: await canvasBlob(flat, "image/jpeg") });
      flat.width = 0;
    } else {
      results.push({ name: `${prefix}-${index + 1}.png`, blob: await canvasBlob(canvas, "image/png") });
      canvas.width = 0;
    }
    options.onPage?.(n + 1, indices.length);
  }

  return results;
}

function canvasBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ProcessorError("Rendering failed for this page."))), mime, 0.92);
  });
}
