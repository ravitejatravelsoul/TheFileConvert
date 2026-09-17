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
