/**
 * PDF <-> viewport coordinate conversion.
 *
 * The editor has to translate between several coordinate spaces:
 *   - PDF space: origin bottom-left, y increases upward, in points. This is the space
 *     every EditorObject's x/y/width/height is stored in, and the space pdf-lib's
 *     `page.drawX()` calls expect — independent of zoom, rotation, or how the page is
 *     currently displayed.
 *   - Viewport space: origin top-left, y increases downward, in canvas/CSS pixels at
 *     the current render scale and rotation. This is what mouse/pointer events give us
 *     and what we position overlay DOM elements in.
 *
 * This module implements the same affine-transform math pdf.js uses internally for its
 * `PageViewport` (mirrored here because that class isn't part of pdf.js's public API —
 * see the reasoning in coordinates.test.ts), so every place in the editor that needs to
 * convert coordinates goes through one well-tested implementation instead of scattering
 * ad-hoc math across components.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface ViewportSpec {
  /** The page's own PDF-space box: [xMin, yMin, xMax, yMax], in points. */
  viewBox: [number, number, number, number];
  /** Pixels per PDF point. */
  scale: number;
  /** Total display rotation in degrees, clockwise. */
  rotation: Rotation;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A 2D affine transform [a, b, c, d, e, f] such that x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type AffineMatrix = [number, number, number, number, number, number];

function normalizeRotation(rotation: number): Rotation {
  const r = ((rotation % 360) + 360) % 360;
  if (r !== 0 && r !== 90 && r !== 180 && r !== 270) {
    throw new Error(`Invalid rotation ${rotation}: must be a multiple of 90 degrees.`);
  }
  return r as Rotation;
}

/** Builds the PDF-space -> viewport-space transform matrix for a page. */
export function buildViewportTransform(spec: ViewportSpec): AffineMatrix {
  const [x0, y0, x1, y1] = spec.viewBox;
  const scale = spec.scale;
  const rotation = normalizeRotation(spec.rotation);
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;

  let a: number, b: number, c: number, d: number;
  switch (rotation) {
    case 180:
      a = -1; b = 0; c = 0; d = 1;
      break;
    case 90:
      a = 0; b = 1; c = 1; d = 0;
      break;
    case 270:
      a = 0; b = -1; c = -1; d = 0;
      break;
    case 0:
    default:
      a = 1; b = 0; c = 0; d = -1;
      break;
  }

  let offsetCanvasX: number;
  let offsetCanvasY: number;
  if (a === 0) {
    offsetCanvasX = Math.abs(centerY - y0) * scale;
    offsetCanvasY = Math.abs(centerX - x0) * scale;
  } else {
    offsetCanvasX = Math.abs(centerX - x0) * scale;
    offsetCanvasY = Math.abs(centerY - y0) * scale;
  }

  const e = offsetCanvasX - a * scale * centerX - c * scale * centerY;
  const f = offsetCanvasY - b * scale * centerX - d * scale * centerY;

  return [a * scale, b * scale, c * scale, d * scale, e, f];
}

/** Pixel dimensions of the rendered page for this spec (matches a real canvas render). */
export function viewportDimensions(spec: ViewportSpec): { width: number; height: number } {
  const [x0, y0, x1, y1] = spec.viewBox;
  const rotation = normalizeRotation(spec.rotation);
  const pageWidth = (x1 - x0) * spec.scale;
  const pageHeight = (y1 - y0) * spec.scale;
  return rotation === 90 || rotation === 270
    ? { width: pageHeight, height: pageWidth }
    : { width: pageWidth, height: pageHeight };
}

