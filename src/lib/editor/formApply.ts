/**
 * Writes the editor's form state into a page of a PDF document: the field values, and the appearances that show them.
 *
 * Used for both the page the editor draws and the file it exports, so the two cannot differ. Appearances are written here, from
 * the field's own /DA, /Q, /MK and border, rather than left to whichever viewer opens the file — a viewer that redraws
 * (/NeedAppearances) gets the same picture.
 *
 *  - text / dropdown: /V and a new /AP /N (fill, border, the value laid out by `layoutFormText`)
 *  - checkbox / radio: /V and /AS select among the appearance states the file already has
 *
 * A field is only touched when its value changed, or when its appearance can't be trusted (`regen`).
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFPage, PDFRef, StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib";
import { layoutFormText, formPadding, type FormFamily } from "./formLayout";
import { fieldDictOf, qualifiedName, radioLabel, widgetStyle, widgetsOnPage } from "./formPdf";
import type { FormFieldValue } from "./types";

const N = (s: string) => PDFName.of(s);

const STANDARD: Record<FormFamily, StandardFonts> = { sans: StandardFonts.Helvetica, serif: StandardFonts.TimesRoman, mono: StandardFonts.Courier };
const fontCache = new WeakMap<PDFDocument, Promise<Record<FormFamily, PDFFont>>>();

/** The three standard fonts embedded in `doc` (once). */
export function standardFormFonts(doc: PDFDocument): Promise<Record<FormFamily, PDFFont>> {
  let p = fontCache.get(doc);
  if (!p) {
    p = (async () => ({ sans: await doc.embedFont(STANDARD.sans), serif: await doc.embedFont(STANDARD.serif), mono: await doc.embedFont(STANDARD.mono) }))();
    fontCache.set(doc, p);
  }
  return p;
}

let scratchFonts: Promise<Record<FormFamily, PDFFont>> | null = null;
/** Width of text in the standard fonts, for laying out a field in the browser (no document needed). */
export async function formMeasure(): Promise<(family: FormFamily, text: string, size: number) => number> {
  if (!scratchFonts) {
    scratchFonts = (async () => {
      const { PDFDocument } = await import("pdf-lib");
      return standardFormFonts(await PDFDocument.create());
    })();
  }
  const fonts = await scratchFonts;
  return (family, text, size) => {
    try {
      return fonts[family].widthOfTextAtSize(text, size);
    } catch {
      return fonts[family].widthOfTextAtSize(text.replace(/[^\x20-\x7e]/g, "?"), size);
    }
  };
}

const num = (n: number) => (Math.round(n * 1000) / 1000).toString();
const rgbOp = (c: { r: number; g: number; b: number }, op: "rg" | "RG") => `${num(c.r)} ${num(c.g)} ${num(c.b)} ${op}`;

function safeText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.widthOfTextAtSize(ch, 1);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function rectOf(widget: PDFDict): { width: number; height: number } {
  const r = widget.context.lookup(widget.get(N("Rect")));
  const a = r instanceof PDFArray ? r.asArray().map((x) => (widget.context.lookup(x) as PDFNumber).asNumber()) : [0, 0, 0, 0];
  return { width: Math.abs(a[2] - a[0]), height: Math.abs(a[3] - a[1]) };
}

/** The appearance stream of a text-like field, as a registered form XObject. */
export async function writeTextAppearance(doc: PDFDocument, widget: PDFDict, value: string, opts: { multiline: boolean }): Promise<PDFRef> {
  const fonts = await standardFormFonts(doc);
  const style = widgetStyle(widget, doc);
  const { width, height } = rectOf(widget);
  const font = fonts[style.family];
  const text = safeText(font, value);
  const lay = layoutFormText({ width, height, value: text, multiline: opts.multiline, fontSize: style.fontSize, family: style.family, align: style.align, borderWidth: style.borderWidth, measure: (t, s) => font.widthOfTextAtSize(t, s) });
  const ops: string[] = ["/Tx BMC", "q"];
  if (style.background) ops.push(rgbOp(style.background, "rg"), `0 0 ${num(width)} ${num(height)} re f`);
  if (style.borderColor && style.borderWidth > 0) {
    const bw = style.borderWidth;
    ops.push(rgbOp(style.borderColor, "RG"), `${num(bw)} w`, `${num(bw / 2)} ${num(bw / 2)} ${num(width - bw)} ${num(height - bw)} re S`);
  }
  const pad = formPadding(style.borderWidth);
  ops.push("Q", "q", `${num(pad)} ${num(pad)} ${num(Math.max(1, width - 2 * pad))} ${num(Math.max(1, height - 2 * pad))} re W n`, "BT", `/TFCF ${num(lay.fontSize)} Tf`, rgbOp(style.color, "rg"));
  for (const line of lay.lines) {
    if (!line.text) continue;
    ops.push(`1 0 0 1 ${num(line.x)} ${num(line.baseline)} Tm`, `${font.encodeText(line.text).toString()} Tj`);
  }
  ops.push("ET", "Q", "EMC");
  const stream = doc.context.stream(ops.join("\n"), {
    Type: "XObject",
    Subtype: "Form",
    FormType: 1,
    BBox: [0, 0, width, height],
    Resources: { Font: { TFCF: font.ref } },
  });
  return doc.context.register(stream);
}

function onStateOf(widget: PDFDict): PDFName | undefined {
  const ctx = widget.context;
  const ap = ctx.lookup(widget.get(N("AP")));
  const n = ap instanceof PDFDict ? ctx.lookup(ap.get(N("N"))) : undefined;
  if (!(n instanceof PDFDict)) return undefined;
  return n.keys().find((k) => k !== N("Off"));
}

export async function applyFormState(doc: PDFDocument, page: PDFPage, fields: FormFieldValue[]): Promise<void> {
  const byName = new Map(fields.map((f) => [f.name, f]));
  for (const widget of widgetsOnPage(page)) {
    const name = qualifiedName(widget);
    const f = byName.get(name);
    if (!f) continue;
    const changed = f.value !== f.initial;
    const fd = fieldDictOf(widget);
    if (f.kind === "text" || f.kind === "dropdown") {
      if (f.unsupported || !(changed || f.regen)) continue;
      if (changed) fd.set(N("V"), PDFHexString.fromText(f.value));
      const multiline = f.kind === "text" && (f.multiline ?? false);
      const ref = await writeTextAppearance(doc, widget, f.value, { multiline });
      const ap = doc.context.obj({ N: ref });
      widget.set(N("AP"), ap);
    } else if (f.kind === "checkbox") {
      if (!changed) continue;
      const on = onStateOf(widget) ?? N("Yes");
      const state = f.value === "true" ? on : N("Off");
      widget.set(N("AS"), state);
      fd.set(N("V"), state);
    } else if (f.kind === "radio") {
      if (!changed) continue;
      const on = onStateOf(widget);
      const mine = on ? radioLabel(widget, on.decodeText()) : undefined;
      const selected = mine !== undefined && mine === f.value;
      widget.set(N("AS"), selected && on ? on : N("Off"));
      // the group's value is set once, by whichever widget is the selected one (or Off)
      if (selected && on) fd.set(N("V"), on);
      else if (f.value === "") fd.set(N("V"), N("Off"));
    }
  }
}

/** After every field that needed one has its own appearance, viewers need not (and must not) redraw them. */
export function clearNeedAppearances(doc: PDFDocument): void {
  const acro = doc.catalog.lookup(N("AcroForm"));
  if (acro instanceof PDFDict) acro.delete(N("NeedAppearances"));
}
