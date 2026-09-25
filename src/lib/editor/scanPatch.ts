"use client";

/**
 * Composes the actual visible replacement for a scanned-PDF word edit as a small raster
 * patch — at the page's own render resolution, not as vector PDF text — so the result looks
 * like part of the original scan rather than a generic PDF-font overlay. This is browser-only
 * (real `<canvas>` + installed font rendering), so unlike regionColor.ts/glyphMatch.ts it
 * isn't unit-tested directly; its output is verified by the visual-fidelity Playwright
 * fixtures in e2e/pdf-editor-ocr.spec.ts and by human before/after review instead.
 *
 * Pipeline (see AGENTS/spec "SCANNED WORD REPLACEMENT PIPELINE"):
 *   original glyph ink mask -> local font-candidate matching -> texture-cloned background
 *   -> protected ruling-line preservation -> new glyph rendered in the matched font
 *   -> slight blur to soften canvas-crisp edges toward the scan's own softness
 *   -> composited into one PNG, embedded as an image at export (see export.ts).
 */

import { computeInkMask, findTextureDonorRect, detectProtectedLines, type PixelSource, type PixelRect } from "./regionColor";
import { pickBestFontCandidateForReferences, type StyleReference, FONT_CANDIDATES, DEFAULT_FONT_CANDIDATE, type FontCandidate, type Bitmap } from "./glyphMatch";
import type { RgbColor } from "./types";

/** Per-page "document style profile" cache (spec section 8): once a font candidate has been
 * confidently matched for a page, short/low-ink words on the same page reuse it instead of
 * each independently guessing from too little ink to be reliable. Cleared implicitly by
 * normal page navigation — this is intentionally a lightweight in-memory cache, not
 * persisted, so it never grows unbounded across a long session. */
const pageStyleCache = new Map<string, FontCandidate>();

const MIN_INK_PIXELS_FOR_MATCHING = 10;
const INK_MATCH_MIN_THRESHOLD = 60;
const MIN_SHRINK_FACTOR = 0.72;
const LETTER_SPACING_SQUEEZE_PX = -0.4;
const BLUR_PX = 0.25;

export interface ComposeOcrPatchInput {
  source: PixelSource;
  /** The original OCR word's own tight box, viewport px — used to sample the glyph shape
   * for font matching and to anchor the new glyph's baseline. */
  wordRectPx: PixelRect;
  /** The full area to erase and redraw — the padded (+ any verified expansion) box, always
   * containing wordRectPx. */
  patchRectPx: PixelRect;
  /** Viewport-px y of the text baseline to render the new glyph on. Prefer a line-level
   * estimate (median of same-line neighbor words' own box-bottom) over wordRectPx's own
   * bottom when neighbors are available (spec section 11) — keeps a replacement visually
   * seated on the same line as its neighbors even if this word's own OCR box is a pixel or
   * two off. Falls back to wordRectPx's own bottom when there's nothing else to go on. */
  baselinePx: number;
  originalText: string;
  newText: string;
  backgroundColor: RgbColor;
  textColor: RgbColor;
  /** Viewport px per patch-canvas px — renders the patch at higher density than the on-
   * screen CSS pixel size so the exported PDF (usually scaled up from viewport size) still
   * looks sharp rather than blurry when embedded. */
  pixelScale: number;
  /** Cache key for the per-page style profile (spec section 8) — pass the page id. */
  styleCacheKey: string;
  /** Optional wider rect (typically the *whole* original OCR word, before narrowing to just
   * the changed characters) to sample for font matching instead of `wordRectPx` — a single
   * changed digit rarely has enough shape information to match confidently on its own, but
   * "12/20/2026" has plenty of digits/slashes to go on (spec section 9's "use nearby digits
   * from the same field as style anchors"). Only used when it actually has more ink than
   * `wordRectPx` to offer; falls back to `wordRectPx` otherwise. */
  styleReferenceRectPx?: PixelRect;
  /** The text to render when matching against `styleReferenceRectPx` — should be the whole
   * word's own original text, not just the changed substring. Ignored unless
   * styleReferenceRectPx is also given. */
  styleReferenceText?: string;
  /** Other words on the same line, in (probably) the same typeface — each is extra evidence for
   * the font match, and the word being edited counts double against them. */
  styleVoters?: { source: PixelSource; rectPx: PixelRect; text: string; backgroundColor: RgbColor; textColor: RgbColor }[];
}

