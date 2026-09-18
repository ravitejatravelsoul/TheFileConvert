import fs from "node:fs";
import { createCanvas, type Canvas } from "@napi-rs/canvas";

/** Minimal pdf.js CanvasFactory backed by @napi-rs/canvas — already an optional dependency
 * of pdfjs-dist itself (used for its own Node rendering support), so this adds no new
 * package. Lets tests actually rasterize an exported PDF page and inspect real pixels,
 * rather than only checking operator lists or extracted text. */
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(canvasAndContext: { canvas: Canvas }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: { canvas: Canvas }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

export interface RenderedPage {
  width: number;
  height: number;
  /** Returns [r,g,b,a] (0-255) at the given pixel coordinate. Reads the whole canvas once
   * and caches it, so repeated calls (e.g. from a full-page pixel diff) are cheap. */
  getPixel(x: number, y: number): [number, number, number, number];
  /** Saves the rendered page as a PNG file, for debugging a failing assertion. */
  savePng(path: string): void;
}

export async function renderPdfPage(bytes: Uint8Array | Buffer, pageNumber: number, scale = 2): Promise<RenderedPage> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const factory = new NodeCanvasFactory();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    // pdfjs-dist's Node canvas support isn't reflected in its DOM-oriented public types.
    canvasFactory: factory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const { canvas, context } = factory.create(viewport.width, viewport.height);
  await page.render({
    canvasContext: context,
    viewport,
    canvasFactory: factory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).promise;

  const w = Math.ceil(viewport.width);
  const h = Math.ceil(viewport.height);
  const full = context.getImageData(0, 0, w, h);

  return {
    width: viewport.width,
    height: viewport.height,
    getPixel(x: number, y: number) {
      const cx = Math.max(0, Math.min(w - 1, Math.round(x)));
      const cy = Math.max(0, Math.min(h - 1, Math.round(y)));
      const i = (cy * w + cx) * 4;
      return [full.data[i], full.data[i + 1], full.data[i + 2], full.data[i + 3]];
    },
    savePng(path: string) {
      fs.writeFileSync(path, canvas.toBuffer("image/png"));
    },
  };
}

/** True if a pixel is close to white/blank (background), within a tolerance. */
export function isBlank([r, g, b, a]: [number, number, number, number], tolerance = 10): boolean {
  return a < 10 || (r > 255 - tolerance && g > 255 - tolerance && b > 255 - tolerance);
}

export interface PixelRectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CollateralChangeResult {
  /** Pixels whose color differs by more than `tolerance` between the two renders. */
  changedPixelCount: number;
  /** Of those, how many fall *outside* every allowed region — the exact defect this
   * guards against: an edit that visibly disturbs unrelated parts of the page. */
  changedOutsidePixelCount: number;
  totalPixels: number;
  /** A representative sample of a handful of offending (x,y) points, for debugging. */
  offendingSamples: { x: number; y: number }[];
}

/** The core "no collateral change" check: renders of the same page before/after an edit
 * should be pixel-identical everywhere except inside the caller-supplied allowed region(s)
 * (the edit's own patch, already expanded with whatever padding/margin the caller wants).
 * Fails loudly (via the returned counts) if content *outside* those regions moved, which is
 * exactly the defect being guarded against: OCR edits that wipe/rebuild far more of the
 * page than the one word being changed. */
export function findCollateralChanges(
  before: RenderedPage,
  after: RenderedPage,
  allowedRegionsPx: PixelRectPx[],
  tolerance = 24
): CollateralChangeResult {
  const width = Math.min(before.width, after.width);
  const height = Math.min(before.height, after.height);
  let changedPixelCount = 0;
  let changedOutsidePixelCount = 0;
  const offendingSamples: { x: number; y: number }[] = [];

  const inAllowedRegion = (x: number, y: number) =>
    allowedRegionsPx.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);

  // Sampling stride keeps this fast for large pages while still catching any sizeable
  // collateral change; the intended edit region is checked with full density separately by
  // the caller via getPixel, so a coarse stride outside it is enough to catch a problem.
  const stride = width * height > 400_000 ? 2 : 1;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const b = before.getPixel(x, y);
      const a = after.getPixel(x, y);
      const dist = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]) + Math.abs(b[3] - a[3]);
      if (dist <= tolerance) continue;
      changedPixelCount++;
      if (!inAllowedRegion(x, y)) {
        changedOutsidePixelCount++;
        if (offendingSamples.length < 10) offendingSamples.push({ x, y });
      }
    }
  }

  return { changedPixelCount, changedOutsidePixelCount, totalPixels: width * height, offendingSamples };
}

export interface RegionStyleStats {
  /** Fraction of sampled pixels that are meaningfully darker/lighter than the background
   * guess — a crude proxy for how "heavy" the text reads overall. */
  inkDensity: number;
  /** Average horizontal run-length (in rendered px) of consecutive ink pixels per scanned
   * row — a simple, fast proxy for stroke thickness (not true font metrics, just "does this
   * look like similarly-weighted strokes"). */
  avgStrokeWidthPx: number;
  /** Fraction of foreground-adjacent pixels that are a soft partial shade between background
   * and full ink (anti-aliasing) rather than a hard on/off edge — higher means softer/more
   * scan-like edges. */
  edgeSoftness: number;
}

/**
 * Cheap, local (no ML) style-similarity metrics for a rendered region — the "does the
 * replacement actually look integrated" half of the quality bar (spec section 19B),
 * complementing findCollateralChanges' "did it stay localized" half. Compares a region
 * against a caller-supplied background-color guess (sampled by the caller from a corner of
 * the same region, so it works regardless of the page's own background color).
 */
export function measureRegionStyle(rendered: RenderedPage, rectPx: PixelRectPx, background: [number, number, number]): RegionStyleStats {
  const x0 = Math.max(0, Math.round(rectPx.x));
  const y0 = Math.max(0, Math.round(rectPx.y));
  const x1 = Math.min(rendered.width, Math.round(rectPx.x + rectPx.width));
  const y1 = Math.min(rendered.height, Math.round(rectPx.y + rectPx.height));

  const INK_T = 60; // Euclidean-ish (sum of abs channel diffs) distance counted as "ink"
  const PARTIAL_LO = 20;

  let inkCount = 0;
  let partialCount = 0;
  let total = 0;
  let strokeRunSum = 0;
  let strokeRunCount = 0;

  for (let y = y0; y < y1; y++) {
    let runLength = 0;
    for (let x = x0; x < x1; x++) {
      const [r, g, b] = rendered.getPixel(x, y);
      const dist = Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]);
      total++;
      const isInk = dist >= INK_T;
      const isPartial = dist >= PARTIAL_LO && dist < INK_T;
      if (isInk) {
        inkCount++;
        runLength++;
      } else {
        if (runLength > 0) {
          strokeRunSum += runLength;
          strokeRunCount++;
        }
        runLength = 0;
      }
      if (isPartial) partialCount++;
    }
    if (runLength > 0) {
      strokeRunSum += runLength;
      strokeRunCount++;
    }
  }

  return {
    inkDensity: total > 0 ? inkCount / total : 0,
    avgStrokeWidthPx: strokeRunCount > 0 ? strokeRunSum / strokeRunCount : 0,
    edgeSoftness: inkCount + partialCount > 0 ? partialCount / (inkCount + partialCount) : 0,
  };
}
