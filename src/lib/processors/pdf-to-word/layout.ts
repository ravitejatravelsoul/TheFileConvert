/**
 * Rebuilds the reading structure of PDF pages — lines, paragraphs, headings, lists, simple tables,
 * columns and pictures — from positioned text and images. Pure (no DOM, no pdf.js) so it can be tested
 * directly. Coordinates are in the page's reading frame: points, origin bottom-left, y up, text running
 * along +x (extract.ts turns rotated pages and rotated text into this frame first).
 *
 * This is layout inference, not a renderer: the aim is an editable document that reads in the right
 * order and keeps the obvious structure, not a pixel copy of the PDF.
 */

export interface TextItem {
  str: string;
  /** Left end of the baseline. */
  x: number;
  y: number;
  /** Advance width along the baseline. */
  w: number;
  /** Font size in points (for OCR: estimated from the word's box). */
  size: number;
  bold: boolean;
  italic: boolean;
  /** OCR words: always separate neighbours with a space (their gaps aren't glyph-accurate). */
  ocr?: boolean;
}

export interface PageImage {
  /** Bottom-left corner and size, in points. */
  x: number;
  y: number;
  w: number;
  h: number;
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  pxWidth: number;
  pxHeight: number;
}

export interface PageInput {
  width: number;
  height: number;
  items: TextItem[];
  images: PageImage[];
}

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  size: number;
}

export type Align = "left" | "center" | "right";

export type Block =
  | { kind: "paragraph"; style: "normal" | "h1" | "h2" | "h3"; align: Align; runs: Run[] }
  | { kind: "list"; ordered: boolean; start: number; listKey: number; runs: Run[] }
  | { kind: "table"; columns: number[]; rows: Run[][][]; bordered: boolean }
  | { kind: "image"; image: PageImage; width: number; height: number };

export interface PageLayout {
  width: number;
  height: number;
  margins: { left: number; right: number; top: number; bottom: number };
  blocks: Block[];
}

export interface DocumentStats {
  /** The most common text size, weighted by characters — the body size. */
  bodySize: number;
}

// ---------------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------------

interface Cell {
  x0: number;
  x1: number;
  runs: Run[];
}

interface Line {
  kind: "text";
  y: number;
  top: number;
  x0: number;
  x1: number;
  size: number;
  cells: Cell[];
  runs: Run[];
  text: string;
  bold: boolean;
}

interface ImageEntry {
  kind: "image";
  top: number;
  y: number;
  image: PageImage;
}

type Entry = Line | ImageEntry;

const r2 = (n: number) => Math.round(n * 2) / 2;

function pushRun(runs: Run[], text: string, item: { bold: boolean; italic: boolean; size: number }) {
  if (!text) return;
  const last = runs[runs.length - 1];
  const size = r2(item.size);
  if (last && last.bold === item.bold && last.italic === item.italic && Math.abs(last.size - size) < 0.6) last.text += text;
  else runs.push({ text, bold: item.bold, italic: item.italic, size });
}

/** A gap this wide (in font sizes) between two runs on one line separates table cells / tab stops. */
const CELL_GAP = 1.6;

function buildLine(items: TextItem[]): Line {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const size = Math.max(...sorted.map((i) => i.size));
  const cells: Cell[] = [];
  let cell: Cell | null = null;
  let prev: TextItem | null = null;
  for (const it of sorted) {
    const gap = prev ? it.x - (prev.x + prev.w) : 0;
    if (!cell || (prev && gap > CELL_GAP * Math.max(prev.size, it.size))) {
      cell = { x0: it.x, x1: it.x + it.w, runs: [] };
      cells.push(cell);
      pushRun(cell.runs, it.str.replace(/^\s+/, ""), it);
    } else {
      const needsSpace = prev && (it.ocr ? !/^[,.;:!?%)\]]/.test(it.str) : gap > 0.14 * Math.max(prev.size, it.size)) && !/\s$/.test(prev.str) && !/^\s/.test(it.str);
      pushRun(cell.runs, (needsSpace ? " " : "") + it.str, it);
      cell.x1 = Math.max(cell.x1, it.x + it.w);
    }
    prev = it;
  }
  for (const c of cells) {
    const last = c.runs[c.runs.length - 1];
    if (last) last.text = last.text.replace(/\s+$/, "");
    c.runs = c.runs.filter((r) => r.text.length > 0);
  }
  const runs: Run[] = [];
  cells.forEach((c, i) => {
    if (i > 0) pushRun(runs, "\t", c.runs[0] ?? { bold: false, italic: false, size });
    for (const r of c.runs) pushRun(runs, r.text, r);
  });
  const text = runs.map((r) => r.text).join("");
  const chars = sorted.reduce((n, i) => n + i.str.trim().length, 0);
  const boldChars = sorted.filter((i) => i.bold).reduce((n, i) => n + i.str.trim().length, 0);
  const y = sorted.reduce((s, i) => s + i.y, 0) / sorted.length;
  return { kind: "text", y, top: y + size * 0.8, x0: sorted[0].x, x1: Math.max(...sorted.map((i) => i.x + i.w)), size, cells, runs, text, bold: chars > 0 && boldChars / chars > 0.8 };
}

