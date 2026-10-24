/**
 * Editing a line of text in place.
 *
 * The old glyphs are removed from the operators that draw them and the new text is written into the same operators, in the
 * same embedded font whenever that font can write every character (the usual case for a spelling correction: the letters are
 * already in the subset). Otherwise the new text uses the bundled metric-compatible font of the same family, bold/italic and
 * size. Nothing is drawn over the page: there is no cover, and the old text is gone from extraction and search.
 *
 * What follows the edit (the rest of the line, later lines positioned relative to it) is put back exactly where it was, and
 * the whole result is *verified by simulation* before it is committed: the line reads as the new text, and no other glyph on
 * the page has moved.
 */
import { PDFDict, PDFName, type PDFDocument, type PDFPage } from "pdf-lib";
import { commitStreams } from "./apply";
import { diffChars } from "./diff";
import { addFontResource, type FallbackFamily, type FallbackFonts } from "./fallback";
import { fixPositions, type Expectation } from "./fixup";
import { interpretPage, type PageContent, type RGB, type TextRun } from "./interpreter";
import { StreamEditor } from "./streamedit";
import { buildLines, type TextLine } from "./textmodel";
import { fmtNum, hexString, parseContent, serName, serObj, toBytes, type Obj } from "./tokenizer";

export interface EditEnv {
  doc: PDFDocument;
  page: PDFPage;
  fonts: FallbackFonts;
}

export interface StyleOverride {
  family?: FallbackFamily;
  bold?: boolean;
  italic?: boolean;
  /** Font size in page units (points on an unscaled page). */
  size?: number;
  color?: RGB;
}

export interface EditOptions {
  /** How the line is anchored when its width changes: the left edge stays (default), the centre, or the right edge. */
  align?: "left" | "center" | "right";
  style?: StyleOverride;
}

export type EditResult =
  | { ok: true; usedSubstituteFont: boolean; warnings: string[] }
  | { ok: false; reason: string; code: "not-editable" | "too-long" | "unsupported" | "failed" | "no-change" };

const fail = (reason: string, code: Extract<EditResult, { ok: false }>["code"] = "failed"): EditResult => ({ ok: false, reason, code });

interface Plan {
  slotStart: number;
  slotEnd: number;
  insert: string;
}

const utf16be = (s: string): Uint8Array => {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + 2 * i] = c >> 8;
    out[3 + 2 * i] = c & 255;
  }
  return out;
};

function resourcesFor(content: PageContent, run: TextRun, page: PDFPage): PDFDict {
  const own = content.streams.get(run.streamKey)?.resources;
  if (own) return own;
  const inherited = page.node.Resources();
  if (inherited) return inherited;
  const fresh = page.doc.context.obj({});
  page.node.set(PDFName.of("Resources"), fresh);
  return fresh;
}

/** Plans the changes: which slots go, and what is inserted where. */
function planChanges(line: TextLine, newText: string, forced: boolean): Plan[] | null {
  const slots = line.slots;
  const oldChars: { ch: string; slot: number }[] = [];
  slots.forEach((s, k) => {
    for (const ch of s.char) oldChars.push({ ch, slot: k });
  });
  const hunks = forced ? [{ delStart: 0, delEnd: oldChars.length, insert: newText }] : diffChars(oldChars.map((c) => c.ch), [...newText]);
  const plans: Plan[] = [];
  const firstChar = (slot: number) => oldChars.findIndex((c) => c.slot === slot);
  const lastChar = (slot: number) => oldChars.map((c) => c.slot).lastIndexOf(slot);
  for (const h of hunks) {
    let slotStart: number;
    let slotEnd: number;
    let ins = h.insert;
    if (h.delStart < h.delEnd) {
      slotStart = oldChars[h.delStart].slot;
      slotEnd = oldChars[h.delEnd - 1].slot + 1;
      ins = oldChars.slice(firstChar(slotStart), h.delStart).map((c) => c.ch).join("") + ins + oldChars.slice(h.delEnd, lastChar(slotEnd - 1) + 1).map((c) => c.ch).join("");
    } else if (h.delStart > 0 && h.delStart < oldChars.length && oldChars[h.delStart - 1].slot === oldChars[h.delStart].slot) {
      slotStart = oldChars[h.delStart].slot;
      slotEnd = slotStart + 1;
      ins = oldChars.slice(firstChar(slotStart), h.delStart).map((c) => c.ch).join("") + ins + oldChars.slice(h.delStart, lastChar(slotStart) + 1).map((c) => c.ch).join("");
    } else {
      slotStart = slotEnd = h.delStart < oldChars.length ? oldChars[h.delStart].slot : slots.length;
    }
    const prev = plans[plans.length - 1];
    if (prev && slotStart < prev.slotEnd) return null; // two changes inside one multi-character slot
    plans.push({ slotStart, slotEnd, insert: ins });
  }
  return plans;
}

