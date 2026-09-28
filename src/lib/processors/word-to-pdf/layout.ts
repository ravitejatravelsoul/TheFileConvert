import type { FaceStyle, FontApi } from "./fonts";
import type { Block, Border, Cell, DocModel, Float, HeaderFooterSet, Paragraph, RunStyle, SectionProps, Table, TabStop } from "./model";

/**
 * Layout: the document model → positioned drawing operations on pages. Paragraphs are broken into
 * lines (tabs, alignment, justification, list labels, inline pictures), lines and table rows become
 * boxes, and boxes are stacked onto pages with Word's rules for spacing, page breaks, keep-with-next,
 * widows and orphans, repeated table header rows, footnotes, headers and footers.
 *
 * Coordinates are points from the page's top-left corner; the renderer flips them for PDF.
 */

export type Op =
  | { t: "text"; x: number; y: number; text: string; style: FaceStyle; color: string | null }
  | { t: "rect"; x: number; y: number; w: number; h: number; fill: string }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width: number; color: string; dashed?: boolean }
  | { t: "image"; x: number; y: number; w: number; h: number; media: string }
  | { t: "link"; x: number; y: number; w: number; h: number; url: string };

export interface PageOut {
  width: number;
  height: number;
  /** Drawn first (behind the text). */
  under: Op[];
  ops: Op[];
  section: number;
  /** The number printed by a PAGE field. */
  number: number;
  firstOfSection: boolean;
  outline: { level: number; title: string; y: number }[];
  footnotes: string[];
}

export interface LayoutEnv {
  fonts: FontApi;
  defaultTab: number;
  /** Text for PAGE / NUMPAGES fields. */
  field: (kind: "PAGE" | "NUMPAGES") => string;
  footnotes: Map<string, Block[]>;
}

// ------------------------------------------------------------------ boxes

interface AbsFloat {
  f: Float;
}

interface Box {
  h: number;
  before: number;
  after: number;
  ops: Op[];
  keepNext: boolean;
  pageBreakBefore: boolean;
  columnBreakBefore: boolean;
  footnotes: string[];
  floats: AbsFloat[];
  headings: { level: number; title: string }[];
  /** Header rows to draw again when this row starts a new page. */
  repeat?: Box[];
  isHeaderRow?: boolean;
  /** Split a tall box so the first part fits in `avail`. */
  split?: (avail: number) => [Box, Box] | null;
  styleId?: string;
  contextual?: boolean;
}

function box(partial: Partial<Box> & { h: number }): Box {
  return { before: 0, after: 0, ops: [], keepNext: false, pageBreakBefore: false, columnBreakBefore: false, footnotes: [], floats: [], headings: [], ...partial };
}

function shift(ops: Op[], dx: number, dy: number): Op[] {
  return ops.map((o) => {
    switch (o.t) {
      case "line":
        return { ...o, x1: o.x1 + dx, x2: o.x2 + dx, y1: o.y1 + dy, y2: o.y2 + dy };
      default:
        return { ...o, x: o.x + dx, y: o.y + dy };
    }
  });
}

// ------------------------------------------------------------------ paragraph lines

type Piece =
  | { k: "text"; text: string; style: RunStyle; fs: FaceStyle; w: number; rise: number; space: boolean; breakAfter: boolean; note?: string }
  | { k: "tab"; style: RunStyle; label?: boolean }
  | { k: "img"; media: string; w: number; h: number; style: RunStyle; breakAfter: true }
  | { k: "br"; type: "line" | "page" | "column" };

interface Placed {
  p: Piece;
  x: number;
  w: number;
  /** Tab leader to draw across a tab's gap. */
  leader?: TabStop["leader"];
}

interface Line {
  items: Placed[];
  start: number;
  end: number;
  /** Width used, not counting trailing spaces. */
  used: number;
  breakAfter: "line" | "page" | "column" | null;
  last: boolean;
}

const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;

function faceStyle(s: RunStyle): { fs: FaceStyle; rise: number } {
  if (s.vert) {
    const size = s.size * 0.65;
    return { fs: { family: s.family, bold: s.bold, italic: s.italic, size }, rise: s.vert === "super" ? s.size * 0.35 : -s.size * 0.12 };
  }
  return { fs: { family: s.family, bold: s.bold, italic: s.italic, size: s.size }, rise: 0 };
}

function textPieces(text: string, style: RunStyle, env: LayoutEnv, note?: string): Piece[] {
  const { fs, rise } = faceStyle(style);
  const out: Piece[] = [];
  const t = (style.caps ? text.toUpperCase() : text).replace(/\u00ad/g, "");
  const push = (chunk: string, space: boolean, breakAfter: boolean) => {
    if (!chunk) return;
    out.push({ k: "text", text: chunk, style, fs, w: env.fonts.measure(chunk, fs), rise, space, breakAfter, note });
  };
  const re = /[ \u3000]+|[^ \u3000]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const chunk = m[0];
    if (chunk[0] === " " || chunk[0] === "\u3000") {
      push(chunk, true, true);
      continue;
    }
    // Break opportunities inside a word: after a hyphen or slash, and around CJK characters.
    let cur = "";
    const chars = Array.from(chunk);
    chars.forEach((ch, i) => {
      const next = chars[i + 1];
      if (CJK.test(ch)) {
        push(cur, false, true);
        cur = "";
        push(ch, false, true);
        return;
      }
      cur += ch;
      if (next && (ch === "-" || ch === "/" || ch === "–" || ch === "—") && cur.length > 1) {
        push(cur, false, true);
        cur = "";
      }
    });
    push(cur, false, false);
  }
  return out;
}

