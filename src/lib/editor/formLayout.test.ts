import { describe, expect, it } from "vitest";
import { familyOfFontName, layoutFormText, parseDefaultAppearance } from "./formLayout";

const measure = (t: string, s: number) => t.length * s * 0.5; // 0.5 em per character

describe("default appearance", () => {
  it("reads font, size and colour; size 0 is auto", () => {
    expect(parseDefaultAppearance("/Helv 12 Tf 0 g")).toEqual({ fontName: "Helv", size: 12, color: { r: 0, g: 0, b: 0 } });
    expect(parseDefaultAppearance("/Arial 0 Tf 0.1 0.2 0.7 rg").size).toBe(0);
    expect(parseDefaultAppearance("/Arial 0 Tf 0.1 0.2 0.7 rg").color).toEqual({ r: 0.1, g: 0.2, b: 0.7 });
    expect(parseDefaultAppearance("0 0 0 1 k /Cour 9 Tf").color).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseDefaultAppearance(undefined).fontName).toBe("Helv");
  });
  it("maps font names to a family", () => {
    expect(familyOfFontName("TiRo")).toBe("serif");
    expect(familyOfFontName("Cour")).toBe("mono");
    expect(familyOfFontName("Helv")).toBe("sans");
    expect(familyOfFontName("SomethingElse")).toBe("sans");
  });
});

describe("text layout in a widget", () => {
  const base = { width: 200, height: 24, multiline: false, fontSize: 12, family: "sans" as const, align: 0 as const, borderWidth: 1, measure };
  it("centres a single line vertically and respects alignment and padding", () => {
    const left = layoutFormText({ ...base, value: "Raviteja" });
    expect(left.lines[0].x).toBe(2);
    // the line box sits in the middle: baseline − descent … baseline + ascent is centred in the 24 pt box
    const top = left.lines[0].baseline + 0.905 * 12;
    const bottom = left.lines[0].baseline - 0.212 * 12;
    expect(24 - top).toBeCloseTo(bottom, 6);
    const centre = layoutFormText({ ...base, value: "Raviteja", align: 1 });
    expect(centre.lines[0].x + measure("Raviteja", 12) / 2).toBeCloseTo(100, 6);
    const right = layoutFormText({ ...base, value: "Raviteja", align: 2 });
    expect(right.lines[0].x + measure("Raviteja", 12)).toBeCloseTo(198, 6);
  });
  it("auto-size fills the height on one line, then narrows to the width", () => {
    const tall = layoutFormText({ ...base, fontSize: 0, value: "Hi" });
    expect(tall.fontSize).toBeCloseTo((24 - 4) / 1.117, 2);
    const long = layoutFormText({ ...base, fontSize: 0, value: "x".repeat(60) });
    expect(long.fontSize).toBeLessThan(tall.fontSize);
    expect(measure("x".repeat(60), long.fontSize)).toBeLessThanOrEqual(196 + 1e-6);
  });
  it("wraps a multi-line field and shrinks auto-size until it fits", () => {
    const fixed = layoutFormText({ ...base, height: 100, multiline: true, value: "one two three four five six seven eight nine ten eleven twelve" });
    expect(fixed.lines.length).toBeGreaterThan(1);
    expect(fixed.lines[0].baseline).toBeCloseTo(100 - 2 - 0.905 * 12, 6);
    const auto = layoutFormText({ ...base, height: 40, multiline: true, fontSize: 0, value: "word ".repeat(80) });
    expect(auto.fontSize).toBeLessThan(12);
    expect(auto.lines.length * auto.lineHeight).toBeLessThanOrEqual(36 + 1e-6);
  });
});
