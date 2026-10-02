import { buildDocx, verifyDocx } from "./docx";
import { extractPages, PdfToWordError, type Progress } from "./extract";
import { documentStats, findHeadersFooters, layoutPage, type PageLayout } from "./layout";
import type { ScanReport, Strategy } from "./scanPage";

export { analyzePdf, PdfToWordError, type PdfAnalysis, type Progress } from "./extract";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface PdfToWordResult {
  blob: Blob;
  pages: number;
  images: number;
  scannedPages: number;
  /** How each page was rebuilt (native text / structured scan / hybrid / visual fallback). */
  strategies: Strategy[];
  /** Per scanned page: confidence and what was found (undefined for text pages). */
  scanReports: (ScanReport | undefined)[];
}

/**
 * PDF → editable .docx, entirely in the browser, in stages:
 *   analysis + text extraction (extract.ts: native text, fonts, pictures, vector rules; page classification)
 *   → scanned pages: pixel layout analysis + OCR + confidence/fallback choice (scan.ts, scanPage.ts)
 *   → semantic reconstruction (layout.ts: headings, paragraphs, lists, tables, columns, boxes, rules)
 *   → DOCX generation (docx.ts) → DOCX validation (verifyDocx).
 */
export async function convertPdfToWord(file: File, options: { ocrLang?: string; onProgress?: (p: Progress) => void } = {}): Promise<PdfToWordResult> {
  const onProgress = options.onProgress ?? (() => {});
  const { pages: inputs, reports } = await extractPages(file, options.ocrLang ?? "eng", onProgress);
  const stats = documentStats(inputs);
  const listKeys = { next: 1 };
  const bands = findHeadersFooters(inputs);
  const layouts: PageLayout[] = inputs.map((p, i) => layoutPage(p, stats, listKeys, bands[i]));
  const bytes = await buildDocx(layouts, { title: file.name.replace(/\.pdf$/i, ""), bodySize: stats.bodySize, bodyFont: stats.bodyFont });
  // Never hand over a broken document.
  onProgress({ stage: "validating" });
  const problems = await verifyDocx(bytes);
  if (problems.length) throw new PdfToWordError("The Word document didn't pass our file check, so it wasn't saved. Please try again.");
  return {
    blob: new Blob([bytes as BlobPart], { type: DOCX_MIME }),
    pages: layouts.length,
    images: layouts.reduce((n, l) => n + l.blocks.filter((b) => b.kind === "image").length + l.floating.length, 0),
    scannedPages: inputs.filter((p) => p.items.some((i) => i.ocr) || p.background).length,
    strategies: inputs.map((p) => p.strategy ?? "native"),
    scanReports: reports,
  };
}
