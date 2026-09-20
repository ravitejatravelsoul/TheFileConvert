import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { ascii85Decode, decodeFlateImage, undoPngPredictor } from "./pdf-image-decode";
import { analyzePdfImages, compressPdfDocument, describeAnalysis, type RawReencoder } from "./pdf-compress";

function ascii85Encode(buf: Uint8Array): string {
  let out = "";
  for (let i = 0; i < buf.length; i += 4) {
    const n = Math.min(4, buf.length - i);
    let v = 0;
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? buf[i + k] : 0);
    if (n === 4 && v === 0) {
      out += "z";
      continue;
    }
    const c: string[] = [];
    for (let k = 4; k >= 0; k--) {
      c[k] = String.fromCharCode((v % 85) + 33);
      v = Math.floor(v / 85);
    }
    out += c.slice(0, n + 1).join("");
  }
  return out + "~>";
}

function gradientRgb(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    px[i * 3] = i % 251;
    px[i * 3 + 1] = (i * 7) % 253;
    px[i * 3 + 2] = (i * 13) % 255;
  }
  return px;
}

async function pdfWithFlateImage(kind: "flate" | "a85flate" | "predictor", w = 40, h = 30) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const rgb = gradientRgb(w, h);
  const dict = ctx.obj({ Type: "XObject", Subtype: "Image", Width: w, Height: h, ColorSpace: "DeviceRGB", BitsPerComponent: 8 });
  let bytes: Uint8Array;
  if (kind === "flate") {
    bytes = deflateSync(rgb);
    dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
  } else if (kind === "a85flate") {
    bytes = Buffer.from(ascii85Encode(deflateSync(rgb)), "latin1");
    dict.set(PDFName.of("Filter"), ctx.obj([PDFName.of("ASCII85Decode"), PDFName.of("FlateDecode")]));
  } else {
    const row = w * 3;
    const filtered = new Uint8Array((row + 1) * h);
    for (let y = 0; y < h; y++) {
      filtered[y * (row + 1)] = 2; // "Up"
      for (let x = 0; x < row; x++) filtered[y * (row + 1) + 1 + x] = (rgb[y * row + x] - (y ? rgb[(y - 1) * row + x] : 0)) & 255;
    }
    bytes = deflateSync(filtered);
    dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
    dict.set(PDFName.of("DecodeParms"), ctx.obj({ Predictor: 15, Colors: 3, BitsPerComponent: 8, Columns: w }));
  }
  dict.set(PDFName.of("Length"), PDFNumber.of(bytes.length));
  const ref = ctx.register(PDFRawStream.of(dict, bytes));
  const page = doc.addPage([200, 150]);
  const res = page.node.Resources() ?? ctx.obj({});
  const xo = ctx.obj({});
  xo.set(PDFName.of("Im1"), ref);
  res.set(PDFName.of("XObject"), xo);
  page.node.set(PDFName.of("Resources"), res);
  page.node.addContentStream(ctx.register(ctx.stream("q 200 0 0 150 0 0 cm /Im1 Do Q")));
  return { bytes: await doc.save(), rgb };
}

describe("ASCII85 and predictors", () => {
  it("decodes ASCII85 including the z shortcut and a partial final group", () => {
    const src = new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
    expect(Array.from(ascii85Decode(new TextEncoder().encode(ascii85Encode(src))))).toEqual(Array.from(src));
  });

  it("undoes PNG Sub/Up/Average/Paeth row filters", () => {
    const rows = [[10, 20, 30, 40, 50, 60], [11, 22, 33, 44, 55, 66], [12, 25, 31, 47, 59, 61], [9, 9, 9, 200, 200, 200]];
    for (const type of [0, 1, 2, 3, 4]) {
      const enc: number[] = [];
      rows.forEach((r, y) => {
        enc.push(type);
        r.forEach((v, x) => {
          const left = x >= 3 ? r[x - 3] : 0;
          const up = y ? rows[y - 1][x] : 0;
          const ul = y && x >= 3 ? rows[y - 1][x - 3] : 0;
          const pred = type === 0 ? 0 : type === 1 ? left : type === 2 ? up : type === 3 ? (left + up) >> 1 : (() => { const p = left + up - ul; const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul); return pa <= pb && pa <= pc ? left : pb <= pc ? up : ul; })();
          enc.push((v - pred) & 255);
        });
      });
      expect(Array.from(undoPngPredictor(Uint8Array.from(enc), 6, 3))).toEqual(rows.flat());
    }
  });
});

describe("Flate scans are recognised and recompressed", () => {
  for (const kind of ["flate", "a85flate", "predictor"] as const) {
    it(`decodes ${kind} RGB images to the exact original pixels`, async () => {
      const { bytes, rgb } = await pdfWithFlateImage(kind);
      const doc = await PDFDocument.load(bytes);
      const [, obj] = [...doc.context.enumerateIndirectObjects()].find(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype"))?.toString() === "/Image")!;
      const raw = await decodeFlateImage((obj as PDFRawStream).dict, (obj as PDFRawStream).contents);
      expect(raw?.width).toBe(40);
      expect(Array.from(raw!.pixels)).toEqual(Array.from(rgb));
    });
  }

  it("analysis counts them and the advice says a lossy level will help (no longer 'none are JPEG')", async () => {
    const { bytes } = await pdfWithFlateImage("a85flate", 200, 200);
    const a = await analyzePdfImages(bytes);
    expect(a.flateCount).toBe(1);
    const d = describeAnalysis(a);
    expect(d.suggestLossy).toBe(true);
    expect(d.advice).toMatch(/Balanced or Smallest/);
  });

  it("Balanced replaces a Flate image with a JPEG stream when that is smaller, Lossless leaves it alone", async () => {
    const { bytes } = await pdfWithFlateImage("a85flate", 200, 200);
    const fake: RawReencoder = async (img) => ({ bytes: new Uint8Array(Math.floor(img.pixels.length / 50)), width: img.width, height: img.height });
    const lossless = await compressPdfDocument(bytes, "lossless", undefined, fake);
    expect(lossless.imagesRecompressed).toBe(0);
    const balanced = await compressPdfDocument(bytes, "balanced", undefined, fake);
    expect(balanced.imagesRecompressed).toBe(1);
    expect(balanced.newBytes).toBeLessThan(bytes.length * 0.5);
    const out = await PDFDocument.load(new Uint8Array(await balanced.blob.arrayBuffer()));
    const img = [...out.context.enumerateIndirectObjects()].map(([, o]) => o).find((o) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") as PDFRawStream;
    expect(img.dict.get(PDFName.of("Filter"))?.toString()).toBe("/DCTDecode");
    expect(img.dict.get(PDFName.of("DecodeParms"))).toBeUndefined();
  });

  it("keeps the original when re-encoding is not at least 5% smaller", async () => {
    const { bytes } = await pdfWithFlateImage("flate", 60, 60);
    const bigger: RawReencoder = async (img) => ({ bytes: new Uint8Array(img.pixels.length), width: img.width, height: img.height });
    const r = await compressPdfDocument(bytes, "balanced", undefined, bigger);
    expect(r.imagesRecompressed).toBe(0);
    expect(r.imagesSkipped).toBe(1);
  });
});