function piecesOf(p: Paragraph, env: LayoutEnv, width: number): Piece[] {
  const out: Piece[] = [];
  if (p.label) {
    out.push(...textPieces(p.label.text, p.label.style, env).map((x) => (x.k === "text" ? { ...x, breakAfter: false } : x)));
    if (p.label.suffix === "tab") out.push({ k: "tab", style: p.label.style, label: true });
    else if (p.label.suffix === "space") out.push(...textPieces(" ", p.label.style, env));
  }
  for (const i of p.inlines) {
    if (i.style.hidden) continue;
    switch (i.kind) {
      case "text":
        out.push(...textPieces(i.text, i.style, env));
        break;
      case "tab":
        out.push({ k: "tab", style: i.style });
        break;
      case "break":
        out.push({ k: "br", type: i.type });
        break;
      case "field":
        out.push(...textPieces(env.field(i.field), i.style, env));
        break;
      case "footnote":
        out.push(...textPieces(i.mark, i.style, env, i.id));
        break;
      case "image": {
        const scale = Math.min(1, width / Math.max(1, i.width));
        const prev = out[out.length - 1];
        if (prev && prev.k === "text") prev.breakAfter = true;
        out.push({ k: "img", media: i.media, w: i.width * scale, h: i.height * scale, style: i.style, breakAfter: true });
        break;
      }
    }
  }
  return out;
}

function nextTab(x: number, p: Paragraph, env: LayoutEnv, label: boolean): TabStop {
  const hanging = p.props.indFirst < 0 ? p.props.indLeft : null;
  // The hanging indent acts as a tab stop (that's where list text starts).
  if (hanging !== null && x < hanging - 0.01 && (label || !p.props.tabs.some((t) => t.pos > x + 0.01 && t.pos < hanging))) return { pos: hanging, align: "left", leader: "none" };
  const custom = p.props.tabs.find((t) => t.pos > x + 0.01);
  if (custom) return custom;
  const step = env.defaultTab > 0 ? env.defaultTab : 36;
  return { pos: (Math.floor(x / step + 0.01) + 1) * step, align: "left", leader: "none" };
}

function breakLines(p: Paragraph, width: number, env: LayoutEnv): Line[] {
  const pieces = piecesOf(p, env, Math.max(1, width - p.props.indLeft - p.props.indRight));
  const lines: Line[] = [];
  const startOf = (first: boolean) => p.props.indLeft + (first ? p.props.indFirst : 0);
  const end = width - p.props.indRight;
  let line: Line = { items: [], start: startOf(true), end, used: 0, breakAfter: null, last: false };
  let x = line.start;

  const finish = (breakAfter: Line["breakAfter"]) => {
    // Trailing spaces don't count toward the width used (they hang past the margin).
    let used = x;
    for (let k = line.items.length - 1; k >= 0; k--) {
      const it = line.items[k];
      if (it.p.k === "text" && it.p.space) used = it.x;
      else break;
    }
    line.used = used - line.start;
    line.breakAfter = breakAfter;
    lines.push(line);
    line = { items: [], start: startOf(false), end, used: 0, breakAfter: null, last: false };
    x = line.start;
  };

  const widthUntilNextTab = (from: number) => {
    let w = 0;
    let trailing = 0;
    for (let j = from; j < pieces.length; j++) {
      const q = pieces[j];
      if (q.k === "tab" || q.k === "br") break;
      if (q.k === "text") {
        if (q.space) trailing += q.w;
        else trailing = 0;
        w += q.w;
      } else if (q.k === "img") {
        trailing = 0;
        w += q.w;
      }
    }
    return w - trailing;
  };

  let i = 0;
  let guard = 0;
  while (i < pieces.length && guard++ < 200000) {
    const piece = pieces[i];
    if (piece.k === "br") {
      finish(piece.type);
      i++;
      continue;
    }
    if (piece.k === "tab") {
      const stop = nextTab(x, p, env, Boolean(piece.label));
      const following = widthUntilNextTab(i + 1);
      let target = stop.pos;
      if (stop.align === "right") target = stop.pos - following;
      else if (stop.align === "center") target = stop.pos - following / 2;
      else if (stop.align === "decimal") target = stop.pos - following; // approximated as right-aligned
      const w = Math.max(0, target - x);
      if (x + w > end + 0.01 && line.items.length && stop.pos > end) {
        // No room for the tab on this line: continue on the next.
        finish(null);
        continue;
      }
      line.items.push({ p: piece, x, w, leader: stop.leader });
      x += w;
      i++;
      continue;
    }
    // A unit: pieces up to the next break opportunity, trailing spaces included.
    let j = i;
    let unitW = 0;
    let unitWNoTrail = 0;
    const isSpace = (q: Piece | undefined) => q?.k === "text" && q.space;
    while (j < pieces.length) {
      const q = pieces[j];
      if (q.k === "tab" || q.k === "br") break;
      unitW += q.w;
      if (!isSpace(q)) unitWNoTrail = unitW;
      j++;
      if (isSpace(q) ? !isSpace(pieces[j]) : q.breakAfter) {
        // Spaces after a break opportunity stay at the end of this line.
        while (isSpace(pieces[j])) unitW += (pieces[j++] as { w: number }).w;
        break;
      }
    }
    if (j === i) j = i + 1;
    if (x + unitWNoTrail <= end + 0.01 || (line.items.length === 0 && unitWNoTrail <= end - line.start + 0.01)) {
      for (let k = i; k < j; k++) {
        const q = pieces[k] as Exclude<Piece, { k: "tab" } | { k: "br" }>;
        line.items.push({ p: q, x, w: q.w });
        x += q.w;
      }
      i = j;
      continue;
    }
    if (line.items.length > 0) {
      finish(null);
      continue;
    }
    // A single unit wider than the line (a long URL): break it by characters.
    const q = pieces[i];
    if (q.k === "text" && Array.from(q.text).length > 1) {
      const chars = Array.from(q.text);
      const avail = end - x;
      let lo = 1;
      let hi = chars.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (env.fonts.measure(chars.slice(0, mid).join(""), q.fs) <= avail) lo = mid;
        else hi = mid - 1;
      }
      const head = chars.slice(0, lo).join("");
      const tail = chars.slice(lo).join("");
      pieces.splice(i, 1, { ...q, text: head, w: env.fonts.measure(head, q.fs), breakAfter: true }, { ...q, text: tail, w: env.fonts.measure(tail, q.fs) });
      continue;
    }
    // Something that can't be split (a picture, a single wide glyph): place it anyway.
    line.items.push({ p: q as Exclude<Piece, { k: "tab" } | { k: "br" }>, x, w: (q as { w: number }).w });
    x += (q as { w: number }).w;
    i++;
  }
  finish(null);
  lines[lines.length - 1].last = true;
  return lines;
}

