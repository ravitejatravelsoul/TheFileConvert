/**
 * From operator-level runs to what a person edits: lines and paragraph blocks.
 *
 * A *line* (a "flow") is the text on one baseline that reads as continuous: its glyphs may come from many operators (one
 * per glyph in Chromium's output, one `TJ` per line in LibreOffice's) and several fonts, but the gaps between them are
 * word spaces, not columns. A *block* is consecutive lines that belong together (a paragraph, a list item, a heading).
 */
import type { Glyph, Rect, RGB, TextRun } from "./interpreter";

export interface Slot {
  /** What the slot reads as. */
  char: string;
  /** The glyph it comes from, or null for a space that is only a gap between operators. */
  glyph: Glyph | null;
  run: TextRun;
  /** Index of the glyph in `run.glyphs` (-1 for a synthetic gap). */
  glyphIndex: number;
  /** Position along the baseline (page units, in the line's direction) of its start and end. */
  s0: number;
  s1: number;
}

export interface LineStyle {
  fontClass: "sans" | "serif" | "mono";
  family: string;
  bold: boolean;
  italic: boolean;
  /** Font size in page units. */
  size: number;
  color: RGB | null;
}

export interface TextLine {
  id: string;
  runs: TextRun[];
  slots: Slot[];
  text: string;
  /** Unit vector along the baseline and the unit vector "up", in page space. */
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  /** Baseline offset across the direction (page units) and the extent along it. */
  t: number;
  s0: number;
  s1: number;
  bbox: Rect;
  size: number;
  style: LineStyle;
  editable: boolean;
  reason?: string;
}

export interface TextBlock {
  id: string;
  lines: TextLine[];
  /** Text with a newline between lines (hard breaks) or a space (soft-wrapped paragraph). */
  text: string;
  softWrapped: boolean;
  align: "left" | "center" | "right";
  bbox: Rect;
  /** Width of the longest line of the block, along the baseline. */
  width: number;
  /** Width the text may fill: that of its column (the furthest any line starting at the same left edge reaches). */
  maxWidth: number;
  /** Baseline-to-baseline distance (page units), 0 for a single line. */
  leading: number;
}

const SPACE_GAP_EM = 0.14; // a gap wider than this between operators reads as a word space
const COLUMN_GAP_EM = 1.1; // wider than this ends a line (a column, a tab stop, a right-aligned date)

const rad = (d: number) => (d * Math.PI) / 180;

function runDirection(run: TextRun) {
  const a = run.angle;
  return { ux: Math.cos(a), uy: Math.sin(a) };
}

function dominantStyle(runs: TextRun[], slots: Slot[]): LineStyle {
  // the style of the run that carries the most characters
  const weight = new Map<TextRun, number>();
  for (const s of slots) if (s.glyph) weight.set(s.run, (weight.get(s.run) ?? 0) + 1);
  let best = runs[0];
  let bw = -1;
  for (const [r, w] of weight) {
    if (w > bw) {
      best = r;
      bw = w;
    }
  }
  const f = best.font;
  return { fontClass: f.fontClass, family: f.family, bold: f.bold, italic: f.italic, size: best.pageSize, color: best.color };
}

/** Groups the visible runs of a page into lines. */
export function buildLines(runs: TextRun[]): TextLine[] {
  const visible = runs.filter((r) => !r.invisible && r.glyphs.length > 0 && r.pageSize > 0.5);
  type Item = { run: TextRun; ux: number; uy: number; t: number; s0: number; s1: number };
  const items: Item[] = visible.map((run) => {
    const { ux, uy } = runDirection(run);
    const first = run.glyphs[0];
    const last = run.glyphs[run.glyphs.length - 1];
    return { run, ux, uy, t: -first.x * uy + first.y * ux, s0: first.x * ux + first.y * uy, s1: last.x2 * ux + last.y2 * uy };
  });

  // cluster: same direction (±2°) and same baseline (within a quarter of the size)
  const clusters: Item[][] = [];
  for (const it of items) {
    const home = clusters.find((c) => {
      const ref = c[0];
      const dA = Math.abs(Math.atan2(it.uy, it.ux) - Math.atan2(ref.uy, ref.ux));
      return Math.min(dA, Math.PI * 2 - dA) < rad(2) && Math.abs(it.t - ref.t) < 0.25 * Math.min(it.run.pageSize, ref.run.pageSize);
    });
    if (home) home.push(it);
    else clusters.push([it]);
  }

  const lines: TextLine[] = [];
  for (const cluster of clusters) {
    // along the baseline; text drawn at (almost) the same place keeps the order it is drawn in
    cluster.sort((a, b) => (Math.abs(a.s0 - b.s0) < 0.02 ? a.run.opIndex - b.run.opIndex : a.s0 - b.s0));
    // split into flows at wide gaps
    let flow: Item[] = [];
    const flush = () => {
      if (flow.length) lines.push(makeLine(flow));
      flow = [];
    };
    for (const it of cluster) {
      const prev = flow[flow.length - 1];
      if (prev) {
        const gap = it.s0 - prev.s1;
        if (gap > COLUMN_GAP_EM * Math.max(prev.run.pageSize, it.run.pageSize)) flush();
      }
      flow.push(it);
    }
    flush();
  }
  // reading order: top to bottom (larger t first for an upright page), then left to right
  lines.sort((a, b) => b.t - a.t || a.s0 - b.s0);
  return lines;
}

