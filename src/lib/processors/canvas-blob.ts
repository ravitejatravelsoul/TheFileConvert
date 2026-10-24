/**
 * A canvas as encoded image bytes.
 *
 * `canvas.toBlob` is scheduled by the browser as idle work. In a tab that is in the background, minimised or
 * covered, no frames are drawn, so idle time is scarce and each call can take seconds (measured: ~7 s for a page
 * that takes 0.1 s in the foreground) — a conversion with a few of them crawls. `OffscreenCanvas.convertToBlob`
 * encodes on a worker thread with no such dependency, so a conversion runs at the same speed wherever the tab is.
 * Falls back to `toBlob` where OffscreenCanvas isn't available.
 */
export async function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined" && typeof OffscreenCanvas.prototype.convertToBlob === "function") {
    try {
      const copy = new OffscreenCanvas(canvas.width, canvas.height);
      const ctx = copy.getContext("2d");
      if (ctx) {
        ctx.drawImage(canvas, 0, 0);
        return await copy.convertToBlob({ type, quality });
      }
    } catch {
      // fall through to the ordinary path
    }
  }
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}
