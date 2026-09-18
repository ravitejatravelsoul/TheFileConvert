/**
 * Local, deterministic font matching for scanned-text replacement (no AI, no remote fonts).
 *
 * The idea: render the *original* OCR word in each of a small, curated set of locally
 * available font styles, binarize each rendering into an ink/background bitmap the same way
 * the real scanned glyph was binarized (see regionColor.ts's computeInkMask), and pick
 * whichever candidate's bitmap shape most closely resembles the actual scanned glyph's
 * shape. This is a direct implementation of "render representative text at candidate sizes,
 * compare the rendered glyph bitmap against the original scanned glyph bitmap" — no manual
 * serif/stroke heuristics to get subtly wrong, just a real bitmap comparison.
 *
 * Rendering a candidate onto a canvas is a browser-only operation (see scanPatch.ts), so
 * this module only owns the *candidate list* and the *pure scoring math*, both of which are
 * fully unit-testable without a real canvas.
 */

export interface FontCandidate {
  id: string;
  /** CSS font-family stack. Only generic families / near-universal names — nothing bundled,
   * nothing fetched, so this never depends on what's installed beyond what every browser
   * already ships (the trailing generic keyword is always resolvable). */
  family: string;
  bold: boolean;
  italic: boolean;
}

/** A small curated set covering the common document-text styles: serif, sans-serif, and
 * monospace, each with a bold and an italic variant. Kept intentionally short (10
 * candidates) — this runs synchronously on every keystroke of a live preview, so it must
 * stay cheap (see scanPatch.ts's perf note). */
export const FONT_CANDIDATES: FontCandidate[] = [
  { id: "serif-regular", family: "Georgia, 'Times New Roman', Times, serif", bold: false, italic: false },
  { id: "serif-bold", family: "Georgia, 'Times New Roman', Times, serif", bold: true, italic: false },
  { id: "serif-italic", family: "Georgia, 'Times New Roman', Times, serif", bold: false, italic: true },
  { id: "serif-bold-italic", family: "Georgia, 'Times New Roman', Times, serif", bold: true, italic: true },
  { id: "sans-regular", family: "Arial, Helvetica, 'Segoe UI', sans-serif", bold: false, italic: false },
  { id: "sans-bold", family: "Arial, Helvetica, 'Segoe UI', sans-serif", bold: true, italic: false },
  { id: "sans-italic", family: "Arial, Helvetica, 'Segoe UI', sans-serif", bold: false, italic: true },
  { id: "sans-bold-italic", family: "Arial, Helvetica, 'Segoe UI', sans-serif", bold: true, italic: true },
  { id: "mono-regular", family: "'Courier New', Courier, monospace", bold: false, italic: false },
  { id: "mono-bold", family: "'Courier New', Courier, monospace", bold: true, italic: false },
];

export const DEFAULT_FONT_CANDIDATE = FONT_CANDIDATES[4]; // sans-regular — safest generic fallback

export interface Bitmap {
  width: number;
  height: number;
  /** Row-major, 1 = ink, 0 = background. */
  ink: Uint8Array;
}

function boundingBoxOfInk(bmp: Bitmap): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = bmp.width;
  let y0 = bmp.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (bmp.ink[y * bmp.width + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, x1, y1 };
}

const GRID_W = 32;
const GRID_H = 40;

/** Crops a bitmap to its own ink bounding box, then nearest-neighbor-resamples it onto a
 * fixed-size boolean grid — this normalizes away absolute position/size so two glyphs of
 * different pixel dimensions can be compared purely on *shape*. */
export function normalizeToGrid(bmp: Bitmap, gridW = GRID_W, gridH = GRID_H): Uint8Array {
  const grid = new Uint8Array(gridW * gridH);
  const box = boundingBoxOfInk(bmp);
  if (!box) return grid; // an all-background bitmap normalizes to an empty grid
  const boxW = Math.max(1, box.x1 - box.x0 + 1);
  const boxH = Math.max(1, box.y1 - box.y0 + 1);
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const srcX = box.x0 + Math.floor(((gx + 0.5) / gridW) * boxW);
      const srcY = box.y0 + Math.floor(((gy + 0.5) / gridH) * boxH);
      const cx = Math.max(0, Math.min(bmp.width - 1, srcX));
      const cy = Math.max(0, Math.min(bmp.height - 1, srcY));
      grid[gy * gridW + gx] = bmp.ink[cy * bmp.width + cx];
    }
  }
  return grid;
}

/** Intersection-over-union of two same-sized boolean ink grids — 1 for an identical shape,
 * 0 for no overlap at all. Two empty (all-background) grids score 0 (treated as "no match"
 * rather than a false "perfect match") so a blank/undetectable original never wins by default. */
export function compareGrids(a: Uint8Array, b: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] !== 0;
    const bi = b[i] !== 0;
    if (ai || bi) union++;
    if (ai && bi) intersection++;
  }
  if (union === 0) return 0;
  return intersection / union;
}

/** Fraction of a normalized grid's cells that are ink — a simple, cheap proxy for stroke
 * weight/"boldness" once position and overall size are already normalized away by
 * normalizeToGrid. A bold face fills noticeably more of the same-shaped grid than a regular
 * one does. */
export function inkDensity(grid: Uint8Array): number {
  if (grid.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) count++;
  return count / grid.length;
}

/** A binarized ink mask of an anti-aliased scanned glyph tends to read slightly "fatter"
 * than the same glyph's own true stroke weight (soft edge pixels get counted as ink), which
 * biases raw shape-overlap scoring toward bold candidates even for regular-weight source
 * text — pure shape (IoU) alone isn't a reliable enough signal to pick weight correctly.
 * Ink-density similarity is weighted in directly (not just as a tie-break) so a candidate
 * that matches the reference's actual stroke weight is preferred even when a heavier one's
 * silhouette happens to overlap slightly more. */
const DENSITY_PENALTY_WEIGHT = 1.6;

/** Picks the font candidate whose rendering of the *original* OCR text most closely
 * resembles the actual scanned glyph bitmap, combining shape overlap (IoU) with how closely
 * its stroke weight (ink density) matches the reference — see DENSITY_PENALTY_WEIGHT.
 * `renderCandidate` is supplied by the caller (browser-only canvas rendering lives in
 * scanPatch.ts) so this function itself stays pure and unit-testable with synthetic bitmaps. */
export function pickBestFontCandidate(
  originalBitmap: Bitmap,
  renderCandidate: (candidate: FontCandidate) => Bitmap | null,
  candidates: FontCandidate[] = FONT_CANDIDATES
): { candidate: FontCandidate; score: number } {
  const originalGrid = normalizeToGrid(originalBitmap);
  const referenceDensity = inkDensity(originalGrid);
  const scored: { candidate: FontCandidate; iou: number; combined: number }[] = [];
  for (const candidate of candidates) {
    const rendered = renderCandidate(candidate);
    if (!rendered) continue;
    const candidateGrid = normalizeToGrid(rendered);
    const iou = compareGrids(originalGrid, candidateGrid);
    const densityGap = Math.abs(inkDensity(candidateGrid) - referenceDensity);
    scored.push({ candidate, iou, combined: iou - DENSITY_PENALTY_WEIGHT * densityGap });
  }
  if (scored.length === 0) return { candidate: candidates[0], score: 0 };

  let best = scored[0];
  for (const entry of scored) {
    if (entry.combined > best.combined) best = entry;
  }
  return { candidate: best.candidate, score: Math.max(0, best.iou) };
}
