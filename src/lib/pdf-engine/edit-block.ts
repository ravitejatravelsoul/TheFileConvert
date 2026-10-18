/**
 * Editing a whole paragraph block: text that gets longer wraps onto another line, text that gets shorter gives lines back.
 *
 * A change is made line by line (`editLine`), and only from the first line that changes: wrapping starts there and stops as soon
 * as a re-wrapped line equals the original line, so the rest of the paragraph is left exactly as it was. A line that has to be
 * added is written below the block as a fresh text object (refused if it would land on other text or a picture).
 */
import { PDFDict, PDFName } from "pdf-lib";
import { commitStreams } from "./apply";
import { diffChars } from "./diff";
import { editLine, type EditEnv, type EditOptions, type EditResult } from "./edit-text";
import { addFontResource } from "./fallback";
import { interpretPage, invert, mul, type Matrix, type PageContent, type TextRun } from "./interpreter";
import { StreamEditor } from "./streamedit";
import { buildBlocks, buildLines, type TextBlock, type TextLine } from "./textmodel";
import { fmtNum, hexString, serName } from "./tokenizer";

const fail = (reason: string, code: Extract<EditResult, { ok: false }>["code"] = "failed"): EditResult => ({ ok: false, reason, code });

/** Width (page units) of text in the block's own fonts: what each character measured when the producer laid it out. */
function measurer(block: TextBlock) {
  const width = new Map<string, number>();
  let size = 0;
  for (const line of block.lines)
    for (const s of line.slots) {
      if (!s.glyph || s.glyph.virtual) continue;
      size = Math.max(size, s.run.pageSize);
      if (!width.has(s.char)) width.set(s.char, ((s.glyph.x2 - s.glyph.x) * line.ux + (s.glyph.y2 - s.glyph.y) * line.uy));
    }
  const space = width.get(" ") ?? size * 0.28;
  return (text: string) => [...text].reduce((n, ch) => n + (width.get(ch) ?? (ch === " " ? space : size * 0.55)), 0);
}

/** Greedy wrap of a paragraph at `max` page units. */
export function wrapParagraph(text: string, measure: (t: string) => number, max: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur === "" && lines.length === 0 && !cur ? w : cur === "" ? w : `${cur} ${w}`;
    if (cur !== "" && measure(next) > max + 0.01) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  lines.push(cur);
  return lines;
}

/** Applies the user's change to each line while keeping the original line breaks (null when a change crosses a break). */
function keepBreaks(oldLines: string[], newText: string): string[] | null {
  const joined = oldLines.join(" ");
  const hunks = diffChars([...joined], [...newText]);
  // the char offset where each old line starts and ends in the joined text (a line's end excludes the joining space)
  const starts: number[] = [];
  let pos = 0;
  for (const l of oldLines) {
    starts.push(pos);
    pos += [...l].length + 1;
  }
  const out = oldLines.map((l) => [...l]);
  // apply from the last hunk so earlier offsets stay valid
  for (const h of [...hunks].reverse()) {
    let li = starts.findLastIndex((st) => st <= h.delStart);
    if (li < 0) li = 0;
    const lineEnd = starts[li] + out[li].length; // in old coordinates (unchanged for earlier lines)
    if (h.delEnd > lineEnd) return null; // the change reaches the break
    const local = h.delStart - starts[li];
    out[li].splice(local, h.delEnd - h.delStart, ...[...h.insert]);
  }
  return out.map((c) => c.join(""));
}

/** Splits the user's text into the lines the block should have, touching as little as possible. */
export function planLines(block: TextBlock, newText: string): string[] {
  const oldLines = block.lines.map((l) => l.text);
  const measure = measurer(block);
  const max = block.maxWidth;
  if (!block.softWrapped) {
    // each line is its own paragraph; one only wraps if the user made it longer than its column
    const lines = newText.split("\n");
    return lines.flatMap((l, i) => {
      const old = block.lines[i];
      const grew = old ? old.s1 - old.s0 + measure(l) - measure(old.text) : measure(l);
      return grew > max + 0.5 ? wrapParagraph(l, measure, max + 1) : [l];
    });
  }
  if (!newText.includes("\n")) {
    const kept = keepBreaks(oldLines, newText);
    if (kept) {
      // the real width of the line plus what the change adds (the estimate alone drifts by a fraction of a point over a line)
      const fits = kept.every((l, i) => block.lines[i].s1 - block.lines[i].s0 + measure(l) - measure(oldLines[i]) <= max + 0.5);
      // a line that became much shorter could take the next line's first word: then the paragraph is re-wrapped
      const pullsUp = kept.some((l, i) => l !== oldLines[i] && i + 1 < kept.length && measure(`${l} ${kept[i + 1].split(" ")[0]}`) <= max);
      if (fits && !pullsUp) return kept;
    }
  }
  return newText.split("\n").flatMap((p) => wrapParagraph(p, measure, max + 1));
}

