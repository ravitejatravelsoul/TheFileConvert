import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFRef } from "pdf-lib";
import { loadPdfForEditing } from "./load";
import { OutputIntegrityError, savePdfChecked, verifyPdfBytes } from "./save";
import { withGenerationOneCatalog } from "./test-fixtures";
import { compressPdfToTarget, type JpegReencoder } from "@/lib/processors/pdf-compress";
import { extractPages, mergePdfs } from "@/lib/processors/pdf";

const PHOTO = new Uint8Array(fs.readFileSync(path.join(__dirname, "../../../e2e/fixtures/qa/img-landscape.jpg")));
const TINY = new Uint8Array(fs.readFileSync(path.join(__dirname, "../../../e2e/fixtures/sample.jpg")));

async function scanLikePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const img = await doc.embedJpg(PHOTO);
    doc.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  }
  return withGenerationOneCatalog(await doc.save({ useObjectStreams: false }));
}

describe("verifyPdfBytes (output integrity check)", () => {
  it("catches the release-blocking bug: a generation-1 catalog saved by plain pdf-lib is unopenable", async () => {
    const input = await scanLikePdf();
    // The fixture itself is a valid PDF…
    expect(await verifyPdfBytes(input, { pages: 2 })).toEqual([]);
    // …but loading it the old way and saving it produced a file whose trailer leads nowhere.
    const old = await PDFDocument.load(input, { updateMetadata: false });
    const problems = await verifyPdfBytes(await old.save({ useObjectStreams: true }), { pages: 2 });
    expect(problems.length).toBeGreaterThan(0);
    await expect(savePdfChecked(await PDFDocument.load(input, { updateMetadata: false }), { useObjectStreams: true })).rejects.toBeInstanceOf(OutputIntegrityError);
  });

  it("passes the same file saved through loadPdfForEditing, in both save modes", async () => {
    for (const useObjectStreams of [true, false]) {
      const doc = await loadPdfForEditing(await scanLikePdf());
      const bytes = await savePdfChecked(doc, { useObjectStreams });
      expect(await verifyPdfBytes(bytes, { pages: 2 })).toEqual([]);
    }
  });

  it("rejects truncated, empty and wrong-page-count output", async () => {
    const good = await (await PDFDocument.create()).save();
    expect(await verifyPdfBytes(new Uint8Array(0))).not.toEqual([]);
    expect(await verifyPdfBytes(good.subarray(0, Math.floor(good.length / 2)))).not.toEqual([]);
    const doc = await PDFDocument.create();
    doc.addPage();
    expect(await verifyPdfBytes(await doc.save(), { pages: 3 })).toEqual(["expected 3 pages, found 1"]);
  });
});

describe("Compress PDF on a generation-1 (incrementally updated) scan", () => {
  // Deterministic stand-in for the browser's canvas encoder: returns a small, complete JPEG.
  const reencode: JpegReencoder = async () => ({ bytes: TINY, width: 8, height: 8 });

  it("regression A: an output under the target is also a valid, openable PDF with every page", async () => {
    const input = await scanLikePdf(2);
    const target = Math.floor(input.length / 4);
    const result = await compressPdfToTarget(input, target, reencode);
    expect(result.targetAchieved).toBe(true);
    const out = new Uint8Array(await result.blob.arrayBuffer());
    expect(out.length).toBeLessThanOrEqual(target);
    expect(await verifyPdfBytes(out, { pages: 2 })).toEqual([]);
    const reopened = await PDFDocument.load(out);
    expect((reopened.context.trailerInfo.Root as PDFRef).generationNumber).toBe(0);
    expect(reopened.getPageCount()).toBe(2);
  });

  it("other writers (merge, extract) also produce valid files from it", async () => {
    const input = await scanLikePdf(2);
    const file = new File([input as BlobPart], "scan.pdf", { type: "application/pdf" });
    const merged = new Uint8Array(await (await mergePdfs([file, file])).arrayBuffer());
    expect(await verifyPdfBytes(merged, { pages: 4 })).toEqual([]);
    const split = new Uint8Array(await (await extractPages(file, "2")).arrayBuffer());
    expect(await verifyPdfBytes(split, { pages: 1 })).toEqual([]);
  });
});
