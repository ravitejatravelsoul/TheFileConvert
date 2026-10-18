/**
 * Single-byte encodings and glyph names for simple fonts.
 *
 * WinAnsi (Windows-1252 as PDF defines it), MacRoman and a small StandardEncoding, plus glyph name → Unicode for the
 * names producers put in `/Differences` (Latin, punctuation, `uniXXXX`, `uXXXXX`).
 */
import { Encodings } from "@pdf-lib/standard-fonts";

const decoderCache = new Map<string, TextDecoder>();
function singleByte(label: string, code: number): string {
  let d = decoderCache.get(label);
  if (!d) {
    d = new TextDecoder(label);
    decoderCache.set(label, d);
  }
  return d.decode(Uint8Array.of(code));
}

export type BaseEncodingName = "WinAnsiEncoding" | "MacRomanEncoding" | "StandardEncoding" | "MacExpertEncoding";

/** Code → Unicode text for a named base encoding (256 entries; "" where undefined). */
export function baseEncoding(name: BaseEncodingName | string | undefined): string[] {
  const out: string[] = new Array(256).fill("");
  for (let c = 32; c < 256; c++) {
    if (name === "MacRomanEncoding") out[c] = singleByte("macintosh", c);
    else if (name === "StandardEncoding") out[c] = standardChar(c);
    else out[c] = winAnsiChar(c); // WinAnsi, and the usual default for TrueType and unspecified Latin fonts
  }
  out[127] = "";
  return out;
}

function winAnsiChar(c: number): string {
  // Windows-1252 leaves five bytes undefined; PDF shows a bullet there.
  if (c === 0x81 || c === 0x8d || c === 0x8f || c === 0x90 || c === 0x9d) return "•";
  return singleByte("windows-1252", c);
}

function standardChar(c: number): string {
  if (c === 0x27) return "’";
  if (c === 0x60) return "‘";
  if (c < 128) return String.fromCharCode(c);
  const high: Record<number, string> = { 0xa1: "¡", 0xa2: "¢", 0xa3: "£", 0xa4: "⁄", 0xa5: "¥", 0xa6: "ƒ", 0xa7: "§", 0xa8: "¤", 0xa9: "'", 0xaa: "“", 0xab: "«", 0xac: "‹", 0xad: "›", 0xae: "ﬁ", 0xaf: "ﬂ", 0xb1: "–", 0xb2: "†", 0xb3: "‡", 0xb4: "·", 0xb6: "¶", 0xb7: "•", 0xb8: "‚", 0xb9: "„", 0xba: "”", 0xbb: "»", 0xbc: "…", 0xbd: "‰", 0xbf: "¿", 0xd0: "—", 0xe1: "Æ", 0xe3: "ª", 0xe8: "Ł", 0xe9: "Ø", 0xea: "Œ", 0xeb: "º", 0xf1: "æ", 0xf5: "ı", 0xf8: "ł", 0xf9: "ø", 0xfa: "œ", 0xfb: "ß" };
  return high[c] ?? "";
}

// ---------------------------------------------------------------------------------------------- glyph names

let nameToUnicode: Map<string, string> | null = null;

function glyphTable(): Map<string, string> {
  if (nameToUnicode) return nameToUnicode;
  const m = new Map<string, string>();
  // Everything WinAnsi can write has a name in the standard-fonts package.
  for (const cp of Encodings.WinAnsi.supportedCodePoints) {
    const { name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
    if (name) m.set(name, String.fromCodePoint(cp));
  }
  const extra: Record<string, string> = {
    space: " ", nbspace: " ", nonbreakingspace: " ", hyphen: "-", sfthyphen: "­", softhyphen: "­", minus: "−",
    quotesingle: "'", grave: "`", fi: "ﬁ", fl: "ﬂ", ff: "ﬀ", ffi: "ﬃ", ffl: "ﬄ", Euro: "€", bullet: "•", periodcentered: "·",
    dotlessi: "ı", lslash: "ł", Lslash: "Ł", fraction: "⁄", afii10017: "А", ellipsis: "…", quoteright: "’", quoteleft: "‘",
    quotedblleft: "“", quotedblright: "”", quotesinglbase: "‚", quotedblbase: "„", endash: "–", emdash: "—", dagger: "†", daggerdbl: "‡",
    perthousand: "‰", trademark: "™", copyright: "©", registered: "®", degree: "°", plusminus: "±", multiply: "×", divide: "÷",
    onehalf: "½", onequarter: "¼", threequarters: "¾", section: "§", paragraph: "¶", lessequal: "≤", greaterequal: "≥", notequal: "≠",
    infinity: "∞", summation: "∑", partialdiff: "∂", radical: "√", approxequal: "≈", Omega: "Ω", mu: "µ", pi: "π",
  };
  for (const [k, v] of Object.entries(extra)) if (!m.has(k)) m.set(k, v);
  // Greek and Cyrillic names (alpha, beta, …): the common ones written by TeX and Office.
  const greek = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega".split(" ");
  greek.forEach((n, i) => {
    if (!m.has(n)) m.set(n, String.fromCodePoint(0x3b1 + i));
  });
  nameToUnicode = m;
  return m;
}

/** Unicode text for a glyph name from `/Differences`, or "" if the name isn't recognised. */
export function glyphNameToUnicode(name: string): string {
  const t = glyphTable();
  const direct = t.get(name);
  if (direct !== undefined) return direct;
  let m = /^uni([0-9A-Fa-f]{4})+$/.exec(name);
  if (m) {
    let s = "";
    for (let i = 3; i + 4 <= name.length; i += 4) s += String.fromCharCode(parseInt(name.slice(i, i + 4), 16));
    return s;
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  // "A.sc", "f_i": a suffix after '.' is a variant; '_' joins ligature parts
  const dot = name.indexOf(".");
  if (dot > 0) return glyphNameToUnicode(name.slice(0, dot));
  if (name.includes("_")) return name.split("_").map(glyphNameToUnicode).join("");
  return "";
}

/** The glyph name the standard-14 width tables use for a Unicode character, or undefined. */
export function winAnsiGlyphName(ch: string): string | undefined {
  const cp = ch.codePointAt(0)!;
  if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp)) return undefined;
  return Encodings.WinAnsi.encodeUnicodeCodePoint(cp).name;
}
