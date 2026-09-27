import { describe, expect, it } from "vitest";
import { contentFrame, withContentHeight } from "./contentFrame";
import { buildViewportTransform, applyMatrix, pdfRectToViewport, type ViewportSpec } from "./coordinates";

const box = { x: 100, y: 200, width: 40, height: 160 };

describe("contentFrame", () => {
  it("rotation 0 is the box itself", () => {
    const f = contentFrame(box, 0);
    expect([f.width, f.height]).toEqual([40, 160]);
    expect(f.toPdf(0, 0)).toEqual({ x: 100, y: 200 });
    expect(f.rectToPdf(0, 0, f.width, f.height)).toEqual(box);
  });

  it.each([90, 180, 270])("rotation %i: the content's full frame covers exactly the box", (r) => {
    const f = contentFrame(box, r);
    expect(f.rectToPdf(0, 0, f.width, f.height)).toEqual(box);
    if (r !== 180) expect([f.width, f.height]).toEqual([160, 40]);
  });

  it.each([90, 180, 270] as const)("content drawn with rotation %i reads upright on a page shown at that rotation", (r) => {
    // A page 612×792 shown rotated by r. The content's +u axis (reading direction) must point right
    // on screen and its +v axis (up) must point up on screen (screen y grows downward).
    const spec: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 1, rotation: r };
    const m = buildViewportTransform(spec);
    const f = contentFrame(box, r);
    const o = applyMatrix(m, f.toPdf(0, 0));
    const u = applyMatrix(m, f.toPdf(10, 0));
    const v = applyMatrix(m, f.toPdf(0, 10));
    expect(u.x - o.x).toBeCloseTo(10);
    expect(u.y - o.y).toBeCloseTo(0);
    expect(v.x - o.x).toBeCloseTo(0);
    expect(v.y - o.y).toBeCloseTo(-10);
    // …and the on-screen box has the content's own proportions.
    const screen = pdfRectToViewport(spec, box);
    expect([screen.width, screen.height].map(Math.round)).toEqual([f.width, f.height].map(Math.round));
  });
});

describe("withContentHeight", () => {
  it.each([0, 90, 180, 270] as const)("rotation %i: growing the text keeps its top edge fixed on screen", (r) => {
    const spec: ViewportSpec = { viewBox: [0, 0, 612, 792], scale: 1, rotation: r };
    const before = pdfRectToViewport(spec, box);
    const grown = { ...box, ...withContentHeight(box, r, contentFrame(box, r).height + 30) };
    const after = pdfRectToViewport(spec, grown);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.height).toBeCloseTo(before.height + 30);
  });
});
