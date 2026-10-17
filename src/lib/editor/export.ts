import { savePdfChecked } from "@/lib/pdf/save";
import { PDFDocument, PDFDict, PDFName, PDFRef, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import type { EditorDocument, EditorObject, RgbColor } from "./types";
import { effectiveRotation } from "./types";
import { wrapText, lineBaselineY, sanitizeForFont } from "./textLayout";
import { arrowHead, drawingPdfPoints, lineEndpoints, annotationLineThickness } from "./shapeGeometry";
import { DESCENT_SHARE } from "./nativeText";
import { contentFrame } from "./contentFrame";
import { correctionsInLayer, drawOcrTextLayer, type Rect } from "./searchLayer";
import type { OcrPageResult } from "@/lib/processors/ocr";
import { loadPdfForEditing } from "@/lib/pdf/load";

export class EditorExportError extends Error {}

/** `PDFDocument.copyPages` deep-copies a page's widget annotations (and, transitively, the
 * AcroForm field dicts they point to via /Parent) into the destination document's object
 * graph, but it does NOT register those field dicts in the destination's AcroForm /Fields
 * array — so `out.getForm()` sees an empty form even though all the field data is really
 * there. This walks each copied widget up to its root field (via /Parent) and registers
 * that root with the destination AcroForm, so copied form fields stay fillable. */
function reconnectFormFields(out: PDFDocument, copiedPage: PDFPage, seen: Set<string>) {
  const annots = copiedPage.node.Annots();
  if (!annots) return;
  const acroForm = out.catalog.getOrCreateAcroForm();
  for (let i = 0; i < annots.size(); i++) {
    const annotRef = annots.get(i);
    if (!(annotRef instanceof PDFRef)) continue;
    let ref: PDFRef = annotRef;
    let dict = out.context.lookup(ref);
    while (dict instanceof PDFDict && dict.has(PDFName.of("Parent"))) {
      const parentRef = dict.get(PDFName.of("Parent"));
      if (!(parentRef instanceof PDFRef)) break;
      ref = parentRef;
      dict = out.context.lookup(ref);
    }
    if (seen.has(ref.toString())) continue;
    seen.add(ref.toString());
    acroForm.addField(ref);
  }
}

function toPdfLibColor(c: RgbColor) {
  return rgb(c.r, c.g, c.b);
}

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Draws a whiteout rectangle over a region — used both by the standalone Whiteout tool
 * and internally to visually cover text being replaced. This never removes the
 * underlying content from the file, only draws over it; see docs/EDITOR.md. */
function drawWhiteoutRect(page: PDFPage, x: number, y: number, width: number, height: number) {
  page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1) });
}

/** Freehand strokes and shape edges are drawn as a sequence of straight `drawLine`
 * segments (with small circles at the joints for a smoother look) rather than via
 * `drawSvgPath` — pdf-lib's SVG path drawing silently flips the Y axis to match SVG's
 * y-down convention, which is an easy sign error to get backwards; plain `drawLine` takes
 * coordinates in the same y-up PDF space as everything else in this file, so there's only
 * one coordinate convention to reason about anywhere in the export code. */
function drawPolyline(page: PDFPage, points: { x: number; y: number }[], color: RgbColor, strokeWidth: number) {
  const pdfColor = toPdfLibColor(color);
  for (let i = 0; i < points.length - 1; i++) {
    page.drawLine({ start: points[i], end: points[i + 1], thickness: strokeWidth, color: pdfColor });
  }
  if (strokeWidth > 1.5) {
    for (const p of points) {
      page.drawEllipse({ x: p.x, y: p.y, xScale: strokeWidth / 2, yScale: strokeWidth / 2, color: pdfColor });
    }
  }
}

function drawArrow(
  page: PDFPage,
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
  color: RgbColor,
  strokeWidth: number
) {
  const pdfColor = toPdfLibColor(color);
  page.drawLine({ start, end, thickness: strokeWidth, color: pdfColor });
  const { left, right } = arrowHead(start, end, width, height);
  page.drawLine({ start: end, end: left, thickness: strokeWidth, color: pdfColor });
  page.drawLine({ start: end, end: right, thickness: strokeWidth, color: pdfColor });
}

/** Sizes text to fit inside a box: primarily by height (matches normal reading size),
 * clamped so an unusually short/long replacement string doesn't blow up or vanish. */