export interface ComposeOcrPatchResult {
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  fontCandidateId: string;
  /** True if the fitted text still doesn't fit within the patch at the minimum legible
   * shrink factor — caller should warn the user (spec section 12). */
  overflow: boolean;
  /** True if the word's own ink significantly overlaps a detected table/border line, making
   * an automatic local erase unsafe (spec section 16/17) — caller should refuse to auto-
   * apply and offer manual/cancel instead. */
  unsafe: boolean;
  unsafeReason?: string;
}

/**
 * How far (patch-canvas px) to feather the patch's edges to soft transparency, given how much
 * margin is actually available on each side. Pulled out as a pure function so its edge-case
 * behavior is directly unit-testable without a real canvas — this exact calculation
 * previously floored its result to a whole pixel and required `>= 1` to feather at all, which
 * rounded a small-but-real margin (the common case for realistic, not-100%, OCR confidence —
 * see computeEditPadding's confidence factor) straight down to 0, silently disabling
 * feathering and producing a hard, visibly pasted edge instead.
 */
export function computeFeatherPx(
  marginLeftPx: number,
  marginRightPx: number,
  marginTopPx: number,
  marginBottomPx: number,
  pixelWidth: number,
  pixelHeight: number
): number {
  const rawFeatherPx = 0.7 * Math.min(marginLeftPx, marginRightPx, marginTopPx, marginBottomPx);
  // Capped well below half the patch's own size, so a very narrow single-character patch
  // can't feather its two opposing edges into each other and erase the whole glyph.
  return Math.max(0, Math.min(rawFeatherPx, pixelWidth * 0.4, pixelHeight * 0.4));
}

function fontString(candidate: FontCandidate, sizePx: number): string {
  const style = candidate.italic ? "italic" : "normal";
  const weight = candidate.bold ? "bold" : "normal";
  return `${style} ${weight} ${sizePx}px ${candidate.family}`;
}

/** Rasterizes `text` in a candidate font onto a small offscreen canvas and binarizes it into
 * an ink/background bitmap — used both to score font candidates against the real scanned
 * glyph and (implicitly) as a sanity check that the family actually renders something. */
function rasterizeTextToBitmap(text: string, candidate: FontCandidate, targetPixelHeight: number): Bitmap | null {
  if (!text.trim()) return null;
  const trialSize = Math.max(6, targetPixelHeight * 1.3);
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.font = fontString(candidate, trialSize);
  const naturalWidth = probe.measureText(text).width;
  const pad = Math.ceil(trialSize * 0.3);
  const width = Math.max(4, Math.ceil(naturalWidth) + pad * 2);
  const height = Math.max(4, Math.ceil(trialSize * 1.7));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.font = fontString(candidate, trialSize);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, pad, height * 0.72);

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    ink[i] = imgData.data[i * 4] < 140 ? 1 : 0; // black-ish text on a white probe background
  }
  return { width, height, ink };
}

/** Estimates the pixel size needed for `candidate` to render at `targetInkHeightPx` tall, by
 * rendering once at a trial size and linearly correcting from the measured bounding-box
 * height (canvas font metrics scale ~linearly with px size, so one correction is enough). */
function calibrateFontSize(ctx: CanvasRenderingContext2D, text: string, candidate: FontCandidate, targetInkHeightPx: number): number {
  const trialSize = Math.max(6, targetInkHeightPx * 1.3);
  ctx.font = fontString(candidate, trialSize);
  const m = ctx.measureText(text || "Mg");
  const asc = m.actualBoundingBoxAscent ?? trialSize * 0.72;
  const desc = m.actualBoundingBoxDescent ?? trialSize * 0.2;
  const measuredHeight = asc + desc;
  if (measuredHeight <= 0) return trialSize;
  const scale = targetInkHeightPx / measuredHeight;
  return Math.max(4, trialSize * scale);
}

/** Copies a source-canvas pixel rect into a small canvas at native size — used both to draw
 * a cloned texture donor and to redraw a protected ruling-line band untouched. */
function snapshotToCanvas(source: PixelSource, rect: PixelRect): HTMLCanvasElement | null {
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imgData = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = source.getPixel(rect.x + x, rect.y + y);
      const i = (y * w + x) * 4;
      imgData.data[i] = r;
      imgData.data[i + 1] = g;
      imgData.data[i + 2] = b;
      imgData.data[i + 3] = a;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** The solid "core" ink color of a scanned word: the mean of its darkest-most-contrasting pixels.
 * A re-rendered thin stroke never reaches the scan's own peak darkness at the same weight (it is
 * anti-aliased across more pixels), so filling the replacement with the *typical* ink color — which
 * the region estimate uses — leaves it visibly paler than its neighbors; the peak color is the
 * right fill. Returns null when there is too little ink to say. */
