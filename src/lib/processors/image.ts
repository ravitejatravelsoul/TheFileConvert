import { sanitizeSvgMarkup } from "@/lib/security/validators";

export class ProcessorError extends Error {}

export type ImageOutputFormat = "png" | "jpeg" | "webp";

const MIME_BY_FORMAT: Record<ImageOutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function extensionForFormat(format: ImageOutputFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ProcessorError(
      "We couldn't read this image. It may be corrupted or in an unsupported format."
    );
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, format: ImageOutputFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new ProcessorError("Encoding this image failed."));
        // Browsers silently fall back to PNG for formats they can't encode (Safari and WebP) —
        // never hand that back labelled as the format that was asked for.
        if (blob.type !== MIME_BY_FORMAT[format]) {
          return reject(new ProcessorError(`This browser can't save ${format === "jpeg" ? "JPG" : format.toUpperCase()} images. Try another format, or a different browser.`));
        }
        resolve(blob);
      },
      MIME_BY_FORMAT[format],
      format === "png" ? undefined : quality
    );
  });
}

let webpEncodeSupport: Promise<boolean> | null = null;

/** Whether this browser's canvas can write WebP (Safari can read WebP but not write it). */
export function canEncodeWebp(): Promise<boolean> {
  webpEncodeSupport ??= new Promise((resolve) => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    c.toBlob((b) => resolve(b?.type === "image/webp"), "image/webp");
  });
  return webpEncodeSupport;
}

/** The format a file already is, from its MIME type or extension. */
export function inputFormatOf(file: File): ImageOutputFormat | null {
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "jpeg";
  if (file.type === "image/png" || /\.png$/i.test(file.name)) return "png";
  if (file.type === "image/webp" || /\.webp$/i.test(file.name)) return "webp";
  return null;
}

function drawToCanvas(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  fillWhiteBackground: boolean
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ProcessorError("Your browser can't render canvas content.");
  if (fillWhiteBackground) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

/** True if any pixel of the image is (even partly) transparent. Looks at a downscaled copy, so it stays
 * cheap on very large images; JPEG can never carry transparency, so it isn't even decoded. */
export async function hasTransparency(file: File): Promise<boolean> {
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return false;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return false;
  }
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    return false;
  } finally {
    bitmap.close();
  }
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export async function getImageDimensions(file: File): Promise<ImageDimensions> {
  const bitmap = await loadBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}

export interface ConvertOptions {
  format: ImageOutputFormat;
  quality: number;
}

/** Convert / compress: re-encodes at the target format+quality. Re-drawing on a fresh
 * canvas also strips all EXIF/metadata as a side effect, since canvas pixels carry none. */
export async function convertImage(file: File, options: ConvertOptions): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const needsWhiteBg = options.format === "jpeg";
  const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height, needsWhiteBg);
  bitmap.close();
  return canvasToBlob(canvas, options.format, options.quality);
}

export interface ResizeOptions extends ConvertOptions {
  width: number;
  height: number;
}

export async function resizeImage(file: File, options: ResizeOptions): Promise<Blob> {
  if (options.width < 1 || options.height < 1) {
    throw new ProcessorError("Width and height must be at least 1 pixel.");
  }
  const bitmap = await loadBitmap(file);
  const canvas = drawToCanvas(bitmap, options.width, options.height, options.format === "jpeg");
  bitmap.close();
  return canvasToBlob(canvas, options.format, options.quality);
}

// ---------------------------------------------------------------------------------------------
// Target-size compression (V2): "how small do I need this image?" instead of a quality slider.
// ---------------------------------------------------------------------------------------------

const QUALITY_LADDER = [0.92, 0.82, 0.72, 0.6, 0.48, 0.36, 0.25];
/** Dimensions are only reduced once quality alone can't reach the target. */
const SCALE_LADDER = [1, 0.85, 0.7, 0.55, 0.4];

export interface ImageTargetAttempt {
  scale: number;
  quality: number;
  bytes: number;
}

export interface ImageTargetResult {
  blob: Blob;
  format: ImageOutputFormat;
  width: number;
  height: number;
  originalBytes: number;
  newBytes: number;
  targetBytes: number;
  targetAchieved: boolean;
  quality: number;
  scale: number;
  /** Set when the output format differs from the input's, so the caller can tell the user why. */
  formatChanged: boolean;
  /** The input has (partly) transparent pixels — the reason a PNG goes to WebP rather than JPEG. */
  transparent: boolean;
  attempts: ImageTargetAttempt[];
}

/** Output format for target-size compression: JPEG input stays JPEG; anything with transparency goes
 * to WebP (the only one of the three that keeps it compactly); other images go to WebP. Where the
 * browser can't write WebP, transparent images stay PNG and opaque ones become JPEG. */
