/**
 * What the editor needs to know about a font in a PDF: how its character codes read as text (and the reverse), how wide
 * each glyph is, and what it looks like (family class, bold, italic).
 *
 * Supported, because they are what PDF producers write: simple fonts (Type1, TrueType, MMType1) with WinAnsi / MacRoman /
 * Standard encodings, `/Differences` and `ToUnicode`; and Type0 fonts with an Identity encoding (two-byte codes = CIDs).
 * Anything else (Type 3, vertical writing, predefined CJK CMaps, symbolic fonts with no ToUnicode) is reported as *not
 * editable* with the reason — the editor then says so instead of covering the text.
 */
import { FontNames, Font as StdFont } from "@pdf-lib/standard-fonts";
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFContext, type PDFObject } from "pdf-lib";
import { parseToUnicode } from "./cmap";
import { baseEncoding, glyphNameToUnicode, winAnsiGlyphName } from "./encodings";

export type FontClass = "sans" | "serif" | "mono";

export interface DecodedGlyph {
  /** The character code as it appears in the string. */
  code: number;
  /** How many bytes it takes in the string (1, or 2 for Identity-H). */
  len: number;
  /** The text it stands for ("" when unknown). */
  unicode: string;
  /** Advance width in 1/1000 em. */
  width: number;
}

export interface FontInfo {
  resName: string;
  subtype: string;
  baseFont: string;
  family: string;
  fontClass: FontClass;
  bold: boolean;
  italic: boolean;
  /** An embedded subset (the name has the `ABCDEF+` prefix): only the glyphs the page uses are in the file. */
  subset: boolean;
  twoByte: boolean;
  editable: boolean;
  reason?: string;
  /** Typographic ascent/descent in 1/1000 em (from the descriptor, or typical values). */
  ascent: number;
  descent: number;
  decode(bytes: Uint8Array): DecodedGlyph[];
  /** Can every character of `text` be written with this font? */
  canEncode(text: string): boolean;
  /** The codes for `text` (only when canEncode) and the width of each. */
  encode(text: string): { bytes: Uint8Array; widths: number[] } | null;
  /** The font's own width for a character (1/1000 em), or undefined when it has no glyph for it. */
  widthOf(ch: string): number | undefined;
  /** The dictionary, so an editor can add a font resource that points at the same object. */
  dict: PDFDict;
  ref?: PDFRef;
}

const N = (s: string) => PDFName.of(s);
const num = (o: PDFObject | undefined): number | undefined => (o instanceof PDFNumber ? o.asNumber() : undefined);

function lookup<T extends PDFObject>(ctx: PDFContext, o: PDFObject | undefined): T | undefined {
  if (o === undefined) return undefined;
  return ctx.lookup(o) as T | undefined;
}

function nameOf(o: PDFObject | undefined): string | undefined {
  return o instanceof PDFName ? o.decodeText() : undefined;
}

function streamText(ctx: PDFContext, o: PDFObject | undefined): string | undefined {
  const s = lookup<PDFObject>(ctx, o);
  if (!(s instanceof PDFRawStream)) return undefined;
  try {
    const bytes = decodePDFRawStream(s).decode();
    return new TextDecoder("latin1").decode(bytes);
  } catch {
    return undefined;
  }
}

const STANDARD_ALIASES: [RegExp, FontNames][] = [
  [/^(courier|couriernew)[,-]?(bold)?[,-]?(oblique|italic)?/i, FontNames.Courier],
  [/^(helvetica|arial)/i, FontNames.Helvetica],
  [/^(times|timesnewroman)/i, FontNames.TimesRoman],
  [/^symbol/i, FontNames.Symbol],
  [/^zapfdingbats/i, FontNames.ZapfDingbats],
];

