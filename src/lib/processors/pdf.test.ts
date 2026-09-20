import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { addHeaderFooter, addPageNumbers, addWatermark, displayedPage, parsePageRanges, ProcessorError, removePdfMetadata, watermarkOrigin } from "./pdf";

describe("parsePageRanges", () => {
  it("parses a single page", () => {
    expect(parsePageRanges("3", 10)).toEqual([2]);
  });

  it("parses a range", () => {
    expect(parsePageRanges("2-4", 10)).toEqual([1, 2, 3]);
  });

  it("parses a mix of pages and ranges, sorted and deduped", () => {
    expect(parsePageRanges("5, 1-3, 3", 10)).toEqual([0, 1, 2, 4]);
  });

  it("swaps a reversed range", () => {
    expect(parsePageRanges("4-2", 10)).toEqual([1, 2, 3]);
  });

  it("ignores out-of-bounds page numbers", () => {
    expect(parsePageRanges("1, 99", 10)).toEqual([0]);
  });

  it("throws on empty input", () => {
    expect(() => parsePageRanges("", 10)).toThrow(ProcessorError);
  });

  it("throws on unparseable tokens", () => {
    expect(() => parsePageRanges("abc", 10)).toThrow(ProcessorError);
  });

  it("throws when nothing in range exists in the document", () => {
    expect(() => parsePageRanges("50-60", 10)).toThrow(ProcessorError);
  });
});

describe("watermarkOrigin", () => {
  // Where the text's center ends up, given the origin and rotation.
  function centerOf(o: { x: number; y: number }, textWidth: number, size: number, deg: number) {
    const t = (deg * Math.PI) / 180;
    const halfW = textWidth / 2;
    const halfH = size * 0.35;
    return { x: o.x + halfW * Math.cos(t) - halfH * Math.sin(t), y: o.y + halfW * Math.sin(t) + halfH * Math.cos(t) };
  }

  it("keeps the rotated watermark centered on the page at every angle", () => {
    for (const deg of [0, 45, -45, 90, 180, 270]) {
      const o = watermarkOrigin(600, 800, 240, 48, deg);
      const c = centerOf(o, 240, 48, deg);
      expect(c.x).toBeCloseTo(300, 6);
      expect(c.y).toBeCloseTo(400, 6);
    }
  });

  it("matches the old (horizontal) placement closely at 0 degrees", () => {
    const o = watermarkOrigin(600, 800, 240, 48, 0);
    expect(o.x).toBeCloseTo(300 - 120, 6);
  });
});

describe("stamps follow the displayed page (rotation-aware)", () => {
  async function pageWithRotation(angle: number, size: [number, number] = [400, 600]) {
    const doc = await PDFDocument.create();
    const page = doc.addPage(size);
    page.setRotation(degrees(angle));
    return { doc, page };
  }

  it("maps displayed bottom-left/top-right corners back into page space for each /Rotate", async () => {
    const cases: [number, [number, number], [number, number], [number, number]][] = [
      // angle, displayed size, page point of displayed (0,0), page point of displayed (dw,dh)
      [0, [400, 600], [0, 0], [400, 600]],
      [90, [600, 400], [400, 0], [0, 600]],
      [180, [400, 600], [400, 600], [0, 0]],
      [270, [600, 400], [0, 600], [400, 0]],
    ];
    for (const [angle, shownSize, origin, far] of cases) {
      const { page } = await pageWithRotation(angle);
      const shown = displayedPage(page);
      expect([shown.width, shown.height]).toEqual(shownSize);
      expect(shown.toPage(0, 0)).toEqual({ x: origin[0], y: origin[1] });
      expect(shown.toPage(shown.width, shown.height)).toEqual({ x: far[0], y: far[1] });
    }
  });

  it("respects a CropBox that doesn't start at the origin", async () => {
    const { page } = await pageWithRotation(0, [400, 600]);
    page.setCropBox(50, 100, 200, 300);
    expect(displayedPage(page).toPage(10, 20)).toEqual({ x: 60, y: 120 });
  });

  it("page numbers and header/footer on a rotated PDF don't throw and keep the page count", async () => {
    const { doc, page } = await pageWithRotation(90);
    page.drawText("body", { x: 50, y: 50 });
    const file = new File([(await doc.save()) as BlobPart], "r.pdf", { type: "application/pdf" });
    const numbered = await addPageNumbers(file, { position: "bottom-center", startAt: 1, fontSize: 11 });
    expect((await PDFDocument.load(await numbered.arrayBuffer())).getPageCount()).toBe(1);
    const hf = await addHeaderFooter(new File([numbered], "n.pdf"), { text: "Page {page}", position: "footer", align: "center", fontSize: 10 });
    expect((await PDFDocument.load(await hf.arrayBuffer())).getPage(0).getRotation().angle).toBe(90);
  });

  it("watermark text with a character the PDF font can't draw fails with a plain-language message", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const file = new File([(await doc.save()) as BlobPart], "w.pdf", { type: "application/pdf" });
    await expect(addWatermark(file, { text: "Done ✓", opacity: 0.3, fontSize: 40, rotationDegrees: 0 })).rejects.toThrow(/can't draw/i);
  });
});

describe("removePdfMetadata removes every info entry and the XMP stream", () => {
  it("leaves no title/author/producer/dates behind", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle("T");
    doc.setAuthor("A");
    doc.setProducer("P");
    doc.setCreationDate(new Date());
    const out = await removePdfMetadata(new File([(await doc.save()) as BlobPart], "m.pdf", { type: "application/pdf" }));
    const back = await PDFDocument.load(await out.arrayBuffer(), { updateMetadata: false });
    expect(back.getTitle()).toBeUndefined();
    expect(back.getAuthor()).toBeUndefined();
    expect(back.getProducer()).toBeUndefined();
    expect(back.getCreationDate()).toBeUndefined();
    expect(back.getPageCount()).toBe(1);
  });
});
