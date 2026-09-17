import { describe, expect, it } from "vitest";
import { parsePageRanges, ProcessorError } from "./pdf";

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