/** Which of the 14 standard fonts' width tables describes this font, if any. */
export function standardFontFor(baseFont: string): FontNames | null {
  const name = baseFont.replace(/^[A-Z]{6}\+/, "").replace(/MT$|PS$|PSMT$/i, "");
  const bold = /bold|black|heavy/i.test(name);
  const italic = /italic|oblique/i.test(name);
  for (const [re, base] of STANDARD_ALIASES) {
    if (!re.test(name)) continue;
    if (base === FontNames.Symbol || base === FontNames.ZapfDingbats) return base;
    const family = base === FontNames.Helvetica ? "Helvetica" : base === FontNames.TimesRoman ? "Times" : "Courier";
    if (family === "Times") return bold && italic ? FontNames.TimesRomanBoldItalic : bold ? FontNames.TimesRomanBold : italic ? FontNames.TimesRomanItalic : FontNames.TimesRoman;
    const sfx = bold && italic ? "BoldOblique" : bold ? "Bold" : italic ? "Oblique" : "";
    return (sfx ? `${family}-${sfx}` : family) as FontNames;
  }
  return null;
}

function styleFrom(baseFont: string, descriptor: PDFDict | undefined) {
  const name = baseFont.replace(/^[A-Z]{6}\+/, "");
  const flags = num(descriptor?.get(N("Flags"))) ?? 0;
  const weight = num(descriptor?.get(N("FontWeight"))) ?? 0;
  const angle = num(descriptor?.get(N("ItalicAngle"))) ?? 0;
  const bold = /bold|black|heavy|demi|semibold/i.test(name) || weight >= 600 || (flags & (1 << 18)) !== 0;
  const italic = /italic|oblique|ital\b/i.test(name) || angle !== 0 || (flags & (1 << 6)) !== 0;
  const mono = (flags & 1) !== 0 || /courier|mono|consolas|menlo|lucida console/i.test(name);
  const serif = !mono && ((flags & 2) !== 0 || /times|georgia|cambria|garamond|palatino|minion|serif(?!ic)|roman|book|century|caladea|gelasio/i.test(name)) && !/sans/i.test(name);
  const family = name.replace(/[-,]?(bold|italic|oblique|regular|roman|black|medium|light|semibold|demi|mt|ps|psmt)+/gi, "").replace(/[-,_]+$/, "") || name;
  return { bold, italic, fontClass: (mono ? "mono" : serif ? "serif" : "sans") as FontClass, family };
}

/** Builds the codec for one font resource. Never throws: a font it can't read is returned as not editable. */
export function readFont(ctx: PDFContext, resName: string, fontObj: PDFObject): FontInfo {
  const ref = fontObj instanceof PDFRef ? fontObj : undefined;
  const dict = lookup<PDFDict>(ctx, fontObj);
  const base: FontInfo = {
    resName,
    subtype: "?",
    baseFont: "",
    family: "",
    fontClass: "sans",
    bold: false,
    italic: false,
    subset: false,
    twoByte: false,
    editable: false,
    ascent: 800,
    descent: -200,
    decode: () => [],
    canEncode: () => false,
    encode: () => null,
    widthOf: () => undefined,
    dict: dict as PDFDict,
    ref,
  };
  if (!(dict instanceof PDFDict)) return { ...base, reason: "The font is missing." };
  try {
    return buildFont(ctx, resName, dict, ref, base);
  } catch {
    return { ...base, reason: "The font could not be read." };
  }
}

function buildFont(ctx: PDFContext, resName: string, dict: PDFDict, ref: PDFRef | undefined, base: FontInfo): FontInfo {
  const subtype = nameOf(dict.get(N("Subtype"))) ?? "?";
  const baseFont = nameOf(dict.get(N("BaseFont"))) ?? "";
  const subset = /^[A-Z]{6}\+/.test(baseFont);
  const isType0 = subtype === "Type0";
  const cidFont = isType0 ? lookup<PDFDict>(ctx, lookup<PDFArray>(ctx, dict.get(N("DescendantFonts")))?.get(0)) : undefined;
  const descriptor = lookup<PDFDict>(ctx, (cidFont ?? dict).get(N("FontDescriptor")));
  const style = styleFrom(baseFont, descriptor);
  const ascent = num(descriptor?.get(N("Ascent"))) ?? 905;
  const descent = num(descriptor?.get(N("Descent"))) ?? -212;
  const out: FontInfo = { ...base, resName, subtype, baseFont, subset, ...style, ascent: ascent || 905, descent: descent || -212, dict, ref };

  const toUni = (() => {
    const t = streamText(ctx, dict.get(N("ToUnicode")));
    return t ? parseToUnicode(t) : null;
  })();

  if (subtype === "Type3") return { ...out, reason: "Type 3 fonts can't be edited." };
  if (isType0) return buildType0(ctx, out, dict, cidFont, toUni);
  return buildSimple(ctx, out, dict, baseFont, toUni, descriptor);
}

