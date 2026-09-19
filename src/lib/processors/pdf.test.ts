import { describe, expect, it } from "vitest";
import { parsePageRanges, ProcessorError, watermarkOrigin } from "./pdf";

describe("parsePageRanges", () => {
  it("parses a single page", () => {
    expect(parsePageRanges("3", 10)).toEqual([2]);
  });

  it("parses a range", () => {
    expect(parsePageRanges("2-4", 10)).toEqual([1, 2, 3]);
  });

  it("parses a mix of pages and ranges, sorted and deduped", () => {
    expect(parsePageRanges("5, 1-3, 3", 10)).toEqual([0, 1, 2, 4]);
  });

  it("swaps a reversed range", () => {
    expect(parsePageRanges("4-2", 10)).toEqual([1, 2, 3]);
  });

  it("ignores out-of-bounds page numbers", () => {
    expect(parsePageRanges("1, 99", 10)).toEqual([0]);
  });

  it("throws on empty input", () => {
    expect(() => parsePageRanges("", 10)).toThrow(ProcessorError);
  });

  it("throws on unparseable tokens", () => {
    expect(() => parsePageRanges("abc", 10)).toThrow(ProcessorError);
  });

  it("throws when nothing in range exists in the document", () => {
    expect(() => parsePageRanges("50-60", 10)).toThrow(ProcessorError);
  });
});

describe("watermarkOrigin", () => {
  // Where the text's center ends up, given the origin and rotation.
  function centerOf(o: { x: number; y: number }, textWidth: number, size: number, deg: number) {
    const t = (deg * Math.PI) / 180;
    const halfW = textWidth / 2;
    const halfH = size * 0.35;
    return { x: o.x + halfW * Math.cos(t) - halfH * Math.sin(t), y: o.y + halfW * Math.sin(t) + halfH * Math.cos(t) };
  }

  it("keeps the rotated watermark centered on the page at every angle", () => {
    for (const deg of [0, 45, -45, 90, 180, 270]) {
      const o = watermarkOrigin(600, 800, 240, 48, deg);
      const c = centerOf(o, 240, 48, deg);
      expect(c.x).toBeCloseTo(300, 6);
      expect(c.y).toBeCloseTo(400, 6);
    }
  });

  it("matches the old (horizontal) placement closely at 0 degrees", () => {
    const o = watermarkOrigin(600, 800, 240, 48, 0);
    expect(o.x).toBeCloseTo(300 - 120, 6);
  });
});
