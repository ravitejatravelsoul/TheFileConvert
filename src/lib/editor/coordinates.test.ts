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

describe("rectToCssStyle / pdfRectToCssStyle", () => {
  it("maps x/y to left/top (a Rect spread into `style` would silently lose its position)", async () => {
    const { rectToCssStyle } = await import("./coordinates");
    expect(rectToCssStyle({ x: 12, y: 34, width: 56, height: 78 })).toEqual({ left: 12, top: 34, width: 56, height: 78 });
  });

  it("positions a PDF rect at the same place pdfRectToViewport puts it, at any rotation", async () => {
    const { pdfRectToCssStyle, pdfRectToViewport } = await import("./coordinates");
    for (const rotation of [0, 90, 180, 270] as const) {
      const spec = { viewBox: [0, 0, 200, 300] as [number, number, number, number], scale: 1.5, rotation };
      const rect = { x: 20, y: 30, width: 50, height: 40 };
      const v = pdfRectToViewport(spec, rect);
      expect(pdfRectToCssStyle(spec, rect)).toEqual({ left: v.x, top: v.y, width: v.width, height: v.height });
    }
  });
});

describe("resizeViewportRect", () => {
  const origin = { x: 100, y: 100, width: 200, height: 100 };

  it("se handle grows right/down and keeps the top-left fixed", async () => {
    const { resizeViewportRect } = await import("./coordinates");
    expect(resizeViewportRect(origin, "se", 30, 10)).toEqual({ x: 100, y: 100, width: 230, height: 110 });
  });

  it("nw handle moves the top-left and keeps the bottom-right fixed", async () => {
    const { resizeViewportRect } = await import("./coordinates");
    const r = resizeViewportRect(origin, "nw", -20, -10);
    expect(r).toEqual({ x: 80, y: 90, width: 220, height: 110 });
    expect(r.x + r.width).toBe(300);
    expect(r.y + r.height).toBe(200);
  });

  it("never shrinks below the minimum size", async () => {
    const { resizeViewportRect } = await import("./coordinates");
    const r = resizeViewportRect(origin, "se", -500, -500, { minSize: 8 });
    expect(r.width).toBe(8);
    expect(r.height).toBe(8);
  });

  it("keeps the aspect ratio when asked, following the axis dragged further", async () => {
    const { resizeViewportRect } = await import("./coordinates");
    const r = resizeViewportRect(origin, "se", 100, 5, { keepAspect: true }); // width 1.5x, height 1.05x
    expect(r.width / r.height).toBeCloseTo(2, 6);
    expect(r.width).toBeCloseTo(300, 6);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
  });

  it("keeps the opposite corner fixed for an aspect-locked nw drag", async () => {
    const { resizeViewportRect } = await import("./coordinates");
    const r = resizeViewportRect(origin, "nw", -100, 0, { keepAspect: true });
    expect(r.x + r.width).toBeCloseTo(300, 6);
    expect(r.y + r.height).toBeCloseTo(200, 6);
    expect(r.width / r.height).toBeCloseTo(2, 6);
  });
});

describe("clampRectToBox", () => {
  it("leaves a rect that's inside the box alone and trims one that hangs over an edge", async () => {
    const { clampRectToBox } = await import("./coordinates");
    const box: [number, number, number, number] = [0, 0, 300, 400];
    expect(clampRectToBox({ x: 10, y: 20, width: 30, height: 40 }, box)).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(clampRectToBox({ x: -20, y: 380, width: 100, height: 100 }, box)).toEqual({ x: 0, y: 380, width: 80, height: 20 });
    expect(clampRectToBox({ x: 400, y: 500, width: 50, height: 50 }, box).width).toBe(0);
  });
});
