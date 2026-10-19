import UPNG from "@pdf-lib/upng";
import type { Locator, Page } from "@playwright/test";

export interface Raster {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

export function decode(png: Buffer): Raster {
  const img = UPNG.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer);
  return { width: img.width, height: img.height, data: new Uint8Array(UPNG.toRGBA8(img)[0]) };
}

/** Pixels that differ by more than `tol` in any channel. */
export function diffCount(a: Raster, b: Raster, tol = 24): number {
  if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) n++;
  }
  return n;
}

/** Bounding box (px) and amount of ink: pixels darker than `below` (0-255 grey). */
export function ink(r: Raster, below = 170) {
  let x0 = r.width, y0 = r.height, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4;
      const g = (r.data[i] + r.data[i + 1] + r.data[i + 2]) / 3;
      if (g < below) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, count, empty: count === 0 };
}

export async function clipOf(el: Locator, margin = 4) {
  const b = (await el.boundingBox())!;
  return { x: Math.max(0, b.x - margin), y: Math.max(0, b.y - margin), width: b.width + 2 * margin, height: b.height + 2 * margin };
}

/** The inside of an element, `inset` px in from every edge (so its border is not part of it). */
export async function innerClip(el: Locator, inset = 3) {
  const b = (await el.boundingBox())!;
  return { x: b.x + inset, y: b.y + inset, width: Math.max(1, b.width - 2 * inset), height: Math.max(1, b.height - 2 * inset) };
}

/** A screenshot of a region with some page elements hidden (and restored). */
export async function shot(page: Page, clip: { x: number; y: number; width: number; height: number }, hideCss = ""): Promise<Raster> {
  let handle: string | null = null;
  if (hideCss) {
    handle = await page.evaluate((css) => {
      const s = document.createElement("style");
      s.id = "__tfc_hide";
      s.textContent = css;
      document.head.appendChild(s);
      return s.id;
    }, hideCss);
  }
  const buf = await page.screenshot({ clip });
  if (handle) await page.evaluate(() => document.getElementById("__tfc_hide")?.remove());
  return decode(buf);
}
