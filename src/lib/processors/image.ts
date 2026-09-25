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
      (blob) => (blob ? resolve(blob) : reject(new ProcessorError("Encoding this image failed."))),
      MIME_BY_FORMAT[format],
      format === "png" ? undefined : quality
    );
  });
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

export function computeAspectRatioSize(
  original: ImageDimensions,
  targetWidth?: number,
  targetHeight?: number
): ImageDimensions {
  if (targetWidth && !targetHeight) {
    return { width: targetWidth, height: Math.round((targetWidth / original.width) * original.height) };
  }
  if (targetHeight && !targetWidth) {
    return { width: Math.round((targetHeight / original.height) * original.width), height: targetHeight };
  }
  return { width: targetWidth ?? original.width, height: targetHeight ?? original.height };
}

export interface CropOptions extends ConvertOptions {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function cropImage(file: File, options: CropOptions): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  if (
    options.width < 1 ||
    options.height < 1 ||
    options.x < 0 ||
    options.y < 0 ||
    options.x + options.width > bitmap.width ||
    options.y + options.height > bitmap.height
  ) {
    bitmap.close();
    throw new ProcessorError("The crop area must be fully inside the image.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ProcessorError("Your browser can't render canvas content.");
  if (options.format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, options.width, options.height);
  }
  ctx.drawImage(
    bitmap,
    options.x,
    options.y,
    options.width,
    options.height,
    0,
    0,
    options.width,
    options.height
  );
  bitmap.close();
  return canvasToBlob(canvas, options.format, options.quality);
}

export interface RotateFlipOptions extends ConvertOptions {
  rotateDegrees: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export async function rotateFlipImage(file: File, options: RotateFlipOptions): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const swapDimensions = options.rotateDegrees === 90 || options.rotateDegrees === 270;
  const width = swapDimensions ? bitmap.height : bitmap.width;
  const height = swapDimensions ? bitmap.width : bitmap.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ProcessorError("Your browser can't render canvas content.");
  if (options.format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  ctx.translate(width / 2, height / 2);
  ctx.rotate((options.rotateDegrees * Math.PI) / 180);
  ctx.scale(options.flipHorizontal ? -1 : 1, options.flipVertical ? -1 : 1);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
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
  attempts: ImageTargetAttempt[];
}

/**
 * Compresses toward a target file size. Picks WebP for images with transparency (the only one of the
 * three output formats that keeps it efficiently) and otherwise keeps JPEG input as JPEG or uses WebP —
 * then walks quality from high to low at full size, and only shrinks dimensions (in fixed steps) if the
 * lowest quality alone still doesn't reach the target. Stops at the first setting that fits.
 */
export async function compressImageToTarget(file: File, targetBytes: number, onProgress?: (label: string) => void): Promise<ImageTargetResult> {
  const transparent = await hasTransparency(file);
  const isJpegInput = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name);
  const format: ImageOutputFormat = transparent ? "webp" : isJpegInput ? "jpeg" : "webp";
  const formatChanged = (transparent && !/\.webp$/i.test(file.name) && file.type !== "image/webp") || (!transparent && !isJpegInput && file.type !== "image/webp");
  const dims = await getImageDimensions(file);

  // Nothing to do: the format wouldn't change and the file already fits. Re-encoding an already
  // well-compressed image can make it bigger (recompression artifacts) — never hand that back as if it
  // were a result. This mirrors the PDF engine's free lossless-first step.
  if (!formatChanged && file.size <= targetBytes) {
    return { blob: file, format, width: dims.width, height: dims.height, originalBytes: file.size, newBytes: file.size, targetBytes, targetAchieved: true, quality: 1, scale: 1, formatChanged: false, attempts: [{ scale: 1, quality: 1, bytes: file.size }] };
  }

  const attempts: ImageTargetAttempt[] = [];
  let best: { blob: Blob; width: number; height: number; quality: number; scale: number } | null = null;

  for (const scale of SCALE_LADDER) {
    const width = Math.max(1, Math.round(dims.width * scale));
    const height = Math.max(1, Math.round(dims.height * scale));
    for (const quality of QUALITY_LADDER) {
      onProgress?.(`${Math.round(quality * 100)}% quality${scale < 1 ? `, ${Math.round(scale * 100)}% size` : ""}`);
      const blob = await resizeImage(file, { width, height, format, quality });
      attempts.push({ scale, quality, bytes: blob.size });
      if (!best || blob.size < best.blob.size) best = { blob, width, height, quality, scale };
      if (blob.size <= targetBytes) {
        return { blob, format, width, height, originalBytes: file.size, newBytes: blob.size, targetBytes, targetAchieved: true, quality, scale, formatChanged, attempts };
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
    attempts,
  };
}

export interface SvgToPngOptions {
  width: number;
  height: number;
}

export async function svgToPng(file: File, options: SvgToPngOptions): Promise<Blob> {
  const rawText = await file.text();
  const safeSvg = sanitizeSvgMarkup(rawText);
  const svgBlob = new Blob([safeSvg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new ProcessorError("This SVG couldn't be rendered. It may use unsupported features."));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ProcessorError("Your browser can't render canvas content.");
    ctx.drawImage(image, 0, 0, options.width, options.height);
    return await canvasToBlob(canvas, "png", 1);
  } finally {
    URL.revokeObjectURL(url);
  }
}
