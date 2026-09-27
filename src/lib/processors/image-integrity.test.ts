import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCompleteImage } from "./image-integrity";

const qa = (n: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, "../../../e2e/fixtures/qa", n)));

describe("isCompleteImage (regression: damaged images turned into 'successful' outputs)", () => {
  it("accepts complete JPEG, PNG and WebP files", () => {
    for (const f of ["img-landscape.jpg", "img-with-exif.jpg", "img-photo-transparent.png", "img-photo.webp", "img-transparent.webp"]) expect(isCompleteImage(qa(f)), f).toBe(true);
  });

  it("rejects a JPEG cut off anywhere — including halfway through the image data", () => {
    const jpg = qa("img-landscape.jpg");
    for (const cut of [100, 3000, Math.floor(jpg.length / 2), jpg.length - 2]) expect(isCompleteImage(jpg.subarray(0, cut)), `cut at ${cut}`).toBe(false);
  });

  it("accepts data appended after the JPEG's end (phone motion photos)", () => {
    const jpg = qa("img-landscape.jpg");
    const withVideo = new Uint8Array(jpg.length + 5000);
    withVideo.set(jpg);
    withVideo.fill(0x42, jpg.length);
    expect(isCompleteImage(withVideo)).toBe(true);
  });

  it("rejects cut-off PNG and WebP files", () => {
    const png = qa("img-photo-transparent.png");
    expect(isCompleteImage(png.subarray(0, Math.floor(png.length * 0.6)))).toBe(false);
    const webp = qa("img-photo.webp");
    expect(isCompleteImage(webp.subarray(0, Math.floor(webp.length * 0.6)))).toBe(false);
  });
});