/** Writes one new line of text below `last`, as its own text object. */
async function appendLine(env: EditEnv, content: PageContent, block: TextBlock, text: string, opts: EditOptions): Promise<EditResult> {
  const last = block.lines[block.lines.length - 1];
  const run: TextRun = last.runs[last.runs.length - 1];
  const leading = block.leading || last.size * 1.2;
  const first = last.slots.find((s) => s.glyph && !s.glyph.virtual)?.glyph;
  if (!first) return fail("There is no text to continue.");
  // where the line starts: below the last line, at the block's left edge (or centred / right-aligned like the others)
  const measure = measurer(block);
  const w = measure(text);
  const along = { left: 0, center: (last.s1 - last.s0 - w) / 2, right: last.s1 - last.s0 - w }[opts.align ?? block.align];
  const ox = first.x + along * last.ux - leading * last.vx;
  const oy = first.y + along * last.uy - leading * last.vy;
  // room? the new line's box must not touch other text or pictures
  const asc = last.size * 0.95;
  const desc = last.size * 0.25;
  const box = { x0: Math.min(ox, ox + w * last.ux) - 1, x1: Math.max(ox, ox + w * last.ux) + 1, y0: oy - desc, y1: oy + asc };
  const own = new Set(block.lines.flatMap((l) => l.runs.map((r) => r.id)));
  const hits = (r: { x: number; y: number; width: number; height: number }) => r.x < box.x1 && r.x + r.width > box.x0 && r.y < box.y1 && r.y + r.height > box.y0;
  if (content.runs.some((r) => !own.has(r.id) && !r.invisible && r.glyphs.length && hits(r.bbox)) || content.images.some((im) => hits(im.bbox))) {
    return fail("There isn't room below this paragraph for the extra line. Shorten the text, or make room first.", "too-long");
  }
  if (opts.style?.color && !run.color) return fail("This text's colour can't be read.", "unsupported");
  // the font: the run's own when it can write the text, otherwise the bundled one of the same family
  let fontOps: string;
  const colour = opts.style?.color ?? run.color ?? { r: 0, g: 0, b: 0 };
  const stream = content.streams.get(run.streamKey);
  const editor = new StreamEditor(stream!.bytes, stream!.ops);
  // insert after the end of the text object that holds the last run
  let et = -1;
  for (let i = run.opIndex; i < editor.ops.length; i++) if (editor.ops[i].op === "ET") {
    et = i;
    break;
  }
  if (et < 0) return fail("The page content couldn't be read.");
  let fontRes = run.fontResName;
  let size = run.size;
  let bytes: Uint8Array;
  if (!opts.style && run.font.canEncode(text)) bytes = run.font.encode(text)!.bytes;
  else {
    const face = await env.fonts.forStyle({ fontClass: run.font.fontClass, family: run.font.family, bold: opts.style?.bold ?? run.font.bold, italic: opts.style?.italic ?? run.font.italic, forceFamily: opts.style?.family }, text);
    if (!env.fonts.supports(face, text)) return fail("The new text contains a character none of the available fonts have.", "unsupported");
    const res: PDFDict = stream!.resources ?? env.page.node.Resources() ?? (env.page.doc.context.obj({}) as PDFDict);
    if (!stream!.resources && !env.page.node.Resources()) env.page.node.set(PDFName.of("Resources"), res);
    fontRes = addFontResource(res, face.ref);
    bytes = env.fonts.encode(face, text);
    if (opts.style?.size) size = (run.size * opts.style.size) / (run.pageSize || run.size);
  }
  // text matrix: the last run's, moved to the new origin
  const trm = mul(run.tm, run.ctm);
  const trm2: Matrix = [trm[0], trm[1], trm[2], trm[3], ox, oy];
  const tm2 = mul(trm2, invert(run.ctm));
  const block2 = [
    "q",
    `${fmtNum(colour.r)} ${fmtNum(colour.g)} ${fmtNum(colour.b)} rg`,
    "BT",
    `${serName(fontRes)} ${fmtNum(size)} Tf`,
    run.charSpace ? `${fmtNum(run.charSpace)} Tc` : "",
    run.wordSpace ? `${fmtNum(run.wordSpace)} Tw` : "",
    run.hScale !== 1 ? `${fmtNum(run.hScale * 100)} Tz` : "",
    "0 Tr",
    `${tm2.map(fmtNum).join(" ")} Tm`,
    `${hexString(bytes)} Tj`,
    "ET",
    "Q",
  ]
    .filter(Boolean)
    .join("\n");
  editor.insertAfter(et, block2);
  const built = editor.build();
  commitStreams(env.page, content, new Map([[run.streamKey, built.bytes]]));
  return { ok: true, usedSubstituteFont: fontRes.startsWith("TFC"), warnings: [] };
}

