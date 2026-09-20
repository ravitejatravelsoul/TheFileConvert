import { describe, expect, it } from "vitest";
import { normalizeToGrid, compareGrids, inkDensity, pickBestFontCandidate,
  pickBestFontCandidateForReferences,
  inkAspectRatio, FONT_CANDIDATES, type Bitmap, type FontCandidate } from "./glyphMatch";

/** Two vertical bars with a gap between them (like a simplified "11" or the two strokes of
 * a digit) — used to build a case where a thicker rendering's bars merge into a solid block,
 * changing shape (IoU) *and* density together in a way a real bold/regular font pair does. */
function twoBars(size: number, barWidth: number, gap: number): Bitmap {
  const width = Math.max(barWidth * 2 + gap, size);
  const height = size;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < barWidth; x++) ink[y * width + x] = 1;
    const secondStart = barWidth + Math.max(0, gap);
    for (let x = secondStart; x < secondStart + barWidth && x < width; x++) ink[y * width + x] = 1;
  }
  return { width, height, ink };
}

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

  it("regression: prefers the regular-weight candidate over bold even when bold's raw shape overlap scores slightly higher", () => {
    // Reproduces the actual reported defect: an anti-aliased regular-weight scanned digit
    // read as noticeably bolder than its neighbors after a correction. Constructed so pure
    // IoU alone (the pre-fix scoring) picks the bold candidate — verified below — and the
    // density-aware combined scoring corrects it.
    const reference = twoBars(20, 2, 3); // a regular glyph, fattened a bit by anti-aliasing
    const regularCandidate: FontCandidate = { id: "fake-regular", family: "serif", bold: false, italic: false };
    const boldCandidate: FontCandidate = { id: "fake-bold", family: "serif", bold: true, italic: false };
    const regularRender = twoBars(20, 1, 6);
    const boldRender = twoBars(20, 5, 0); // strokes have merged into a solid block

    // Sanity check on the premise: shape-only IoU actually does favor bold here, so this test
    // is exercising the density correction, not a case IoU already got right on its own.
    const refGrid = normalizeToGrid(reference);
    expect(compareGrids(refGrid, normalizeToGrid(boldRender))).toBeGreaterThan(compareGrids(refGrid, normalizeToGrid(regularRender)));

    const renderCandidate = (c: FontCandidate) => (c.id === "fake-bold" ? boldRender : regularRender);
    const result = pickBestFontCandidate(reference, renderCandidate, [regularCandidate, boldCandidate]);
    expect(result.candidate.id).toBe("fake-regular");
  });
});

describe("inkDensity", () => {
  it("is higher for a mostly-filled grid than a mostly-empty one", () => {
    const mostlyFilled = new Uint8Array(100).fill(1);
    const mostlyEmpty = new Uint8Array(100);
    mostlyEmpty[0] = 1;
    expect(inkDensity(mostlyFilled)).toBeGreaterThan(inkDensity(mostlyEmpty));
  });

  it("returns 0 for an empty grid", () => {
    expect(inkDensity(new Uint8Array(0))).toBe(0);
  });
});

describe("inkAspectRatio", () => {
  it("is the ink bounding box's width over its height, ignoring empty margins", () => {
    const bmp = { width: 40, height: 20, ink: new Uint8Array(40 * 20) };
    for (let y = 5; y < 10; y++) for (let x = 10; x < 30; x++) bmp.ink[y * 40 + x] = 1; // 20 wide, 5 tall
    expect(inkAspectRatio(bmp)).toBe(4);
  });

  it("is null when there is no ink", () => {
    expect(inkAspectRatio({ width: 4, height: 4, ink: new Uint8Array(16) })).toBeNull();
  });
});

describe("pickBestFontCandidateForReferences", () => {
  const narrow: FontCandidate = { id: "narrow", family: "serif", bold: false, italic: false };
  const wide: FontCandidate = { id: "wide", family: "sans-serif", bold: false, italic: false };
  const block = (w: number, h: number): Bitmap => {
    const bmp = { width: w + 4, height: h + 4, ink: new Uint8Array((w + 4) * (h + 4)) };
    for (let y = 2; y < 2 + h; y++) for (let x = 2; x < 2 + w; x++) bmp.ink[y * (w + 4) + x] = 1;
    return bmp;
  };

  it("uses the width-to-height proportions of the word, not just its squeezed shape", () => {
    const reference = block(60, 10);
    const result = pickBestFontCandidateForReferences(
      [{ bitmap: reference, render: (c) => (c.id === "narrow" ? block(60, 10) : block(90, 10)) }],
      [wide, narrow]
    );
    expect(result.candidate.id).toBe("narrow");
  });

  it("lets several agreeing neighbours outvote a single misleading word", () => {
    const good = block(60, 10);
    const misleading = block(90, 10);
    const render = (c: FontCandidate) => (c.id === "narrow" ? block(60, 10) : block(90, 10));
    const result = pickBestFontCandidateForReferences(
      [
        { bitmap: misleading, render, weight: 1 },
        { bitmap: good, render, weight: 1 },
        { bitmap: good, render, weight: 1 },
      ],
      [wide, narrow]
    );
    expect(result.candidate.id).toBe("narrow");
  });

  it("prefers an upright face over an italic one that scores about the same", () => {
    const upright: FontCandidate = { id: "upright", family: "serif", bold: false, italic: false };
    const italic: FontCandidate = { id: "italic", family: "serif", bold: false, italic: true };
    const bmp = block(30, 10);
    const result = pickBestFontCandidateForReferences([{ bitmap: bmp, render: () => block(30, 10) }], [italic, upright]);
    expect(result.candidate.id).toBe("upright");
  });
});
