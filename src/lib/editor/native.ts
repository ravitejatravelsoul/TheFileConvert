/**
 * Native-content edits: what the editor does to text and images that are *in* the PDF.
 *
 * An edit is recorded against the page as it is at that moment (the block or image it targets is named by an id taken from the
 * page's current state); replaying the edits in order on the source page rebuilds exactly that state. The *working page* is the
 * source page with its edits replayed — the editor renders it, and export replays the same edits, so the screen and the file
 * can't disagree.
 */
import { PDFDocument, type PDFPage } from "pdf-lib";
import { applyFormState } from "./formApply";
import type { FormFieldValue } from "./types";
import type { FaceKey } from "@/lib/processors/word-to-pdf/fonts";
import { editBlock } from "@/lib/pdf-engine/edit-block";
import { boxTransform, deleteImage, placeImage, replaceImage, transformedPlacement } from "@/lib/pdf-engine/edit-image";
import type { EditOptions, StyleOverride } from "@/lib/pdf-engine/edit-text";
import { FallbackFonts } from "@/lib/pdf-engine/fallback";
import { interpretPage, type Matrix, type PageContent } from "@/lib/pdf-engine/interpreter";
import { buildBlocks, buildLines, type TextBlock } from "@/lib/pdf-engine/textmodel";

export type FontBytes = (key: FaceKey) => Promise<Uint8Array>;

export type NativeEdit =
  | { kind: "text"; block: string; newText: string; style?: StyleOverride; align?: "left" | "center" | "right" }
  | { kind: "image"; id: string; action: { type: "transform"; matrix: Matrix } | { type: "delete" } | { type: "replace"; dataUrl: string } };

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  fontClass: "sans" | "serif" | "mono";
  family: string;
  /** Font size in page units. */
  size: number;
  color: { r: number; g: number; b: number } | null;
}

export interface BlockInfo {
  /** The block's first line id: what an edit names it by. */
  id: string;
  text: string;
  /** The block's text in runs of one style, for showing it as it looks. */
  segments: TextSegment[];
  /** Per-line text and boxes (page space). */
  lines: { text: string; bbox: Box }[];
  bbox: Box;
  softWrapped: boolean;
  align: "left" | "center" | "right";
  width: number;
  maxWidth: number;
  leading: number;
  /** Baseline direction (page space) and where the first line's baseline starts. */
  angle: number;
  origin: { x: number; y: number };
  /** The block's left edge on its first baseline (what a text box over it is anchored to). */
  left: { x: number; y: number };
  size: number;
  editable: boolean;
  reason?: string;
}

export interface ImageInfo {
  id: string;
  bbox: Box;
  matrix: Matrix;
  pixelWidth: number;
  pixelHeight: number;
  inline: boolean;
  shared: boolean;
}

export interface PageAnalysis {
  blocks: BlockInfo[];
  images: ImageInfo[];
  /** Characters of visible text on the page. */
  textChars: number;
  /** A page with no real text and a picture covering most of it: a scan. */
  scanned: boolean;
}

export type ReplayResult = { ok: true } | { ok: false; index: number; reason: string };

function segmentsOf(block: TextBlock): TextSegment[] {
  const segs: TextSegment[] = [];
  const key = (s: TextSegment) => `${s.bold}|${s.italic}|${s.fontClass}|${s.family}|${s.size.toFixed(1)}|${s.color ? `${s.color.r.toFixed(2)},${s.color.g.toFixed(2)},${s.color.b.toFixed(2)}` : "-"}`;
  block.lines.forEach((line, li) => {
    if (li > 0) segs.push({ text: block.softWrapped ? " " : "\n", ...styleOf(line.slots[0]?.run, line) });
    for (const slot of line.slots) {
      const style = styleOf(slot.run, line);
      const last = segs[segs.length - 1];
      if (last && key(last) === key({ text: "", ...style })) last.text += slot.char;
      else segs.push({ text: slot.char, ...style });
    }
  });
  return segs;
}

