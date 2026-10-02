import fontkit from "@pdf-lib/fontkit";
import type { Font } from "@pdf-lib/fontkit";
import type { Block, DocModel, Family, Inline, RunStyle } from "./model";

/**
 * Fonts for layout and embedding. Word's fonts are drawn with open fonts that share their character
 * widths (Carlito = Calibri, Liberation = Arial / Times New Roman / Courier New, Gelasio = Georgia), so
 * lines break where Word breaks them; Cambria (Caladea) and Verdana (DejaVu Sans) are the closest open
 * matches. Characters those fonts lack (₹, ✓, arrows…) fall back to DejaVu Sans.
 */

export type Variant = "r" | "b" | "i" | "bi";
export type FaceKey = `${Family | "dejavu"}-${Variant}`;

export interface FaceStyle {
  family: Family;
  bold: boolean;
  italic: boolean;
  size: number;
  /** The requested font's own ascent and descent (em), when it's drawn with a substitute of another height. */
  vm?: { ascent: number; descent: number };
}

/**
 * Ascent and descent (em) of common Word fonts that are drawn with a substitute whose line height differs.
 * Word spaces lines by the requested font, so a paragraph's height follows these, not the substitute's.
 * Values measured from the Microsoft fonts (OS/2 win ascent/descent). Calibri, Arial, Times New Roman and
 * Courier New have substitutes with identical metrics and aren't listed; Gelasio matches Georgia's widths but
 * not its line height, so Georgia is.
 */
const VERTICAL: [RegExp, { ascent: number; descent: number }][] = [
  [/^cambria$/i, { ascent: 1946 / 2048, descent: 455 / 2048 }],
  [/^georgia$/i, { ascent: 1878 / 2048, descent: 449 / 2048 }],
  [/^verdana$/i, { ascent: 2059 / 2048, descent: 430 / 2048 }],
  [/^tahoma$/i, { ascent: 2049 / 2048, descent: 423 / 2048 }],
  [/^segoe ui$/i, { ascent: 2210 / 2048, descent: 514 / 2048 }],
];

export function verticalMetrics(fontName: string | undefined): FaceStyle["vm"] {
  const n = (fontName ?? "").trim();
  return VERTICAL.find(([re]) => re.test(n))?.[1];
}

export interface Segment {
  face: FaceKey;
  text: string;
  width: number;
}

/** What layout needs to know about fonts — kept small so tests can supply a fake. */
export interface FontApi {
  segments(text: string, style: FaceStyle): Segment[];
  measure(text: string, style: FaceStyle): number;
  /** Ascent, descent and single-spaced line height in points. */
  metrics(style: FaceStyle): { ascent: number; descent: number; height: number };
  underline(style: FaceStyle): { offset: number; thickness: number };
}

interface Face {
  key: FaceKey;
  bytes: Uint8Array;
  font: Font;
  widths: Map<string, number>;
}

export type FontLoader = (key: FaceKey) => Promise<Uint8Array>;