/** The line now at the place `ref` was: same direction, same baseline, overlapping along it. */
function locate(lines: TextLine[], ref: TextLine): TextLine | undefined {
  let best: TextLine | undefined;
  let bestScore = Infinity;
  for (const l of lines) {
    if (Math.abs(l.ux * ref.uy - l.uy * ref.ux) > 0.04) continue;
    if (Math.abs(l.t - ref.t) > 0.3 * ref.size) continue;
    const overlap = Math.min(l.s1, ref.s1) - Math.max(l.s0, ref.s0);
    if (overlap < -ref.size) continue;
    const score = Math.abs(l.s0 - ref.s0) + Math.abs(l.t - ref.t) * 4;
    if (score < bestScore) {
      best = l;
      bestScore = score;
    }
  }
  return best;
}

function fresh(env: EditEnv) {
  const content = interpretPage(env.page, { fontsByRef: env.fonts.describedFonts() });
  return { content, lines: buildLines(content.runs) };
}

/**
 * Applies a new text to a block. Returns what happened for the block as a whole; on any failure nothing is committed for the
 * step that failed (earlier steps of the same block stay — callers replay from the source, so a failure aborts the whole edit).
 */
export async function editBlock(env: EditEnv, content: PageContent, block: TextBlock, newText: string, opts: EditOptions = {}): Promise<EditResult> {
  if (block.lines.some((l) => !l.editable)) return fail(block.lines.find((l) => !l.editable)?.reason ?? "This text can't be edited.", "not-editable");
  const plan = planLines(block, newText);
  const oldLines = block.lines;
  const align = opts.align ?? block.align;
  let usedSubstitute = false;
  let changed = 0;
  // line by line, from the last line to the first, so earlier lines' addresses stay valid
  const common = Math.min(plan.length, oldLines.length);
  for (let i = common - 1; i >= 0; i--) {
    if (plan[i] === oldLines[i].text && !opts.style) continue;
    const { content: c, lines } = fresh(env);
    const line = locate(lines, oldLines[i]);
    if (!line) return fail("A line of the paragraph could not be found.");
    const res = await editLine(env, c, line, plan[i], { ...opts, align });
    if (!res.ok) return res;
    usedSubstitute ||= res.usedSubstituteFont;
    changed++;
  }
  // lines that are no longer needed
  for (let i = oldLines.length - 1; i >= plan.length; i--) {
    const { content: c, lines } = fresh(env);
    const line = locate(lines, oldLines[i]);
    if (!line) continue;
    const res = await editLine(env, c, line, "", opts);
    if (!res.ok) return res;
    changed++;
  }
  // lines that have to be added below the block
  for (let i = oldLines.length; i < plan.length; i++) {
    const { content: c, lines } = fresh(env);
    const lastNow = locate(lines, oldLines[oldLines.length - 1]);
    const current = (lastNow && buildBlocks(lines).find((b) => b.lines.includes(lastNow))) || block;
    const res = await appendLine(env, c, current, plan[i], { ...opts, align });
    if (!res.ok) return res;
    usedSubstitute ||= res.usedSubstituteFont;
    changed++;
  }
  if (!changed) return fail("Nothing changed.", "no-change");
  void content;
  return { ok: true, usedSubstituteFont: usedSubstitute, warnings: [] };
}
