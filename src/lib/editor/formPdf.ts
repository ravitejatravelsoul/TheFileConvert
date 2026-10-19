/**
 * Low-level reading of AcroForm structure: which widget belongs to which field, what a field inherits from its parents, how a
 * widget is styled, and whether its appearance stream still shows the field's value.
 */
import { decodePDFRawStream, PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFObject, PDFPage, PDFRawStream, PDFStream, PDFString, type PDFDocument } from "pdf-lib";
import { familyOfFontName, parseDefaultAppearance, type FormFamily } from "./formLayout";

const name = (s: string) => PDFName.of(s);

export function str(o: PDFObject | undefined): string | undefined {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  if (o instanceof PDFName) return o.decodeText();
  return undefined;
}

/** A field's own dict is the widget itself or its /Parent chain; attributes like /FT /V /DA /Q /Ff are inherited down it. */
export function inherited(dict: PDFDict, key: string): PDFObject | undefined {
  const ctx = dict.context;
  let cur: PDFDict | undefined = dict;
  for (let i = 0; cur && i < 32; i++) {
    const v = cur.get(name(key));
    if (v !== undefined) return ctx.lookup(v);
    const p = cur.get(name("Parent"));
    cur = p ? (ctx.lookup(p) instanceof PDFDict ? (ctx.lookup(p) as PDFDict) : undefined) : undefined;
  }
  return undefined;
}

/** The field's fully qualified name: partial names (/T) joined by dots from the root down — what pdf-lib's `getName()` returns. */
export function qualifiedName(dict: PDFDict): string {
  const ctx = dict.context;
  const parts: string[] = [];
  let cur: PDFDict | undefined = dict;
  for (let i = 0; cur && i < 32; i++) {
    const t = str(ctx.lookup(cur.get(name("T"))));
    if (t !== undefined) parts.unshift(t);
    const p: PDFObject | undefined = cur.get(name("Parent"));
    const pd: PDFObject | undefined = p ? ctx.lookup(p) : undefined;
    cur = pd instanceof PDFDict ? pd : undefined;
  }
  return parts.join(".");
}

/** The dict that holds the field's value (the first one up the chain with /FT, else the widget itself). */
export function fieldDictOf(widget: PDFDict): PDFDict {
  const ctx = widget.context;
  let cur: PDFDict = widget;
  for (let i = 0; i < 32; i++) {
    if (cur.has(name("FT"))) return cur;
    const p = cur.get(name("Parent"));
    const pd = p ? ctx.lookup(p) : undefined;
    if (!(pd instanceof PDFDict)) break;
    cur = pd;
  }
  return widget;
}

export function widgetsOnPage(page: PDFPage): PDFDict[] {
  const ctx = page.doc.context;
  const out: PDFDict[] = [];
  for (const a of page.node.Annots()?.asArray() ?? []) {
    const d = ctx.lookup(a);
    if (d instanceof PDFDict && d.get(name("Subtype")) === name("Widget")) out.push(d);
  }
  return out;
}

function nums(o: PDFObject | undefined, ctx: PDFDict["context"]): number[] | undefined {
  const arr = o ? ctx.lookup(o) : undefined;
  if (!(arr instanceof PDFArray)) return undefined;
  return arr.asArray().map((x) => (ctx.lookup(x) instanceof PDFNumber ? (ctx.lookup(x) as PDFNumber).asNumber() : 0));
}

function colourOf(c: number[] | undefined): { r: number; g: number; b: number } | undefined {
  if (!c || !c.length) return undefined;
  if (c.length === 1) return { r: c[0], g: c[0], b: c[0] };
  if (c.length === 3) return { r: c[0], g: c[1], b: c[2] };
  if (c.length === 4) return { r: (1 - c[0]) * (1 - c[3]), g: (1 - c[1]) * (1 - c[3]), b: (1 - c[2]) * (1 - c[3]) };
  return undefined;
}

export interface WidgetStyle {
  fontSize: number;
  family: FormFamily;
  fontName: string;
  color: { r: number; g: number; b: number };
  align: 0 | 1 | 2;
  borderWidth: number;
  background?: { r: number; g: number; b: number };
  borderColor?: { r: number; g: number; b: number };
  /** /MK /R: the widget's content is turned by this much inside its rectangle. */
  rotation: 0 | 90 | 180 | 270;
}