/** Groups items into lines by baseline, top to bottom. */
function groupLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; size: number; items: TextItem[] }[] = [];
  for (const it of sorted) {
    const g = groups.find((g) => Math.abs(g.y - it.y) < 0.45 * Math.max(g.size, it.size));
    if (g) {
      g.items.push(it);
      g.size = Math.max(g.size, it.size);
    } else groups.push({ y: it.y, size: it.size, items: [it] });
  }
  return groups
    .map((g) => buildLine(g.items))
    .filter((l) => l.text.trim().length > 0)
    .sort((a, b) => b.y - a.y);
}

// ---------------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------------

/**
 * Finds a vertical gutter that splits the page's text into two columns of running text. Returns its x,
 * or null for a single-column page. Tables and key/value forms also have a gap down the middle, so the
 * column test also requires long lines on both sides (running text), not short cells.
 */
function findGutter(items: TextItem[], left: number, right: number): number | null {
  const width = right - left;
  if (width <= 0) return null;
  const total = items.reduce((n, i) => n + i.str.length, 0);
  if (total < 200) return null;
  let best: { x: number; crossing: number } | null = null;
  for (let x = left + width * 0.3; x <= left + width * 0.7; x += 2) {
    let crossing = 0;
    let l = 0;
    let r = 0;
    for (const it of items) {
      if (it.x < x - 1 && it.x + it.w > x + 1) crossing += it.str.length;
      else if (it.x + it.w <= x + 1) l += it.str.length;
      else r += it.str.length;
    }
    if (l < total * 0.25 || r < total * 0.25) continue;
    if (!best || crossing < best.crossing) best = { x, crossing };
  }
  if (!best || best.crossing > total * 0.06) return null;
  const gx = best.x;
  const leftLines = groupLines(items.filter((i) => i.x + i.w <= gx + 1));
  const rightLines = groupLines(items.filter((i) => i.x >= gx - 1));
  if (leftLines.length < 5 || rightLines.length < 5) return null;
  const median = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  const lw = median(leftLines.map((l) => l.x1 - l.x0));
  const rw = median(rightLines.map((l) => l.x1 - l.x0));
  // Running text fills most of its column; table cells and labels don't.
  if (lw < (gx - left) * 0.6 || rw < (right - gx) * 0.6) return null;
  return gx;
}

// ---------------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------------

const BULLET = /^\s*([•●◦▪▫‣∙·■□➢►▶✓✔❖◆◇○\-–—*])\s+/u;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+/;

function stripPrefix(runs: Run[], re: RegExp): Run[] {
  const out = runs.map((r) => ({ ...r }));
  const joined = out.map((r) => r.text).join("");
  const m = re.exec(joined);
  if (!m) return out;
  let cut = m[0].length;
  for (const r of out) {
    if (cut <= 0) break;
    const take = Math.min(cut, r.text.length);
    r.text = r.text.slice(take);
    cut -= take;
  }
  return out.filter((r) => r.text.length > 0);
}

function appendRuns(target: Run[], add: Run[], joiner: string) {
  if (joiner && target.length) pushRun(target, joiner, target[target.length - 1]);
  for (const r of add) pushRun(target, r.text, r);
}

interface Region {
  left: number;
  right: number;
}

