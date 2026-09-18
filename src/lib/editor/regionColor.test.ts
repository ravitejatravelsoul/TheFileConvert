import { describe, expect, it } from "vitest";
import {
  estimateRegionColors,
  computeEditPadding,
  computeInkMask,
  findTextureDonorRect,
  detectProtectedLines,
  type PixelSource,
} from "./regionColor";

/** A simple in-memory RGBA grid implementing PixelSource, for fully deterministic tests
 * without needing a real browser canvas. */
class FakeCanvas implements PixelSource {
  width: number;
  height: number;
  private data: Uint8ClampedArray;

  constructor(width: number, height: number, fill: [number, number, number, number]) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.data.set(fill, i * 4);
    }
  }

  setPixel(x: number, y: number, rgba: [number, number, number, number]) {
    const cx = Math.max(0, Math.min(this.width - 1, x));
    const cy = Math.max(0, Math.min(this.height - 1, y));
    this.data.set(rgba, (cy * this.width + cx) * 4);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) this.setPixel(x, y, rgba);
    }
  }

  getPixel(x: number, y: number): [number, number, number, number] {
    const cx = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    const i = (cy * this.width + cx) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK_INK: [number, number, number, number] = [10, 10, 10, 255];

describe("estimateRegionColors: A. black text on white background", () => {
  it("estimates a white background and black-ish text, and does not flag it complex", () => {
    const canvas = new FakeCanvas(100, 60, WHITE);
    // A word bbox roughly in the middle, with some "ink" pixels inside it.
    canvas.fillRect(40, 20, 55, 35, BLACK_INK);
    const result = estimateRegionColors(canvas, { x: 38, y: 18, width: 20, height: 20 }, 4);
    expect(result.complex).toBe(false);
    expect(result.backgroundColor.r).toBeGreaterThan(0.9);
    expect(result.backgroundColor.g).toBeGreaterThan(0.9);
    expect(result.backgroundColor.b).toBeGreaterThan(0.9);
    expect(result.textColor.r).toBeLessThan(0.3);
  });
});

describe("estimateRegionColors: B. black text on uniform gray scan background", () => {
  it("estimates a gray background (not white) and does not flag it complex", () => {
    const gray: [number, number, number, number] = [214, 214, 210, 255]; // typical scanned-paper gray
    const canvas = new FakeCanvas(100, 60, gray);
    canvas.fillRect(40, 20, 55, 35, BLACK_INK);
    const result = estimateRegionColors(canvas, { x: 38, y: 18, width: 20, height: 20 }, 4);
    expect(result.complex).toBe(false);
    // Background should track the gray, not collapse to white.
    expect(result.backgroundColor.r).toBeGreaterThan(0.75);
    expect(result.backgroundColor.r).toBeLessThan(0.9);
  });
});

describe("estimateRegionColors: C. colored form background", () => {
  it("estimates a colored (e.g. pale blue) background", () => {
    const paleBlue: [number, number, number, number] = [225, 235, 250, 255];
    const canvas = new FakeCanvas(100, 60, paleBlue);
    canvas.fillRect(40, 20, 55, 35, [20, 20, 90, 255]);
    const result = estimateRegionColors(canvas, { x: 38, y: 18, width: 20, height: 20 }, 4);
    expect(result.complex).toBe(false);
    expect(result.backgroundColor.b).toBeGreaterThan(result.backgroundColor.r);
  });
});

describe("estimateRegionColors: D. table cell border line running through the sample ring", () => {
  it("flags the background as complex rather than reconstructing a flat patch", () => {
    const canvas = new FakeCanvas(100, 60, WHITE);
    canvas.fillRect(40, 20, 55, 35, BLACK_INK); // the word itself
    canvas.fillRect(0, 15, 99, 16, [0, 0, 0, 255]); // a horizontal ruling line crossing the padding ring
    const result = estimateRegionColors(canvas, { x: 38, y: 18, width: 20, height: 20 }, 6);
    expect(result.complex).toBe(true);
  });
});

describe("estimateRegionColors: low-ink word (very light/faint text)", () => {
  it("falls back to a default text color instead of picking up noise as text", () => {
    const canvas = new FakeCanvas(100, 60, WHITE);
    // No real ink drawn — the "word" region is basically blank (e.g. a misdetected box).
    const result = estimateRegionColors(canvas, { x: 38, y: 18, width: 20, height: 20 }, 4);
    expect(result.textColor).toEqual({ r: 0, g: 0, b: 0 });
    expect(result.complex).toBe(false);
  });
});

describe("computeInkMask", () => {
  it("marks only the ink pixels within the rect, not the surrounding background", () => {
    const canvas = new FakeCanvas(40, 40, WHITE);
    canvas.fillRect(10, 10, 19, 19, BLACK_INK);
    const mask = computeInkMask(canvas, { x: 5, y: 5, width: 20, height: 20 }, { r: 1, g: 1, b: 1 });
    // (10,10) is at local (5,5) within the 5,5..25,25 rect.
    expect(mask.ink[5 * mask.width + 5]).toBe(1);
    // (0,0) local — well outside the filled square — should read background.
    expect(mask.ink[0]).toBe(0);
  });
});

describe("findTextureDonorRect", () => {
  it("finds a blank donor rect above the patch when it's clean", () => {
    const canvas = new FakeCanvas(100, 100, WHITE);
    canvas.fillRect(40, 60, 55, 70, BLACK_INK); // the word itself, well below row 0
    const donor = findTextureDonorRect(canvas, { x: 40, y: 60, width: 16, height: 10 }, { r: 1, g: 1, b: 1 });
    expect(donor).not.toBeNull();
    expect(donor!.y).toBeLessThan(60); // picked the "above" candidate
  });

  it("returns null when every direction is full of ink (no safe donor)", () => {
    const canvas = new FakeCanvas(60, 60, BLACK_INK); // entirely ink-colored
    const donor = findTextureDonorRect(canvas, { x: 20, y: 20, width: 10, height: 10 }, { r: 1, g: 1, b: 1 });
    expect(donor).toBeNull();
  });
});

describe("detectProtectedLines", () => {
  it("detects a horizontal ruling line crossing the patch and reports its thin band", () => {
    const canvas = new FakeCanvas(100, 60, WHITE);
    canvas.fillRect(0, 30, 99, 31, [0, 0, 0, 255]); // a 2px horizontal rule
    const { horizontal, vertical } = detectProtectedLines(canvas, { x: 10, y: 20, width: 60, height: 20 }, { r: 1, g: 1, b: 1 });
    expect(horizontal.length).toBe(1);
    expect(horizontal[0].height).toBeLessThanOrEqual(3);
    expect(vertical.length).toBe(0);
  });

  it("does not mistake a glyph's own ink for a full-width ruling line", () => {
    const canvas = new FakeCanvas(100, 60, WHITE);
    // A narrow "glyph stroke" that only covers a small fraction of the patch width.
    canvas.fillRect(35, 20, 38, 39, BLACK_INK);
    const { horizontal } = detectProtectedLines(canvas, { x: 10, y: 20, width: 60, height: 20 }, { r: 1, g: 1, b: 1 });
    expect(horizontal.length).toBe(0);
  });

  it("regression: a patch tight to a single word (mostly its own ink) isn't misread as a line when judged against a wider span", () => {
    // Reproduces the real-app shape: the patch rect is only a couple of px of padding wider
    // than the glyphs themselves, so *within that tight box* a row through the letters is
    // mostly foreground — but a wider surrounding span shows it's just one word on a mostly
    // blank line, not a ruling line.
    const canvas = new FakeCanvas(300, 60, WHITE);
    canvas.fillRect(120, 22, 178, 36, BLACK_INK); // a short "word", tightly filling its own box
    const tightPatch = { x: 118, y: 20, width: 62, height: 20 }; // ~2px padding around the word
    const wideSample = { x: 10, y: 20, width: 280, height: 20 }; // most of the line, mostly blank
    const { horizontal } = detectProtectedLines(canvas, tightPatch, { r: 1, g: 1, b: 1 }, wideSample);
    expect(horizontal.length).toBe(0);
  });

  it("still detects a genuine ruling line even when checked against a wide sample span", () => {
    const canvas = new FakeCanvas(300, 60, WHITE);
    canvas.fillRect(0, 30, 299, 31, [0, 0, 0, 255]); // a rule spanning the whole width
    const tightPatch = { x: 118, y: 20, width: 20, height: 20 };
    const wideSample = { x: 10, y: 20, width: 280, height: 20 };
    const { horizontal } = detectProtectedLines(canvas, tightPatch, { r: 1, g: 1, b: 1 }, wideSample);
    expect(horizontal.length).toBe(1);
  });
});

describe("computeEditPadding", () => {
  it("scales gently with box height and stays within a small, conservative range", () => {
    const small = computeEditPadding(10, 95);
    const large = computeEditPadding(40, 95);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(10); // never a large whiteout margin
  });

  it("reduces padding for low-confidence OCR boxes rather than trusting them fully", () => {
    const highConfidence = computeEditPadding(20, 95);
    const lowConfidence = computeEditPadding(20, 40);
    expect(lowConfidence).toBeLessThan(highConfidence);
  });
});
