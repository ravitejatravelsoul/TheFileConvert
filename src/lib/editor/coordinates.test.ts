import { describe, expect, it } from "vitest";
import {
  buildViewportTransform,
  viewportDimensions,
  pdfToViewportPoint,
  viewportToPdfPoint,
  pdfRectToViewport,
  viewportRectToPdf,
  computeFitZoom,
  MIN_FIT_ZOOM,
  type ViewportSpec,
} from "./coordinates";

// This module intentionally mirrors pdf.js's internal `PageViewport` transform math
// (that class isn't part of pdf.js's public API, so we can't import and delegate to it
// directly). Correctness here is verified two ways: round-trip properties (which hold
// for *any* correct invertible transform, regardless of the exact formula) and a set of
// hand-derived corner mappings for each rotation, worked out independently in the
// module's own comments/PR description rather than copied from pdf.js's test suite.

const LETTER: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 1, rotation: 0 };

describe("round-trip: viewportToPdfPoint(pdfToViewportPoint(p)) === p", () => {
  const specs: ViewportSpec[] = [
    { viewBox: [0, 0, 612, 792], scale: 1, rotation: 0 },
    { viewBox: [0, 0, 612, 792], scale: 2, rotation: 90 },
    { viewBox: [0, 0, 612, 792], scale: 1.5, rotation: 180 },
    { viewBox: [0, 0, 612, 792], scale: 0.75, rotation: 270 },
    { viewBox: [36, 50, 400, 700], scale: 3, rotation: 90 }, // non-zero viewBox origin
  ];
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 200 },
    { x: 612, y: 792 },
    { x: 305.5, y: 400.25 },
  ];

  for (const spec of specs) {
    for (const p of points) {
      it(`rotation=${spec.rotation} scale=${spec.scale} point=(${p.x},${p.y})`, () => {
        const viewportPoint = pdfToViewportPoint(spec, p);
        const roundTripped = viewportToPdfPoint(spec, viewportPoint);
        expect(roundTripped.x).toBeCloseTo(p.x, 6);
        expect(roundTripped.y).toBeCloseTo(p.y, 6);
      });
    }
  }
});

describe("round-trip: pdfRectToViewport / viewportRectToPdf", () => {
  it("recovers the original rect for every rotation", () => {
    const rect = { x: 50, y: 100, width: 200, height: 80 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const spec: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 2, rotation };
      const viewportRect = pdfRectToViewport(spec, rect);
      const back = viewportRectToPdf(spec, viewportRect);
      expect(back.x).toBeCloseTo(rect.x, 6);
      expect(back.y).toBeCloseTo(rect.y, 6);
      expect(back.width).toBeCloseTo(rect.width, 6);
      expect(back.height).toBeCloseTo(rect.height, 6);
    }
  });
});