export function targetFormatFor(input: ImageOutputFormat | null, transparent: boolean, webp: boolean): ImageOutputFormat {
  if (transparent) return webp ? "webp" : "png";
  if (input === "jpeg") return "jpeg";
  return webp ? "webp" : "jpeg";
}

/**
 * Compresses toward a target file size: walks quality from high to low at full size, and only shrinks
 * dimensions (in fixed steps) if the lowest quality alone still doesn't reach the target. Stops at the
 * first setting that fits.
 */
export async function compressImageToTarget(file: File, targetBytes: number, onProgress?: (label: string) => void): Promise<ImageTargetResult> {
  const transparent = await hasTransparency(file);
  const input = inputFormatOf(file);
  const format = targetFormatFor(input, transparent, await canEncodeWebp());
  const formatChanged = input !== format;
  const dims = await getImageDimensions(file);

  // Nothing to do: the format wouldn't change and the file already fits. Re-encoding an already
  // well-compressed image can make it bigger (recompression artifacts) — never hand that back as if it
  // were a result. This mirrors the PDF engine's free lossless-first step.
  if (!formatChanged && file.size <= targetBytes) {
    return { blob: file, format, width: dims.width, height: dims.height, originalBytes: file.size, newBytes: file.size, targetBytes, targetAchieved: true, quality: 1, scale: 1, formatChanged: false, transparent, attempts: [{ scale: 1, quality: 1, bytes: file.size }] };
  }

  const attempts: ImageTargetAttempt[] = [];
  let best: { blob: Blob; width: number; height: number; quality: number; scale: number } | null = null;

  for (const scale of SCALE_LADDER) {
    const width = Math.max(1, Math.round(dims.width * scale));
    const height = Math.max(1, Math.round(dims.height * scale));
    // PNG has no quality setting: only its dimensions can change.
    for (const quality of format === "png" ? [1] : QUALITY_LADDER) {
      onProgress?.(format === "png" ? `${Math.round(scale * 100)}% size` : `${Math.round(quality * 100)}% quality${scale < 1 ? `, ${Math.round(scale * 100)}% size` : ""}`);
      const blob = await resizeImage(file, { width, height, format, quality });
      attempts.push({ scale, quality, bytes: blob.size });
      if (!best || blob.size < best.blob.size) best = { blob, width, height, quality, scale };
      if (blob.size <= targetBytes) {
        return { blob, format, width, height, originalBytes: file.size, newBytes: blob.size, targetBytes, targetAchieved: true, quality, scale, formatChanged, transparent, attempts };
      }
    }
  }

  return {
    blob: best!.blob,
    format,
    width: best!.width,
    height: best!.height,
    originalBytes: file.size,
    newBytes: best!.blob.size,
    targetBytes,
    targetAchieved: false,
    quality: best!.quality,
    scale: best!.scale,
    formatChanged,
    transparent,
    attempts,
  };
}

/** Long side an SVG is rendered at when its own size is smaller — SVGs are often drawn tiny
 * (24 or 100 px) and a PNG that small is rarely what anyone wants. */
const SVG_MIN_LONG_SIDE = 1024;
const SVG_MAX_LONG_SIDE = 4096;

export async function svgToPng(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const safeSvg = sanitizeSvgMarkup(await file.text());
  const url = URL.createObjectURL(new Blob([safeSvg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new ProcessorError("This SVG couldn't be rendered. It may use unsupported features."));
      image.src = url;
    });
    const naturalW = image.naturalWidth || 300;
    const naturalH = image.naturalHeight || 150;
    const long = Math.max(naturalW, naturalH);
    const scale = Math.min(SVG_MAX_LONG_SIDE, Math.max(SVG_MIN_LONG_SIDE, long)) / long;
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ProcessorError("Your browser can't render canvas content.");
    ctx.drawImage(image, 0, 0, width, height);
    return { blob: await canvasToBlob(canvas, "png", 1), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Gets an image ready to embed in a PDF, which can only hold JPEG and PNG data as-is. JPEG and PNG
 * pass through untouched (no quality loss) unless a JPEG is stored sideways with an EXIF rotation
 * flag — then it is redrawn upright. WebP becomes JPEG, or PNG if it has transparency.
 */
export async function prepareImageForPdf(file: File): Promise<File> {
  const format = inputFormatOf(file);
  if (format === "png") return file;
  if (format === "jpeg") {
    const { jpegOrientation } = await import("./exif");
    const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    if (jpegOrientation(head) === 1) return file;
  }
  const transparent = await hasTransparency(file);
  const out: ImageOutputFormat = transparent ? "png" : "jpeg";
  const blob = await convertImage(file, { format: out, quality: 0.92 });
  const name = file.name.replace(/\.[^.]+$/, "") + (out === "png" ? ".png" : ".jpg");
  return new File([blob], name, { type: blob.type });
}