function makeLine(flow: { run: TextRun; ux: number; uy: number; t: number; s0: number; s1: number }[]): TextLine {
  const { ux, uy } = flow[0];
  // "up" is the direction the glyphs point; for a normal orientation it is (-uy, ux) in a y-up page space
  const vx = -uy;
  const vy = ux;
  const slots: Slot[] = [];
  const runs = flow.map((f) => f.run);
  let prevEnd = -Infinity;
  let prevSize = 0;
  for (const f of flow) {
    const r = f.run;
    const sz = r.pageSize;
    const startS = f.s0;
    if (slots.length) {
      const gap = startS - prevEnd;
      const last = slots[slots.length - 1];
      if (gap > SPACE_GAP_EM * Math.max(sz, prevSize) && last.char !== " " && !(r.glyphs[0].unicode === " ")) {
        slots.push({ char: " ", glyph: null, run: r, glyphIndex: -1, s0: prevEnd, s1: startS });
      }
    }
    r.glyphs.forEach((g, gi) => {
      const s0 = g.x * ux + g.y * uy;
      const s1 = g.x2 * ux + g.y2 * uy;
      slots.push({ char: g.unicode || "�", glyph: g, run: r, glyphIndex: gi, s0, s1 });
    });
    prevEnd = f.s1;
    prevSize = sz;
  }
  // a gap drawn as spacing right next to a real space glyph is the same space (justified text writes both)
  for (let i = slots.length - 1; i >= 0; i--) {
    const sl = slots[i];
    if (!sl.glyph?.virtual) continue;
    const before = slots[i - 1];
    const after = slots[i + 1];
    if ((before && before.char === " " && !before.glyph?.virtual) || (after && after.char === " " && !after.glyph?.virtual)) slots.splice(i, 1);
  }
  const text = slots.map((s) => s.char).join("");
  const s0 = Math.min(...flow.map((f) => f.s0));
  const s1 = Math.max(...flow.map((f) => f.s1));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of runs) {
    xs.push(r.bbox.x, r.bbox.x + r.bbox.width);
    ys.push(r.bbox.y, r.bbox.y + r.bbox.height);
  }
  const bbox = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const bad = runs.find((r) => !r.font.editable);
  const size = Math.max(...runs.map((r) => r.pageSize));
  const first = slots.find((s) => s.glyph)?.run ?? runs[0];
  return {
    id: `${first.id}:${slots.find((s) => s.glyph)?.glyphIndex ?? 0}`,
    runs,
    slots,
    text,
    ux,
    uy,
    vx,
    vy,
    t: flow[0].t,
    s0,
    s1,
    bbox,
    size,
    style: dominantStyle(runs, slots),
    editable: !bad,
    reason: bad?.font.reason,
  };
}

/** Groups lines into paragraph blocks. */
export function buildBlocks(lines: TextLine[]): TextBlock[] {
  const blocks: TextBlock[] = [];
  const used = new Set<TextLine>();
  const sorted = [...lines];
  for (const start of sorted) {
    if (used.has(start)) continue;
    const group: TextLine[] = [start];
    used.add(start);
    let last = start;
    for (;;) {
      const next = sorted.find((l) => !used.has(l) && sameBlock(last, l, group));
      if (!next) break;
      group.push(next);
      used.add(next);
      last = next;
    }
    blocks.push(makeBlock(group, lines));
  }
  return blocks;
}

