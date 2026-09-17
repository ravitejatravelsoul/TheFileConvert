import { describe, expect, it } from "vitest";
import {
  buildViewportTransform,
  viewportDimensions,
  pdfToViewportPoint,
  viewportToPdfPoint,
  pdfRectToViewport,
  viewportRectToPdf,
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
