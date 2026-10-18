/**
 * After a text edit, everything that was positioned *relative* to the edited text — the rest of its line, and any later line
 * the producer positioned with a `Td` from the end of this one — moves with it. This puts every glyph where it should be:
 * simulate the stream, find the first glyph that is off, correct the one operation that positions it, repeat.
 *
 * The result is checked by simulation, not assumed: either every expectation is met (within `tol`) or the fix reports why not.
 */
import type { PDFPage } from "pdf-lib";
import { interpretPage, mul, type FontInfoMap, type Matrix, type PageContent, type TextRun } from "./interpreter";
import { StreamEditor } from "./streamedit";
import { fmtNum } from "./tokenizer";

export interface Expectation {
  streamKey: string;
  opIndex: number;
  glyphIndex: number;
  /** Where the glyph's origin (baseline start) must be, in page space. */
  x: number;
  y: number;
}

export interface FixResult {
  ok: boolean;
  reason?: string;
  streams: Map<string, Uint8Array>;
  /** The expectations, re-addressed for the final stream (operation indices shift as corrections are inserted). */
  expectations: Expectation[];
  corrections: number;
}

const SHOW = new Set(["Tj", "TJ", "'", '"']);
const POSITION = new Set(["Td", "TD", "Tm", "T*"]);

/** Inverse of the linear part of a matrix, applied to a vector. */
function solve(m: Matrix, vx: number, vy: number): { x: number; y: number } {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
  return { x: (vx * m[3] - vy * m[1]) / det, y: (-vx * m[2] + vy * m[0]) / det };
}

export function fixPositions(page: PDFPage, start: Map<string, Uint8Array>, expectations: Expectation[], fontsByRef?: FontInfoMap, tol = 0.03, maxIter = 60): FixResult {
  let streams = new Map(start);
  let exp = expectations.map((e) => ({ ...e }));
  let corrections = 0;
  for (let iter = 0; iter <= maxIter; iter++) {
    const content = interpretPage(page, { overrides: streams, fontsByRef });
    const byId = new Map<string, TextRun>();
    for (const r of content.runs) byId.set(r.id, r);
    const bad = firstBad(content, byId, exp, tol);
    if (bad === "ok") return { ok: true, streams, expectations: exp, corrections };
    if (typeof bad === "string") return { ok: false, reason: bad, streams, expectations: exp, corrections };
    if (iter === maxIter) return { ok: false, reason: "The text couldn't be placed exactly (too many corrections).", streams, expectations: exp, corrections };

    const { run, ex, ey } = bad;
    const bytes = streams.get(run.streamKey) ?? content.streams.get(run.streamKey)!.bytes;
    const editor = new StreamEditor(bytes);
    // walk back from the run's operation to what positions it
    let governing = -1;
    let prevShow = -1;
    for (let i = run.opIndex - 1; i >= 0; i--) {
      const name = editor.ops[i].op;
      if (SHOW.has(name)) {
        prevShow = i;
        break;
      }
      if (POSITION.has(name) || name === "BT") {
        governing = i;
        break;
      }
      if (name === "ET") break;
    }
    if (governing >= 0) {
      const m = mul(run.tlm, run.ctm);
      const d = solve(m, ex, ey);
      editor.insertAfter(governing, `${fmtNum(d.x)} ${fmtNum(d.y)} Td`);
    } else if (prevShow >= 0) {
      const prev = byId.get(`${run.streamKey}#${prevShow}`);
      const m = mul(run.tm, run.ctm);
      const d = solve(m, ex, ey);
      if (!prev || Math.abs(d.y) > 0.02 * Math.max(run.size, 1)) return { ok: false, reason: "The text after the edit couldn't be kept in place.", streams, expectations: exp, corrections };
      // a TJ adjustment of n moves the text matrix by -n/1000 · size · hScale, in text space
      const n = (-d.x * 1000) / (prev.size * prev.hScale || 1);
      editor.insertAfter(prevShow, `[${fmtNum(n)}] TJ`);
    } else {
      return { ok: false, reason: "The text after the edit couldn't be kept in place.", streams, expectations: exp, corrections };
    }
    const built = editor.build();
    streams = new Map(streams).set(run.streamKey, built.bytes);
    exp = exp.map((e) => (e.streamKey === run.streamKey ? { ...e, opIndex: built.newIndex[e.opIndex] } : e));
    corrections++;
  }
  return { ok: false, reason: "The text couldn't be placed exactly.", streams, expectations: exp, corrections };
}

/** The first run (in stream order) whose glyphs are off, with the correction it needs; "ok"; or a failure reason. */
function firstBad(content: PageContent, byId: Map<string, TextRun>, exp: Expectation[], tol: number): { run: TextRun; ex: number; ey: number } | "ok" | string {
  const perRun = new Map<string, { run: TextRun; errs: { ex: number; ey: number }[] }>();
  for (const e of exp) {
    const run = byId.get(`${e.streamKey}#${e.opIndex}`);
    if (!run) return "A line of text was lost while editing.";
    const g = run.glyphs[e.glyphIndex];
    if (!g) return "A character was lost while editing.";
    const ex = e.x - g.x;
    const ey = e.y - g.y;
    let entry = perRun.get(run.id);
    if (!entry) perRun.set(run.id, (entry = { run, errs: [] }));
    entry.errs.push({ ex, ey });
  }
  const bad = [...perRun.values()]
    .filter(({ errs }) => errs.some((e) => Math.abs(e.ex) > tol || Math.abs(e.ey) > tol))
    .sort((a, b) => (a.run.streamKey === b.run.streamKey ? a.run.opIndex - b.run.opIndex : a.run.streamKey < b.run.streamKey ? -1 : 1));
  if (!bad.length) return "ok";
  const { run, errs } = bad[0];
  // glyphs of one operation move together; if they need different corrections the operation itself must change
  const first = errs[0];
  if (errs.some((e) => Math.abs(e.ex - first.ex) > 4 * tol || Math.abs(e.ey - first.ey) > 4 * tol)) return "The edit would change the spacing inside one piece of text.";
  void content;
  return { run, ex: first.ex, ey: first.ey };
}