export function widgetStyle(widget: PDFDict, doc: PDFDocument): WidgetStyle {
  const ctx = doc.context;
  const acro = doc.catalog.lookup(name("AcroForm"));
  const da = str(inherited(widget, "DA")) ?? (acro instanceof PDFDict ? str(ctx.lookup(acro.get(name("DA")))) : undefined);
  const parsed = parseDefaultAppearance(da);
  const qObj = inherited(widget, "Q") ?? (acro instanceof PDFDict ? ctx.lookup(acro.get(name("Q"))) : undefined);
  const q = qObj instanceof PDFNumber ? qObj.asNumber() : 0;
  const mk = ctx.lookup(widget.get(name("MK")));
  const mkd = mk instanceof PDFDict ? mk : undefined;
  const bs = ctx.lookup(widget.get(name("BS")));
  let borderWidth = 1;
  if (bs instanceof PDFDict) {
    const w = ctx.lookup(bs.get(name("W")));
    if (w instanceof PDFNumber) borderWidth = w.asNumber();
  } else {
    const border = nums(widget.get(name("Border")), ctx);
    if (border && border.length >= 3) borderWidth = border[2];
  }
  const rObj = mkd ? ctx.lookup(mkd.get(name("R"))) : undefined;
  const r = rObj instanceof PDFNumber ? (((rObj.asNumber() % 360) + 360) % 360) : 0;
  return {
    fontSize: parsed.size,
    family: familyOfFontName(parsed.fontName),
    fontName: parsed.fontName,
    color: parsed.color,
    align: q === 1 ? 1 : q === 2 ? 2 : 0,
    borderWidth,
    background: colourOf(mkd ? nums(mkd.get(name("BG")), ctx) : undefined),
    borderColor: colourOf(mkd ? nums(mkd.get(name("BC")), ctx) : undefined),
    rotation: r === 90 || r === 180 || r === 270 ? r : 0,
  };
}

/** The text an appearance stream draws (the strings shown with Tj / TJ), or null if there is no normal appearance. */
export function appearanceText(widget: PDFDict): string | null {
  const ctx = widget.context;
  const ap = ctx.lookup(widget.get(name("AP")));
  if (!(ap instanceof PDFDict)) return null;
  let n = ctx.lookup(ap.get(name("N")));
  if (n instanceof PDFDict) return null; // a state dictionary (checkbox / radio), not a text appearance
  if (!(n instanceof PDFStream)) return null;
  let bytes: Uint8Array;
  try {
    bytes = n instanceof PDFRawStream ? decodePDFRawStream(n).decode() : (n as PDFStream).getContents();
  } catch {
    return null;
  }
  n = undefined;
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  const unescape = (t: string) =>
    t
      .replace(/\\([nrtbf])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[c] ?? "")
      .replace(/\\([0-7]{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\(.)/g, "$1");
  const pieces: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|\[((?:\\.|[^\]\\])*)\]\s*TJ|<([0-9A-Fa-f\s]*)>\s*Tj/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[1] !== undefined) pieces.push(unescape(m[1]));
    else if (m[2] !== undefined) for (const p of m[2].matchAll(/\(((?:\\.|[^\\)])*)\)/g)) pieces.push(unescape(p[1]));
    else if (m[3] !== undefined) {
      const hex = m[3].replace(/\s+/g, "");
      let t = "";
      for (let i = 0; i + 1 < hex.length; i += 2) t += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      pieces.push(t);
    }
  }
  return pieces.join("");
}

/** The label of one button of a radio group. With /Opt the appearance states are indices ("0", "1", …) into it. */
export function radioLabel(widget: PDFDict, state: string): string {
  const opt = inherited(widget, "Opt");
  if (opt instanceof PDFArray && /^\d+$/.test(state)) {
    const entry = widget.context.lookup(opt.get(Number(state)));
    const label = str(entry) ?? (entry instanceof PDFArray ? str(widget.context.lookup(entry.get(1))) : undefined);
    if (label !== undefined) return label;
  }
  return state;
}

export function hasNormalAppearance(widget: PDFDict): boolean {
  const ctx = widget.context;
  const ap = ctx.lookup(widget.get(name("AP")));
  return ap instanceof PDFDict && ap.get(name("N")) !== undefined;
}

export function needAppearances(doc: PDFDocument): boolean {
  const acro = doc.catalog.lookup(name("AcroForm"));
  if (!(acro instanceof PDFDict)) return false;
  const v = doc.context.lookup(acro.get(name("NeedAppearances")));
  return v !== undefined && String(v) === "true";
}
