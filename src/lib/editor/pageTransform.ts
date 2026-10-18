/**
 * The one coordinate service of the editor.
 *
 * Everything that has to relate the PDF to the screen goes through a PageTransform: PDF points (y up, the page's own
 * unrotated space), the page's visible box (MediaBox ∩ CropBox), its display rotation, the zoom, the device pixel ratio, and
 * the position of the page element on screen (scroll included, because it is measured from the element, not assumed).
 * No tool does its own coordinate arithmetic; this wraps the affine layer in `coordinates.ts` (which has its own tests).
 */
import {
  buildViewportTransform,
  applyMatrix,
  invertMatrix,
  pdfRectToViewport,
  viewportRectToPdf,
  viewportDimensions,
  type Point,
  type Rect,
  type Rotation,
  type ViewportSpec,
} from "./coordinates";
import { EDITOR_BASE_SCALE, effectiveRotation, type EditorPage } from "./types";

export class PageTransform {
  readonly spec: ViewportSpec;
  readonly zoom: number;
  readonly dpr: number;
  private readonly forward;
  private readonly backward;

  constructor(spec: ViewportSpec, zoom: number, dpr = 1) {
    this.spec = spec;
    this.zoom = zoom;
    this.dpr = dpr;
    this.forward = buildViewportTransform(spec);
    this.backward = invertMatrix(this.forward);
  }

  /** CSS pixels per PDF point. */
  get scale(): number {
    return this.spec.scale;
  }

  get rotation(): Rotation {
    return this.spec.rotation;
  }

  /** The visible page box in PDF space: [xMin, yMin, xMax, yMax]. */
  get box(): [number, number, number, number] {
    return this.spec.viewBox;
  }

  /** Size of the rendered page in CSS pixels. */
  get size(): { width: number; height: number } {
    return viewportDimensions(this.spec);
  }

  /** Size of the backing canvas in device pixels. */
  get canvasSize(): { width: number; height: number } {
    const s = this.size;
    return { width: Math.ceil(s.width * this.dpr), height: Math.ceil(s.height * this.dpr) };
  }

  pdfToCss(p: Point): Point {
    return applyMatrix(this.forward, p);
  }

  cssToPdf(p: Point): Point {
    return applyMatrix(this.backward, p);
  }

  rectToCss(r: Rect): Rect {
    return pdfRectToViewport(this.spec, r);
  }

  rectToPdf(r: Rect): Rect {
    return viewportRectToPdf(this.spec, r);
  }

  /** A pointer position in the page's PDF space. `host` is the page element's bounding rect (measured at the event, so scroll
   * and zoom are always current). */
  clientToPdf(clientX: number, clientY: number, host: { left: number; top: number }): Point {
    return this.cssToPdf({ x: clientX - host.left, y: clientY - host.top });
  }

  /** A length in PDF points as CSS pixels on screen. */
  cssLength(points: number): number {
    return points * this.scale;
  }

  /** The angle (radians, clockwise on screen) a PDF-space direction `(dx, dy)` points to, once the page is shown. */
  screenAngle(dx: number, dy: number): number {
    const a = this.pdfToCss({ x: 0, y: 0 });
    const b = this.pdfToCss({ x: dx, y: dy });
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
}

/** The transform for an editor page at a zoom and pixel ratio. */
export function pageTransformFor(page: EditorPage, zoom: number, dpr = 1): PageTransform {
  return new PageTransform({ viewBox: page.mediaBox, scale: EDITOR_BASE_SCALE * zoom, rotation: effectiveRotation(page) }, zoom, dpr);
}
