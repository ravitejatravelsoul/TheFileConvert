import { loadPdfJsDocument, getPageTextContent, PdfRenderError } from "./pdfjs-utils";
import type { PageViewport } from "pdfjs-dist";

export class OcrError extends Error {}

// Self-hosted so the document, the rendered page images, and the recognized text never
// touch a third party — only these static runtime/model files are fetched, and only when
// OCR is actually requested. See docs/OCR.md for the full asset/license inventory.
const TESSERACT_WORKER_PATH = "/tesseract/worker.min.js";
const TESSERACT_CORE_PATH = "/tesseract/tesseract-core-lstm.wasm.js";
const TESSERACT_LANG_PATH = "/tesseract/lang-data";

export interface OcrLanguageOption {
  code: string;
  label: string;
}

/** Languages we actually ship trained data for and have verified with real fixtures.
 * Do not add a language here until it has been tested — see docs/OCR.md. */
export const SUPPORTED_OCR_LANGUAGES: OcrLanguageOption[] = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
];

// ---------------------------------------------------------------------------
// Per-page classification: native text vs. scanned vs. mixed
// ---------------------------------------------------------------------------

export type PageTextClassification = "native" | "scanned" | "mixed";

export interface PageClassification {
  pageIndex: number; // 0-based
  classification: PageTextClassification;
  nativeCharCount: number;
}

const NATIVE_TEXT_THRESHOLD = 20; // chars of embedded text => treat page as already text-native
const SCANNED_TEXT_THRESHOLD = 1; // fewer than this => treat as fully scanned

/** Classifies every page by how much native (embedded, selectable) text it already has.
 * This is a simple, honest heuristic — not full layout analysis — documented as such on
 * the OCR tool page. */
export async function classifyPdfPages(file: File): Promise<PageClassification[]> {
  const doc = await loadPdfJsDocument(file);
  const results: PageClassification[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const text = (await getPageTextContent(doc, pageNum)).replace(/\s/g, "");
    const nativeCharCount = text.length;
    const classification: PageTextClassification =
      nativeCharCount >= NATIVE_TEXT_THRESHOLD
        ? "native"
        : nativeCharCount <= SCANNED_TEXT_THRESHOLD
          ? "scanned"
          : "mixed";
    results.push({ pageIndex: pageNum - 1, classification, nativeCharCount });
  }

  return results;
}

// ---------------------------------------------------------------------------
// OCR session: one persistent Tesseract worker reused across pages
// ---------------------------------------------------------------------------

export interface OcrWord {
  text: string;
  confidence: number; // 0-100, as reported by Tesseract
  /** Position in PDF point space (origin bottom-left, y-up) — already mapped back from
   * the rendered canvas, so callers never need to know about render scale/rotation. */
  pdfBox: { x: number; y: number; width: number; height: number };
}

export interface OcrLine {
  text: string;
  pdfBox: { x: number; y: number; width: number; height: number };
}

export interface OcrPageResult {
  pageIndex: number; // 0-based
  text: string;
  words: OcrWord[];
  /** Line-level text runs (proper single-space-separated text), used to build the
   * searchable-PDF text layer — drawing whole lines instead of individual words keeps
   * multi-word phrase search working in the exported PDF. */
  lines: OcrLine[];
  meanConfidence: number;
  lowConfidenceWordCount: number;
}

export type OcrConfidenceTier = "high" | "medium" | "low";

export function confidenceTier(confidence: number): OcrConfidenceTier {
  if (confidence >= 85) return "high";
  if (confidence >= 60) return "medium";
  return "low";
}

export interface OcrSession {
  /** Renders one PDF page, optionally preprocesses it, and recognizes its text. */
  recognizePage(
    file: File,
    pageNumber: number,
    options: {
      scale?: number;
      rotate?: 0 | 90 | 180 | 270;
      enhance?: boolean;
      onProgress?: (fraction: number) => void;
    }
  ): Promise<OcrPageResult>;
  terminate(): Promise<void>;
}

/** Simple, cheap local preprocessing: grayscale + contrast stretch. Runs on the canvas
 * used for recognition only — the original scanned image embedded in the PDF is never
 * touched, so export always preserves the source page exactly. */
function enhanceCanvasForOcr(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const pixelCount = canvas.width * canvas.height;
  const gray = new Uint8ClampedArray(pixelCount);

  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const stretched = ((gray[p] - min) / range) * 255;
    data[i] = stretched;
    data[i + 1] = stretched;
    data[i + 2] = stretched;
  }
  ctx.putImageData(imageData, 0, 0);
}

type Bbox = { x0: number; y0: number; x1: number; y1: number };

function mapBboxToPdf(bbox: Bbox, viewport: PageViewport): OcrWord["pdfBox"] {
  const [px0, py0] = viewport.convertToPdfPoint(bbox.x0, bbox.y0);
  const [px1, py1] = viewport.convertToPdfPoint(bbox.x1, bbox.y1);
  return {
    x: Math.min(px0, px1),
    y: Math.min(py0, py1),
    width: Math.abs(px1 - px0),
    height: Math.abs(py1 - py0),
  };
}

function mapWordsToPdfSpace(
  words: { text: string; confidence: number; bbox: Bbox }[],
  viewport: PageViewport
): OcrWord[] {
  return words
    .filter((w) => w.text.trim().length > 0)
    .map((w) => ({ text: w.text, confidence: w.confidence, pdfBox: mapBboxToPdf(w.bbox, viewport) }));
}