/** Turns an ordered list of lines and pictures from one text flow into blocks. */
function blocksFor(entries: Entry[], region: Region, stats: DocumentStats, contentWidth: number, listKeys: { next: number }): Block[] {
  const blocks: Block[] = [];
  const width = Math.max(1, region.right - region.left);
  const center = (region.left + region.right) / 2;
  const lines = entries.filter((e): e is Line => e.kind === "text");
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i - 1].y - lines[i].y;
    if (d > 0 && Math.abs(lines[i - 1].size - lines[i].size) < 1) gaps.push(d / lines[i].size);
  }
  gaps.sort((a, b) => a - b);
  // Line spacing inside a paragraph: the tighter gaps (a low percentile), capped at a generous 1.6×
  // the type size, so a page where every gap is a paragraph gap still splits into paragraphs.
  const typicalGap = Math.min(1.6, gaps.length ? gaps[Math.floor(gaps.length * 0.25)] : 1.25);

  const headingStyle = (l: Line): "h1" | "h2" | "h3" | null => {
    if (l.text.length > 160) return null;
    const ratio = l.size / stats.bodySize;
    if (ratio >= 1.75) return "h1";
    if (ratio >= 1.35) return "h2";
    if (ratio >= 1.15) return "h3";
    if (l.bold && l.cells.length === 1 && l.text.length <= 70 && !/[.,;]$/.test(l.text.trim()) && ratio >= 0.95 && !BULLET.test(l.text) && !NUMBERED.test(l.text)) return "h3";
    return null;
  };
  const alignOf = (ls: Line[]): Align => {
    if (ls.every((l) => Math.abs((l.x0 + l.x1) / 2 - center) < width * 0.04 && l.x1 - l.x0 < width * 0.85) && ls.every((l) => l.x0 - region.left > width * 0.08)) return "center";
    if (ls.every((l) => Math.abs(l.x1 - region.right) < width * 0.03 && l.x0 - region.left > width * 0.3)) return "right";
    return "left";
  };

  let i = 0;
  let currentList: { ordered: boolean; key: number; expect: number } | null = null;
  while (i < entries.length) {
    const e = entries[i];
    if (e.kind === "image") {
      const scale = Math.min(1, contentWidth / e.image.w);
      blocks.push({ kind: "image", image: e.image, width: e.image.w * scale, height: e.image.h * scale });
      currentList = null;
      i++;
      continue;
    }

    // A table: two or more consecutive lines with 2+ cells whose starts line up in shared columns.
    if (e.cells.length >= 2) {
      let j = i;
      while (j < entries.length) {
        const n = entries[j];
        if (n.kind !== "text" || n.cells.length < 2) break;
        if (j > i) {
          const p = entries[j - 1] as Line;
          if (p.y - n.y > Math.max(p.size, n.size) * 3.2) break;
        }
        j++;
      }
      const rowsLines = entries.slice(i, j) as Line[];
      if (rowsLines.length >= 2) {
        const anchors: number[] = [];
        for (const l of rowsLines)
          for (const c of l.cells) {
            if (!anchors.some((a) => Math.abs(a - c.x0) < Math.max(10, l.size * 1.2))) anchors.push(c.x0);
          }
        anchors.sort((a, b) => a - b);
        const aligned = rowsLines.filter((l) => l.cells.every((c) => anchors.some((a) => Math.abs(a - c.x0) < Math.max(10, l.size * 1.2)))).length;
        if (anchors.length >= 2 && anchors.length <= 12 && aligned === rowsLines.length) {
          const rows = rowsLines.map((l) => {
            const row: Run[][] = anchors.map(() => []);
            for (const c of l.cells) {
              let k = 0;
              for (let a = 0; a < anchors.length; a++) if (c.x0 >= anchors[a] - Math.max(10, l.size * 1.2)) k = a;
              appendRuns(row[k], c.runs, row[k].length ? " " : "");
            }
            return row;
          });
          const columns = anchors.map((a, k) => (k + 1 < anchors.length ? anchors[k + 1] - a : Math.max(40, Math.max(...rowsLines.map((l) => l.x1)) - a)));
          blocks.push({ kind: "table", columns, rows, bordered: anchors.length >= 3 });
          currentList = null;
          i = j;
          continue;
        }
      }
    }

    const heading = headingStyle(e);
    if (heading) {
      const group = [e];
      let j = i + 1;
      while (j < entries.length) {
        const n = entries[j];
        if (n.kind !== "text" || Math.abs(n.size - e.size) > 0.6 || headingStyle(n) !== heading || group[group.length - 1].y - n.y > n.size * 1.6) break;
        group.push(n);
        j++;
      }
      const runs: Run[] = [];
      group.forEach((l, k) => appendRuns(runs, l.runs, k > 0 ? " " : ""));
      blocks.push({ kind: "paragraph", style: heading, align: alignOf(group), runs });
      currentList = null;
      i = j;
      continue;
    }

    const bullet = BULLET.exec(e.text);
    const numbered = NUMBERED.exec(e.text);
    if (bullet || numbered) {
      const ordered = !bullet;
      const number = numbered ? Number(numbered[1]) : 1;
      if (!currentList || currentList.ordered !== ordered || (ordered && number !== currentList.expect)) {
        currentList = { ordered, key: listKeys.next++, expect: number };
      }
      const runs = stripPrefix(e.runs, ordered ? NUMBERED : BULLET);
      // Continuation lines: indented under the text, no marker of their own, close below.
      let j = i + 1;
      while (j < entries.length) {
        const n = entries[j];
        if (n.kind !== "text" || BULLET.test(n.text) || NUMBERED.test(n.text) || headingStyle(n)) break;
        const p = entries[j - 1] as Line;
        if (p.y - n.y > n.size * (typicalGap + 0.35) || n.x0 < e.x0 + n.size * 0.5) break;
        appendRuns(runs, n.runs, " ");
        j++;
      }
      blocks.push({ kind: "list", ordered, start: ordered ? currentList.expect : 1, listKey: currentList.key, runs });
      currentList.expect += 1;
      i = j;
      continue;
    }
    currentList = null;

    // A paragraph: following lines join while they look like the same paragraph.
    const group = [e];
    let j = i + 1;
    while (j < entries.length) {
      const n = entries[j];
      if (n.kind !== "text") break;
      const p = group[group.length - 1];
      const gap = (p.y - n.y) / n.size;
      if (gap > typicalGap * 1.3 || gap <= 0) break;
      if (Math.abs(n.size - p.size) > Math.max(1, p.size * 0.15)) break;
      if (headingStyle(n) || BULLET.test(n.text) || NUMBERED.test(n.text) || n.cells.length >= 2) break;
      if (n.x0 > p.x0 + n.size * 1.2 && group.length >= 1 && alignOf([n]) === "left") break; // first-line indent: new paragraph
      const shortEnd = p.x1 < region.left + width * 0.72 && /[.!?:"”)]$/.test(p.text.trim());
      if (shortEnd && alignOf([p]) === "left") break;
      if (alignOf([p]) !== alignOf([n]) && (alignOf([p]) !== "left" || alignOf([n]) !== "left")) break;
      group.push(n);
      j++;
    }
    const runs: Run[] = [];
    group.forEach((l, k) => {
      if (k === 0) return appendRuns(runs, l.runs, "");
      const prevText = runs.map((r) => r.text).join("");
      // "exam-" + "ple" → "example"; otherwise lines are joined with a space.
      if (/[a-z]-$/.test(prevText) && /^[a-z]/.test(l.text)) {
        const last = runs[runs.length - 1];
        last.text = last.text.slice(0, -1);
        appendRuns(runs, l.runs, "");
      } else appendRuns(runs, l.runs, " ");
    });
    blocks.push({ kind: "paragraph", style: "normal", align: alignOf(group), runs });
    i = j;
  }
  return blocks;
}

