import { PDFDocument } from "pdf-lib";
import { browserFontLoader, loadFonts, type FontLoader } from "./fonts";
import { decoratePages, layoutDocument, type LayoutEnv } from "./layout";
import { MESSAGES, WordToPdfError, analyzeDocx, parseDocx } from "./parse";
import { renderPdf, type ImageDecoder } from "./render";

export { WordToPdfError, analyzeDocx };

/**
 * The real page count, from our own layout (Word's cached count in docProps/app.xml is often stale —
 * many apps that write .docx never update it). Also surfaces a damaged file before Convert is pressed.
 */
export async function countPages(input: { name: string; bytes: Uint8Array }, options: { fontLoader?: FontLoader } = {}): Promise<number> {
  const model = await parseDocx(input.bytes, input.name);
  const fonts = await loadFonts(model, options.fontLoader ?? browserFontLoader);
  return layoutDocument(model, { fonts, defaultTab: model.defaultTab, field: () => "1", footnotes: model.footnotes }).length;
}

export type Progress = { stage: "reading" } | { stage: "fonts" } | { stage: "layout" } | { stage: "drawing"; page: number; total: number };

export interface WordToPdfResult {
  bytes: Uint8Array;
  blob: Blob;
  pages: number;
  pictures: number;
  tables: number;
  /** Plain-words notes about anything that couldn't be kept exactly. */
  notes: string[];
}

/** Browser-only: pictures pdf-lib can't embed directly (GIF, BMP, TIFF, WebP) are redrawn as PNG. */
export const browserImageDecoder: ImageDecoder = async (m) => {
  if (m.type === "emf" || m.type === "wmf" || m.type === "unknown" || typeof createImageBitmap !== "function") return null;
  try {
    const mime = m.type === "tiff" ? "image/tiff" : `image/${m.type}`;
    const bmp = await createImageBitmap(new Blob([m.bytes as BlobPart], { type: mime }));
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
};

/** .docx → PDF, entirely in the browser: parse the Office Open XML, lay it out, draw it with pdf-lib. */
export async function convertWordToPdf(
  input: { name: string; bytes: Uint8Array },
  options: { onProgress?: (p: Progress) => void; fontLoader?: FontLoader; decodeImage?: ImageDecoder } = {},
): Promise<WordToPdfResult> {
  const progress = options.onProgress ?? (() => {});
  progress({ stage: "reading" });
  const model = await parseDocx(input.bytes, input.name);

  progress({ stage: "fonts" });
  let fonts;
  try {
    fonts = await loadFonts(model, options.fontLoader ?? browserFontLoader);
  } catch {
    throw new WordToPdfError("The fonts for your PDF couldn't be loaded. Check your connection and try again.");
  }

  progress({ stage: "layout" });
  const env: LayoutEnv = { fonts, defaultTab: model.defaultTab, field: () => "1", footnotes: model.footnotes };
  let pages;
  try {
    pages = layoutDocument(model, env);
    decoratePages(pages, model, env);
  } catch {
    throw new WordToPdfError(MESSAGES.damaged);
  }

  const title = model.title || input.name.replace(/\.docx?$/i, "");
  const rendered = await renderPdf(pages, fonts, model.media, {
    title,
    decodeImage: options.decodeImage,
    onPage: (page, total) => progress({ stage: "drawing", page, total }),
  });

  // Never hand over a broken file: the PDF must reopen with the page count we drew.
  try {
    const check = await PDFDocument.load(rendered.bytes, { updateMetadata: false });
    if (check.getPageCount() !== pages.length || pages.length === 0) throw new Error("page count");
  } catch {
    throw new WordToPdfError("The PDF didn't pass our file check, so it wasn't saved. Please try again.");
  }

  const notes: string[] = [];
  if (rendered.unsupportedPictures) notes.push(`${rendered.unsupportedPictures === 1 ? "1 picture is" : `${rendered.unsupportedPictures} pictures are`} in a format that can't be drawn here (such as EMF), so ${rendered.unsupportedPictures === 1 ? "it's" : "they're"} shown as an empty frame.`);
  if (fonts.missing.size) notes.push(`Some characters (${[...fonts.missing].slice(0, 8).join(" ")}) have no font available here and appear as empty boxes.`);
  if (model.stats.textBoxes) notes.push("Text boxes are placed as ordinary paragraphs next to where they're anchored.");
  if (model.stats.equations) notes.push("Equations are shown as plain text.");
  if (model.stats.rtl) notes.push("Right-to-left text (Arabic, Hebrew) isn't fully supported yet and may not read correctly.");

  return {
    bytes: rendered.bytes,
    blob: new Blob([rendered.bytes as BlobPart], { type: "application/pdf" }),
    pages: pages.length,
    pictures: rendered.pictures,
    tables: model.stats.tables,
    notes,
  };
}
