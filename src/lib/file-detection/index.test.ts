import { describe, expect, it } from "vitest";
import { sniffFileType, matchesAcceptedTypes } from "./index";

function makeFile(bytes: number[], name = "file.bin", type = ""): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("sniffFileType", () => {
  it("detects a PDF by magic bytes", async () => {
    const file = makeFile([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(await sniffFileType(file)).toBe("pdf");
  });

  it("detects a PNG by magic bytes", async () => {
    const file = makeFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await sniffFileType(file)).toBe("png");
  });

  it("detects a JPEG by magic bytes", async () => {
    const file = makeFile([0xff, 0xd8, 0xff, 0xe0]);
    expect(await sniffFileType(file)).toBe("jpg");
  });

  it("detects a ZIP by magic bytes", async () => {
    const file = makeFile([0x50, 0x4b, 0x03, 0x04]);
    expect(await sniffFileType(file)).toBe("zip");
  });

  it("distinguishes WebP from other RIFF containers", async () => {
    const webpBytes = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
    expect(await sniffFileType(makeFile(webpBytes))).toBe("webp");

    const nonWebpRiff = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20];
    expect(await sniffFileType(makeFile(nonWebpRiff))).toBeNull();
  });

  it("returns null for unrecognized content", async () => {
    const file = makeFile([0x00, 0x01, 0x02, 0x03]);
    expect(await sniffFileType(file)).toBeNull();
  });
});

describe("matchesAcceptedTypes", () => {
  it("matches by extension", () => {
    expect(matchesAcceptedTypes("pdf", "", ["pdf"], ["application/pdf"])).toBe(true);
  });

  it("matches by mime type when extension is missing", () => {
    expect(matchesAcceptedTypes("", "application/pdf", ["pdf"], ["application/pdf"])).toBe(true);
  });

  it("rejects files matching neither signal", () => {
    expect(matchesAcceptedTypes("txt", "text/plain", ["pdf"], ["application/pdf"])).toBe(false);
  });

  it("treats an empty accepted-extensions list as permissive", () => {
    expect(matchesAcceptedTypes("anything", "", [], ["application/pdf"])).toBe(true);
  });
});
