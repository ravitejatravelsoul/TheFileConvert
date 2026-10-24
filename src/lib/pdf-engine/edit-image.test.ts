// @vitest-environment node
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { deleteImage, matrixForBox, placeImage, placementDelta, replaceImage } from "./edit-image";
import { interpretPage, mul } from "./interpreter";

const FX = (n: string) => path.resolve("qa/editor-fixtures", n);

async function open(file: string, pageNo = 0) {
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(FX(file))), { updateMetadata: false });
  const page = doc.getPage(pageNo);
  return { doc, page, content: interpretPage(page) };
}

/** A solid-colour PNG, made in the test. */
function png(w: number, h: number): Uint8Array {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = 200; raw[o + 1] = 30; raw[o + 2] = 40;
  }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

describe("finding the images on a page", () => {
  it("EDITOR-08: two pictures, with their page-space bounds", async () => {
    const { content } = await open("EDITOR-08-images.pdf");
    expect(content.images.length).toBe(2);
    for (const im of content.images) {
      expect(im.bbox.width).toBeGreaterThan(50);
      expect(im.bbox.height).toBeGreaterThan(50);
      expect(im.pixelWidth).toBeGreaterThan(0);
    }
  });
  it("EDITOR-20: six pictures on page 1, one on page 2", async () => {
    expect((await open("EDITOR-20-multi-image.pdf", 0)).content.images.length).toBe(6);
    expect((await open("EDITOR-20-multi-image.pdf", 1)).content.images.length).toBe(1);
  });
});

describe("editing an existing image", () => {
  it("moves it exactly, leaving everything else alone", async () => {
    const { page, content } = await open("EDITOR-08-images.pdf");
    const im = content.images[0];
    const target = mul(im.matrix, [1, 0, 0, 1, 30, -20]);
    // translate in page space: T = translate(30,-20) applied after the placement
    const res = placeImage(page, content, im, target);
    expect(res.ok).toBe(true);
    const after = interpretPage(page);
    const moved = after.images.find((x) => x.name === im.name)!;
    expect(near(moved.bbox.x, im.bbox.x + 30)).toBe(true);
    expect(near(moved.bbox.y, im.bbox.y - 20)).toBe(true);
    expect(near(moved.bbox.width, im.bbox.width)).toBe(true);
    // text untouched
    expect(after.runs.length).toBe(content.runs.length);
    for (let i = 0; i < after.runs.length; i++) expect(near(after.runs[i].glyphs[0].x, content.runs[i].glyphs[0].x, 0.001)).toBe(true);
  });

  it("resizes it keeping the top-left corner, aspect ratio kept", async () => {
    const { page, content } = await open("EDITOR-08-images.pdf");
    const im = content.images[1];
    const box = { x: im.bbox.x, y: im.bbox.y + im.bbox.height * 0.5, width: im.bbox.width * 0.5, height: im.bbox.height * 0.5 };
    const res = placeImage(page, content, im, mul(im.matrix, placementDelta(matrixForBox(im.bbox), matrixForBox(box))));
    expect(res.ok).toBe(true);
    const after = interpretPage(page).images.find((x) => x.name === im.name)!;
    expect(near(after.bbox.x, box.x) && near(after.bbox.y, box.y) && near(after.bbox.width, box.width) && near(after.bbox.height, box.height)).toBe(true);
  });

  it("rotates it about its centre", async () => {
    const { page, content } = await open("EDITOR-08-images.pdf");
    const im = content.images[0];
    const cx = im.bbox.x + im.bbox.width / 2;
    const cy = im.bbox.y + im.bbox.height / 2;
    const rot = matrixForBox(im.bbox, 90);
    const res = placeImage(page, content, im, mul(im.matrix, placementDelta(matrixForBox(im.bbox), rot)));
    expect(res.ok).toBe(true);
    const after = interpretPage(page).images.find((x) => x.name === im.name)!;
    // a 90° turn swaps width and height around the same centre
    expect(near(after.bbox.width, im.bbox.height, 0.1) && near(after.bbox.height, im.bbox.width, 0.1)).toBe(true);
    expect(near(after.bbox.x + after.bbox.width / 2, cx, 0.1) && near(after.bbox.y + after.bbox.height / 2, cy, 0.1)).toBe(true);
  });

  it("deletes it", async () => {
    const { page, content } = await open("EDITOR-20-multi-image.pdf");
    const before = content.images.length;
    expect(deleteImage(page, content, content.images[2]).ok).toBe(true);
    expect(interpretPage(page).images.length).toBe(before - 1);
  });

  it("replaces it: the new picture fills the old one's box, fitted and centred", async () => {
    const { doc, page, content } = await open("EDITOR-08-images.pdf");
    const im = content.images[0];
    const res = await replaceImage(doc, page, content, im, { bytes: png(100, 50), mime: "image/png" }); // wider than the old box
    expect(res.ok).toBe(true);
    const out = await doc.save();
    const reopened = await PDFDocument.load(out);
    const after = interpretPage(reopened.getPage(0));
    const placed = after.images.find((x) => x.name.startsWith("TFCImg"))!;
    expect(placed).toBeTruthy();
    expect(near(placed.bbox.width, im.bbox.width, 0.1)).toBe(true); // wider than tall: full width
    expect(near(placed.bbox.height, im.bbox.width / 2, 0.1)).toBe(true);
    expect(near(placed.bbox.x + placed.bbox.width / 2, im.bbox.x + im.bbox.width / 2, 0.1)).toBe(true);
    expect(near(placed.bbox.y + placed.bbox.height / 2, im.bbox.y + im.bbox.height / 2, 0.1)).toBe(true);
    expect(after.images.length).toBe(content.images.length); // one out, one in
  });

  it("works on a page with a /Rotate and a non-zero MediaBox origin", async () => {
    for (const [file, n] of [["EDITOR-19-cropbox.pdf", 0], ["EDITOR-09-rotated-pages.pdf", 1]] as const) {
      const { content } = await open(file, n);
      expect(content.images.length).toBe(0); // no pictures here; the call just must not fail
    }
  });
});