function fitFontSize(font: PDFFont, text: string, box: { width: number; height: number }, requestedSize?: number): number {
  if (requestedSize) return requestedSize;
  const heightEstimate = Math.max(6, box.height * 0.8);
  const naturalWidth = font.widthOfTextAtSize(text || " ", heightEstimate);
  if (naturalWidth <= box.width || box.width <= 0) return heightEstimate;
  const scaled = heightEstimate * (box.width / naturalWidth);
  return Math.max(4, scaled);
}

/** How far a replacement word's bounding box may grow past its original OCR box before
 * export gives up shrinking further and just lets it slightly overflow — this mirrors the
 * "shrink first, then tolerate a small overflow rather than silently covering neighboring
 * content" rule from the properties-panel warning shown when the text doesn't fit. */
const MAX_WIDTH_GROWTH_FACTOR = 1.15;
/** Never shrink an OCR replacement below this fraction of its natural (bbox-height-based)
 * size — past that point a slight rightward overflow is safer/more legible than text so
 * small it's illegible, and the properties panel already warned the user this word's
 * replacement is wider than the original. */
const MIN_SHRINK_FACTOR = 0.7;

/** Like fitFontSize, but tuned for word-level OCR replacements: a tight word box has much
 * less slack than a whole line, so a longer replacement (e.g. "182.50" -> "1,282.50") is
 * allowed to grow the effective box a little before the font shrinks, and shrinking stops
 * at a legibility floor rather than continuing indefinitely for very long replacements. */
function fitOcrReplacementFontSize(
  font: PDFFont,
  text: string,
  box: { width: number; height: number },
  requestedSize?: number
): number {
  if (requestedSize) return requestedSize;
  // A word-level OCR box is tight to the glyphs' own ink (digits and capitals have no
  // ascender/descender beyond cap-height), so it reads as noticeably smaller than the
  // surrounding text's real font size if treated as the font size directly. Helvetica's
  // published cap-height is ~718/1000 em (Adobe AFM), so a tight cap/digit-height box
  // implies a font size of roughly box.height / 0.718 to visually match neighboring text
  // at the same nominal size — much closer than treating the box height as the size itself.
  const HELVETICA_CAP_HEIGHT_RATIO = 0.718;
  const heightEstimate = Math.max(6, box.height / HELVETICA_CAP_HEIGHT_RATIO);
  const naturalWidth = font.widthOfTextAtSize(text || " ", heightEstimate);
  const allowedWidth = box.width * MAX_WIDTH_GROWTH_FACTOR;
  if (naturalWidth <= allowedWidth || allowedWidth <= 0) return heightEstimate;
  const floor = heightEstimate * MIN_SHRINK_FACTOR;
  const scaled = heightEstimate * (allowedWidth / naturalWidth);
  return Math.max(floor, scaled);
}

