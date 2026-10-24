# PDF Editor — architecture review (before the rebuild)

Reviewed at commit `c7975a4` (branch `rebuild/fresh-launch`). Scope: everything under `src/components/editor/`
(≈ 4,900 lines) and `src/lib/editor/` (≈ 4,100 lines), their e2e specs, and the OCR code they depend on.

## 1. Current architecture

**Document model** (`lib/editor/types.ts`, `document.ts`). An `EditorDocument` is `{ sourceFiles, pages, objects, formFields }`.
A page is a *reference* (source file id + page index) plus an extra rotation and a crop box; nothing is rewritten until
export. `objects` is a flat array of overlay objects, each with `{ id, pageId, x, y, width, height }` in the page's own
unrotated PDF space: `native-text-replacement`, `ocr-text-replacement`, `added-text`, `image`, `signature`, `drawing`,
`shape`, `whiteout`, `annotation`. Z-order is array order. There is no object for *existing* page content.

**Coordinates** (`coordinates.ts`, 255 lines, 309 lines of tests). One well-tested affine layer: PDF points ⇄ viewport CSS
pixels for scale + rotation + a view box (the visible CropBox∩MediaBox is stored as `mediaBox`). It does not know about
`devicePixelRatio`, scroll or the on-screen element: `PageSurface` does that arithmetic itself
(`overlayRef.getBoundingClientRect()` in `pointFromEvent`, `canvasRatioRef` in `canvasPixelSource`).

**Rendering** (`PageSurface.tsx`, 1,041 lines). Only the *active* page is rendered (pdf.js display render into a canvas at
`min(2, devicePixelRatio)`); the other pages are thumbnails (`ThumbnailRail`, lazily rendered). DOM overlays (`ObjectView`)
sit on top of the canvas, one absolutely positioned element per object.

**Native text.** `nativeText.ts` takes pdf.js `getTextContent()` items, sorts them into lines by baseline and splits a line
at wide gaps → clickable "regions" (`NativeTextRegion`, a box + a string). Clicking a region opens `TextEditModal`: a
*dialog with a single-line `<input>`* containing the whole region's text. Saving creates a `native-text-replacement`
object. At export (`export.ts`, case `native-text-replacement`) a **rectangle is drawn over the old text** (white, or — since
the previous fix — the sampled page colour) and the new string is drawn in **Helvetica Regular** at `0.8 × box height`.

**Text added by the user.** `added-text` is edited directly on the canvas with a `contentEditable` element
(`AddedTextContent`, `data-testid="canvas-text-editor"`) — the only real in-place text editing in the editor.

**Images / signatures.** New images and signatures are `image`/`signature` objects (data URL), placed by clicking, then
moved/resized with handles. **Existing images in the PDF are not objects at all** — they cannot be selected.

**Annotations / shapes / drawing.** Highlight, underline, strikethrough are `annotation` objects (a translucent rectangle or
a line); shapes and freehand strokes are objects drawn into the page content at export. Nothing is written as a real PDF
annotation. Existing annotations in a file are only *displayed* (pdf.js) — they cannot be selected or removed.

**Forms.** `loadEditorDocument` lists the AcroForm fields with pdf-lib; they are edited in a *properties-panel list*, not
on the page; export sets values with `form.getTextField().setText(...)`.

**Pages.** Thumbnail rail with reorder, rotate, duplicate, delete, insert blank/PDF. Crop is a draft rectangle applied as a
CropBox. Watermark, page numbers, header/footer live in `PropertiesPanel` ("whole document" tools).

**Export** (`export.ts`). Builds a *new* `PDFDocument`, `copyPages` each page from its source (keeps the original content
stream untouched), draws every object with pdf-lib, applies crop, sets rotation, fills form values, and
`savePdfChecked` verifies the output reopens.

**Undo/redo** (`history.ts`, 84 lines). Bounded snapshot history (50 states) of the immutable `EditorDocument`, with a
coalescing key so a typing burst is one step. Sound; reusable as is.

**Selection model.** `selectedObjectId`, `editingObjectId`, active tool in `useEditorWorkspace` (608 lines).

