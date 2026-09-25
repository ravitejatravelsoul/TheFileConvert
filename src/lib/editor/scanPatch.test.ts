import { describe, expect, it } from "vitest";
import { computeFeatherPx, fitFontSizeToWidth, peakInkColor } from "./scanPatch";
import type { PixelSource } from "./regionColor";

describe("computeFeatherPx", () => {
  it("regression: a small-but-real margin (realistic, not-100%, OCR confidence) still produces a positive feather", () => {
    // Reproduces the actual bug: computeEditPadding's confidence factor (0.7-1) applied to a
    // typical digit-height box yields a margin around this size once converted to patch-canvas
    // px — the old `Math.floor(...)` version rounded this straight to 0, silently disabling
    // feathering and producing a hard, visibly pasted edge (the "visible flat patch" defect).
    const feather = computeFeatherPx(1.2, 1.2, 1.2, 1.2, 60, 60);
    expect(feather).toBeGreaterThan(0);
  });

  it("never exceeds a safe fraction of the patch's own size, even with a huge margin", () => {
    const feather = computeFeatherPx(500, 500, 500, 500, 40, 30);
    expect(feather).toBeLessThanOrEqual(30 * 0.4); // capped by the smaller dimension (height)
  });

  it("returns 0 when there's no margin at all (patch exactly matches the word box)", () => {
    expect(computeFeatherPx(0, 0, 0, 0, 60, 60)).toBe(0);
  });

  it("is bounded by the tightest of the four sides, not an average", () => {
    const feather = computeFeatherPx(10, 10, 10, 0.5, 100, 100);
    expect(feather).toBeCloseTo(0.7 * 0.5, 5);
  });
});

describe("peakInkColor", () => {
  const paper = { r: 0.95, g: 0.95, b: 0.93 };
  /** A 40x20 "scan": paper everywhere, a 30x10 block of anti-aliased ink whose solid core is dark. */
  function scan(coreGray: number, edgeGray: number): PixelSource {
    return {
      width: 40,
      height: 20,
      getPixel: (x, y) => {
        if (x >= 5 && x < 35 && y >= 5 && y < 15) {
          const edge = x === 5 || x === 34 || y === 5 || y === 14;
          const g = edge ? edgeGray : coreGray;
          return [g, g, g, 255];
        }
        return [242, 242, 237, 255];
      },
    };
  }

  it("returns the solid core ink color, not the lighter average dragged up by soft edges", () => {
    const peak = peakInkColor(scan(40, 150), { x: 0, y: 0, width: 40, height: 20 }, paper)!;
    expect(peak.r * 255).toBeLessThan(60);
  });

  it("returns null when there is too little ink to judge", () => {
    const blank: PixelSource = { width: 40, height: 20, getPixel: () => [242, 242, 237, 255] };
    expect(peakInkColor(blank, { x: 0, y: 0, width: 40, height: 20 }, paper)).toBeNull();
  });
});

describe("fitFontSizeToWidth", () => {
  // Text width proportional to size, like a real font: `perPt` px of width per point of size.
  const widthFor = (perPt: number) => (size: number) => size * perPt;

  it("leaves text that already fits unchanged", () => {
    expect(fitFontSizeToWidth(20, widthFor(5), 150)).toEqual({ size: 20, overflow: false });
  });

  it("shrinks to fit without flagging overflow when the legibility floor is enough", () => {
    const r = fitFontSizeToWidth(20, widthFor(5), 90); // needs 18pt (0.9x), floor is 0.72x
    expect(r.overflow).toBe(false);
    expect(r.size * 5).toBeLessThanOrEqual(90);
  });

  it("regression: text too wide even at the legibility floor is shrunk the rest of the way, never left to be clipped", () => {
    // A whole scanned line redrawn in a wider matched face needed well below the floor to fit; the
    // old code stopped at the floor, drew anyway, and the patch edge cut the last characters off.
    const widthAt = widthFor(10);
    const r = fitFontSizeToWidth(20, widthAt, 100); // needs 10pt (0.5x) — below the 0.72x floor
    expect(r.overflow).toBe(true);
    expect(widthAt(r.size)).toBeLessThanOrEqual(100);
  });

  it("still fits when measurement isn't perfectly proportional (hinting/rounding)", () => {
    const widthAt = (s: number) => Math.ceil(s * 10.3) + 1;
    const r = fitFontSizeToWidth(20, widthAt, 97);
    expect(widthAt(r.size)).toBeLessThanOrEqual(97);
  });
});
