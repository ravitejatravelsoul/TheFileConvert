import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, type PDFObject } from "pdf-lib";

/**
 * Browser-local PDF size reduction, in three honest levels:
 *
 *  - "lossless": structure-only. Re-saves with object streams and merges byte-identical images that
 *    were embedded more than once. Never changes what any page looks like. For a PDF that is mostly
 *    scanned/photo images this usually saves almost nothing — the analysis says so up front.
 *  - "balanced" / "small": additionally re-encodes embedded JPEG images at lower quality and, when
 *    they are larger than needed, fewer pixels. This is lossy and is only ever applied when the user
 *    chooses it. An image is only replaced if the result is actually smaller.
 *
 * Only JPEG (DCTDecode) 8-bit RGB/Gray images without special decode arrays are recompressed; other
 * image encodings (Flate/PNG-style, JBIG2, CCITT, CMYK, image masks) are left untouched and counted.
 */

export type CompressLevel = "lossless" | "balanced" | "small";

export const LEVEL_SETTINGS: Record<Exclude<CompressLevel, "lossless">, { quality: number; maxLongSide: number; label: string; tradeoff: string }> = {
  balanced: {
    quality: 0.72,
    maxLongSide: 2000,
    label: "Balanced",
    tradeoff: "Images re-saved at ~72% JPEG quality and capped at 2000 px on the long side. Text and line art stay sharp; fine photo detail softens slightly.",
  },
  small: {
    quality: 0.5,
    maxLongSide: 1400,
    label: "Smallest",
    tradeoff: "Images re-saved at ~50% JPEG quality and capped at 1400 px. Noticeably softer photos and small scanned text; best for sharing or email.",
  },
};

export interface PdfImageAnalysis {
  totalBytes: number;
  imageCount: number;
  jpegCount: number;
  /** Bytes taken by all embedded image data. */
  imageBytes: number;
  /** Bytes in JPEG images that could be recompressed. */
  jpegBytes: number;
  /** Images whose bytes are identical to an earlier one (mergeable without any quality change). */
  duplicateCount: number;
  duplicateBytes: number;
}

interface ImageEntry {
  ref: PDFRef;
  stream: PDFRawStream;
  isJpeg: boolean;
  bytes: Uint8Array;
}

function nameOf(obj: PDFObject | undefined): string | undefined {
  return obj instanceof PDFName ? obj.decodeText() : undefined;
}

function filterOf(dict: PDFDict): string | undefined {
  const f = dict.get(PDFName.of("Filter"));
  if (f instanceof PDFName) return f.decodeText();
  if (f instanceof PDFArray && f.size() === 1) return nameOf(f.get(0));
  return undefined;
}

function collectImages(doc: PDFDocument): ImageEntry[] {
  const out: ImageEntry[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (nameOf(obj.dict.get(PDFName.of("Subtype"))) !== "Image") continue;
    out.push({ ref, stream: obj, isJpeg: filterOf(obj.dict) === "DCTDecode", bytes: obj.contents });
  }
  return out;
}

