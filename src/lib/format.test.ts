import { describe, expect, it } from "vitest";
import { formatBytes, percentSmaller, getExtension, stripExtension, withExtension, safeOutputName } from "./format";

describe("formatBytes", () => {
  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes without decimals", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("handles negative or invalid input safely", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
  });
});

describe("percentSmaller", () => {
  it("computes percentage reduction", () => {
    expect(percentSmaller(100, 50)).toBe(50);
    expect(percentSmaller(100, 25)).toBe(75);
  });

  it("returns 0 when new size is not smaller", () => {
    expect(percentSmaller(100, 120)).toBe(0);
  });

  it("returns 0 for zero-size original to avoid dividing by zero", () => {
    expect(percentSmaller(0, 0)).toBe(0);
  });
});

describe("getExtension", () => {
  it("extracts a lowercase extension", () => {
    expect(getExtension("Report.PDF")).toBe("pdf");
  });

  it("returns empty string when there is no extension", () => {
    expect(getExtension("README")).toBe("");
  });

  it("handles dotfiles without a trailing extension", () => {
    expect(getExtension(".gitignore")).toBe("gitignore");
  });
});

describe("stripExtension", () => {
  it("removes the extension", () => {
    expect(stripExtension("photo.jpeg")).toBe("photo");
  });

  it("leaves names with no extension unchanged", () => {
    expect(stripExtension("noext")).toBe("noext");
  });
});

describe("withExtension", () => {
  it("replaces the extension", () => {
    expect(withExtension("photo.png", "webp")).toBe("photo.webp");
  });
});

describe("safeOutputName", () => {
  it("builds a suffixed, sanitized filename", () => {
    expect(safeOutputName("My File!.pdf", "compressed")).toBe("My File.pdf".replace(".pdf", "") + "-compressed.pdf");
  });

  it("uses the provided extension override", () => {
    expect(safeOutputName("image.png", "converted", "webp")).toBe("image-converted.webp");
  });

  it("falls back to a default name for entirely unsafe input", () => {
    expect(safeOutputName("!!!.pdf", "x")).toBe("file-x.pdf");
  });
});