export async function editLine(env: EditEnv, content: PageContent, line: TextLine, newText: string, opts: EditOptions = {}): Promise<EditResult> {
  if (!line.editable) return fail(line.reason ?? "This text can't be edited.", "not-editable");
  if (line.runs.some((r) => r.shared)) return fail("This text is part of a shared page element, so editing it would change it everywhere it appears.", "unsupported");
  if (line.slots.some((s) => s.char === "�")) return fail("Some characters in this line can't be read, so it can't be edited safely.", "not-editable");
  const forcedStyle = opts.style && Object.values(opts.style).some((v) => v !== undefined) ? opts.style : null;
  if (forcedStyle?.color && line.runs.some((r) => !r.color)) return fail("This text's colour can't be read, so its colour can't be changed.", "unsupported");

  const slots = line.slots;
  const plans = planChanges(line, newText, Boolean(forcedStyle));
  if (!plans) return fail("Those two changes are too close together; edit them one at a time.", "unsupported");
  if (!plans.length) return fail("Nothing changed.", "no-change");

  // ---- what to delete, and where the new text goes -------------------------------------------------
  let failure = "";
  const deleted = new Map<TextRun, Set<number>>();
  const inserts: { run: TextRun; gi: number; text: string; plan: number }[] = [];
  plans.forEach((p, planIndex) => {
    for (let k = p.slotStart; k < p.slotEnd; k++) {
      const sl = slots[k];
      if (sl.glyph) {
        if (!deleted.has(sl.run)) deleted.set(sl.run, new Set());
        deleted.get(sl.run)!.add(sl.glyphIndex);
      }
    }
    if (!p.insert) return;
    let host: { run: TextRun; gi: number } | null = null;
    if (p.slotEnd > p.slotStart) {
      const range = slots.slice(p.slotStart, p.slotEnd);
      const first = range.find((s) => s.glyph && !s.glyph.virtual) ?? range.find((s) => s.glyph);
      if (first) host = { run: first.run, gi: first.glyphIndex };
    }
    if (!host) {
      for (let k = p.slotStart - 1; k >= 0 && !host; k--) if (slots[k].glyph) host = { run: slots[k].run, gi: slots[k].glyphIndex + 1 };
      for (let k = p.slotEnd; k < slots.length && !host; k++) if (slots[k].glyph) host = { run: slots[k].run, gi: slots[k].glyphIndex };
    }
    if (!host) {
      failure = "There is nowhere to put the new text.";
      return;
    }
    inserts.push({ ...host, text: p.insert, plan: planIndex });
  });
  if (failure) return fail(failure);
  const touched = new Set<TextRun>([...deleted.keys(), ...inserts.map((i) => i.run)]);

  // ---- fonts for the new text -----------------------------------------------------------------------
  let usedSubstitute = false;
  const resolved = new Map<string, { bytes: Uint8Array; font: { resName: string; size: number } | null }>();
  for (const ins of inserts) {
    const key = `${ins.run.id}:${ins.gi}`;
    const run = ins.run;
    if (!forcedStyle && run.font.canEncode(ins.text)) {
      resolved.set(key, { bytes: run.font.encode(ins.text)!.bytes, font: null });
      continue;
    }
    const face = await env.fonts.forStyle({ fontClass: run.font.fontClass, family: run.font.family, bold: forcedStyle?.bold ?? run.font.bold, italic: forcedStyle?.italic ?? run.font.italic, forceFamily: forcedStyle?.family }, ins.text);
    if (!env.fonts.supports(face, ins.text)) return fail("The new text contains a character none of the available fonts have.", "unsupported");
    const resName = addFontResource(resourcesFor(content, run, env.page), face.ref);
    const size = forcedStyle?.size ? (run.size * forcedStyle.size) / (run.pageSize || run.size) : run.size;
    resolved.set(key, { bytes: env.fonts.encode(face, ins.text), font: { resName, size } });
    usedSubstitute = true;
  }

  // ---- rewrite each touched operation -----------------------------------------------------------------
  const editors = new Map<string, StreamEditor>();
  const editorFor = (key: string) => {
    let e = editors.get(key);
    if (!e) editors.set(key, (e = new StreamEditor(content.streams.get(key)!.bytes, content.streams.get(key)!.ops)));
    return e;
  };
  /** The glyphs of one show operation we write: kept glyphs (by their index in the old run) or a block of new text. */
  type Piece = { kept: number[] } | { plan: number };
  const written = new Map<TextRun, { descr: Piece[]; showIdx: number[]; count: number }>();
  const runNewText = new Map<TextRun, string>();
  const SHOW = new Set(["Tj", "TJ", "'", '"']);
  type Seg = { t: "str"; bytes: number[]; gis: number[] } | { t: "num"; v: number; gi?: number } | { t: "new"; text: string; plan: number; key: string };
  for (const run of touched) {
    const stream = content.streams.get(run.streamKey);
    if (!stream) return fail("The page content couldn't be read.");
    const op = stream.ops[run.opIndex];
    const del = deleted.get(run) ?? new Set<number>();
    const insAt = new Map<number, typeof inserts>();
    for (const ins of inserts) if (ins.run === run) (insAt.get(ins.gi) ?? insAt.set(ins.gi, []).get(ins.gi)!).push(ins);
    const segs: Seg[] = [];
    let gi = 0;
    let newRunText = "";
    const emitInserts = (at: number) => {
      for (const ins of insAt.get(at) ?? []) {
        segs.push({ t: "new", text: ins.text, plan: ins.plan, key: `${ins.run.id}:${ins.gi}` });
        newRunText += ins.text;
      }
    };
    const pushStr = (bytes: number[], g: number) => {
      const last = segs[segs.length - 1];
      if (last && last.t === "str") {
        last.bytes.push(...bytes);
        last.gis.push(g);
      } else segs.push({ t: "str", bytes: [...bytes], gis: [g] });
    };
    const showString = (bytes: Uint8Array, strIndex: number) => {
      const glyphs = run.glyphs.filter((g) => !g.virtual && g.strIndex === strIndex);
      for (const g of glyphs) {
        emitInserts(gi);
        if (!del.has(gi)) {
          pushStr(Array.from(bytes.subarray(g.byteOffset, g.byteOffset + g.len)), gi);
          newRunText += g.unicode;
        }
        gi++;
      }
    };
    if (run.opName === "TJ") {
      const arr = op.args[0];
      if (arr?.t !== "arr") return fail("The page content couldn't be read.");
      arr.v.forEach((el, e) => {
        if (el.t === "str") showString(el.v, e);
        else if (el.t === "num") {
          const v = run.glyphs[gi];
          if (v?.virtual && v.tjIndex === e) {
            emitInserts(gi);
            if (!del.has(gi)) {
              segs.push({ t: "num", v: el.v, gi });
              newRunText += " ";
            }
            gi++;
          } else segs.push({ t: "num", v: el.v });
        }
      });
    } else {
      const s = op.args[run.opName === '"' ? 2 : 0];
      if (s?.t !== "str") return fail("The page content couldn't be read.");
      showString(s.v, 0);
    }
    emitInserts(gi);

    // render the operations, and note which glyphs each show operation will hold
    const parts: string[] = [];
    const descr: Piece[] = [];
    if (run.opName === "'") parts.push("T*");
    if (run.opName === '"') parts.push(`${fmtNum(run.wordSpace)} Tw ${fmtNum(run.charSpace)} Tc T*`);
    let pending: Seg[] = [];
    const flush = () => {
      if (!pending.length) return;
      const strs = pending.filter((x) => x.t === "str") as { t: "str"; bytes: number[]; gis: number[] }[];
      const kept: number[] = [];
      for (const x of pending) {
        if (x.t === "str") kept.push(...x.gis);
        else if (x.t === "num" && x.gi !== undefined) kept.push(x.gi);
      }
      if (pending.length === 1 && strs.length === 1) {
        parts.push(`${hexString(Uint8Array.from(strs[0].bytes))} Tj`);
        descr.push({ kept });
      } else if (strs.length || pending.some((x) => x.t === "num" && x.v !== 0)) {
        parts.push("[" + pending.map((x) => (x.t === "str" ? hexString(Uint8Array.from(x.bytes)) : x.t === "num" ? fmtNum(x.v) : "")).join(" ") + "] TJ");
        descr.push({ kept });
      }
      pending = [];
    };
    for (const seg of segs) {
      if (seg.t !== "new") {
        pending.push(seg);
        continue;
      }
      flush();
      const r = resolved.get(seg.key)!;
      if (!r.font) parts.push(`${hexString(r.bytes)} Tj`);
      else {
        const colour = forcedStyle?.color;
        if (colour) parts.push(`${fmtNum(colour.r)} ${fmtNum(colour.g)} ${fmtNum(colour.b)} rg`);
        parts.push(`/${r.font.resName} ${fmtNum(r.font.size)} Tf ${hexString(r.bytes)} Tj`);
        parts.push(`${serName(run.fontResName)} ${fmtNum(run.size)} Tf`);
        if (colour && run.color) parts.push(`${fmtNum(run.color.r)} ${fmtNum(run.color.g)} ${fmtNum(run.color.b)} rg`);
      }
      descr.push({ plan: seg.plan });
    }
    flush();
    const text = parts.join("\n");
    const parsed = parseContent(toBytes(text));
    const showIdx = parsed.map((o, i) => (SHOW.has(o.op) ? i : -1)).filter((i) => i >= 0);
    if (showIdx.length !== descr.length) return fail("The page content couldn't be rewritten safely.");
    editorFor(run.streamKey).replace(run.opIndex, text);
    written.set(run, { descr, showIdx, count: parsed.length });
    runNewText.set(run, newRunText);
  }

  // ---- ActualText: marked content that carries the text must say the new text, or search finds the old one ----
  const atOps = new Set<string>();
  for (const run of touched) if (run.actualTextOp !== null) atOps.add(`${run.streamKey}@${run.actualTextOp}`);
  for (const key of atOps) {
    const [streamKey, idx] = key.split("@");
    const opIndex = Number(idx);
    const op = content.streams.get(streamKey)!.ops[opIndex];
    const inside = content.runs.filter((r) => r.streamKey === streamKey && r.actualTextOp === opIndex).sort((a, b) => a.opIndex - b.opIndex);
    const text = inside.map((r) => (runNewText.has(r) ? runNewText.get(r)! : r.glyphs.map((g) => g.unicode).join(""))).join("");
    const dict = op.args[1];
    if (dict?.t !== "dict") continue;
    const updated: Obj = { t: "dict", v: { ...dict.v, ActualText: { t: "str", v: utf16be(text), hex: true } } };
    editorFor(streamKey).replace(opIndex, `${serObj(op.args[0])} ${serObj(updated)} BDC`);
  }

  // ---- build, then verify by simulation ------------------------------------------------------------------------
  const built = new Map<string, { bytes: Uint8Array; newIndex: number[] }>();
  const overrides = new Map<string, Uint8Array>();
  for (const [key, ed] of editors) {
    const b = ed.build();
    built.set(key, b);
    overrides.set(key, b.bytes);
  }
  const indexOf = (streamKey: string, opIndex: number) => built.get(streamKey)?.newIndex[opIndex] ?? opIndex;
  const fontsByRef = env.fonts.describedFonts();
  const c1 = interpretPage(env.page, { overrides, fontsByRef });
  const c1Run = new Map(c1.runs.map((r) => [r.id, r]));

  // where every kept glyph is now, and the pieces holding the new text
  const keptAt = new Map<string, { id: string; gi: number }>();
  const pieceOfPlan = new Map<number, string>();
  const newRunIds = new Set<string>();
  for (const run of line.runs) {
    const base = indexOf(run.streamKey, run.opIndex);
    const w = written.get(run);
    if (!w) {
      const id = `${run.streamKey}#${base}`;
      newRunIds.add(id);
      run.glyphs.forEach((_, gi) => keptAt.set(`${run.id}:${gi}`, { id, gi }));
      continue;
    }
    w.descr.forEach((d, di) => {
      const id = `${run.streamKey}#${base + w.showIdx[di]}`;
      newRunIds.add(id);
      if ("plan" in d) pieceOfPlan.set(d.plan, id);
      else d.kept.forEach((oldGi, gi) => keptAt.set(`${run.id}:${oldGi}`, { id, gi }));
    });
  }
  for (const id of newRunIds) if (!c1Run.has(id)) return fail("The page content couldn't be rewritten safely.");

  // how much each change widens or narrows the line, as written
  const deltas = plans.map((p, pi) => {
    const oldStart = p.slotStart < slots.length ? slots[p.slotStart].s0 : slots[slots.length - 1].s1;
    const oldEnd = p.slotEnd > p.slotStart ? slots[p.slotEnd - 1].s1 : oldStart;
    const id = pieceOfPlan.get(pi);
    const r = id ? c1Run.get(id) : undefined;
    const newAdv = r ? r.glyphs.reduce((n, g) => n + (g.x2 - g.x) * line.ux + (g.y2 - g.y) * line.uy, 0) : 0;
    return newAdv - (oldEnd - oldStart);
  });
  const align = { left: 0, center: 0.5, right: 1 }[opts.align ?? "left"];
  const head = -align * deltas.reduce((a, b) => a + b, 0);
  const shiftOf = (k: number) => head + plans.reduce((acc, p, pi) => (p.slotEnd <= k ? acc + deltas[pi] : acc), 0);
  const deletedSlot = new Set<number>();
  for (const p of plans) for (let k = p.slotStart; k < p.slotEnd; k++) deletedSlot.add(k);

  const expectations: Expectation[] = [];
  const idxOfId = (id: string) => Number(id.split("#")[1]);
  const keyOfId = (id: string) => id.split("#")[0];
  slots.forEach((sl, k) => {
    if (!sl.glyph || deletedSlot.has(k)) return;
    const at = keptAt.get(`${sl.run.id}:${sl.glyphIndex}`);
    if (!at) return;
    const sh = shiftOf(k);
    expectations.push({ streamKey: keyOfId(at.id), opIndex: idxOfId(at.id), glyphIndex: at.gi, x: sl.glyph.x + sh * line.ux, y: sl.glyph.y + sh * line.uy });
  });
  // new text at the very start of the line begins where the old text began (moved by the alignment shift)
  plans.forEach((p, pi) => {
    const id = pieceOfPlan.get(pi);
    if (id && !slots.slice(0, p.slotStart).some((sl, k) => sl.glyph && !deletedSlot.has(k))) {
      const g0 = slots.find((sl) => sl.glyph)!.glyph!;
      expectations.push({ streamKey: keyOfId(id), opIndex: idxOfId(id), glyphIndex: 0, x: g0.x + head * line.ux, y: g0.y + head * line.uy });
    }
  });
  // everything else on the page must stay where it was
  const lineIds = new Set(line.runs.map((r) => r.id));
  for (const r of content.runs) {
    if (lineIds.has(r.id) || r.glyphs.length === 0) continue;
    expectations.push({ streamKey: r.streamKey, opIndex: indexOf(r.streamKey, r.opIndex), glyphIndex: 0, x: r.glyphs[0].x, y: r.glyphs[0].y });
  }

  const fix = fixPositions(env.page, overrides, expectations, fontsByRef);
  if (!fix.ok) return fail(fix.reason ?? "The edit couldn't be placed exactly.");

  // the finished page: the line reads as typed, and does not run into its neighbour
  const c2 = interpretPage(env.page, { overrides: fix.streams, fontsByRef });
  const lines2 = buildLines(c2.runs);
  // fix-ups insert operations, so ids shift: expectations were re-addressed in order, so map stage-1 ids to final ids
  const remapped = new Map<string, string>();
  fix.expectations.forEach((e, i) => remapped.set(`${expectations[i].streamKey}#${expectations[i].opIndex}`, `${e.streamKey}#${e.opIndex}`));
  const lineRunsFinal = [...newRunIds].map((id) => remapped.get(id)).filter((id): id is string => Boolean(id));
  const probeId = lineRunsFinal.find((id) => (c2.runs.find((r) => r.id === id)?.glyphs.length ?? 0) > 0);
  if (newText.trim()) {
    const l2 = lines2.find((l) => l.runs.some((r) => r.id === probeId));
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    if (!l2) return fail("The edited text could not be found afterwards.");
    if (norm(l2.text) !== norm(newText)) return fail(`The edited text didn't come out as typed, so it was not applied. [got ${JSON.stringify(norm(l2.text).slice(0, 90))} wanted ${JSON.stringify(norm(newText).slice(0, 90))}]`);
    for (const other of lines2) {
      if (other === l2) continue;
      if (Math.abs(other.ux * l2.uy - other.uy * l2.ux) > 0.04) continue;
      if (Math.abs(other.t - l2.t) > 0.5 * l2.size) continue; // another baseline
      if (other.s0 >= l2.s0 && other.s0 < l2.s1 - 0.5) return fail("The new text is too long for the space: it would overlap the text beside it.", "too-long");
    }
  }

  commitStreams(env.page, content, fix.streams);
  return { ok: true, usedSubstituteFont: usedSubstitute, warnings: [] };
}
