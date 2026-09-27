import { describe, expect, it } from "vitest";
import { sanitizeSvgMarkup, validateFileForTool, isOverRecommendedSize, type ToolInputRules } from "./validators";
import { TOOLS } from "@/lib/tools/registry";

const pdfTool: ToolInputRules = {
  name: "Test tool",
  inputNoun: "PDF",
  acceptedExtensions: ["pdf"],
  acceptedMimeTypes: ["application/pdf"],
  maxRecommendedSizeMb: 1,
};

describe("sanitizeSvgMarkup", () => {
  it("strips <script> tags", () => {
    const dirty = `<svg><script>alert(1)</script><circle r="4"/></svg>`;
    const clean = sanitizeSvgMarkup(dirty);
    expect(clean).not.toContain("<script>");
    expect(clean).toContain("<circle");
  });

  it("strips inline event handler attributes", () => {
    const dirty = `<svg onload="alert(1)"><rect onclick="evil()" /></svg>`;
    const clean = sanitizeSvgMarkup(dirty);
    expect(clean).not.toMatch(/onload/i);
    expect(clean).not.toMatch(/onclick/i);
  });

  it("strips javascript: URIs", () => {
    const dirty = `<a href="javascript:alert(1)">click</a>`;
    expect(sanitizeSvgMarkup(dirty)).not.toContain("javascript:");
  });

  it("strips foreignObject blocks", () => {
    const dirty = `<svg><foreignObject><body>evil</body></foreignObject></svg>`;
    expect(sanitizeSvgMarkup(dirty)).not.toContain("foreignObject");
  });
});

describe("validateFileForTool", () => {
  it("rejects empty files and names the file", async () => {
    const file = new File([], "empty.pdf", { type: "application/pdf" });
    const result = await validateFileForTool(file, pdfTool);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty.pdf");
  });

  it("accepts a matching file", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", { type: "application/pdf" });
    const result = await validateFileForTool(file, pdfTool);
    expect(result.valid).toBe(true);
  });

  it("rejects a mismatched file type and says what is accepted", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "doc.txt", { type: "text/plain" });
    const result = await validateFileForTool(file, pdfTool);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/takes PDF files/);
  });

  it("lists every accepted image format once", async () => {
    const tool = TOOLS.find((t) => t.id === "compress-image")!;
    const result = await validateFileForTool(new File([new Uint8Array([1])], "x.gif", { type: "image/gif" }), tool);
    expect(result.error).toMatch(/JPG, PNG or WebP files/);
  });
});

describe("isOverRecommendedSize", () => {
  it("flags files larger than the tool's recommended size", () => {
    const file = new File([new Uint8Array(2 * 1024 * 1024)], "big.pdf");
    expect(isOverRecommendedSize(file, pdfTool)).toBe(true);
  });

  it("does not flag files within the recommended size", () => {
    const file = new File([new Uint8Array(10)], "small.pdf");
    expect(isOverRecommendedSize(file, pdfTool)).toBe(false);
  });
});