describe("rotation=0: known corner mapping (hand-derived)", () => {
  // At rotation 0, scale 1: vx = x - x0 ; vy = y1 - y (PDF y-up -> canvas y-down flip).
  it("maps the PDF page's top-left corner to the viewport's origin", () => {
    const p = pdfToViewportPoint(LETTER, { x: 0, y: 792 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("maps the PDF page's bottom-left corner to the viewport's bottom-left", () => {
    const p = pdfToViewportPoint(LETTER, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(792, 6);
  });

  it("maps the PDF page's bottom-right corner to the viewport's bottom-right", () => {
    const p = pdfToViewportPoint(LETTER, { x: 612, y: 0 });
    expect(p.x).toBeCloseTo(612, 6);
    expect(p.y).toBeCloseTo(792, 6);
  });
});

describe("rotation=90 (clockwise): known corner mapping (hand-derived)", () => {
  // Rotating the *view* 90 degrees clockwise means content that was on the PDF page's
  // left edge now appears along the canvas's top edge.
  const spec: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 1, rotation: 90 };

  it("maps the PDF page's bottom-left corner to the viewport's top-left", () => {
    const p = pdfToViewportPoint(spec, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("maps the PDF page's top-left corner to the viewport's top-right", () => {
    const p = pdfToViewportPoint(spec, { x: 0, y: 792 });
    expect(p.x).toBeCloseTo(792, 6); // viewport width after a 90/270 swap
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe("rotation=180: known corner mapping (hand-derived)", () => {
  // 180 degrees mirrors both axes relative to rotation 0.
  const spec: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 1, rotation: 180 };

  it("maps the PDF page's bottom-left corner to the viewport's top-right", () => {
    const p = pdfToViewportPoint(spec, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(612, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("maps the PDF page's top-right corner to the viewport's bottom-left", () => {
    const p = pdfToViewportPoint(spec, { x: 612, y: 792 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(792, 6);
  });
});

describe("viewportDimensions", () => {
  it("keeps width/height for rotation 0 and 180", () => {
    expect(viewportDimensions({ viewBox: [0, 0, 612, 792], scale: 1, rotation: 0 })).toEqual({
      width: 612,
      height: 792,
    });
    expect(viewportDimensions({ viewBox: [0, 0, 612, 792], scale: 1, rotation: 180 })).toEqual({
      width: 612,
      height: 792,
    });
  });

  it("swaps width/height for rotation 90 and 270", () => {
    expect(viewportDimensions({ viewBox: [0, 0, 612, 792], scale: 1, rotation: 90 })).toEqual({
      width: 792,
      height: 612,
    });
    expect(viewportDimensions({ viewBox: [0, 0, 612, 792], scale: 1, rotation: 270 })).toEqual({
      width: 792,
      height: 612,
    });
  });

  it("scales linearly", () => {
    expect(viewportDimensions({ viewBox: [0, 0, 612, 792], scale: 2, rotation: 0 })).toEqual({
      width: 1224,
      height: 1584,
    });
  });
});

describe("buildViewportTransform", () => {
  it("throws on a non-90-degree-multiple rotation", () => {
    expect(() => buildViewportTransform({ viewBox: [0, 0, 100, 100], scale: 1, rotation: 45 as never })).toThrow();
  });
});

describe("computeFitZoom", () => {
  it("fit-width: scales so the page's rendered width exactly fills the available width", () => {
    // Letter page at EDITOR_BASE_SCALE=1.3 (612 * 1.3 = 795.6px at zoom 1).
    const pageDimsAtZoom1 = { width: 795.6, height: 1029.6 };
    const zoom = computeFitZoom("fit-width", { width: 1000, height: 5000 }, pageDimsAtZoom1);
    expect(zoom).toBeCloseTo(1000 / 795.6, 10);
    expect(pageDimsAtZoom1.width * zoom).toBeCloseTo(1000, 6);
  });

  it("fit-width ignores available height", () => {
    const pageDimsAtZoom1 = { width: 800, height: 1000 };
    const tall = computeFitZoom("fit-width", { width: 400, height: 100 }, pageDimsAtZoom1);
    const short = computeFitZoom("fit-width", { width: 400, height: 5000 }, pageDimsAtZoom1);
    expect(tall).toBeCloseTo(short, 10);
  });

  it("fit-page: picks the smaller of width-fit and height-fit so the whole page is visible", () => {
    const pageDimsAtZoom1 = { width: 800, height: 1000 };
    // Width is the binding constraint here (800 vs available 400 is tighter than 1000 vs 900).
    const zoom = computeFitZoom("fit-page", { width: 400, height: 900 }, pageDimsAtZoom1);
    expect(zoom).toBeCloseTo(400 / 800, 10);
    expect(pageDimsAtZoom1.width * zoom).toBeLessThanOrEqual(400 + 1e-9);
    expect(pageDimsAtZoom1.height * zoom).toBeLessThanOrEqual(900 + 1e-9);
  });

  it("fit-page: picks height as the binding constraint when it's tighter", () => {
    const pageDimsAtZoom1 = { width: 800, height: 1000 };
    const zoom = computeFitZoom("fit-page", { width: 2000, height: 300 }, pageDimsAtZoom1);
    expect(zoom).toBeCloseTo(300 / 1000, 10);
  });

  it("clamps to MIN_FIT_ZOOM instead of collapsing to (near) zero for a tiny container", () => {
    const pageDimsAtZoom1 = { width: 800, height: 1000 };
    const zoom = computeFitZoom("fit-width", { width: 1, height: 1 }, pageDimsAtZoom1);
    expect(zoom).toBe(MIN_FIT_ZOOM);
  });

  it("is consistent with viewportDimensions: fitting then measuring reproduces the target size", () => {
    const spec1: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 1.3, rotation: 0 };
    const dimsAtZoom1 = viewportDimensions(spec1);
    const available = { width: 640, height: 480 };
    const zoom = computeFitZoom("fit-page", available, dimsAtZoom1);
    const fitted = viewportDimensions({ ...spec1, scale: spec1.scale * zoom });
    expect(fitted.width).toBeLessThanOrEqual(available.width + 1e-6);
    expect(fitted.height).toBeLessThanOrEqual(available.height + 1e-6);
    // At least one dimension should exactly hit its bound (that's what "fit" means).
    const hitsWidth = Math.abs(fitted.width - available.width) < 1e-6;
    const hitsHeight = Math.abs(fitted.height - available.height) < 1e-6;
    expect(hitsWidth || hitsHeight).toBe(true);
  });

  it("stays consistent under rotation: a 90deg-rotated page fits by its swapped dimensions", () => {
    const spec0: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 1.3, rotation: 0 };
    const spec90: ViewportSpec = { ...spec0, rotation: 90 };
    const dims0 = viewportDimensions(spec0);
    const dims90 = viewportDimensions(spec90);
    expect(dims90).toEqual({ width: dims0.height, height: dims0.width });

    const available = { width: 640, height: 480 };
    const zoom0 = computeFitZoom("fit-width", available, dims0);
    const zoom90 = computeFitZoom("fit-width", available, dims90);
    // Fitting the rotated page's (swapped) width should behave like fitting the
    // unrotated page's height, since that's now the "width" dimension on screen.
    expect(zoom90).toBeCloseTo(available.width / dims0.height, 10);
    expect(zoom0).toBeCloseTo(available.width / dims0.width, 10);
  });

  it("verifying a known PDF point still lands at the fitted edge after a zoom-mode change (overlay alignment)", () => {
    const spec1: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 1.3, rotation: 0 };
    const dimsAtZoom1 = viewportDimensions(spec1);
    const available = { width: 500, height: 500 };
    const zoom = computeFitZoom("fit-page", available, dimsAtZoom1);
    const fittedSpec: ViewportSpec = { ...spec1, scale: spec1.scale * zoom };

    // The page's top-right PDF corner must still map to the fitted viewport's top-right
    // corner — i.e. an object overlay anchored at a PDF point stays visually aligned with
    // the page edge after switching zoom modes, not just "some scale was applied".
    const topRightPdf = { x: spec1.viewBox[2], y: spec1.viewBox[3] };
    const topRightViewport = pdfToViewportPoint(fittedSpec, topRightPdf);
    const fittedDims = viewportDimensions(fittedSpec);
    expect(topRightViewport.x).toBeCloseTo(fittedDims.width, 6);
    expect(topRightViewport.y).toBeCloseTo(0, 6);
  });
});
