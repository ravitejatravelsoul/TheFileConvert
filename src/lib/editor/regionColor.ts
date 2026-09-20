import type { RgbColor } from "./types";

/**
 * Local, non-AI estimation of the background/text color around an OCR word, used so a
 * correction patch can match the scan instead of always punching a solid white rectangle
 * over it (the root cause of "edits wipe the surrounding line" — see PageSurface.tsx /
 * export.ts for where this plugs in). Everything here operates on already-rendered pixel
 * data from the page's own canvas; nothing is uploaded or generated.
 */

/** Minimal pixel-reading surface so this module is testable without a real browser
 * `CanvasRenderingContext2D` (see regionColor.test.ts for a plain-array-backed fake). */
export interface PixelSource {
  width: number;
  height: number;
  /** Returns [r,g,b,a] each 0-255 at an integer pixel coordinate; out-of-bounds reads
   * should clamp to the nearest edge pixel rather than throw. */
  getPixel(x: number, y: number): [number, number, number, number];
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionColorEstimate {
  backgroundColor: RgbColor;
  textColor: RgbColor;
  /** True when the sampled background is too non-uniform (table lines, patterns, a
   * photo/logo/stamp underneath, etc.) to safely reconstruct with a flat color patch. */
  complex: boolean;
}

/** How far (in the same units as CIE-ish channel distance below) a background sample can
 * be from the median before the region is considered non-uniform. Calibrated against the
 * fixtures in regionColor.test.ts: a clean scan's paper grain stays well under this even
 * with light noise, while a table border line or a second color crossing the sample ring
 * pushes it well over. */
const COMPLEX_VARIANCE_THRESHOLD = 900; // ~ (30 per-channel stddev)^2, summed over samples
/** A pixel counts as "ink" (part of the glyph, not background) once it's at least this far
 * from the estimated background color. */
const INK_DISTANCE_THRESHOLD = 60;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function colorDistanceSq(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function medianColor(samples: [number, number, number][]): [number, number, number] {
  if (samples.length === 0) return [255, 255, 255];
  return [median(samples.map((s) => s[0])), median(samples.map((s) => s[1])), median(samples.map((s) => s[2]))];
}

function to01(c: [number, number, number]): RgbColor {
  return { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 };
}

/** Samples the thin ring of pixels between `inner` and `inner` expanded by `paddingPx` —
 * i.e. just outside the word itself, the most reliable place to find pure background
 * without picking up glyph ink. Falls back to the inner rect's own edge if padding is 0
 * or the page is too small to have room around it. */
function sampleBackgroundRing(source: PixelSource, inner: PixelRect, paddingPx: number): [number, number, number][] {
  const outerX0 = clamp(Math.floor(inner.x - paddingPx), 0, source.width - 1);
  const outerY0 = clamp(Math.floor(inner.y - paddingPx), 0, source.height - 1);
  const outerX1 = clamp(Math.ceil(inner.x + inner.width + paddingPx), 0, source.width - 1);
  const outerY1 = clamp(Math.ceil(inner.y + inner.height + paddingPx), 0, source.height - 1);
  const innerX0 = Math.round(inner.x);
  const innerY0 = Math.round(inner.y);
  const innerX1 = Math.round(inner.x + inner.width);
  const innerY1 = Math.round(inner.y + inner.height);

  const samples: [number, number, number][] = [];
  const step = Math.max(1, Math.round(paddingPx / 4)) || 1;
  for (let y = outerY0; y <= outerY1; y += step) {
    for (let x = outerX0; x <= outerX1; x += step) {
      const insideInner = x >= innerX0 && x <= innerX1 && y >= innerY0 && y <= innerY1;
      if (insideInner) continue;
      const [r, g, b, a] = source.getPixel(x, y);
      if (a < 10) continue; // transparent — not a real background sample
      samples.push([r, g, b]);
    }
  }

  if (samples.length === 0) {
    // No room for a ring (word fills the whole sampled area) — fall back to the inner
    // rect's own border pixels rather than returning nothing.
    for (let x = innerX0; x <= innerX1; x++) {
      samples.push(source.getPixel(x, innerY0).slice(0, 3) as [number, number, number]);
      samples.push(source.getPixel(x, innerY1).slice(0, 3) as [number, number, number]);
    }
    for (let y = innerY0; y <= innerY1; y++) {
      samples.push(source.getPixel(innerX0, y).slice(0, 3) as [number, number, number]);
      samples.push(source.getPixel(innerX1, y).slice(0, 3) as [number, number, number]);
    }
  }
  return samples;
}

function sampleInkPixels(
  source: PixelSource,
  inner: PixelRect,
  background: [number, number, number]
): { color: [number, number, number]; distance: number }[] {
  const x0 = Math.round(inner.x);
  const y0 = Math.round(inner.y);
  const x1 = Math.round(inner.x + inner.width);
  const y1 = Math.round(inner.y + inner.height);
  const ink: { color: [number, number, number]; distance: number }[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [r, g, b, a] = source.getPixel(x, y);
      if (a < 10) continue;
      const distSq = colorDistanceSq([r, g, b], background);
      if (distSq >= INK_DISTANCE_THRESHOLD * INK_DISTANCE_THRESHOLD) {
        ink.push({ color: [r, g, b], distance: distSq });
      }
    }
  }
  return ink;
}

/**
 * Estimates the local background color, text (ink) color, and whether the background is
 * too complex to safely reconstruct, for a word's bounding box in *pixel* (viewport)
 * coordinates on the page's own rendered canvas. `paddingPx` should be the same padding
 * the caller intends to use for the replacement patch (see computeEditPadding).
 */
export function estimateRegionColors(source: PixelSource, wordRectPx: PixelRect, paddingPx: number): RegionColorEstimate {
  const backgroundSamples = sampleBackgroundRing(source, wordRectPx, paddingPx);
  const backgroundMedian = medianColor(backgroundSamples);

  const variance =
    backgroundSamples.length > 0
      ? backgroundSamples.reduce((sum, s) => sum + colorDistanceSq(s, backgroundMedian), 0) / backgroundSamples.length
      : 0;
  const complex = variance > COMPLEX_VARIANCE_THRESHOLD;

  const inkSamples = sampleInkPixels(source, wordRectPx, backgroundMedian);
  const totalInner = Math.max(1, Math.round(wordRectPx.width) * Math.round(wordRectPx.height));
  const hasEnoughInk = inkSamples.length / totalInner >= 0.02;
  // Anti-aliased glyph edges put a lot of "ink-classified" pixels only partway between the
  // background and the glyph's true (solid) ink color — a plain median over all of them
  // reads noticeably lighter/grayer than the actual text. Taking the median of just the
  // *most* ink-like half (furthest from the background) targets the solid glyph core
  // instead, closer to what "dominant text color" means for an anti-aliased scan.
  const coreInkSamples = [...inkSamples].sort((a, b) => b.distance - a.distance).slice(0, Math.ceil(inkSamples.length / 2));
  const textColor = hasEnoughInk ? medianColor(coreInkSamples.map((s) => s.color)) : [0, 0, 0];

  return {
    backgroundColor: to01(backgroundMedian),
    textColor: to01(textColor as [number, number, number]),
    complex,
  };
}

/** Small, conservative padding (in PDF points) around a word's tight OCR box, just enough
 * to cover anti-aliased glyph edges without eating into neighboring characters. Scales
 * gently with font size (taller text has thicker stroke edges to cover) and backs off for
 * low-confidence boxes, whose bounds are less trustworthy so a smaller patch is safer. */
export function computeEditPadding(boxHeightPt: number, confidence: number): number {
  const base = clamp(boxHeightPt * 0.06, 0.5, 3);
  const confidenceFactor = confidence >= 85 ? 1 : confidence >= 60 ? 0.85 : 0.7;
  return base * confidenceFactor;
}

export interface InkMask {
  width: number;
  height: number;
  /** Row-major, one byte per pixel: 1 = ink (part of a glyph/mark), 0 = background. */
  ink: Uint8Array;
}

/** Builds a spatial ink/background mask for a rect (rather than just color samples) — used
 * both to compare a scanned glyph's shape against rendered font candidates (glyphMatch.ts)
 * and to know exactly which pixels a redraw needs to cover. */
export function computeInkMask(source: PixelSource, rect: PixelRect, background: RgbColor, threshold = INK_DISTANCE_THRESHOLD): InkMask {
  const bg: [number, number, number] = [background.r * 255, background.g * 255, background.b * 255];
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = source.getPixel(x0 + x, y0 + y);
      if (a >= 10 && colorDistanceSq([r, g, b], bg) >= threshold * threshold) {
        ink[y * width + x] = 1;
      }
    }
  }
  return { width, height, ink };
}