**OCR.** `classifyPdfPages`, `createOcrSession`, `recognizePage`; scanned words become clickable "recognized word"
buttons whose correction is a raster patch that imitates the scan (`scanPatch.ts`, `glyphMatch.ts`, `regionColor.ts`,
`textDiff.ts` ≈ 1,300 lines), plus an invisible searchable layer at export (`searchLayer.ts`). A scanned-page banner in
`EditorWorkspace` invites the user to "Recognize text… then click any word to edit it".

**Performance.** One page rendered at a time (good); `loadNativeRegionsForPage` re-reads the file with pdf.js per page;
search loads the regions of every page. Nothing is virtualised because nothing is a continuous scroll.

## 2. Root problems

1. **Native text is not edited — it is covered.** The original glyphs stay in the file under a rectangle; the new text is a
   different font at a guessed size. Consequences: a rectangle of the wrong colour on tinted/gradient/patterned
   backgrounds; the *old* text remains in extraction and search ("search mismatch", "old text bleeding through" when the
   cover does not reach the descenders); style (bold, italic, family, colour, size) is lost; whole lines are replaced to
   fix one letter.
2. **The editing interaction is a dialog**, not editing: no caret in the text, no selection, no arrows, no inline
   feedback. A correction of "recieve" means retyping the whole line in an input box.
3. **The model cannot see the page.** pdf.js text items are a *display* summary; nothing links a region to the operator in
   the content stream that drew it, so there is nothing to change, only something to cover. The same gap means existing
   images and existing annotations cannot be selected, moved, replaced or deleted.
4. **No single coordinate service.** `coordinates.ts` is right but incomplete; pointer math, canvas ratio and overlay
   positioning are re-derived inside the 1,000-line `PageSurface`.
5. **`PageSurface` is a god component.** Drag state machine, OCR word targeting, colour sampling, text-expansion probing
   and drawing previews live in one file; every new tool adds to it.
6. **OCR editing is presented as a core feature** although its fidelity is conditional on scan quality (see
   `qa/FIDELITY_AUDIT.md`); it dominates the PageSurface/Workspace code and the first thing a user of a scan is offered.
7. **Forms are a list, not a form.** Fields cannot be filled where they appear on the page.
8. **Annotations are baked rectangles/lines** (not real PDF annotations) and cannot be edited after export in other tools.
9. **Preview ≠ export.** The on-screen replacement is HTML text in the browser's idea of Helvetica; the export draws pdf-lib
   Helvetica. They match only by coincidence of metrics.

## 3. What can be reused

| Piece | Verdict |
|---|---|
| `coordinates.ts` (affine layer, fit zoom, resize handles) | **Keep and extend** into the single `PageTransform` service (adds DPR, zoom, scroll, element origin, MediaBox/CropBox). Its tests stay. |
| `history.ts` snapshot undo/redo with coalescing | **Keep.** |
| `document.ts` page operations (reorder, rotate, duplicate, delete, insert, crop) | **Keep**; pure and tested. |
| `export.ts` skeleton (copyPages → apply → crop → rotate → forms → `savePdfChecked`) | **Keep the skeleton**, replace the native-text case, add native image/annotation edits. |
| Shapes, drawing, signature pad, tool options, shape geometry | **Keep.** |
| `ThumbnailRail`, Toolbar/Properties components | **Rework** (layout, contextual properties, mobile) but reuse the pieces. |
| `AddedTextContent` (contentEditable on canvas) | **Reuse the approach** for all text editing. |
| OCR (`ocr.ts`, `scanPatch.ts`, `searchLayer.ts`, …) | **Keep in the code base behind a flag**; off in the launch editor except *Recognize text → search/copy*. |

## 4. What must be replaced

* The **native text pipeline** (`nativeText.ts` regions, `TextEditModal`, the `native-text-replacement` export case) →
  a content-stream engine (below).
* The **text-edit interaction** → in-place editing on the canvas.
* **`PageSurface`** → split into a render layer, an interaction layer (selection/drag/resize), a text-editing layer, a form
  layer and tool controllers, all talking to the one transform.
