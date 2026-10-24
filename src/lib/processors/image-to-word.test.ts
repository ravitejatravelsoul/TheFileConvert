import { describe, expect, it } from "vitest";
import { pageFor } from "./image-to-word";

describe("pageFor — where an image goes on its Word page", () => {
  const aspect = (a: { imageW: number; imageH: number }) => a.imageW / a.imageH;

  it("'fit' makes the page the image: same proportions, as large as fits Letter, no margin", () => {
    const p = pageFor(1700, 2200, "fit");
    expect(p).toMatchObject({ x: 0, y: 0 });
    expect(p.width).toBeCloseTo(p.imageW, 6);
    expect(p.height).toBeCloseTo(p.imageH, 6);
    expect(p.height).toBeCloseTo(792, 0);
    expect(aspect(p)).toBeCloseTo(1700 / 2200, 6);
  });

  it("turns a wide image sideways instead of shrinking it onto a portrait page", () => {
    const card = pageFor(1011, 638, "fit"); // an ID card
    expect(card.width).toBeGreaterThan(card.height);
    expect(card.width).toBeCloseTo(792, 0);
    expect(aspect(card)).toBeCloseTo(1011 / 638, 6);
  });

  it("keeps a tall screenshot and a tiny icon in proportion and in a usable size", () => {
    const tall = pageFor(1080, 2400, "fit");
    expect(tall.height).toBeCloseTo(792, 0);
    expect(aspect(tall)).toBeCloseTo(1080 / 2400, 6);
    const tiny = pageFor(64, 48, "fit");
    expect(tiny.width).toBeCloseTo(792, 0); // scaled to a sensible page, not a 48 pt sliver
    expect(aspect(tiny)).toBeCloseTo(64 / 48, 6);
  });

  it("A4 and Letter centre the image inside the margin, upright for portrait and sideways for wide images", () => {
    const a4 = pageFor(2000, 3000, "a4", 36);
    expect([Math.round(a4.width), Math.round(a4.height)]).toEqual([595, 842]);
    expect(a4.x).toBeGreaterThanOrEqual(36 - 1e-6);
    expect(a4.y).toBeGreaterThanOrEqual(36 - 1e-6);
    expect(a4.x + a4.imageW).toBeLessThanOrEqual(a4.width - 36 + 1e-6);
    expect(a4.y + a4.imageH).toBeLessThanOrEqual(a4.height - 36 + 1e-6);
    expect(a4.x).toBeCloseTo(a4.width - a4.x - a4.imageW, 6);
    const wide = pageFor(3000, 2000, "letter");
    expect([Math.round(wide.width), Math.round(wide.height)]).toEqual([792, 612]);
    expect(aspect(wide)).toBeCloseTo(1.5, 6);
  });

  it("never enlarges a small image past its 96 dpi size on A4/Letter", () => {
    const p = pageFor(200, 100, "letter");
    expect(p.imageW).toBeCloseTo(150, 6); // 200 px × 0.75
    expect(p.imageH).toBeCloseTo(75, 6);
  });

  it.each([
    [1200, 1800, "fit"],
    [1200, 1800, "a4"],
    [1920, 1080, "letter"],
    [500, 500, "fit"],
    [300, 4000, "a4"],
  ] as const)("%i × %i on %s stays inside its page, never clipped or stretched", (w, h, size) => {
    const p = pageFor(w, h, size);
    expect(aspect(p)).toBeCloseTo(w / h, 6);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + p.imageW).toBeLessThanOrEqual(p.width + 1e-6);
    expect(p.y + p.imageH).toBeLessThanOrEqual(p.height + 1e-6);
  });
});