interface LineBox {
  h: number;
  ops: Op[];
  notes: string[];
  breakBefore: "page" | "column" | null;
}

function renderLine(line: Line, p: Paragraph, env: LayoutEnv): LineBox {
  const fonts = env.fonts;
  // Vertical metrics.
  let asc = 0;
  let desc = 0;
  let textH = 0;
  let imgH = 0;
  for (const it of line.items) {
    if (it.p.k === "text") {
      const m = fonts.metrics(it.p.fs);
      asc = Math.max(asc, m.ascent + it.p.rise);
      desc = Math.max(desc, m.descent - it.p.rise);
      textH = Math.max(textH, m.height);
    } else if (it.p.k === "img") imgH = Math.max(imgH, it.p.h);
  }
  if (textH === 0) {
    const m = fonts.metrics(faceStyle(p.markStyle).fs);
    asc = Math.max(asc, m.ascent);
    desc = Math.max(desc, m.descent);
    textH = m.height;
  }
  const natural = Math.max(textH, asc + desc);
  const rule = p.props.line;
  let h: number;
  if (rule.rule === "exact") h = rule.value;
  else if (rule.rule === "atLeast") h = Math.max(rule.value, natural, imgH + desc);
  else h = Math.max(natural * rule.value, imgH + desc);
  const baseline = h - desc;

  // Horizontal alignment.
  const free = line.end - line.start - line.used;
  let offset = 0;
  let extraPerSpace = 0;
  const align = p.props.align;
  if (align === "center") offset = free / 2;
  else if (align === "right") offset = free;
  else if (align === "justify" && !line.last && !line.breakAfter && free > 0) {
    // Only spaces after the last tab stretch, and never trailing ones.
    let lastTab = -1;
    line.items.forEach((it, k) => {
      if (it.p.k === "tab") lastTab = k;
    });
    let trailingFrom = line.items.length;
    for (let k = line.items.length - 1; k >= 0; k--) {
      const q = line.items[k].p;
      if (q.k === "text" && q.space) trailingFrom = k;
      else break;
    }
    const spaces = line.items.filter((it, k) => k > lastTab && k < trailingFrom && it.p.k === "text" && it.p.space).length;
    if (spaces > 0) extraPerSpace = free / spaces;
    if (extraPerSpace > 0) {
      let shiftBy = 0;
      line.items.forEach((it, k) => {
        it.x += shiftBy;
        if (k > lastTab && k < trailingFrom && it.p.k === "text" && it.p.space) shiftBy += extraPerSpace;
      });
    }
  }

  const ops: Op[] = [];
  const under: Op[] = [];
  const notes: string[] = [];
  // Merge neighbouring text pieces with the same look into one text op.
  let k = 0;
  const items = line.items;
  while (k < items.length) {
    const it = items[k];
    if (it.p.k === "tab") {
      if (it.leader && it.leader !== "none" && it.w > 4) {
        const ch = it.leader === "dot" ? "." : it.leader === "hyphen" ? "-" : "_";
        const fs = faceStyle(it.p.style).fs;
        const cw = fonts.measure(ch, fs);
        const n = Math.floor((it.w - cw) / cw);
        if (n > 0) ops.push({ t: "text", x: it.x + offset + it.w - n * cw - cw * 0.5, y: baseline, text: ch.repeat(n), style: fs, color: it.p.style.color });
      }
      k++;
      continue;
    }
    if (it.p.k === "img") {
      ops.push({ t: "image", x: it.x + offset, y: baseline - it.p.h, w: it.p.w, h: it.p.h, media: it.p.media });
      if (it.p.style.link) ops.push({ t: "link", x: it.x + offset, y: baseline - it.p.h, w: it.p.w, h: it.p.h, url: it.p.style.link });
      k++;
      continue;
    }
    if (it.p.k !== "text") {
      k++;
      continue;
    }
    const first = it.p;
    let text = first.text;
    let w = it.w;
    let visibleW = first.space ? 0 : it.w;
    let m = k + 1;
    while (m < items.length) {
      const nx = items[m];
      if (nx.p.k !== "text") break;
      if (!sameLook(nx.p.style, first.style) || nx.p.rise !== first.rise || nx.p.note !== first.note) break;
      // With justification each word is positioned on its own (spaces stretch).
      if (extraPerSpace > 0 && items[m - 1].p.k === "text" && (items[m - 1].p as { space: boolean }).space && !nx.p.space) break;
      text += nx.p.text;
      w = nx.x + nx.w - it.x;
      if (!nx.p.space) visibleW = w;
      m++;
    }
    if (first.note) notes.push(first.note);
    const x = it.x + offset;
    const y = baseline - first.rise;
    const style = first.style;
    if (style.highlight) {
      const mm = fonts.metrics(first.fs);
      under.push({ t: "rect", x, y: y - mm.ascent, w: visibleW, h: mm.ascent + mm.descent, fill: style.highlight });
    }
    if (text.trim()) ops.push({ t: "text", x, y, text, style: first.fs, color: style.color });
    if ((style.underline || style.strike) && visibleW > 0) {
      const u = fonts.underline(first.fs);
      if (style.underline) ops.push({ t: "line", x1: x, y1: y + u.offset, x2: x + visibleW, y2: y + u.offset, width: u.thickness, color: style.color ?? "000000" });
      if (style.strike) {
        const sy = y - fonts.metrics(first.fs).ascent * 0.3;
        ops.push({ t: "line", x1: x, y1: sy, x2: x + visibleW, y2: sy, width: u.thickness, color: style.color ?? "000000" });
      }
    }
    if (style.link && visibleW > 0) {
      const mm = fonts.metrics(first.fs);
      ops.push({ t: "link", x, y: y - mm.ascent, w: visibleW, h: mm.ascent + mm.descent, url: style.link });
    }
    k = m;
  }
  return { h, ops: [...under, ...ops], notes, breakBefore: null };
}