* **Forms on the page**, **existing-image objects**, **existing-annotation objects** — new.
* The **editor object model** → one `EditorObject` base (id, page, bounds, rotation, z, style, source, editable, dirty) with
  `TextObject` (native or added), `ImageObject` (native or added), `ShapeObject`, `AnnotationObject`, `SignatureObject`,
  `FormFieldObject`, `PageObject`.

## 5. Risk areas

* **Content-stream rewriting** is the hard part: fonts without a `ToUnicode` map, subset fonts that lack a new letter,
  Type 3 fonts, text inside Form XObjects shared by several pages, text positioned with `TJ` kerning, `ActualText`
  marked content, inline images, clipping text. The engine must refuse (and say so) rather than corrupt.
* **Round-trip safety:** every edit must leave all *other* operators byte-identical (patch-based rewrite, not
  re-serialisation), and the export must still pass qpdf/MuPDF/pdf.js/pdf-lib.
* **Preview fidelity:** the on-screen page must be a render of the *edited* page, not an HTML imitation.
* **Performance:** re-rendering a page after each commit; large documents (25+ pages); single-page view keeps this bounded.
* **Mobile:** inline text editing with the on-screen keyboard; ≥ 44 px targets.
* **Scans:** must stay honest — no OCR text editing in the primary flow.

## 6. Proposed editor architecture

```
src/lib/pdf-engine/            pure TypeScript, no React, unit-tested in Node
  tokenizer.ts                 content stream bytes → operations with byte spans (inline images handled)
  cmap.ts, encodings.ts        ToUnicode CMaps, WinAnsi/MacRoman/Standard encodings, glyph names
  fontinfo.ts                  font resource → decode/encode codes, widths, style flags, "can this char be written?"
  interpreter.ts               walks a page (and its Form XObjects): text runs, images, with page-space geometry
  textmodel.ts                 runs → lines → blocks (alignment, wrapping, style segments)
  edit-text.ts                 a text change → byte patches: old glyphs removed, new text written in the same font
                               (or the closest bundled metric-compatible font), ActualText kept in sync
  edit-image.ts                move / resize / rotate / replace / delete an existing image (matrix rewrite, in place)
  apply.ts                     applyPageEdits(page, edits) → rewritten content streams, original bytes elsewhere
src/lib/editor/                model + services
  pageTransform.ts             the single coordinate service (PDF pt, page, CSS px, DPR, zoom, scroll, rotation, boxes)
  objects.ts                   the unified object model
  history.ts (kept)  document.ts (kept)  export.ts (native cases replaced)
src/components/editor/         UI
  EditorShell (top bar / page rail / canvas / properties / mobile layout)
  PageCanvas (pdf.js render of the *working* page: source page + applied native edits)
  layers: SelectionLayer, TextEditLayer, FormLayer, ShapeLayer
  controllers per tool
```

**Truth for native content is the PDF itself.** The engine reads the page's content streams and produces *runs* (one per
`Tj/TJ/'/"` operator) and *images* (one per `Do`/inline image), each with its byte span, font, size, colour and page-space
matrix. Editor "text objects" are lines/paragraph blocks built from runs. An edit is expressed on that object model and
turned into byte patches: the old text operator is neutralised (replaced by a pure advance so every following operator
keeps its position, then the glyphs are gone), the new text is written in a fresh `q BT … ET Q` block that carries its own
complete text state, in the **same embedded font** when it can encode every character, otherwise a bundled
metric-compatible font. Nothing is covered; there is no white box; extraction and search see only the new text.

**Preview = export.** `PageCanvas` renders the page rewritten with the same engine, so what is on the screen is what the
export contains. While a text object is being edited its old glyphs are already neutralised and an on-canvas
`contentEditable` shows the live text.

**Scans are pictures.** A page without real text is shown as "Scanned page": add text, whiteout, highlight, draw, image,
signature, crop and page operations work; scanned-word editing is off (flag), *Recognize text* only adds a search/copy layer.

**Honesty rules.** An object whose font/encoding the engine cannot edit is shown as non-editable with the reason — never
silently covered. Capability is reported in `qa/PDF_EDITOR_CAPABILITY_MATRIX.md` as PASS / LIMITED / MISSING with evidence.
