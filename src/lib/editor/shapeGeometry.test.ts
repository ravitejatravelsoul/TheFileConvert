import { describe, expect, it } from "vitest";
import { startCornerForDrag, lineEndpoints, drawingPdfPoints, drawingExtents } from "./shapeGeometry";

describe("startCornerForDrag / lineEndpoints", () => {
  const box = { x: 100, y: 200, width: 50, height: 30 };

  it("a drag going up and to the right runs bottom-left → top-right (the historical default)", () => {
    const c = startCornerForDrag({ x: 100, y: 200 }, { x: 150, y: 230 });
    expect(c).toBe("bl");
    expect(lineEndpoints({ ...box, startCorner: c })).toEqual({ start: { x: 100, y: 200 }, end: { x: 150, y: 230 } });
  });

  it("a drag going down and to the right (on screen) keeps its own direction", () => {
    // PDF y is up: dragging from the top-left of the box to the bottom-right.
    const c = startCornerForDrag({ x: 100, y: 230 }, { x: 150, y: 200 });
    expect(c).toBe("tl");
    expect(lineEndpoints({ ...box, startCorner: c })).toEqual({ start: { x: 100, y: 230 }, end: { x: 150, y: 200 } });
  });

  it("supports drags to the left too (arrowhead direction depends on it)", () => {
    const c = startCornerForDrag({ x: 150, y: 230 }, { x: 100, y: 200 });
    expect(c).toBe("tr");
    expect(lineEndpoints({ ...box, startCorner: c })).toEqual({ start: { x: 150, y: 230 }, end: { x: 100, y: 200 } });
  });

  it("treats a shape saved without a start corner as bottom-left → top-right", () => {
    expect(lineEndpoints(box).start).toEqual({ x: 100, y: 200 });
  });
});

describe("drawingPdfPoints", () => {
  it("places points at the object's origin when the box matches the points' own extents", () => {
    const pts = drawingPdfPoints({ x: 10, y: 20, width: 40, height: 20, points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] });
    expect(pts).toEqual([{ x: 10, y: 20 }, { x: 50, y: 40 }]);
  });

  it("scales the stroke when the box is resized", () => {
    const pts = drawingPdfPoints({ x: 0, y: 0, width: 80, height: 10, points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] });
    expect(pts[1]).toEqual({ x: 80, y: 10 });
  });

  it("never divides by zero for a dot or a straight stroke", () => {
    expect(drawingExtents({ points: [{ x: 0, y: 0 }] })).toEqual({ w: 1, h: 1 });
    const pts = drawingPdfPoints({ x: 5, y: 5, width: 1, height: 1, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] });
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