async function drawObject(
  page: PDFPage,
  obj: EditorObject,
  doc: PDFDocument,
  fonts: Fonts,
  imageCache: Map<string, unknown>,
  /** Corrections whose text is already in the page's OCR text layer (no second searchable run). */
  inTextLayer: Set<EditorObject> = new Set(),
  /** Filled with the corrections drawn as visible vector text (already searchable as they are). */
  drawnAsText: Set<EditorObject> = new Set()
): Promise<void> {
  switch (obj.type) {
    case "native-text-replacement": {
      page.drawRectangle({ x: obj.x, y: obj.y, width: obj.width, height: obj.height, color: toPdfLibColor(obj.backgroundColor ?? { r: 1, g: 1, b: 1 }) });
      if (!obj.newText.trim()) break;
      const font = fonts.regular;
      const size = fitFontSize(font, obj.newText, obj, obj.fontSize);
      try {
        // Real (visible) text, so the correction is already searchable and copyable — a second
        // invisible copy would make every search/copy of this text appear twice.
        // Same baseline as the text it replaces (the region box extends below it for descenders).
        page.drawText(obj.newText, { x: obj.x + 0.5, y: obj.y + obj.height * DESCENT_SHARE, size, font, color: toPdfLibColor(obj.color) });
      } catch {
        // A character outside Helvetica's supported encoding shouldn't fail the whole
        // export — the region is still whited out, just without replacement text drawn.
      }
      break;
    }

    case "ocr-text-replacement": {
      // Primary path: embed the raster patch composed in the browser (see scanPatch.ts) —
      // a real background-texture clone plus the replacement rendered in a locally
      // font-matched typeface at render resolution — as an *image*, not vector PDF text, so
      // the visible result matches the scan's own look rather than a generic PDF font. This
      // covers exactly (obj.x, obj.y, obj.width, obj.height); no separate rectangle/text
      // drawing needed for this path.
      // The patch and text are laid out in the word's own frame: on a scan shown rotated (e.g. stored
      // sideways with /Rotate 90) that frame is turned so the correction reads like the scan does.
      const frame = contentFrame(obj, obj.rotation);
      const rot = degrees(frame.rotation);
      let patchEmbedded = false;
      if (obj.patchDataUrl) {
        try {
          const bytes = await dataUrlToBytes(obj.patchDataUrl);
          const embedded = await doc.embedPng(bytes);
          const at = frame.toPdf(0, 0);
          page.drawImage(embedded, { x: at.x, y: at.y, width: frame.width, height: frame.height, rotate: rot });
          patchEmbedded = true;
        } catch {
          // Fall through to the legacy vector path below — e.g. a corrupt/oversized data
          // URL from a much older saved session.
        }
      }

      // Legacy/fallback path: used for objects saved before the raster-patch pipeline
      // existed, for a manual "place as overlay" choice (skips the background rectangle
      // entirely so nothing underneath is destructively covered), and for a manual
      // font-size/color override from the properties panel (which clears patchDataUrl so
      // the override actually has a visible effect — see PropertiesPanel.tsx).
      if (!patchEmbedded) {
        const font = fonts.regular;
        const size = fitOcrReplacementFontSize(font, obj.newText, frame, obj.fontSize);
        if (!obj.overlayOnly) {
          // The original word's OCR box is tight to *its own* glyphs — if it had no
          // descenders (e.g. "Smith") but the replacement does (e.g. "Rodriguez" -> the
          // "g"), the new glyph would hang below the patch and show over whatever wasn't
          // covered. Reserving descender room unconditionally (rather than only when the
          // OCR box measured one) is cheap and safe: the patch already matches the local
          // background color, so a slightly taller patch doesn't introduce a visible seam.
          const descenderAllowance = size * 0.28;
          page.drawRectangle({ ...frame.rectToPdf(0, -descenderAllowance, frame.width, frame.height + descenderAllowance), color: toPdfLibColor(obj.backgroundColor) });
        }
        if (obj.newText.trim()) {
          try {
            const at = frame.toPdf(0, 0);
            page.drawText(obj.newText, { x: at.x, y: at.y, size, font, color: toPdfLibColor(obj.textColor), rotate: rot });
            drawnAsText.add(obj);
          } catch {
            // A character outside Helvetica's supported encoding shouldn't fail the whole
            // export — the region still shows the patch/original scan, just without
            // replacement text drawn.
          }
        }
      }

      // Keep the page searchable after a correction either way: an invisible run with the
      // *full* corrected word — unless the page's OCR text layer already carries it (searchLayer.ts),
      // which would make the word appear twice in a search. Positioned/sized from
      // searchAnchor (the whole word's own box) rather than (obj.x, obj.y, obj.width,
      // obj.height) — since a micro-edit's visible patch is now tight to just the changed
      // characters, sizing the invisible run to that same tiny box would squeeze the whole
      // word's search text into it instead of the word's actual full span.
      if (obj.newText.trim() && !inTextLayer.has(obj) && !drawnAsText.has(obj)) {
        const anchorFrame = contentFrame(obj.searchAnchor ?? obj, obj.rotation);
        try {
          const size = fitOcrReplacementFontSize(fonts.regular, obj.newText, anchorFrame, obj.fontSize);
          const at = anchorFrame.toPdf(0, 0);
          page.drawText(obj.newText, { x: at.x, y: at.y, size, font: fonts.regular, opacity: 0, rotate: degrees(anchorFrame.rotation) });
        } catch {
          // Same non-fatal handling as above — searchability is a bonus, not required for
          // the visible correction to be correct.
        }
      }
      break;
    }

    case "added-text": {
      const font = obj.bold ? fonts.bold : fonts.regular;
      const size = obj.fontSize;
      const canEncode = (ch: string) => {
        try {
          font.widthOfTextAtSize(ch, 1);
          return true;
        } catch {
          return false;
        }
      };
      const text = sanitizeForFont(obj.text, canEncode);
      const measure = (t: string) => font.widthOfTextAtSize(t, size);
      // Laid out in the text's own frame (upright for text placed on a page shown rotated).
      const frame = contentFrame(obj, obj.rotation);
      const lines = wrapText(text, frame.width, measure);
      lines.forEach((line, i) => {
        if (!line) return;
        let u = 0;
        if (obj.align !== "left") {
          const lineWidth = measure(line);
          u = obj.align === "center" ? (frame.width - lineWidth) / 2 : frame.width - lineWidth;
        }
        const at = frame.toPdf(u, lineBaselineY(frame.height, size, i));
        try {
          page.drawText(line, { x: at.x, y: at.y, size, font, color: toPdfLibColor(obj.color), rotate: degrees(frame.rotation) });
        } catch {
          // Shouldn't happen after sanitizing, but one bad line shouldn't fail the export.
        }
      });
      break;
    }

    case "image":
    case "signature": {
      const bytes = await dataUrlToBytes(obj.dataUrl);
      const isPng = obj.dataUrl.startsWith("data:image/png");
      const embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const frame = contentFrame(obj, obj.rotation);
      const at = frame.toPdf(0, 0);
      page.drawImage(embedded, { x: at.x, y: at.y, width: frame.width, height: frame.height, rotate: degrees(frame.rotation) });
      break;
    }

    case "drawing":
      // Scaled to the object's current box, so a resized drawing exports the size it shows.
      drawPolyline(page, drawingPdfPoints(obj), obj.color, obj.strokeWidth);
      break;

    case "shape": {
      const strokeColor = toPdfLibColor(obj.strokeColor);
      const fillColor = obj.fillColor ? toPdfLibColor(obj.fillColor) : undefined;
      if (obj.shape === "rectangle") {
        page.drawRectangle({
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          borderColor: strokeColor,
          borderWidth: obj.strokeWidth,
          color: fillColor,
        });
      } else if (obj.shape === "ellipse") {
        page.drawEllipse({
          x: obj.x + obj.width / 2,
          y: obj.y + obj.height / 2,
          xScale: obj.width / 2,
          yScale: obj.height / 2,
          borderColor: strokeColor,
          borderWidth: obj.strokeWidth,
          color: fillColor,
        });
      } else if (obj.shape === "line") {
        const { start, end } = lineEndpoints(obj);
        page.drawLine({ start, end, thickness: obj.strokeWidth, color: strokeColor });
      } else if (obj.shape === "arrow") {
        const { start, end } = lineEndpoints(obj);
        drawArrow(page, start, end, obj.width, obj.height, obj.strokeColor, obj.strokeWidth);
      }
      break;
    }

    case "whiteout":
      drawWhiteoutRect(page, obj.x, obj.y, obj.width, obj.height);
      break;

    case "annotation": {
      const color = toPdfLibColor(obj.color);
      if (obj.kind === "highlight") {
        page.drawRectangle({ x: obj.x, y: obj.y, width: obj.width, height: obj.height, color, opacity: 0.35 });
      } else if (obj.kind === "underline") {
        page.drawLine({
          start: { x: obj.x, y: obj.y },
          end: { x: obj.x + obj.width, y: obj.y },
          thickness: annotationLineThickness(obj.height),
          color,
        });
      } else if (obj.kind === "strikethrough") {
        const midY = obj.y + obj.height / 2;
        page.drawLine({
          start: { x: obj.x, y: midY },
          end: { x: obj.x + obj.width, y: midY },
          thickness: annotationLineThickness(obj.height),
          color,
        });
      }
      break;
    }
  }
  void imageCache; // reserved for future de-duplication of repeated images; not needed yet
}

