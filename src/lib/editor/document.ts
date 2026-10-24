import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, type PDFField } from "pdf-lib";
import { appearanceText, hasNormalAppearance, needAppearances, radioLabel, widgetStyle } from "./formPdf";
import { generateUuidV4 } from "@/lib/id";
import type { EditorDocument, EditorPage, FormFieldValue, FormWidget } from "./types";
import type { Rotation } from "./coordinates";
import { EncryptedPdfError, loadPdfForEditing } from "@/lib/pdf/load";

export class EditorDocumentError extends Error {}

function normalizeRotation(angle: number): Rotation {
  const r = ((angle % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

async function parsePdf(file: File): Promise<PDFDocument> {
  const bytes = await file.arrayBuffer();
  try {
    return await loadPdfForEditing(bytes);
  } catch (e) {
    if (e instanceof EncryptedPdfError) throw new EditorDocumentError(e.message);
    throw new EditorDocumentError("We couldn't read this PDF. It may be damaged, encrypted, or incomplete.");
  }
}

type Box = { x: number; y: number; width: number; height: number };

/** MediaBox ∩ CropBox (pdf-lib's getCropBox already falls back to the MediaBox when none is set). */
export function visiblePageBox(media: Box, crop: Box): Box {
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  if (x1 - x0 < 1 || y1 - y0 < 1) return media; // a degenerate CropBox: ignore it
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function pagesFromParsedDoc(parsed: PDFDocument, sourceFileId: string): EditorPage[] {
  return parsed.getPages().map((p, i) => {
    // The visible page area, not the raw MediaBox: pdf.js renders (and every viewer shows) the
    // CropBox where there is one. Using the MediaBox here put every overlay — text regions, search
    // highlights, objects — out of line with the rendered page for any PDF that carries a CropBox,
    // including one exported from this editor after a crop.
    const box = visiblePageBox(p.getMediaBox(), p.getCropBox());
    return {
      id: generateUuidV4(),
      sourceFileId,
      sourcePageIndex: i,
      baseRotation: normalizeRotation(p.getRotation().angle),
      rotationDelta: 0 as Rotation,
      mediaBox: [box.x, box.y, box.x + box.width, box.y + box.height],
    };
  });
}

/** Best-effort form field inventory — only fields pdf-lib can identify and read a
 * current value for are listed; anything unusual is skipped rather than failing. */
function widgetsOf(parsed: PDFDocument, field: PDFField, sourceFileId: string): FormWidget[] {
  const out: FormWidget[] = [];
  const pages = parsed.getPages();
  for (const w of field.acroField.getWidgets()) {
    let pageIndex = pages.findIndex((p) => p.ref === w.P());
    if (pageIndex < 0) {
      pageIndex = pages.findIndex((p) => (p.node.Annots()?.asArray() ?? []).some((r) => parsed.context.lookup(r) === w.dict));
    }
    if (pageIndex < 0) continue;
    const r = w.getRectangle();
    let onValue: string | undefined;
    try {
      const state = w.getOnValue()?.decodeText();
      onValue = state === undefined ? undefined : radioLabel(w.dict, state);
    } catch {
      onValue = undefined;
    }
    const st = widgetStyle(w.dict, parsed);
    out.push({ sourceFileId, pageIndex, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, onValue, style: { fontSize: st.fontSize, family: st.family, color: st.color, align: st.align, borderWidth: st.borderWidth, background: st.background, borderColor: st.borderColor, rotation: st.rotation } });
  }
  return out;
}

/** The file's appearance of a text or choice field can't be trusted: it is missing, the form asks viewers to redraw
 * (/NeedAppearances), or it draws something other than the field's value. */
function staleAppearance(parsed: PDFDocument, field: PDFField, value: string): boolean {
  const widgets = field.acroField.getWidgets();
  if (!widgets.length) return false;
  if (needAppearances(parsed)) return true;
  const norm = (t: string) => t.replace(/\s+/g, "");
  return widgets.some((w) => {
    if (!hasNormalAppearance(w.dict)) return value !== "";
    const drawn = appearanceText(w.dict);
    return drawn !== null && norm(drawn) !== norm(value);
  });
}

function extractFormFields(parsed: PDFDocument, sourceFileId: string): FormFieldValue[] {
  const fields: FormFieldValue[] = [];
  try {
    const form = parsed.getForm();
    for (const field of form.getFields()) {
      const name = field.getName();
      try {
        const common = { name, widgets: widgetsOf(parsed, field, sourceFileId), readOnly: field.isReadOnly() };
        if (field instanceof PDFTextField) {
          const value = field.getText() ?? "";
          const ff = field.acroField.getFlags();
          const unsupported = field.isPassword() ? "password field" : field.isCombed() ? "comb field" : field.isRichFormatted() ? "formatted (rich text) field" : common.widgets.some((w) => w.style?.rotation) ? "rotated field" : undefined;
          void ff;
          fields.push({ ...common, kind: "text", value, initial: value, multiline: field.isMultiline(), maxLength: field.getMaxLength(), regen: staleAppearance(parsed, field, value), unsupported });
        } else if (field instanceof PDFCheckBox) {
          const value = field.isChecked() ? "true" : "false";
          fields.push({ ...common, kind: "checkbox", value, initial: value });
        } else if (field instanceof PDFRadioGroup) {
          const value = field.getSelected() ?? "";
          fields.push({ ...common, kind: "radio", value, initial: value, options: field.getOptions() });
        } else if (field instanceof PDFDropdown) {
          const selected: string[] = field.getSelected() ?? [];
          const dropValue = selected[0] ?? "";
          const unsupported = field.isEditable() ? "editable (type-in) dropdown" : common.widgets.some((w) => w.style?.rotation) ? "rotated field" : undefined;
          fields.push({ ...common, kind: "dropdown", value: dropValue, initial: dropValue, options: field.getOptions(), regen: staleAppearance(parsed, field, dropValue), unsupported });
        }
      } catch {
        // A field pdf-lib can enumerate but not read cleanly — skip it rather than fail
        // loading the whole document.
      }
    }
  } catch {
    // No AcroForm on this document.
  }
  return fields;
}

/** Cheap heuristic for "this PDF may already carry a digital signature" — pdf-lib has no
 * first-class signature API, so we look for the standard signature-field/byte-range
 * markers in the raw bytes. False positives/negatives are possible; this only ever
 * produces a warning, never blocks editing. */
export async function likelyHasDigitalSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  return text.includes("/ByteRange") && (text.includes("/Type/Sig") || text.includes("/Type /Sig"));
}

export async function loadEditorDocument(file: File): Promise<EditorDocument> {
  const parsed = await parsePdf(file);
  const sourceFileId = generateUuidV4();
  return {
    sourceFiles: { [sourceFileId]: file },
    pages: pagesFromParsedDoc(parsed, sourceFileId),
    objects: [],
    formFields: extractFormFields(parsed, sourceFileId),
  };
}

/** Appends every page of `file` to the document, either at the end or after a given page. */
export async function insertFilePages(
  doc: EditorDocument,
  file: File,
  afterPageId?: string
): Promise<EditorDocument> {
  const parsed = await parsePdf(file);
  const sourceFileId = generateUuidV4();
  const newPages = pagesFromParsedDoc(parsed, sourceFileId);

  let pages: EditorPage[];
  if (afterPageId) {
    const index = doc.pages.findIndex((p) => p.id === afterPageId);
    pages = index === -1 ? [...doc.pages, ...newPages] : [
      ...doc.pages.slice(0, index + 1),
      ...newPages,
      ...doc.pages.slice(index + 1),
    ];
  } else {
    pages = [...doc.pages, ...newPages];
  }

  return { ...doc, sourceFiles: { ...doc.sourceFiles, [sourceFileId]: file }, pages };
}

export function duplicatePage(doc: EditorDocument, pageId: string): EditorDocument {
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index === -1) return doc;
  const original = doc.pages[index];
  const copy: EditorPage = { ...original, id: generateUuidV4() };
  const pages = [...doc.pages.slice(0, index + 1), copy, ...doc.pages.slice(index + 1)];

  // Duplicate any objects on that page too, so the copy looks the same until edited.
  const copiedObjects = doc.objects
    .filter((o) => o.pageId === pageId)
    .map((o) => ({ ...o, id: generateUuidV4(), pageId: copy.id }));

  return { ...doc, pages, objects: [...doc.objects, ...copiedObjects] };
}

export function deletePage(doc: EditorDocument, pageId: string): EditorDocument {
  if (doc.pages.length <= 1) {
    throw new EditorDocumentError("You can't delete every page.");
  }
  return {
    ...doc,
    pages: doc.pages.filter((p) => p.id !== pageId),
    objects: doc.objects.filter((o) => o.pageId !== pageId),
  };
}

export function reorderPages(doc: EditorDocument, orderedPageIds: string[]): EditorDocument {
  const byId = new Map(doc.pages.map((p) => [p.id, p]));
  const pages = orderedPageIds.map((id) => byId.get(id)).filter((p): p is EditorPage => Boolean(p));
  if (pages.length !== doc.pages.length) return doc; // malformed order — ignore rather than corrupt state
  return { ...doc, pages };
}

export function rotatePage(doc: EditorDocument, pageId: string, delta: 90 | -90): EditorDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => {
      if (p.id !== pageId) return p;
      const total = (((p.rotationDelta + delta) % 360) + 360) % 360;
      return { ...p, rotationDelta: total as Rotation };
    }),
  };
}

