/**
 * Walks a page's content (and the Form XObjects it draws) the way a viewer does, keeping the graphics and text state, and
 * reports every piece of *text* and every *image* together with the bytes of the operation that draws it.
 *
 * This is what the editor edits: not a summary of the page (pdf.js's `getTextContent`) but the operators themselves, so
 * a change can be a patch of those operators — the old glyphs removed, the new ones written — instead of a cover.
 */
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFContext, type PDFObject, type PDFPage } from "pdf-lib";
import { readFont, type DecodedGlyph, type FontInfo } from "./fontinfo";
import { parseContent, type Obj, type Op } from "./tokenizer";

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m × n (apply m first, then n): the PDF convention for concatenating a matrix onto a CTM is `new = m × ctm`. */
export function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export const apply = (m: Matrix, x: number, y: number): { x: number; y: number } => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return IDENTITY;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Glyph {
  unicode: string;
  code: number;
  len: number;
  /** 1/1000 em. */
  width: number;
  /** A space the document draws as a gap (a TJ adjustment), not as a character. */
  virtual: boolean;
  /** Origin and end of the advance, in page space. */
  x: number;
  y: number;
  x2: number;
  y2: number;
  /** Where the glyph's code sits inside the op: index of the string operand (0 for Tj) and byte offset in it. */
  strIndex: number;
  byteOffset: number;
  /** For a virtual space: the TJ number that produced it (1/1000 em), so it can be removed. */
  tjIndex?: number;
}

export interface TextRun {
  id: string;
  streamKey: string;
  opIndex: number;
  opName: string;
  font: FontInfo;
  fontResName: string;
  /** Text state in force when the op starts. */
  size: number;
  charSpace: number;
  wordSpace: number;
  hScale: number;
  rise: number;
  renderMode: number;
  /** Matrices: text matrix at the start of the op (text → stream user space) and the CTM (user space → page). */
  tm: Matrix;
  tlm: Matrix;
  ctm: Matrix;
  color: RGB | null;
  glyphs: Glyph[];
  /** Total advance of the op in text-space x units (what the text matrix moves by). */
  advance: number;
  /** Font size in page units. */
  pageSize: number;
  /** Direction of the baseline in page space, radians. */
  angle: number;
  bbox: Rect;
  /** Index of the BT…ET text object this op belongs to (per stream). */
  textObject: number;
  /** The innermost enclosing marked-content `BDC` that carries `/ActualText`, if any: its op index. */
  actualTextOp: number | null;
  invisible: boolean;
  /** Seen more than once (a Form XObject drawn several times). */
  shared: boolean;
}

export interface ImagePlacement {
  id: string;
  streamKey: string;
  opIndex: number;
  inline: boolean;
  /** Resource name of the image XObject ("" for an inline image). */
  name: string;
  ref?: PDFRef;
  /** Unit square → page. */
  matrix: Matrix;
  /** CTM (user space → page) at the `Do`, and the stream's own CTM base. */
  ctm: Matrix;
  bbox: Rect;
  pixelWidth: number;
  pixelHeight: number;
  shared: boolean;
}

export interface StreamInfo {
  key: string;
  bytes: Uint8Array;
  ops: Op[];
  /** Where to write changes: the Form XObject's ref, or null for the page's own content. */
  ref: PDFRef | null;
  /** The resource dictionary in force (and the object that owns it). */
  resources: PDFDict | undefined;
  resourcesOwner: "page" | PDFRef;
}

export interface PageContent {
  runs: TextRun[];
  images: ImagePlacement[];
  streams: Map<string, StreamInfo>;
  fonts: Map<string, FontInfo>;
}

const N = (s: string) => PDFName.of(s);
const numOf = (o: PDFObject | undefined): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

export function lookup<T extends PDFObject>(ctx: PDFContext, o: PDFObject | undefined): T | undefined {
  return o === undefined ? undefined : (ctx.lookup(o) as T | undefined);
}

