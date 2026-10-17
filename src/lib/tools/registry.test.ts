import { describe, expect, it } from "vitest";
import { TOOLS, entryKindFor, entryKindForAll, getTool, suggestionsFor, toolsInCategory } from "./registry";

describe("tool registry", () => {
  it("has exactly the first-launch tools, each with a matching route and FAQ", () => {
    expect(TOOLS.map((t) => t.id)).toEqual(["compress-pdf", "compress-image", "pdf-to-word", "word-to-pdf", "pdf-to-image", "image-to-pdf", "image-to-word", "convert-image", "merge-pdf", "split-pdf", "organize-pdf", "pdf-editor"]);
    for (const t of TOOLS) {
      expect(t.href).toBe(`/${t.id}`);
      expect(t.faq.length).toBeGreaterThanOrEqual(2);
      expect(t.seoDescription.length).toBeGreaterThan(60);
    }
  });

  it("names conversions one way: “X to Y”, and every conversion has its reverse", () => {
    const convert = toolsInCategory("convert").map((t) => t.name);
    expect(convert).toEqual(["PDF to Word", "Word to PDF", "PDF to Image", "Image to PDF", "Image to Word", "Image Converter"]);
    expect(new Set(TOOLS.map((t) => t.seoTitle)).size).toBe(TOOLS.length);
  });

  it("groups every tool into exactly one category", () => {
    const grouped = (["compress", "convert", "organize", "edit"] as const).flatMap((c) => toolsInCategory(c));
    expect(grouped).toHaveLength(TOOLS.length);
  });

  it("throws for an unknown tool id", () => {
    // @ts-expect-error — deliberately invalid
    expect(() => getTool("zip")).toThrow();
  });
});

describe("smart file entry", () => {
  it("classifies files by type and extension", () => {
    expect(entryKindFor({ name: "a.PDF", type: "" })).toBe("pdf");
    expect(entryKindFor({ name: "a.webp", type: "image/webp" })).toBe("image");
    expect(entryKindFor({ name: "logo.svg", type: "" })).toBe("svg");
    expect(entryKindFor({ name: "Resume.DOCX", type: "" })).toBe("word");
    expect(entryKindFor({ name: "old.doc", type: "application/msword" })).toBe("unsupported");
    expect(entryKindFor({ name: "notes.txt", type: "text/plain" })).toBe("unsupported");
  });

  it("refuses to mix PDFs with images, or accept anything unsupported", () => {
    expect(entryKindForAll([{ name: "a.pdf", type: "" }, { name: "b.jpg", type: "" }])).toBe("unsupported");
    expect(entryKindForAll([{ name: "a.jpg", type: "" }, { name: "b.txt", type: "" }])).toBe("unsupported");
    expect(entryKindForAll([{ name: "a.jpg", type: "" }, { name: "b.svg", type: "" }])).toBe("svg");
    expect(entryKindForAll([])).toBe("unsupported");
    expect(entryKindForAll([{ name: "a.docx", type: "" }, { name: "b.pdf", type: "" }])).toBe("unsupported");
  });

  it("offers PDF tools for a PDF, and only multi-file tools for several files", () => {
    expect(suggestionsFor("pdf", 1)[0]).toBe("compress-pdf");
    expect(suggestionsFor("pdf", 1)).toContain("pdf-editor");
    expect(suggestionsFor("pdf", 1)).toContain("pdf-to-word");
    expect(suggestionsFor("pdf", 3)).toEqual(["merge-pdf"]);
    expect(suggestionsFor("image", 1)).toEqual(["compress-image", "convert-image", "image-to-pdf", "image-to-word"]);
    expect(suggestionsFor("image", 2)).toEqual(["image-to-pdf", "image-to-word", "convert-image"]);
    expect(suggestionsFor("svg", 1)).toEqual(["convert-image"]);
    expect(suggestionsFor("word", 1)).toEqual(["word-to-pdf"]);
    expect(suggestionsFor("word", 2)).toEqual([]);
    expect(suggestionsFor("unsupported", 1)).toEqual([]);
  });
});
