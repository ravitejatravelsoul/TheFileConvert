import { loadPdfJsDocument, getPageTextContent, PdfRenderError } from "./pdfjs-utils";
import type { PageViewport } from "pdfjs-dist";

export class OcrError extends Error {}

// Self-hosted so the document, the rendered page images, and the recognized text never
// touch a third party — only these static runtime/model files are fetched, and only when
// OCR is actually requested. See docs/OCR.md for the full asset/license inventory.
const TESSERACT_WORKER_PATH = "/tesseract/worker.min.js";
const TESSERACT_CORE_PATH = "/tesseract/tesseract-core-lstm.wasm.js";
const TESSERACT_LANG_PATH = "/tesseract/lang-data";

export { SUPPORTED_OCR_LANGUAGES, type OcrLanguageOption } from "./ocr-languages";

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
  /** Per-character boxes within this word (Tesseract's own symbol segmentation), same PDF
   * point space as pdfBox — lets the editor patch only the characters that actually changed
   * in a correction instead of the whole word. Concatenating `chars.map(c => c.text)` should
   * reconstruct `text`, but isn't guaranteed to (OCR symbol merges/splits happen); callers
   * that need geometry should verify that before trusting it. */
  chars: { text: string; pdfBox: { x: number; y: number; width: number; height: number } }[];
  /** Index into the page's `lines` of the line Tesseract read this word in. */
  line?: number;
}

export interface OcrLine {
  text: string;
  pdfBox: { x: number; y: number; width: number; height: number };
  /** The line's baseline, from one end to the other, in PDF point space (when the recogniser gives one). */
  baseline?: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrPageResult {
  pageIndex: number; // 0-based
  text: string;
  words: OcrWord[];
  /** Line-level text runs (proper single-space-separated text), used to build the
   * searchable-PDF text layer — drawing whole lines instead of individual words keeps
   * multi-word phrase search working in the exported PDF. */
  lines: OcrLine[];
  /** The rotation (degrees) the page was read at — its display rotation then. Text runs that way in the
   * page's unrotated space, so the hidden text layer is turned the same way (see searchLayer.ts). */
  rotation?: number;
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
      /**
       * Layout analysis on the rendered page before recognition: gets the pixels (RGBA, may be changed —
       * e.g. lines erased so OCR reads the text between them) and pixel ↔ PDF mappers; its return value comes
       * back as `prepared`. Used by PDF → Word; the editor doesn't pass it.
       */
      prepare?: (image: { data: Uint8ClampedArray; width: number; height: number }, map: { toPdf: (x: number, y: number) => [number, number]; toPx: (x: number, y: number) => [number, number] }) => unknown | Promise<unknown>;
    }
  ): Promise<OcrPageResult & { prepared?: unknown }>;
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
  words: { text: string; confidence: number; bbox: Bbox; symbols: { text: string; bbox: Bbox }[]; line?: number }[],
  viewport: PageViewport
): OcrWord[] {
  return words
    .filter((w) => w.text.trim().length > 0)
    .map((w) => ({
      text: w.text,
      confidence: w.confidence,
      pdfBox: mapBboxToPdf(w.bbox, viewport),
      chars: w.symbols.map((s) => ({ text: s.text, pdfBox: mapBboxToPdf(s.bbox, viewport) })),
      line: w.line,
    }));
}

function mapLinesToPdfSpace(
  lines: { text: string; bbox: Bbox; baseline?: Bbox & { has_baseline?: boolean } }[],
  viewport: PageViewport
): OcrLine[] {
  return lines
    .filter((l) => l.text.trim().length > 0)
    .map((l) => {
      const out: OcrLine = { text: l.text.trimEnd(), pdfBox: mapBboxToPdf(l.bbox, viewport) };
      const b = l.baseline;
      if (b && b.has_baseline !== false && b.x1 > b.x0) {
        const [x0, y0] = viewport.convertToPdfPoint(b.x0, b.y0);
        const [x1, y1] = viewport.convertToPdfPoint(b.x1, b.y1);
        out.baseline = { x0, y0, x1, y1 };
      }
      return out;
    });
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
      // Don't copy the language model into IndexedDB: the site keeps nothing in browser storage.
      // The browser's ordinary HTTP cache still avoids re-downloading it on every visit.
      cacheMethod: "none",
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

      let prepared: unknown;
      if (options.prepare) {
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        prepared = await options.prepare(image, {
          toPdf: (x, y) => viewport.convertToPdfPoint(x, y) as [number, number],
          toPx: (x, y) => viewport.convertToViewportPoint(x, y) as [number, number],
        });
        ctx.putImageData(image, 0, 0);
      }

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

      const rawWords: { text: string; confidence: number; bbox: Bbox; symbols: { text: string; bbox: Bbox }[]; line?: number }[] = [];
      const rawLines: { text: string; bbox: Bbox; baseline?: Bbox & { has_baseline?: boolean } }[] = [];
      for (const block of result.data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            // Index among the non-empty lines (the ones returned), so words can name theirs.
            const lineIndex = line.text.trim().length > 0 ? rawLines.filter((l) => l.text.trim().length > 0).length : undefined;
            rawLines.push({ text: line.text, bbox: line.bbox, baseline: line.baseline });
            for (const word of line.words) {
              rawWords.push({
                text: word.text,
                confidence: word.confidence,
                bbox: word.bbox,
                symbols: (word.symbols ?? []).map((s) => ({ text: s.text, bbox: s.bbox })),
                line: lineIndex,
              });
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
        rotation: rotate,
        prepared,
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
// Plain-text extraction
// ---------------------------------------------------------------------------

