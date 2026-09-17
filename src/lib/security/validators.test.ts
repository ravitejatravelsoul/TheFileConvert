import { describe, expect, it } from "vitest";
import {
  sanitizeSvgMarkup,
  sanitizeArchiveEntryName,
  looksLikeZipBomb,
  validateFileForTool,
  isOverRecommendedSize,
} from "./validators";
import type { ToolDefinition } from "@/lib/tools/types";

const pdfTool: ToolDefinition = {
  id: "t",
  slug: "t",
  href: "/t",
  name: "Test tool",
  description: "d",
  category: "pdf",
  acceptedExtensions: ["pdf"],
  acceptedMimeTypes: ["application/pdf"],
  outputExtensions: ["pdf"],
  processingMode: "local",
  status: "available",
  supportsMultiple: false,
  maxRecommendedSizeMb: 1,
  keywords: [],
  workflow: "file",
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

describe("sanitizeArchiveEntryName", () => {
  it("removes path traversal segments", () => {
    expect(sanitizeArchiveEntryName("../../etc/passwd")).toBe("etc/passwd");
  });

  it("normalizes backslashes", () => {
    expect(sanitizeArchiveEntryName("folder\\file.txt")).toBe("folder/file.txt");
  });

  it("falls back to a default name when nothing safe remains", () => {
    expect(sanitizeArchiveEntryName("../..")).toBe("file");
  });
});

describe("looksLikeZipBomb", () => {
  it("flags an extreme compression ratio", () => {
    expect(looksLikeZipBomb(1000, 1000 * 300)).toBe(true);
  });

  it("allows normal compression ratios", () => {
    expect(looksLikeZipBomb(1000, 3000)).toBe(false);
  });

  it("flags absurd absolute uncompressed size regardless of ratio", () => {
    expect(looksLikeZipBomb(1_000_000_000, 3_000_000_000)).toBe(true);
  });
});

describe("validateFileForTool", () => {
  it("rejects empty files", async () => {
    const file = new File([], "empty.pdf", { type: "application/pdf" });
    const result = await validateFileForTool(file, pdfTool);
    expect(result.valid).toBe(false);
  });

  it("accepts a matching file", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", { type: "application/pdf" });
    const result = await validateFileForTool(file, pdfTool);
    expect(result.valid).toBe(true);
  });

  it("rejects a mismatched file type", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "doc.txt", { type: "text/plain" });
    const result = await validateFileForTool(file, pdfTool);
    expect(result.valid).toBe(false);
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
