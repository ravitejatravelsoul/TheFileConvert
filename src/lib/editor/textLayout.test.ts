import { describe, expect, it } from "vitest";
import { wrapText, lineBaselineY, sanitizeForFont, TEXT_LINE_HEIGHT } from "./textLayout";

// Every character is 10 wide — simple, deterministic measuring.
const m = (s: string) => s.length * 10;

describe("wrapText", () => {
  it("keeps short text on one line", () => {
    expect(wrapText("hello world", 500, m)).toEqual(["hello world"]);
  });

  it("wraps at word boundaries", () => {
    // width 110 = 11 chars: "hello world" fits exactly; adding " again" doesn't.
    expect(wrapText("hello world again", 110, m)).toEqual(["hello world", "again"]);
  });

  it("honors explicit newlines, including blank lines", () => {
    expect(wrapText("a\n\nb", 500, m)).toEqual(["a", "", "b"]);
  });

  it("breaks a single word that is wider than the box by character", () => {
    expect(wrapText("abcdefghij", 40, m)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("returns a single empty line for empty text", () => {
    expect(wrapText("", 100, m)).toEqual([""]);
  });

  it("does not loop or lose text when the box is narrower than one character", () => {
    const lines = wrapText("abc", 5, m);
    expect(lines.join("")).toBe("abc");
  });
});

describe("lineBaselineY", () => {
  it("steps down one line-height per line", () => {
    const first = lineBaselineY(100, 10, 0);
    const second = lineBaselineY(100, 10, 1);
    expect(first - second).toBeCloseTo(10 * TEXT_LINE_HEIGHT, 6);
    expect(first).toBeLessThan(100); // baseline is below the top edge
  });
});

describe("sanitizeForFont", () => {
  it("replaces unencodable characters but keeps newlines and encodable text", () => {
    expect(sanitizeForFont("ab→c\nd", (c) => c !== "→")).toBe("ab?c\nd");
  });
});
