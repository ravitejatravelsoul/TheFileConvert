import { describe, expect, it } from "vitest";
import { applyHunks, diffChars } from "./diff";
import { StreamEditor } from "./streamedit";
import { parseContent, toBytes, toLatin1 } from "./tokenizer";

const chars = (s: string) => [...s];

describe("diffChars", () => {
  it("finds nothing to do for equal text", () => {
    expect(diffChars(chars("same"), chars("same"))).toEqual([]);
  });

  it("a swapped pair is a small change, not a rewritten word", () => {
    const h = diffChars(chars("a recieve b"), chars("a receive b"));
    expect(applyHunks(chars("a recieve b"), h)).toBe("a receive b");
    expect(h.reduce((n, x) => n + x.delEnd - x.delStart + x.insert.length, 0)).toBeLessThanOrEqual(4);
  });

  it("handles pure insertions, pure deletions and replacements at the ends", () => {
    for (const [a, b] of [["abc", "abXc"], ["abXc", "abc"], ["", "new"], ["old", ""], ["teh", "the"], ["cat", "customer"], ["one two", "one"], ["x", "xyz"], ["hello world", "world hello"]]) {
      const h = diffChars(chars(a), chars(b));
      expect(applyHunks(chars(a), h), `${a} → ${b}`).toBe(b);
      for (const x of h) expect(x.delStart).toBeLessThanOrEqual(x.delEnd);
    }
  });

  it("keeps separate changes separate", () => {
    const h = diffChars(chars("the quick brown fox"), chars("the quack brown box"));
    expect(h.length).toBe(2);
  });

  it("works on a very long line", () => {
    const a = "word ".repeat(400);
    const b = a.replace("word word word", "word edit word");
    expect(applyHunks(chars(a), diffChars(chars(a), chars(b)))).toBe(b);
  });
});

describe("StreamEditor", () => {
  const src = "q 1 0 0 1 5 5 cm\nBT /F1 12 Tf (one) Tj 10 0 Td (two) Tj ET\nQ";

  it("rebuilds an untouched stream byte for byte", () => {
    const e = new StreamEditor(toBytes(src));
    const { bytes, newIndex } = e.build();
    expect(toLatin1(bytes)).toBe(src);
    expect(newIndex).toEqual(e.ops.map((_, i) => i));
  });

  it("replaces, deletes and inserts, and reports where every original operation went", () => {
    const e = new StreamEditor(toBytes(src));
    const ops = e.ops;
    const one = ops.findIndex((o) => o.op === "Tj");
    e.replace(one, "(ONE) Tj /F2 12 Tf");
    const td = ops.findIndex((o) => o.op === "Td");
    e.insertAfter(td, "2 0 Td");
    const two = ops.findLastIndex((o) => o.op === "Tj");
    e.delete(two);
    const { bytes, newIndex, inserted } = e.build();
    const out = parseContent(bytes).map((o) => o.op);
    expect(out).toEqual(["q", "cm", "BT", "Tf", "Tj", "Tf", "Td", "Td", "ET", "Q"]);
    expect(newIndex[two]).toBe(-1);
    expect(newIndex[ops.findIndex((o) => o.op === "ET")]).toBe(out.indexOf("ET"));
    expect(inserted).toEqual([7]); // the inserted Td
    expect(newIndex[one]).toBe(4); // the replaced op: first op of its replacement
  });
});
