import type { Rotation, ViewportSpec } from "./coordinates";

export interface RgbColor {
  r: number; // 0-1
  g: number; // 0-1
  b: number; // 0-1
}

export const COLOR_BLACK: RgbColor = { r: 0, g: 0, b: 0 };
export const COLOR_WHITE: RgbColor = { r: 1, g: 1, b: 1 };

/** One page in the editor's working document. Pages reference a source file + page index
 * rather than embedding page content directly, so "insert pages from another PDF" and
 * "duplicate page" don't require eagerly re-encoding anything — that only happens once,
 * at export. */
export interface EditorPage {
  id: string;
  sourceFileId: string;
  sourcePageIndex: number; // 0-based index within that source file
  /** The source page's own /Rotate value, as it existed before the editor touched it. */
  baseRotation: Rotation;
  /** Additional rotation applied in the editor, on top of baseRotation. */
  rotationDelta: Rotation;
  /** The page's own MediaBox [xMin, yMin, xMax, yMax], *before* rotation. Most PDFs have
   * an origin at (0, 0), but not all do — this is read from the real MediaBox rather than
   * assumed, since coordinates.ts's viewBox math depends on getting the origin right. */
  mediaBox: [number, number, number, number];
  /** Optional crop box, same [xMin,yMin,xMax,yMax] convention as mediaBox and same
   * unrotated coordinate space — narrows the visible region at export without touching
   * the underlying page content. */
  cropBox?: [number, number, number, number];
}

export function pageWidth(page: EditorPage): number {
  return page.mediaBox[2] - page.mediaBox[0];
}

export function pageHeight(page: EditorPage): number {
  return page.mediaBox[3] - page.mediaBox[1];
}

/** Base pixels-per-point at 100% zoom — chosen so a Letter/A4 page renders at a
 * comfortable, readable size in the editor viewport. */
export const EDITOR_BASE_SCALE = 1.3;

export function viewportSpecForPage(page: EditorPage, zoom: number): ViewportSpec {
  return { viewBox: page.mediaBox, scale: EDITOR_BASE_SCALE * zoom, rotation: effectiveRotation(page) };
}

export function effectiveRotation(page: EditorPage): Rotation {
  return (((page.baseRotation + page.rotationDelta) % 360) + 360) % 360 as Rotation;
}

interface BaseObject {
  id: string;
  pageId: string;
  /** Always in the page's own, unrotated PDF coordinate space (points), regardless of
   * the page's current display rotation — see coordinates.ts for why. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeTextReplacementObject extends BaseObject {
  type: "native-text-replacement";
  originalText: string;
  newText: string;
  fontSize: number;
  color: RgbColor;
}

export interface OcrTextReplacementObject extends BaseObject {
  type: "ocr-text-replacement";
  originalText: string;
  newText: string;
  confidence: number;
  /** Local, sampled-from-the-scan estimates (see regionColor.ts) so the correction patch
   * matches the surrounding page instead of punching a plain white rectangle over it. */
  backgroundColor: RgbColor;
  textColor: RgbColor;
  /** True when the sampled background was too non-uniform (table lines, a pattern, a
   * photo/logo underneath) to safely reconstruct — export skips the background patch
   * entirely for these and only draws the replacement text on top of the original pixels. */
  backgroundComplex: boolean;
  /** User- or auto-selected: skip the background patch and only draw the new text on top
   * of the original scan. Automatic when backgroundComplex (the word overlaps a table/
   * border line the local erase can't safely redraw); can also be chosen manually. */
  overlayOnly: boolean;
  /** Manual font-size override from the properties panel; unset means "use the automatic
   * bbox-height estimate", same as before. Ignored once patchDataUrl is set (the raster
   * patch already bakes in its own calibrated size) — manual overrides clear patchDataUrl
   * so they fall back to the simpler vector rendering they actually affect. */
  fontSize?: number;
  /** A raster patch — background texture clone + the replacement rendered in a locally
   * font-matched typeface, at render resolution — covering exactly (x, y, width, height).
   * When present, export embeds this image directly instead of drawing vector PDF text, so
   * the visible result matches the scan's own look rather than a generic PDF font (see
   * scanPatch.ts). A data URL, not a blob reference, so it round-trips through undo/redo and
   * autosave the same way image/signature objects already do. */
  patchDataUrl?: string;
  /** Which locally available font family (see glyphMatch.ts's FONT_CANDIDATES) the patch's
   * text was rendered in — kept for the properties panel / debugging, not used at export. */
  fontCandidateId?: string;
  /** Where to position the invisible searchable-text run for the *full* corrected word, in
   * PDF points — distinct from (x, y, width, height) above, which is now the tight changed-
   * substring patch region and would otherwise squeeze the whole word's search text into a
   * box sized for just the characters that changed (see export.ts). Falls back to this
   * object's own rect when absent (objects saved before this field existed). */
  searchAnchor?: { x: number; y: number; width: number; height: number };
}

export interface AddedTextObject extends BaseObject {
  type: "added-text";
  text: string;
  fontSize: number;
  color: RgbColor;
  align: "left" | "center" | "right";
  bold: boolean;
}

export interface ImageObjectData extends BaseObject {
  type: "image";
  dataUrl: string;
}

export interface SignatureObjectData extends BaseObject {
  type: "signature";
  dataUrl: string;
}

export interface DrawingObjectData extends BaseObject {
  type: "drawing";
  /** Points in PDF space, relative to (x, y) — i.e. add (x, y) to get absolute position. */
  points: { x: number; y: number }[];
  color: RgbColor;
  strokeWidth: number;
}

export type ShapeKind = "rectangle" | "ellipse" | "line" | "arrow";

export interface ShapeObjectData extends BaseObject {
  type: "shape";
  shape: ShapeKind;
  strokeColor: RgbColor;
  strokeWidth: number;
  fillColor?: RgbColor;
}

export interface WhiteoutObjectData extends BaseObject {
  type: "whiteout";
}

export type AnnotationKind = "highlight" | "underline" | "strikethrough";

export interface AnnotationObjectData extends BaseObject {
  type: "annotation";
  kind: AnnotationKind;
  color: RgbColor;
}

export type EditorObject =
  | NativeTextReplacementObject
  | OcrTextReplacementObject
  | AddedTextObject
  | ImageObjectData
  | SignatureObjectData
  | DrawingObjectData
  | ShapeObjectData
  | WhiteoutObjectData
  | AnnotationObjectData;

export interface FormFieldValue {
  /** pdf-lib field name, unique within the document. */
  name: string;
  kind: "text" | "checkbox" | "radio" | "dropdown";
  value: string; // for checkbox: "true"/"false"; for radio/dropdown: the selected option
}

export interface EditorDocument {
  /** Every source PDF currently referenced by at least one page (the originally-opened
   * file, plus any files whose pages were inserted). */
  sourceFiles: Record<string, File>;
  pages: EditorPage[];
  objects: EditorObject[];
  formFields: FormFieldValue[];
}

export function createEmptyDocument(): EditorDocument {
  return { sourceFiles: {}, pages: [], objects: [], formFields: [] };
}
