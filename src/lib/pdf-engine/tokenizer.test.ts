import { describe, expect, it } from "vitest";
import { applyPatches, fmtNum, parseContent, serObj, toBytes, toLatin1 } from "./tokenizer";

const parse = (s: string) => parseContent(toBytes(s));

describe("parseContent", () => {
  it("reads operands and operators with their byte spans", () => {
    const src = "q 1 0 0 1 10.5 -20 cm BT /F1 12 Tf (Hello) Tj ET Q";
    const ops = parse(src);
    expect(ops.map((o) => o.op)).toEqual(["q", "cm", "BT", "Tf", "Tj", "ET", "Q"]);
    const cm = ops[1];
    expect(cm.args.map((a) => (a.t === "num" ? a.v : null))).toEqual([1, 0, 0, 1, 10.5, -20]);
    expect(src.slice(cm.start, cm.end)).toBe("1 0 0 1 10.5 -20 cm");
    const tj = ops[4];
    expect(src.slice(tj.start, tj.end)).toBe("(Hello) Tj");
    expect(src.slice(tj.opStart, tj.end)).toBe("Tj");
  });

  it("decodes literal strings: escapes, octal, nested parentheses, line continuation", () => {
    const [op] = parse("(a\\(b\\)c (nested) \\101\\n\\\\ x\\\ny) Tj");
    const s = op.args[0];
    expect(s.t === "str" && toLatin1(s.v)).toBe("a(b)c (nested) A\n\\ xy");
  });

  it("decodes hex strings, with whitespace and an odd digit count", () => {
    const [a, b] = parse("<00 41 0 4> Tj <48656C6C6F> Tj");
    expect(Array.from((a.args[0] as { v: Uint8Array }).v)).toEqual([0x00, 0x41, 0x04]);
    expect(toLatin1((b.args[0] as { v: Uint8Array }).v)).toBe("Hello");
    // an odd number of digits is padded with a zero
    const [odd] = parse("<123> Tj");
    expect(Array.from((odd.args[0] as { v: Uint8Array }).v)).toEqual([0x12, 0x30]);
  });

  it("reads TJ arrays with strings and kerning numbers", () => {
    const [op] = parse("[<0102>2<03>-1.5(ab)]TJ");
    const arr = op.args[0];
    expect(arr.t).toBe("arr");
    if (arr.t === "arr") expect(arr.v.map((x) => x.t)).toEqual(["str", "num", "str", "num", "str"]);
  });

  it("reads names with #xx escapes and dictionaries as operands (BDC)", () => {
    const [bdc] = parse("/Span <</ActualText (Hi) /MCID 3>> BDC");
    expect(bdc.op).toBe("BDC");
    expect(bdc.args[0]).toEqual({ t: "name", v: "Span" });
    const d = bdc.args[1];
    expect(d.t === "dict" && Object.keys(d.v)).toEqual(["ActualText", "MCID"]);
    const [n] = parse("/A#20B gs");
    expect(n.args[0]).toEqual({ t: "name", v: "A B" });
  });

  it("skips comments and keeps going", () => {
    const ops = parse("% a comment\nq % another\n1 0 0 1 0 0 cm\nQ");
    expect(ops.map((o) => o.op)).toEqual(["q", "cm", "Q"]);
  });

  it("handles numbers like .5, 5., -.25, +3 and a double sign", () => {
    const [a] = parse(".5 5. -.25 +3 --2 m");
    expect(a.args.map((x) => (x.t === "num" ? x.v : NaN))).toEqual([0.5, 5, -0.25, 3, -2]);
  });

  it("keeps an inline image's data out of the operator stream (with /L, and by scanning for EI)", () => {
    const bin = "\x00\x01 EI \xff\xfe\x80";
    const src = `q BI /W 2 /H 2 /BPC 8 /CS /G /L ${bin.length} ID ${bin}\nEI Q`;
    const ops = parseContent(Uint8Array.from(Array.from(src, (c) => c.charCodeAt(0))));
    expect(ops.map((o) => o.op)).toEqual(["q", "BI", "Q"]);
    expect(ops[1].inline?.dict.W).toEqual({ t: "num", v: 2 });
    const scan = `q BI /W 1 /H 1 /BPC 8 /CS /G ID \x07\nEI Q`;
    const ops2 = parseContent(Uint8Array.from(Array.from(scan, (c) => c.charCodeAt(0))));
    expect(ops2.map((o) => o.op)).toEqual(["q", "BI", "Q"]);
  });

  it("never throws on garbage, and always makes progress", () => {
    expect(() => parseContent(toBytes("((((( <<<< ]]] }}} BT ET \u0001\u0002"))).not.toThrow();
    expect(parseContent(toBytes("")).length).toBe(0);
  });
});

describe("writing", () => {
  it("formats numbers compactly and safely", () => {
    expect(fmtNum(1)).toBe("1");
    expect(fmtNum(0.1 + 0.2)).toBe("0.3");
    expect(fmtNum(-0.000001)).toBe("0");
    expect(fmtNum(12.3456789)).toBe("12.34568");
    expect(fmtNum(NaN)).toBe("0");
  });

  it("serialises operands back to parseable text", () => {
    const [op] = parse("/Span <</ActualText (a b) /N [1 2.5 /X]>> BDC");
    expect(serObj(op.args[1])).toBe("<</ActualText <612062> /N [1 2.5 /X]>>");
  });

  it("applies byte patches without touching anything else", () => {
    const src = toBytes("q 1 0 0 1 5 5 cm BT (old) Tj ET Q");
    const ops = parseContent(src);
    const tj = ops.find((o) => o.op === "Tj")!;
    const out = applyPatches(src, [{ start: tj.start, end: tj.end, text: "(new) Tj" }]);
    expect(toLatin1(out)).toBe("q 1 0 0 1 5 5 cm BT (new) Tj ET Q");
    expect(() => applyPatches(src, [{ start: 0, end: 5, text: "" }, { start: 3, end: 8, text: "" }])).toThrow();
  });
});
