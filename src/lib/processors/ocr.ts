import { loadPdfJsDocument, getPageTextContent, renderPageOffscreen, PdfRenderError } from "./pdfjs-utils";
import { encodeCanvas } from "./canvas-blob";
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
       * Second look at words read with little confidence: each is cropped and read again on its own, as a
       * single word. A page read as a whole gets a word wrong when its neighbours' layout confuses the line
       * model ("Issue" read as "Tact"); alone, the same pixels read right. A better reading (clearly higher
       * confidence) replaces the first. Used by PDF → Word.
       */
      refine?: boolean;
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

/** Rows or words below this confidence get a second look (see `refine`); at most REFINE_MAX reads a page. */
const REFINE_BELOW = 60;
const REFINE_ROW_BELOW = 70;
const REFINE_MAX = 60;

type RawWord = { text: string; confidence: number; bbox: Bbox; symbols: { text: string; bbox: Bbox }[]; line?: number };
type RefineWorker = {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(image: Blob, options: object, output: object): Promise<{ data: { text: string; confidence: number; blocks?: { paragraphs: { lines: { words: { text: string; confidence: number; bbox: Bbox }[] }[] }[] }[] | null } }>;
};

/**
 * Second look, in place, never throwing (a failed second look keeps the first):
 * 1. rows — words of one line set close together (a line as read can hold a left and a right block) — whose
 *    words average under REFINE_ROW_BELOW are read again as one line; the new reading replaces the row when
 *    clearly more confident and not fewer words (an italic caption: "figure. siuyey counts by aie" →
 *    "Figure 1. Survey counts by site.");
 * 2. ink no word covers but shaped like a line of text (a display heading the page segmentation took for a
 *    picture) is read as one line, and kept when read with clear confidence;
 * 3. words still under REFINE_BELOW are read again alone ("Tact" → "Issue").
 */
