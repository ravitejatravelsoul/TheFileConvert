import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Fill, PageImage, PageInput, Rule, TextItem } from "./layout";
import { analyzeScan, eraseCheckboxes, eraseRules, flattenFills, invertBars, type Raster, type ScanAnalysis } from "./scan";
import { scannedPageInput, type ScanReport } from "./scanPage";

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

export type Progress =
  | { stage: "reading"; page: number; total: number }
  | { stage: "layout"; index: number; total: number }
  | { stage: "ocr"; index: number; total: number; fraction: number }
  | { stage: "building" }
  | { stage: "validating" };

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

/** A PDF font name ("ABCDEF+Calibri-Bold", "TimesNewRomanPSMT", "Helvetica-Oblique") → the Word font a
 * .docx should ask for. Open metric-compatible fonts map back to the fonts they stand in for. */
export function wordFontName(pdfName: string): string {
  let n = pdfName.replace(/^[A-Z]{6}\+/, "").split(/[,-]/)[0].replace(/(PSMT|PS|MT)$/, "");
  const known: [RegExp, string][] = [
    [/^(Carlito|Calibri)/i, "Calibri"],
    [/^(Caladea|Cambria)/i, "Cambria"],
    [/^(LiberationSans|Arimo|Arial|Helvetica)/i, "Arial"],
    [/^(LiberationSerif|Tinos|TimesNewRoman|Times)/i, "Times New Roman"],
    [/^(LiberationMono|Cousine|CourierNew|Courier)/i, "Courier New"],
    // Open fonts with the same (or near-same) widths as a Word font map back to it.
    [/^(Gelasio|Georgia)/i, "Georgia"],
    [/^(DejaVuSans(?!Mono)|Verdana)/i, "Verdana"],
    [/^Tahoma/i, "Tahoma"],
    [/^Garamond/i, "Garamond"],
    [/^Aptos/i, "Aptos"],
    [/^SegoeUI/i, "Segoe UI"],
    [/^(Symbol|OpenSymbol|Wingdings)/i, ""],
  ];
  for (const [re, name] of known) if (re.test(n)) return name;
  // "SourceSansPro" → "Source Sans Pro"
  n = n.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return /^[A-Za-z][A-Za-z ]{1,40}$/.test(n) ? n : "";
}

function fontInfo(page: PDFPageProxy, fontName: string): { bold: boolean; italic: boolean; family: string } {
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
    family: name === fontName ? "" : wordFontName(name),
  };
}

/** Symbol-font bullets land in the private-use area; map the usual ones to real characters. */
const PUA_BULLETS: Record<number, string> = { 0xf0b7: "•", 0xf0a7: "▪", 0xf0a8: "◆", 0xf06c: "●", 0xf06e: "■", 0xf06f: "□", 0xf076: "❖", 0xf0d8: "➢", 0xf0fc: "✓", 0xf0e0: "→", 0xe00a: "•", 0xf09f: "•" };
function mapSymbols(s: string): string {
  return s.replace(/[\ue000-\uf8ff]/g, (c) => PUA_BULLETS[c.charCodeAt(0)] ?? "•");
}

function hexColor(args: unknown): string {
  const a = args as unknown[];
  const v = a?.[0];
  if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) return v.slice(1).toLowerCase();
  const nums = (Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v as ArrayLike<number>) : a) as number[];
  if (nums.length >= 3 && nums.every((x) => typeof x === "number")) return nums.slice(0, 3).map((x) => Math.round(x > 1 ? x : x * 255).toString(16).padStart(2, "0")).join("");
  return "000000";
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

/** pdf.js path data: [op, coords…] with moveTo=0, lineTo=1, curveTo=2, quadraticCurveTo=3, closePath=4. */
function pathPoints(data: ArrayLike<number> | undefined): { segments: [number, number, number, number][]; curved: boolean } {
  const segments: [number, number, number, number][] = [];
  if (!data) return { segments, curved: false };
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let curved = false;
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === 0) {
      x = sx = data[i++];
      y = sy = data[i++];
    } else if (op === 1) {
      const nx = data[i++];
      const ny = data[i++];
      segments.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    } else if (op === 2) {
      curved = true;
      i += 4;
      x = data[i++];
      y = data[i++];
    } else if (op === 3) {
      curved = true;
      i += 2;
      x = data[i++];
      y = data[i++];
    } else if (op === 4) {
      if (x !== sx || y !== sy) segments.push([x, y, sx, sy]);
      x = sx;
      y = sy;
    } else break;
  }
  return { segments, curved };
}

