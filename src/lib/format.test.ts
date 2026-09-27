import { describe, expect, it } from "vitest";
import { getExtension, stripExtension, withExtension, safeOutputName } from "./format";

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
