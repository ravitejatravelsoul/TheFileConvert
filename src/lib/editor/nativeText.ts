import { loadPdfJsDocument } from "@/lib/processors/pdfjs-utils";

export interface NativeTextRegion {
  id: string;
  pageIndex: number; // 0-based
  text: string;
  pdfBox: { x: number; y: number; width: number; height: number };
}

/** Groups a page's native text items into line-level regions using y-proximity, the same
 * granularity OCR results use — this is a simple heuristic (not real layout analysis),
 * documented as such on the editor page, same as the OCR scanned/native classifier. */
export async function extractNativeTextRegions(file: File, pageNumber: number): Promise<NativeTextRegion[]> {
  const doc = await loadPdfJsDocument(file);
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();

  interface RawItem {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  const items: RawItem[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const transform = item.transform as number[];
    const [, b, , d, e, f] = transform;
    const height = item.height || Math.hypot(b, d) || 10;
    items.push({ str: item.str, x: e, y: f, width: item.width, height });
  }

  // Sort top-to-bottom (PDF y-up, so descending y), then left-to-right within a line.
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: RawItem[][] = [];
  for (const item of items) {
    const last = lines[lines.length - 1];
    const lastItem = last?.[0];
    if (lastItem && Math.abs(lastItem.y - item.y) < Math.max(2, item.height * 0.4)) {
      last.push(item);
    } else {
      lines.push([item]);
    }
  }

  return lines.map((lineItems, index) => {
    const sorted = [...lineItems].sort((a, b) => a.x - b.x);
    const text = sorted.map((i) => i.str).join("");
    const minX = Math.min(...sorted.map((i) => i.x));
    const maxX = Math.max(...sorted.map((i) => i.x + i.width));
    const minY = Math.min(...sorted.map((i) => i.y));
    const maxY = Math.max(...sorted.map((i) => i.y + i.height));
    return {
      id: `native-${pageNumber}-${index}`,
      pageIndex: pageNumber - 1,
      text,
      pdfBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
  });
}