export interface ExportOptions {
  /** Recognised text per page id: those pages get an invisible, searchable text layer. */
  ocrResultsByPage?: Record<string, OcrPageResult | undefined>;
  /** Where a source page already has real text (PDF space). Defaults to reading it with pdf.js. */
  nativeTextBoxes?: (file: File, pageIndex: number) => Promise<Rect[]>;
}

/** The boxes of a page's own (native) text, read with pdf.js; none if the page can't be read. */
async function pdfjsTextBoxes(file: File, pageIndex: number): Promise<Rect[]> {
  try {
    const { loadPdfJsDocument } = await import("@/lib/processors/pdfjs-utils");
    const page = await (await loadPdfJsDocument(file)).getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const boxes: Rect[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const [, , c, d, e, f] = it.transform;
      boxes.push({ x: e, y: f, width: Math.max(1, it.width), height: Math.max(1, Math.hypot(c, d)) });
    }
    return boxes;
  } catch {
    return [];
  }
}

export async function exportEditorDocument(doc: EditorDocument, options: ExportOptions = {}): Promise<Blob> {
  if (doc.pages.length === 0) {
    throw new EditorExportError("There are no pages to export.");
  }

  const out = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await out.embedFont(StandardFonts.Helvetica),
    bold: await out.embedFont(StandardFonts.HelveticaBold),
  };

  const sourceDocCache = new Map<string, PDFDocument>();
  async function getSourceDoc(fileId: string): Promise<PDFDocument> {
    const cached = sourceDocCache.get(fileId);
    if (cached) return cached;
    const file = doc.sourceFiles[fileId];
    if (!file) throw new EditorExportError("A page references a file that's no longer available.");
    const bytes = await file.arrayBuffer();
    let parsed: PDFDocument;
    try {
      parsed = await loadPdfForEditing(bytes);
    } catch {
      throw new EditorExportError("One of the source PDFs couldn't be read. It may be damaged.");
    }
    sourceDocCache.set(fileId, parsed);
    return parsed;
  }

  const imageCache = new Map<string, unknown>();
  const reconnectedFieldRefs = new Set<string>();

  for (const page of doc.pages) {
    const sourceDoc = await getSourceDoc(page.sourceFileId);
    if (page.sourcePageIndex >= sourceDoc.getPageCount()) continue;
    const [copiedPage] = await out.copyPages(sourceDoc, [page.sourcePageIndex]);
    out.addPage(copiedPage);
    copiedPage.setRotation(degrees(effectiveRotation(page)));
    reconnectFormFields(out, copiedPage, reconnectedFieldRefs);

    const objectsForPage = doc.objects.filter((o) => o.pageId === page.id);
    // A recognised scan: its words become searchable text (corrected words with their new text).
    const ocr = options.ocrResultsByPage?.[page.id];
    const corrections = objectsForPage.filter((o): o is Extract<EditorObject, { type: "ocr-text-replacement" }> => o.type === "ocr-text-replacement");
    const inTextLayer: Set<EditorObject> = ocr ? correctionsInLayer(ocr, corrections) : new Set();
    const drawnAsText = new Set<EditorObject>();
    for (const obj of objectsForPage) {
      await drawObject(copiedPage, obj, out, fonts, imageCache, inTextLayer, drawnAsText);
    }
    if (ocr) {
      const sourceFile = doc.sourceFiles[page.sourceFileId];
      const nativeText = sourceFile ? await (options.nativeTextBoxes ?? pdfjsTextBoxes)(sourceFile, page.sourcePageIndex) : [];
      drawOcrTextLayer(copiedPage, ocr, corrections, fonts.regular, ocr.rotation ?? effectiveRotation(page), drawnAsText as Set<(typeof corrections)[number]>, nativeText);
    }

    if (page.cropBox) {
      const [x0, y0, x1, y1] = page.cropBox;
      copiedPage.setCropBox(x0, y0, x1 - x0, y1 - y0);
    }
  }

  if (doc.formFields.length > 0) {
    try {
      const form = out.getForm();
      for (const field of doc.formFields) {
        try {
          if (field.kind === "text") {
            form.getTextField(field.name).setText(field.value);
          } else if (field.kind === "checkbox") {
            const checkbox = form.getCheckBox(field.name);
            if (field.value === "true") checkbox.check();
            else checkbox.uncheck();
          } else if (field.kind === "radio") {
            form.getRadioGroup(field.name).select(field.value);
          } else if (field.kind === "dropdown") {
            form.getDropdown(field.name).select(field.value);
          }
        } catch {
          // A single field that no longer resolves (e.g. rare field-name collisions
          // across merged documents) shouldn't fail the whole export.
        }
      }
    } catch {
      // No form on this document — nothing to apply.
    }
  }

  const bytes = await savePdfChecked(out);
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