function fingerprint(e: ImageEntry): string {
  // Length + a strided sample + the dictionary's identity-relevant fields: cheap, and collisions are
  // then confirmed with a full byte comparison.
  const b = e.bytes;
  let h = 2166136261;
  const step = Math.max(1, Math.floor(b.length / 4096));
  for (let i = 0; i < b.length; i += step) h = Math.imul(h ^ b[i], 16777619) >>> 0;
  const d = e.stream.dict;
  const w = (d.get(PDFName.of("Width")) as PDFNumber | undefined)?.asNumber();
  const hgt = (d.get(PDFName.of("Height")) as PDFNumber | undefined)?.asNumber();
  return `${b.length}:${h}:${w}x${hgt}:${filterOf(d)}:${d.get(PDFName.of("SMask"))?.toString() ?? ""}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Groups byte-identical images; returns duplicate ref -> canonical ref. */
function findDuplicates(images: ImageEntry[]): Map<PDFRef, PDFRef> {
  const seen = new Map<string, ImageEntry[]>();
  const dups = new Map<PDFRef, PDFRef>();
  for (const img of images) {
    const key = fingerprint(img);
    const bucket = seen.get(key) ?? [];
    const canonical = bucket.find((c) => sameBytes(c.bytes, img.bytes));
    if (canonical) dups.set(img.ref, canonical.ref);
    else bucket.push(img);
    seen.set(key, bucket);
  }
  return dups;
}

export async function analyzePdfImages(bytes: ArrayBuffer | Uint8Array): Promise<PdfImageAnalysis> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false });
  const images = collectImages(doc);
  const dups = findDuplicates(images);
  const byRef = new Map(images.map((i) => [i.ref, i]));
  let duplicateBytes = 0;
  for (const dupRef of dups.keys()) duplicateBytes += byRef.get(dupRef)!.bytes.length;
  return {
    totalBytes: data.length,
    imageCount: images.length,
    jpegCount: images.filter((i) => i.isJpeg).length,
    imageBytes: images.reduce((s, i) => s + i.bytes.length, 0),
    jpegBytes: images.filter((i) => i.isJpeg).reduce((s, i) => s + i.bytes.length, 0),
    duplicateCount: dups.size,
    duplicateBytes,
  };
}

/** What the analysis means for the user, before they press anything. */
export function describeAnalysis(a: PdfImageAnalysis): { headline: string; advice: string; suggestLossy: boolean } {
  const share = a.totalBytes > 0 ? a.imageBytes / a.totalBytes : 0;
  const pct = Math.round(share * 100);
  if (a.imageCount === 0) {
    return { headline: "This PDF has no embedded images — it is text and vector content.", advice: "Lossless optimization is all that applies here, and it usually saves only a few percent (often nothing if the file was already optimized).", suggestLossy: false };
  }
  const dup = a.duplicateCount > 0 ? ` ${a.duplicateCount} of them are exact repeats that can be merged with no quality loss.` : "";
  if (share < 0.25) {
    return { headline: `${a.imageCount} embedded image${a.imageCount === 1 ? "" : "s"} (${pct}% of the file).${dup}`, advice: "Mostly text: expect little from lossless optimization.", suggestLossy: false };
  }
  if (a.jpegCount === 0) {
    return { headline: `${a.imageCount} embedded image${a.imageCount === 1 ? "" : "s"} (${pct}% of the file), none of them JPEG.${dup}`, advice: "This tool can only recompress JPEG images. Other image encodings are kept exactly as they are, so savings will be small.", suggestLossy: false };
  }
  const dupShare = a.totalBytes > 0 ? a.duplicateBytes / a.totalBytes : 0;
  const headline = `${a.imageCount} embedded image${a.imageCount === 1 ? "" : "s"} ${a.imageCount === 1 ? "makes" : "make"} up ${pct}% of this file.${dup}`;
  if (dupShare >= 0.1) {
    return { headline, advice: `Lossless mode should still help: merging the repeated images alone saves roughly ${Math.round(dupShare * 100)}% with no quality loss. Balanced or Smallest go further by lowering image quality.`, suggestLossy: true };
  }
  return { headline, advice: "Lossless optimization will barely change a file like this. To actually shrink it, choose Balanced or Smallest below (this lowers image quality).", suggestLossy: true };
}

export interface CompressResult {
  blob: Blob;
  originalBytes: number;
  newBytes: number;
  imagesRecompressed: number;
  imagesSkipped: number;
  duplicatesMerged: number;
  /** One line describing what was really done, for the result screen. */
  summary: string;
}

/** Re-encodes a JPEG. Injected so the pdf-lib logic is testable without a canvas. */
export type JpegReencoder = (jpeg: Uint8Array, opts: { quality: number; maxLongSide: number }) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>;

/** Browser implementation: decode with the browser's own JPEG decoder, downscale if needed, re-encode. */
export const canvasReencoder: JpegReencoder = async (jpeg, { quality, maxLongSide }) => {
  const blob = new Blob([jpeg as BlobPart], { type: "image/jpeg" });
  // EXIF orientation must not be applied: a PDF draws the raw pixel grid.
  const bitmap = await createImageBitmap(blob, { imageOrientation: "none" });
  try {
    const scale = Math.min(1, maxLongSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!out) return null;
    return { bytes: new Uint8Array(await out.arrayBuffer()), width: w, height: h };
  } finally {
    bitmap.close();
  }
};

function isRecompressible(dict: PDFDict): boolean {
  const cs = nameOf(dict.get(PDFName.of("ColorSpace")));
  if (cs !== "DeviceRGB" && cs !== "DeviceGray") return false;
  const bpc = (dict.get(PDFName.of("BitsPerComponent")) as PDFNumber | undefined)?.asNumber();
  if (bpc !== 8) return false;
  if (dict.get(PDFName.of("Decode")) || dict.get(PDFName.of("ImageMask")) || dict.get(PDFName.of("Mask"))) return false;
  return true;
}

export async function compressPdfDocument(
  input: Uint8Array,
  level: CompressLevel,
  reencode: JpegReencoder = canvasReencoder
): Promise<CompressResult> {
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const images = collectImages(doc);
  let duplicatesMerged = 0;
  let imagesRecompressed = 0;
  let imagesSkipped = 0;

  // 1. Merge exact duplicate images (lossless): point every reference at the first copy, drop the rest.
  const dups = findDuplicates(images);
  if (dups.size > 0) {
    for (const page of doc.getPages()) {
      const res = page.node.Resources();
      const xobjects = res?.lookupMaybe(PDFName.of("XObject"), PDFDict);
      if (!xobjects) continue;
      for (const key of xobjects.keys()) {
        const v = xobjects.get(key);
        if (v instanceof PDFRef && dups.has(v)) xobjects.set(key, dups.get(v)!);
      }
    }
    for (const dupRef of dups.keys()) {
      doc.context.delete(dupRef);
      duplicatesMerged++;
    }
  }

  // 2. Optional lossy JPEG recompression.
  if (level !== "lossless") {
    const { quality, maxLongSide } = LEVEL_SETTINGS[level];
    for (const img of images) {
      if (dups.has(img.ref)) continue;
      if (!img.isJpeg || !isRecompressible(img.stream.dict)) {
        imagesSkipped++;
        continue;
      }
      let result: Awaited<ReturnType<JpegReencoder>> = null;
      try {
        result = await reencode(img.bytes, { quality, maxLongSide });
      } catch {
        result = null;
      }
      if (!result || result.bytes.length >= img.bytes.length * 0.95) {
        imagesSkipped++;
        continue;
      }
      const dict = img.stream.dict.clone(doc.context);
      dict.set(PDFName.of("Width"), PDFNumber.of(result.width));
      dict.set(PDFName.of("Height"), PDFNumber.of(result.height));
      dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB")); // canvas output is always RGB
      dict.set(PDFName.of("Length"), PDFNumber.of(result.bytes.length));
      doc.context.assign(img.ref, PDFRawStream.of(dict, result.bytes));
      imagesRecompressed++;
    }
  }

  const bytes = await doc.save({ useObjectStreams: true });
  const parts: string[] = [];
  if (imagesRecompressed > 0) parts.push(`re-encoded ${imagesRecompressed} image${imagesRecompressed === 1 ? "" : "s"} at reduced quality`);
  if (duplicatesMerged > 0) parts.push(`merged ${duplicatesMerged} duplicate image${duplicatesMerged === 1 ? "" : "s"}`);
  parts.push("optimized the file structure");
  return {
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
    originalBytes: input.length,
    newBytes: bytes.length,
    imagesRecompressed,
    imagesSkipped,
    duplicatesMerged,
    summary: parts.join(", ").replace(/^./, (c) => c.toUpperCase()) + ".",
  };
}
