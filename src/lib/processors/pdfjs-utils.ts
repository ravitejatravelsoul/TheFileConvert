import type { PDFDocumentProxy } from "pdfjs-dist";

export class PdfRenderError extends Error {}

/** Loads a PDF with pdf.js for rendering/text-extraction. Lazily imports the (large) pdf.js
 * runtime and points it at the self-hosted worker script, so nothing pdf.js-related is pulled
 * into any bundle until a tool that actually needs it runs. */
export async function loadPdfJsDocument(file: File): Promise<PDFDocumentProxy> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const bytes = await file.arrayBuffer();
  try {
    return await pdfjsLib.getDocument({ data: bytes }).promise;
  } catch {
    throw new PdfRenderError(
      "We couldn't read this PDF. It may be damaged, encrypted, or incomplete."
    );
  }
}

/** Renders one page (1-indexed, matching pdf.js convention) to an offscreen canvas. */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  rotate: 0 | 90 | 180 | 270 = 0,
  /** Device pixels per CSS pixel. The canvas is drawn at `scale * pixelRatio` and sized back down
   * to `scale` in CSS, so on a HiDPI/scaled display the page is crisp instead of being
   * upscaled (blurry) by the browser. 1 keeps the old one-pixel-per-CSS-pixel canvas. */
  pixelRatio = 1
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const cssViewport = page.getViewport({ scale, rotation: rotate });
  const viewport = pixelRatio === 1 ? cssViewport : page.getViewport({ scale: scale * pixelRatio, rotation: rotate });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  if (pixelRatio !== 1) {
    canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
    canvas.style.height = `${Math.ceil(cssViewport.height)}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PdfRenderError("Your browser can't render canvas content.");
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

/** Concatenates a page's native (embedded) text content, if any. */
export async function getPageTextContent(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}
