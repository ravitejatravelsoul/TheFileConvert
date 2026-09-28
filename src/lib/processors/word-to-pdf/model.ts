/**
 * The document model between the DOCX parser and the layout engine. Everything is already resolved:
 * styles are flattened into each run and paragraph, list labels are numbered, and all lengths are in
 * points (1/72 inch), so layout never has to look at Word XML.
 */

export type Family = "carlito" | "sans" | "serif" | "mono";

export interface RunStyle {
  family: Family;
  /** The font name the document asked for (for reporting substitutions). */
  fontName: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** "rrggbb" or null for automatic (black). */
  color: string | null;
  highlight: string | null;
  vert: "super" | "sub" | null;
  caps: boolean;
  hidden: boolean;
  link?: string;
}

export type Align = "left" | "center" | "right" | "justify";

export interface TabStop {
  pos: number;
  align: "left" | "center" | "right" | "decimal";
  leader: "none" | "dot" | "hyphen" | "underscore";
}

export interface Border {
  width: number;
  color: string;
  space: number;
  dashed?: boolean;
}

export interface ParaProps {
  align: Align;
  indLeft: number;
  indRight: number;
  /** Positive: first-line indent. Negative: hanging indent. */
  indFirst: number;
  spaceBefore: number;
  spaceAfter: number;
  line: { rule: "auto" | "exact" | "atLeast"; value: number };
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  contextualSpacing: boolean;
  widowControl: boolean;
  tabs: TabStop[];
  borders: { top?: Border; bottom?: Border; left?: Border; right?: Border };
  shading: string | null;
  styleId: string;
  /** 1–9 for headings (from outline level or a Heading style), used for PDF bookmarks. */
  outline: number | null;
}

export type Inline =
  | { kind: "text"; text: string; style: RunStyle }
  | { kind: "tab"; style: RunStyle }
  | { kind: "break"; type: "line" | "page" | "column"; style: RunStyle }
  | { kind: "image"; media: string; width: number; height: number; style: RunStyle }
  | { kind: "field"; field: "PAGE" | "NUMPAGES"; style: RunStyle }
  | { kind: "footnote"; id: string; mark: string; style: RunStyle };

/** A picture anchored to the page rather than sitting in a line of text. */
export interface Float {
  media: string;
  width: number;
  height: number;
  /** "flow": placed on its own line above the paragraph. "absolute": drawn at x/y without moving text. */
  mode: "flow" | "absolute";
  /** Positioned by alignment (left/center/right of its frame) rather than by an offset. */
  aligned: boolean;
  align: "left" | "center" | "right";
  /** Absolute placement: x from the page's left edge; y relative to `yFrom`. */
  x: number;
  y: number;
  yFrom: "page" | "margin" | "paragraph";
  xFrom: "page" | "margin";
  behind: boolean;
}

export interface ListLabel {
  text: string;
  style: RunStyle;
  suffix: "tab" | "space" | "nothing";
}

export interface Paragraph {
  kind: "p";
  props: ParaProps;
  inlines: Inline[];
  /** Style for an empty paragraph's height (the paragraph mark's run properties). */
  markStyle: RunStyle;
  label: ListLabel | null;
  floats: Float[];
}

export interface CellBorders {
  top: Border | null;
  bottom: Border | null;
  left: Border | null;
  right: Border | null;
}

export interface Cell {
  span: number;
  /** "continue" cells are the lower parts of a vertically merged cell; they draw nothing of their own. */
  vMerge: "restart" | "continue" | null;
  shading: string | null;
  borders: CellBorders;
  vAlign: "top" | "center" | "bottom";
  margins: { top: number; bottom: number; left: number; right: number };
  blocks: Block[];
}

export interface Row {
  cells: Cell[];
  /** Grid columns skipped before the first cell. */
  gridBefore: number;
  header: boolean;
  cantSplit: boolean;
  height: { value: number; rule: "atLeast" | "exact" } | null;
}

export interface Table {
  kind: "table";
  /** Column widths in points (the table's grid). */
  grid: number[];
  /** Preferred total width in points, or a fraction (0–1) of the available width, or null for the grid's width. */
  width: { value: number; pct: boolean } | null;
  align: "left" | "center" | "right";
  indent: number;
  rows: Row[];
}

export type Block = Paragraph | Table;

export interface HeaderFooterSet {
  default?: Block[];
  first?: Block[];
  even?: Block[];
}

export interface SectionProps {
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; right: number; bottom: number; left: number; header: number; footer: number };
  headers: HeaderFooterSet;
  footers: HeaderFooterSet;
  titlePage: boolean;
  /** How this section starts. */
  start: "nextPage" | "continuous" | "evenPage" | "oddPage";
  columns: { count: number; space: number };
  pageNumberStart: number | null;
  pageNumberFormat: string;
}

export interface Section {
  props: SectionProps;
  blocks: Block[];
}

export interface Media {
  bytes: Uint8Array;
  /** "png" | "jpeg" | anything else the browser may be able to decode (gif, bmp, tiff, webp) | "emf" | "wmf". */
  type: string;
}

export interface DocModel {
  sections: Section[];
  footnotes: Map<string, Block[]>;
  media: Map<string, Media>;
  evenAndOddHeaders: boolean;
  defaultTab: number;
  title: string | null;
  /** What was in the file, for the result screen and for honest notes about what couldn't be kept. */
  stats: { paragraphs: number; tables: number; images: number; textBoxes: number; equations: number; rtl: boolean };
}