/** Sets or clears a page's crop box (in its own unrotated MediaBox coordinate space, same
 * convention as `EditorPage.mediaBox`). Cropping never rasterizes or re-encodes page
 * content — it only narrows the visible/printable region via the PDF CropBox, exactly like
 * `page.setCropBox()` in export.ts. */
export function setPageCropBox(
  doc: EditorDocument,
  pageId: string,
  cropBox: [number, number, number, number] | null
): EditorDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === pageId ? { ...p, cropBox: cropBox ?? undefined } : p)),
  };
}

/** Applies the same absolute crop box to every page — a reasonable simplification for the
 * common case of a document whose pages share one size; pages it wouldn't visually make
 * sense for (crop box outside that page's own MediaBox) are left untouched. */
export function setCropBoxForAllPages(
  doc: EditorDocument,
  cropBox: [number, number, number, number]
): EditorDocument {
  const [cx0, cy0, cx1, cy1] = cropBox;
  return {
    ...doc,
    pages: doc.pages.map((p) => {
      const [mx0, my0, mx1, my1] = p.mediaBox;
      const fits = cx0 >= mx0 && cy0 >= my0 && cx1 <= mx1 && cy1 <= my1;
      return fits ? { ...p, cropBox } : p;
    }),
  };
}

export async function insertBlankPage(
  doc: EditorDocument,
  afterPageId: string | undefined,
  size: { width: number; height: number } = { width: 612, height: 792 }
): Promise<EditorDocument> {
  const blank = await PDFDocument.create();
  blank.addPage([size.width, size.height]);
  const bytes = await blank.save();
  const file = new File([bytes as BlobPart], "blank-page.pdf", { type: "application/pdf" });
  return insertFilePages(doc, file, afterPageId);
}