export function peakInkColor(source: PixelSource, rect: PixelRect, background: RgbColor): RgbColor | null {
  const bg = [background.r * 255, background.g * 255, background.b * 255];
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const px: { d: number; c: [number, number, number] }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = source.getPixel(x0 + x, y0 + y);
      if (a < 10) continue;
      const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
      if (d >= INK_MATCH_MIN_THRESHOLD) px.push({ d, c: [r, g, b] });
    }
  }
  if (px.length < MIN_INK_PIXELS_FOR_MATCHING) return null;
  px.sort((p, q) => q.d - p.d);
  const take = px.slice(0, Math.max(3, Math.floor(px.length * 0.1)));
  const mean = [0, 1, 2].map((i) => take.reduce((s, p) => s + p.c[i], 0) / take.length);
  return { r: mean[0] / 255, g: mean[1] / 255, b: mean[2] / 255 };
}

function rgbToCssColor(c: RgbColor): string {
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

/**
 * Shrinks a font size until text of that size fits `availableWidth`. Prefers stopping at the
 * legibility floor (MIN_SHRINK_FACTOR of the original size); if the text still doesn't fit there,
 * keeps shrinking the rest of the way and reports `overflow` so the caller can warn. It never
 * returns a size whose text is wider than the space: drawing that would be clipped by the patch's
 * own edge and silently drop characters (a line edit once exported "12/20/2028" as "12/20/202").
 * `widthAt(size)` measures the text at a given size.
 */
export function fitFontSizeToWidth(size: number, widthAt: (size: number) => number, availableWidth: number): { size: number; overflow: boolean } {
  let width = widthAt(size);
  if (width <= availableWidth) return { size, overflow: false };
  let fitted = Math.max(size * MIN_SHRINK_FACTOR, size * (availableWidth / width));
  width = widthAt(fitted);
  if (width <= availableWidth) return { size: fitted, overflow: false };
  // Text width is proportional to font size, so one proportional step lands it inside the space;
  // a second guards against measurement rounding.
  for (let i = 0; i < 2 && width > availableWidth; i++) {
    fitted *= availableWidth / width;
    width = widthAt(fitted);
  }
  return { size: fitted, overflow: true };
}

export function composeOcrPatch(input: ComposeOcrPatchInput): ComposeOcrPatchResult | null {
  if (typeof document === "undefined") return null;
  const {
    source,
    wordRectPx,
    patchRectPx,
    originalText,
    newText,
    backgroundColor,
    textColor,
    pixelScale,
    styleCacheKey,
    styleReferenceRectPx,
    styleReferenceText,
    styleVoters,
  } = input;

  const pixelWidth = Math.max(1, Math.round(patchRectPx.width * pixelScale));
  const pixelHeight = Math.max(1, Math.round(patchRectPx.height * pixelScale));
  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = pixelWidth;
  patchCanvas.height = pixelHeight;
  const ctx = patchCanvas.getContext("2d");
  if (!ctx) return null;

  // --- 1. Font matching: compare the real scanned glyph's shape against a small curated
  // set of locally available fonts. A single changed character (e.g. one digit in a date)
  // rarely has enough ink to match confidently on its own, so prefer a wider style-reference
  // rect (the whole original word) when one was given and actually has more ink to go on —
  // "12/20/2026" gives the matcher far more to work with than just "6" (spec section 9).
  // Falls back to a per-page cache when neither has enough ink (e.g. very short words).
  // A soft, anti-aliased scan has a wide halo of lightly-tinted pixels around every stroke; at
  // the default (low) threshold those count as ink, the mask reads far heavier than the real
  // strokes, and the matcher then picks a bold face. Font matching therefore judges "ink" at
  // roughly half the way from paper to the text color instead.
  const contrast = Math.hypot(
    (backgroundColor.r - textColor.r) * 255,
    (backgroundColor.g - textColor.g) * 255,
    (backgroundColor.b - textColor.b) * 255
  );
  const matchThreshold = Math.max(INK_MATCH_MIN_THRESHOLD, contrast * 0.5);
  const wordInkMask = computeInkMask(source, wordRectPx, backgroundColor, matchThreshold);
  const wordInkCount = wordInkMask.ink.reduce((sum, v) => sum + v, 0);
  const referenceInkMask = styleReferenceRectPx ? computeInkMask(source, styleReferenceRectPx, backgroundColor, matchThreshold) : null;
  const referenceInkCount = referenceInkMask ? referenceInkMask.ink.reduce((sum, v) => sum + v, 0) : 0;

  const useReference = referenceInkMask !== null && referenceInkCount > wordInkCount && referenceInkCount >= MIN_INK_PIXELS_FOR_MATCHING;
  const matchMask = useReference ? referenceInkMask! : wordInkMask;
  const matchText = useReference ? styleReferenceText! : originalText;
  const matchHeightPx = (useReference ? styleReferenceRectPx! : wordRectPx).height * pixelScale;
  const matchInkCount = useReference ? referenceInkCount : wordInkCount;

  let fontCandidate: FontCandidate;
  if (matchInkCount >= MIN_INK_PIXELS_FOR_MATCHING) {
    const references: StyleReference[] = [{ bitmap: matchMask, render: (c) => rasterizeTextToBitmap(matchText, c, matchHeightPx), weight: 2 }];
    for (const voter of styleVoters ?? []) {
      const voterContrast = Math.hypot(
        (voter.backgroundColor.r - voter.textColor.r) * 255,
        (voter.backgroundColor.g - voter.textColor.g) * 255,
        (voter.backgroundColor.b - voter.textColor.b) * 255
      );
      const mask = computeInkMask(voter.source, voter.rectPx, voter.backgroundColor, Math.max(INK_MATCH_MIN_THRESHOLD, voterContrast * 0.5));
      if (mask.ink.reduce((sum, v) => sum + v, 0) < MIN_INK_PIXELS_FOR_MATCHING) continue;
      references.push({ bitmap: mask, render: (c) => rasterizeTextToBitmap(voter.text, c, voter.rectPx.height * pixelScale) });
    }
    const { candidate } = pickBestFontCandidateForReferences(references);
    fontCandidate = candidate;
    pageStyleCache.set(styleCacheKey, candidate);
  } else {
    fontCandidate = pageStyleCache.get(styleCacheKey) ?? DEFAULT_FONT_CANDIDATE;
  }

  // --- 2. Unsafe check: does this word's own ink significantly overlap a table/border line
  // within the patch? If so, a local erase would eat into that line — refuse to auto-apply.
  // Line-vs-glyph judgment needs a span much wider/taller than just this one word's own tight
  // patch (see detectProtectedLines) — otherwise the glyph's own ink, which can easily cover
  // most of a box barely bigger than itself, gets misread as a "line".
  const wideSampleRect: PixelRect = {
    x: Math.max(0, patchRectPx.x - patchRectPx.width * 3),
    y: Math.max(0, patchRectPx.y - patchRectPx.height * 3),
    width: Math.min(source.width, patchRectPx.width * 7),
    height: Math.min(source.height, patchRectPx.height * 7),
  };
  const { horizontal, vertical } = detectProtectedLines(source, patchRectPx, backgroundColor, wideSampleRect);
  const protectedBands = [...horizontal, ...vertical];
  let unsafe = false;
  let unsafeReason: string | undefined;
  for (const band of protectedBands) {
    const bandLocalX0 = Math.max(0, Math.round(band.x - wordRectPx.x));
    const bandLocalX1 = Math.min(wordInkMask.width, Math.round(band.x + band.width - wordRectPx.x));
    const bandLocalY0 = Math.max(0, Math.round(band.y - wordRectPx.y));
    const bandLocalY1 = Math.min(wordInkMask.height, Math.round(band.y + band.height - wordRectPx.y));
    if (bandLocalX1 <= bandLocalX0 || bandLocalY1 <= bandLocalY0) continue;
    let overlapInk = 0;
    let bandArea = 0;
    for (let y = bandLocalY0; y < bandLocalY1; y++) {
      for (let x = bandLocalX0; x < bandLocalX1; x++) {
        bandArea++;
        if (wordInkMask.ink[y * wordInkMask.width + x]) overlapInk++;
      }
    }
    if (bandArea > 0 && overlapInk / bandArea > 0.15) {
      unsafe = true;
      unsafeReason = "This text overlaps a table or border line, so it can't be replaced automatically without risking that line.";
      break;
    }
  }

  // --- 3. Background reconstruction: clone a real texture donor from just outside the
  // patch when one is available (preserves paper grain/noise); otherwise fall back to a
  // flat fill in the estimated background color.
  const donorRect = findTextureDonorRect(source, patchRectPx, backgroundColor);
  if (donorRect) {
    const donorCanvas = snapshotToCanvas(source, donorRect);
    if (donorCanvas) {
      ctx.drawImage(donorCanvas, 0, 0, donorCanvas.width, donorCanvas.height, 0, 0, pixelWidth, pixelHeight);
    } else {
      ctx.fillStyle = rgbToCssColor(backgroundColor);
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    }
  } else {
    ctx.fillStyle = rgbToCssColor(backgroundColor);
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  }

  // --- 4. Redraw any protected ruling-line bands from the original pixels, unchanged, so
  // table/form lines stay continuous under the patch.
  for (const band of protectedBands) {
    const snap = snapshotToCanvas(source, band);
    if (!snap) continue;
    const localX = (band.x - patchRectPx.x) * pixelScale;
    const localY = (band.y - patchRectPx.y) * pixelScale;
    const w = band.width * pixelScale;
    const h = band.height * pixelScale;
    ctx.drawImage(snap, 0, 0, snap.width, snap.height, localX, localY, w, h);
  }

  // --- 5. New glyph: matched font, calibrated size, real baseline from the original word's
  // own position, with a fit pass (letter-spacing squeeze, then shrink) before giving up and
  // flagging overflow rather than silently covering neighboring content.
  let overflow = false;
  if (newText.trim()) {
    const targetInkHeightPx = wordRectPx.height * pixelScale;
    // Size comes from the *whole original word* rendered in the matched face (its ink height is
    // known: it's the OCR box), not from the replacement itself — a changed piece like "y" or
    // "5" has a different ink height than the box it replaces (descenders, x-height), and sizing
    // it to fit that box made it visibly smaller/larger than its neighbors.
    // A same-length digit swap replaces glyphs that have no descenders and whose own tight box is
    // known: size and seat them from that box (the digit's real top and bottom) instead of from the
    // whole field, whose "/" or "." glyphs reach past the digits and skew both measurements.
    const digitSwap = /^[0-9]+$/.test(originalText) && /^[0-9]+$/.test(newText);
    const sizeText = digitSwap ? originalText : useReference ? styleReferenceText! : originalText;
    // The digit's real ink extent (rows of the ink mask that actually contain ink) — the OCR box
    // around it is a little taller than the ink, which made the replacement digit too big and sit
    // too low. Falls back to the box when the mask has no ink.
    let inkTop = -1;
    let inkBottom = -1;
    for (let y = 0; y < wordInkMask.height; y++) {
      for (let x = 0; x < wordInkMask.width; x++) {
        if (wordInkMask.ink[y * wordInkMask.width + x]) {
          if (inkTop < 0) inkTop = y;
          inkBottom = y;
          break;
        }
      }
    }
    const inkHeightPx = inkTop >= 0 ? inkBottom - inkTop + 1 : wordRectPx.height;
    const sizeHeightPx = digitSwap ? inkHeightPx * pixelScale : matchHeightPx;
    let size = sizeText.trim() ? calibrateFontSize(ctx, sizeText, fontCandidate, sizeHeightPx) : calibrateFontSize(ctx, newText, fontCandidate, targetInkHeightPx);
    // Whole-word replacements are seated from the original word's own dense text band — the rows
    // holding the bulk of its ink, i.e. the x-height — not from the OCR box (whose bottom includes
    // descenders and halo) or a neighbor-derived line estimate: the band's bottom edge is the real
    // baseline and its height the real x-height, so the new word lands on the same line at the same
    // size as its neighbors instead of a pixel or two low and a shade small.
    let seatedBaselinePx: number | null = null;
    if (!digitSwap && !useReference && wordInkMask.height >= 6) {
      const rowInk: number[] = [];
      for (let y = 0; y < wordInkMask.height; y++) {
        let n = 0;
        for (let x = 0; x < wordInkMask.width; x++) n += wordInkMask.ink[y * wordInkMask.width + x];
        rowInk.push(n);
      }
      const maxInk = Math.max(...rowInk);
      const dense = rowInk.map((n, i) => [n, i] as const).filter(([n]) => maxInk >= 4 && n > maxInk * 0.5).map(([, i]) => i);
      if (dense.length >= 3) {
        const bandTop = dense[0];
        const bandBottom = dense[dense.length - 1];
        ctx.font = fontString(fontCandidate, size);
        const fontXHeight = ctx.measureText("x").actualBoundingBoxAscent;
        if (fontXHeight > 0) size = Math.min(size * 1.12, Math.max(size * 0.9, size * (((bandBottom - bandTop + 1) * pixelScale) / fontXHeight)));
        seatedBaselinePx = wordRectPx.y + bandBottom + 0.7;
      }
    }
    ctx.font = fontString(fontCandidate, size);
    const availableWidthPx = patchRectPx.width * pixelScale;
    let naturalWidth = ctx.measureText(newText).width;
    let letterSpacing = 0;

    if (naturalWidth > availableWidthPx) {
      const supportsLetterSpacing = "letterSpacing" in ctx;
      if (supportsLetterSpacing && naturalWidth <= availableWidthPx * 1.15) {
        letterSpacing = LETTER_SPACING_SQUEEZE_PX;
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacing}px`;
        naturalWidth = ctx.measureText(newText).width;
      }
    }
    if (naturalWidth > availableWidthPx) {
      const fitted = fitFontSizeToWidth(size, (s) => {
        ctx.font = fontString(fontCandidate, s);
        return ctx.measureText(newText).width;
      }, availableWidthPx);
      size = fitted.size;
      overflow = fitted.overflow;
      ctx.font = fontString(fontCandidate, size);
      naturalWidth = ctx.measureText(newText).width;
    }

    const baselineLocalPx = ((digitSwap && inkTop >= 0 ? wordRectPx.y + inkBottom + 0.7 : (seatedBaselinePx ?? input.baselinePx)) - patchRectPx.y) * pixelScale;
    // Fill with the neighbors' peak ink color (never lighter than the plain estimate).
    const peaks: RgbColor[] = [];
    const own = peakInkColor(source, styleReferenceRectPx ?? wordRectPx, backgroundColor);
    if (own) peaks.push(own);
    for (const v of styleVoters ?? []) {
      const p = peakInkColor(v.source, v.rectPx, v.backgroundColor);
      if (p) peaks.push(p);
    }
    const luma = (c: RgbColor) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    let fill = textColor;
    if (peaks.length > 0) {
      const avg = { r: peaks.reduce((s, p) => s + p.r, 0) / peaks.length, g: peaks.reduce((s, p) => s + p.g, 0) / peaks.length, b: peaks.reduce((s, p) => s + p.b, 0) / peaks.length };
      if (luma(avg) < luma(textColor)) fill = avg;
    }
    ctx.fillStyle = rgbToCssColor(fill);
    ctx.textBaseline = "alphabetic";
    ctx.filter = `blur(${BLUR_PX}px)`;
    ctx.fillText(newText, 0, baselineLocalPx);
    ctx.filter = "none";
    if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
  }

  // --- 6. Feather the patch's own edges to soft transparency so it blends into the
  // original page instead of reading as a pasted rectangle (spec section 4's "blended clone
  // patch with feathered borders") — the transparent ring reveals the *real* original pixels
  // underneath (export draws this patch as an overlay on the untouched page, never after
  // erasing it), which is strictly more accurate there than our own cloned texture anyway.
  // Capped well inside the padding margin around the original word box, so the feather can
  // never soften into territory where the old glyph's own ink still lives.
  const marginLeftPx = (wordRectPx.x - patchRectPx.x) * pixelScale;
  const marginRightPx = (patchRectPx.x + patchRectPx.width - (wordRectPx.x + wordRectPx.width)) * pixelScale;
  const marginTopPx = (wordRectPx.y - patchRectPx.y) * pixelScale;
  const marginBottomPx = (patchRectPx.y + patchRectPx.height - (wordRectPx.y + wordRectPx.height)) * pixelScale;
  const safeFeatherPx = computeFeatherPx(marginLeftPx, marginRightPx, marginTopPx, marginBottomPx, pixelWidth, pixelHeight);
  if (safeFeatherPx > 0.25) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = pixelWidth;
    maskCanvas.height = pixelHeight;
    const mctx = maskCanvas.getContext("2d");
    if (mctx) {
      mctx.fillStyle = "#000";
      mctx.shadowColor = "#000";
      mctx.shadowBlur = safeFeatherPx;
      mctx.fillRect(safeFeatherPx, safeFeatherPx, Math.max(0, pixelWidth - safeFeatherPx * 2), Math.max(0, pixelHeight - safeFeatherPx * 2));
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  let dataUrl: string;
  try {
    dataUrl = patchCanvas.toDataURL("image/png");
  } catch {
    return null; // e.g. a tainted canvas — caller falls back to the legacy vector path
  }

  return {
    dataUrl,
    pixelWidth,
    pixelHeight,
    fontCandidateId: fontCandidate.id,
    overflow,
    unsafe,
    unsafeReason,
  };
}

export { FONT_CANDIDATES };
