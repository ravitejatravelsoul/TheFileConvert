import { luminance, backgroundLevel, type PxBox, type Raster, type ScanAnalysis } from "./scan";

/**
 * What kind of page is this, and so what does "convert to Word" mean for it?
 *
 * Conversion is not OCR. A native page (real text) becomes editable Word content. A page that is a picture of
 * a document — a scanned form, an ID, a certificate, a signed contract, an invoice, a photo — keeps its
 * appearance: the page itself goes into the Word file. Only a clean, plain scan of running text, read with
 * very high confidence, may be rebuilt as editable paragraphs (the hybrid strategy). OCR is only ever used to
 * *judge* such a page; it never replaces what the user sees unless that judgement is extremely confident.
 */

export type PageClass =
  | "NATIVE_TEXT" //       real text layer: editable Word content
  | "MIXED" //             real text plus large pictures: editable, pictures kept
  | "SCANNED_TEXT" //      a picture of plain running text: hybrid only when the read is extremely confident
  | "FORM" //              fields, boxes, check boxes, bands: visual
  | "SCANNED_TABLE" //     a picture of a ruled table / statement: visual
  | "OFFICIAL_DOCUMENT" // photo, frame, seal: ID, passport, certificate: visual
  | "IMAGE_PAGE" //        a photograph or artwork: visual
  | "BLANK";

/** How the page is written to Word. */
export type PageStrategy = "editable" | "hybrid" | "visual";

export const DEFAULT_STRATEGY: Record<PageClass, PageStrategy> = {
  NATIVE_TEXT: "editable",
  MIXED: "editable",
  SCANNED_TEXT: "visual", // upgraded to "hybrid" only by `hybridDecision`
  FORM: "visual",
  SCANNED_TABLE: "visual",
  OFFICIAL_DOCUMENT: "visual",
  IMAGE_PAGE: "visual",
  BLANK: "editable",
};

// ---------------------------------------------------------------------------------------------------
// Native signals (from the PDF's own content): is there real, visible text?
// ---------------------------------------------------------------------------------------------------

export interface PageSignals {
  /** Characters of text that are drawn (not invisible OCR text). */
  visibleChars: number;
  /** Characters drawn invisibly (text render mode 3: the searchable layer of a scanner or OCR tool). */
  invisibleChars: number;
  /** Share of the page the pictures cover (overlaps counted once, approximately), 0–1. */
  imageCoverage: number;
  /** Share of the page the single largest picture covers, 0–1. */
  largestImageCoverage: number;
  /** Pixel density of the largest picture (pixels per inch of page), 0 when there is none. */
  imageDpi: number;
}

/** Fewer visible characters than this, with a picture over much of the page, means the page is a picture. */
export const MIN_VISIBLE_CHARS = 20;

export type NativeKind = "native" | "mixed" | "scanned" | "blank";

/**
 * Text you can see, or only a picture? A searchable scan has text — but invisible; what the reader sees is the
 * picture, and that is what must survive.
 */
export function nativeKind(s: PageSignals): NativeKind {
  if (s.visibleChars >= MIN_VISIBLE_CHARS) return s.imageCoverage >= 0.35 ? "mixed" : "native";
  if (s.largestImageCoverage >= 0.3 || s.imageCoverage >= 0.5) return "scanned";
  return s.visibleChars > 0 ? "native" : "blank";
}

// ---------------------------------------------------------------------------------------------------
// Pixel signals (from the rendered page): what is it a picture *of*?
// ---------------------------------------------------------------------------------------------------

