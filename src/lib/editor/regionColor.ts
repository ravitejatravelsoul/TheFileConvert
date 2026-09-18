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
): [number, number, number][] {
  const x0 = Math.round(inner.x);
  const y0 = Math.round(inner.y);
  const x1 = Math.round(inner.x + inner.width);
  const y1 = Math.round(inner.y + inner.height);
  const ink: [number, number, number][] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [r, g, b, a] = source.getPixel(x, y);
      if (a < 10) continue;
      if (colorDistanceSq([r, g, b], background) >= INK_DISTANCE_THRESHOLD * INK_DISTANCE_THRESHOLD) {
        ink.push([r, g, b]);
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
  const textColor = hasEnoughInk ? medianColor(inkSamples) : [0, 0, 0];

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
