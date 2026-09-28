import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PageImage, PageInput, TextItem } from "./layout";

/**
 * Browser side of PDF → Word: reads each page with pdf.js (positioned text, fonts, pictures), decides
 * whether the page has a real text layer, and recognises scanned pages with the local OCR engine. The
 * output is page input for layout.ts, in each page's reading frame.
 */

export type PageKind = "text" | "scanned" | "blank";

export interface PdfAnalysis {
  pages: number;
  kinds: PageKind[];
  /** "Text PDF" / "Scanned PDF" / "Mixed PDF" */
  label: "Text PDF" | "Scanned PDF" | "Mixed PDF";
}

export type Progress = { stage: "reading"; page: number; total: number } | { stage: "ocr"; index: number; total: number; fraction: number } | { stage: "building" };

/** Fewer visible characters than this, with a picture covering most of the page, means a scan. */
const MIN_TEXT_CHARS = 20;

export class PdfToWordError extends Error {}

async function openDocument(file: File): Promise<{ doc: PDFDocumentProxy; close: () => Promise<void> }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (e) {
    void task.destroy();
    if ((e as { name?: string })?.name === "PasswordException")
      throw new PdfToWordError("This PDF is protected with a password. Remove the password in your PDF app, then try again.");
    throw new PdfToWordError("This PDF couldn't be read. It may be damaged or incomplete.");
  }
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Rotates page-space points into the reading frame (text along +x) and shifts them to start at 0. */
function frameFor(view: number[], angle: number) {
  const [x0, y0, x1, y1] = view;
  const rad = (-angle * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad) * 1e6) / 1e6;
  const sin = Math.round(Math.sin(rad) * 1e6) / 1e6;
  const rot = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
  const corners = [rot(x0, y0), rot(x1, y0), rot(x0, y1), rot(x1, y1)];
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxX = Math.max(...corners.map((c) => c.x));
  const maxY = Math.max(...corners.map((c) => c.y));
  return {
    width: maxX - minX,
    height: maxY - minY,
    point: (x: number, y: number) => {
      const p = rot(x, y);
      return { x: p.x - minX, y: p.y - minY };
    },
  };
}

function fontStyle(page: PDFPageProxy, fontName: string): { bold: boolean; italic: boolean } {
  let name = fontName;
  let flags: { bold?: boolean; italic?: boolean; black?: boolean } = {};
  try {
    if (page.commonObjs.has(fontName)) {
      const font = page.commonObjs.get(fontName) as { name?: string; bold?: boolean; italic?: boolean; black?: boolean };
      name = font?.name ?? fontName;
      flags = font ?? {};
    }
  } catch {
    // Font not loaded: fall back to the name.
  }
  return {
    bold: Boolean(flags.bold || flags.black) || /bold|black|heavy|semibold|demi/i.test(name),
    italic: Boolean(flags.italic) || /italic|oblique/i.test(name),
  };
}

async function imageToBytes(img: unknown): Promise<{ bytes: Uint8Array; mime: "image/png" | "image/jpeg"; w: number; h: number } | null> {
  const o = img as { bitmap?: ImageBitmap; width?: number; height?: number; data?: Uint8ClampedArray | Uint8Array; kind?: number };
  const w = o?.bitmap?.width ?? o?.width ?? 0;
  const h = o?.bitmap?.height ?? o?.height ?? 0;
  if (!w || !h) return null;
  // Big photos are scaled to at most 2000 px on the long side — plenty for a document, and it keeps
  // the .docx a sensible size.
  const k = Math.min(1, 2000 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let hasAlpha = false;
  if (o.bitmap) ctx.drawImage(o.bitmap, 0, 0, cw, ch);
  else if (o.data) {
    const src = document.createElement("canvas");
    src.width = w;
    src.height = h;
    const sctx = src.getContext("2d");
    if (!sctx) return null;
    const out = sctx.createImageData(w, h);
    const d = o.data;
    if (o.kind === 3) {
      out.data.set(d.subarray(0, w * h * 4));
      for (let i = 3; i < out.data.length; i += 4 * 97) if (out.data[i] < 250) hasAlpha = true;
    } else if (o.kind === 2) {
      for (let p = 0, q = 0; p < w * h; p++, q += 3) {
        out.data[p * 4] = d[q];
        out.data[p * 4 + 1] = d[q + 1];
        out.data[p * 4 + 2] = d[q + 2];
        out.data[p * 4 + 3] = 255;
      }
    } else if (o.kind === 1) {
      const rowBytes = (w + 7) >> 3;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const bit = (d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0;
          const p = (y * w + x) * 4;
          out.data[p] = out.data[p + 1] = out.data[p + 2] = v;
          out.data[p + 3] = 255;
        }
    } else return null;
    sctx.putImageData(out, 0, 0);
    ctx.drawImage(src, 0, 0, cw, ch);
  } else return null;
  const photo = cw * ch > 250_000 && !hasAlpha;
  const mime = photo ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, 0.9));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, w: cw, h: ch };
}

