/**
 * Rebuilds an editable document from positioned PDF content: lines → paragraphs, headings, lists, tables,
 * columns, pictures, headers and footers — and measures how each one looks on the page (font, size, colour,
 * underline, indents, spacing, line pitch, tab stops, rules, borders, shading), so the Word document keeps
 * the original's layout, not just its words. Pure (no DOM, no pdf.js) so it can be tested directly.
 *
 * Coordinates are in the page's reading frame: points, origin bottom-left, y up, text along +x
 * (extract.ts turns rotated pages and rotated text into this frame first).
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
  /** Word font name for the PDF font ("Calibri", "Times New Roman"…); empty when unknown. */
  font?: string;
  /** Fill colour, "rrggbb". */
  color?: string;
  /** Descent below the baseline as a fraction of the size (from the font), for vertical placement. */
  descent?: number;
  /** OCR words: recognition confidence, 0–100. */
  conf?: number;
}

/** A straight line drawn on the page (underline, table border, rule under a heading). */
export interface Rule {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  thickness: number;
  color: string;
}

/** A filled rectangle (cell or paragraph shading, a coloured band). */
export interface Fill {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
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
  /** Horizontal and vertical lines (y0 === y1 or x0 === x1 within the thickness). */
  rules?: Rule[];
  fills?: Fill[];
  /** Visual fallback: the page image, kept behind the (then invisible) recognised text. */
  background?: PageImage;
  /** How the page is rebuilt (see scanPage.ts); native text pages leave it out. */
  strategy?: "native" | "structured-scan" | "hybrid" | "visual-fallback" | "visual-preserved";
}

export interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  size: number;
  font?: string;
  color?: string;
  underline?: boolean;
  strike?: boolean;
  /** A page-number field in a header/footer. */
  field?: "PAGE" | "NUMPAGES";
}

export type Align = "left" | "center" | "right" | "justify";

export interface TabStop {
  pos: number;
  align: "left" | "right" | "center";
  /** A fill up to the stop: form blanks (____) and table-of-contents dots (....). */
  leader?: "underscore" | "dot";
}

/** How a paragraph sits on the page. Lengths in points, relative to the page margins. */
export interface ParaFormat {
  align: Align;
  indLeft: number;
  indRight: number;
  /** First-line offset from indLeft (negative = hanging). */
  indFirst: number;
  spaceBefore: number;
  /** Baseline-to-baseline distance (exact line spacing), or null for single spacing. */
  line: number | null;
  tabs: TabStop[];
  borderBottom?: { thickness: number; color: string; space: number };
  shading?: string;
}

export interface CellParagraph {
  runs: Run[];
  align: Align;
  /** Baseline-to-baseline distance inside the cell (exact), or null for single spacing. */
  line?: number | null;
  /** Tab stops (from the cell's text edge) for a line whose parts sit apart, like "VALID FROM ⇥ date". */
  tabs?: TabStop[];
  /** Space above the paragraph (a cell's top padding, carried by its first paragraph). */
  spaceBefore?: number;
}

export interface TableCell {
  paragraphs: CellParagraph[];
  shading?: string;
  /** A line drawn under this cell only (a form's fill-in line under a value). */
  borderBottom?: { thickness: number; color: string };
  /** Grid columns this cell spans. */
  span: number;
  vMerge?: "restart" | "continue";
}

export interface TableRow {
  height: number;
  cells: TableCell[];
}

export type Block =
  | { kind: "paragraph"; style: "normal" | "h1" | "h2" | "h3"; align: Align; runs: Run[]; fmt: ParaFormat }
  | { kind: "list"; ordered: boolean; start: number; listKey: number; runs: Run[]; bullet: string; label: Run; fmt: ParaFormat }
  | {
      kind: "table";
      columns: number[];
      rows: TableRow[];
      bordered: boolean;
      border: { thickness: number; color: string } | null;
      /** Ruled by horizontal lines only (a table with no vertical lines): the border is drawn on the rows, not the sides or between columns. */
      rowsOnly?: boolean;
      indent: number;
      spaceBefore: number;
      cellMargin: { left: number; right: number; top: number };
      /** A table with text beside it stays at its place on the page (top-left, from the page corner). */
      float?: { x: number; y: number };
    }
  | { kind: "image"; image: PageImage; width: number; height: number; fmt: ParaFormat }
  | { kind: "columns"; gap: number; spaceBefore: number; left: Block[]; right: Block[] }
  /** A drawn horizontal line on its own (a signature or fill-in line, a separator): from indLeft, width long. */
  | { kind: "rule"; indLeft: number; width: number; thickness: number; color: string; spaceBefore: number };

/** A picture drawn at a fixed place on the page (next to text), not in the flow. */
export interface FloatingImage {
  image: PageImage;
  /** Top-left from the page's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Behind the text (a scanned page kept as its own background). */
  behind?: boolean;
}

/** A border around the whole page (a certificate's frame). Distance from the page edge in points. */
export interface PageBorder {
  style: "single" | "double";
  thickness: number;
  color: string;
  space: { top: number; left: number; bottom: number; right: number };
}

export interface PageLayout {
  width: number;
  height: number;
  margins: { left: number; right: number; top: number; bottom: number };
  blocks: Block[];
  floating: FloatingImage[];
  header: CellParagraph[] | null;
  footer: CellParagraph[] | null;
  /** Distance from the page edge to the header's top / the footer's bottom. */
  headerDistance: number;
  footerDistance: number;
  pageBorder?: PageBorder;
  /** Visual fallback: the text sits invisibly over the page image, for search and copy. */
  transparentText?: boolean;
}

export interface DocumentStats {
  /** The most common text size, weighted by characters — the body size. */
  bodySize: number;
  /** The most common font (Word name), or "". */
  bodyFont: string;
  /** Typical baseline-to-baseline distance ÷ size inside paragraphs. */
  leading: number;
}

const r2 = (n: number) => Math.round(n * 2) / 2;
/** Horizontal lengths keep Word's own precision (1/20 pt): half a point is enough to re-wrap a full line. */
const tw = (n: number) => Math.round(n * 20) / 20;
/** Border widths Word offers, in points (eighths 2, 4, 6, 8, 12, 18, 24, 36, 48); others it rounds unevenly. */
const BORDER_PT = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6];
export const snapBorder = (pt: number) => BORDER_PT.reduce((best, s) => (Math.abs(s - pt) < Math.abs(best - pt) ? s : best));
/** How much wider than its longest line the text area is (less than any word, so lines break where they did). */
const WRAP_SLACK = 0.25;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const median = (a: number[]) => (a.length ? [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] : 0);

// ---------------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------------

interface Cell {
  x0: number;
  x1: number;
  runs: Run[];
  /** A drawn fill (“______”, “......”) that Word writes as a tab leader, not as text. */
  leader?: "underscore" | "dot";
  /** The fill starts clearly after the text before it: a plain tab stop first, where it starts. */
  leadGap?: boolean;
}

interface Line {
  kind: "text";
  y: number;
  top: number;
  x0: number;
  x1: number;
  size: number;
  descent: number;
  cells: Cell[];
  runs: Run[];
  text: string;
  bold: boolean;
  /** Dominant look, used to keep differently styled lines in separate paragraphs. */
  look: string;
  /** The pieces of text the line was built from. */
  items: Decorated[];
}

interface ImageEntry {
  kind: "image";
  top: number;
  y: number;
  image: PageImage;
}

type Entry = Line | ImageEntry;

function sameLook(a: Run, b: Run) {
  return a.bold === b.bold && a.italic === b.italic && Math.abs(a.size - b.size) < 0.6 && (a.font ?? "") === (b.font ?? "") && (a.color ?? "") === (b.color ?? "") && Boolean(a.underline) === Boolean(b.underline) && Boolean(a.strike) === Boolean(b.strike);
}

function pushRun(runs: Run[], text: string, item: Omit<Run, "text">) {
  if (!text) return;
  const last = runs[runs.length - 1];
  const run: Run = { text, bold: item.bold, italic: item.italic, size: r2(item.size), font: item.font || undefined, color: item.color && item.color !== "000000" ? item.color : undefined, underline: item.underline || undefined, strike: item.strike || undefined };
  if (last && sameLook(last, run)) last.text += text;
  else runs.push(run);
}

/** A gap this wide (in font sizes) between two runs on one line separates table cells / tab stops. */
const CELL_GAP = 1.6;

type Decorated = TextItem & { underline?: boolean; strike?: boolean };

/** "Name ________" → the label and a leader piece that ends where the blank ends. */
function splitLeaders(items: Decorated[]): (Decorated & { leader?: "underscore" | "dot" })[] {
  const out: (Decorated & { leader?: "underscore" | "dot" })[] = [];
  for (const it of items) {
    const m = /^(.*?)(_{3,}|\.{4,}|·{4,})(\s*)$/.exec(it.str);
    if (!m) {
      out.push(it);
      continue;
    }
    const kind = m[2][0] === "_" ? "underscore" : "dot";
    const label = m[1];
    // Where the label ends isn't known exactly; the stop only needs where the blank ends.
    const labelW = label.trim() ? (it.w * label.length) / it.str.length : 0;
    if (label.trim()) out.push({ ...it, str: label, w: labelW });
    out.push({ ...it, str: m[2], x: it.x + labelW, w: it.w - labelW, leader: kind });
  }
  return out;
}

