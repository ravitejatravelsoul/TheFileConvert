import { PDFDocument, PDFDict, PDFName, PDFRef, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import type { EditorDocument, EditorObject, RgbColor } from "./types";
import { effectiveRotation } from "./types";

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

function drawArrow(page: PDFPage, x: number, y: number, width: number, height: number, color: RgbColor, strokeWidth: number) {
  const start = { x, y };
  const end = { x: x + width, y: y + height };
  const pdfColor = toPdfLibColor(color);
  page.drawLine({ start, end, thickness: strokeWidth, color: pdfColor });

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(8, Math.min(24, Math.hypot(width, height) * 0.2));
  const headAngle = Math.PI / 7;
  const left = {
    x: end.x - headLength * Math.cos(angle - headAngle),
    y: end.y - headLength * Math.sin(angle - headAngle),
  };
  const right = {
    x: end.x - headLength * Math.cos(angle + headAngle),
    y: end.y - headLength * Math.sin(angle + headAngle),
  };
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

async function drawObject(
  page: PDFPage,
  obj: EditorObject,
  doc: PDFDocument,
  fonts: Fonts,
  imageCache: Map<string, unknown>
): Promise<void> {
  switch (obj.type) {
    case "native-text-replacement":
    case "ocr-text-replacement": {
      drawWhiteoutRect(page, obj.x, obj.y, obj.width, obj.height);
      if (!obj.newText.trim()) break;
      const font = fonts.regular;
      const size = fitFontSize(
        font,
        obj.newText,
        obj,
        obj.type === "native-text-replacement" ? obj.fontSize : undefined
      );
      try {
        page.drawText(obj.newText, { x: obj.x, y: obj.y, size, font, color: rgb(0, 0, 0) });
        // Keep the page searchable after a correction: draw an invisible run with the
        // corrected text at the same position, same technique buildSearchablePdf uses.
        page.drawText(obj.newText, { x: obj.x, y: obj.y, size, font, opacity: 0 });
      } catch {
        // A character outside Helvetica's supported encoding shouldn't fail the whole
        // export — the region is still whited out, just without replacement text drawn.
      }
      break;
    }

    case "added-text": {
      const font = obj.bold ? fonts.bold : fonts.regular;
      const size = fitFontSize(font, obj.text, obj);
      let x = obj.x;
      if (obj.align !== "left") {
        const textWidth = font.widthOfTextAtSize(obj.text, size);
        x = obj.align === "center" ? obj.x + (obj.width - textWidth) / 2 : obj.x + obj.width - textWidth;
      }
      try {
        page.drawText(obj.text, { x, y: obj.y, size, font, color: toPdfLibColor(obj.color) });
      } catch {
        // Unsupported character in this text — skip rather than fail the whole export.
      }
      break;
    }

    case "image":
    case "signature": {
      const bytes = await dataUrlToBytes(obj.dataUrl);
      const isPng = obj.dataUrl.startsWith("data:image/png");
      const embedded = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      page.drawImage(embedded, { x: obj.x, y: obj.y, width: obj.width, height: obj.height });
      break;
    }

    case "drawing":
      drawPolyline(
        page,
        obj.points.map((p) => ({ x: p.x + obj.x, y: p.y + obj.y })),
        obj.color,
        obj.strokeWidth
      );
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
        page.drawLine({
          start: { x: obj.x, y: obj.y },
          end: { x: obj.x + obj.width, y: obj.y + obj.height },
          thickness: obj.strokeWidth,
          color: strokeColor,
        });
      } else if (obj.shape === "arrow") {
        drawArrow(page, obj.x, obj.y, obj.width, obj.height, obj.strokeColor, obj.strokeWidth);
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
          thickness: Math.max(1, obj.height * 0.08),
          color,
        });
      } else if (obj.kind === "strikethrough") {
        const midY = obj.y + obj.height / 2;
        page.drawLine({
          start: { x: obj.x, y: midY },
          end: { x: obj.x + obj.width, y: midY },
          thickness: Math.max(1, obj.height * 0.08),
          color,
        });
      }
      break;
    }
  }
  void imageCache; // reserved for future de-duplication of repeated images; not needed yet
}

export async function exportEditorDocument(doc: EditorDocument): Promise<Blob> {
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
      parsed = await PDFDocument.load(bytes, { ignoreEncryption: true });
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
    for (const obj of objectsForPage) {
      await drawObject(copiedPage, obj, out, fonts, imageCache);
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

  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