export interface PixelSignals {
  /** Horizontal and vertical rules found. */
  hRules: number;
  vRules: number;
  checkboxes: number;
  /** Solid bands (headings bars, table headers) and tinted cells. */
  bars: number;
  fills: number;
  /** Lines framing the whole page (a certificate's border). */
  frame: boolean;
  /** Pictures such as a portrait: regions of continuous tone, not text. */
  photoRegions: number;
  /** Share of the page they cover, 0–1. */
  photoCoverage: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Regions of continuous tone — photographs, portraits, artwork. Text, rules and flat tints are two-tone (paper
 * and ink, or a tint and ink); a photograph's cells are almost all mid-tone with no paper in them. Measured on
 * cells of ~6 pt: a cell is photographic when it holds (almost) no paper and a real share of mid-tones;
 * cells inside a detected band or tinted cell are excluded (a flat colour is not a picture). Connected cells
 * form a region; a region must be at least 24 pt across and fairly solid (not a line, not a ring).
 */
export function photoRegions(r: Raster, pxPerPt: number, exclude: Rect[], lum?: Uint8Array, background?: number): { regions: Rect[]; coverage: number } {
  const l = lum ?? luminance(r);
  const bg = background ?? backgroundLevel(l);
  const C = Math.max(4, Math.round(6 * pxPerPt));
  const cw = Math.floor(r.width / C);
  const ch = Math.floor(r.height / C);
  const photo = new Uint8Array(cw * ch);
  const paperAbove = bg - 25;
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      let paper = 0;
      let mid = 0;
      let n = 0;
      // Every other pixel: enough for a share, a quarter of the work.
      for (let y = cy * C; y < cy * C + C; y += 2)
        for (let x = cx * C; x < cx * C + C; x += 2) {
          const v = l[y * r.width + x];
          n++;
          if (v >= paperAbove) paper++;
          else if (v >= 90) mid++;
        }
      if (paper / n <= 0.15 && mid / n >= 0.2) photo[cy * cw + cx] = 1;
    }
  for (const e of exclude) {
    for (let cy = Math.max(0, Math.floor((e.y - C) / C)); cy <= Math.min(ch - 1, (e.y + e.h + C) / C); cy++)
      for (let cx = Math.max(0, Math.floor((e.x - C) / C)); cx <= Math.min(cw - 1, (e.x + e.w + C) / C); cx++) photo[cy * cw + cx] = 0;
  }
  // Close one-cell holes (dark hair inside a portrait), then group.
  const closed = photo.slice();
  for (let cy = 1; cy < ch - 1; cy++)
    for (let cx = 1; cx < cw - 1; cx++) {
      const i = cy * cw + cx;
      if (!photo[i] && photo[i - 1] + photo[i + 1] + photo[i - cw] + photo[i + cw] >= 3) closed[i] = 1;
    }
  const seen = new Uint8Array(cw * ch);
  const regions: Rect[] = [];
  let cells = 0;
  const minCells = (24 * pxPerPt) / C;
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let x0 = cw;
    let y0 = ch;
    let x1 = 0;
    let y1 = 0;
    let n = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % cw;
      const y = (k - x) / cw;
      n++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const m of [k - 1, k + 1, k - cw, k + cw]) {
        if (m < 0 || m >= closed.length || !closed[m] || seen[m]) continue;
        if ((m === k - 1 && x === 0) || (m === k + 1 && x === cw - 1)) continue;
        seen[m] = 1;
        stack.push(m);
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (bw < minCells || bh < minCells || n / (bw * bh) < 0.4) continue;
    regions.push({ x: x0 * C, y: y0 * C, w: bw * C, h: bh * C });
    cells += n;
  }
  return { regions, coverage: (cells * C * C) / (r.width * r.height) };
}

/** Pixel signals of a rendered page (`pxPerPt` pixels per point). */
export function pixelSignals(analysis: ScanAnalysis, raster: Raster, pxPerPt: number): PixelSignals {
  const rules = analysis.rules;
  const H = rules.filter((q) => q.y0 === q.y1);
  const V = rules.filter((q) => q.x0 === q.x1);
  const W = raster.width;
  const Hh = raster.height;
  // Frame: lines along all four edges (a page border). A skewed scan breaks a long line into staircase pieces,
  // so each edge band is judged by how much of its length the pieces cover together.
  const span = (lines: [number, number][], total: number) => {
    const sorted = [...lines].sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = -Infinity;
    for (const [a, b] of sorted) {
      if (b <= end) continue;
      covered += b - Math.max(a, end);
      end = b;
    }
    return covered / total;
  };
  const band = (rs: typeof rules, horizontal: boolean, lo: boolean) =>
    span(
      rs
        .filter((q) => {
          const across = horizontal ? q.y0 : q.x0;
          const size = horizontal ? Hh : W;
          return lo ? across < size * 0.15 : across > size * 0.85;
        })
        .map((q) => (horizontal ? [q.x0, q.x1] : [q.y0, q.y1]) as [number, number]),
      horizontal ? W : Hh,
    );
  const need = 0.6; // of each edge: scans lose stretches of a thin or skewed line
  const frame = band(H, true, true) >= need && band(H, true, false) >= need && band(V, false, true) >= need && band(V, false, false) >= need;
  const exclude: Rect[] = [...analysis.bars, ...analysis.fills, ...analysis.checkboxes.map((c) => c.ink)];
  const photo = photoRegions(raster, pxPerPt, exclude);
  return { hRules: H.length, vRules: V.length, checkboxes: analysis.checkboxes.length, bars: analysis.bars.length, fills: analysis.fills.length, frame, photoRegions: photo.regions.length, photoCoverage: photo.coverage };
}

