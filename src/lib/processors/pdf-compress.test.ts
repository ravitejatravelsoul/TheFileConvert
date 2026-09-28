import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
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
    // Every rung tried before the first one that fits must genuinely have missed the target — otherwise
    // the search didn't stop at the *first* (best-quality) success.
    const firstFit = r.attempts.findIndex((a) => a.bytes <= target);
    expect(firstFit).toBeGreaterThan(0);
    for (const earlier of r.attempts.slice(0, firstFit)) expect(earlier.bytes).toBeGreaterThan(target);
  });

  it("refines between the rung that missed and the rung that fit, keeping the largest result that still fits", async () => {
    const input = await pdfWithRepeatedImage(1);
    const smallest = await compressPdfToTarget(input, 1, scaledReencoder);
    const target = Math.round((smallest.newBytes + smallest.attempts[0].bytes) / 2);
    const r = await compressPdfToTarget(input, target, scaledReencoder);
    const fitting = r.attempts.filter((a) => a.bytes <= target);
    // The refinement tried settings after the first fitting rung…
    expect(r.attempts.some((a) => /^\d+% quality$/.test(a.label))).toBe(true);
    // …and the returned file is the largest (highest-quality) one that fits — never one over the target.
    expect(r.newBytes).toBe(Math.max(...fitting.map((a) => a.bytes)));
    expect(r.newBytes).toBeLessThanOrEqual(target);
  });

  it("never claims success it can't back up: an unreachable target returns the smallest safe result instead", async () => {
    const input = await pdfWithRepeatedImage(1);
    const r = await compressPdfToTarget(input, 1, scaledReencoder); // impossible target
    expect(r.targetAchieved).toBe(false);
    expect(r.rungLabel).toBe("closest safe result");
    expect(r.newBytes).toBeGreaterThan(1);
    // it tried every rung, not just gave up after one
    expect(r.attempts).toHaveLength(9); // lossless + 8 ladder rungs
    expect(r.newBytes).toBe(Math.min(...r.attempts.map((a) => a.bytes)));
  });
});

describe("compressionOutlook with repeated images", () => {
  it("mentions that repeats merge for free", () => {
    const o = compressionOutlook({ totalBytes: 1000, imageCount: 6, jpegCount: 6, imageBytes: 990, jpegBytes: 990, duplicateCount: 5, duplicateBytes: 820 });
    expect(o.text).toMatch(/5 repeated images can be merged for free/);
  });
});

/** Like pdfWithRepeatedImage(1), but the photo carries an ICC profile colour space and /ColorTransform 0,
 * exactly as Chrome's print-to-PDF (and Word, Preview, most scanner apps) write it. */
const PHOTO = new Uint8Array(fs.readFileSync(path.join(__dirname, "../../../e2e/fixtures/qa/img-landscape.jpg"))); // ~390 KB

async function pdfWithIccJpeg(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(PHOTO);
  const page = doc.addPage([300, 300]);
  page.drawImage(img, { x: 10, y: 10, width: 200, height: 200 });
  page.drawText("report", { x: 10, y: 250 });
  const icc = doc.context.register(doc.context.stream(new Uint8Array(600), { N: 3 }));
  await doc.flush();
  const stream = doc.context.lookup(img.ref) as PDFRawStream;
  stream.dict.set(PDFName.of("ColorSpace"), doc.context.obj([PDFName.of("ICCBased"), icc]));
  stream.dict.set(PDFName.of("ColorTransform"), PDFNumber.of(0));
  return doc.save();
}

describe("target contract: small files and ICC-profile images (regression)", () => {
  const halfSize: JpegReencoder = async (jpeg, { quality }) => ({ bytes: jpeg.slice(0, Math.max(1, Math.floor(jpeg.length * quality * 0.5))), width: 1, height: 1 });

  it("re-encodes an ICC-profile JPEG instead of skipping it, so an input over the target really shrinks", async () => {
    const input = await pdfWithIccJpeg();
    const target = Math.round(input.length * 0.7);
    const r = await compressPdfToTarget(input, target, halfSize);
    expect(input.length).toBeGreaterThan(target);
    expect(r.imagesRecompressed).toBe(1);
    expect(r.targetAchieved).toBe(true);
    expect(r.newBytes).toBeLessThanOrEqual(target);
    expect(r.newBytes).toBeLessThan(input.length);
  });

  it("drops an inherited /ColorTransform 0 from the re-encoded image", async () => {
    const input = await pdfWithIccJpeg();
    const r = await compressPdfToTarget(input, Math.round(input.length * 0.7), halfSize);
    const out = await PDFDocument.load(new Uint8Array(await r.blob.arrayBuffer()));
    for (const [, obj] of out.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") {
        expect(obj.dict.get(PDFName.of("ColorTransform"))).toBeUndefined();
        expect(obj.dict.get(PDFName.of("ColorSpace"))?.toString()).toBe("/DeviceRGB");
      }
    }
  });

  it("never reports success for an input over the target unless the output is at or under it", async () => {
    const input = await pdfWithIccJpeg();
    for (const share of [0.9, 0.6, 0.3, 0.01]) {
      const target = Math.round(input.length * share);
      const r = await compressPdfToTarget(input, target, halfSize);
      expect(r.targetAchieved).toBe(r.newBytes <= target);
    }
  });

  it("returns the original byte-for-byte when it is already at or under the target", async () => {
    const input = await pdfWithIccJpeg();
    for (const target of [input.length, input.length + 1, input.length * 2]) {
      const r = await compressPdfToTarget(input, target, halfSize);
      expect(r.targetAchieved).toBe(true);
      expect(r.attempts).toHaveLength(0);
      expect(Buffer.from(await r.blob.arrayBuffer()).equals(Buffer.from(input))).toBe(true); // byte-for-byte (fast compare)
    }
  });

  it("the up-front outlook counts an ICC-profile JPEG as recompressible", async () => {
    const a = await analyzePdfImages(await pdfWithIccJpeg());
    expect(a.jpegCount).toBe(1);
    expect(compressionOutlook(a).kind).not.toBe("unsupported-images");
  });
});

