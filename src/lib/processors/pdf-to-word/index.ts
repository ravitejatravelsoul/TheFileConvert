import { buildDocx, verifyDocx } from "./docx";
import { extractPages, PdfToWordError, type Progress } from "./extract";
import { documentStats, layoutPage, type PageLayout } from "./layout";

export { analyzePdf, PdfToWordError, type PdfAnalysis, type Progress } from "./extract";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface PdfToWordResult {
  blob: Blob;
  pages: number;
  images: number;
  scannedPages: number;
}

/** PDF → editable .docx, entirely in the browser. */
export async function convertPdfToWord(file: File, options: { ocrLang?: string; onProgress?: (p: Progress) => void } = {}): Promise<PdfToWordResult> {
  const inputs = await extractPages(file, options.ocrLang ?? "eng", options.onProgress ?? (() => {}));
  const stats = documentStats(inputs);
  const listKeys = { next: 1 };
  const layouts: PageLayout[] = inputs.map((p) => layoutPage(p, stats, listKeys));
  const bytes = await buildDocx(layouts, { title: file.name.replace(/\.pdf$/i, ""), bodySize: stats.bodySize });
  // Never hand over a broken document.
  const problems = await verifyDocx(bytes);
  if (problems.length) throw new PdfToWordError("The Word document didn't pass our file check, so it wasn't saved. Please try again.");
  return {
    blob: new Blob([bytes as BlobPart], { type: DOCX_MIME }),
    pages: layouts.length,
    images: layouts.reduce((n, l) => n + l.blocks.filter((b) => b.kind === "image").length, 0),
    scannedPages: inputs.filter((p) => p.items.some((i) => i.ocr)).length,
  };
}