export function applyMatrix(matrix: AffineMatrix, p: Point): Point {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

export function invertMatrix(matrix: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = matrix;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error("Viewport transform is not invertible.");
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const ie = -(ia * e + ic * f);
  const if_ = -(ib * e + id * f);
  return [ia, ib, ic, id, ie, if_];
}

export function pdfToViewportPoint(spec: ViewportSpec, p: Point): Point {
  return applyMatrix(buildViewportTransform(spec), p);
}

export function viewportToPdfPoint(spec: ViewportSpec, p: Point): Point {
  return applyMatrix(invertMatrix(buildViewportTransform(spec)), p);
}

/** Converts an axis-aligned PDF-space rect to an axis-aligned viewport-space rect,
 * correctly handling rotation by transforming all 4 corners and taking the bounding box. */
export function pdfRectToViewport(spec: ViewportSpec, rect: Rect): Rect {
  const matrix = buildViewportTransform(spec);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((p) => applyMatrix(matrix, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Converts an axis-aligned viewport-space rect back to an axis-aligned PDF-space rect. */
export function viewportRectToPdf(spec: ViewportSpec, rect: Rect): Rect {
  const matrix = invertMatrix(buildViewportTransform(spec));
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((p) => applyMatrix(matrix, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Lowest zoom "fit" math will ever produce — guards against a degenerate (near-zero)
 * container or page size collapsing the page to nothing. */
export const MIN_FIT_ZOOM = 0.2;

/**
 * The zoom factor (relative to the 100%-zoom page size in `pageDimsAtZoom1`) that fits the
 * page into `available` space, for the editor's "Fit width"/"Fit page" toolbar buttons.
 * `available` is the content area the caller has already reserved padding/chrome from —
 * this function does no layout measurement itself, only the arithmetic, so it's testable
 * independent of any DOM/ResizeObserver.
 */
export function computeFitZoom(
  mode: "fit-width" | "fit-page",
  available: { width: number; height: number },
  pageDimsAtZoom1: { width: number; height: number }
): number {
  if (pageDimsAtZoom1.width <= 0 || pageDimsAtZoom1.height <= 0) return 1;
  const widthZoom = available.width / pageDimsAtZoom1.width;
  if (mode === "fit-width") return Math.max(MIN_FIT_ZOOM, widthZoom);
  const heightZoom = available.height / pageDimsAtZoom1.height;
  return Math.max(MIN_FIT_ZOOM, Math.min(widthZoom, heightZoom));
}

/**
 * A viewport-space rect as CSS absolute-position style properties. Rects here use `x`/`y`
 * keys, which are NOT CSS properties — spreading one straight into `style` silently drops the
 * position (leaving only width/height), which is exactly how a live drag preview once
 * rendered at the page's top-left instead of under the pointer. Every place that positions a
 * DOM overlay from a Rect should go through this one helper.
 */
export function rectToCssStyle(rect: Rect): { left: number; top: number; width: number; height: number } {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

/** Convenience: a PDF-space rect straight to absolute-position CSS for the given viewport. */
export function pdfRectToCssStyle(spec: ViewportSpec, rect: Rect): { left: number; top: number; width: number; height: number } {
  return rectToCssStyle(pdfRectToViewport(spec, rect));
}

/** Clamps a PDF-space rect to lie within `box` ([xMin, yMin, xMax, yMax]) — e.g. a crop area
 * dragged past the page edge. */
export function clampRectToBox(rect: Rect, box: [number, number, number, number]): Rect {
  const x0 = Math.min(Math.max(rect.x, box[0]), box[2]);
  const y0 = Math.min(Math.max(rect.y, box[1]), box[3]);
  const x1 = Math.min(Math.max(rect.x + rect.width, box[0]), box[2]);
  const y1 = Math.min(Math.max(rect.y + rect.height, box[1]), box[3]);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

/**
 * Resizes a *viewport-space* rect by dragging one of its corner handles by (dx, dy) screen
 * pixels. Handle names describe what the user sees (nw = top-left on screen), so the math is
 * done in viewport space and converted to PDF space once by the caller — which keeps it right
 * on rotated pages, where a screen corner is a different corner of the unrotated page.
 * `keepAspect` locks the width:height ratio (the opposite corner stays fixed); the rect never
 * shrinks below `minSize` on either side.
 */
export function resizeViewportRect(
  origin: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  opts: { keepAspect?: boolean; minSize?: number } = {}
): Rect {
  const min = opts.minSize ?? 8;
  const west = handle.includes("w");
  const north = handle.startsWith("n");
  let width = origin.width + (west ? -dx : dx);
  let height = origin.height + (north ? -dy : dy);
  if (opts.keepAspect && origin.width > 0 && origin.height > 0) {
    const sw = width / origin.width;
    const sh = height / origin.height;
    // Follow whichever axis the user dragged further from 1:1, so the box tracks the pointer.
    const s = Math.abs(sw - 1) >= Math.abs(sh - 1) ? sw : sh;
    const floor = Math.max(min / origin.width, min / origin.height);
    const scale = Math.max(s, floor);
    width = origin.width * scale;
    height = origin.height * scale;
  } else {
    width = Math.max(min, width);
    height = Math.max(min, height);
  }
  return {
    x: west ? origin.x + origin.width - width : origin.x,
    y: north ? origin.y + origin.height - height : origin.y,
    width,
    height,
  };
}