function sameBlock(a: TextLine, b: TextLine, group: TextLine[]): boolean {
  if (Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.04) return false; // different direction
  const drop = a.t - b.t; // positive when b is below a
  const size = Math.min(a.size, b.size);
  if (Math.abs(a.size - b.size) > 0.18 * Math.max(a.size, b.size)) return false;
  if (a.style.fontClass !== b.style.fontClass) return false;
  const spacing = group.length > 1 ? group[0].t - group[1].t : 0;
  const maxDrop = spacing > 0 ? Math.max(spacing * 1.35, size * 1.8) : size * 1.95;
  if (drop < size * 0.85 || drop > maxDrop) return false;
  if (spacing > 0 && Math.abs(drop - spacing) > Math.max(size * 0.35, spacing * 0.25)) return false;
  // aligned on the left edge, or on the centre
  const leftAligned = Math.abs(a.s0 - b.s0) < size * 0.9;
  const centreA = (a.s0 + a.s1) / 2;
  const centreB = (b.s0 + b.s1) / 2;
  const centred = Math.abs(centreA - centreB) < size * 0.9 && Math.abs(a.s0 - b.s0) > size * 0.9;
  const rightAligned = Math.abs(a.s1 - b.s1) < size * 0.5 && Math.abs(a.s0 - b.s0) > size * 0.9 && !centred;
  return leftAligned || centred || rightAligned;
}

/** The right edge of the text column a line belongs to: the furthest any line starting at the same left edge reaches. */
function columnRight(line: TextLine, all: TextLine[]): number {
  let right = line.s1;
  for (const l of all) {
    if (Math.abs(l.ux * line.uy - l.uy * line.ux) > 0.04) continue;
    if (Math.abs(l.s0 - line.s0) > Math.max(2, line.size * 0.3)) continue;
    if (Math.abs(l.size - line.size) > 0.12 * line.size) continue;
    right = Math.max(right, l.s1);
  }
  return right;
}

function makeBlock(lines: TextLine[], all: TextLine[]): TextBlock {
  const xs = lines.flatMap((l) => [l.bbox.x, l.bbox.x + l.bbox.width]);
  const ys = lines.flatMap((l) => [l.bbox.y, l.bbox.y + l.bbox.height]);
  const bbox = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const width = Math.max(...lines.map((l) => l.s1 - l.s0));
  const maxS1 = Math.max(...lines.map((l) => l.s1));
  const minS0 = Math.min(...lines.map((l) => l.s0));
  let align: TextBlock["align"] = "left";
  if (lines.length > 1) {
    const left = lines.every((l) => Math.abs(l.s0 - minS0) < l.size * 0.9);
    const right = lines.every((l) => Math.abs(l.s1 - maxS1) < l.size * 0.5);
    const centre = lines.every((l) => Math.abs((l.s0 + l.s1) / 2 - (minS0 + maxS1) / 2) < l.size * 0.9);
    align = left ? "left" : right ? "right" : centre ? "center" : "left";
  } else {
    // a single line: centred or right-aligned only if it clearly sits so within its page-wide neighbourhood is unknown → left
    align = "left";
  }
  // soft-wrapped: every line but the last runs (nearly) to the block's width, and the paragraph has several lines
  let softWrapped = false;
  if (lines.length > 1 && align !== "center") {
    // every line but the last runs (nearly) to the right edge of its column — measured against other text in the
    // same column, so a two-line address of short lines is not mistaken for a wrapped paragraph
    const right = Math.max(columnRight(lines[0], all), maxS1);
    softWrapped = lines.slice(0, -1).every((l) => l.s1 >= right - 0.2 * Math.max(right - minS0, 1) && right - minS0 > l.size * 8);
  }
  const leading = lines.length > 1 ? (lines[0].t - lines[lines.length - 1].t) / (lines.length - 1) : 0;
  return {
    id: `block:${lines[0].id}`,
    lines,
    text: lines.map((l) => l.text).join(softWrapped ? " " : "\n"),
    softWrapped,
    align,
    bbox,
    width,
    maxWidth: align === "left" ? Math.max(width, columnRight(lines[0], all) - minS0) : width,
    leading,
  };
}