function sameLook(a: RunStyle, b: RunStyle): boolean {
  return (
    a.family === b.family &&
    a.size === b.size &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.color === b.color &&
    a.highlight === b.highlight &&
    a.vert === b.vert &&
    a.link === b.link
  );
}

function plainText(p: Paragraph): string {
  return p.inlines
    .map((i) => (i.kind === "text" ? i.text : i.kind === "tab" ? " " : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function borderOps(b: Border, x1: number, y1: number, x2: number, y2: number): Op {
  return { t: "line", x1, y1, x2, y2, width: b.width, color: b.color, dashed: b.dashed };
}

function paragraphBoxes(p: Paragraph, width: number, env: LayoutEnv): Box[] {
  const out: Box[] = [];
  const props = p.props;
  // Pictures anchored with text wrapping: their own line above the paragraph.
  for (const f of p.floats.filter((f) => f.mode === "flow")) {
    const scale = Math.min(1, width / Math.max(1, f.width));
    const w = f.width * scale;
    const h = f.height * scale;
    const x = f.align === "center" ? (width - w) / 2 : f.align === "right" ? width - w : Math.max(0, Math.min(width - w, f.aligned ? 0 : f.xFrom === "margin" ? f.x : 0));
    out.push(box({ h: h + 4, ops: [{ t: "image", x, y: 2, w, h, media: f.media }] }));
  }
  const lines = breakLines(p, width, env);
  const boxes = lines.map((line, i) => {
    const lb = renderLine(line, p, env);
    const prev = lines[i - 1];
    return { lb, breakBefore: prev?.breakAfter === "page" ? "page" : prev?.breakAfter === "column" ? "column" : null };
  });
  const left = props.indLeft;
  const right = width - props.indRight;
  const n = boxes.length;
  boxes.forEach(({ lb, breakBefore }, i) => {
    const ops: Op[] = [];
    let h = lb.h;
    let top = 0;
    if (i === 0 && props.borders.top) top = props.borders.top.space + props.borders.top.width;
    if (i === n - 1 && props.borders.bottom) h += props.borders.bottom.space + props.borders.bottom.width;
    if (props.shading) ops.push({ t: "rect", x: left, y: 0, w: right - left, h: h + top, fill: props.shading });
    ops.push(...shift(lb.ops, 0, top));
    if (i === 0 && props.borders.top) ops.push(borderOps(props.borders.top, left, props.borders.top.width / 2, right, props.borders.top.width / 2));
    if (i === n - 1 && props.borders.bottom) {
      const y = top + h - props.borders.bottom.width / 2;
      ops.push(borderOps(props.borders.bottom, left, y, right, y));
    }
    if (props.borders.left) ops.push(borderOps(props.borders.left, left - props.borders.left.space - 2, 0, left - props.borders.left.space - 2, h + top));
    if (props.borders.right) ops.push(borderOps(props.borders.right, right + props.borders.right.space + 2, 0, right + props.borders.right.space + 2, h + top));
    const keepLines = props.keepLines && i < n - 1;
    const widow = props.widowControl && n >= 2 && (i === 0 || i === n - 2);
    out.push(
      box({
        h: h + top,
        before: i === 0 ? props.spaceBefore : 0,
        after: i === n - 1 ? props.spaceAfter : 0,
        ops,
        keepNext: keepLines || widow || (i === n - 1 && props.keepNext),
        pageBreakBefore: (i === 0 && props.pageBreakBefore) || breakBefore === "page",
        columnBreakBefore: breakBefore === "column",
        footnotes: lb.notes,
        floats: i === 0 ? p.floats.filter((f) => f.mode === "absolute").map((f) => ({ f })) : [],
        headings: i === 0 && props.outline ? [{ level: props.outline, title: plainText(p) }] : [],
        styleId: props.styleId,
        contextual: props.contextualSpacing,
      }),
    );
  });
  return out;
}

// ------------------------------------------------------------------ stacking in a frame (cells, headers, footnotes)

interface Stack {
  h: number;
  items: { y: number; box: Box }[];
}

function stack(boxes: Box[]): Stack {
  const items: { y: number; box: Box }[] = [];
  let y = 0;
  let prevAfter = 0;
  boxes.forEach((b, i) => {
    y += (i === 0 ? 0 : prevAfter) + b.before;
    items.push({ y, box: b });
    y += b.h;
    prevAfter = b.after;
  });
  return { h: y + prevAfter, items };
}

function stackOps(s: Stack): Op[] {
  return s.items.flatMap(({ y, box: b }) => shift(b.ops, 0, y));
}

/** Blocks → boxes, applying contextual spacing between paragraphs of the same style. */
function blockBoxes(blocks: Block[], width: number, env: LayoutEnv): Box[] {
  const out: Box[] = [];
  for (const b of blocks) {
    const boxes = b.kind === "p" ? paragraphBoxes(b, width, env) : tableBoxes(b, width, env);
    const first = boxes[0];
    const prev = out[out.length - 1];
    if (first && prev && b.kind === "p" && prev.styleId !== undefined && prev.styleId === first.styleId) {
      if (first.contextual) first.before = 0;
      if (prev.contextual) prev.after = 0;
    }
    out.push(...boxes);
  }
  return out;
}

// ------------------------------------------------------------------ tables

function tableBoxes(t: Table, width: number, env: LayoutEnv): Box[] {
  const nCols = Math.max(t.grid.length, ...t.rows.map((r) => r.gridBefore + r.cells.reduce((n, c) => n + c.span, 0)), 1);
  let grid = Array.from({ length: nCols }, (_, i) => t.grid[i] ?? 0);
  const total = grid.reduce((a, b) => a + b, 0);
  if (total <= 0) grid = grid.map(() => width / nCols);
  const gridTotal = grid.reduce((a, b) => a + b, 0);
  let target = t.width ? (t.width.pct ? width * t.width.value : t.width.value) : gridTotal;
  if (!(target > 0)) target = gridTotal;
  target = Math.min(target, width - Math.max(0, t.indent));
  if (Math.abs(target - gridTotal) > 0.5) grid = grid.map((g) => (g * target) / gridTotal);
  const tableW = grid.reduce((a, b) => a + b, 0);
  const x0 = t.align === "center" ? (width - tableW) / 2 : t.align === "right" ? width - tableW : t.indent;
  const colX = [x0];
  for (const g of grid) colX.push(colX[colX.length - 1] + g);

  interface Placed {
    cell: Cell;
    col: number;
    x: number;
    w: number;
    content: Stack;
    /** Rows this cell covers (vertical merge). */
    rows: number;
  }
  const rowsPlaced: Placed[][] = [];
  const openMerge = new Map<number, { row: number; placed: Placed }>();
  t.rows.forEach((row, ri) => {
    const placed: Placed[] = [];
    let col = row.gridBefore;
    for (const cell of row.cells) {
      const span = Math.max(1, cell.span);
      const x = colX[Math.min(col, nCols)];
      const w = colX[Math.min(col + span, nCols)] - x;
      const innerW = Math.max(4, w - cell.margins.left - cell.margins.right);
      const content = cell.vMerge === "continue" ? { h: 0, items: [] } : stack(blockBoxes(cell.blocks, innerW, env));
      const p: Placed = { cell, col, x, w, content, rows: 1 };
      if (cell.vMerge === "continue") {
        const open = openMerge.get(col);
        if (open) open.placed.rows = ri - open.row + 1;
      } else if (cell.vMerge === "restart") openMerge.set(col, { row: ri, placed: p });
      else openMerge.delete(col);
      placed.push(p);
      col += span;
    }
    rowsPlaced.push(placed);
  });

  // Row heights.
  const heights = t.rows.map((row, ri) => {
    let h = 0;
    for (const p of rowsPlaced[ri]) {
      if (p.cell.vMerge === "continue" || p.rows > 1) continue;
      h = Math.max(h, p.content.h + p.cell.margins.top + p.cell.margins.bottom);
    }
    if (row.height?.rule === "exact") return row.height.value;
    if (row.height) h = Math.max(h, row.height.value);
    return Math.max(h, 2);
  });
  rowsPlaced.forEach((placed, ri) => {
    for (const p of placed) {
      if (p.rows <= 1) continue;
      const need = p.content.h + p.cell.margins.top + p.cell.margins.bottom;
      const have = heights.slice(ri, ri + p.rows).reduce((a, b) => a + b, 0);
      if (need > have) heights[ri + p.rows - 1] += need - have;
    }
  });

  const continuesBelow = (ri: number, col: number) => t.rows[ri + 1] !== undefined && rowsPlaced[ri + 1].some((q) => q.col === col && q.cell.vMerge === "continue");

  function rowBox(ri: number, cellStacks: Stack[], h: number, fragment: { first: boolean; last: boolean }): Box {
    const placed = rowsPlaced[ri];
    const under: Op[] = [];
    const ops: Op[] = [];
    const lines: Op[] = [];
    const notes: string[] = [];
    placed.forEach((p, k) => {
      const c = p.cell;
      const spanH = p.rows > 1 && fragment.first && fragment.last ? heights.slice(ri, ri + p.rows).reduce((a, b) => a + b, 0) : h;
      if (c.vMerge !== "continue") {
        if (c.shading) under.push({ t: "rect", x: p.x, y: 0, w: p.w, h: spanH, fill: c.shading });
        const content = cellStacks[k];
        const free = spanH - content.h - c.margins.top - c.margins.bottom;
        const dy = c.vAlign === "center" ? Math.max(0, free / 2) : c.vAlign === "bottom" ? Math.max(0, free) : 0;
        ops.push(...shift(stackOps(content), p.x + c.margins.left, c.margins.top + dy));
        for (const it of content.items) notes.push(...it.box.footnotes);
        if (c.borders.top && fragment.first) lines.push(borderOps(c.borders.top, p.x, 0, p.x + p.w, 0));
      }
      const bottomHere = !(p.cell.vMerge !== null && continuesBelow(ri, p.col)) || !fragment.last;
      if (c.borders.bottom && bottomHere && (p.rows <= 1 || !fragment.last || !(fragment.first && fragment.last)))
        lines.push(borderOps(c.borders.bottom, p.x, h, p.x + p.w, h));
      if (c.borders.bottom && p.rows > 1 && fragment.first && fragment.last) lines.push(borderOps(c.borders.bottom, p.x, spanH, p.x + p.w, spanH));
      const sideH = c.vMerge === "restart" && p.rows > 1 && fragment.first && fragment.last ? spanH : h;
      if (c.borders.left) lines.push(borderOps(c.borders.left, p.x, 0, p.x, sideH));
      if (c.borders.right) lines.push(borderOps(c.borders.right, p.x + p.w, 0, p.x + p.w, sideH));
    });
    const row = t.rows[ri];
    const b = box({ h, ops: [...under, ...ops, ...lines], footnotes: notes, keepNext: row.header || (rowsPlaced[ri].some((p) => p.rows > 1) && fragment.last), isHeaderRow: row.header });
    if (!row.cantSplit || cellStacks.some((s) => s.h > 600)) {
      b.split = (avail: number) => {
        const firsts: Stack[] = [];
        const rests: Stack[] = [];
        let any = false;
        placed.forEach((p, k) => {
          const s = cellStacks[k];
          const limit = avail - p.cell.margins.top - p.cell.margins.bottom;
          const fit = s.items.filter((it) => it.y + it.box.h <= limit + 0.01);
          const rest = s.items.slice(fit.length);
          if (fit.length) any = true;
          firsts.push({ h: fit.length ? fit[fit.length - 1].y + fit[fit.length - 1].box.h : 0, items: fit });
          const base = rest[0]?.y ?? 0;
          rests.push({ h: rest.length ? s.h - base : 0, items: rest.map((it) => ({ y: it.y - base, box: it.box })) });
        });
        if (!any) return null;
        const restH = Math.max(2, ...rests.map((r, k) => (r.items.length ? r.h + placed[k].cell.margins.top + placed[k].cell.margins.bottom : 0)));
        return [rowBox(ri, firsts, avail, { first: fragment.first, last: false }), rowBox(ri, rests, restH, { first: false, last: fragment.last })];
      };
    }
    return b;
  }

  const boxes = t.rows.map((_, ri) =>
    rowBox(
      ri,
      rowsPlaced[ri].map((p) => p.content),
      heights[ri],
      { first: true, last: true },
    ),
  );
  // Header rows repeat at the top of each page the table continues on.
  const headers: Box[] = [];
  for (const b of boxes) {
    if (!b.isHeaderRow) break;
    headers.push(b);
  }
  if (headers.length && headers.length < boxes.length) for (const b of boxes.slice(headers.length)) b.repeat = headers;
  return boxes;
}

// ------------------------------------------------------------------ pages

function pickHeaderFooter(set: HeaderFooterSet, first: boolean, titlePage: boolean, even: boolean, evenAndOdd: boolean): Block[] | undefined {
  if (first && titlePage) return set.first ?? [];
  if (evenAndOdd && even) return set.even ?? set.default;
  return set.default;
}

function formatPageNumber(n: number, fmt: string): string {
  if (fmt === "lowerRoman" || fmt === "upperRoman") {
    const map: [number, string][] = [
      [1000, "m"],
      [900, "cm"],
      [500, "d"],
      [400, "cd"],
      [100, "c"],
      [90, "xc"],
      [50, "l"],
      [40, "xl"],
      [10, "x"],
      [9, "ix"],
      [5, "v"],
      [4, "iv"],
      [1, "i"],
    ];
    let out = "";
    let v = n;
    for (const [k, s] of map) while (v >= k) {
      out += s;
      v -= k;
    }
    return fmt === "upperRoman" ? out.toUpperCase() : out;
  }
  if (fmt === "lowerLetter" || fmt === "upperLetter") {
    const s = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1);
    return fmt === "upperLetter" ? s.toUpperCase() : s;
  }
  return String(n);
}

function floatPosition(f: Float, props: SectionProps, boxTop: number): { x: number; y: number } {
  const contentW = props.pageWidth - props.margins.left - props.margins.right;
  const frameX = f.xFrom === "page" ? 0 : props.margins.left;
  const frameW = f.xFrom === "page" ? props.pageWidth : contentW;
  const x = f.aligned ? (f.align === "center" ? frameX + (frameW - f.width) / 2 : f.align === "right" ? frameX + frameW - f.width : frameX) : frameX + f.x;
  const y = f.yFrom === "page" ? f.y : f.yFrom === "margin" ? props.margins.top + f.y : boxTop + f.y;
  return { x, y };
}

/** Lays out the whole document. Header and footer content is added per page by `decoratePages`. */
export function layoutDocument(model: DocModel, env: LayoutEnv): PageOut[] {
  const pages: PageOut[] = [];
  let page: PageOut | null = null;
  let displayNumber = 0;
  // Where the previous section ended, for continuous section breaks.
  let lastY = 0;
  let lastAfter = 0;

  model.sections.forEach((section, si) => {
    const props = section.props;
    const contentW = props.pageWidth - props.margins.left - props.margins.right;
    const cols = props.columns.count;
    const colW = cols > 1 ? (contentW - props.columns.space * (cols - 1)) / cols : contentW;

    // Header/footer heights push the body down/up when they're taller than the margin allows.
    const bandHeights = (first: boolean, even: boolean) => {
      const head = pickHeaderFooter(props.headers, first, props.titlePage, even, model.evenAndOddHeaders);
      const foot = pickHeaderFooter(props.footers, first, props.titlePage, even, model.evenAndOddHeaders);
      const hh = head?.length ? stack(blockBoxes(head, contentW, env)).h : 0;
      const fh = foot?.length ? stack(blockBoxes(foot, contentW, env)).h : 0;
      return {
        top: Math.max(props.margins.top, hh ? props.margins.header + hh : 0),
        bottom: props.pageHeight - Math.max(props.margins.bottom, fh ? props.margins.footer + fh : 0),
      };
    };

    let top = 0;
    let bottom = 0;
    let regionTop = 0;
    let col = 0;
    let y = 0;
    let placedOnPage = 0;
    let placedInColumn = 0;
    let prevAfter = 0;
    let fnHeight = 0;
    let atTopByOverflow = false;
    let firstPageOfSection = true;

    const newPage = () => {
      displayNumber = firstPageOfSection && props.pageNumberStart !== null ? props.pageNumberStart : displayNumber + 1;
      const first = firstPageOfSection;
      page = { width: props.pageWidth, height: props.pageHeight, under: [], ops: [], section: si, number: displayNumber, firstOfSection: first, outline: [], footnotes: [] };
      pages.push(page);
      const band = bandHeights(first, displayNumber % 2 === 0);
      top = band.top;
      bottom = band.bottom;
      regionTop = top;
      y = top;
      col = 0;
      placedOnPage = 0;
      placedInColumn = 0;
      prevAfter = 0;
      fnHeight = 0;
      firstPageOfSection = false;
    };

    const nextColumnOrPage = (overflow: boolean) => {
      if (col < cols - 1) {
        col++;
        y = regionTop;
        placedInColumn = 0;
        prevAfter = 0;
      } else newPage();
      atTopByOverflow = overflow;
    };

    const continuous = props.start === "continuous" && page !== null && (page as PageOut).width === props.pageWidth && (page as PageOut).height === props.pageHeight;
    if (continuous && page) {
      // Same page, new column layout from here down.
      firstPageOfSection = false;
      const p = page as PageOut;
      const band = bandHeights(p.firstOfSection, p.number % 2 === 0);
      top = band.top;
      bottom = band.bottom;
      y = pages.length ? lastY : top;
      regionTop = y;
      col = 0;
      placedOnPage = 1;
      placedInColumn = 0;
      prevAfter = lastAfter;
    } else newPage();

    const noteHeight = (ids: string[]) => {
      let h = 0;
      for (const id of ids) {
        const blocks = env.footnotes.get(id);
        if (blocks) h += stack(blockBoxes(blocks, contentW, env)).h;
      }
      return h;
    };

    const boxes = blockBoxes(section.blocks, colW, env);
    const colX = (c: number) => props.margins.left + c * (colW + props.columns.space);

    const place = (b: Box, before: number) => {
      const p = page!;
      const top0 = y + before;
      const x = colX(col);
      p.ops.push(...shift(b.ops, x, top0));
      for (const h of b.headings) p.outline.push({ ...h, y: top0 });
      for (const { f } of b.floats) {
        const pos = floatPosition(f, props, top0);
        (f.behind ? p.under : p.ops).push({ t: "image", x: pos.x, y: pos.y, w: f.width, h: f.height, media: f.media });
      }
      if (b.footnotes.length) {
        for (const id of b.footnotes) if (!p.footnotes.includes(id)) p.footnotes.push(id);
      }
      y = top0 + b.h;
      prevAfter = b.after;
      placedOnPage++;
      placedInColumn++;
      atTopByOverflow = false;
    };

    const queue = [...boxes];
    let guard = 0;
    while (queue.length && guard++ < 500000) {
      const b = queue.shift()!;
      if ((b.pageBreakBefore && placedOnPage > 0) || (b.pageBreakBefore && y > regionTop + 0.5)) {
        newPage();
        atTopByOverflow = false;
      }
      if (b.columnBreakBefore && placedInColumn > 0) nextColumnOrPage(false);

      const beforeOf = (bx: Box) => (placedInColumn === 0 ? (atTopByOverflow ? 0 : bx.before) : prevAfter + bx.before);
      let before = beforeOf(b);
      const newNotes = b.footnotes.filter((id) => !page!.footnotes.includes(id));
      const noteH = newNotes.length ? noteHeight(newNotes) + (page!.footnotes.length ? 0 : 12) : 0;
      const limit = () => bottom - fnHeight;
      const columnH = bottom - regionTop;

      // Keep with next: this box and the start of what follows must share a page.
      if (b.keepNext && placedInColumn > 0) {
        let chainH = before + b.h;
        let k = 0;
        let prevA = b.after;
        while (k < queue.length && k < 8) {
          const nb = queue[k];
          if (nb.pageBreakBefore) break;
          chainH += prevA + nb.before + nb.h;
          prevA = nb.after;
          if (!nb.keepNext) break;
          k++;
        }
        if (y + chainH > limit() && chainH <= columnH) {
          nextColumnOrPage(true);
          before = beforeOf(b);
        }
      }

      if (y + before + b.h + noteH > limit() + 0.01) {
        if (placedInColumn === 0) {
          // An empty page can't take it whole: split it if we can, else let it run over.
          const parts = b.split?.(limit() - y - before - noteH);
          if (parts) {
            place(parts[0], before);
            fnHeight += noteH;
            queue.unshift(parts[1]);
            continue;
          }
        } else {
          const remaining = limit() - y - before - noteH;
          // Table rows break across pages (Word's default); a row that fits on the next page whole
          // only moves when there's barely room for a line here.
          const parts = remaining > 20 ? b.split?.(remaining) : null;
          if (parts) {
            place(parts[0], before);
            fnHeight += noteH;
            queue.unshift(parts[1]);
            continue;
          }
          nextColumnOrPage(true);
          if (b.repeat && !b.isHeaderRow) queue.unshift(...b.repeat.map((r) => ({ ...r })), b);
          else queue.unshift(b);
          continue;
        }
      }
      place(b, before);
      fnHeight += noteH;
    }
    lastY = y;
    lastAfter = prevAfter;
  });
  return pages;
}

/** Adds headers, footers (with real page numbers) and footnotes to each laid-out page. */
export function decoratePages(pages: PageOut[], model: DocModel, env: LayoutEnv): void {
  const total = pages.length;
  pages.forEach((page) => {
    const props = model.sections[page.section].props;
    const contentW = props.pageWidth - props.margins.left - props.margins.right;
    const pageEnv: LayoutEnv = { ...env, field: (k) => (k === "PAGE" ? formatPageNumber(page.number, props.pageNumberFormat) : String(total)) };
    const even = page.number % 2 === 0;
    const head = pickHeaderFooter(props.headers, page.firstOfSection, props.titlePage, even, model.evenAndOddHeaders);
    const foot = pickHeaderFooter(props.footers, page.firstOfSection, props.titlePage, even, model.evenAndOddHeaders);
    const place = (blocks: Block[] | undefined, at: (h: number) => number) => {
      if (!blocks?.length) return;
      const s = stack(blockBoxes(blocks, contentW, pageEnv));
      const top = at(s.h);
      for (const it of s.items) {
        page.ops.push(...shift(it.box.ops, props.margins.left, top + it.y));
        for (const { f } of it.box.floats) {
          const pos = floatPosition(f, props, top + it.y);
          (f.behind ? page.under : page.ops).push({ t: "image", x: pos.x, y: pos.y, w: f.width, h: f.height, media: f.media });
        }
      }
    };
    place(head, () => props.margins.header);
    place(foot, (h) => props.pageHeight - props.margins.footer - h);

    if (page.footnotes.length) {
      const stacks = page.footnotes.map((id) => stack(blockBoxes(env.footnotes.get(id) ?? [], contentW, pageEnv)));
      const notesH = stacks.reduce((n, s) => n + s.h, 0);
      const footBand = foot?.length ? stack(blockBoxes(foot, contentW, pageEnv)).h : 0;
      const bottom = props.pageHeight - Math.max(props.margins.bottom, footBand ? props.margins.footer + footBand : 0);
      let y = bottom - notesH;
      page.ops.push({ t: "line", x1: props.margins.left, y1: y - 6, x2: props.margins.left + 144, y2: y - 6, width: 0.5, color: "000000" });
      for (const s of stacks) {
        page.ops.push(...shift(stackOps(s), props.margins.left, y));
        y += s.h;
      }
    }
  });
}
