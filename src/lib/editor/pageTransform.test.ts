import { describe, expect, it } from "vitest";
import { PageTransform } from "./pageTransform";

const upright = (rotation: 0 | 90 | 180 | 270, box: [number, number, number, number] = [0, 0, 612, 792]) => new PageTransform({ viewBox: box, scale: 1.3, rotation }, 1, 2);

describe("PageTransform", () => {
  it("is its own inverse at every rotation, zoom and box (including a non-zero origin)", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      for (const box of [[0, 0, 612, 792], [60, 90, 640, 760], [-20, -30, 300, 500]] as [number, number, number, number][]) {
        const t = upright(rot, box);
        for (const p of [{ x: box[0], y: box[1] }, { x: box[2], y: box[3] }, { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 }, { x: box[0] + 17.5, y: box[3] - 3.25 }]) {
          const back = t.cssToPdf(t.pdfToCss(p));
          expect(back.x).toBeCloseTo(p.x, 6);
          expect(back.y).toBeCloseTo(p.y, 6);
        }
      }
    }
  });

  it("puts the bottom-left of an upright page at the bottom-left of the screen rect", () => {
    const t = upright(0);
    expect(t.pdfToCss({ x: 0, y: 0 })).toEqual({ x: 0, y: 792 * 1.3 });
    expect(t.pdfToCss({ x: 612, y: 792 })).toEqual({ x: 612 * 1.3, y: 0 });
  });

  it("swaps the shown size on a quarter turn, and sizes the canvas in device pixels", () => {
    const t = upright(90);
    expect(t.size.width).toBeCloseTo(792 * 1.3, 6);
    expect(t.size.height).toBeCloseTo(612 * 1.3, 6);
    expect(t.canvasSize.width).toBe(Math.ceil(792 * 1.3 * 2));
  });

  it("converts a pointer position using the page element's current position (scroll included)", () => {
    const t = upright(0);
    const p = t.clientToPdf(300, 400, { left: 100, top: -50 }); // the page is scrolled 50 px up and sits 100 px from the left
    expect(p.x).toBeCloseTo(200 / 1.3, 6);
    expect(p.y).toBeCloseTo(792 - 450 / 1.3, 6);
  });

  it("round-trips rectangles on a rotated page", () => {
    const t = upright(270, [0, 0, 612, 792]);
    const r = { x: 100, y: 200, width: 50, height: 30 };
    const back = t.rectToPdf(t.rectToCss(r));
    expect(back.x).toBeCloseTo(r.x, 6);
    expect(back.y).toBeCloseTo(r.y, 6);
    expect(back.width).toBeCloseTo(r.width, 6);
    expect(back.height).toBeCloseTo(r.height, 6);
  });

  it("knows which way a baseline points on screen once the page is turned", () => {
    expect(upright(0).screenAngle(1, 0)).toBeCloseTo(0, 6);
    expect(Math.abs(upright(180).screenAngle(1, 0))).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(upright(90).screenAngle(1, 0))).toBeCloseTo(Math.PI / 2, 6);
  });
});