/**
 * Looks for a same-sized rectangle of mostly-blank scan immediately above, below, left of,
 * or right of `patchRect` (in that priority order — text usually has more reliable blank
 * space above/below its own line than beside it) to use as a texture donor: cloning real
 * neighboring paper grain/noise into the erased region instead of a flat color fill. Returns
 * null if no direction has enough blank room, so the caller can fall back to a flat fill.
 */
export function findTextureDonorRect(
  source: PixelSource,
  patchRect: PixelRect,
  background: RgbColor,
  maxInkFraction = 0.06
): PixelRect | null {
  const bg: [number, number, number] = [background.r * 255, background.g * 255, background.b * 255];
  const candidates: PixelRect[] = [
    { x: patchRect.x, y: patchRect.y - patchRect.height, width: patchRect.width, height: patchRect.height },
    { x: patchRect.x, y: patchRect.y + patchRect.height, width: patchRect.width, height: patchRect.height },
    { x: patchRect.x - patchRect.width, y: patchRect.y, width: patchRect.width, height: patchRect.height },
    { x: patchRect.x + patchRect.width, y: patchRect.y, width: patchRect.width, height: patchRect.height },
  ];
  for (const c of candidates) {
    if (c.width <= 0 || c.height <= 0) continue;
    if (c.x < 0 || c.y < 0 || c.x + c.width > source.width || c.y + c.height > source.height) continue;
    let inkCount = 0;
    let total = 0;
    const stepX = Math.max(1, Math.floor(c.width / 12));
    const stepY = Math.max(1, Math.floor(c.height / 6));
    for (let y = c.y; y < c.y + c.height; y += stepY) {
      for (let x = c.x; x < c.x + c.width; x += stepX) {
        const [r, g, b, a] = source.getPixel(x, y);
        if (a < 10) continue;
        total++;
        if (colorDistanceSq([r, g, b], bg) >= INK_DISTANCE_THRESHOLD * INK_DISTANCE_THRESHOLD) inkCount++;
      }
    }
    if (total > 0 && inkCount / total <= maxInkFraction) return c;
  }
  return null;
}

