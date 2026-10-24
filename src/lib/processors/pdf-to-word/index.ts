import { buildDocx, verifyDocx } from "./docx";
import { extractPages, PdfToWordError, PdfToWordCancelled, type PageReport, type Progress } from "./extract";
import { documentStats, findHeadersFooters, layoutPage, type PageLayout } from "./layout";
import type { ScanReport, Strategy } from "./scanPage";

export { analyzePdf, PdfToWordError, PdfToWordCancelled, type PageReport, type PdfAnalysis, type Progress } from "./extract";
export { type PageClass, type PageStrategy } from "./classify";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface PdfToWordResult {
  blob: Blob;
  pages: number;
  images: number;
  /** Pages that were pictures of a page (any strategy). */
  scannedPages: number;
  /** Pages kept as they look: the page itself is in the Word file as an image. */
  visualPages: number;
  /** Pages written as editable Word content: real text, plus plain scans read with extreme confidence. */
  editablePages: number;
  /** How each page was written (native text / structured scan / visual). */
  strategies: Strategy[];
  /** Per plain scan rebuilt as editable text: confidence and what was found (undefined otherwise). */
  scanReports: (ScanReport | undefined)[];
  /** Per page: its class, how it was written and why. */
  pageReports: PageReport[];
}

/**
 * PDF → Word, entirely in the browser. Conversion preserves the document; it is not OCR. In stages:
 *   analysis + page classification (extract.ts, classify.ts): native text pages are read for editable
 *   content; pages that are pictures (scans, forms, IDs, certificates, photos) are classified from their pixels
 *   → native pages: editable reconstruction; picture pages: kept as they look (the page goes into the Word
 *     file as an image, no OCR), unless a plain scan of running text is read with extreme confidence
 *     (scan.ts, scanPage.ts, then classify.ts hybridDecision)
 *   → semantic reconstruction (layout.ts: headings, paragraphs, lists, tables, columns, boxes, rules)
 *   → DOCX generation (docx.ts) → DOCX validation (verifyDocx).
 */
export async function convertPdfToWord(file: File, options: { ocrLang?: string; onProgress?: (p: Progress) => void; signal?: AbortSignal } = {}): Promise<PdfToWordResult> {
  const onProgress = options.onProgress ?? (() => {});
  const { pages: inputs, reports, pageReports } = await extractPages(file, options.ocrLang ?? "eng", onProgress, options.signal);
  if (options.signal?.aborted) throw new PdfToWordCancelled();
  const stats = documentStats(inputs);
  const listKeys = { next: 1 };
  const bands = findHeadersFooters(inputs);
  const layouts: PageLayout[] = inputs.map((p, i) => layoutPage(p, stats, listKeys, bands[i]));
  const bytes = await buildDocx(layouts, { title: file.name.replace(/\.pdf$/i, ""), bodySize: stats.bodySize, bodyFont: stats.bodyFont });
  // Never hand over a broken document.
  onProgress({ stage: "validating" });
  const problems = await verifyDocx(bytes);
  if (problems.length) console.error("PDF → Word: the .docx failed its check:", problems);
  if (problems.length) throw new PdfToWordError("The Word document didn't pass our file check, so it wasn't saved. Please try again.");
  return {
    blob: new Blob([bytes as BlobPart], { type: DOCX_MIME }),
    pages: layouts.length,
    images: layouts.reduce((n, l) => n + l.blocks.filter((b) => b.kind === "image").length + l.floating.length, 0),
    scannedPages: pageReports.filter((r) => r.cls !== "NATIVE_TEXT" && r.cls !== "MIXED" && r.cls !== "BLANK").length,
    visualPages: pageReports.filter((r) => r.strategy === "visual").length,
    editablePages: pageReports.filter((r) => r.strategy !== "visual").length,
    strategies: inputs.map((p) => p.strategy ?? "native"),
    scanReports: reports,
    pageReports,
  };
}