function buildLine(input: Decorated[]): Line {
  const items = splitLeaders(input);
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const size = Math.max(...sorted.map((i) => i.size));
  const cells: Cell[] = [];
  let cell: Cell | null = null;
  let prev: Decorated | null = null;
  for (const it of sorted) {
    const gap = prev ? it.x - (prev.x + prev.w) : 0;
    if (it.leader) {
      cells.push({ x0: it.x, x1: it.x + it.w, runs: [], leader: it.leader, leadGap: Boolean(prev && gap > 0.4 * it.size) });
      cell = null;
      prev = it;
      continue;
    }
    const bulletGap = prev && cell && cell.runs.length === 1 && /^[•●◦▪■□➢►▶✓✔❖◆◇○‣∙·*–-]$/.test(cell.runs[0].text.trim()) && gap > 0.5 * it.size;
    // A check box's label starts at its own stop when set apart from the box.
    const afterBox = prev && cell && cell.runs.length === 1 && /^[☐☑☒]$/.test(cell.runs[0].text.trim()) && gap > 0.3 * it.size;
    // A check box after a gap starts the next option of a choice row ("☐ Yes   ☐ No"): its own tab stop.
    const optionStart = prev && /^[☐☑☒]$/.test(it.str.trim()) && gap > 0.5 * it.size;
    if (!cell || (prev && gap > CELL_GAP * Math.max(prev.size, it.size)) || bulletGap || optionStart || afterBox) {
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
  const live = cells.filter((c) => c.runs.length || c.leader);
  const runs: Run[] = [];
  const base = live.find((c) => c.runs.length)?.runs[0] ?? { bold: false, italic: false, size };
  live.forEach((c, i) => {
    if (i > 0) pushRun(runs, c.leader && c.leadGap ? "\t\t" : "\t", c.runs[0] ?? runs[runs.length - 1] ?? base);
    for (const r of c.runs) pushRun(runs, r.text, r);
  });
  const text = runs.map((r) => r.text).join("");
  const chars = sorted.reduce((n, i) => n + i.str.trim().length, 0);
  const boldChars = sorted.filter((i) => i.bold).reduce((n, i) => n + i.str.trim().length, 0);
  const y = median(sorted.map((i) => i.y));
  // The look most of the line's characters have.
  const tally = new Map<string, number>();
  // OCR sizes are estimated from each word's box and wobble by a point between lines of one paragraph, so
  // they don't count toward a recognised line's look.
  const ocr = sorted.some((i) => i.ocr);
  for (const r of runs) {
    const k = `${r.bold}|${r.italic}|${ocr ? "" : r.size}|${r.font ?? ""}|${r.color ?? ""}`;
    tally.set(k, (tally.get(k) ?? 0) + r.text.trim().length);
  }
  let look = "";
  let best = -1;
  for (const [k, n] of tally) if (n > best) [look, best] = [k, n];
  const descent = median(sorted.map((i) => i.descent ?? 0.22));
  return { kind: "text", y, top: y + size * 0.8, x0: sorted[0].x, x1: Math.max(...sorted.map((i) => i.x + i.w)), size, descent, cells: live, runs, text, bold: chars > 0 && boldChars / chars > 0.8, look, items: input };
}

/** Groups items into lines by baseline, top to bottom. */
function groupLines(items: Decorated[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; size: number; items: Decorated[] }[] = [];
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
// Decorations: underline / strike-through lines belong to the text above them
// ---------------------------------------------------------------------------------------------------

function decorate(items: TextItem[], rules: Rule[]): { items: Decorated[]; rules: Rule[] } {
  // A drawn underline or strike runs along its text: most of its length lies under (or through) glyphs on
  // one baseline. A table's cell border under a short word doesn't — it spans the whole cell — and must
  // stay a border (taking it as an underline would also break the table's grid).
  const along = (r: Rule) => {
    const spans = items
      .filter((it) => it.str.trim() && Math.abs(r.y0 - it.y) <= 0.45 * it.size && it.x < r.x1 && it.x + it.w > r.x0)
      .map((it) => [Math.max(r.x0, it.x), Math.min(r.x1, it.x + it.w)] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = r.x0;
    for (const [a, b] of spans) {
      if (b > end) {
        covered += b - Math.max(a, end);
        end = b;
      }
    }
    return covered >= (r.x1 - r.x0) * 0.7;
  };
  const textRule = new Map<Rule, boolean>();
  const isTextRule = (r: Rule) => {
    if (!textRule.has(r)) textRule.set(r, along(r));
    return textRule.get(r)!;
  };
  const used = new Set<Rule>();
  const out: Decorated[] = items.map((it) => {
    const d: Decorated = { ...it };
    if (!it.str.trim()) return d;
    for (const r of rules) {
      if (Math.abs(r.y1 - r.y0) > 0.6) continue;
      if (r.thickness > Math.max(1.6, it.size * 0.12)) continue;
      const overlap = Math.min(r.x1, it.x + it.w) - Math.max(r.x0, it.x);
      if (overlap < it.w * 0.8 || r.x1 - r.x0 > it.w * 3 + 20 || !isTextRule(r)) continue;
      const dy = r.y0 - it.y;
      if (dy <= 0.05 * it.size && dy >= -0.3 * it.size) {
        d.underline = true;
        used.add(r);
      } else if (dy >= 0.18 * it.size && dy <= 0.45 * it.size) {
        d.strike = true;
        used.add(r);
      }
    }
    return d;
  });
  return { items: out, rules: rules.filter((r) => !used.has(r)) };
}

// ---------------------------------------------------------------------------------------------------
// Ruled tables: a grid of drawn lines
// ---------------------------------------------------------------------------------------------------

interface Grid {
  xs: number[];
  ys: number[]; // top to bottom (descending y)
  hRules: Rule[];
  vRules: Rule[];
  border: { thickness: number; color: string } | null;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Rows drawn with horizontal lines only (no verticals): columns come from the text. */
  openSides: boolean;
}

function cluster(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1] <= tol) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

function findGrids(rules: Rule[]): Grid[] {
  const h = rules.filter((r) => Math.abs(r.y1 - r.y0) <= 0.6 && r.x1 - r.x0 >= 8);
  const v = rules.filter((r) => Math.abs(r.x1 - r.x0) <= 0.6 && r.y1 - r.y0 >= 4);
  // Connected components of lines that touch.
  const all = [...h, ...v];
  const parent = all.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touches = (a: Rule, b: Rule) => a.x0 - 2 <= b.x1 && b.x0 - 2 <= a.x1 && a.y0 - 2 <= b.y1 && b.y0 - 2 <= a.y1;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (touches(all[i], all[j])) parent[find(i)] = find(j);
  const groups = new Map<number, Rule[]>();
  all.forEach((r, i) => {
    const k = find(i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  });
  // Lines that touch nothing (rows of a table ruled by horizontal lines only, 20 pt apart): a stack of 3+
  // of the same extent, evenly spaced, is one rows-only table.
  const lone = [...groups.entries()].filter(([, g]) => g.length === 1 && h.includes(g[0])).map(([k, g]) => ({ k, r: g[0] }));
  lone.sort((a, b) => b.r.y0 - a.r.y0);
  const used = new Set<number>();
  for (let i = 0; i < lone.length; i++) {
    if (used.has(lone[i].k)) continue;
    const base = lone[i].r;
    const stack = [lone[i]];
    for (let j = i + 1; j < lone.length; j++) {
      const r = lone[j].r;
      if (used.has(lone[j].k) || Math.abs(r.x0 - base.x0) > 4 || Math.abs(r.x1 - base.x1) > 4) continue;
      // Rows of one table are ruled alike: a dark heading underline above light row lines is not part of it.
      if (r.color !== base.color || Math.abs(r.thickness - base.thickness) > 0.2) break;
      const last = stack[stack.length - 1].r;
      const gap = last.y0 - r.y0;
      const first = stack.length >= 2 ? stack[0].r.y0 - stack[1].r.y0 : gap;
      if (gap < 6 || gap > 60 || gap > first * 1.8 + 2) break;
      stack.push(lone[j]);
    }
    if (stack.length < 3) continue;
    for (const e of stack) used.add(e.k);
    const merged = stack.flatMap((e) => groups.get(e.k)!);
    groups.set(stack[0].k, merged);
    for (const e of stack.slice(1)) groups.delete(e.k);
  }
  const grids: Grid[] = [];
  for (const g of groups.values()) {
    const hs = g.filter((r) => h.includes(r));
    const vs = g.filter((r) => v.includes(r));
    const ys = cluster(hs.map((r) => r.y0), 1.2).sort((a, b) => b - a);
    const xs = cluster(vs.map((r) => r.x0), 1.2);
    const x0 = Math.min(...g.map((r) => r.x0));
    const x1 = Math.max(...g.map((r) => r.x1));
    const thickness = snapBorder(median(g.map((r) => r.thickness)));
    const color = g[0].color;
    if (ys.length >= 2 && xs.length >= 2) grids.push({ xs, ys, hRules: hs, vRules: vs, border: { thickness, color }, x0, x1, y0: Math.min(...ys), y1: Math.max(...ys), openSides: false });
    // Three or more stacked horizontal lines of about the same width: a table ruled by rows only.
    else if (ys.length >= 3 && xs.length === 0) {
      const widths = hs.map((r) => r.x1 - r.x0);
      if (Math.max(...widths) - Math.min(...widths) < 6) grids.push({ xs: [x0, x1], ys, hRules: hs, vRules: [], border: { thickness, color }, x0, x1, y0: Math.min(...ys), y1: Math.max(...ys), openSides: true });
    }
  }
  return grids;
}

// ---------------------------------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------------------------------

/**
 * Finds a vertical gutter that splits the page's text into two columns of running text. Returns its x,
 * or null for a single-column page. Tables and key/value forms also have a gap down the middle, so the
 * column test also requires long lines on both sides (running text), not short cells.
 */
function findGutter(items: TextItem[], left: number, right: number): { x: number; leftEnd: number; rightStart: number } | null {
  const width = right - left;
  if (width <= 0) return null;
  const total = items.reduce((n, i) => n + i.str.length, 0);
  if (total < 200) return null;
  // Full-width titles and abstracts above (or below) the columns cross any gutter, so only text inside
  // the stretch where both columns have text counts against a candidate.
  let best: { x: number; crossing: number } | null = null;
  for (let x = left + width * 0.3; x <= left + width * 0.7; x += 2) {
    const leftI = items.filter((it) => it.x + it.w <= x + 1);
    const rightI = items.filter((it) => it.x >= x - 1);
    const chars = (a: TextItem[]) => a.reduce((n, i) => n + i.str.length, 0);
    if (chars(leftI) < total * 0.15 || chars(rightI) < total * 0.15) continue;
    const top = Math.min(Math.max(...leftI.map((i) => i.y)), Math.max(...rightI.map((i) => i.y)));
    const bottom = Math.max(Math.min(...leftI.map((i) => i.y)), Math.min(...rightI.map((i) => i.y)));
    if (top <= bottom) continue;
    const zone = items.filter((it) => it.y <= top + 0.5 && it.y >= bottom - 0.5);
    const crossing = chars(zone.filter((it) => it.x < x - 1 && it.x + it.w > x + 1)) / Math.max(1, chars(zone));
    if (!best || crossing < best.crossing) best = { x, crossing };
  }
  if (!best || best.crossing > 0.06) return null;
  const gx = best.x;
  const leftLines = groupLines(items.filter((i) => i.x + i.w <= gx + 1));
  const rightLines = groupLines(items.filter((i) => i.x >= gx - 1));
  if (leftLines.length < 5 || rightLines.length < 5) return null;
  // Running text fills its column on many lines (at least a quarter of them); table cells and labels
  // never do, so a key/value table isn't mistaken for two columns.
  const p75 = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length * 0.75)];
  const lw = p75(leftLines.map((l) => l.x1 - l.x0));
  const rw = p75(rightLines.map((l) => l.x1 - l.x0));
  if (lw < (gx - left) * 0.6 || rw < (right - gx) * 0.6) return null;
  // …and is continuous: most of its lines are one stretch of text, where a table row (an invoice's
  // "24   £11.50   £276.00") is parts set apart.
  const continuous = (ls: Line[]) => ls.filter((l) => l.cells.length === 1).length / ls.length;
  if (continuous(leftLines) < 0.5 || continuous(rightLines) < 0.5) return null;
  return { x: gx, leftEnd: Math.max(...leftLines.map((l) => l.x1)), rightStart: Math.min(...rightLines.map((l) => l.x0)) };
}

// ---------------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------------

const BULLET = /^\s*([•●◦▪▫‣∙·■□➢►▶✓✔❖◆◇○\-–—*])\s+/u;
const BULLET_ONLY = /^\s*[•●◦▪▫‣∙·■□➢►▶✓✔❖◆◇○\-–—*]\s*$/u;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+/;
const NUMBER_ONLY = /^\s*(\d{1,3})[.)]\s*$/;

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
  return out.filter((r) => r.text.length > 0).map((r, i) => (i === 0 ? { ...r, text: r.text.replace(/^\t+/, "") } : r));
}

