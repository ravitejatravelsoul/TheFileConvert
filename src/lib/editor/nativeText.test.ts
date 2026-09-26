import { describe, expect, it } from "vitest";
import { DESCENT_SHARE, groupTextRuns } from "./nativeText";

const run = (str: string, x: number, y: number, width: number, height = 14) => ({ str, x, y, width, height });

describe("groupTextRuns", () => {
  it("splits a label and its value into separate regions when there's a wide gap", () => {
    const regions = groupTextRuns([run("Billed to:", 60, 660, 62), run("Jordan Smith", 200, 660, 86)]);
    expect(regions.map((r) => r.text)).toEqual(["Billed to:", "Jordan Smith"]);
    expect(regions[1].pdfBox.x).toBeCloseTo(199.5);
  });

  it("keeps words of one sentence together and restores missing spaces", () => {
    const regions = groupTextRuns([run("Terms", 60, 480, 30, 11), run("line", 93, 480, 18, 11), run("1:", 113, 480, 9, 11)]);
    expect(regions).toHaveLength(1);
    expect(regions[0].text).toBe("Terms line 1:");
  });

  it("does not double spaces the PDF already stored", () => {
    const regions = groupTextRuns([run("Hello ", 60, 400, 34), run("world", 96, 400, 30)]);
    expect(regions[0].text).toBe("Hello world");
  });

  it("orders lines top to bottom and covers descenders below the baseline", () => {
    const regions = groupTextRuns([run("second", 60, 600, 40), run("first", 60, 700, 30)]);
    expect(regions.map((r) => r.text)).toEqual(["first", "second"]);
    const box = regions[0].pdfBox;
    // The baseline (700) sits DESCENT_SHARE of the box height above its bottom edge.
    expect(box.y + box.height * DESCENT_SHARE).toBeCloseTo(700);
    expect(box.y + box.height).toBeCloseTo(700 + 14);
  });

  it("ignores whitespace-only runs", () => {
    expect(groupTextRuns([run("   ", 60, 500, 10)])).toEqual([]);
  });
});