async function refineLowConfidence(worker: RefineWorker, canvas: HTMLCanvasElement, image: Blob, words: RawWord[], lines: { text: string; bbox: Bbox; baseline?: Bbox & { has_baseline?: boolean } }[]): Promise<void> {
  let reads = 0;
  const crop = (b: Bbox) => {
    const pad = 6;
    const left = Math.max(0, b.x0 - pad);
    const top = Math.max(0, b.y0 - pad);
    return { left, top, width: Math.min(canvas.width - left, b.x1 - b.x0 + 2 * pad), height: Math.min(canvas.height - top, b.y1 - b.y0 + 2 * pad) };
  };
  try {
    // 1. rows
    await worker.setParameters({ tessedit_pageseg_mode: "7" }); // PSM.SINGLE_LINE
    const byLine = new Map<number, RawWord[]>();
    for (const w of words) {
      if (w.line === undefined) continue;
      if (!byLine.has(w.line)) byLine.set(w.line, []);
      byLine.get(w.line)!.push(w);
    }
    for (const [line, ws] of byLine) {
      ws.sort((p, q) => p.bbox.x0 - q.bbox.x0);
      const rows: RawWord[][] = [];
      for (const w of ws) {
        const row = rows[rows.length - 1];
        const prev = row?.[row.length - 1];
        if (prev && w.bbox.x0 - prev.bbox.x1 < 3 * (prev.bbox.y1 - prev.bbox.y0)) row.push(w);
        else rows.push([w]);
      }
      for (const row of rows) {
        const mean = row.reduce((n, w) => n + w.confidence, 0) / row.length;
        if (row.length < 2 || mean >= REFINE_ROW_BELOW || reads >= REFINE_MAX) continue;
        const box = { x0: Math.min(...row.map((w) => w.bbox.x0)), y0: Math.min(...row.map((w) => w.bbox.y0)), x1: Math.max(...row.map((w) => w.bbox.x1)), y1: Math.max(...row.map((w) => w.bbox.y1)) };
        const r = await worker.recognize(image, { rectangle: crop(box) }, { text: true, blocks: true });
        reads++;
        const fresh: RawWord[] = [];
        for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) if (w.text.trim()) fresh.push({ text: w.text, confidence: w.confidence, bbox: w.bbox, symbols: [], line });
        const freshMean = fresh.length ? fresh.reduce((n, w) => n + w.confidence, 0) / fresh.length : 0;
        if (fresh.length >= row.length && freshMean >= mean + 15 && freshMean >= REFINE_ROW_BELOW) {
          const at = words.indexOf(row[0]);
          for (const w of row) words.splice(words.indexOf(w), 1);
          words.splice(at, 0, ...fresh);
        }
      }
    }
    // 2. ink no word covers but shaped like a line of text — a large display
    // heading the page segmentation took for a picture ("INVOICE"): read as one line, kept only when read
    // with clear confidence (a chart, a stamp or a signature reads badly and stays a picture).
    for (const box of unreadText(canvas, words)) {
      if (reads >= REFINE_MAX) break;
      const r = await worker.recognize(image, { rectangle: crop(box) }, { text: true, blocks: true });
      reads++;
      const fresh: RawWord[] = [];
      const index = lines.filter((l) => l.text.trim()).length;
      for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) if (w.text.trim()) fresh.push({ text: w.text, confidence: w.confidence, bbox: w.bbox, symbols: [], line: index });
      const mean = fresh.length ? fresh.reduce((n, w) => n + w.confidence, 0) / fresh.length : 0;
      const letters = fresh.map((w) => w.text).join("").match(/\p{L}/gu)?.length ?? 0;
      if (fresh.length && mean >= 80 && letters >= 2) {
        words.push(...fresh);
        const text = fresh.map((w) => w.text).join(" ");
        const bbox = { x0: Math.min(...fresh.map((w) => w.bbox.x0)), y0: Math.min(...fresh.map((w) => w.bbox.y0)), x1: Math.max(...fresh.map((w) => w.bbox.x1)), y1: Math.max(...fresh.map((w) => w.bbox.y1)) };
        lines.push({ text, bbox });
      }
    }
    // 3. words
    await worker.setParameters({ tessedit_pageseg_mode: "8" }); // PSM.SINGLE_WORD
    for (const w of words) {
      if (w.confidence >= REFINE_BELOW || !/[\p{L}\p{N}]/u.test(w.text) || reads >= REFINE_MAX) continue;
      const c = crop(w.bbox);
      if (c.width < 8 || c.height < 8) continue;
      const r = await worker.recognize(image, { rectangle: c }, { text: true });
      reads++;
      const text = r.data.text.trim();
      // (Same length, about: a crop reaching into a neighbouring word mustn't turn "6" into "695.00".)
      const similar = Math.abs(text.length - w.text.length) <= Math.max(1, w.text.length / 2);
      if (text && !/\s/.test(text) && similar && r.data.confidence >= w.confidence + 15 && r.data.confidence >= 60) {
        w.text = text;
        w.confidence = r.data.confidence;
        w.symbols = [];
      }
    }
  } catch {
    // keep the first reading
  } finally {
    try {
      await worker.setParameters({ tessedit_pageseg_mode: "3" }); // PSM.AUTO
    } catch {
      /* the worker is gone */
    }
  }
}

/**
 * Pieces of ink no recognised word covers that are shaped like a line of text: on a 4 px grid, dark cells
 * outside the words (grown by a few pixels), joined across letter and word gaps; a piece 20–150 px tall
 * (≈ 7–50 pt at the scale PDF → Word reads), at least twice as wide, and not solid (a bar or a photo is).
 */