function appendRuns(target: Run[], add: Run[], joiner: string) {
  if (joiner && target.length) pushRun(target, joiner, target[target.length - 1]);
  for (const r of add) pushRun(target, r.text, r);
}

interface Region {
  left: number;
  right: number;
}

interface FlowContext {
  page: PageInput;
  stats: DocumentStats;
  listKeys: { next: number };
  /** Left edge of the text area (the page's left margin), right edge of the text area. */
  marginLeft: number;
  marginRight: number;
  rules: Rule[];
  fills: Fill[];
}

/** Top-down vertical extent of a block, for spacing. */
interface Placed {
  block: Block;
  top: number;
  bottom: number;
}

function lineBoxTop(l: Line, pitch: number, pageH: number) {
  // Word puts a fixed line's extra height above the text: the box starts (pitch − descent) above the baseline.
  return pageH - l.y - (pitch - l.descent * l.size);
}

function lineBoxBottom(l: Line, pageH: number) {
  return pageH - l.y + l.descent * l.size;
}

/**
 * Lines whose pieces sit in the same columns row after row (an address beside invoice details, label and
 * value pairs) become a borderless table. Columns are the merged horizontal extents of the cells, so a
 * right-aligned column (amounts, dates) is recognised by its common right edge.
 */
function borderlessTable(rowsLines: Line[], marginLeft: number, pitch: number, rightEdge = Infinity): Extract<Block, { kind: "table" }> | null {
  const spans = rowsLines.flatMap((l) => l.cells.map((c) => ({ x0: c.x0, x1: c.x1 }))).sort((a, b) => a.x0 - b.x0);
  const cols: { x0: number; x1: number }[] = [];
  for (const sp of spans) {
    const last = cols[cols.length - 1];
    if (last && sp.x0 <= last.x1 + 4) last.x1 = Math.max(last.x1, sp.x1);
    else cols.push({ ...sp });
  }
  if (cols.length < 2 || cols.length > 12) return null;
  const colOf = (c: Cell) => cols.findIndex((k) => c.x0 >= k.x0 - 0.5 && c.x0 <= k.x1 + 0.5);
  // Each row as tall as the gap to the next row's baseline (a heading row is often followed by more space
  // than the rows below it); the last row, the usual pitch.
  const rows: TableRow[] = rowsLines.map((l, k) => {
    const cells: TableCell[] = cols.map(() => ({ paragraphs: [{ runs: [], align: "left", line: pitch }], span: 1 }));
    for (const c of l.cells) {
      const k = Math.max(0, colOf(c));
      appendRuns(cells[k].paragraphs[0].runs, c.runs, cells[k].paragraphs[0].runs.length ? " " : "");
    }
    const next = rowsLines[k + 1];
    return { height: next ? Math.max(pitch, l.y - next.y) : pitch, cells };
  });
  // A real table fills its columns; lines whose parts merely sit at different places (label/value pairs at
  // different tab positions) leave most cells empty — those stay paragraphs with their own tab stops.
  const filled = cols.map((_, k) => rows.filter((r) => r.cells[k].paragraphs[0].runs.length).length / rows.length);
  if (Math.min(...filled) < 0.6) return null;
  // Column alignment from where its cells line up.
  cols.forEach((col, k) => {
    const members = rowsLines.flatMap((l) => l.cells.filter((c) => colOf(c) === k));
    if (members.length < 2) return;
    const x0s = members.map((c) => c.x0);
    const x1s = members.map((c) => c.x1);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    const align: Align = spread(x0s) > 3 && spread(x1s) <= 2 ? "right" : spread(x0s) > 3 && spread(members.map((c) => (c.x0 + c.x1) / 2)) <= 2 ? "center" : "left";
    for (const r of rows) r.cells[k].paragraphs[0].align = align;
  });
  // Column edges (cells have no padding): a left-aligned column starts exactly at its text; one that
  // follows a right-aligned column starts where that column's text ends; otherwise halfway across the gap.
  const alignOfCol = (k: number) => rows[0].cells[k].paragraphs[0].align;
  const edges = [cols[0].x0];
  for (let k = 1; k < cols.length; k++) edges.push(alignOfCol(k) === "left" ? cols[k].x0 : alignOfCol(k - 1) === "right" ? cols[k - 1].x1 + 0.5 : (cols[k - 1].x1 + cols[k].x0) / 2);
  // The last column has nothing to its right: it may run to the text edge, so a value set a little wider
  // than it was measured (another font's widths, OCR's box) doesn't wrap and push everything below down.
  const lastAlign = alignOfCol(cols.length - 1);
  edges.push(lastAlign === "left" && Number.isFinite(rightEdge) ? Math.max(cols[cols.length - 1].x1 + 2, rightEdge) : cols[cols.length - 1].x1 + 2);
  const columns = edges.slice(1).map((e, k) => e - edges[k]);
  return { kind: "table", columns, rows, bordered: false, border: null, indent: tw(edges[0] - marginLeft), spaceBefore: 0, cellMargin: { left: 0, right: 0, top: 0 } };
}

/**
 * Fill-in lines under a borderless table's values ("Applicant  Maria Lopez" over a line) become those
 * cells' bottom borders — the line belongs to the value, not to the whole row, and can't sit between rows
 * as a paragraph. A line running past the table's last column widens that column to where it ends.
 */
function underlineCells(table: Extract<Block, { kind: "table" }>, rowsLines: Line[], ctx: FlowContext) {
  const starts: number[] = [];
  let x = ctx.marginLeft + table.indent;
  for (const w of table.columns) {
    starts.push(x);
    x += w;
  }
  rowsLines.forEach((l, r) => {
    const bottom = l.y - l.descent * l.size;
    for (const rule of [...ctx.rules]) {
      if (Math.abs(rule.y1 - rule.y0) > 0.6 || rule.y0 >= bottom + 1 || bottom - rule.y0 > l.size * 1.2) continue;
      // The column the line mostly lies under (a fill-in line starts a little before its value, in the
      // label's column).
      let k = -1;
      let best = 0;
      starts.forEach((s, i) => {
        const o = Math.min(rule.x1, s + table.columns[i]) - Math.max(rule.x0, s);
        if (o > best) [k, best] = [i, o];
      });
      if (k < 0 || best < 0.5 * Math.min(rule.x1 - rule.x0, table.columns[k])) continue;
      const cell = table.rows[r].cells[k];
      if (!cell?.paragraphs[0]?.runs.length) continue;
      const end = starts[k] + table.columns[k];
      if (rule.x1 < starts[k] + Math.min(table.columns[k], 24)) continue;
      cell.borderBottom = { thickness: snapBorder(rule.thickness), color: rule.color };
      if (k === table.columns.length - 1 && rule.x1 > end) table.columns[k] = rule.x1 - starts[k];
      ctx.rules.splice(ctx.rules.indexOf(rule), 1);
    }
  });
}

/**
 * Two blocks of text side by side — a sender's address beside invoice details, a name beside a date column —
 * set in different sizes and line pitches, so their lines don't pair up row by row (pairing them into one
 * table interleaves and stacks them). Found as a run of consecutive lines split by one gutter at least 3 em
 * wide that no text crosses, with 2+ lines on each side. When each side's lines do pair with the other's
 * (same count, same baselines) it is an ordinary borderless table and is left to that. Otherwise: a
 * borderless 1 × 2 table, each cell holding its own block's lines at their own pitch and alignment.
 */
function sideBySide(entries: Entry[], i: number, region: Region, marginLeft: number, leading: number, pageH: number): { placed: Placed; end: number } | null {
  const lineAt = (k: number) => (entries[k]?.kind === "text" ? (entries[k] as Line) : null);
  const seed = [lineAt(i), lineAt(i + 1)].find((l) => l && l.cells.length >= 2);
  if (!seed || !lineAt(i)) return null;
  const gaps = seed.cells
    .slice(1)
    .map((c, k) => ({ a: seed.cells[k].x1, b: c.x0 }))
    .filter((g) => g.b - g.a >= 3 * seed.size)
    .sort((p, q) => q.b - q.a - (p.b - p.a));
  for (const gap of gaps) {
    const gx = (gap.a + gap.b) / 2;
    const run: Line[] = [];
    let j = i;
    for (; j < entries.length; j++) {
      const l = lineAt(j);
      // (Text of about the block's size only: a title above isn't part of the address beside the details.)
      if (!l || l.cells.some((c) => c.x0 < gx - 1 && c.x1 > gx + 1) || l.cells.some((c) => c.leader) || BULLET.test(l.text) || NUMBERED.test(l.text) || Math.abs(l.size - seed.size) > 0.3 * seed.size) break;
      const prev = run[run.length - 1];
      if (prev && prev.y - l.y > 2.2 * Math.max(prev.size, l.size)) break;
      run.push(l);
    }
    if (run.length < 3) continue;
    const items = run.flatMap((l) => l.items);
    const leftLines = groupLines(items.filter((it) => it.x + it.w <= gx));
    const rightLines = groupLines(items.filter((it) => it.x >= gx));
    if (leftLines.length < 2 || rightLines.length < 2) continue;
    // Pairing is judged where both sides have text (a heading under a two-column header row belongs to
    // neither): rows that pair there are an ordinary borderless table.
    const hi = Math.min(leftLines[0].y, rightLines[0].y) + 0.3 * seed.size;
    const lo = Math.max(leftLines[leftLines.length - 1].y, rightLines[rightLines.length - 1].y) - 0.3 * seed.size;
    const inL = leftLines.filter((l) => l.y <= hi && l.y >= lo);
    const inR = rightLines.filter((l) => l.y <= hi && l.y >= lo);
    const paired = inL.length === inR.length && inL.every((l, k) => Math.abs(l.y - inR[k].y) <= 0.15 * Math.max(l.size, inR[k].size));
    if (paired) return null;
    // Each side: its lines at its own pitch; the first line's box placed where it was.
    const pitchOf = (ls: Line[]) => (ls.length >= 2 ? (ls[0].y - ls[ls.length - 1].y) / (ls.length - 1) : ls[0].size * leading);
    const boxTop = (ls: Line[]) => ls[0].y + pitchOf(ls) - ls[0].descent * ls[0].size;
    const top = Math.max(boxTop(leftLines), boxTop(rightLines));
    const bottom = Math.min(...[leftLines, rightLines].map((ls) => ls[ls.length - 1].y - ls[ls.length - 1].descent * ls[ls.length - 1].size));
    const x0 = Math.min(...leftLines.map((l) => l.x0));
    const rx0 = Math.min(...rightLines.map((l) => l.x0));
    const rx1 = Math.max(...rightLines.map((l) => l.x1));
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    const rightAligned = spread(rightLines.map((l) => l.x1)) <= 2.5 && spread(rightLines.map((l) => l.x0)) > 3;
    const split = rightAligned ? gx : rx0;
    const end = rightAligned ? rx1 + 1 : Math.max(rx1 + 2, region.right);
    const cellOf = (ls: Line[], left: number, align: Align): TableCell => {
      const pitch = Math.round(pitchOf(ls) * 20) / 20;
      return {
        span: 1,
        paragraphs: ls.map((l, k) => ({
          runs: l.runs,
          align,
          line: pitch,
          tabs: l.cells.length >= 2 ? l.cells.slice(1).map((c) => ({ pos: tw(c.x0 - left), align: "left" as const })) : undefined,
          spaceBefore: k === 0 ? tw(Math.max(0, top - boxTop(ls))) : undefined,
        })),
      };
    };
    const block: Block = {
      kind: "table",
      columns: [split - x0, end - split],
      rows: [{ height: Math.max(4, top - bottom), cells: [cellOf(leftLines, x0, "left"), cellOf(rightLines, split, rightAligned ? "right" : "left")] }],
      bordered: false,
      border: null,
      indent: tw(x0 - marginLeft),
      spaceBefore: 0,
      cellMargin: { left: 0, right: 0, top: 0 },
    };
    return { placed: { block, top: pageH - top, bottom: pageH - bottom }, end: j };
  }
  return null;
}