describe("lossless compression of uncompressed streams", () => {
  async function pdfWithRawText(pages: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont("Helvetica");
    for (let p = 0; p < pages; p++) {
      const page = doc.addPage([612, 792]);
      page.drawText("x", { x: 10, y: 10, size: 1, font }); // registers the font as /F… on the page
      const fontKey = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict).keys()[0].asString();
      const ops = Array.from({ length: 60 }, (_, i) => `BT ${fontKey} 10 Tf 56 ${740 - i * 11} Td (Line ${i + 1} of page ${p + 1}: quarterly report text that repeats a lot) Tj ET`).join("\n");
      page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(ops))); // stored with no /Filter
    }
    return doc.save({ useObjectStreams: false });
  }

  it("Flate-compresses unfiltered content streams, keeps every page and the text, and reports it", async () => {
    const input = await pdfWithRawText(6);
    const analysis = await analyzePdfImages(input);
    expect(analysis.unfilteredBytes).toBeGreaterThan(input.length * 0.5);
    expect(compressionOutlook(analysis).kind).toBe("good-room");
    const result = await compressPdfToTarget(input, Math.floor(input.length * 0.5));
    expect(result.targetAchieved).toBe(true);
    expect(result.rungLabel).toMatch(/^lossless/);
    const out = new Uint8Array(await result.blob.arrayBuffer());
    const reopened = await PDFDocument.load(out);
    expect(reopened.getPageCount()).toBe(6);
    const contents = reopened.getPage(3).node.lookup(PDFName.of("Contents"));
    expect(contents).toBeInstanceOf(PDFRawStream);
    expect((contents as PDFRawStream).dict.get(PDFName.of("Filter"))?.toString()).toBe("/FlateDecode");
    const { inflate } = await import("@/lib/pdf/zlib");
    expect(new TextDecoder().decode(await inflate((contents as PDFRawStream).contents))).toContain("Line 60 of page 4");
  });
});

describe("compressPdfToTarget refuses unreadable input even when it is under the target", () => {
  it("does not return a damaged PDF or a non-PDF as 'already under your target'", async () => {
    const notPdf = new TextEncoder().encode("This is not a PDF, it only has the extension.\n");
    await expect(compressPdfToTarget(new Uint8Array(notPdf), 1_000_000)).rejects.toThrow();
    const good = await pdfWithRepeatedImage(2);
    const truncated = good.slice(0, Math.floor(good.length * 0.4));
    await expect(compressPdfToTarget(truncated, 1_000_000)).rejects.toThrow();
    const ok = await compressPdfToTarget(good, 1_000_000);
    expect(ok.rungLabel).toMatch(/already under/);
    expect(new Uint8Array(await ok.blob.arrayBuffer())).toEqual(good);
  });
});

describe("duplicate-image merge repoints every reference (regression: dangling refs from form XObjects)", () => {
  it("a duplicate used inside a form XObject still resolves after the merge", async () => {
    const doc = await PDFDocument.create();
    const a = await doc.embedJpg(JPEG);
    const b = await doc.embedJpg(JPEG); // byte-identical duplicate
    const page = doc.addPage([300, 300]);
    page.drawImage(a, { x: 10, y: 10, width: 100, height: 100 });
    // A form XObject (like a stamp or a letterhead) whose own resources use the duplicate.
    const ctx = doc.context;
    await a.embed();
    await b.embed();
    const form = ctx.stream("q 100 0 0 100 0 0 cm /ImDup Do Q", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 100, 100],
      Resources: { XObject: { ImDup: b.ref } },
    });
    const formRef = ctx.register(form);
    const stampKey = page.node.newXObject("Stamp", formRef);
    page.node.addContentStream(ctx.register(ctx.stream(`q 1 0 0 1 150 150 cm ${stampKey.asString()} Do Q`)));
    const input = await doc.save({ useObjectStreams: false });

    const result = await compressPdfDocument(input, "lossless");
    expect(result.duplicatesMerged).toBe(1);
    const out = new Uint8Array(await result.blob.arrayBuffer());
    const { verifyPdfBytes } = await import("@/lib/pdf/save");
    expect(await verifyPdfBytes(out, { pages: 1 })).toEqual([]);
    const reopened = await PDFDocument.load(out);
    const stamp = reopened.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).lookup(stampKey) as PDFRawStream;
    const inner = stamp.dict.lookup(PDFName.of("Resources"), PDFDict).lookup(PDFName.of("XObject"), PDFDict).get(PDFName.of("ImDup"));
    expect(reopened.context.lookup(inner as never)).toBeInstanceOf(PDFRawStream);
  });
});
