import { loadPdfJsDocument } from "@/lib/processors/pdfjs-utils";

export interface NativeTextRegion {
  id: string;
  pageIndex: number; // 0-based
  text: string;
  /** Covers the glyphs fully, descenders included; the baseline sits DESCENT_SHARE of the height above the bottom. */
  pdfBox: { x: number; y: number; width: number; height: number };
}

export interface TextRun {
  str: string;
  /** Baseline start, PDF points (y up). */
  x: number;
  y: number;
  width: number;
  /** Font size / line height of the run. */
  height: number;
}

/** Part of a region's height below the baseline (descenders), so a replacement is drawn on the same baseline. */
export const DESCENT_SHARE = 0.2;
/** A horizontal gap wider than this many font-heights separates two regions (e.g. a label and its value). */
const COLUMN_GAP = 1.2;
/** A gap wider than this (but not a column gap) stands for a space the PDF didn't store as a character. */
const SPACE_GAP = 0.15;
const PAD_X = 0.5;

/**
 * Groups text runs into editable regions: runs on the same baseline form a line, and a line is split
 * wherever there is a wide horizontal gap, so a form like "Billed to:      Jordan Smith" gives two
 * regions — editing the value never touches the label. A simple heuristic, not layout analysis.
 */
export function groupTextRuns(runs: TextRun[]): { text: string; pdfBox: NativeTextRegion["pdfBox"] }[] {
  const items = runs.filter((r) => r.str.trim());
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: TextRun[][] = [];
  for (const item of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - item.y) < Math.max(2, item.height * 0.4)) last.push(item);
    else lines.push([item]);
  }

  const regions: { text: string; pdfBox: NativeTextRegion["pdfBox"] }[] = [];
  for (const line of lines) {
    const sorted = [...line].sort((a, b) => a.x - b.x);
    let segment: TextRun[] = [];
    let text = "";
    const flush = () => {
      if (!segment.length) return;
      const h = Math.max(...segment.map((s) => s.height));
      const minX = Math.min(...segment.map((s) => s.x));
      const maxX = Math.max(...segment.map((s) => s.x + s.width));
      const baseline = Math.min(...segment.map((s) => s.y));
      const height = h / (1 - DESCENT_SHARE);
      regions.push({
        text: text.trim(),
        pdfBox: { x: minX - PAD_X, y: baseline - height * DESCENT_SHARE, width: maxX - minX + PAD_X * 2, height },
      });
      segment = [];
      text = "";
    };
    for (const run of sorted) {
      const prev = segment[segment.length - 1];
      if (prev) {
        const gap = run.x - (prev.x + prev.width);
        const h = Math.max(prev.height, run.height);
        if (gap > h * COLUMN_GAP) flush();
        else if (gap > h * SPACE_GAP && !text.endsWith(" ") && !run.str.startsWith(" ")) text += " ";
      }
      segment.push(run);
      text += run.str;
    }
    flush();
  }
  return regions;
}

export async function extractNativeTextRegions(file: File, pageNumber: number): Promise<NativeTextRegion[]> {
  const doc = await loadPdfJsDocument(file);
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();

  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [, b, , d, e, f] = item.transform as number[];
    runs.push({ str: item.str, x: e, y: f, width: item.width, height: item.height || Math.hypot(b, d) || 10 });
  }

  return groupTextRuns(runs).map((region, index) => ({
    id: `native-${pageNumber}-${index}`,
    pageIndex: pageNumber - 1,
    ...region,
  }));
}