function mapLinesToPdfSpace(
  lines: { text: string; bbox: Bbox }[],
  viewport: PageViewport
): OcrLine[] {
  return lines
    .filter((l) => l.text.trim().length > 0)
    .map((l) => ({ text: l.text.trimEnd(), pdfBox: mapBboxToPdf(l.bbox, viewport) }));
}

export async function createOcrSession(langCode: string): Promise<OcrSession> {
  const { createWorker, OEM } = await import("tesseract.js");

  // Tesseract.js reports progress through a single worker-level logger set at creation
  // time (not per recognize() call), so we route it to whichever page is currently being
  // recognized via this mutable handle. This is what gives the UI real, non-fake progress.
  let activeProgressHandler: ((fraction: number) => void) | null = null;

  let worker;
  try {
    worker = await createWorker(langCode, OEM.LSTM_ONLY, {
      workerPath: TESSERACT_WORKER_PATH,
      corePath: TESSERACT_CORE_PATH,
      langPath: TESSERACT_LANG_PATH,
      gzip: true,
      logger: (m) => {
        if (m.status === "recognizing text" && activeProgressHandler) {
          activeProgressHandler(m.progress);
        }
      },
    });
  } catch {
    throw new OcrError(
      "The OCR engine couldn't load. Check your connection and try again — the first run needs to download a small recognition model."
    );
  }

  let terminated = false;

  return {
    async recognizePage(file, pageNumber, options) {
      if (terminated) throw new OcrError("OCR was cancelled.");
      const scale = options.scale ?? 2;
      const rotate = options.rotate ?? 0;

      const doc = await loadPdfJsDocument(file);
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale, rotation: rotate });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new PdfRenderError("Your browser can't render canvas content.");
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      if (options.enhance) enhanceCanvasForOcr(canvas);

      activeProgressHandler = options.onProgress ?? null;
      options.onProgress?.(0);

      let result;
      try {
        result = await worker.recognize(canvas, {}, { text: true, blocks: true });
      } catch {
        throw new OcrError(`Recognition failed on page ${pageNumber}.`);
      } finally {
        activeProgressHandler = null;
        options.onProgress?.(1);
      }

      const rawWords: { text: string; confidence: number; bbox: Bbox }[] = [];
      const rawLines: { text: string; bbox: Bbox }[] = [];
      for (const block of result.data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            rawLines.push({ text: line.text, bbox: line.bbox });
            for (const word of line.words) {
              rawWords.push({ text: word.text, confidence: word.confidence, bbox: word.bbox });
            }
          }
        }
      }

      const words = mapWordsToPdfSpace(rawWords, viewport);
      const lines = mapLinesToPdfSpace(rawLines, viewport);
      const meanConfidence =
        words.length > 0 ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0;
      const lowConfidenceWordCount = words.filter((w) => confidenceTier(w.confidence) === "low").length;

      return {
        pageIndex: pageNumber - 1,
        text: result.data.text.trim(),
        words,
        lines,
        meanConfidence,
        lowConfidenceWordCount,
      };
    },

    async terminate() {
      if (terminated) return;
      terminated = true;
      await worker.terminate();
    },
  };
}

// ---------------------------------------------------------------------------
// Searchable PDF export
// ---------------------------------------------------------------------------

/** Adds an invisible, positioned text layer over OCR'd pages so the exported PDF becomes
 * searchable/selectable while looking pixel-identical to the original scan. */
export async function buildSearchablePdf(file: File, results: OcrPageResult[]): Promise<Blob> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const bytes = await file.arrayBuffer();

  let doc;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new OcrError("We couldn't read this PDF to add the searchable text layer.");
  }

  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const result of results) {
    if (result.pageIndex >= doc.getPageCount()) continue;
    const page = doc.getPage(result.pageIndex);
    for (const line of result.lines) {
      if (line.pdfBox.height <= 0 || line.pdfBox.width <= 0) continue;

      // Size primarily so the invisible run's width matches the real line's width (helps
      // drag-to-select hit-testing in PDF readers), clamped against a height-based estimate
      // so a single short/wide character can't blow up to an absurd size.
      const heightEstimate = line.pdfBox.height * 0.85;
      let fontSize = heightEstimate;
      try {
        const naturalWidthAtSize1 = font.widthOfTextAtSize(line.text, 1);
        if (naturalWidthAtSize1 > 0) {
          const widthEstimate = line.pdfBox.width / naturalWidthAtSize1;
          fontSize = Math.min(Math.max(widthEstimate, heightEstimate * 0.5), heightEstimate * 2);
        }
        page.drawText(line.text, {
          x: line.pdfBox.x,
          y: line.pdfBox.y,
          size: Math.max(1, fontSize),
          font,
          opacity: 0,
        });
      } catch {
        // A character outside this font's supported encoding (stray OCR noise, an
        // unsupported language's glyphs) shouldn't take down the whole export — that one
        // line just doesn't get a searchable layer.
      }
    }
  }

  const outBytes = await doc.save();
  return new Blob([outBytes as BlobPart], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// Plain-text extraction
// ---------------------------------------------------------------------------

export function formatExtractedText(results: OcrPageResult[]): string {
  return results
    .slice()
    .sort((a, b) => a.pageIndex - b.pageIndex)
    .map((r) => `Page ${r.pageIndex + 1}\n${r.text}`)
    .join("\n\n");
}
