import fs from "node:fs";
import { createCanvas, type Canvas } from "@napi-rs/canvas";

/** Minimal pdf.js CanvasFactory backed by @napi-rs/canvas — already an optional dependency
 * of pdfjs-dist itself (used for its own Node rendering support), so this adds no new
 * package. Lets tests actually rasterize an exported PDF page and inspect real pixels,
 * rather than only checking operator lists or extracted text. */
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset(canvasAndContext: { canvas: Canvas }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: { canvas: Canvas }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

export interface RenderedPage {
  width: number;
  height: number;
  /** Returns [r,g,b,a] (0-255) at the given pixel coordinate. */
  getPixel(x: number, y: number): [number, number, number, number];
  /** Saves the rendered page as a PNG file, for debugging a failing assertion. */
  savePng(path: string): void;
}

export async function renderPdfPage(bytes: Uint8Array | Buffer, pageNumber: number, scale = 2): Promise<RenderedPage> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const factory = new NodeCanvasFactory();
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    // pdfjs-dist's Node canvas support isn't reflected in its DOM-oriented public types.
    canvasFactory: factory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const { canvas, context } = factory.create(viewport.width, viewport.height);
  await page.render({
    canvasContext: context,
    viewport,
    canvasFactory: factory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any).promise;

  return {
    width: viewport.width,
    height: viewport.height,
    getPixel(x: number, y: number) {
      const data = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      return [data[0], data[1], data[2], data[3]];
    },
    savePng(path: string) {
      fs.writeFileSync(path, canvas.toBuffer("image/png"));
    },
  };
}

/** True if a pixel is close to white/blank (background), within a tolerance. */
export function isBlank([r, g, b, a]: [number, number, number, number], tolerance = 10): boolean {
  return a < 10 || (r > 255 - tolerance && g > 255 - tolerance && b > 255 - tolerance);
}