export const browserFontLoader: FontLoader = async (key) => {
  const res = await fetch(`/fonts/word/${key}.ttf`);
  if (!res.ok) throw new Error(`font ${key}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

export function variantOf(style: { bold: boolean; italic: boolean }): Variant {
  return style.bold ? (style.italic ? "bi" : "b") : style.italic ? "i" : "r";
}

function faceKey(style: { family: Family; bold: boolean; italic: boolean }): FaceKey {
  return `${style.family}-${variantOf(style)}`;
}

function fallbackKey(style: { bold: boolean }): FaceKey {
  return style.bold ? "dejavu-b" : "dejavu-r";
}

/** Every run style in the document, headers, footers, footnotes and list labels included. */
function collectStyles(model: DocModel): RunStyle[] {
  const out: RunStyle[] = [];
  const inlines = (list: Inline[]) => list.forEach((i) => out.push(i.style));
  const blocks = (list: Block[] | undefined) => {
    for (const b of list ?? []) {
      if (b.kind === "p") {
        inlines(b.inlines);
        out.push(b.markStyle);
        if (b.label) out.push(b.label.style);
      } else for (const r of b.rows) for (const c of r.cells) blocks(c.blocks);
    }
  };
  for (const s of model.sections) {
    blocks(s.blocks);
    for (const set of [s.props.headers, s.props.footers]) {
      blocks(set.default);
      blocks(set.first);
      blocks(set.even);
    }
  }
  for (const f of model.footnotes.values()) blocks(f);
  return out;
}

function collectText(model: DocModel): Map<FaceKey, Set<string>> {
  const chars = new Map<FaceKey, Set<string>>();
  forEachText(model, (style, text) => {
    const k = faceKey(style);
    let set = chars.get(k);
    if (!set) chars.set(k, (set = new Set()));
    for (const ch of text) set.add(ch);
  });
  return chars;
}

/** Fonts drawn with a font of the same widths: lines break exactly where Word breaks them. */
const METRIC_COMPATIBLE = /^(calibri|calibri light|carlito|arial|helvetica|liberation sans|arimo|times new roman|times|liberation serif|tinos|courier new|courier|liberation mono|cousine|georgia|gelasio|caladea|dejavu sans)$/i;

/**
 * The document's fonts that are drawn with a similar but not identical font (so lines may break in
 * slightly different places), most used first. Fonts on less than 5% of the text aren't worth a notice.
 */
export function substitutedFonts(model: DocModel): string[] {
  const use = new Map<string, number>();
  let total = 0;
  forEachText(model, (style, text) => {
    const n = text.replace(/\s/g, "").length;
    total += n;
    const name = style.fontName.trim();
    if (!name || METRIC_COMPATIBLE.test(name) || /symbol|wingdings|webdings/i.test(name)) return;
    use.set(name, (use.get(name) ?? 0) + n);
  });
  return [...use.entries()]
    .filter(([, n]) => n >= total * 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

/** Every piece of text the document draws, with its style (headers, footers, footnotes and list labels included). */
function forEachText(model: DocModel, add: (style: RunStyle, text: string) => void) {
  const blocks = (list: Block[] | undefined) => {
    for (const b of list ?? []) {
      if (b.kind === "p") {
        for (const i of b.inlines) if (i.kind === "text") add(i.style, i.style.caps ? i.text.toUpperCase() : i.text);
        else if (i.kind === "field") add(i.style, "0123456789ivxlcdmIVXLCDM");
        else if (i.kind === "footnote") add(i.style, i.mark);
        if (b.label) add(b.label.style, b.label.text);
      } else for (const r of b.rows) for (const c of r.cells) blocks(c.blocks);
    }
  };
  for (const s of model.sections) {
    blocks(s.blocks);
    for (const set of [s.props.headers, s.props.footers]) {
      blocks(set.default);
      blocks(set.first);
      blocks(set.even);
    }
  }
  for (const f of model.footnotes.values()) blocks(f);
}

export interface FontSet extends FontApi {
  faces: Map<FaceKey, Face>;
  /** Characters no loaded font can draw (shown as empty boxes). */
  missing: Set<string>;
}

/**
 * pdf-lib's font subsetter copies each glyph's bytes as they are and then writes short (2-byte)
 * offsets, which corrupts every glyph after one with an odd length. Carlito has many; the shipped
 * file is left untouched and this pads each glyph to 4 bytes in memory before embedding.
 */
export function padGlyphs(bytes: Uint8Array): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = dv.getUint16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  const order: string[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
    tables.set(tag, { offset: dv.getUint32(rec + 8), length: dv.getUint32(rec + 12) });
    order.push(tag);
  }
  const head = tables.get("head");
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  const maxp = tables.get("maxp");
  if (!head || !loca || !glyf || !maxp) return bytes;
  const numGlyphs = dv.getUint16(maxp.offset + 4);
  const long = dv.getInt16(head.offset + 50) === 1;
  const offsets: number[] = [];
  for (let i = 0; i <= numGlyphs; i++) offsets.push(long ? dv.getUint32(loca.offset + i * 4) : dv.getUint16(loca.offset + i * 2) * 2);
  if (offsets.every((o) => o % 4 === 0)) return bytes;

  // New glyf (each glyph padded to 4 bytes) and a long-format loca.
  const newOffsets: number[] = [0];
  for (let i = 0; i < numGlyphs; i++) {
    const len = Math.max(0, offsets[i + 1] - offsets[i]);
    newOffsets.push(newOffsets[i] + Math.ceil(len / 4) * 4);
  }
  const newGlyf = new Uint8Array(newOffsets[numGlyphs]);
  for (let i = 0; i < numGlyphs; i++) {
    const len = Math.max(0, offsets[i + 1] - offsets[i]);
    newGlyf.set(bytes.subarray(glyf.offset + offsets[i], glyf.offset + offsets[i] + len), newOffsets[i]);
  }
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const ldv = new DataView(newLoca.buffer);
  newOffsets.forEach((o, i) => ldv.setUint32(i * 4, o));
  const newHead = bytes.slice(head.offset, head.offset + head.length);
  new DataView(newHead.buffer).setInt16(50, 1);

  const data = new Map<string, Uint8Array>();
  for (const tag of order) {
    const t = tables.get(tag)!;
    data.set(tag, tag === "glyf" ? newGlyf : tag === "loca" ? newLoca : tag === "head" ? newHead : bytes.subarray(t.offset, t.offset + t.length));
  }
  let size = 12 + numTables * 16;
  for (const d of data.values()) size += Math.ceil(d.length / 4) * 4;
  const out = new Uint8Array(size);
  const odv = new DataView(out.buffer);
  out.set(bytes.subarray(0, 12), 0);
  let pos = 12 + numTables * 16;
  order.forEach((tag, i) => {
    const d = data.get(tag)!;
    const rec = 12 + i * 16;
    out.set(bytes.subarray(rec, rec + 8), rec); // tag + checksum (not re-verified by readers here)
    odv.setUint32(rec + 8, pos);
    odv.setUint32(rec + 12, d.length);
    out.set(d, pos);
    pos += Math.ceil(d.length / 4) * 4;
  });
  return out;
}

const ZERO_WIDTH =/[\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff\u00ad]/;

/** Loads only the faces the document uses (plus the fallback when some character needs it). */
export async function loadFonts(model: DocModel, loader: FontLoader): Promise<FontSet> {
  const faces = new Map<FaceKey, Face>();
  const load = async (key: FaceKey) => {
    if (faces.has(key)) return;
    const bytes = padGlyphs(await loader(key));
    faces.set(key, { key, bytes, font: fontkit.create(bytes), widths: new Map() });
  };
  const wanted = new Set<FaceKey>(collectStyles(model).map(faceKey));
  wanted.add("carlito-r");
  await Promise.all([...wanted].map(load));

  // Which characters need the fallback font?
  const missing = new Set<string>();
  const needFallback = new Set<FaceKey>();
  for (const [key, chars] of collectText(model)) {
    const face = faces.get(key)!;
    for (const ch of chars) {
      if (ch.trim() === "" || ZERO_WIDTH.test(ch)) continue;
      if (!face.font.hasGlyphForCodePoint(ch.codePointAt(0)!)) needFallback.add(key.endsWith("b") || key.endsWith("bi") ? "dejavu-b" : "dejavu-r");
    }
  }
  await Promise.all([...needFallback].map(load));
  for (const [key, chars] of collectText(model)) {
    const face = faces.get(key)!;
    const fb = faces.get(fallbackKey({ bold: key.endsWith("-b") || key.endsWith("-bi") }));
    for (const ch of chars) {
      if (ch.trim() === "" || ZERO_WIDTH.test(ch)) continue;
      const cp = ch.codePointAt(0)!;
      if (!face.font.hasGlyphForCodePoint(cp) && !fb?.font.hasGlyphForCodePoint(cp)) missing.add(ch);
    }
  }

  const has = (face: Face, ch: string) => ch.trim() === "" || ZERO_WIDTH.test(ch) || face.font.hasGlyphForCodePoint(ch.codePointAt(0)!);

  function width(face: Face, text: string): number {
    let w = face.widths.get(text);
    if (w === undefined) {
      // Without kerning: pdf-lib draws glyphs at their plain advance widths (and Word leaves kerning off for
      // body text by default). A kerned measurement is narrower than the drawn line, so a line that "fits"
      // would overflow its column.
      const run = face.font.layout(text, { kern: false });
      w = run.positions.reduce((n, p) => n + p.xAdvance, 0) / face.font.unitsPerEm;
      face.widths.set(text, w);
    }
    return w;
  }

  function segments(text: string, style: FaceStyle): Segment[] {
    const primary = faces.get(faceKey(style)) ?? faces.get("carlito-r")!;
    const fb = faces.get(fallbackKey(style));
    const out: Segment[] = [];
    let cur = "";
    let curFace: Face = primary;
    for (const ch of text) {
      const face = has(primary, ch) || !fb || !has(fb, ch) ? primary : fb;
      if (face !== curFace && cur) {
        out.push({ face: curFace.key, text: cur, width: width(curFace, cur) * style.size });
        cur = "";
      }
      curFace = face;
      cur += ch;
    }
    if (cur) out.push({ face: curFace.key, text: cur, width: width(curFace, cur) * style.size });
    return out;
  }

  const api: FontSet = {
    faces,
    missing,
    segments,
    measure: (text, style) => segments(text, style).reduce((n, s) => n + s.width, 0),
    metrics(style) {
      if (style.vm) {
        const ascent = style.vm.ascent * style.size;
        const descent = style.vm.descent * style.size;
        return { ascent, descent, height: ascent + descent };
      }
      const f = (faces.get(faceKey(style)) ?? faces.get("carlito-r")!).font;
      const s = style.size / f.unitsPerEm;
      const ascent = f.ascent * s;
      const descent = Math.abs(f.descent) * s;
      return { ascent, descent, height: ascent + descent + Math.max(0, f.lineGap) * s };
    },
    underline(style) {
      const f = (faces.get(faceKey(style)) ?? faces.get("carlito-r")!).font;
      const s = style.size / f.unitsPerEm;
      return { offset: Math.abs(f.underlinePosition || -0.1 * f.unitsPerEm) * s, thickness: Math.max(0.5, (f.underlineThickness || 0.05 * f.unitsPerEm) * s) };
    },
  };
  return api;
}