function styleOf(run: { font: { bold: boolean; italic: boolean; fontClass: "sans" | "serif" | "mono"; family: string }; pageSize: number; color: { r: number; g: number; b: number } | null } | undefined, line: { style: { bold: boolean; italic: boolean; fontClass: "sans" | "serif" | "mono"; family: string; size: number; color: { r: number; g: number; b: number } | null } }): Omit<TextSegment, "text"> {
  if (!run) return { bold: line.style.bold, italic: line.style.italic, fontClass: line.style.fontClass, family: line.style.family, size: line.style.size, color: line.style.color };
  return { bold: run.font.bold, italic: run.font.italic, fontClass: run.font.fontClass, family: run.font.family, size: run.pageSize, color: run.color };
}

/** A page that is a picture of a page: a picture covers most of it and there is little real text (a heading over a scan counts). */
const SCAN_COVER = 0.6;
const SCAN_TEXT_LIMIT = 300;

export function analyzeContent(content: PageContent, pageArea?: number): PageAnalysis {
  const lines = buildLines(content.runs);
  const blocks = buildBlocks(lines);
  const textChars = content.runs.filter((r) => !r.invisible).reduce((n, r) => n + r.glyphs.filter((g) => g.unicode.trim()).length, 0);
  const infos: BlockInfo[] = blocks.map((b) => {
    const first = b.lines[0];
    const g0 = first.slots.find((s) => s.glyph)?.glyph;
    const origin = g0 ? { x: g0.x, y: g0.y } : { x: b.bbox.x, y: b.bbox.y };
    const minS0 = Math.min(...b.lines.map((l) => l.s0));
    return {
      id: first.id,
      text: b.text,
      segments: segmentsOf(b),
      lines: b.lines.map((l) => ({ text: l.text, bbox: l.bbox })),
      bbox: b.bbox,
      softWrapped: b.softWrapped,
      align: b.align,
      width: b.width,
      maxWidth: b.maxWidth,
      leading: b.leading,
      angle: Math.atan2(first.uy, first.ux),
      origin,
      left: { x: origin.x + (minS0 - first.s0) * first.ux, y: origin.y + (minS0 - first.s0) * first.uy },
      size: first.size,
      editable: b.lines.every((l) => l.editable) && !b.lines.some((l) => l.runs.some((r) => r.shared)),
      reason: b.lines.find((l) => !l.editable)?.reason ?? (b.lines.some((l) => l.runs.some((r) => r.shared)) ? "This text is part of a shared page element." : undefined),
    };
  });
  const images: ImageInfo[] = content.images.map((im) => ({ id: im.id, bbox: im.bbox, matrix: im.matrix, pixelWidth: im.pixelWidth, pixelHeight: im.pixelHeight, inline: im.inline, shared: im.shared }));
  return { blocks: infos, images, textChars, scanned: pageArea
      ? images.some((im) => im.bbox.width * im.bbox.height >= SCAN_COVER * pageArea) && textChars < SCAN_TEXT_LIMIT
      : textChars < 12 && images.some((im) => im.bbox.width * im.bbox.height > 0) };
}

export async function analyzeBytes(bytes: Uint8Array): Promise<PageAnalysis> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const page = doc.getPage(0);
  const { width, height } = page.getSize();
  return analyzeContent(interpretPage(page), width * height);
}

function findBlock(content: PageContent, id: string): TextBlock | undefined {
  const blocks = buildBlocks(buildLines(content.runs));
  return blocks.find((b) => b.lines[0].id === id) ?? blocks.find((b) => b.lines.some((l) => l.id === id));
}