// ------------------------------------------------------------------------------------------------ Type 0 (CID)

function cidWidths(ctx: PDFContext, cid: PDFDict | undefined): { dw: number; w: Map<number, number> } {
  const dw = num(cid?.get(N("DW"))) ?? 1000;
  const w = new Map<number, number>();
  const arr = lookup<PDFArray>(ctx, cid?.get(N("W")));
  if (arr) {
    let i = 0;
    while (i < arr.size()) {
      const first = num(lookup(ctx, arr.get(i)));
      const second = lookup<PDFObject>(ctx, arr.get(i + 1));
      if (first === undefined) break;
      if (second instanceof PDFArray) {
        for (let k = 0; k < second.size(); k++) w.set(first + k, num(lookup(ctx, second.get(k))) ?? dw);
        i += 2;
      } else {
        const last = num(second);
        const width = num(lookup(ctx, arr.get(i + 2)));
        if (last === undefined || width === undefined) break;
        for (let c = first; c <= last && c - first < 70000; c++) w.set(c, width);
        i += 3;
      }
    }
  }
  return { dw, w };
}

function buildType0(ctx: PDFContext, out: FontInfo, dict: PDFDict, cid: PDFDict | undefined, toUni: ReturnType<typeof parseToUnicode> | null): FontInfo {
  const enc = lookup<PDFObject>(ctx, dict.get(N("Encoding")));
  const encName = nameOf(enc);
  if (encName !== "Identity-H") return { ...out, twoByte: true, reason: encName === "Identity-V" ? "Vertical text can't be edited." : "This font uses a CJK/predefined encoding that can't be edited." };
  if (!toUni) return { ...out, twoByte: true, reason: "This text has no Unicode map, so its characters can't be read." };
  const { dw, w } = cidWidths(ctx, cid);
  const code2uni = toUni.map;
  const uni2code = new Map<string, number>();
  for (const [c, u] of code2uni) if (!uni2code.has(u)) uni2code.set(u, c);
  const widthOfCode = (c: number) => w.get(c) ?? dw;
  return {
    ...out,
    twoByte: true,
    editable: true,
    decode(bytes) {
      const g: DecodedGlyph[] = [];
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = bytes[i] * 256 + bytes[i + 1];
        g.push({ code, len: 2, unicode: code2uni.get(code) ?? "", width: widthOfCode(code) });
      }
      return g;
    },
    canEncode: (text) => [...text].every((ch) => uni2code.has(ch)),
    encode(text) {
      const chars = [...text];
      if (!chars.every((ch) => uni2code.has(ch))) return null;
      const bytes = new Uint8Array(chars.length * 2);
      const widths: number[] = [];
      chars.forEach((ch, i) => {
        const c = uni2code.get(ch)!;
        bytes[2 * i] = c >> 8;
        bytes[2 * i + 1] = c & 255;
        widths.push(widthOfCode(c));
      });
      return { bytes, widths };
    },
    widthOf: (ch) => (uni2code.has(ch) ? widthOfCode(uni2code.get(ch)!) : undefined),
  };
}

// ------------------------------------------------------------------------------------------------ simple fonts