/** Document-wide statistics used for heading detection. */
export function documentStats(pages: PageInput[]): DocumentStats {
  const weight = new Map<number, number>();
  for (const p of pages) for (const it of p.items) weight.set(r2(it.size), (weight.get(r2(it.size)) ?? 0) + it.str.trim().length);
  let bodySize = 11;
  let best = -1;
  for (const [size, w] of weight) if (w > best || (w === best && size < bodySize)) [bodySize, best] = [size, w];
  return { bodySize: Math.max(4, bodySize) };
}

/** Lays out one page. `listKeys` numbers lists across the whole document. */
export function layoutPage(page: PageInput, stats: DocumentStats, listKeys: { next: number } = { next: 1 }): PageLayout {
  const items = page.items.filter((i) => i.str.trim().length > 0 && i.size > 0);
  const textLeft = items.length ? Math.min(...items.map((i) => i.x)) : page.width * 0.1;
  const textRight = items.length ? Math.max(...items.map((i) => i.x + i.w)) : page.width * 0.9;
  const hasText = items.length > 0;

  // Pictures: skip specks, and a full-page background under real text (a searchable scan or a letterhead
  // backdrop) — the text is what an editable document needs.
  const images = page.images.filter((im) => im.w >= 12 && im.h >= 12 && !(hasText && (im.w * im.h) / (page.width * page.height) > 0.85));

  const left = Math.min(textLeft, ...images.map((im) => im.x));
  const right = Math.max(textRight, ...images.map((im) => im.x + im.w));
  const margins = {
    left: clamp(left, 18, 108),
    right: clamp(page.width - right, 18, 108),
    top: 54,
    bottom: 54,
  };
  const contentWidth = Math.max(72, page.width - margins.left - margins.right);

  const imageEntries: ImageEntry[] = images.map((im) => ({ kind: "image", top: im.y + im.h, y: im.y + im.h, image: im }));
  const byTop = (a: Entry, b: Entry) => b.top - a.top;
  const blocks: Block[] = [];
  const gutter = findGutter(items, textLeft, textRight);

  if (gutter === null) {
    const entries: Entry[] = [...groupLines(items), ...imageEntries].sort(byTop);
    // Assume the page's margins are symmetric: a short page of short lines still has its right margin
    // where the left one mirrors it, so centred titles and paragraph ends are judged against the page.
    blocks.push(...blocksFor(entries, { left: textLeft, right: Math.max(textRight, page.width - textLeft) }, stats, contentWidth, listKeys));
  } else {
    // Two columns: lines that cross the gutter (titles, full-width figures) split the page into bands;
    // within each band the left column is read before the right.
    const spanning = items.filter((i) => i.x < gutter - 1 && i.x + i.w > gutter + 1);
    const spanLines = groupLines(spanning);
    const leftItems = items.filter((i) => !spanning.includes(i) && i.x + i.w <= gutter + 1);
    const rightItems = items.filter((i) => !spanning.includes(i) && !leftItems.includes(i));
    const leftEntries: Entry[] = [...groupLines(leftItems), ...imageEntries.filter((e) => e.image.x + e.image.w <= gutter + 1)];
    const rightEntries: Entry[] = [...groupLines(rightItems), ...imageEntries.filter((e) => e.image.x >= gutter - 1)];
    const spanEntries: Entry[] = [...spanLines, ...imageEntries.filter((e) => e.image.x < gutter - 1 && e.image.x + e.image.w > gutter + 1)].sort(byTop);
    const cuts = [Infinity, ...spanEntries.map((e) => e.top), -Infinity];
    // Each column's own edges (not the gutter's middle) — alignment is judged within the column.
    const edges = (entries: Entry[], fallback: Region): Region => {
      const lines = entries.filter((e): e is Line => e.kind === "text");
      return lines.length ? { left: Math.min(...lines.map((l) => l.x0)), right: Math.max(...lines.map((l) => l.x1)) } : fallback;
    };
    const leftRegion = edges(leftEntries, { left: textLeft, right: gutter });
    const rightRegion = edges(rightEntries, { left: gutter, right: textRight });
    const inBand = (e: Entry, hi: number, lo: number) => e.top <= hi && e.top > lo;
    for (let b = 0; b < cuts.length - 1; b++) {
      const hi = cuts[b];
      const lo = cuts[b + 1];
      if (b > 0) blocks.push(...blocksFor([spanEntries[b - 1]], { left: textLeft, right: textRight }, stats, contentWidth, listKeys));
      const leftBand = leftEntries.filter((e) => inBand(e, hi === Infinity ? Infinity : hi - 0.01, lo)).sort(byTop);
      const rightBand = rightEntries.filter((e) => inBand(e, hi === Infinity ? Infinity : hi - 0.01, lo)).sort(byTop);
      const leftBlocks = blocksFor(leftBand, leftRegion, stats, contentWidth, listKeys);
      const rightBlocks = blocksFor(rightBand, rightRegion, stats, contentWidth, listKeys);
      // A paragraph that runs from the bottom of the left column to the top of the right one is one
      // paragraph: join it when the left part stops mid-sentence.
      const tail = leftBlocks[leftBlocks.length - 1];
      const head = rightBlocks[0];
      if (tail?.kind === "paragraph" && tail.style === "normal" && head?.kind === "paragraph" && head.style === "normal") {
        const tailText = tail.runs.map((r) => r.text).join("").trim();
        if (tailText && !/[.!?:"”)]$/.test(tailText)) {
          appendRuns(tail.runs, head.runs, " ");
          rightBlocks.shift();
        }
      }
      blocks.push(...leftBlocks, ...rightBlocks);
    }
  }
  return { width: page.width, height: page.height, margins, blocks };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Plain text of a layout, for tests and QA. */
export function layoutText(pages: PageLayout[]): string {
  const out: string[] = [];
  for (const p of pages) {
    for (const b of p.blocks) {
      if (b.kind === "paragraph" || b.kind === "list") out.push(b.runs.map((r) => r.text).join(""));
      else if (b.kind === "table") for (const row of b.rows) out.push(row.map((c) => c.map((r) => r.text).join("")).join("\t"));
    }
  }
  return out.join("\n");
}