/** A thin band of consistently non-background pixels spanning most of the patch — a table
 * rule, underline, or box border that must survive a word replacement unchanged. */
export type ProtectedLine = PixelRect;

/** Detects horizontal and vertical ruling-line-like bands crossing `patchRect`, so an erase
 * pass can redraw them from the original pixels afterward instead of losing them under the
 * replacement. A row/column counts as a line when most of it differs from the background —
 * but judged across `wideSampleRect` (which should span well beyond the word itself), not
 * `patchRect` alone: a patch is normally tight to just one word, so nearly any row through
 * the glyph's own ink would otherwise look "mostly foreground" purely because there's so
 * little background left in such a narrow box, misfiring on ordinary text. A genuine ruling
 * line stays foreground across a much wider span than any single word does. Defaults to
 * `patchRect` itself so existing narrow-canvas callers/tests are unaffected. */
export function detectProtectedLines(
  source: PixelSource,
  patchRect: PixelRect,
  background: RgbColor,
  wideSampleRect: PixelRect = patchRect
): { horizontal: ProtectedLine[]; vertical: ProtectedLine[] } {
  const bg: [number, number, number] = [background.r * 255, background.g * 255, background.b * 255];
  const x0 = Math.round(patchRect.x);
  const x1 = Math.round(patchRect.x + patchRect.width);
  const y0 = Math.round(patchRect.y);
  const y1 = Math.round(patchRect.y + patchRect.height);
  const wx0 = Math.round(wideSampleRect.x);
  const wx1 = Math.round(wideSampleRect.x + wideSampleRect.width);
  const wy0 = Math.round(wideSampleRect.y);
  const wy1 = Math.round(wideSampleRect.y + wideSampleRect.height);
  const LINE_FRACTION = 0.8;
  const STEPS = 24;

  function isForeground(x: number, y: number): boolean | null {
    const [r, g, b, a] = source.getPixel(x, y);
    if (a < 10) return null;
    return colorDistanceSq([r, g, b], bg) >= INK_DISTANCE_THRESHOLD * INK_DISTANCE_THRESHOLD;
  }

  const horizontal: ProtectedLine[] = [];
  {
    const rowIsLine: boolean[] = [];
    for (let y = y0; y < y1; y++) {
      let nonBg = 0;
      let total = 0;
      for (let i = 0; i <= STEPS; i++) {
        const x = Math.round(wx0 + (i / STEPS) * (wx1 - wx0));
        const fg = isForeground(x, y);
        if (fg === null) continue;
        total++;
        if (fg) nonBg++;
      }
      rowIsLine.push(total > 0 && nonBg / total >= LINE_FRACTION);
    }
    let bandStart = -1;
    for (let i = 0; i <= rowIsLine.length; i++) {
      const isLine = i < rowIsLine.length && rowIsLine[i];
      if (isLine && bandStart === -1) bandStart = i;
      if (!isLine && bandStart !== -1) {
        const thickness = i - bandStart;
        if (thickness <= Math.max(3, patchRect.height * 0.35)) {
          horizontal.push({ x: patchRect.x, y: y0 + bandStart, width: patchRect.width, height: thickness });
        }
        bandStart = -1;
      }
    }
  }

  const vertical: ProtectedLine[] = [];
  {
    const colIsLine: boolean[] = [];
    for (let x = x0; x < x1; x++) {
      let nonBg = 0;
      let total = 0;
      for (let i = 0; i <= STEPS; i++) {
        const y = Math.round(wy0 + (i / STEPS) * (wy1 - wy0));
        const fg = isForeground(x, y);
        if (fg === null) continue;
        total++;
        if (fg) nonBg++;
      }
      colIsLine.push(total > 0 && nonBg / total >= LINE_FRACTION);
    }
    let bandStart = -1;
    for (let i = 0; i <= colIsLine.length; i++) {
      const isLine = i < colIsLine.length && colIsLine[i];
      if (isLine && bandStart === -1) bandStart = i;
      if (!isLine && bandStart !== -1) {
        const thickness = i - bandStart;
        if (thickness <= Math.max(3, patchRect.width * 0.35)) {
          vertical.push({ x: x0 + bandStart, y: patchRect.y, width: thickness, height: patchRect.height });
        }
        bandStart = -1;
      }
    }
  }

  return { horizontal, vertical };
}
