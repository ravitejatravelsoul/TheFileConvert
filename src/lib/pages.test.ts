import { describe, expect, it } from "vitest";
import { describePages, parsePageList } from "./pages";

describe("describePages", () => {
  it("collapses runs into ranges", () => {
    expect(describePages([0, 1, 2, 6, 8, 9])).toBe("1-3, 7, 9-10");
    expect(describePages([4])).toBe("5");
    expect(describePages([])).toBe("");
  });
});

describe("parsePageList", () => {
  it("parses singles and ranges, deduped and sorted", () => {
    expect(parsePageList("7, 1-3, 2", 10)).toEqual({ pages: [0, 1, 2, 6] });
    expect(parsePageList("5-3", 10)).toEqual({ pages: [2, 3, 4] });
    expect(parsePageList("2–4", 10)).toEqual({ pages: [1, 2, 3] });
  });

  it("rejects pages outside the document instead of silently dropping them", () => {
    expect(parsePageList("1, 12", 10)).toEqual({ error: "This PDF has pages 1 to 10." });
    expect(parsePageList("0", 10)).toEqual({ error: "This PDF has pages 1 to 10." });
  });

  it("rejects text and empty input", () => {
    expect("error" in parsePageList("abc", 10)).toBe(true);
    expect("error" in parsePageList("  ", 10)).toBe(true);
  });
});