function unreadText(canvas: HTMLCanvasElement, words: RawWord[]): Bbox[] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const { width: W, height: H } = canvas;
  const data = ctx.getImageData(0, 0, W, H).data;
  const C = 4;
  const cw = Math.floor(W / C);
  const ch = Math.floor(H / C);
  const lum = (x: number, y: number) => {
    const p = (y * W + x) * 4;
    return (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  };
  // Paper level: the most common bright value, sampled.
  const hist = new Uint32Array(256);
  for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 7) hist[Math.round(lum(x, y))]++;
  let paper = 255;
  for (let v = 96, best = -1; v < 256; v++) if (hist[v] > best) [paper, best] = [v, hist[v]];
  const dark = paper - 70;
  const covered = new Uint8Array(cw * ch);
  for (const w of words) {
    const pad = 4;
    for (let y = Math.max(0, Math.floor((w.bbox.y0 - pad) / C)); y <= Math.min(ch - 1, (w.bbox.y1 + pad) / C); y++)
      for (let x = Math.max(0, Math.floor((w.bbox.x0 - pad) / C)); x <= Math.min(cw - 1, (w.bbox.x1 + pad) / C); x++) covered[y * cw + x] = 1;
  }
  const cell = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      if (covered[cy * cw + cx]) continue;
      let n = 0;
      for (let y = cy * C; y < cy * C + C; y++) for (let x = cx * C; x < cx * C + C; x++) if (lum(x, y) < dark) n++;
      if (n >= 2) cell[cy * cw + cx] = 1;
    }
  const seen = new Uint8Array(cw * ch);
  const out: Bbox[] = [];
  for (let i = 0; i < cell.length; i++) {
    if (!cell[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0, n = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % cw;
      const y = (k - x) / cw;
      n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      // Letters and words join across up to 3 cells sideways, 1 up or down.
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const m = ny * cw + nx;
          if (cell[m] && !seen[m]) {
            seen[m] = 1;
            stack.push(m);
          }
        }
    }
    const h = (y1 - y0 + 1) * C;
    const w = (x1 - x0 + 1) * C;
    const fill = n / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (h >= 20 && h <= 150 && w >= 2 * h && fill < 0.75) out.push({ x0: x0 * C, y0: y0 * C, x1: (x1 + 1) * C, y1: (y1 + 1) * C });
  }
  return out.slice(0, 12);
}

/** No awaited OCR step may wait forever: it settles with `work` or, after `ms`, rejects with `message`. */
function within<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OcrError(message)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Loading the engine and its model (same origin, a few MB). */
const WORKER_LOAD_MS = 90_000;
/** One page of recognition, including the second look at doubtful words. */
const RECOGNIZE_PAGE_MS = 300_000;

export async function createOcrSession(langCode: string): Promise<OcrSession> {
  const { createWorker, OEM } = await import("tesseract.js");

  // Tesseract.js reports progress through a single worker-level logger set at creation
  // time (not per recognize() call), so we route it to whichever page is currently being
  // recognized via this mutable handle. This is what gives the UI real, non-fake progress.
  let activeProgressHandler: ((fraction: number) => void) | null = null;

  let worker;
  try {
    worker = await within(createWorker(langCode, OEM.LSTM_ONLY, {
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
    }), WORKER_LOAD_MS, "The OCR engine took too long to load. Check your connection and try again.");
  } catch (e) {
    if (e instanceof OcrError) throw e;
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
      await renderPageOffscreen(page, { canvasContext: ctx, viewport, canvas });

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
      let image: Blob | null = null;
      try {
        // The canvas carries no resolution; say what it is rather than letting Tesseract guess (and print its guess).
        await worker.setParameters({ user_defined_dpi: String(Math.round(scale * 72)) });
        // Encoded here, once, so Tesseract isn't handed a canvas: it would call canvas.toBlob itself for every read, which
        // in a background tab takes seconds each (see canvas-blob.ts).
        image = await encodeCanvas(canvas, "image/png");
        if (!image) throw new OcrError(`Recognition failed on page ${pageNumber}.`);
        result = await within(worker.recognize(image, {}, { text: true, blocks: true }), RECOGNIZE_PAGE_MS, `Recognition took too long on page ${pageNumber}. Try again, or cancel.`);
      } catch (e) {
        if (e instanceof OcrError) throw e;
        throw new OcrError(`Recognition failed on page ${pageNumber}.`);
      } finally {
        activeProgressHandler = null;
        options.onProgress?.(1);
      }

      const rawWords: RawWord[] = [];
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

      if (options.refine && image) await refineLowConfidence(worker, canvas, image, rawWords, rawLines);

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

