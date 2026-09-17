import { describe, expect, it } from "vitest";
import {
  allTools,
  liveTools,
  getToolById,
  getToolByHref,
  getToolsByCategory,
  getRelatedTools,
  getToolsAcceptingExtension,
  searchTools,
  getPopularTools,
} from "./registry";

describe("tool registry integrity", () => {
  it("has unique tool ids", () => {
    const ids = allTools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique hrefs", () => {
    const hrefs = allTools.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("only marks tools as available when processing mode is local or server-assisted consistently", () => {
    for (const tool of allTools) {
      if (tool.status === "coming-soon") {
        expect(tool.processingMode).not.toBe("local");
      }
    }
  });

  it("every related tool id resolves to a real tool", () => {
    for (const tool of allTools) {
      for (const relatedId of tool.relatedToolIds ?? []) {
        expect(getToolById(relatedId), `${tool.id} references missing tool ${relatedId}`).toBeDefined();
      }
    }
  });

  it("popular tools all resolve and are live", () => {
    const popular = getPopularTools();
    expect(popular.length).toBeGreaterThan(0);
    for (const tool of popular) {
      expect(tool.status).not.toBe("coming-soon");
    }
  });
});

describe("getToolById / getToolByHref", () => {
  it("finds a known tool by id", () => {
    expect(getToolById("pdf-merge")?.name).toBe("Merge PDF");
  });

  it("finds a known tool by href", () => {
    expect(getToolByHref("/pdf/merge")?.id).toBe("pdf-merge");
  });

  it("returns undefined for unknown ids", () => {
    expect(getToolById("does-not-exist")).toBeUndefined();
  });
});

describe("getToolsByCategory", () => {
  it("returns only tools in that category", () => {
    const tools = getToolsByCategory("pdf");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.category === "pdf")).toBe(true);
  });
});

describe("getRelatedTools", () => {
  it("never includes coming-soon tools", () => {
    const tool = getToolById("pdf-merge")!;
    const related = getRelatedTools(tool);
    expect(related.every((t) => t.status !== "coming-soon")).toBe(true);
  });

  it("never includes the tool itself", () => {
    const tool = getToolById("pdf-merge")!;
    const related = getRelatedTools(tool);
    expect(related.some((t) => t.id === tool.id)).toBe(false);
  });
});

describe("getToolsAcceptingExtension", () => {
  it("finds live tools that accept a given extension", () => {
    const tools = getToolsAcceptingExtension("pdf");
    expect(tools.some((t) => t.id === "pdf-merge")).toBe(true);
    expect(tools.every((t) => t.status !== "coming-soon")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(getToolsAcceptingExtension("PDF").length).toBe(getToolsAcceptingExtension("pdf").length);
  });
});

describe("searchTools", () => {
  it("returns an exact name match first", () => {
    const results = searchTools("merge pdf");
    expect(results[0]?.id).toBe("pdf-merge");
  });

  it("matches by keyword", () => {
    const results = searchTools("shrink pdf");
    expect(results.some((t) => t.id === "pdf-compress")).toBe(true);
  });

  it("returns nothing for an empty query", () => {
    expect(searchTools("")).toEqual([]);
  });

  it("excludes coming-soon tools by default", () => {
    const results = searchTools("password protect pdf");
    expect(results.every((t) => t.status !== "coming-soon")).toBe(true);
  });

  it("can include coming-soon tools when asked", () => {
    const results = searchTools("password protect pdf", { includeComingSoon: true });
    expect(results.some((t) => t.id === "pdf-protect")).toBe(true);
  });
});

describe("liveTools", () => {
  it("excludes every coming-soon tool", () => {
    expect(liveTools.every((t) => t.status !== "coming-soon")).toBe(true);
  });
});
