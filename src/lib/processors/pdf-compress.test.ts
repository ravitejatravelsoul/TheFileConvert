import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { analyzePdfImages, compressPdfDocument, compressPdfToTarget, compressionOutlook, type JpegReencoder } from "./pdf-compress";

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
    expect(compressionOutlook(a).kind).toBe("text-only");
  });
});

describe("compressionOutlook", () => {
  const base = { totalBytes: 1000, imageCount: 2, jpegCount: 2, imageBytes: 900, jpegBytes: 900, duplicateCount: 0, duplicateBytes: 0 };
  it("says an image-heavy PDF has room to shrink", () => {
    const o = compressionOutlook(base);
    expect(o.kind).toBe("good-room");
    expect(o.text).toMatch(/90% of the file/);
  });
  it("sets modest expectations for a mostly-text PDF", () => {
    expect(compressionOutlook({ ...base, imageBytes: 100, jpegBytes: 100 }).kind).toBe("little-room");
  });
  it("says when the images are in encodings that are kept as-is", () => {
    expect(compressionOutlook({ ...base, jpegCount: 0, jpegBytes: 0 }).kind).toBe("unsupported-images");
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

describe("compressPdfToTarget", () => {
  // A deterministic fake: output size is exactly `quality` of the input, so which ladder rung
  // "won" is verifiable from the returned quality.
  const scaledReencoder: JpegReencoder = async (jpeg, { quality }) => ({ bytes: jpeg.slice(0, Math.max(1, Math.floor(jpeg.length * quality))), width: 1, height: 1 });

  it("stops at the free lossless pass when that already meets the target", async () => {
    const input = await pdfWithRepeatedImage(3);
    const lossless = await compressPdfDocument(input, "lossless");
    const r = await compressPdfToTarget(input, lossless.newBytes + 1, scaledReencoder);
    expect(r.targetAchieved).toBe(true);
    expect(r.rungLabel).toBe("lossless (no quality loss)");
    expect(r.attempts).toHaveLength(1);
  });

  it("walks the quality ladder and stops at the first (highest-quality) rung that fits, not a later/worse one", async () => {
    const input = await pdfWithRepeatedImage(1);
    // A target only the middle of the ladder can reach (found by probing the smallest achievable size).
    const smallest = await compressPdfToTarget(input, 1, scaledReencoder);
    const target = Math.round((smallest.newBytes + smallest.attempts[0].bytes) / 2);
    const r = await compressPdfToTarget(input, target, scaledReencoder);
    expect(r.targetAchieved).toBe(true);
    expect(r.newBytes).toBeLessThanOrEqual(target);
    // Every rung tried before the winning one must genuinely have missed the target — otherwise the
    // search didn't stop at the *first* (best-quality) success.
    const wonAt = r.attempts.findIndex((a) => a.label === r.rungLabel);
    expect(wonAt).toBeGreaterThan(0);
    for (const earlier of r.attempts.slice(0, wonAt)) expect(earlier.bytes).toBeGreaterThan(target);
  });

  it("never claims success it can't back up: an unreachable target returns the smallest safe result instead", async () => {
    const input = await pdfWithRepeatedImage(1);
    const r = await compressPdfToTarget(input, 1, scaledReencoder); // impossible target
    expect(r.targetAchieved).toBe(false);
    expect(r.rungLabel).toBe("closest safe result");
    expect(r.newBytes).toBeGreaterThan(1);
    // it tried every rung, not just gave up after one
    expect(r.attempts).toHaveLength(8); // lossless + 7 ladder rungs
    expect(r.newBytes).toBe(Math.min(...r.attempts.map((a) => a.bytes)));
  });
});

describe("compressionOutlook with repeated images", () => {
  it("mentions that repeats merge for free", () => {
    const o = compressionOutlook({ totalBytes: 1000, imageCount: 6, jpegCount: 6, imageBytes: 990, jpegBytes: 990, duplicateCount: 5, duplicateBytes: 820 });
    expect(o.text).toMatch(/5 repeated images can be merged for free/);
  });
});
