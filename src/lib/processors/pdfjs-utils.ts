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
  rotate: 0 | 90 | 180 | 270 = 0
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale, rotation: rotate });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
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