export function streamBytes(ctx: PDFContext, obj: PDFObject | undefined): Uint8Array | undefined {
  const s = lookup<PDFObject>(ctx, obj);
  if (s instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(s).decode();
    } catch {
      return undefined;
    }
  }
  const anyS = s as unknown as { getUnencodedContents?: () => Uint8Array };
  if (anyS && typeof anyS.getUnencodedContents === "function") return anyS.getUnencodedContents();
  return undefined;
}

/** The page's content as one byte string (its streams joined by a newline, as a viewer reads them). */
export function pageContentBytes(page: PDFPage): Uint8Array {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  const parts: Uint8Array[] = [];
  const nl = Uint8Array.of(10);
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const b = streamBytes(ctx, contents.get(i));
      if (b) parts.push(b, nl);
    }
  } else if (contents) {
    const b = streamBytes(ctx, contents);
    if (b) parts.push(b);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function cmykToRgb(c: number, m: number, y: number, k: number): RGB {
  return { r: (1 - Math.min(1, c + k)), g: (1 - Math.min(1, m + k)), b: (1 - Math.min(1, y + k)) };
}

interface TextState {
  font: FontInfo | null;
  fontResName: string;
  size: number;
  Tc: number;
  Tw: number;
  Th: number;
  TL: number;
  Ts: number;
  Tr: number;
}

interface GState {
  ctm: Matrix;
  fill: RGB | null;
  fillSpace: string;
  text: TextState;
}

const cloneG = (g: GState): GState => ({ ...g, text: { ...g.text } });

const argNum = (a: Obj | undefined) => (a && a.t === "num" ? a.v : 0);

const MAX_DEPTH = 8;

export type FontInfoMap = Map<string, FontInfo>;

export interface InterpretOptions {
  /** Content to read instead of what is in the file, by stream key ("page", "xobj:<n>") — to check an edit before writing it. */
  overrides?: Map<string, Uint8Array>;
  /** Descriptions of fonts embedded but not yet written, by object number (see FallbackFonts.describedFonts). */
  fontsByRef?: Map<string, FontInfo>;
}

export function interpretPage(page: PDFPage, options: InterpretOptions = {}): PageContent {
  const ctx = page.doc.context;
  const content: PageContent = { runs: [], images: [], streams: new Map(), fonts: new Map() };
  const bytes = pageContentBytes(page);
  const pageResources = page.node.Resources();
  const seenRuns = new Map<string, TextRun>();
  const seenImages = new Map<string, ImagePlacement>();

  const fontCache = new Map<string, FontInfo>(); // keyed by resource owner + name

  function fontFor(resources: PDFDict | undefined, ownerKey: string, name: string): FontInfo | null {
    const fonts = lookup<PDFDict>(ctx, resources?.get(N("Font")));
    if (!fonts) return null;
    const raw = fonts.get(N(name));
    if (!raw) return null;
    const key = `${ownerKey}/${name}`;
    let f = fontCache.get(key);
    if (!f) {
      const described = raw instanceof PDFRef ? options.fontsByRef?.get(raw.tag) : undefined;
      f = described ? { ...described, resName: name } : readFont(ctx, name, raw);
      fontCache.set(key, f);
      content.fonts.set(key, f);
    }
    return f;
  }

  function walk(streamKey: string, data0: Uint8Array, ref: PDFRef | null, resources: PDFDict | undefined, resourcesOwner: "page" | PDFRef, baseCtm: Matrix, depth: number) {
    const data = options.overrides?.get(streamKey) ?? data0;
    const ops = parseContent(data);
    if (!content.streams.has(streamKey)) content.streams.set(streamKey, { key: streamKey, bytes: data, ops, ref, resources, resourcesOwner });
    const ownerKey = resourcesOwner === "page" ? "page" : resourcesOwner.tag;

    let g: GState = { ctm: baseCtm, fill: { r: 0, g: 0, b: 0 }, fillSpace: "DeviceGray", text: { font: null, fontResName: "", size: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, Ts: 0, Tr: 0 } };
    const stack: GState[] = [];
    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;
    let textObject = -1;
    const mc: { tag: string; opIndex: number; actualText: boolean }[] = [];

    const moveTo = (tx: number, ty: number) => {
      tlm = mul([1, 0, 0, 1, tx, ty], tlm);
      tm = tlm;
    };

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const a = op.args;
      switch (op.op) {
        case "q":
          stack.push(cloneG(g));
          break;
        case "Q":
          if (stack.length) g = stack.pop()!;
          break;
        case "cm":
          if (a.length >= 6) g.ctm = mul([argNum(a[0]), argNum(a[1]), argNum(a[2]), argNum(a[3]), argNum(a[4]), argNum(a[5])], g.ctm);
          break;
        case "BT":
          tm = IDENTITY;
          tlm = IDENTITY;
          textObject++;
          break;
        case "ET":
          break;
        case "Tf":
          if (a[0]?.t === "name") {
            g.text.fontResName = a[0].v;
            g.text.font = fontFor(resources ?? pageResources, ownerKey, a[0].v);
          }
          g.text.size = argNum(a[1]);
          break;
        case "Tc":
          g.text.Tc = argNum(a[0]);
          break;
        case "Tw":
          g.text.Tw = argNum(a[0]);
          break;
        case "Tz":
          g.text.Th = argNum(a[0]) / 100;
          break;
        case "TL":
          g.text.TL = argNum(a[0]);
          break;
        case "Ts":
          g.text.Ts = argNum(a[0]);
          break;
        case "Tr":
          g.text.Tr = argNum(a[0]);
          break;
        case "Td":
          moveTo(argNum(a[0]), argNum(a[1]));
          break;
        case "TD":
          g.text.TL = -argNum(a[1]);
          moveTo(argNum(a[0]), argNum(a[1]));
          break;
        case "Tm":
          tm = [argNum(a[0]), argNum(a[1]), argNum(a[2]), argNum(a[3]), argNum(a[4]), argNum(a[5])];
          tlm = tm;
          break;
        case "T*":
          moveTo(0, -g.text.TL);
          break;
        case "'":
        case '"':
        case "Tj":
        case "TJ": {
          if (op.op === "'" || op.op === '"') {
            if (op.op === '"') {
              g.text.Tw = argNum(a[0]);
              g.text.Tc = argNum(a[1]);
            }
            moveTo(0, -g.text.TL);
          }
          const run = showText(streamKey, i, op, g, tm, tlm, textObject, mc);
          if (run) {
            const prior = seenRuns.get(run.id);
            if (prior) prior.shared = true;
            else {
              seenRuns.set(run.id, run);
              content.runs.push(run);
            }
            tm = mul([1, 0, 0, 1, run.advance, 0], tm);
          }
          break;
        }
        case "g":
          g.fill = { r: argNum(a[0]), g: argNum(a[0]), b: argNum(a[0]) };
          g.fillSpace = "DeviceGray";
          break;
        case "rg":
          g.fill = { r: argNum(a[0]), g: argNum(a[1]), b: argNum(a[2]) };
          g.fillSpace = "DeviceRGB";
          break;
        case "k":
          g.fill = cmykToRgb(argNum(a[0]), argNum(a[1]), argNum(a[2]), argNum(a[3]));
          g.fillSpace = "DeviceCMYK";
          break;
        case "cs":
          g.fillSpace = a[0]?.t === "name" ? a[0].v : "";
          if (g.fillSpace === "DeviceGray" || g.fillSpace === "CalGray") g.fill = { r: 0, g: 0, b: 0 };
          else if (g.fillSpace === "DeviceRGB" || g.fillSpace === "CalRGB") g.fill = { r: 0, g: 0, b: 0 };
          else if (g.fillSpace === "DeviceCMYK") g.fill = { r: 0, g: 0, b: 0 };
          else g.fill = null;
          break;
        case "sc":
        case "scn": {
          const nums = a.filter((x) => x.t === "num").map((x) => (x as { v: number }).v);
          if (nums.length === 1) g.fill = { r: nums[0], g: nums[0], b: nums[0] };
          else if (nums.length === 3) g.fill = { r: nums[0], g: nums[1], b: nums[2] };
          else if (nums.length === 4) g.fill = cmykToRgb(nums[0], nums[1], nums[2], nums[3]);
          else g.fill = null;
          break;
        }
        case "BMC":
          mc.push({ tag: a[0]?.t === "name" ? a[0].v : "", opIndex: i, actualText: false });
          break;
        case "BDC": {
          const props = a[1];
          mc.push({ tag: a[0]?.t === "name" ? a[0].v : "", opIndex: i, actualText: props?.t === "dict" && props.v.ActualText !== undefined });
          break;
        }
        case "EMC":
          mc.pop();
          break;
        case "BI": {
          const inl = op.inline;
          const w = inl?.dict.W ?? inl?.dict.Width;
          const h = inl?.dict.H ?? inl?.dict.Height;
          addImage(streamKey, i, true, "", undefined, g.ctm, w?.t === "num" ? w.v : 0, h?.t === "num" ? h.v : 0);
          break;
        }
        case "Do": {
          if (a[0]?.t !== "name") break;
          const xobjects = lookup<PDFDict>(ctx, (resources ?? pageResources)?.get(N("XObject")));
          const raw = xobjects?.get(N(a[0].v));
          const x = lookup<PDFObject>(ctx, raw);
          if (!(x instanceof PDFRawStream)) break;
          const sub = x.dict.get(N("Subtype"));
          const subName = sub instanceof PDFName ? sub.decodeText() : "";
          const xref = raw instanceof PDFRef ? raw : undefined;
          if (subName === "Image") {
            addImage(streamKey, i, false, a[0].v, xref, g.ctm, numOf(x.dict.get(N("Width"))) ?? 0, numOf(x.dict.get(N("Height"))) ?? 0);
          } else if (subName === "Form" && depth < MAX_DEPTH && xref) {
            const key = `xobj:${xref.tag}`;
            const fdata = streamBytes(ctx, x);
            if (!fdata) break;
            const mArr = lookup<PDFArray>(ctx, x.dict.get(N("Matrix")));
            const fm: Matrix = mArr && mArr.size() >= 6 ? ([0, 1, 2, 3, 4, 5].map((k) => numOf(mArr.get(k)) ?? 0) as Matrix) : IDENTITY;
            const fres = lookup<PDFDict>(ctx, x.dict.get(N("Resources")));
            const ownRes = fres ?? resources ?? pageResources;
            const owner: "page" | PDFRef = fres ? xref : resourcesOwner;
            if (!content.streams.has(key)) {
              walk(key, fdata, xref, ownRes, owner, mul(fm, g.ctm), depth + 1);
            } else {
              // drawn again: count its runs/images as shared
              for (const r of content.runs) if (r.streamKey === key) r.shared = true;
              for (const im of content.images) if (im.streamKey === key) im.shared = true;
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  function addImage(streamKey: string, opIndex: number, inline: boolean, name: string, ref: PDFRef | undefined, ctm: Matrix, pw: number, ph: number) {
    const id = `${streamKey}#${opIndex}`;
    const prior = seenImages.get(id);
    if (prior) {
      prior.shared = true;
      return;
    }
    const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const im: ImagePlacement = {
      id,
      streamKey,
      opIndex,
      inline,
      name,
      ref,
      matrix: ctm,
      ctm,
      bbox: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
      pixelWidth: pw,
      pixelHeight: ph,
      shared: false,
    };
    seenImages.set(id, im);
    content.images.push(im);
  }

  function showText(streamKey: string, opIndex: number, op: Op, g: GState, tm0: Matrix, tlm0: Matrix, textObject: number, mc: { tag: string; opIndex: number; actualText: boolean }[]): TextRun | null {
    const t = g.text;
    const font = t.font;
    if (!font) return null;
    const trmOf = (tm: Matrix): Matrix => mul(tm, g.ctm);
    const glyphs: Glyph[] = [];
    let tm = tm0;
    let advance = 0;
    const emitGlyph = (d: DecodedGlyph, strIndex: number, byteOffset: number) => {
      const before = trmOf(tm);
      const tx = ((d.width / 1000) * t.size + t.Tc + (d.code === 32 && d.len === 1 ? t.Tw : 0)) * t.Th;
      const p0 = apply(before, 0, t.Ts);
      const p1 = apply(before, tx, t.Ts);
      glyphs.push({ unicode: d.unicode, code: d.code, len: d.len, width: d.width, virtual: false, x: p0.x, y: p0.y, x2: p1.x, y2: p1.y, strIndex, byteOffset });
      tm = mul([1, 0, 0, 1, tx, 0], tm);
      advance += tx;
    };
    const showBytes = (bytes: Uint8Array, strIndex: number) => {
      const decoded = font.decode(bytes);
      let off = 0;
      for (const d of decoded) {
        emitGlyph(d, strIndex, off);
        off += d.len;
      }
    };
    if (op.op === "TJ") {
      const arr = op.args[0];
      if (arr?.t === "arr") {
        arr.v.forEach((el, idx) => {
          if (el.t === "str") showBytes(el.v, idx);
          else if (el.t === "num") {
            const tx = (-el.v / 1000) * t.size * t.Th;
            const before = trmOf(tm);
            const p0 = apply(before, 0, t.Ts);
            const p1 = apply(before, tx, t.Ts);
            // a large positive gap is a word space the producer drew as a gap
            if (tx > 0.2 * t.size * t.Th) glyphs.push({ unicode: " ", code: -1, len: 0, width: (tx / (t.size * t.Th)) * 1000, virtual: true, x: p0.x, y: p0.y, x2: p1.x, y2: p1.y, strIndex: idx, byteOffset: 0, tjIndex: idx });
            tm = mul([1, 0, 0, 1, tx, 0], tm);
            advance += tx;
          }
        });
      }
    } else {
      const s = op.args[op.op === '"' ? 2 : 0];
      if (s?.t === "str") showBytes(s.v, 0);
    }

    const trm0 = trmOf(tm0);
    const pageSize = Math.hypot(trm0[2], trm0[3]) * t.size;
    const angle = Math.atan2(trm0[1], trm0[0]);
    const end = trmOf(tm);
    const baseStart = apply(trm0, 0, t.Ts);
    const baseEnd = apply(end, 0, t.Ts);
    // box: baseline start/end, lifted by ascent and dropped by descent along the glyph's "up" direction
    const upx = -Math.sin(angle) * Math.sign(trm0[0] * trm0[3] - trm0[1] * trm0[2] || 1);
    const upy = Math.cos(angle) * Math.sign(trm0[0] * trm0[3] - trm0[1] * trm0[2] || 1);
    const asc = (font.ascent / 1000) * pageSize;
    const desc = (-font.descent / 1000) * pageSize;
    const pts = [
      { x: baseStart.x + upx * asc, y: baseStart.y + upy * asc },
      { x: baseEnd.x + upx * asc, y: baseEnd.y + upy * asc },
      { x: baseStart.x - upx * desc, y: baseStart.y - upy * desc },
      { x: baseEnd.x - upx * desc, y: baseEnd.y - upy * desc },
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    let actualTextOp: number | null = null;
    for (let k = mc.length - 1; k >= 0; k--) {
      if (mc[k].actualText) {
        actualTextOp = mc[k].opIndex;
        break;
      }
    }
    return {
      id: `${streamKey}#${opIndex}`,
      streamKey,
      opIndex,
      opName: op.op,
      font,
      fontResName: t.fontResName,
      size: t.size,
      charSpace: t.Tc,
      wordSpace: t.Tw,
      hScale: t.Th,
      rise: t.Ts,
      renderMode: t.Tr,
      tm: tm0,
      tlm: tlm0,
      ctm: g.ctm,
      color: g.fill,
      glyphs,
      advance,
      pageSize,
      angle,
      bbox: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
      textObject,
      actualTextOp,
      invisible: t.Tr === 3 || t.Tr === 7 || t.size === 0,
      shared: false,
    };
  }

  // The page's own content. The page's base CTM is the identity (its user space is the page space).
  walk("page", bytes, null, pageResources, "page", IDENTITY, 0);
  return content;
}
