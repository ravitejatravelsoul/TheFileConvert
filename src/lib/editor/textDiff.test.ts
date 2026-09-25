import { describe, expect, it } from "vitest";
import { computeChangedSpan, computeChangedSubRect, planOcrPatch, type CharBox } from "./textDiff";

describe("computeChangedSpan", () => {
  it("finds only the final changed digit in a date", () => {
    const span = computeChangedSpan("2026", "2028");
    expect(span.prefixLen).toBe(3);
    expect(span.suffixLen).toBe(0);
    expect(span.originalMiddle).toBe("6");
    expect(span.replacementMiddle).toBe("8");
  });

  it("finds a changed middle digit surrounded by a common prefix and suffix", () => {
    const span = computeChangedSpan("12/20/2026", "12/20/2126");
    expect(span.originalMiddle).toBe("0");
    expect(span.replacementMiddle).toBe("1");
  });

  it("falls back to a large span for two unrelated words", () => {
    const span = computeChangedSpan("degree", "graduate");
    // Common suffix "e" only; everything else differs.
    expect(span.suffixLen).toBe(1);
    expect(span.prefixLen).toBe(0);
    expect(span.originalMiddle).toBe("degre");
    expect(span.replacementMiddle).toBe("graduat");
  });

  it("handles a pure deletion", () => {
    const span = computeChangedSpan("Smith", "");
    expect(span.originalMiddle).toBe("Smith");
    expect(span.replacementMiddle).toBe("");
  });

  it("handles identical strings with an empty span", () => {
    const span = computeChangedSpan("same", "same");
    expect(span.originalMiddle).toBe("");
    expect(span.replacementMiddle).toBe("");
  });

  it("handles a pure insertion at the end", () => {
    const span = computeChangedSpan("182.50", "182.500");
    expect(span.originalMiddle).toBe("");
    expect(span.replacementMiddle).toBe("0");
  });
});

function box(text: string, x: number): CharBox {
  return { text, pdfBox: { x, y: 100, width: 6, height: 12 } };
}

describe("computeChangedSubRect", () => {
  it("returns a tight rect covering only the changed character's own box", () => {
    const chars = [box("2", 0), box("0", 6), box("2", 12), box("6", 18)];
    const span = computeChangedSpan("2026", "2028");
    const rect = computeChangedSubRect(chars, "2026", span);
    expect(rect).not.toBeNull();
    expect(rect!.x).toBe(18);
    expect(rect!.width).toBe(6);
  });

  it("returns null when char boxes don't reconstruct the original text (untrustworthy segmentation)", () => {
    const chars = [box("2", 0), box("0", 6), box("26", 12)]; // merged symbol, text mismatch
    const span = computeChangedSpan("2026", "2028");
    const rect = computeChangedSubRect(chars, "2026", span);
    expect(rect).toBeNull();
  });

  it("returns null when no char boxes are given at all", () => {
    const span = computeChangedSpan("2026", "2028");
    expect(computeChangedSubRect(undefined, "2026", span)).toBeNull();
  });

  it("spans multiple characters when several change together", () => {
    const chars = [box("d", 0), box("e", 6), box("g", 12), box("r", 18), box("e", 24), box("e", 30)];
    const span = computeChangedSpan("degree", "graduate");
    const rect = computeChangedSubRect(chars, "degree", span);
    // originalMiddle = "degre" (indices 0..4) per the prefix/suffix computed above.
    expect(rect).not.toBeNull();
    expect(rect!.x).toBe(0);
    expect(rect!.width).toBe(30); // covers chars 0..4 (5 chars, 6 wide each)
  });
});

describe("planOcrPatch", () => {
  const lineBox = { x: 40, y: 500, width: 520, height: 14 };
  const charsFor = (text: string, x0 = 100, w = 7): CharBox[] => [...text].map((ch, i) => ({ text: ch, pdfBox: { x: x0 + i * w, y: 500, width: w, height: 12 } }));

  it("a word-level digit swap with per-character boxes patches just the changed digit", () => {
    const plan = planOcrPatch(charsFor("2026"), "2026", "2028", lineBox);
    expect(plan.partial).toBe(true);
    expect(plan.originalText).toBe("6");
    expect(plan.newText).toBe("8");
    expect(plan.box.width).toBe(7);
  });

  it("a line-level digit swap (no per-character boxes) redraws the WHOLE line, never just the changed digit", () => {
    // Regression: production edit of "VALID FROM 02/08/2026 UNTIL 12/20/2026" -> "...12/20/2028"
    // patched the whole line's box but drew only "8", erasing the rest of the line.
    const original = "VALID FROM 02/08/2026 UNTIL 12/20/2026";
    const edited = "VALID FROM 02/08/2026 UNTIL 12/20/2028";
    const plan = planOcrPatch(undefined, original, edited, lineBox);
    expect(plan.partial).toBe(false);
    expect(plan.box).toEqual(lineBox);
    expect(plan.originalText).toBe(original);
    expect(plan.newText).toBe(edited);
  });

  it("per-character boxes that don't match the text fall back to the whole box and whole text together", () => {
    const plan = planOcrPatch(charsFor("2O26"), "2026", "2028", lineBox); // OCR merged/misread a glyph
    expect(plan).toEqual({ box: lineBox, originalText: "2026", newText: "2028", partial: false });
  });

  it("letter changes and length changes always redraw the whole word", () => {
    expect(planOcrPatch(charsFor("degree"), "degree", "graduate", lineBox).partial).toBe(false);
    expect(planOcrPatch(charsFor("Smith"), "Smith", "Smyth", lineBox).partial).toBe(false);
    expect(planOcrPatch(charsFor("182.50"), "182.50", "182.500", lineBox).partial).toBe(false);
  });

  it("the drawn text and the patched box are never mixed granularities", () => {
    for (const [chars, a, b] of [[charsFor("2026"), "2026", "2028"], [undefined, "12/20/2026", "12/20/2028"], [charsFor("abc"), "abc", "abd"]] as const) {
      const plan = planOcrPatch(chars as CharBox[] | undefined, a, b, lineBox);
      if (plan.partial) expect(plan.box).not.toEqual(lineBox);
      else expect([plan.originalText, plan.newText]).toEqual([a, b]);
    }
  });
});