function dataUrlBytes(url: string): { bytes: Uint8Array; mime: "image/png" | "image/jpeg" } {
  const [head, b64] = url.split(",");
  const mime = head.includes("png") ? "image/png" : "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

/** Replays `edits` on `page` (a page of `doc`). Stops at the first edit that can't be applied. */
export async function replayNativeEdits(doc: PDFDocument, page: PDFPage, edits: NativeEdit[], loadFont: FontBytes, fonts?: FallbackFonts): Promise<ReplayResult> {
  const env = { doc, page, fonts: fonts ?? new FallbackFonts(doc, loadFont) };
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const content = interpretPage(page, { fontsByRef: env.fonts.describedFonts() });
    if (edit.kind === "text") {
      const block = findBlock(content, edit.block);
      if (!block) return { ok: false, index: i, reason: "The text this edit was made to is no longer on the page." };
      const opts: EditOptions = { style: edit.style, align: edit.align };
      const res = await editBlock(env, content, block, edit.newText, opts);
      if (!res.ok && res.code !== "no-change") return { ok: false, index: i, reason: res.reason };
    } else {
      const im = content.images.find((p) => p.id === edit.id);
      if (!im) return { ok: false, index: i, reason: "The picture this edit was made to is no longer on the page." };
      const a = edit.action;
      const res = a.type === "delete" ? deleteImage(page, content, im) : a.type === "transform" ? placeImage(page, content, im, transformedPlacement(im, a.matrix)) : await replaceImage(doc, page, content, im, dataUrlBytes(a.dataUrl));
      // a new picture is only written into the document when it is flushed; the next edit has to see it
      if (a.type === "replace") await doc.flush();
      if (!res.ok) return { ok: false, index: i, reason: res.reason };
    }
  }
  return { ok: true };
}

export interface WorkingPage {
  /** A one-page PDF: the source page with the edits applied. */
  bytes: Uint8Array;
  analysis: PageAnalysis;
  /** Form values / appearances were written into `bytes`. */
  formsApplied: boolean;
}

export type WorkingResult = { ok: true; page: WorkingPage } | { ok: false; index: number; reason: string };

const sourceDocs = new WeakMap<File, Promise<PDFDocument>>();
function sourceDoc(file: File): Promise<PDFDocument> {
  let p = sourceDocs.get(file);
  if (!p) {
    p = file.arrayBuffer().then((b) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false }));
    sourceDocs.set(file, p);
  }
  return p;
}

/** Edits already replayed, by the key of the page and of the edit list so far — a new edit continues from there. */
const prefixCache = new Map<string, Uint8Array>();
const PREFIX_LIMIT = 40;

export const editKey = (e: NativeEdit) => JSON.stringify(e);

/**
 * The working page for `edits` on page `pageIndex` of `file`. Reuses the longest already-computed prefix of the edit list, so
 * adding one edit costs one edit, and undo (a shorter list) is a cache hit.
 */
export async function buildWorkingPage(file: File, fileKey: string, pageIndex: number, edits: NativeEdit[], loadFont: FontBytes, forms: FormFieldValue[] = []): Promise<WorkingResult> {
  const base = `${fileKey}:${pageIndex}`;
  const keys = edits.map(editKey);
  let start = 0;
  let startBytes: Uint8Array | null = null;
  for (let k = edits.length; k >= 1; k--) {
    const hit = prefixCache.get(`${base}|${keys.slice(0, k).join("|")}`);
    if (hit) {
      start = k;
      startBytes = hit;
      break;
    }
  }
  let out: PDFDocument;
  if (startBytes) out = await PDFDocument.load(startBytes, { ignoreEncryption: true, updateMetadata: false });
  else {
    const src = await sourceDoc(file);
    out = await PDFDocument.create();
    const [copied] = await out.copyPages(src, [pageIndex]);
    out.addPage(copied);
  }
  const remaining = edits.slice(start);
  if (remaining.length) {
    const res = await replayNativeEdits(out, out.getPage(0), remaining, loadFont);
    if (!res.ok) return { ok: false, index: start + res.index, reason: res.reason };
  }
  const bytes = await out.save();
  if (remaining.length) {
    prefixCache.set(`${base}|${keys.join("|")}`, bytes);
    if (prefixCache.size > PREFIX_LIMIT) prefixCache.delete(prefixCache.keys().next().value as string);
  }
  const analysis = await analyzeBytes(bytes);
  if (!forms.length) return { ok: true, page: { bytes, analysis, formsApplied: false } };
  // the fields on this page, with their values and appearances, written the way the export writes them
  const withForms = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  await applyFormState(withForms, withForms.getPage(0), forms);
  return { ok: true, page: { bytes: await withForms.save({ updateFieldAppearances: false }), analysis, formsApplied: true } };
}

export { boxTransform };