function buildSimple(ctx: PDFContext, out: FontInfo, dict: PDFDict, baseFont: string, toUni: ReturnType<typeof parseToUnicode> | null, descriptor: PDFDict | undefined): FontInfo {
  // Code → Unicode
  const encObj = lookup<PDFObject>(ctx, dict.get(N("Encoding")));
  const flags = num(descriptor?.get(N("Flags"))) ?? 0;
  const symbolic = (flags & 4) !== 0 && (flags & 32) === 0;
  let baseName: string | undefined;
  let differences: PDFArray | undefined;
  if (encObj instanceof PDFName) baseName = encObj.decodeText();
  else if (encObj instanceof PDFDict) {
    baseName = nameOf(encObj.get(N("BaseEncoding")));
    differences = lookup<PDFArray>(ctx, encObj.get(N("Differences")));
  }
  const std = standardFontFor(baseFont);
  const useBase = baseName !== undefined || !symbolic || std !== null;
  const code2uni: string[] = useBase ? baseEncoding(baseName ?? (out.subtype === "TrueType" ? "WinAnsiEncoding" : "StandardEncoding")) : new Array(256).fill("");
  const glyphNames: (string | undefined)[] = new Array(256);
  if (differences) {
    let code = 0;
    for (let i = 0; i < differences.size(); i++) {
      const it = lookup<PDFObject>(ctx, differences.get(i));
      if (it instanceof PDFNumber) code = it.asNumber();
      else if (it instanceof PDFName && code >= 0 && code < 256) {
        const gn = it.decodeText();
        glyphNames[code] = gn;
        const u = glyphNameToUnicode(gn);
        if (u) code2uni[code] = u;
        code++;
      }
    }
  }
  if (toUni) for (const [c, u] of toUni.map) if (c < 256 && u) code2uni[c] = u;
  const known = code2uni.some(Boolean);
  if (!known || (symbolic && !toUni && baseName === undefined && !differences && std === null)) {
    return { ...out, reason: "This text uses a custom encoding with no Unicode map, so its characters can't be read." };
  }

  // Widths
  const first = num(dict.get(N("FirstChar"))) ?? 0;
  const widths = lookup<PDFArray>(ctx, dict.get(N("Widths")));
  const missing = num(descriptor?.get(N("MissingWidth"))) ?? 0;
  const stdFont = std && std !== FontNames.Symbol && std !== FontNames.ZapfDingbats ? StdFont.load(std) : null;
  const widthOfCode = (c: number): number => {
    if (widths && c >= first && c - first < widths.size()) {
      const w = num(lookup(ctx, widths.get(c - first)));
      if (w !== undefined) return w;
    }
    if (stdFont) {
      const gn = glyphNames[c] ?? (code2uni[c] ? winAnsiGlyphName(code2uni[c]) : undefined);
      const w = gn ? stdFont.getWidthOfGlyph(gn) : undefined;
      if (typeof w === "number") return w;
    }
    return missing;
  };

  // Which codes can be written. A subset font only has the glyphs the page already uses (its Widths are non-zero and
  // its ToUnicode lists them); a full font (the 14 standard fonts, or an embedded font that is not a subset) has them all.
  const uni2code = new Map<string, number>();
  const fullFont = !out.subset && (std !== null || !toUni);
  for (let c = 0; c < 256; c++) {
    const u = code2uni[c];
    if (!u || uni2code.has(u)) continue;
    const present = toUni ? toUni.map.has(c) : widths ? c >= first && c - first < widths.size() && widthOfCode(c) > 0 : true;
    if (present || (fullFont && widthOfCode(c) > 0)) uni2code.set(u, c);
  }
  // Prefer the code that existing text uses for a space (some subsets use 1 or 3 instead of 32).
  return {
    ...out,
    editable: true,
    decode(bytes) {
      return Array.from(bytes, (code) => ({ code, len: 1, unicode: code2uni[code] ?? "", width: widthOfCode(code) }));
    },
    canEncode: (text) => [...text].every((ch) => uni2code.has(ch)),
    encode(text) {
      const chars = [...text];
      if (!chars.every((ch) => uni2code.has(ch))) return null;
      return { bytes: Uint8Array.from(chars.map((ch) => uni2code.get(ch)!)), widths: chars.map((ch) => widthOfCode(uni2code.get(ch)!)) };
    },
    widthOf: (ch) => (uni2code.has(ch) ? widthOfCode(uni2code.get(ch)!) : undefined),
  };
}

