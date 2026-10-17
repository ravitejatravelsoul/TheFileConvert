import { buildDocx } from "@/lib/processors/pdf-to-word/docx";
import type { PageImage, PageLayout } from "@/lib/processors/pdf-to-word/layout";
import { prepareImageForPdf } from "@/lib/processors/image";

/**
 * Images → one Word document, one image per page, in order.
 *
 * A conversion, not a recognition: the picture goes into the document as it is, so a filled-in form, an ID, a
 * receipt, a screenshot or a photo looks exactly like the original. Nothing is read, retyped or re-encoded —
 * JPEG and PNG bytes are embedded untouched (a sideways JPEG is redrawn upright, WebP becomes JPEG/PNG, as
 * Word can't hold WebP). Text from a picture is the job of Recognize text in the PDF Editor.
 */

export type ImageWordPageSize = "fit" | "a4" | "letter";

export class ImageToWordError extends Error {}

const LETTER: [number, number] = [612, 792];
const A4: [number, number] = [595.28, 841.89];

/** The page for an image of `w × h` pixels: its own proportions up to Letter size, or A4/Letter with a margin. */
export function pageFor(w: number, h: number, size: ImageWordPageSize, margin = 36): { width: number; height: number; x: number; y: number; imageW: number; imageH: number } {
  const landscape = w > h;
  if (size === "fit") {
    // The image's own proportions, as large as fits a Letter page (turned sideways for a wide image): the
    // Word page *is* the picture — no margins, no cropping, no stretching.
    const [bw, bh] = landscape ? [LETTER[1], LETTER[0]] : LETTER;
    const k = Math.min(bw / w, bh / h);
    const iw = w * k;
    const ih = h * k;
    return { width: iw, height: ih, x: 0, y: 0, imageW: iw, imageH: ih };
  }
  const [short, long] = size === "a4" ? A4 : LETTER;
  const [pw, ph] = landscape ? [long, short] : [short, long];
  // Never enlarged past its pixel size at 96 dpi (a small image isn't blown up into a blur).
  const k = Math.min((pw - margin * 2) / w, (ph - margin * 2) / h, 0.75);
  const iw = w * k;
  const ih = h * k;
  return { width: pw, height: ph, x: (pw - iw) / 2, y: (ph - ih) / 2, imageW: iw, imageH: ih };
}

async function pixelSize(file: File): Promise<{ w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  return size;
}

export async function imagesToWord(files: File[], options: { pageSize: ImageWordPageSize; title?: string; onProgress?: (done: number, total: number) => void }): Promise<Blob> {
  if (files.length === 0) throw new ImageToWordError("Add at least one image.");
  const pages: PageLayout[] = [];
  for (const [i, file] of files.entries()) {
    options.onProgress?.(i, files.length);
    let prepared: File;
    let size: { w: number; h: number };
    try {
      prepared = await prepareImageForPdf(file); // JPEG/PNG untouched; sideways JPEG upright; WebP → JPEG/PNG
      size = await pixelSize(prepared);
    } catch {
      throw new ImageToWordError(`“${file.name}” couldn't be read. It may be damaged — remove it and try again.`);
    }
    const bytes = new Uint8Array(await prepared.arrayBuffer());
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpeg) throw new ImageToWordError(`“${file.name}” isn't a JPG, PNG or WebP image.`);
    const place = pageFor(size.w, size.h, options.pageSize);
    const image: PageImage = { x: place.x, y: place.y, w: place.imageW, h: place.imageH, bytes, mime: isPng ? "image/png" : "image/jpeg", pxWidth: size.w, pxHeight: size.h };
    pages.push({
      width: place.width,
      height: place.height,
      margins: { left: 0, right: 0, top: 0, bottom: 0 },
      blocks: [],
      // In front of the (empty) text layer, so it can be clicked, moved and resized in Word.
      floating: [{ image, x: place.x, y: place.y, width: place.imageW, height: place.imageH, behind: false }],
      header: null,
      footer: null,
      headerDistance: 0,
      footerDistance: 0,
    });
  }
  options.onProgress?.(files.length, files.length);
  const bytes = await buildDocx(pages, { title: options.title ?? "Images", bodySize: 11, bodyFont: "" });
  return new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
