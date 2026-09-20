import { PDFArray, PDFDict, PDFName, PDFNumber, type PDFObject } from "pdf-lib";

/**
 * Decoding of the lossless image encodings that scanners and PDF generators (ReportLab, PIL, Word "save as
 * PDF", scan apps) put in PDFs: /FlateDecode (optionally behind /ASCII85Decode, optionally with PNG
 * predictors). Everything runs in the browser with built-in APIs; no dependencies.
 */

export interface RawImage {
  width: number;
  height: number;
  /** 1 (DeviceGray) or 3 (DeviceRGB). */
  channels: 1 | 3;
  /** width * height * channels bytes, 8 bits per component, top row first. */
  pixels: Uint8Array;
}

function nameOf(obj: PDFObject | undefined): string | undefined {
  return obj instanceof PDFName ? obj.decodeText() : undefined;
}

/** The filter names of a stream dictionary, in decode order. */
export function filterChain(dict: PDFDict): string[] {
  const f = dict.get(PDFName.of("Filter"));
  if (f instanceof PDFName) return [f.decodeText()];
  if (f instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < f.size(); i++) {
      const n = nameOf(f.get(i));
      if (!n) return [];
      out.push(n);
    }
    return out;
  }
  return [];
}

/** Whether the filter chain is one this decoder understands: [Flate] or [ASCII85, Flate]. */
export function isFlateChain(chain: string[]): boolean {
  return (chain.length === 1 && chain[0] === "FlateDecode") || (chain.length === 2 && chain[0] === "ASCII85Decode" && chain[1] === "FlateDecode");
}

function flateParms(dict: PDFDict, chainLength: number): PDFDict | undefined {
  const p = dict.get(PDFName.of("DecodeParms")) ?? dict.get(PDFName.of("DP"));
  if (p instanceof PDFDict) return p;
  if (p instanceof PDFArray) {
    const e = p.get(chainLength - 1);
    return e instanceof PDFDict ? e : undefined;
  }
  return undefined;
}

function num(d: PDFDict | undefined, key: string, fallback: number): number {
  const v = d?.get(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : fallback;
}

export function ascii85Decode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  const group: number[] = [];
  let i = 0;
  if (input[0] === 0x3c && input[1] === 0x7e) i = 2; // "<~"
  const flush = (count: number) => {
    const n = count;
    while (group.length < 5) group.push(84); // pad with 'u'
    let v = 0;
    for (const c of group) v = v * 85 + c;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    for (let k = 0; k < n - 1; k++) out.push(bytes[k]);
    group.length = 0;
  };
  for (; i < input.length; i++) {
    const c = input[i];
    if (c === 0x7e) break; // "~>"
    if (c <= 32) continue;
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 33 || c > 117) throw new Error("Invalid ASCII85 data");
    group.push(c - 33);
    if (group.length === 5) flush(5);
  }
  if (group.length > 1) flush(group.length);
  return Uint8Array.from(out);
}

export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reverses PNG row filters (Predictor >= 10). */
export function undoPngPredictor(data: Uint8Array, rowBytes: number, bytesPerPixel: number): Uint8Array {
  const stride = rowBytes + 1;
  const rows = Math.floor(data.length / stride);
  const out = new Uint8Array(rows * rowBytes);
  for (let y = 0; y < rows; y++) {
    const type = data[y * stride];
    const src = y * stride + 1;
    const dst = y * rowBytes;
    const prev = dst - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = data[src + x];
      const left = x >= bytesPerPixel ? out[dst + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prev + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prev + x - bytesPerPixel] : 0;
      let v: number;
      switch (type) {
        case 0: v = raw; break;
        case 1: v = raw + left; break;
        case 2: v = raw + up; break;
        case 3: v = raw + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: throw new Error("Unknown PNG filter");
      }
      out[dst + x] = v & 255;
    }
  }
  return out;
}

/**
 * Decodes an 8-bit DeviceRGB / DeviceGray Flate image (with optional ASCII85 wrapper and PNG predictor)
 * to raw pixels. Returns null for anything else (other colour spaces, TIFF predictor, size mismatch).
 */
export async function decodeFlateImage(dict: PDFDict, contents: Uint8Array): Promise<RawImage | null> {
  const chain = filterChain(dict);
  if (!isFlateChain(chain)) return null;
  const cs = nameOf(dict.get(PDFName.of("ColorSpace")));
  const channels = cs === "DeviceRGB" ? 3 : cs === "DeviceGray" ? 1 : 0;
  if (!channels) return null;
  const width = num(dict, "Width", 0);
  const height = num(dict, "Height", 0);
  if (width < 1 || height < 1 || num(dict, "BitsPerComponent", 0) !== 8) return null;

  const parms = flateParms(dict, chain.length);
  const predictor = num(parms, "Predictor", 1);
  if (predictor !== 1 && predictor < 10) return null;
  if (predictor >= 10 && (num(parms, "Colors", 1) !== channels || num(parms, "BitsPerComponent", 8) !== 8 || num(parms, "Columns", 1) !== width)) return null;

  let data = chain[0] === "ASCII85Decode" ? ascii85Decode(contents) : contents;
  data = await inflate(data);
  if (predictor >= 10) data = undoPngPredictor(data, width * channels, channels);
  if (data.length < width * height * channels) return null;
  return { width, height, channels: channels as 1 | 3, pixels: data.length === width * height * channels ? data : data.subarray(0, width * height * channels) };
}