export interface ClassResult {
  cls: PageClass;
  /** Why, in a few words (shown in the audit, never to the user as a claim about their document). */
  reason: string;
}

/**
 * Class of a page that is a picture. Order matters: a page that is mostly photograph is an image; a page with
 * a portrait or a border/seal is an official document; check boxes make a form; a ruled grid or many rules is a
 * table; fields or bands make a form; otherwise it is plain scanned text.
 */
export function classifyScanned(s: PixelSignals): ClassResult {
  if (s.photoCoverage >= 0.4) return { cls: "IMAGE_PAGE", reason: `photograph covers ${Math.round(s.photoCoverage * 100)}% of the page` };
  if (s.photoRegions >= 1 && s.photoCoverage >= 0.01) return { cls: "OFFICIAL_DOCUMENT", reason: `portrait/photo region (${Math.round(s.photoCoverage * 100)}% of page)` };
  if (s.frame) return { cls: "OFFICIAL_DOCUMENT", reason: "page border" };
  if (s.checkboxes >= 1) return { cls: "FORM", reason: `${s.checkboxes} check box${s.checkboxes === 1 ? "" : "es"}` };
  if (s.hRules >= 4 || (s.hRules >= 3 && s.vRules >= 2)) return { cls: "SCANNED_TABLE", reason: `ruled grid (${s.hRules} horizontal, ${s.vRules} vertical lines)` };
  if (s.hRules + s.vRules >= 3 || s.bars >= 1 || s.fills >= 2) return { cls: "FORM", reason: `${s.hRules + s.vRules} rules, ${s.bars} bands, ${s.fills} tinted cells` };
  return { cls: "SCANNED_TEXT", reason: "no fields, boxes, photos or borders" };
}

// ---------------------------------------------------------------------------------------------------
// Hybrid: editable text from a scan, only when the read is extremely confident
// ---------------------------------------------------------------------------------------------------

export const HYBRID_THRESHOLDS = {
  /** Mean word confidence of the words kept, 0–100. */
  textConfidence: 92,
  /** Share of the page's ink that recognised words explain (the rest is a signature, a stamp, a drawing). */
  inkExplained: 0.97,
  /** Enough text to judge. */
  minWords: 40,
  /** Words dropped as noise, at most this share of the words kept. */
  maxNoiseShare: 0.05,
  /** Words in lines of at least 6 words, at least this share: running text, not labels and values. */
  runningTextShare: 0.7,
  /** Rules the page may carry (a letterhead line). */
  maxRules: 2,
};

export interface HybridEvidence {
  words: number;
  textConfidence: number;
  inkExplained: number;
  droppedNoise: number;
  pictures: number;
  rules: number;
  fills: number;
  /** Words that sit in a line of 6+ words, as a share of all words. */
  runningTextShare: number;
}

/** Is a plain scan of text safe to rebuild as editable paragraphs? Everything must clear its bar. */
export function hybridDecision(e: HybridEvidence): { ok: boolean; reason: string } {
  const T = HYBRID_THRESHOLDS;
  const fails: string[] = [];
  if (e.words < T.minWords) fails.push(`only ${e.words} words`);
  if (e.textConfidence < T.textConfidence) fails.push(`read confidence ${Math.round(e.textConfidence)} < ${T.textConfidence}`);
  if (e.inkExplained < T.inkExplained) fails.push(`${Math.round((1 - e.inkExplained) * 100)}% of the ink isn't text`);
  if (e.droppedNoise > Math.max(2, e.words * T.maxNoiseShare)) fails.push(`${e.droppedNoise} noise fragments`);
  if (e.pictures > 0) fails.push("pictures on the page (stamp, signature, logo)");
  if (e.rules > T.maxRules || e.fills > 0) fails.push("rules or shading");
  if (e.runningTextShare < T.runningTextShare) fails.push("not running text");
  return fails.length ? { ok: false, reason: fails.join("; ") } : { ok: true, reason: `read confidence ${Math.round(e.textConfidence)}, all ink explained` };
}

export type { PxBox };
