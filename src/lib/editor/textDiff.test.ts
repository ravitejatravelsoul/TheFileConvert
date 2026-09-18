import { describe, expect, it } from "vitest";
import { computeChangedSpan, computeChangedSubRect, type CharBox } from "./textDiff";

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