/** Turns an ordered list of lines and pictures from one text flow into blocks. */
function blocksFor(entries: Entry[], region: Region, ctx: FlowContext): Placed[] {
  const { stats, page } = ctx;
  const pageH = page.height;
  const placed: Placed[] = [];
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
    if (l.text.length > 160 || l.cells.length > 1) return null;
    const ratio = l.size / stats.bodySize;
    if (ratio >= 1.75) return "h1";
    if (ratio >= 1.35) return "h2";
    if (ratio >= 1.15) return "h3";
    if (l.bold && l.text.length <= 70 && !/[.,;]$/.test(l.text.trim()) && ratio >= 0.95 && !BULLET.test(l.text) && !NUMBERED.test(l.text)) return "h3";
    return null;
  };
  const alignOf = (ls: Line[]): Align => {
    if (ls.every((l) => Math.abs((l.x0 + l.x1) / 2 - center) < width * 0.04 && l.x1 - l.x0 < width * 0.85) && ls.every((l) => l.x0 - region.left > width * 0.08)) return "center";
    if (ls.every((l) => Math.abs(l.x1 - region.right) < width * 0.03 && l.x0 - region.left > width * 0.3)) return "right";
    if (ls.length >= 2 && ls.slice(0, -1).every((l) => Math.abs(l.x1 - region.right) < 2.5) && ls[ls.length - 1].x1 < region.right - 3) return "justify";
    return "left";
  };
  const listMarker = (l: Line): { ordered: boolean; number: number; bullet: string; label: Run; textStart: number; runs: Run[] } | null => {
    // "•" or "3." as its own cell (drawn apart from the text), or as a prefix of the first cell.
    if (l.cells.length >= 2) {
      const first = l.cells[0].runs.map((r) => r.text).join("");
      if (BULLET_ONLY.test(first) || NUMBER_ONLY.test(first)) {
        const n = NUMBER_ONLY.exec(first);
        const runs: Run[] = [];
        l.cells.slice(1).forEach((c, i) => appendRuns(runs, c.runs, i > 0 ? "\t" : ""));
        return { ordered: Boolean(n), number: n ? Number(n[1]) : 1, bullet: first.trim(), label: { ...l.cells[0].runs[0], text: first.trim() }, textStart: l.cells[1].x0, runs };
      }
    }
    const b = BULLET.exec(l.text);
    const n = NUMBERED.exec(l.text);
    if (!b && !n) return null;
    const runs = stripPrefix(l.runs, n ? NUMBERED : BULLET);
    const approxStart = l.x0 + (b ? 1.4 : 1.8) * l.size * 0.55;
    return { ordered: Boolean(n), number: n ? Number(n[1]) : 1, bullet: b ? b[1] : "", label: { ...l.runs[0], text: b ? b[1] : `${n![1]}.` }, textStart: approxStart, runs };
  };

  const pitchFor = (group: Line[]) => {
    if (group.length >= 2) {
      // The mean gap, so the paragraph is exactly as tall as it was (a median drifts when baselines jitter,
      // as OCR's do) — unless one gap is far off (a stray line), then the median.
      const ds: number[] = [];
      for (let k = 1; k < group.length; k++) ds.push(group[k - 1].y - group[k].y);
      const mid = median(ds);
      const mean = (group[0].y - group[group.length - 1].y) / (group.length - 1);
      return ds.every((d) => Math.abs(d - mid) <= mid * 0.25) ? mean : mid;
    }
    return group[0].size * stats.leading;
  };

  /** Paragraph format from where its lines actually are. */
  const formatFor = (group: Line[], align: Align, opts: { textLeft?: number; hangFrom?: number } = {}): ParaFormat => {
    const ml = ctx.marginLeft;
    const mr = ctx.marginRight;
    const fmt: ParaFormat = { align, indLeft: 0, indRight: 0, indFirst: 0, spaceBefore: 0, line: null, tabs: [] };
    const first = group[0];
    const rest = group.slice(1);
    if (opts.textLeft !== undefined) {
      fmt.indLeft = opts.textLeft - ml;
      fmt.indFirst = (opts.hangFrom ?? opts.textLeft) - opts.textLeft;
    } else if (align === "left" || align === "justify") {
      const left = rest.length ? Math.min(...rest.map((l) => l.x0)) : first.x0;
      fmt.indLeft = left - ml;
      fmt.indFirst = first.x0 - left;
    } else if (align === "center") {
      const c = median(group.map((l) => (l.x0 + l.x1) / 2));
      const shift = ml + mr - 2 * c; // indRight − indLeft that puts the centre at c
      if (shift >= 0) fmt.indRight = shift;
      else fmt.indLeft = -shift;
    } else if (align === "right") {
      fmt.indRight = mr - Math.max(...group.map((l) => l.x1));
      fmt.indLeft = 0;
    }
    // A paragraph narrower than the text area (an indented abstract) has a right indent — but only when its
    // own wraps prove it: some line's next word would have fitted in the full width.
    if ((align === "left" || align === "justify") && group.length >= 2) {
      const maxX = Math.max(...group.map((l) => l.x1));
      const bound = wrapBound(group, maxX);
      if (bound < mr - 0.5) {
        const edge = align === "justify" ? maxX + WRAP_SLACK : maxX + clamp(bound - maxX - 0.5, Math.min(1.5, bound - maxX - 0.5), 6);
        fmt.indRight = Math.max(0, mr - edge);
      }
    }
    fmt.indLeft = tw(fmt.indLeft);
    fmt.indRight = Math.floor(Math.max(0, fmt.indRight) * 20) / 20; // never narrower than measured
    fmt.indFirst = tw(fmt.indFirst);
    if (Math.abs(fmt.indLeft) < 0.3) fmt.indLeft = 0;
    if (Math.abs(fmt.indFirst) < 0.3) fmt.indFirst = 0;
    fmt.line = Math.round(pitchFor(group) * 20) / 20;
    // Tab stops where the line's cells start (or end, when the last cell is right-aligned to the edge).
    const tabLine = group.find((l) => l.cells.length >= 2);
    if (tabLine) {
      tabLine.cells.slice(opts.textLeft !== undefined ? 2 : 1).forEach((c, k, arr) => {
        const last = k === arr.length - 1;
        // A blank to fill in ends at a right-aligned stop with an underscore (or dot) leader.
        if (c.leader && c.leadGap) fmt.tabs.push({ pos: tw(c.x0 - ml), align: "left" });
        if (c.leader) fmt.tabs.push({ pos: tw(c.x1 - ml), align: "right", leader: c.leader });
        else if (last && Math.abs(c.x1 - region.right) < 3) fmt.tabs.push({ pos: tw(c.x1 - ml), align: "right" });
        else fmt.tabs.push({ pos: tw(c.x0 - ml), align: "left" });
      });
      fmt.tabs.sort((a, b) => a.pos - b.pos);
    }
    // A line drawn just under the paragraph is its bottom border.
    const last = group[group.length - 1];
    const textBottom = last.y - last.descent * last.size;
    // (Nothing else written between the text and the line: a rule under the next line isn't this one's.)
    const between = (r: Rule) => ctx.page.items.some((it) => it.y > r.y0 + 0.5 && it.y < textBottom - 0.5 && it.x < r.x1 && it.x + it.w > r.x0);
    const under = ctx.rules.find((r) => Math.abs(r.y1 - r.y0) <= 0.6 && r.y0 < textBottom && textBottom - r.y0 < last.size * 1.2 && r.x1 - r.x0 > width * 0.6 && r.x0 < first.x0 + 4 && !between(r));
    if (under) {
      fmt.borderBottom = { thickness: snapBorder(under.thickness), color: under.color, space: Math.max(0, Math.round(textBottom - under.y0 - snapBorder(under.thickness) / 2)) };
      ctx.rules.splice(ctx.rules.indexOf(under), 1);
      // Word draws the border from the paragraph's left indent to its right one. For a single left-aligned
      // line, the indents are set to the line's own ends and a first-line indent keeps the text where it was.
      if (group.length === 1 && align === "left" && fmt.indFirst === 0 && under.x1 >= first.x1 + 2) {
        const textAt = ml + fmt.indLeft;
        fmt.indLeft = tw(Math.max(0, under.x0 - ml));
        fmt.indFirst = tw(textAt - (ml + fmt.indLeft));
        fmt.indRight = Math.max(0, Math.floor((mr - under.x1) * 20) / 20);
        if (Math.abs(fmt.indFirst) < 0.3) fmt.indFirst = 0;
      }
    }
    // Shading behind the whole paragraph.
    const top = first.y + first.size * 0.8;
    const shade = ctx.fills.find((f) => f.x <= first.x0 + 1 && f.x + f.w >= Math.max(...group.map((l) => l.x1)) - 1 && f.y <= textBottom + 1 && f.y + f.h >= top - 1);
    if (shade) fmt.shading = shade.color;
    return fmt;
  };

  const place = (block: Block, group: Line[]) => {
    const pitch = (block.kind === "paragraph" || block.kind === "list") && block.fmt.line ? block.fmt.line : pitchFor(group);
    const top = lineBoxTop(group[0], pitch, pageH);
    let bottom = lineBoxBottom(group[group.length - 1], pageH);
    if ((block.kind === "paragraph" || block.kind === "list") && block.fmt.borderBottom) bottom += block.fmt.borderBottom.space + block.fmt.borderBottom.thickness;
    placed.push({ block, top, bottom });
  };

  let i = 0;
  let currentList: { ordered: boolean; key: number; expect: number; bullet: string } | null = null;
  while (i < entries.length) {
    const e = entries[i];
    if (e.kind === "image") {
      const scale = Math.min(1, (region.right - region.left + 2) / e.image.w);
      const fmt: ParaFormat = { align: "left", indLeft: tw(Math.max(0, e.image.x - ctx.marginLeft)), indRight: 0, indFirst: 0, spaceBefore: 0, line: null, tabs: [] };
      placed.push({ block: { kind: "image", image: e.image, width: e.image.w * scale, height: e.image.h * scale, fmt }, top: pageH - (e.image.y + e.image.h), bottom: pageH - e.image.y });
      currentList = null;
      i++;
      continue;
    }

    // Two blocks side by side (an address beside invoice details) whose lines don't pair up row by row.
    const pair = sideBySide(entries, i, region, ctx.marginLeft, stats.leading, pageH);
    if (pair) {
      placed.push(pair.placed);
      currentList = null;
      i = pair.end;
      continue;
    }

    // A borderless table: two or more consecutive lines with 2+ cells whose starts line up in shared columns.
    if (e.cells.length >= 2 && !listMarker(e) && !e.cells.some((c) => c.leader)) {
      let j = i;
      while (j < entries.length) {
        const n = entries[j];
        if (n.kind !== "text" || n.cells.length < 2 || listMarker(n) || n.cells.some((c) => c.leader)) break;
        if (j > i) {
          const p = entries[j - 1] as Line;
          if (p.y - n.y > Math.max(p.size, n.size) * 3.2) break;
        }
        j++;
      }
      const rowsLines = entries.slice(i, j) as Line[];
      if (rowsLines.length >= 2) {
        const table = borderlessTable(rowsLines, ctx.marginLeft, pitchFor(rowsLines), region.right);
        if (table) {
          underlineCells(table, rowsLines, ctx);
          placed.push({ block: table, top: lineBoxTop(rowsLines[0], pitchFor(rowsLines), pageH), bottom: lineBoxBottom(rowsLines[rowsLines.length - 1], pageH) });
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
        if (n.kind !== "text" || Math.abs(n.size - e.size) > 0.6 || headingStyle(n) !== heading || n.look !== e.look || group[group.length - 1].y - n.y > n.size * 1.6) break;
        group.push(n);
        j++;
      }
      const runs: Run[] = [];
      group.forEach((l, k) => appendRuns(runs, l.runs, k > 0 ? " " : ""));
      const align = alignOf(group) === "justify" ? "left" : alignOf(group);
      const block: Block = { kind: "paragraph", style: heading, align, runs, fmt: formatFor(group, align) };
      place(block, group);
      currentList = null;
      i = j;
      continue;
    }

    const marker = listMarker(e);
    if (marker) {
      const { ordered, number, bullet } = marker;
      if (!currentList || currentList.ordered !== ordered || (ordered && number !== currentList.expect) || (!ordered && bullet !== currentList.bullet)) {
        currentList = { ordered, key: ctx.listKeys.next++, expect: number, bullet };
      }
      const runs = marker.runs;
      const group = [e];
      // Continuation lines: indented under the text, no marker of their own, close below.
      let j = i + 1;
      while (j < entries.length) {
        const n = entries[j];
        if (n.kind !== "text" || listMarker(n) || headingStyle(n)) break;
        const p = entries[j - 1] as Line;
        if (p.y - n.y > n.size * (typicalGap + 0.35) || n.x0 < e.x0 + n.size * 0.5) break;
        appendRuns(runs, n.runs, " ");
        group.push(n);
        j++;
      }
      const textStart = group.length > 1 ? Math.min(...group.slice(1).map((l) => l.x0)) : marker.textStart;
      const fmt = formatFor(group, alignOf(group) === "justify" ? "justify" : "left", { textLeft: textStart, hangFrom: e.x0 });
      const block: Block = { kind: "list", ordered, start: ordered ? currentList.expect : 1, listKey: currentList.key, runs, bullet: bullet || "•", label: marker.label, fmt };
      place(block, group);
      currentList.expect += 1;
      i = j;
      continue;
    }
    currentList = null;

    // A paragraph: following lines join while they look like the same paragraph.
    const group = [e];
    let j = i + 1;
    if (e.cells.length < 2) {
      while (j < entries.length) {
        const n = entries[j];
        if (n.kind !== "text") break;
        const p = group[group.length - 1];
        const gap = (p.y - n.y) / n.size;
        if (gap > typicalGap * 1.3 || gap <= 0) break;
        if (Math.abs(n.size - p.size) > Math.max(1, p.size * 0.15)) break;
        if (headingStyle(n) || listMarker(n) || n.cells.length >= 2) break;
        if (n.look !== p.look && n.text.length < 90) break; // a differently styled short line is its own paragraph
        if (n.x0 > p.x0 + n.size * 1.2 && alignOf([n]) === "left") break; // first-line indent: new paragraph
        if (group.length >= 2 && Math.abs(n.x0 - p.x0) > 2 && alignOf([n]) === "left" && alignOf([p]) === "left") break;
        // A line that stops well short of the text area ended there on purpose (an address line, a
        // sentence ending a paragraph): the next line starts a new paragraph.
        const shortEnd = p.x1 < region.left + width * 0.6 || (p.x1 < region.left + width * 0.72 && /[.!?:"”)]$/.test(p.text.trim()));
        if (shortEnd && alignOf([p]) === "left") break;
        const ap = alignOf([p]);
        const an = alignOf([n]);
        if (ap !== an && !(ap === "left" && an === "left") && !(ap === "justify" || an === "justify")) break;
        group.push(n);
        j++;
      }
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
    const align = alignOf(group);
    const block: Block = { kind: "paragraph", style: "normal", align, runs, fmt: formatFor(group, align) };
    place(block, group);
    i = j;
  }
  return placed;
}

/** Document-wide statistics used for heading detection and default formatting. */
export function documentStats(pages: PageInput[]): DocumentStats {
  const weight = new Map<number, number>();
  const fonts = new Map<string, number>();
  const pitch: number[] = [];
  for (const p of pages) {
    for (const it of p.items) {
      const n = it.str.trim().length;
      weight.set(r2(it.size), (weight.get(r2(it.size)) ?? 0) + n);
      if (it.font) fonts.set(it.font, (fonts.get(it.font) ?? 0) + n);
    }
    // Baseline-to-baseline distance of consecutive same-size lines, relative to the size.
    const ys = [...p.items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y);
    for (let k = 1; k < ys.length; k++) {
      const d = ys[k - 1].y - ys[k].y;
      if (d > ys[k].size * 0.9 && d < ys[k].size * 1.6 && Math.abs(ys[k - 1].size - ys[k].size) < 0.3) pitch.push(d / ys[k].size);
    }
  }
  let bodySize = 11;
  let best = -1;
  for (const [size, w] of weight) if (w > best || (w === best && size < bodySize)) [bodySize, best] = [size, w];
  let bodyFont = "";
  best = -1;
  for (const [f, w] of fonts) if (w > best) [bodyFont, best] = [f, w];
  const leading = pitch.length ? median(pitch) : 1.2;
  return { bodySize: Math.max(4, bodySize), bodyFont, leading: clamp(leading, 1.0, 1.6) };
}

// ---------------------------------------------------------------------------------------------------
// Headers and footers: lines at the top/bottom edge that repeat across pages, or page numbers
// ---------------------------------------------------------------------------------------------------

const PAGE_NUMBER = /^\s*(?:page\s+)?(\d{1,4})(?:\s*(?:of|\/)\s*(\d{1,4}))?\s*$/i;

/** For each page, the items that belong to its header and footer. */
/** One page's running header and footer items, and where the page sits in the document (for page-number fields). */
export interface PageBands {
  header: Set<TextItem>;
  footer: Set<TextItem>;
  pageNo?: number;
  pageCount?: number;
}

export function findHeadersFooters(pages: PageInput[]): PageBands[] {
  const out: PageBands[] = pages.map((_, i) => ({ header: new Set<TextItem>(), footer: new Set<TextItem>(), pageNo: i + 1, pageCount: pages.length }));
  const key = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
  const bands = pages.map((p) => {
    const lines = groupLines(p.items.filter((i) => i.str.trim()));
    if (!lines.length) return { top: [] as Line[], bottom: [] as Line[] };
    return { top: lines.filter((l) => l.y > p.height * 0.9), bottom: lines.filter((l) => l.y < p.height * 0.1) };
  });
  const count = new Map<string, number>();
  for (const b of bands) for (const k of new Set([...b.top, ...b.bottom].map((l) => key(l.text)))) count.set(k, (count.get(k) ?? 0) + 1);
  const repeated = (l: Line) => pages.length >= 2 && (count.get(key(l.text)) ?? 0) >= Math.max(2, Math.ceil(pages.length * 0.5));
  pages.forEach((p, i) => {
    const all = groupLines(p.items.filter((it) => it.str.trim()));
    for (const [band, target] of [
      [bands[i].top, out[i].header],
      [bands[i].bottom, out[i].footer],
    ] as const) {
      for (const l of band) {
        // A lone number at the edge is a page number only if it is this page's (an amount at the foot of
        // a single page is body text).
        const m = PAGE_NUMBER.exec(l.text);
        const pageNumber = m !== null && (Number(m[1]) === i + 1 || /page/i.test(l.text));
        if (!(repeated(l) || pageNumber)) continue;
        // Only the outermost lines: body text right next to it means it's part of the page, not a header.
        // (Lines are compared by position: groupLines builds new objects on every call.)
        const inBand = (o: Line) => band.some((b) => Math.abs(b.y - o.y) < 0.5);
        const neighbours = all.filter((o) => !inBand(o) && Math.abs(o.y - l.y) < l.size * 2.2);
        if (neighbours.length) continue;
        for (const it of p.items) if (Math.abs(it.y - l.y) < 0.45 * Math.max(it.size, l.size) && it.x >= l.x0 - 1 && it.x <= l.x1 + 1) target.add(it);
      }
    }
  });
  return out;
}

function bandParagraphs(items: TextItem[], marginLeft: number, marginRight: number, pageNo?: number, pageCount?: number): CellParagraph[] {
  const lines = groupLines(items);
  return lines.map((l) => {
    const c = (l.x0 + l.x1) / 2;
    const align: Align = Math.abs(c - (marginLeft + marginRight) / 2) < 12 ? "center" : Math.abs(l.x1 - marginRight) < 6 ? "right" : "left";
    // Page numbers become live fields — only when they are this page's number (and the page count), so a
    // reference number or an amount in the margin is never replaced by a counter.
    const m = PAGE_NUMBER.exec(l.text);
    if (m && Number(m[1]) === pageNo && (!m[2] || Number(m[2]) === pageCount)) {
      const base = l.runs[0];
      const runs: Run[] = [];
      const text = l.text;
      const numAt = text.indexOf(m[1]);
      if (numAt > 0) runs.push({ ...base, text: text.slice(0, numAt) });
      runs.push({ ...base, text: m[1], field: "PAGE" });
      if (m[2]) {
        const totalAt = text.lastIndexOf(m[2]);
        runs.push({ ...base, text: text.slice(numAt + m[1].length, totalAt) });
        runs.push({ ...base, text: m[2], field: "NUMPAGES" });
      }
      return { runs, align };
    }
    return { runs: l.runs, align };
  });
}

// ---------------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------------

function setSpaceBefore(b: Block, v: number) {
  const s = Math.max(0, Math.round(v * 2) / 2);
  if (b.kind === "paragraph" || b.kind === "list" || b.kind === "image") b.fmt.spaceBefore = s;
  else b.spaceBefore = s;
}

/** Converts absolute positions into "space before" each block, starting from `start`. */
function spaceOut(placed: Placed[], start: number) {
  let cursor = start;
  for (const p of placed) {
    setSpaceBefore(p.block, p.top - cursor);
    cursor = Math.max(cursor, p.bottom);
  }
}

function gridTable(g: Grid, items: Decorated[], fills: Fill[], page: PageInput, marginLeft: number, leading: number): Placed {
  const inside = items.filter((it) => it.x >= g.x0 - 2 && it.x <= g.x1 + 2 && it.y <= g.y1 + 1 && it.y >= g.y0 - 1);
  let xs = g.xs;
  if (g.openSides) {
    // Rows ruled by horizontal lines only: columns are where the text sits — the merged horizontal extents of
    // the cells across all rows (right-aligned amounts of different widths overlap into one column). A column
    // whose text lines up on the left starts at it; one whose text lines up on the right ends at it.
    const rowLines = groupLines(inside);
    const spans = rowLines
      .flatMap((l, row) => l.cells.map((c) => ({ x0: c.x0, x1: c.x1, row })))
      .sort((a, b) => a.x0 - b.x0);
    let cols: { x0: number; x1: number; starts: number[]; ends: number[]; rows: Set<number> }[] = [];
    for (const sp of spans) {
      const last = cols[cols.length - 1];
      if (last && sp.x0 <= last.x1 + 4) {
        last.x1 = Math.max(last.x1, sp.x1);
        last.starts.push(sp.x0);
        last.ends.push(sp.x1);
        last.rows.add(sp.row);
      } else cols.push({ x0: sp.x0, x1: sp.x1, starts: [sp.x0], ends: [sp.x1], rows: new Set([sp.row]) });
    }
    // Neighbouring pieces no row has text in both of are one column (a header set at the left over amounts
    // set at the right). Alignment comes from the column's body.
    const merged: typeof cols = [];
    for (const c of cols) {
      const last = merged[merged.length - 1];
      if (last && ![...c.rows].some((r) => last.rows.has(r))) {
        const body = (x: typeof c) => x.rows.size;
        const [main] = body(last) >= body(c) ? [last, c] : [c, last];
        merged[merged.length - 1] = { x0: Math.min(last.x0, c.x0), x1: Math.max(last.x1, c.x1), starts: main.starts, ends: main.ends, rows: new Set([...last.rows, ...c.rows]) };
      } else merged.push(c);
    }
    cols = merged;
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    const rightAligned = (c: (typeof cols)[number]) => spread(c.starts) > 3 && spread(c.ends) <= 2.5;
    xs = [g.x0];
    for (let k = 1; k < cols.length; k++) {
      // (A right-aligned column after a left-aligned one starts at its leftmost text — often its header, set
      // at the left — or midway in the gap, whichever is nearer.)
      const edge = !rightAligned(cols[k]) ? cols[k].x0 - 4 : rightAligned(cols[k - 1]) ? cols[k - 1].x1 + 4 : Math.max((cols[k - 1].x1 + cols[k].x0) / 2, cols[k].x0 - 4);
      if (edge > xs[xs.length - 1] + 6 && edge < g.x1 - 6) xs.push(edge);
    }
    xs.push(g.x1);
  }
  const cols = xs.slice(1).map((x, k) => x - xs[k]);
  const rowsY = g.ys;
  const rows: TableRow[] = [];
  const hasV = (x: number, yTop: number, yBot: number) => g.openSides || g.vRules.some((r) => Math.abs(r.x0 - x) < 1.5 && r.y0 <= yBot + 1.5 && r.y1 >= yTop - 1.5);
  const hasH = (y: number, xl: number, xr: number) => g.hRules.some((r) => Math.abs(r.y0 - y) < 1.5 && r.x0 <= xl + 1.5 && r.x1 >= xr - 1.5);
  const cellMarginsL: number[] = [];
  const cellTops: number[] = [];
  // Line pitch inside cells: from cells with several lines, else from the body text's leading.
  const inner: number[] = [];
  for (let r = 0; r < rowsY.length - 1; r++) {
    const ls = groupLines(inside.filter((it) => it.y < rowsY[r] && it.y > rowsY[r + 1]));
    for (let k = 1; k < ls.length; k++) {
      const d = ls[k - 1].y - ls[k].y;
      if (d > ls[k].size * 0.9 && d < ls[k].size * 1.7) inner.push(d / ls[k].size);
    }
  }
  const pitchRatio = inner.length ? median(inner) : leading;
  // The cell each grid column's vertical merge started in: text drawn in the lower rows of a merged cell
  // (vertically centred, or wrapping down) belongs to it.
  const mergeOwner = new Map<number, TableCell>();
  for (let r = 0; r < rowsY.length - 1; r++) {
    const yTop = rowsY[r];
    const yBot = rowsY[r + 1];
    const cells: TableCell[] = [];
    for (let c = 0; c < cols.length; c++) {
      // Merge across a missing vertical line.
      let span = 1;
      while (c + span < cols.length && !hasV(xs[c + span], yTop, yBot)) span++;
      const xl = xs[c];
      const xr = xs[c + span];
      const content = inside.filter((it) => it.x + it.w / 2 >= xl && it.x + it.w / 2 <= xr && it.y < yTop && it.y > yBot);
      const lines = groupLines(content);
      // A cell of several lines keeps the gap those lines have (a panel set at double spacing), whatever the
      // table's usual pitch is.
      const ownGap = lines.length >= 2 ? (lines[0].y - lines[lines.length - 1].y) / (lines.length - 1) : null;
      const pitchOf = (l: Line) => (ownGap !== null && ownGap > l.size * 0.9 && ownGap < l.size * 3 ? ownGap : l.size * pitchRatio);
      const paragraphs: CellParagraph[] = lines.length
        ? lines.map((l) => ({ runs: l.runs, line: Math.round(pitchOf(l) * 20) / 20, tabs: l.cells.length >= 2 ? l.cells.slice(1).map((c) => ({ pos: c.x0 - xl, align: "left" as const })) : undefined, align: l.x0 - xl > 8 && Math.abs(xr - l.x1 - (l.x0 - xl)) > 4 && xr - l.x1 < l.x0 - xl ? "right" : l.x0 - xl > 8 && Math.abs((l.x0 + l.x1) / 2 - (xl + xr) / 2) < 2 ? "center" : "left" }))
        : [{ runs: [], align: "left" }];
      if (lines.length) {
        cellMarginsL.push(Math.min(...lines.map((l) => l.x0)) - xl);
        // The first line's box starts (pitch − descent) above its baseline.
        const l0 = lines[0];
        cellTops.push(yTop - (l0.y + pitchOf(l0) - l0.descent * l0.size));
      }
      const shade = fills.find((f) => f.x <= xl + 2 && f.x + f.w >= xr - 2 && f.y <= yBot + 2 && f.y + f.h >= yTop - 2);
      // A cell continuing from the row above when there's no line between them.
      const vMerge = r > 0 && !g.openSides && !hasH(yTop, xl, xr) ? "continue" : undefined;
      const owner = vMerge ? mergeOwner.get(c) : undefined;
      if (vMerge && lines.length) {
        if (owner) owner.paragraphs = owner.paragraphs.some((p) => p.runs.length) ? [...owner.paragraphs, ...paragraphs] : paragraphs;
      }
      // Without a cell above to merge into, the text stays where it is (never dropped).
      const keep = vMerge && !owner ? undefined : vMerge;
      const cell: TableCell = { paragraphs: keep ? [{ runs: [], align: "left" }] : paragraphs, shading: shade?.color, span, vMerge: keep };
      if (!keep) mergeOwner.set(c, cell);
      cells.push(cell);
      c += span - 1;
    }
    // The distance between two ruling lines includes a line's thickness, which Word adds again.
    rows.push({ height: Math.max(4, yTop - yBot - (g.border?.thickness ?? 0)), cells });
  }
  // Mark the first cell of each vertical merge.
  for (let r = 1; r < rows.length; r++) {
    let col = 0;
    for (const cell of rows[r].cells) {
      if (cell.vMerge === "continue") {
        let c2 = 0;
        for (const above of rows[r - 1].cells) {
          if (c2 === col && above.vMerge !== "continue") above.vMerge = "restart";
          c2 += above.span;
        }
      }
      col += cell.span;
    }
  }
  // Cell padding from left-aligned text only (right-aligned amounts sit far from the left edge).
  const lefts = cellMarginsL.filter((m) => m >= 0).sort((a, b) => a - b);
  const left = lefts.length ? clamp(lefts[Math.floor(lefts.length * 0.25)], 0, 12) : 5.4;
  // Tab stops count from the cell's text edge, inside the padding.
  for (const row of rows) for (const cell of row.cells) for (const p of cell.paragraphs) if (p.tabs) p.tabs = p.tabs.map((t) => ({ ...t, pos: tw(Math.max(0, t.pos - left)) }));
  const top = cellTops.length ? clamp(median(cellTops), 0, 12) : 0;
  // The top padding rides on each cell's first paragraph, not on the cell margin: Word counts a cell's margins
  // inside an "at least" row height, LibreOffice adds them on top — paragraph spacing reads the same in both.
  if (top > 0) for (const row of rows) for (const cell of row.cells) if (cell.paragraphs[0]?.runs.length) cell.paragraphs[0].spaceBefore = tw(top);
  const block: Block = {
    kind: "table",
    columns: cols,
    rows,
    bordered: !g.openSides,
    border: g.border,
    rowsOnly: g.openSides,
    indent: tw(xs[0] - marginLeft),
    spaceBefore: 0,
    cellMargin: { left, right: Math.min(left, 5.4), top: 0 },
  };
  // Half of the outer border lies outside the lines' centres.
  const half = (g.border?.thickness ?? 0) / 2;
  return { block, top: page.height - g.y1 - half, bottom: page.height - g.y0 + half };
}

/** The tightest right edge a group of wrapped lines allows: each line ended because its next word didn't fit. */
function wrapBound(lines: Line[], maxX: number): number {
  let bound = Infinity;
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    const firstCell = b.cells[0];
    if (!firstCell) continue;
    const text = firstCell.runs.map((r) => r.text).join("");
    const word = text.split(/\s+/)[0] ?? "";
    if (!word || !text.length) continue;
    const candidate = a.x1 + a.size * 0.25 + ((firstCell.x1 - firstCell.x0) * word.length) / text.length;
    if (candidate > maxX + 0.5) bound = Math.min(bound, candidate);
  }
  return bound;
}

/**
 * Where the text area ends. Every line must still fit (so at least the longest line), and a line that
 * wrapped must still wrap: its next word didn't fit, which bounds the edge from above. Justified text ends
 * exactly at the edge. With nothing wrapping, a generous area (mirroring the left margin) is safe and
 * absorbs small width differences between the PDF's fonts and Word's.
 */
function textAreaRight(lines: Line[], contentRight: number, contentLeft: number, pageWidth: number, leading: number): number {
  const maxX = contentRight;
  let bound = Infinity;
  let justified = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (Math.abs(a.x1 - maxX) < 0.6) justified++;
    const sameParagraph = Math.abs(b.x0 - a.x0) < 2 && a.y - b.y < a.size * leading * 1.12 && a.cells.length === 1 && b.cells.length === 1 && Math.abs(a.size - b.size) < 0.6;
    if (!sameParagraph || a.x1 > maxX - 0.6) continue;
    const firstCell = b.cells[0];
    const text = firstCell.runs.map((r) => r.text).join("");
    const word = text.split(/\s+/)[0] ?? "";
    if (!word || !text.length) continue;
    const wordW = ((firstCell.x1 - firstCell.x0) * word.length) / text.length;
    const candidate = a.x1 + a.size * 0.25 + wordW;
    // A bound narrower than the longest line can't be a real wrap (it's a paragraph's last line).
    if (candidate > maxX + 0.5) bound = Math.min(bound, candidate);
  }
  if (justified >= 2) return maxX + WRAP_SLACK;
  if (bound === Infinity) return Math.max(maxX + WRAP_SLACK, pageWidth - contentLeft);
  // Ragged text: room for small font-width differences between the PDF's producer and Word (a fraction
  // of a percent), but never enough for a word that wrapped to fit.
  return maxX + clamp(bound - maxX - 0.5, Math.min(1.5, bound - maxX - 0.5), 6);
}

/**
 * Lines framing the whole page (left/right ≥ 80 % of its height, top/bottom ≥ 80 % of its width, near the
 * edges): a certificate's border. Two nested frames a few points apart are a double border.
 */
function pageFrame(rules: Rule[], page: PageInput): { rules: Rule[]; border: PageBorder } | null {
  const H = rules.filter((r) => Math.abs(r.y1 - r.y0) <= 0.6 && r.x1 - r.x0 >= page.width * 0.8);
  const V = rules.filter((r) => Math.abs(r.x1 - r.x0) <= 0.6 && r.y1 - r.y0 >= page.height * 0.8);
  const top = H.filter((r) => r.y0 > page.height * 0.85).sort((a, b) => b.y0 - a.y0);
  const bottom = H.filter((r) => r.y0 < page.height * 0.15).sort((a, b) => a.y0 - b.y0);
  const left = V.filter((r) => r.x0 < page.width * 0.15).sort((a, b) => a.x0 - b.x0);
  const right = V.filter((r) => r.x0 > page.width * 0.85).sort((a, b) => b.x0 - a.x0);
  if (!top.length || !bottom.length || !left.length || !right.length) return null;
  const nested = (list: Rule[], pos: (r: Rule) => number) => list.length >= 2 && Math.abs(pos(list[1]) - pos(list[0])) <= 8;
  const double = nested(top, (r) => r.y0) && nested(bottom, (r) => r.y0) && nested(left, (r) => r.x0) && nested(right, (r) => r.x0);
  const used = double ? [top[0], top[1], bottom[0], bottom[1], left[0], left[1], right[0], right[1]] : [top[0], bottom[0], left[0], right[0]];
  return {
    rules: used,
    border: {
      style: double ? "double" : "single",
      thickness: snapBorder(median(used.map((r) => r.thickness))),
      color: top[0].color,
      space: { top: page.height - top[0].y0, bottom: bottom[0].y0, left: left[0].x0, right: page.width - right[0].x0 },
    },
  };
}

/**
 * Fill-in lines: a horizontal rule that starts just after a piece of text, on that text's baseline, with no
 * text above it, is the blank of a form field ("Name ______", "Signature ____  Date ____"), not a separator.
 * It becomes a leader piece of that line, which Word writes as a tab with an underline leader ending where
 * the line ended — an editable blank, not a drawing. Distances are in the text's own size (scale-free).
 */
function fillInBlanks(items: Decorated[], rules: Rule[]): { items: Decorated[]; used: Set<Rule> } {
  const out: Decorated[] = [];
  const used = new Set<Rule>();
  for (const r of rules) {
    if (Math.abs(r.y1 - r.y0) > 0.6) continue;
    const y = (r.y0 + r.y1) / 2;
    // The label: on the rule's line (the rule sits at or a little under its baseline), ending just before it.
    const label = items
      .filter((it) => y <= it.y + 0.2 * it.size && y >= it.y - 0.45 * it.size && it.x + it.w <= r.x0 + 2 && r.x0 - (it.x + it.w) < 4 * it.size)
      .sort((a, b) => b.x + b.w - (a.x + a.w))[0];
    if (!label || r.x1 - r.x0 < 2 * label.size) continue;
    // Nothing written over the blank (a line under a value is that value's underline, not a blank).
    if (items.some((it) => it.x < r.x1 - 1 && it.x + it.w > r.x0 + 1 && it.y >= y - 0.5 * it.size && it.y - y < 1.6 * it.size)) continue;
    used.add(r);
    out.push({ ...label, str: "____", x: r.x0, w: r.x1 - r.x0, underline: false, strike: false });
  }
  return { items: out, used };
}

/** Lays out one page. `listKeys` numbers lists across the whole document. `bands` are this page's
 * header/footer items (see findHeadersFooters). */
export function layoutPage(page: PageInput, stats: DocumentStats, listKeys: { next: number } = { next: 1 }, bands?: PageBands): PageLayout {
  const all = page.items.filter((i) => i.str.trim().length > 0 && i.size > 0);
  const headerItems = all.filter((i) => bands?.header.has(i));
  const footerItems = all.filter((i) => bands?.footer.has(i));
  const bodyRaw = all.filter((i) => !bands?.header.has(i) && !bands?.footer.has(i));
  const hasText = bodyRaw.length > 0;
  const { items, rules } = decorate(bodyRaw, page.rules ?? []);
  const fills = [...(page.fills ?? [])];

  // Pictures: skip specks, and a full-page background under real text (a searchable scan or a letterhead
  // backdrop) — the text is what an editable document needs.
  const images = page.images.filter((im) => im.w >= 12 && im.h >= 12 && !(hasText && (im.w * im.h) / (page.width * page.height) > 0.85));

  // Ruled tables take their text out of the flow.
  // A frame around the whole page is the page's border, not a table holding everything.
  const frame = pageFrame(rules, page);
  if (frame) rules.splice(0, rules.length, ...rules.filter((r) => !frame.rules.includes(r)));
  const grids = findGrids(rules).filter((g) => items.some((it) => it.x >= g.x0 - 2 && it.x <= g.x1 && it.y <= g.y1 && it.y >= g.y0));
  const inGrid = (it: { x: number; y: number }, g: Grid) => it.x >= g.x0 - 2 && it.x <= g.x1 + 2 && it.y <= g.y1 + 1 && it.y >= g.y0 - 1;
  const flowItems: Decorated[] = items.filter((it) => !grids.some((g) => inGrid(it, g)));
  const gridRules = new Set(grids.flatMap((g) => [...g.hRules, ...g.vRules]));
  let freeRules = rules.filter((r) => !gridRules.has(r));
  // Blanks to fill in ("Name ______"): written as Word tab leaders, like a typed form.
  const blanks = fillInBlanks(flowItems, freeRules);
  flowItems.push(...blanks.items);
  freeRules = freeRules.filter((r) => !blanks.used.has(r));

  const textLeft = items.length ? Math.min(...items.map((i) => i.x)) : page.width * 0.1;
  const textRight = items.length ? Math.max(...items.map((i) => i.x + i.w)) : page.width * 0.9;
  const left = Math.min(textLeft, ...images.map((im) => im.x), ...grids.map((g) => g.x0));
  const right = Math.max(textRight, ...images.map((im) => im.x + im.w), ...grids.map((g) => g.x1));
  // The text area: its left edge is the leftmost content; its right edge just past the longest line,
  // so Word wraps each line where the PDF did.
  const marginLeft = clamp(left, 0, page.width * 0.4);
  let marginRightEdge = clamp(textAreaRight(groupLines(flowItems), right, left, page.width, stats.leading), page.width * 0.6, page.width);
  const ctx: FlowContext = { page, stats, listKeys, marginLeft, marginRight: marginRightEdge, rules: freeRules, fills };

  // Pictures beside text (a logo next to an address) keep their place on the page; others flow. On a
  // two-column page a picture inside one column belongs to that column's flow.
  const gutter = findGutter(flowItems, textLeft, textRight);
  const floating: FloatingImage[] = [];
  // Visual fallback: the scan stays the page's look; the recognised text sits over it, invisible.
  if (page.background) floating.push({ image: page.background, x: 0, y: 0, width: page.width, height: page.height, behind: true });
  const flowImages: PageImage[] = [];
  for (const im of images) {
    if (gutter && (im.x + im.w <= gutter.x + 1 || im.x >= gutter.x - 1)) {
      flowImages.push(im);
      continue;
    }
    const inBand = (y: number) => y > im.y + 2 && y < im.y + im.h - 2;
    const beside = flowItems.some((it) => inBand(it.y) && (it.x + it.w < im.x - 2 || it.x > im.x + im.w + 2)) || images.some((o) => o !== im && o.y < im.y + im.h - 2 && o.y + o.h > im.y + 2);
    const insideGrid = grids.some((g) => im.x >= g.x0 - 2 && im.x + im.w <= g.x1 + 2 && im.y >= g.y0 - 2 && im.y + im.h <= g.y1 + 2);
    if (beside || insideGrid) floating.push({ image: im, x: im.x, y: page.height - im.y - im.h, width: im.w, height: im.h });
    else flowImages.push(im);
  }

  const imageEntries: ImageEntry[] = flowImages.map((im) => ({ kind: "image", top: im.y + im.h, y: im.y + im.h, image: im }));
  const byTop = (a: { top: number }, b: { top: number }) => b.top - a.top;
  const placed: Placed[] = [];

  if (gutter === null) {
    const entries: Entry[] = [...groupLines(flowItems), ...imageEntries].sort(byTop);
    placed.push(...blocksFor(entries, { left: marginLeft, right: marginRightEdge }, ctx));
  } else {
    // Two columns: lines that cross the gutter (titles, full-width figures) split the page into bands;
    // within each band the columns become a real two-column section.
    const gx = gutter.x;
    const spanning = new Set(flowItems.filter((i) => i.x < gx - 1 && i.x + i.w > gx + 1));
    const spanLines = groupLines([...spanning]);
    const leftItems = flowItems.filter((i) => !spanning.has(i) && i.x + i.w <= gx + 1);
    const leftSet = new Set(leftItems);
    const rightItems = flowItems.filter((i) => !spanning.has(i) && !leftSet.has(i));
    const leftEntries: Entry[] = [...groupLines(leftItems), ...imageEntries.filter((e) => e.image.x + e.image.w <= gx + 1)];
    const rightEntries: Entry[] = [...groupLines(rightItems), ...imageEntries.filter((e) => e.image.x >= gx - 1)];
    const spanEntries: Entry[] = [...spanLines, ...imageEntries.filter((e) => e.image.x < gx - 1 && e.image.x + e.image.w > gx + 1)].sort(byTop);
    // A rule drawn across the gutter also ends one stretch of columns and starts the next.
    const spanRules = ctx.rules.filter((r) => Math.abs(r.y1 - r.y0) <= 0.6 && r.x0 < gx - 1 && r.x1 > gx + 1).map((r) => (r.y0 + r.y1) / 2);
    const cutList: { y: number; entry?: Entry }[] = [...spanEntries.map((e) => ({ y: e.top, entry: e })), ...spanRules.map((y) => ({ y }))].sort((a, b) => b.y - a.y);
    const cuts = [Infinity, ...cutList.map((c) => c.y), -Infinity];
    // Word's columns are equal. Each column's lines bound where its edge may be: past its longest line, and
    // short of where a wrapped line's next word would have fitted (justified text: at its longest line). The
    // right column ends at the page's text edge, which is moved into the right column's range if needed; the
    // column width is chosen inside the left column's range and wide enough for the right column to start at
    // or before its text (its paragraphs are indented from there).
    const range = (items: Decorated[], start: number) => {
      const ls = groupLines(items.filter((i) => !spanning.has(i)));
      if (!ls.length) return { lo: 0, hi: Infinity };
      const maxX = Math.max(...ls.map((l) => l.x1));
      const ends = ls.slice(0, -1).filter((l) => maxX - l.x1 < 1).length;
      const justified = ls.length >= 4 && ends >= 0.6 * (ls.length - 1);
      const bound = wrapBound(ls, maxX);
      return { lo: maxX - start, hi: (justified ? maxX + 1.5 : bound) - start, justified };
    };
    const rightIt = flowItems.filter((i) => !spanning.has(i) && i.x >= gx - 1);
    const leftIt = flowItems.filter((i) => !spanning.has(i) && i.x + i.w <= gx + 1);
    const R = range(rightIt, 0);
    // (Ragged text gets 1.5 pt past its longest line: OCR boxes and Word's widths each differ by a little.)
    const rightEdgeOk = (e: number) => e >= R.lo + (R.justified ? 0.25 : 1) && e < Math.min(R.hi - 0.25, R.lo + 2);
    if (!rightEdgeOk(marginRightEdge)) {
      const target = R.justified ? R.lo + 0.25 : R.lo + clamp((Math.min(R.hi, R.lo + 12) - R.lo) * 0.2, 1, 1.5);
      if (Number.isFinite(target) && target <= page.width) marginRightEdge = target;
    }
    ctx.marginRight = marginRightEdge;
    const L = range(leftIt, marginLeft);
    const minForRight = marginRightEdge - gutter.rightStart;
    const lower = Math.max(L.lo + 0.25, minForRight);
    const upper = L.hi - 0.25;
    // (Nearer the longest line than the wrap bound: Word's widths run a little narrower than a scan's.)
    // (Close to the longest line: where a line wrapped is only known to a couple of points.)
    let colWidth = L.justified ? Math.max(L.lo + 0.25, minForRight) : lower <= upper ? lower + clamp((Math.min(upper, lower + 12) - lower) * 0.2, 0.5, 1) : lower;
    if (marginRightEdge - marginLeft - 2 * colWidth < 6) colWidth = (marginRightEdge - marginLeft - 6) / 2;
    const gap = marginRightEdge - marginLeft - 2 * colWidth;
    const inBand = (e: Entry, hi: number, lo: number) => e.top <= hi && e.top > lo;
    for (let b = 0; b < cuts.length - 1; b++) {
      const hi = cuts[b];
      const lo = cuts[b + 1];
      const across = b > 0 ? cutList[b - 1].entry : undefined;
      if (across) placed.push(...blocksFor([across], { left: marginLeft, right: marginRightEdge }, ctx));
      const leftBand = leftEntries.filter((e) => inBand(e, hi === Infinity ? Infinity : hi - 0.01, lo)).sort(byTop);
      const rightBand = rightEntries.filter((e) => inBand(e, hi === Infinity ? Infinity : hi - 0.01, lo)).sort(byTop);
      if (!leftBand.length && !rightBand.length) continue;
      const leftCtx = { ...ctx, marginRight: marginLeft + colWidth };
      const rightCtx = { ...ctx, marginLeft: marginRightEdge - colWidth, marginRight: marginRightEdge };
      const lp = blocksFor(leftBand, { left: marginLeft, right: marginLeft + colWidth }, leftCtx);
      const rp = blocksFor(rightBand, { left: marginRightEdge - colWidth, right: marginRightEdge }, rightCtx);
      const top = Math.min(lp[0]?.top ?? Infinity, rp[0]?.top ?? Infinity);
      const bottom = Math.max(lp[lp.length - 1]?.bottom ?? -Infinity, rp[rp.length - 1]?.bottom ?? -Infinity);
      // Each column starts where its own first block starts.
      spaceOut(lp, top);
      spaceOut(rp, top);
      placed.push({ block: { kind: "columns", gap, spaceBefore: 0, left: lp.map((p) => p.block), right: rp.map((p) => p.block) }, top, bottom });
    }
  }

  // Ruled tables, in their place. A table with running text beside it is pinned to the page (Word's
  // floating table), so the text beside it keeps flowing as it did.
  for (const g of grids) {
    const p = gridTable(g, items, fills, page, marginLeft, stats.leading);
    const beside = flowItems.some((it) => it.y < g.y1 - 1 && it.y > g.y0 + 1 && (it.x + it.w < g.x0 - 2 || it.x > g.x1 + 2));
    if (beside && p.block.kind === "table") {
      p.block.float = { x: tw(g.x0), y: tw(page.height - g.y1) };
      p.bottom = p.top; // takes no room in the flow
    }
    placed.push(p);
  }
  // Lines nothing else used (a signature or fill-in line, a separator) stay where they were drawn.
  for (const r of ctx.rules) {
    if (Math.abs(r.y1 - r.y0) > 0.6 || r.x1 - r.x0 < 36) continue;
    const y = (r.y0 + r.y1) / 2;
    const t = snapBorder(r.thickness);
    // An empty 1 pt line with the rule as its bottom border: Word draws the border below the line, so the
    // block spans 1 pt + the border, centred on where the rule was drawn.
    placed.push({ block: { kind: "rule", indLeft: tw(Math.max(0, r.x0 - marginLeft)), width: tw(r.x1 - r.x0), thickness: t, color: r.color, spaceBefore: 0 }, top: page.height - y - 1 - t / 2, bottom: page.height - y + t / 2 });
  }
  placed.sort((a, b) => a.top - b.top);

  // Header / footer.
  const header = headerItems.length ? bandParagraphs(headerItems, marginLeft, marginRightEdge, bands?.pageNo, bands?.pageCount) : null;
  const footer = footerItems.length ? bandParagraphs(footerItems, marginLeft, marginRightEdge, bands?.pageNo, bands?.pageCount) : null;
  const headerTop = headerItems.length ? page.height - Math.max(...headerItems.map((i) => i.y + i.size * 0.8)) : 36;
  const footerBottom = footerItems.length ? Math.min(...footerItems.map((i) => i.y - (i.descent ?? 0.22) * i.size)) : 36;

  const firstTop = placed.length ? placed[0].top : 72;
  const lastBottom = placed.length ? Math.max(...placed.map((p) => p.bottom)) : page.height - 72;
  spaceOut(placed, firstTop);
  const footerTop = footerItems.length ? page.height - Math.max(...footerItems.map((i) => i.y + i.size)) : Infinity;
  const margins = {
    // Rounded outwards, so the text area is never narrower than the lines that have to fit in it.
    left: Math.floor(marginLeft * 20) / 20,
    right: Math.floor((page.width - marginRightEdge) * 20) / 20,
    top: Math.round(clamp(firstTop, 0, page.height / 2) * 2) / 2,
    // Each PDF page is its own section, so nothing flows in after the last line: a modest bottom margin
    // (never tight against the content: a shaded block or a few points of line-height drift must not spill onto
    // a new page) keeps the page one page.
    bottom: Math.round(clamp(Math.min(page.height - lastBottom - 20, 72, footerTop - 4), 0, page.height / 2) * 2) / 2,
  };
  return {
    width: page.width,
    height: page.height,
    margins,
    blocks: placed.map((p) => p.block),
    floating,
    header,
    footer,
    headerDistance: Math.max(0, Math.round(headerTop * 2) / 2),
    footerDistance: Math.max(0, Math.round(footerBottom * 2) / 2),
    pageBorder: frame?.border,
    transparentText: Boolean(page.background),
  };
}

/** Plain text of a layout, for tests and QA. */
export function layoutText(pages: PageLayout[]): string {
  const out: string[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.kind === "paragraph" || b.kind === "list") out.push(b.runs.map((r) => r.text).join(""));
      else if (b.kind === "table") for (const row of b.rows) out.push(row.cells.map((c) => c.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ")).join("\t"));
      else if (b.kind === "columns") {
        walk(b.left);
        walk(b.right);
      }
    }
  };
  for (const p of pages) {
    if (p.header) for (const hp of p.header) out.push(hp.runs.map((r) => r.text).join(""));
    walk(p.blocks);
    if (p.footer) for (const fp of p.footer) out.push(fp.runs.map((r) => r.text).join(""));
  }
  return out.join("\n");
}