async function readPage(page: PDFPageProxy): Promise<PageRead> {
  const pdfjs = await import("pdfjs-dist");
  const OPS = pdfjs.OPS;
  const ops = await page.getOperatorList(); // also loads the page's fonts, so their names are known
  const content = await page.getTextContent();

  type Raw = { str: string; t: number[]; w: number; fontName: string; color: string };
  const raws: Raw[] = [];
  for (const it of content.items) {
    if (!("str" in it) || !it.str) continue;
    raws.push({ str: it.str, t: it.transform, w: it.width, fontName: it.fontName, color: "000000" });
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

  // One pass over the drawing operators: pictures, bullet dots, lines, filled boxes, and the colour of
  // every character drawn (text colour isn't part of pdf.js's text content, but the operators carry it).
  const images: PageImage[] = [];
  const rules: Rule[] = [];
  const fills: Fill[] = [];
  const colorStream: { ch: string; color: string }[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: Matrix; fill: string; stroke: string; lineWidth: number }[] = [];
  let fill = "000000";
  let stroke = "000000";
  let lineWidth = 1;
  let imageArea = 0;
  const dots: { x: number; y: number; size: number }[] = [];
  const pageArea = frame.width * frame.height;
  const toFrame = (x: number, y: number) => {
    const c = apply(ctm, x, y);
    return frame.point(c.x, c.y);
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push({ ctm, fill, stroke, lineWidth });
    else if (fn === OPS.restore) {
      const st = stack.pop();
      if (st) ({ ctm, fill, stroke, lineWidth } = st);
    } else if (fn === OPS.transform) ctm = mul(args as Matrix, ctm);
    else if (fn === OPS.setFillRGBColor) fill = hexColor(args);
    else if (fn === OPS.setStrokeRGBColor) stroke = hexColor(args);
    else if (fn === OPS.setLineWidth) lineWidth = Number(args?.[0]) || 0;
    else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
      const glyphs = (args as unknown[]).find((a) => Array.isArray(a)) as unknown[] | undefined;
      for (const g of glyphs ?? []) {
        const u = (g as { unicode?: string } | null)?.unicode;
        if (typeof u === "string") for (const ch of mapSymbols(u)) if (ch.trim()) colorStream.push({ ch, color: fill });
      }
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, fill, stroke, lineWidth });
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mul(args[0] as Matrix, ctm);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const st = stack.pop();
      if (st) ({ ctm, fill, stroke, lineWidth } = st);
    } else if (fn === OPS.constructPath) {
      const paint = args?.[0];
      const box = args?.[2] as ArrayLike<number> | undefined;
      const filled = paint === OPS.fill || paint === OPS.eoFill || paint === OPS.fillStroke || paint === OPS.eoFillStroke || paint === OPS.closeFillStroke || paint === OPS.closeEOFillStroke;
      const stroked = paint === OPS.stroke || paint === OPS.closeStroke || paint === OPS.fillStroke || paint === OPS.eoFillStroke || paint === OPS.closeFillStroke || paint === OPS.closeEOFillStroke;
      if (!box || box.length !== 4 || (!filled && !stroked)) continue;
      const c0 = toFrame(box[0], box[1]);
      const c1 = toFrame(box[2], box[3]);
      const bx = Math.min(c0.x, c1.x);
      const by = Math.min(c0.y, c1.y);
      const bw = Math.abs(c1.x - c0.x);
      const bh = Math.abs(c1.y - c0.y);
      // List bullets are often drawn as small filled dots rather than "•" text (Chrome and Word both do
      // this). Remember dot-sized filled shapes; they become bullet characters below.
      if (filled && bw >= 1.5 && bw <= 9 && bh >= 1.5 && bh <= 9 && Math.abs(bw - bh) <= Math.max(bw, bh) * 0.35) {
        dots.push({ x: bx + bw / 2, y: by + bh / 2, size: Math.max(bw, bh) });
        continue;
      }
      const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])) || 1;
      if (filled) {
        // Thin filled bars are lines (borders drawn as rectangles); bigger ones are shading.
        if (bh <= 2.5 && bw >= 4) rules.push({ x0: bx, x1: bx + bw, y0: by + bh / 2, y1: by + bh / 2, thickness: Math.max(0.25, bh), color: fill });
        else if (bw <= 2.5 && bh >= 4) rules.push({ x0: bx + bw / 2, x1: bx + bw / 2, y0: by, y1: by + bh, thickness: Math.max(0.25, bw), color: fill });
        else if (bw >= 4 && bh >= 4 && fill !== "ffffff" && bw * bh < pageArea * 0.9) fills.push({ x: bx, y: by, w: bw, h: bh, color: fill });
      }
      if (stroked) {
        const { segments, curved } = pathPoints((args?.[1] as ArrayLike<number>[] | undefined)?.[0]);
        if (curved) continue;
        const t = Math.max(0.25, lineWidth * scale);
        for (const [x0, y0, x1, y1] of segments) {
          const a = toFrame(x0, y0);
          const b = toFrame(x1, y1);
          if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 3) rules.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: a.y, y1: a.y, thickness: t, color: stroke });
          else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 3) rules.push({ x0: a.x, x1: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), thickness: t, color: stroke });
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

  // Text colour: walk the text items and the drawn characters together (both follow the content
  // stream's order); each item takes the colour most of its characters were drawn in.
  let cursor = 0;
  for (const r of raws) {
    const tally = new Map<string, number>();
    for (const ch of mapSymbols(r.str)) {
      if (!ch.trim()) continue;
      let k = cursor;
      while (k < colorStream.length && k < cursor + 40 && colorStream[k].ch !== ch) k++;
      if (k < colorStream.length && colorStream[k].ch === ch) {
        tally.set(colorStream[k].color, (tally.get(colorStream[k].color) ?? 0) + 1);
        cursor = k + 1;
      }
    }
    let best = 0;
    for (const [c, n] of tally) if (n > best) [r.color, best] = [c, n];
  }

  const items: TextItem[] = [];
  for (const r of raws) {
    const a = ((Math.round((Math.atan2(r.t[1], r.t[0]) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
    if (a !== angle) continue; // stamps and sideways labels at other angles aren't part of the text flow
    const size = Math.hypot(r.t[2], r.t[3]) || Math.hypot(r.t[0], r.t[1]);
    const p = frame.point(r.t[4], r.t[5]);
    const style = fontInfo(page, r.fontName);
    const descent = Math.abs(content.styles[r.fontName]?.descent ?? 0.22);
    items.push({ str: mapSymbols(r.str), x: p.x, y: p.y, w: r.w, size, bold: style.bold, italic: style.italic, font: style.family, color: r.color, descent: descent > 0 && descent < 0.6 ? descent : 0.22 });
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
      items.push({ str: "•", x: dot.x - dot.size / 2, y: best.y, w: dot.size, size: best.size, bold: false, italic: false, font: best.font, color: best.color, descent: best.descent });
    }
  }

  const kind: PageKind = chars >= MIN_TEXT_CHARS ? "text" : imageArea > pageArea * 0.3 ? "scanned" : chars > 0 ? "text" : "blank";
  return { kind, input: { width: frame.width, height: frame.height, items, images, rules, fills }, rotate: page.rotate, view: [...page.view] };
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

type Prepared = { analysis: ScanAnalysis; original: Raster; map: { toPdf: (x: number, y: number) => [number, number]; toPx: (x: number, y: number) => [number, number] } };

/** A region of a page raster as a picture (PNG for regions, JPEG for a whole page). */
async function encodeRegion(r: Raster, box: { x: number; y: number; w: number; h: number }, mime: "image/png" | "image/jpeg"): Promise<PageImage | null> {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.min(r.width - x, Math.ceil(box.w));
  const h = Math.min(r.height - y, Math.ceil(box.h));
  if (w < 2 || h < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  for (let row = 0; row < h; row++) img.data.set(r.data.subarray(((y + row) * r.width + x) * 4, ((y + row) * r.width + x + w) * 4), row * w * 4);
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, 0.88));
  if (!blob) return null;
  return { x: 0, y: 0, w: 0, h: 0, bytes: new Uint8Array(await blob.arrayBuffer()), mime, pxWidth: w, pxHeight: h };
}

export interface ExtractResult {
  pages: PageInput[];
  /** Per page: how a scanned page was rebuilt (absent for text pages). */
  reports: (ScanReport | undefined)[];
}

/**
 * Pixels per point a scanned page is rendered at for layout analysis and OCR: 216 dpi. At 144 dpi body text
 * has an x-height of ~9 px, below what the recogniser reads reliably (it misses and misreads words); scans
 * are usually 200–300 dpi, so this keeps most of their detail at a bounded cost.
 */
const OCR_SCALE = 3;

/** Reads every page; scanned pages are recognised with the local OCR engine in `ocrLang`. */
export async function extractPages(file: File, ocrLang: string, onProgress: (p: Progress) => void): Promise<ExtractResult> {
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
  const reports: (ScanReport | undefined)[] = reads.map(() => undefined);
  if (scannedIdx.length) {
    const { createOcrSession } = await import("@/lib/processors/ocr");
    const session = await createOcrSession(ocrLang);
    try {
      for (const [n, idx] of scannedIdx.entries()) {
        onProgress({ stage: "ocr", index: n + 1, total: scannedIdx.length, fraction: 0 });
        const read = reads[idx];
        const result = await session.recognizePage(file, idx + 1, {
          scale: OCR_SCALE,
          refine: true,
          rotate: (((read.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270,
          onProgress: (fraction) => onProgress({ stage: "ocr", index: n + 1, total: scannedIdx.length, fraction }),
          // Layout from the pixels first (rules, boxes, tables, shading), then the lines are erased so the
          // OCR engine reads the words between them instead of the grid.
          prepare: (image, map) => {
            onProgress({ stage: "layout", index: n + 1, total: scannedIdx.length });
            const original = { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height };
            const analysis = analyzeScan(image, OCR_SCALE);
            const bg = analysis.backgroundColor.match(/../g)!.map((h) => parseInt(h, 16)) as [number, number, number];
            // Light text on dark bands is turned dark-on-paper (the recogniser reads it badly otherwise).
            invertBars(image, analysis.bars, bg);
            flattenFills(image, analysis.fills.filter((f) => !analysis.bars.some((b) => b.x === f.x && b.y === f.y)), bg);
            eraseRules(image, analysis.rules, bg);
            eraseCheckboxes(image, analysis.checkboxes, bg);
            onProgress({ stage: "ocr", index: n + 1, total: scannedIdx.length, fraction: 0 });
            return { analysis, original, map } satisfies Prepared;
          },
        });
        // The page as shown is upright; in page space its text runs at the page's /Rotate angle.
        const frame = frameFor(read.view, read.rotate);
        const words = result.words.map((w) => ({ text: w.text, confidence: w.confidence, pdfBox: w.pdfBox, line: w.line }));
        const prep = result.prepared as Prepared | undefined;
        if (!prep) throw new PdfToWordError("This scanned page couldn't be analysed.");
        const { input, report } = await scannedPageInput({
          words,
          lines: result.lines,
          analysis: prep.analysis,
          raster: prep.original,
          toPdf: prep.map.toPdf,
          toPx: prep.map.toPx,
          frame,
          encode: (box, mime) => encodeRegion(prep.original, box, mime),
        });
        read.input = input;
        reports[idx] = report;
      }
    } finally {
      await session.terminate();
    }
  }
  onProgress({ stage: "building" });
  for (const r of reads) if (r.kind !== "scanned") r.input.strategy = "native";
  return { pages: reads.map((r) => r.input), reports };
}
