import { describe, expect, it } from "vitest";
import { normalizeToGrid, compareGrids, pickBestFontCandidate, FONT_CANDIDATES, type Bitmap, type FontCandidate } from "./glyphMatch";

function bitmapFromRows(rows: string[]): Bitmap {
  const height = rows.length;
  const width = rows[0].length;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ink[y * width + x] = rows[y][x] === "#" ? 1 : 0;
    }
  }
  return { width, height, ink };
}

// A serif "I" — a vertical stroke with horizontal serifs at top and bottom.
const SERIF_I = bitmapFromRows([
  "#######",
  "###.###",
  "###.###",
  "###.###",
  "###.###",
  "###.###",
  "#######",
]);

// A sans-serif "I" — just a plain vertical bar, no serifs.
const SANS_I = bitmapFromRows([
  ".###.",
  ".###.",
  ".###.",
  ".###.",
  ".###.",
  ".###.",
  ".###.",
]);

describe("normalizeToGrid", () => {
  it("returns an empty grid for an all-background bitmap", () => {
    const blank: Bitmap = { width: 10, height: 10, ink: new Uint8Array(100) };
    const grid = normalizeToGrid(blank);
    expect(grid.every((v) => v === 0)).toBe(true);
  });

  it("crops to the ink bounding box so absolute position doesn't affect shape comparison", () => {
    const width = 40;
    const height = 40;
    const ink = new Uint8Array(width * height);
    // A small 4x4 filled square placed off in a corner.
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) ink[y * width + x] = 1;
    const cornerSquare: Bitmap = { width, height, ink };

    const ink2 = new Uint8Array(width * height);
    // The same 4x4 square, but placed in the middle instead.
    for (let y = 18; y < 22; y++) for (let x = 18; x < 22; x++) ink2[y * width + x] = 1;
    const centeredSquare: Bitmap = { width, height, ink: ink2 };

    expect(compareGrids(normalizeToGrid(cornerSquare), normalizeToGrid(centeredSquare))).toBeCloseTo(1, 5);
  });
});

describe("compareGrids", () => {
  it("scores 1 for identical grids and 0 for two empty grids", () => {
    const a = new Uint8Array([1, 0, 1, 0]);
    expect(compareGrids(a, a)).toBe(1);
    const empty = new Uint8Array(4);
    expect(compareGrids(empty, empty)).toBe(0);
  });

  it("scores a serif glyph as closer to another serif glyph than to a plain sans bar", () => {
    const serifGrid = normalizeToGrid(SERIF_I);
    const sansGrid = normalizeToGrid(SANS_I);
    // Compare the serif glyph against itself (upper bound) vs against the sans glyph.
    expect(compareGrids(serifGrid, serifGrid)).toBeGreaterThan(compareGrids(serifGrid, sansGrid));
  });
});

describe("pickBestFontCandidate", () => {
  it("selects the candidate whose rendering matches the original glyph's shape", () => {
    const serifCandidate: FontCandidate = { id: "fake-serif", family: "serif", bold: false, italic: false };
    const sansCandidate: FontCandidate = { id: "fake-sans", family: "sans-serif", bold: false, italic: false };
    const renderCandidate = (c: FontCandidate) => (c.id === "fake-serif" ? SERIF_I : SANS_I);

    const result = pickBestFontCandidate(SERIF_I, renderCandidate, [serifCandidate, sansCandidate]);
    expect(result.candidate.id).toBe("fake-serif");
    expect(result.score).toBeCloseTo(1, 5);
  });

  it("falls back gracefully (first candidate, score 0) when every render fails", () => {
    const result = pickBestFontCandidate(SERIF_I, () => null);
    expect(result.candidate).toBe(FONT_CANDIDATES[0]);
    expect(result.score).toBe(0);
  });
});
