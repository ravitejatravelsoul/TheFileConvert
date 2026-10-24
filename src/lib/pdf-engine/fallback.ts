/**
 * Fonts for text the original font can't write (a letter the subset doesn't contain, or a style change): the bundled open
 * fonts that match the usual families by width (Liberation Sans = Arial, Liberation Serif = Times, Carlito = Calibri,
 * Gelasio = Georgia, Caladea ≈ Cambria, DejaVu Sans for everything else), embedded as subset TrueType.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFName, PDFRef, type PDFDocument, type PDFFont } from "pdf-lib";
import type { FaceKey, FontLoader, Variant } from "@/lib/processors/word-to-pdf/fonts";
import type { DecodedGlyph, FontClass, FontInfo } from "./fontinfo";

export type FallbackFamily = "carlito" | "sans" | "serif" | "mono" | "gelasio" | "caladea" | "dejavu";

export interface FaceRequest {
  fontClass: FontClass;
  family: string;
  bold: boolean;
  italic: boolean;
  /** Force a family (the user picked one in the properties panel). */
  forceFamily?: FallbackFamily;
}

export interface Face {
  key: FaceKey;
  font: PDFFont;
  ref: PDFRef;
  chars: Set<number>;
}

export function pickFamily(req: FaceRequest): FallbackFamily {
  if (req.forceFamily) return req.forceFamily;
  const n = req.family.toLowerCase();
  if (/calibri|carlito/.test(n)) return "carlito";
  if (/cambria|caladea/.test(n)) return "caladea";
  if (/georgia|gelasio/.test(n)) return "gelasio";
  if (/verdana|segoe|dejavu/.test(n)) return "dejavu";
  if (req.fontClass === "mono") return "mono";
  if (req.fontClass === "serif") return "serif";
  return "sans";
}

const variantOf = (bold: boolean, italic: boolean): Variant => (bold ? (italic ? "bi" : "b") : italic ? "i" : "r");

export class FallbackFonts {
  private readonly faces = new Map<FaceKey, Promise<Face>>();
  private readonly codeMaps = new Map<string, Map<number, string>>(); // face ref tag → code → character
  private readonly infos = new Map<string, FontInfo>(); // face ref tag → description for the interpreter
  private registered = false;

  constructor(
    private readonly doc: PDFDocument,
    private readonly load: FontLoader
  ) {}

  private face(key: FaceKey): Promise<Face> {
    let p = this.faces.get(key);
    if (!p) {
      p = (async () => {
        if (!this.registered) {
          this.doc.registerFontkit(fontkit);
          this.registered = true;
        }
        const bytes = await this.load(key);
        const font = await this.doc.embedFont(bytes, { subset: true });
        return { key, font, ref: font.ref, chars: new Set(font.getCharacterSet()) };
      })();
      this.faces.set(key, p);
    }
    return p;
  }

  /** The face matching a style; the DejaVu face when `needChar` isn't in it. */
  async forStyle(req: FaceRequest, needChars?: string): Promise<Face> {
    const family = pickFamily(req);
    const primary = await this.face(`${family}-${variantOf(req.bold, req.italic)}` as FaceKey);
    if (!needChars || [...needChars].every((c) => primary.chars.has(c.codePointAt(0)!))) return primary;
    const dejavu = await this.face(`dejavu-${variantOf(req.bold, false)}` as FaceKey);
    return [...needChars].every((c) => dejavu.chars.has(c.codePointAt(0)!)) ? dejavu : primary;
  }

  supports(face: Face, text: string): boolean {
    return [...text].every((c) => face.chars.has(c.codePointAt(0)!));
  }

  /** Width of a character in 1/1000 em. */
  width(face: Face, ch: string): number {
    return face.font.widthOfTextAtSize(ch, 1000);
  }

  /** Two-byte glyph codes (the font is embedded as Identity-H), one glyph per character: no shaping, no ligatures. */
  encode(face: Face, text: string): Uint8Array {
    const tag = face.ref.tag;
    let map = this.codeMaps.get(tag);
    if (!map) this.codeMaps.set(tag, (map = new Map()));
    const out: number[] = [];
    for (const ch of text) {
      const bytes = face.font.encodeText(ch).asBytes();
      const code = bytes[0] * 256 + bytes[1];
      map.set(code, ch);
      out.push(bytes[0], bytes[1]);
    }
    this.describe(face);
    return Uint8Array.from(out);
  }

  /** The fonts written so far, by object number — lets a page be read back before the document is saved (pdf-lib writes an
   * embedded font only at save time, so until then the page's font object is an empty placeholder). */
  describedFonts(): Map<string, FontInfo> {
    return this.infos;
  }

  private describe(face: Face) {
    const tag = face.ref.tag;
    if (this.infos.has(tag)) return;
    const map = () => this.codeMaps.get(tag)!;
    const width = (ch: string) => this.width(face, ch);
    this.infos.set(tag, {
      resName: "",
      subtype: "Type0",
      baseFont: face.key,
      family: "",
      fontClass: "sans",
      bold: false,
      italic: false,
      subset: true,
      twoByte: true,
      editable: true,
      ascent: 905,
      descent: -212,
      decode(bytes) {
        const g: DecodedGlyph[] = [];
        for (let i = 0; i + 1 < bytes.length; i += 2) {
          const code = bytes[i] * 256 + bytes[i + 1];
          const ch = map().get(code) ?? "";
          g.push({ code, len: 2, unicode: ch, width: ch ? width(ch) : 0 });
        }
        return g;
      },
      canEncode: (text) => this.supports(face, text),
      encode: (text) => ({ bytes: this.encode(face, text), widths: [...text].map(width) }),
      widthOf: (ch) => (this.supports(face, ch) ? width(ch) : undefined),
      dict: undefined as never,
    });
  }
}

/** Adds a font to a resource dictionary under a fresh name and returns the name. */
export function addFontResource(resources: PDFDict, ref: PDFRef): string {
  const ctx = resources.context;
  let fonts = ctx.lookup(resources.get(PDFName.of("Font"))) as PDFDict | undefined;
  if (!(fonts instanceof PDFDict)) {
    fonts = ctx.obj({});
    resources.set(PDFName.of("Font"), fonts);
  }
  // reuse the name if this very font is already there
  for (const [name, val] of fonts.entries()) if (val instanceof PDFRef && val.tag === ref.tag) return name.decodeText();
  let i = 1;
  while (fonts.has(PDFName.of(`TFC${i}`))) i++;
  const name = `TFC${i}`;
  fonts.set(PDFName.of(name), ref);
  return name;
}
