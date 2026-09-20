import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { analyzePdfImages, compressPdfDocument, describeAnalysis, type JpegReencoder } from "./pdf-compress";

const JPEG = new Uint8Array(fs.readFileSync(path.join(__dirname, "../../../e2e/fixtures/sample.jpg")));

/** A PDF whose pages each embed the same JPEG bytes as a separate image object, plus some text. */
async function pdfWithRepeatedImage(copies: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < copies; i++) {
    const img = await doc.embedJpg(JPEG); // embedJpg creates a new image object each call
    const page = doc.addPage([300, 300]);
    page.drawImage(img, { x: 10, y: 10, width: 100, height: 100 });
    page.drawText(`page ${i + 1}`, { x: 10, y: 250 });
  }
  return doc.save();
}

describe("analyzePdfImages", () => {
  it("counts images, JPEGs and exact duplicates", async () => {
    const a = await analyzePdfImages(await pdfWithRepeatedImage(4));
    expect(a.imageCount).toBe(4);
    expect(a.jpegCount).toBe(4);
    expect(a.duplicateCount).toBe(3);
    expect(a.duplicateBytes).toBe(3 * JPEG.length);
  });

  it("reports no images for a text-only PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("just text");
    const a = await analyzePdfImages(await doc.save());
    expect(a.imageCount).toBe(0);
    expect(describeAnalysis(a).suggestLossy).toBe(false);
  });
});

describe("describeAnalysis", () => {
  const base = { totalBytes: 1000, imageCount: 2, jpegCount: 2, imageBytes: 900, jpegBytes: 900, duplicateCount: 0, duplicateBytes: 0 };
  it("tells the user up front that an image-dominated PDF won't shrink losslessly", () => {
    const d = describeAnalysis(base);
    expect(d.suggestLossy).toBe(true);
    expect(d.advice).toMatch(/barely change/i);
  });
  it("does not push lossy compression on a mostly-text PDF", () => {
    expect(describeAnalysis({ ...base, imageBytes: 100, jpegBytes: 100 }).suggestLossy).toBe(false);
  });
  it("says when images are not JPEG and so cannot be recompressed", () => {
    expect(describeAnalysis({ ...base, jpegCount: 0, jpegBytes: 0 }).advice).toMatch(/only recompress JPEG/i);
  });
});

describe("compressPdfDocument", () => {
  it("lossless: merges exact duplicate images, keeps every page, and shrinks the file", async () => {
    const input = await pdfWithRepeatedImage(6);
    const result = await compressPdfDocument(input, "lossless");
    expect(result.duplicatesMerged).toBe(5);
    expect(result.imagesRecompressed).toBe(0);
    const out = await PDFDocument.load(new Uint8Array(await result.blob.arrayBuffer()));
    expect(out.getPageCount()).toBe(6);
    expect(result.newBytes).toBeLessThan(input.length);
    expect((await analyzePdfImages(new Uint8Array(await result.blob.arrayBuffer()))).imageCount).toBe(1);
  });

  it("lossless never re-encodes an image", async () => {
    let calls = 0;
    const spy: JpegReencoder = async () => {
      calls++;
      return null;
    };
    await compressPdfDocument(await pdfWithRepeatedImage(2), "lossless", spy);
    expect(calls).toBe(0);
  });

  it("balanced: replaces an image only when the re-encoded one is meaningfully smaller", async () => {
    const input = await pdfWithRepeatedImage(1);
    const bigger: JpegReencoder = async (jpeg) => ({ bytes: new Uint8Array(jpeg.length + 100), width: 1, height: 1 });
    const kept = await compressPdfDocument(input, "balanced", bigger);
    expect(kept.imagesRecompressed).toBe(0);
    expect(kept.imagesSkipped).toBe(1);

    const smaller: JpegReencoder = async (jpeg) => ({ bytes: jpeg.slice(0, Math.floor(jpeg.length * 0.5)), width: 1, height: 1 });
    const replaced = await compressPdfDocument(input, "balanced", smaller);
    expect(replaced.imagesRecompressed).toBe(1);
    expect(replaced.summary).toMatch(/re-encoded 1 image/i);
  });

  it("an image the re-encoder cannot handle is left exactly as it was", async () => {
    const input = await pdfWithRepeatedImage(1);
    const failing: JpegReencoder = async () => {
      throw new Error("decode failed");
    };
    const result = await compressPdfDocument(input, "small", failing);
    expect(result.imagesRecompressed).toBe(0);
    expect((await analyzePdfImages(new Uint8Array(await result.blob.arrayBuffer()))).imageCount).toBe(1);
  });

  it("the summary never claims work that wasn't done", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("text only");
    const r = await compressPdfDocument(await doc.save(), "lossless");
    expect(r.summary).toBe("Optimized the file structure.");
  });
});

describe("describeAnalysis with repeated images", () => {
  it("says lossless will help when merging repeats alone saves a lot (not 'barely change')", () => {
    const d = describeAnalysis({ totalBytes: 1000, imageCount: 6, jpegCount: 6, imageBytes: 990, jpegBytes: 990, duplicateCount: 5, duplicateBytes: 820 });
    expect(d.advice).toMatch(/Lossless mode should still help/);
    expect(d.advice).not.toMatch(/barely change/);
  });
});