function getObj(page: PDFPageProxy, id: string): Promise<unknown> {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      store.get(id, resolve);
    } catch {
      resolve(null);
    }
    setTimeout(() => resolve(null), 4000);
  });
}

interface PageRead {
  kind: PageKind;
  input: PageInput;
  rotate: number;
  view: number[];
}

async function readPage(page: PDFPageProxy): Promise<PageRead> {
  const pdfjs = await import("pdfjs-dist");
  const OPS = pdfjs.OPS;
  const ops = await page.getOperatorList(); // also loads the page's fonts, so their names are known
  const content = await page.getTextContent();

  type Raw = { str: string; t: number[]; w: number; fontName: string };
  const raws: Raw[] = [];
  for (const it of content.items) {
    if (!("str" in it) || !it.str) continue;
    raws.push({ str: it.str, t: it.transform, w: it.width, fontName: it.fontName });
  }
  const chars = raws.reduce((n, r) => n + r.str.replace(/\s/g, "").length, 0);

  // The reading direction: the angle most characters are written at, snapped to 90° steps.
  const angleWeight = new Map<number, number>();
  for (const r of raws) {
    const a = ((Math.round((Math.atan2(r.t[1], r.t[0]) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
    angleWeight.set(a, (angleWeight.get(a) ?? 0) + r.str.length);
  }
  let angle = 0;
  let bestW = -1;
  for (const [a, w] of angleWeight) if (w > bestW) [angle, bestW] = [a, w];
  const frame = frameFor(page.view, angle);

  const items: TextItem[] = [];
  for (const r of raws) {
    const a = ((Math.round((Math.atan2(r.t[1], r.t[0]) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
    if (a !== angle) continue; // stamps and sideways labels at other angles aren't part of the text flow
    const size = Math.hypot(r.t[2], r.t[3]) || Math.hypot(r.t[0], r.t[1]);
    const p = frame.point(r.t[4], r.t[5]);
    const style = fontStyle(page, r.fontName);
    items.push({ str: r.str, x: p.x, y: p.y, w: r.w, size, bold: style.bold, italic: style.italic });
  }

  // Pictures: follow the transformation stack through the operator list to find where each is drawn.
  const images: PageImage[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let imageArea = 0;
  const dots: { x: number; y: number; size: number }[] = [];
  const pageArea = frame.width * frame.height;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(args as Matrix, ctm);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mul(args[0] as Matrix, ctm);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      // List bullets are often drawn as small filled dots rather than "•" text (Chrome and Word both do
      // this). Remember dot-sized filled shapes; they become bullet characters below.
      const paint = args?.[0];
      const box = args?.[2] as ArrayLike<number> | undefined;
      if ((paint === OPS.fill || paint === OPS.eoFill || paint === OPS.fillStroke || paint === OPS.eoFillStroke) && box && box.length === 4) {
        const corners = [apply(ctm, box[0], box[1]), apply(ctm, box[2], box[3])].map((c) => frame.point(c.x, c.y));
        const w = Math.abs(corners[1].x - corners[0].x);
        const h = Math.abs(corners[1].y - corners[0].y);
        if (w >= 1.5 && w <= 9 && h >= 1.5 && h <= 9 && Math.abs(w - h) <= Math.max(w, h) * 0.35) {
          dots.push({ x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2, size: Math.max(w, h) });
        }
      }
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)].map((c) => frame.point(c.x, c.y));
      const x = Math.min(...corners.map((c) => c.x));
      const y = Math.min(...corners.map((c) => c.y));
      const w = Math.max(...corners.map((c) => c.x)) - x;
      const h = Math.max(...corners.map((c) => c.y)) - y;
      imageArea += w * h;
      if (w < 12 || h < 12) continue;
      const img = fn === OPS.paintInlineImageXObject ? args[0] : await getObj(page, args[0] as string);
      const encoded = await imageToBytes(img);
      if (encoded) images.push({ x, y, w, h, bytes: encoded.bytes, mime: encoded.mime, pxWidth: encoded.w, pxHeight: encoded.h });
    }
  }

  // A dot on a text line's x-height, just left of where the line starts, is that line's bullet.
  for (const dot of dots) {
    let best: TextItem | null = null;
    for (const it of items) {
      const dx = it.x - dot.x;
      if (dx < 2 || dx > 30) continue;
      if (Math.abs(it.y + it.size * 0.3 - dot.y) > it.size * 0.45) continue;
      if (!best || it.x < best.x) best = it;
    }
    if (best && !/^\s*[•●◦▪]/.test(best.str) && !items.some((it) => it.x < best!.x && it.x >= dot.x - 1 && Math.abs(it.y - best!.y) < 1)) {
      items.push({ str: "•", x: dot.x - dot.size / 2, y: best.y, w: dot.size, size: best.size, bold: false, italic: false });
    }
  }

  const kind: PageKind = chars >= MIN_TEXT_CHARS ? "text" : imageArea > pageArea * 0.3 ? "scanned" : chars > 0 ? "text" : "blank";
  return { kind, input: { width: frame.width, height: frame.height, items, images }, rotate: page.rotate, view: [...page.view] };
}

/** Quick look for the upload screen: page count and whether it's text, scanned or mixed. */
export async function analyzePdf(file: File): Promise<PdfAnalysis> {
  const { doc, close } = await openDocument(file);
  const kinds: PageKind[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = await page.getTextContent();
    const chars = text.items.reduce((n, it) => n + ("str" in it ? it.str.replace(/\s/g, "").length : 0), 0);
    if (chars >= MIN_TEXT_CHARS) kinds.push("text");
    else {
      const ops = await page.getOperatorList();
      const pdfjs = await import("pdfjs-dist");
      const hasImage = ops.fnArray.some((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject);
      kinds.push(hasImage ? "scanned" : chars > 0 ? "text" : "blank");
    }
  }
  await close();
  const scanned = kinds.filter((k) => k === "scanned").length;
  const text = kinds.filter((k) => k === "text").length;
  const label = scanned === 0 ? "Text PDF" : text === 0 ? "Scanned PDF" : "Mixed PDF";
  return { pages: kinds.length, kinds, label };
}

/** Reads every page; scanned pages are recognised with the local OCR engine in `ocrLang`. */
export async function extractPages(file: File, ocrLang: string, onProgress: (p: Progress) => void): Promise<PageInput[]> {
  const { doc, close } = await openDocument(file);
  const reads: PageRead[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress({ stage: "reading", page: i, total: doc.numPages });
    const page = await doc.getPage(i);
    reads.push(await readPage(page));
    page.cleanup();
  }
  await close();

  const scannedIdx = reads.map((r, i) => (r.kind === "scanned" ? i : -1)).filter((i) => i >= 0);
  if (scannedIdx.length) {
    const { createOcrSession } = await import("@/lib/processors/ocr");
    const session = await createOcrSession(ocrLang);
    try {
      for (const [n, idx] of scannedIdx.entries()) {
        onProgress({ stage: "ocr", index: n + 1, total: scannedIdx.length, fraction: 0 });
        const read = reads[idx];
        const result = await session.recognizePage(file, idx + 1, {
          scale: 2,
          rotate: (((read.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270,
          onProgress: (fraction) => onProgress({ stage: "ocr", index: n + 1, total: scannedIdx.length, fraction }),
        });
        // The page as shown is upright; in page space its text runs at the page's /Rotate angle.
        const frame = frameFor(read.view, read.rotate);
        const toBox = (b: { x: number; y: number; width: number; height: number }) => {
          const corners = [frame.point(b.x, b.y), frame.point(b.x + b.width, b.y), frame.point(b.x, b.y + b.height), frame.point(b.x + b.width, b.y + b.height)];
          const x = Math.min(...corners.map((c) => c.x));
          const y = Math.min(...corners.map((c) => c.y));
          return { x, y, w: Math.max(...corners.map((c) => c.x)) - x, h: Math.max(...corners.map((c) => c.y)) - y };
        };
        const lines = result.lines.map((l) => toBox(l.pdfBox));
        const items: TextItem[] = [];
        for (const word of result.words) {
          const b = toBox(word.pdfBox);
          const line = lines.find((l) => b.y + b.h / 2 >= l.y && b.y + b.h / 2 <= l.y + l.h);
          // A line's box spans ascenders to descenders — about 1.2× the type size.
          const size = Math.max(4, (line ? line.h : b.h * 1.3) / 1.2);
          items.push({ str: word.text, x: b.x, y: line ? line.y + line.h * 0.22 : b.y, w: b.w, size, bold: false, italic: false, ocr: true });
        }
        // The scan itself isn't repeated as a picture: the recognised text is the editable version.
        read.input = { ...read.input, width: frame.width, height: frame.height, items, images: [] };
      }
    } finally {
      await session.terminate();
    }
  }
  onProgress({ stage: "building" });
  return reads.map((r) => r.input);
}
