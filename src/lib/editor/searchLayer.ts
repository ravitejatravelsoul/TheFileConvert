import { degrees, type PDFFont, type PDFPage } from "pdf-lib";
import type { OcrPageResult } from "@/lib/processors/ocr";
import { contentFrame } from "./contentFrame";
import { sanitizeForFont } from "./textLayout";

/**
 * The searchable text layer of a recognised (OCR'd) scan: every recognised line is drawn as invisible
 * (fully transparent) text over the place it was read from, so the exported PDF can be searched, selected
 * and copied while every pixel looks exactly like the scan. Words the user corrected carry the corrected
 * text — the old reading isn't searchable any more.
 */

export type Rect = { x: number; y: number; width: number; height: number };

export interface TextCorrection extends Rect {
  originalText: string;
  newText: string;
  /** The whole word's box when the correction's own box covers only the changed characters. */
  searchAnchor?: Rect;
}

/** Share of `box`'s area covered by `others` (overlaps between them aren't subtracted; capped at 1). */
function coveredBy(box: Rect, others: Rect[]): number {
  let area = 0;
  for (const o of others) {
    const w = Math.min(box.x + box.width, o.x + o.width) - Math.max(box.x, o.x);
    const h = Math.min(box.y + box.height, o.y + o.height) - Math.max(box.y, o.y);
    if (w > 0 && h > 0) area += w * h;
  }
  return Math.min(1, area / Math.max(1e-6, box.width * box.height));
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * `text`, laid out along `box`, with each correction that overlaps the box applied: the occurrence of the
 * original word nearest the correction's position is replaced (so a word repeated in a line is corrected
 * where it was clicked). Returns which corrections were applied.
 */
export function applyCorrections<C extends TextCorrection>(text: string, box: Rect, corrections: C[]): { text: string; applied: Set<C> } {
  let out = text;
  const applied = new Set<C>();
  for (const c of corrections) {
    const at = c.searchAnchor ?? c;
    if (!c.originalText || !overlaps(at, box)) continue;
    const found: number[] = [];
    for (let i = out.indexOf(c.originalText); i >= 0; i = out.indexOf(c.originalText, i + 1)) found.push(i);
    if (!found.length) continue;
    const along = (at.x + at.width / 2 - box.x) / Math.max(1, box.width);
    const where = (i: number) => Math.abs((i + c.originalText.length / 2) / Math.max(1, out.length) - along);
    const best = found.reduce((p, q) => (where(q) < where(p) ? q : p));
    out = out.slice(0, best) + c.newText + out.slice(best + c.originalText.length);
    applied.add(c);
  }
  return { text: out, applied };
}

/** The corrections the page's text layer will carry (their word sits in a recognised line). Decided before
 * drawing, so a correction never gets a searchable run of its own as well. */
export function correctionsInLayer<C extends TextCorrection>(ocr: OcrPageResult, corrections: C[]): Set<C> {
  const out = new Set<C>();
  for (const line of ocr.lines) for (const c of applyCorrections(line.text, line.pdfBox, corrections).applied) out.add(c);
  return out;
}

/**
 * Draws a page's recognised lines as invisible text. `rotation` is the display rotation the page was read
 * at (the recognised text runs that way in the page's own space). A correction that was drawn as visible,
 * selectable text already is searchable: `drawnAsText` corrections are left out of the layer (old reading
 * and new), so every word is found exactly once.
 */
export function drawOcrTextLayer<C extends TextCorrection>(
  page: PDFPage,
  ocr: OcrPageResult,
  corrections: C[],
  font: PDFFont,
  rotation: number,
  drawnAsText: Set<C> = new Set(),
  /** Where the page already has real text: a line OCR read there again is left out (no duplicates). */
  nativeText: Rect[] = []
): void {
  const layered = corrections.map((c) => (drawnAsText.has(c) ? { ...c, newText: "" } : c));
  const canEncode = (ch: string) => {
    try {
      font.widthOfTextAtSize(ch, 1);
      return true;
    } catch {
      return false;
    }
  };
  for (const line of ocr.lines) {
    const box = line.pdfBox;
    if (!(box.width > 0 && box.height > 0)) continue;
    if (coveredBy(box, nativeText) > 0.5) continue;
    const corrected = applyCorrections(line.text, box, layered);
    // A character the font can't encode becomes "?" — the rest of the line stays searchable.
    const text = sanitizeForFont(corrected.text.replace(/\s{2,}/g, " ").trim(), canEncode);
    if (!text) continue;
    // In the line's own frame: along the text and across it, whichever way the page is turned.
    const frame = contentFrame(box, rotation);
    const across = frame.height * 0.85;
    let size = across;
    const natural = font.widthOfTextAtSize(text, 1);
    // Sized so the run spans the line (selection highlights match the scan), within sane bounds.
    if (natural > 0) size = Math.min(Math.max(frame.width / natural, across * 0.5), across * 2);
    const at = frame.toPdf(0, frame.height * 0.2); // baseline: above the descenders inside the box
    try {
      page.drawText(text, { x: at.x, y: at.y, size: Math.max(1, size), font, opacity: 0, rotate: degrees(frame.rotation) });
    } catch {
      // Never let one line stop the export; that line just isn't searchable.
    }
  }
}
