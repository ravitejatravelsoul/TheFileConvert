import JSZip from "jszip";
import type {
  Align,
  Block,
  Border,
  Cell,
  CellBorders,
  DocModel,
  Family,
  Float,
  HeaderFooterSet,
  Inline,
  ListLabel,
  Media,
  Paragraph,
  ParaProps,
  Row,
  RunStyle,
  Section,
  SectionProps,
  Table,
  TabStop,
} from "./model";

/**
 * DOCX (Office Open XML) → DocModel. A .docx is a ZIP of XML parts: word/document.xml holds the body,
 * styles.xml the style chain, numbering.xml the list definitions, and relationship files point at
 * pictures, headers and footers. This reads them the way Word applies them — document defaults, then
 * table style, paragraph style, list level, character style and finally direct formatting.
 */

export class WordToPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordToPdfError";
  }
}

export const MESSAGES = {
  damaged: "This Word document couldn't be read. It may be damaged or incomplete.",
  encrypted: "This Word document is password-protected. Open it in Word, remove the password (File → Info → Protect Document), save it, then try again.",
  legacy: "This is an older .doc file (Word 97–2003), which can't be converted here. Open it in Word, Google Docs or LibreOffice, save it as .docx, then try again.",
  notWord: "This file isn't a Word document. Word to PDF works with .docx files.",
  empty: "This file is empty.",
};

// ------------------------------------------------------------------ XML helpers

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new WordToPdfError(MESSAGES.damaged);
  return doc;
}

function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const c of Array.from(el.children)) if (!name || c.localName === name) out.push(c);
  return out;
}

function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.localName === name) return c;
  return null;
}

function descendants(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagName("*")).filter((e) => e.localName === name);
}

/** An attribute by local name, so it works whatever prefix the file uses. */
function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const direct = el.getAttribute("w:" + name);
  if (direct !== null) return direct;
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
}

const val = (el: Element | null | undefined) => attr(el, "val");

/** Word's on/off properties: present means on unless val says otherwise. */
function onOff(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const v = val(el);
  return !(v === "0" || v === "false" || v === "off" || v === "none");
}

function num(s: string | null | undefined): number | undefined {
  if (s == null || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** A length in twentieths of a point (or with a unit suffix, as strict OOXML writes them) → points. */
function twip(s: string | null | undefined): number | undefined {
  if (s == null || s === "") return undefined;
  const m = /^(-?[\d.]+)(pt|in|cm|mm|pc|pi)?$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  switch (m[2]) {
    case "pt":
      return n;
    case "in":
      return n * 72;
    case "cm":
      return (n * 72) / 2.54;
    case "mm":
      return (n * 72) / 25.4;
    case "pc":
    case "pi":
      return n * 12;
    default:
      return n / 20;
  }
}

const EMU_PER_PT = 12700;

// ------------------------------------------------------------------ partial properties

interface RP {
  fontName?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string | null;
  highlight?: string | null;
  vert?: "super" | "sub" | null;
  caps?: boolean;
  hidden?: boolean;
}

type TabOp = TabStop | { clear: number };

interface PP {
  align?: Align;
  indLeft?: number;
  indRight?: number;
  indFirst?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  line?: ParaProps["line"];
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  contextualSpacing?: boolean;
  widowControl?: boolean;
  tabs?: TabOp[];
  borders?: { top?: Border | null; bottom?: Border | null; left?: Border | null; right?: Border | null };
  shading?: string | null;
  numId?: string;
  ilvl?: number;
  outline?: number | null;
}

function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function mergeR(...layers: (RP | undefined)[]): RP {
  let out: RP = {};
  for (const l of layers) if (l) out = { ...out, ...defined(l) };
  return out;
}

function mergeP(...layers: (PP | undefined)[]): PP {
  let out: PP = {};
  for (const l of layers) {
    if (!l) continue;
    const { tabs, borders, ...rest } = l;
    out = { ...out, ...defined(rest) };
    if (tabs) out.tabs = [...(out.tabs ?? []), ...tabs];
    if (borders) out.borders = { ...(out.borders ?? {}), ...defined(borders) };
  }
  return out;
}

const HIGHLIGHT: Record<string, string> = {
  yellow: "ffff00",
  green: "00ff00",
  cyan: "00ffff",
  magenta: "ff00ff",
  blue: "0000ff",
  red: "ff0000",
  darkBlue: "000080",
  darkCyan: "008080",
  darkGreen: "008000",
  darkMagenta: "800080",
  darkRed: "800000",
  darkYellow: "808000",
  darkGray: "808080",
  lightGray: "c0c0c0",
  black: "000000",
  white: "ffffff",
};

function color(v: string | null): string | null | undefined {
  if (v == null) return undefined;
  if (v === "auto" || !/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return v.toLowerCase();
}

function parseBorder(el: Element | null): Border | null | undefined {
  if (!el) return undefined;
  const v = val(el);
  if (!v || v === "nil" || v === "none") return null;
  const sz = num(attr(el, "sz")) ?? 4;
  return {
    width: Math.max(0.25, sz / 8) * (v === "double" ? 2 : v === "thick" ? 1.5 : 1),
    color: color(attr(el, "color")) ?? "000000",
    space: num(attr(el, "space")) ?? 0,
    dashed: /dash|dot/i.test(v) || undefined,
  };
}

// ------------------------------------------------------------------ context

interface TableStyle {
  borders: TableBorders;
  cellMargins: Partial<Cell["margins"]>;
  shading?: string | null;
  cond: Map<string, { rp: RP; pp: PP; shading?: string | null; borders: TableBorders }>;
}

type TableBorders = { top?: Border | null; bottom?: Border | null; left?: Border | null; right?: Border | null; insideH?: Border | null; insideV?: Border | null };

interface StyleDef {
  id: string;
  type: string;
  basedOn: string | null;
  name: string;
  rp: RP;
  pp: PP;
  table: TableStyle | null;
}

interface Level {
  start: number;
  fmt: string;
  text: string;
  pp: PP;
  rp: RP;
  suffix: ListLabel["suffix"];
}

interface Part {
  path: string;
  rels: Map<string, { target: string; external: boolean }>;
}

interface Ctx {
  zip: JSZip;
  theme: { minor: string; major: string };
  styles: Map<string, StyleDef>;
  defaultParaStyle: string | null;
  defaultTableStyle: string | null;
  defaults: { rp: RP; pp: PP };
  abstracts: Map<string, { levels: Level[]; styleLink: string | null }>;
  nums: Map<string, { abs: string; overrides: Map<number, { start?: number; level?: Level }> }>;
  counters: Map<string, (number | undefined)[]>;
  seenNums: Set<string>;
  mediaPaths: Set<string>;
  footnoteMarks: Map<string, string>;
  stats: DocModel["stats"];
  /** Pre-read XML of parts, keyed by path. */
  xml: Map<string, Document>;
  partRels: Map<string, Part>;
  inBody: boolean;
  /** The mark of the footnote being read, for its own number at the start of its text. */
  noteMark: string | null;
}

function resolveTarget(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  const parts = (dir + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

async function readRels(zip: JSZip, partPath: string): Promise<Part> {
  const dir = partPath.includes("/") ? partPath.slice(0, partPath.lastIndexOf("/") + 1) : "";
  const relPath = `${dir}_rels/${partPath.slice(dir.length)}.rels`;
  const rels = new Map<string, { target: string; external: boolean }>();
  const f = zip.file(relPath);
  if (f) {
    const doc = parseXml(await f.async("string"));
    for (const r of Array.from(doc.getElementsByTagName("*")).filter((e) => e.localName === "Relationship")) {
      const external = r.getAttribute("TargetMode") === "External";
      const target = r.getAttribute("Target") ?? "";
      rels.set(r.getAttribute("Id") ?? "", { target: external ? target : resolveTarget(partPath, target), external });
    }
  }
  return { path: partPath, rels };
}

// ------------------------------------------------------------------ property parsing

function parseRP(el: Element | null, ctx: Ctx): RP {
  if (!el) return {};
  const rp: RP = {};
  const fonts = kid(el, "rFonts");
  if (fonts) {
    const name = attr(fonts, "ascii") ?? attr(fonts, "hAnsi");
    const theme = attr(fonts, "asciiTheme") ?? attr(fonts, "hAnsiTheme");
    if (name) rp.fontName = name;
    else if (theme) rp.fontName = theme.startsWith("major") ? ctx.theme.major : ctx.theme.minor;
  }
  const sz = num(val(kid(el, "sz")));
  if (sz !== undefined) rp.size = sz / 2;
  rp.bold = onOff(kid(el, "b"));
  rp.italic = onOff(kid(el, "i"));
  const u = kid(el, "u");
  if (u) rp.underline = val(u) !== "none";
  const strike = onOff(kid(el, "strike")) ?? onOff(kid(el, "dstrike"));
  if (strike !== undefined) rp.strike = strike;
  const c = kid(el, "color");
  if (c) rp.color = color(val(c)) ?? null;
  const hl = kid(el, "highlight");
  if (hl) rp.highlight = HIGHLIGHT[val(hl) ?? ""] ?? null;
  const shd = kid(el, "shd");
  if (shd && rp.highlight === undefined) {
    const fill = color(attr(shd, "fill"));
    if (fill) rp.highlight = fill;
  }
  const va = val(kid(el, "vertAlign"));
  if (va) rp.vert = va === "superscript" ? "super" : va === "subscript" ? "sub" : null;
  const caps = onOff(kid(el, "caps")) ?? onOff(kid(el, "smallCaps"));
  if (caps !== undefined) rp.caps = caps;
  const hidden = onOff(kid(el, "vanish"));
  if (hidden !== undefined) rp.hidden = hidden;
  return rp;
}

function parsePP(el: Element | null): PP {
  if (!el) return {};
  const pp: PP = {};
  const jc = val(kid(el, "jc"));
  if (jc) pp.align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" || jc.includes("Kashida") || jc === "thaiDistribute" ? "justify" : "left";
  const ind = kid(el, "ind");
  if (ind) {
    const left = twip(attr(ind, "left") ?? attr(ind, "start"));
    const right = twip(attr(ind, "right") ?? attr(ind, "end"));
    const first = twip(attr(ind, "firstLine"));
    const hanging = twip(attr(ind, "hanging"));
    if (left !== undefined) pp.indLeft = left;
    if (right !== undefined) pp.indRight = right;
    if (hanging !== undefined) pp.indFirst = -hanging;
    else if (first !== undefined) pp.indFirst = first;
  }
  const sp = kid(el, "spacing");
  if (sp) {
    const before = attr(sp, "beforeAutospacing") === "1" || attr(sp, "beforeAutospacing") === "true" ? 14 : twip(attr(sp, "before"));
    const after = attr(sp, "afterAutospacing") === "1" || attr(sp, "afterAutospacing") === "true" ? 14 : twip(attr(sp, "after"));
    if (before !== undefined) pp.spaceBefore = before;
    if (after !== undefined) pp.spaceAfter = after;
    const line = num(attr(sp, "line"));
    if (line !== undefined) {
      const rule = attr(sp, "lineRule");
      pp.line = rule === "exact" ? { rule: "exact", value: line / 20 } : rule === "atLeast" ? { rule: "atLeast", value: line / 20 } : { rule: "auto", value: line / 240 };
    }
  }
  pp.keepNext = onOff(kid(el, "keepNext"));
  pp.keepLines = onOff(kid(el, "keepLines"));
  pp.pageBreakBefore = onOff(kid(el, "pageBreakBefore"));
  pp.contextualSpacing = onOff(kid(el, "contextualSpacing"));
  pp.widowControl = onOff(kid(el, "widowControl"));
  const tabs = kid(el, "tabs");
  if (tabs) {
    pp.tabs = kids(tabs, "tab").map((t): TabOp => {
      const pos = twip(attr(t, "pos")) ?? 0;
      const v = val(t);
      if (v === "clear") return { clear: pos };
      const leader = attr(t, "leader");
      return {
        pos,
        align: v === "center" ? "center" : v === "right" || v === "end" ? "right" : v === "decimal" ? "decimal" : "left",
        leader: leader === "dot" || leader === "middleDot" ? "dot" : leader === "hyphen" ? "hyphen" : leader === "underscore" || leader === "heavy" ? "underscore" : "none",
      };
    });
  }
  const bdr = kid(el, "pBdr");
  if (bdr) pp.borders = { top: parseBorder(kid(bdr, "top")), bottom: parseBorder(kid(bdr, "bottom")), left: parseBorder(kid(bdr, "left")), right: parseBorder(kid(bdr, "right")) };
  const shd = kid(el, "shd");
  if (shd) pp.shading = color(attr(shd, "fill")) ?? null;
  const numPr = kid(el, "numPr");
  if (numPr) {
    const id = val(kid(numPr, "numId"));
    const lvl = num(val(kid(numPr, "ilvl")));
    if (id !== null) pp.numId = id;
    if (lvl !== undefined) pp.ilvl = lvl;
  }
  const outline = num(val(kid(el, "outlineLvl")));
  if (outline !== undefined) pp.outline = outline < 9 ? outline + 1 : null;
  return pp;
}

function parseTableBorders(el: Element | null): TableBorders {
  if (!el) return {};
  return defined({
    top: parseBorder(kid(el, "top")),
    bottom: parseBorder(kid(el, "bottom")),
    left: parseBorder(kid(el, "left") ?? kid(el, "start")),
    right: parseBorder(kid(el, "right") ?? kid(el, "end")),
    insideH: parseBorder(kid(el, "insideH")),
    insideV: parseBorder(kid(el, "insideV")),
  });
}

function parseMargins(el: Element | null): Partial<Cell["margins"]> {
  if (!el) return {};
  const w = (n: string) => {
    const e = kid(el, n);
    return e ? twip(attr(e, "w")) : undefined;
  };
  return defined({ top: w("top"), bottom: w("bottom"), left: w("left") ?? w("start"), right: w("right") ?? w("end") });
}

// ------------------------------------------------------------------ styles, theme, numbering

function readTheme(doc: Document | null): { minor: string; major: string } {
  const out = { minor: "Calibri", major: "Calibri Light" };
  if (!doc) return out;
  for (const e of Array.from(doc.getElementsByTagName("*"))) {
    if (e.localName === "minorFont" || e.localName === "majorFont") {
      const latin = kid(e, "latin")?.getAttribute("typeface");
      if (latin) out[e.localName === "minorFont" ? "minor" : "major"] = latin;
    }
  }
  return out;
}

function readStyles(doc: Document | null, ctx: Ctx) {
  if (!doc) {
    // No styles part: Word's built-in defaults.
    ctx.defaults = { rp: { fontName: "Times New Roman", size: 10 }, pp: {} };
    return;
  }
  const root = doc.documentElement;
  const dd = kid(root, "docDefaults");
  ctx.defaults = {
    rp: mergeR({ fontName: "Times New Roman", size: 10 }, parseRP(kid(kid(dd, "rPrDefault"), "rPr"), ctx)),
    pp: parsePP(kid(kid(dd, "pPrDefault"), "pPr")),
  };
  for (const s of kids(root, "style")) {
    const id = attr(s, "styleId") ?? "";
    const type = attr(s, "type") ?? "paragraph";
    let table: TableStyle | null = null;
    if (type === "table") {
      const tblPr = kid(s, "tblPr");
      const cond = new Map<string, { rp: RP; pp: PP; shading?: string | null; borders: TableBorders }>();
      for (const c of kids(s, "tblStylePr")) {
        const tcPr = kid(c, "tcPr");
        const shd = kid(tcPr, "shd");
        cond.set(attr(c, "type") ?? "", {
          rp: parseRP(kid(c, "rPr"), ctx),
          pp: parsePP(kid(c, "pPr")),
          shading: shd ? (color(attr(shd, "fill")) ?? null) : undefined,
          borders: { ...parseTableBorders(kid(kid(c, "tblPr"), "tblBorders")), ...parseTableBorders(kid(tcPr, "tcBorders")) },
        });
      }
      const shd = kid(kid(s, "tcPr"), "shd");
      table = {
        borders: parseTableBorders(kid(tblPr, "tblBorders")),
        cellMargins: parseMargins(kid(tblPr, "tblCellMar")),
        shading: shd ? (color(attr(shd, "fill")) ?? null) : undefined,
        cond,
      };
    }
    const def: StyleDef = {
      id,
      type,
      basedOn: val(kid(s, "basedOn")),
      name: val(kid(s, "name")) ?? id,
      rp: parseRP(kid(s, "rPr"), ctx),
      pp: parsePP(kid(s, "pPr")),
      table,
    };
    ctx.styles.set(id, def);
    const isDefault = attr(s, "default") === "1" || attr(s, "default") === "true";
    if (isDefault && type === "paragraph") ctx.defaultParaStyle = id;
    if (isDefault && type === "table") ctx.defaultTableStyle = id;
  }
}

function styleChain(ctx: Ctx, id: string | null): StyleDef[] {
  const chain: StyleDef[] = [];
  const seen = new Set<string>();
  let cur = id ? ctx.styles.get(id) : undefined;
  while (cur && !seen.has(cur.id) && chain.length < 20) {
    chain.unshift(cur);
    seen.add(cur.id);
    cur = cur.basedOn ? ctx.styles.get(cur.basedOn) : undefined;
  }
  return chain;
}

function styleRP(ctx: Ctx, id: string | null): RP {
  return mergeR(...styleChain(ctx, id).map((s) => s.rp));
}

function stylePP(ctx: Ctx, id: string | null): PP {
  return mergeP(...styleChain(ctx, id).map((s) => s.pp));
}

function tableStyle(ctx: Ctx, id: string | null): TableStyle & { rp: RP; pp: PP } {
  const chain = styleChain(ctx, id ?? ctx.defaultTableStyle);
  const out: TableStyle & { rp: RP; pp: PP } = { borders: {}, cellMargins: {}, cond: new Map(), rp: {}, pp: {} };
  for (const s of chain) {
    out.rp = mergeR(out.rp, s.rp);
    out.pp = mergeP(out.pp, s.pp);
    if (!s.table) continue;
    out.borders = { ...out.borders, ...s.table.borders };
    out.cellMargins = { ...out.cellMargins, ...s.table.cellMargins };
    if (s.table.shading !== undefined) out.shading = s.table.shading;
    for (const [k, v] of s.table.cond) out.cond.set(k, v);
  }
  return out;
}

function readNumbering(doc: Document | null, ctx: Ctx) {
  if (!doc) return;
  const root = doc.documentElement;
  for (const a of kids(root, "abstractNum")) {
    const levels: Level[] = [];
    for (const l of kids(a, "lvl")) {
      const ilvl = num(attr(l, "ilvl")) ?? levels.length;
      levels[ilvl] = parseLevel(l, ctx);
    }
    ctx.abstracts.set(attr(a, "abstractNumId") ?? "", { levels, styleLink: val(kid(a, "numStyleLink")) });
  }
  for (const n of kids(root, "num")) {
    const overrides = new Map<number, { start?: number; level?: Level }>();
    for (const o of kids(n, "lvlOverride")) {
      const ilvl = num(attr(o, "ilvl")) ?? 0;
      const lvl = kid(o, "lvl");
      overrides.set(ilvl, { start: num(val(kid(o, "startOverride"))), level: lvl ? parseLevel(lvl, ctx) : undefined });
    }
    ctx.nums.set(attr(n, "numId") ?? "", { abs: val(kid(n, "abstractNumId")) ?? "", overrides });
  }
}

function parseLevel(l: Element, ctx: Ctx): Level {
  const suff = val(kid(l, "suff"));
  return {
    start: num(val(kid(l, "start"))) ?? 1,
    fmt: val(kid(l, "numFmt")) ?? "decimal",
    text: val(kid(l, "lvlText")) ?? "",
    pp: parsePP(kid(l, "pPr")),
    rp: parseRP(kid(l, "rPr"), ctx),
    suffix: suff === "space" ? "space" : suff === "nothing" ? "nothing" : "tab",
  };
}

function levelsFor(ctx: Ctx, numId: string, depth = 0): { absKey: string; levels: Level[]; overrides: Map<number, { start?: number; level?: Level }> } | null {
  const n = ctx.nums.get(numId);
  if (!n || depth > 4) return null;
  const abs = ctx.abstracts.get(n.abs);
  if (!abs) return null;
  if (abs.styleLink && !abs.levels.length) {
    const linked = stylePP(ctx, abs.styleLink).numId;
    if (linked && linked !== numId) return levelsFor(ctx, linked, depth + 1);
  }
  return { absKey: n.abs, levels: abs.levels, overrides: n.overrides };
}

const SYMBOL_BULLETS: Record<number, string> = {
  0xb7: "•",
  0xa7: "▪",
  0xa8: "◆",
  0x6c: "●",
  0x6e: "■",
  0x6f: "□",
  0x71: "❑",
  0x76: "❖",
  0xd8: "➢",
  0xfc: "✓",
  0xfb: "✗",
  0xa1: "○",
  0x9f: "•",
  0x77: "◆",
  0xe0: "→",
  0xe8: "➔",
};

/** Symbol/Wingdings characters (often in the U+F0xx private area) → real Unicode. */
function mapSymbol(text: string, fontName: string | undefined): string {
  const symbolFont = fontName ? /symbol|wingdings|webdings/i.test(fontName) : false;
  return Array.from(text)
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (code >= 0xf000 && code <= 0xf0ff) return SYMBOL_BULLETS[code - 0xf000] ?? "•";
      if (symbolFont) return SYMBOL_BULLETS[code] ?? (code < 0x80 ? "•" : ch);
      return ch;
    })
    .join("");
}

function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case "lowerLetter":
      return letters(n).toLowerCase();
    case "upperLetter":
      return letters(n);
    case "lowerRoman":
      return roman(n).toLowerCase();
    case "upperRoman":
      return roman(n);
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    case "ordinal":
      return `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
    case "none":
      return "";
    default:
      return String(n);
  }
}

function letters(n: number): string {
  if (n < 1) return String(n);
  const ch = String.fromCharCode(65 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

function roman(n: number): string {
  if (n < 1 || n > 3999) return String(n);
  const map: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

/** Advances the list counters for one numbered paragraph and returns its label. */
function nextLabel(ctx: Ctx, numId: string, ilvl: number): { level: Level; text: string } | null {
  if (numId === "0") return null;
  const found = levelsFor(ctx, numId);
  if (!found) return null;
  const levelOf = (i: number) => found.overrides.get(i)?.level ?? found.levels[i];
  const level = levelOf(ilvl);
  if (!level) return null;
  let counters = ctx.counters.get(found.absKey);
  if (!counters) ctx.counters.set(found.absKey, (counters = []));
  if (!ctx.seenNums.has(numId)) {
    ctx.seenNums.add(numId);
    for (const [i, o] of found.overrides) if (o.start !== undefined) counters[i] = o.start - 1;
  }
  const startOf = (i: number) => found.overrides.get(i)?.start ?? levelOf(i)?.start ?? 1;
  counters[ilvl] = counters[ilvl] === undefined ? startOf(ilvl) : counters[ilvl]! + 1;
  for (let k = ilvl + 1; k < 9; k++) counters[k] = undefined;
  if (level.fmt === "bullet") return { level, text: mapSymbol(level.text, level.rp.fontName) };
  const text = level.text.replace(/%(\d)/g, (_, d: string) => {
    const i = Number(d) - 1;
    const lv = levelOf(i);
    return formatNumber(counters![i] ?? startOf(i), lv?.fmt ?? "decimal");
  });
  return { level, text };
}

// ------------------------------------------------------------------ run style

export function familyFor(name: string | undefined): Family {
  const n = (name ?? "").toLowerCase().trim();
  // Exact stand-ins first, each chosen by measuring widths against the Microsoft font (see the fonts README).
  if (/^(georgia|gelasio)$/.test(n)) return "gelasio"; // identical character widths in all four styles
  if (/^(cambria|caladea)$/.test(n)) return "caladea"; // the closest open match (≈ 0.95–0.99 of Cambria's widths)
  if (/^(verdana|dejavu sans)$/.test(n)) return "dejavu"; // 0.99–1.00 of Verdana's widths (Liberation Sans is 0.84–0.87)
  if (/calibri|carlito|candara|corbel|segoe|constantia/.test(n)) return "carlito";
  if (/courier|consolas|mono|lucida console|menlo|monaco|cousine|source code/.test(n)) return "mono";
  if (/times|serif|georgia|garamond|cambria|caladea|book antiqua|palatino|bookman|century schoolbook|baskerville|tinos|minion|charter|didot|bodoni/.test(n) && !/sans/.test(n)) return "serif";
  return "sans";
}

function runStyle(rp: RP, link?: string): RunStyle {
  return {
    family: familyFor(rp.fontName),
    fontName: rp.fontName ?? "Times New Roman",
    size: rp.size ?? 10,
    bold: rp.bold ?? false,
    italic: rp.italic ?? false,
    underline: rp.underline ?? false,
    strike: rp.strike ?? false,
    color: rp.color ?? null,
    highlight: rp.highlight ?? null,
    vert: rp.vert ?? null,
    caps: rp.caps ?? false,
    hidden: rp.hidden ?? false,
    link,
  };
}

function toParaProps(pp: PP, styleId: string, outlineFromStyle: number | null): ParaProps {
  const tabs: TabStop[] = [];
  for (const t of pp.tabs ?? []) {
    if ("clear" in t) {
      const i = tabs.findIndex((x) => Math.abs(x.pos - t.clear) < 0.5);
      if (i >= 0) tabs.splice(i, 1);
    } else {
      const i = tabs.findIndex((x) => Math.abs(x.pos - t.pos) < 0.5);
      if (i >= 0) tabs.splice(i, 1);
      tabs.push(t);
    }
  }
  tabs.sort((a, b) => a.pos - b.pos);
  const b = pp.borders ?? {};
  return {
    align: pp.align ?? "left",
    indLeft: pp.indLeft ?? 0,
    indRight: pp.indRight ?? 0,
    indFirst: pp.indFirst ?? 0,
    spaceBefore: pp.spaceBefore ?? 0,
    spaceAfter: pp.spaceAfter ?? 0,
    line: pp.line ?? { rule: "auto", value: 1 },
    keepNext: pp.keepNext ?? false,
    keepLines: pp.keepLines ?? false,
    pageBreakBefore: pp.pageBreakBefore ?? false,
    contextualSpacing: pp.contextualSpacing ?? false,
    widowControl: pp.widowControl ?? true,
    tabs,
    borders: defined({ top: b.top ?? undefined, bottom: b.bottom ?? undefined, left: b.left ?? undefined, right: b.right ?? undefined }),
    shading: pp.shading ?? null,
    styleId,
    outline: pp.outline !== undefined ? pp.outline : outlineFromStyle,
  };
}

// ------------------------------------------------------------------ paragraphs

interface Scope {
  part: Part;
  /** Extra run/paragraph layers from a table style (inside a table cell). */
  table?: { rp: RP; pp: PP };
}

interface FieldFrame {
  instr: string;
  phase: "instr" | "result";
  kind: "PAGE" | "NUMPAGES" | "HYPERLINK" | "other";
  url?: string;
}

function headingLevel(ctx: Ctx, styleId: string): number | null {
  for (const s of styleChain(ctx, styleId).reverse()) {
    const m = /^heading\s*(\d)$/i.exec(s.name) ?? /^Heading(\d)$/.exec(s.id);
    if (m) return Number(m[1]);
    if (/^title$/i.test(s.name)) return 1;
  }
  return null;
}

function buildParagraph(p: Element, ctx: Ctx, scope: Scope): { para: Paragraph; extra: Block[] } {
  const pPr = kid(p, "pPr");
  const styleId = val(kid(pPr, "pStyle")) ?? ctx.defaultParaStyle ?? "";
  const direct = parsePP(pPr);
  const fromStyle = stylePP(ctx, styleId);
  const numId = direct.numId ?? fromStyle.numId;
  const ilvl = direct.ilvl ?? fromStyle.ilvl ?? 0;
  const label = numId !== undefined ? nextLabel(ctx, numId, ilvl) : null;
  const pp = mergeP(ctx.defaults.pp, scope.table?.pp, fromStyle, label?.level.pp, direct);
  const baseRP = mergeR(ctx.defaults.rp, scope.table?.rp, styleRP(ctx, styleId));
  const markStyle = runStyle(mergeR(baseRP, parseRP(kid(pPr, "rPr"), ctx)));

  const inlines: Inline[] = [];
  const floats: Float[] = [];
  const extra: Block[] = [];
  const fields: FieldFrame[] = [];

  const emitting = () => fields.every((f) => f.phase === "result" && f.kind !== "PAGE" && f.kind !== "NUMPAGES");
  const fieldLink = () => [...fields].reverse().find((f) => f.kind === "HYPERLINK" && f.phase === "result")?.url;

  const walk = (el: Element, link: string | undefined) => {
    for (const c of Array.from(el.children)) {
      switch (c.localName) {
        case "r":
          run(c, link);
          break;
        case "hyperlink": {
          const rid = attr(c, "id");
          const rel = rid ? scope.part.rels.get(rid) : undefined;
          walk(c, rel?.external ? rel.target : link);
          break;
        }
        case "fldSimple": {
          const instr = (attr(c, "instr") ?? "").trim();
          const kind = /^PAGE\b/i.test(instr) ? "PAGE" : /^NUMPAGES\b/i.test(instr) ? "NUMPAGES" : null;
          if (kind) {
            const r = kids(c, "r")[0];
            inlines.push({ kind: "field", field: kind, style: runStyle(mergeR(baseRP, runRP(r ?? null))) });
          } else {
            const url = /^HYPERLINK\s+"([^"]+)"/i.exec(instr)?.[1];
            walk(c, url ?? link);
          }
          break;
        }
        case "ins":
        case "moveTo":
        case "smartTag":
        case "customXml":
        case "bdo":
        case "dir":
          walk(c, link);
          break;
        case "sdt":
          walk(kid(c, "sdtContent") ?? c, link);
          break;
        case "oMath":
        case "oMathPara":
          ctx.stats.equations++;
          inlines.push({ kind: "text", text: descendants(c, "t").map((t) => t.textContent ?? "").join(""), style: runStyle(mergeR(baseRP, { italic: true })) });
          break;
        default:
          break; // pPr, bookmarks, comments, deletions (del, moveFrom), proofing marks
      }
    }
  };

  function runRP(r: Element | null): RP {
    const rPr = kid(r, "rPr");
    const cs = val(kid(rPr, "rStyle"));
    return mergeR(cs ? styleRP(ctx, cs) : undefined, parseRP(rPr, ctx));
  }

  function run(r: Element, link: string | undefined) {
    const rp = mergeR(baseRP, runRP(r));
    const style = () => runStyle(rp, fieldLink() ?? link);
    for (const c of Array.from(r.children)) {
      switch (c.localName) {
        case "fldChar": {
          const t = attr(c, "fldCharType");
          if (t === "begin") fields.push({ instr: "", phase: "instr", kind: "other" });
          else if (t === "separate" || t === "end") {
            const f = fields[fields.length - 1];
            if (f && f.phase === "instr") {
              const instr = f.instr.trim();
              f.kind = /^PAGE\b/i.test(instr) ? "PAGE" : /^NUMPAGES\b/i.test(instr) ? "NUMPAGES" : /^HYPERLINK\b/i.test(instr) ? "HYPERLINK" : "other";
              if (f.kind === "HYPERLINK") f.url = /"([^"]+)"/.exec(instr)?.[1];
              if ((f.kind === "PAGE" || f.kind === "NUMPAGES") && fields.slice(0, -1).every((x) => x.phase === "result")) {
                inlines.push({ kind: "field", field: f.kind, style: style() });
              }
              f.phase = "result";
            }
            if (t === "end") fields.pop();
          }
          break;
        }
        case "instrText": {
          const f = fields[fields.length - 1];
          if (f && f.phase === "instr") f.instr += c.textContent ?? "";
          break;
        }
        default:
          if (!emitting()) break;
          runChild(c, rp, style);
      }
    }
  }

  function runChild(c: Element, rp: RP, style: () => RunStyle) {
    switch (c.localName) {
      case "t": {
        const text = c.textContent ?? "";
        if (text) inlines.push({ kind: "text", text: rp.fontName && /symbol|wingdings/i.test(rp.fontName) ? mapSymbol(text, rp.fontName) : text, style: style() });
        break;
      }
      case "tab":
      case "ptab":
        inlines.push({ kind: "tab", style: style() });
        break;
      case "br": {
        const t = attr(c, "type");
        inlines.push({ kind: "break", type: t === "page" ? "page" : t === "column" ? "column" : "line", style: style() });
        break;
      }
      case "cr":
        inlines.push({ kind: "break", type: "line", style: style() });
        break;
      case "noBreakHyphen":
        inlines.push({ kind: "text", text: "-", style: style() });
        break;
      case "sym": {
        const ch = attr(c, "char");
        const code = ch ? parseInt(ch, 16) : NaN;
        if (Number.isFinite(code)) inlines.push({ kind: "text", text: mapSymbol(String.fromCodePoint(code), attr(c, "font") ?? "Symbol"), style: style() });
        break;
      }
      case "drawing":
        drawing(c, style);
        break;
      case "pict":
      case "object":
        vml(c, style);
        break;
      case "AlternateContent": {
        const choice = kid(c, "Choice");
        const fallback = kid(c, "Fallback");
        const pick = choice && descendants(choice, "drawing").length ? choice : (fallback ?? choice);
        if (pick) for (const k of Array.from(pick.children)) runChild(k, rp, style);
        break;
      }
      case "footnoteReference":
      case "endnoteReference": {
        const id = attr(c, "id") ?? "";
        const key = `${c.localName === "footnoteReference" ? "f" : "e"}:${id}`;
        if (!ctx.footnoteMarks.has(key)) ctx.footnoteMarks.set(key, String(ctx.footnoteMarks.size + 1));
        inlines.push({ kind: "footnote", id: key, mark: ctx.footnoteMarks.get(key)!, style: { ...style(), vert: "super" } });
        break;
      }
      case "footnoteRef":
      case "endnoteRef":
        inlines.push({ kind: "text", text: ctx.noteMark ?? "", style: { ...style(), vert: "super" } });
        break;
      default:
        break;
    }
  }

  function mediaFor(rid: string | null): string | null {
    if (!rid) return null;
    const rel = scope.part.rels.get(rid);
    if (!rel || rel.external) return null;
    ctx.mediaPaths.add(rel.target);
    return rel.target;
  }

  function drawing(d: Element, style: () => RunStyle) {
    const holder = kid(d, "inline") ?? kid(d, "anchor");
    if (!holder) return;
    const ext = kid(holder, "extent");
    const w = (num(attr(ext, "cx")) ?? 0) / EMU_PER_PT;
    const h = (num(attr(ext, "cy")) ?? 0) / EMU_PER_PT;
    for (const tb of descendants(holder, "txbxContent")) {
      ctx.stats.textBoxes++;
      extra.push(...blocksOf(tb, ctx, scope));
    }
    const blips = descendants(holder, "blip");
    if (!blips.length || w <= 0 || h <= 0) return;
    const media = mediaFor(attr(blips[0], "embed"));
    if (!media) return;
    ctx.stats.images++;
    if (holder.localName === "inline") {
      inlines.push({ kind: "image", media, width: w, height: h, style: style() });
      return;
    }
    const posH = kid(holder, "positionH");
    const posV = kid(holder, "positionV");
    const wrapNone = kid(holder, "wrapNone") !== null;
    const behind = attr(holder, "behindDoc") === "1" || attr(holder, "behindDoc") === "true";
    const hFrom = attr(posH, "relativeFrom") ?? "column";
    const vFrom = attr(posV, "relativeFrom") ?? "paragraph";
    const hAlign = kid(posH, "align")?.textContent ?? null;
    const f: Float = {
      media,
      width: w,
      height: h,
      mode: wrapNone || behind ? "absolute" : "flow",
      aligned: hAlign !== null,
      align: hAlign === "center" ? "center" : hAlign === "right" || hAlign === "outside" ? "right" : "left",
      x: (num(kid(posH, "posOffset")?.textContent) ?? 0) / EMU_PER_PT,
      y: (num(kid(posV, "posOffset")?.textContent) ?? 0) / EMU_PER_PT,
      xFrom: hFrom === "page" ? "page" : "margin",
      yFrom: vFrom === "page" ? "page" : vFrom === "margin" || vFrom === "topMargin" ? "margin" : "paragraph",
      behind,
    };
    floats.push(f);
  }

  function vml(el: Element, style: () => RunStyle) {
    for (const tb of descendants(el, "txbxContent")) {
      ctx.stats.textBoxes++;
      extra.push(...blocksOf(tb, ctx, scope));
    }
    const img = descendants(el, "imagedata")[0];
    if (!img) return;
    const media = mediaFor(img.getAttribute("r:id") ?? attr(img, "id"));
    if (!media) return;
    const shape = img.parentElement;
    const css = shape?.getAttribute("style") ?? "";
    const size = (k: string) => {
      const m = new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([\\d.]+)(pt|in|px|cm|mm)?`).exec(css);
      if (!m) return 0;
      const n = Number(m[1]);
      return m[2] === "in" ? n * 72 : m[2] === "px" ? n * 0.75 : m[2] === "cm" ? (n * 72) / 2.54 : m[2] === "mm" ? (n * 72) / 25.4 : n;
    };
    const w = size("width");
    const h = size("height");
    if (w > 0 && h > 0) {
      ctx.stats.images++;
      inlines.push({ kind: "image", media, width: w, height: h, style: style() });
    }
  }

  walk(p, undefined);

  let listLabel: ListLabel | null = null;
  if (label && label.text) {
    const lrp = mergeR(baseRP, parseRP(kid(pPr, "rPr"), ctx), label.level.rp);
    // A symbol-font bullet has been mapped to Unicode, so draw it in the paragraph's own font.
    if (lrp.fontName && /symbol|wingdings|webdings/i.test(lrp.fontName)) lrp.fontName = baseRP.fontName;
    listLabel = { text: label.text, style: runStyle(mergeR(lrp, { underline: false, strike: false })), suffix: label.level.suffix };
  }

  const text = inlines.map((i) => (i.kind === "text" ? i.text : "")).join("");
  if (/[\u0590-ࣿ\ufb1d-\ufdff\ufe70-\ufeff]/.test(text)) ctx.stats.rtl = true;
  if (ctx.inBody) ctx.stats.paragraphs++;

  return {
    para: {
      kind: "p",
      props: toParaProps(pp, styleId, headingLevel(ctx, styleId)),
      inlines,
      markStyle,
      label: listLabel,
      floats,
    },
    extra,
  };
}

// ------------------------------------------------------------------ tables

function buildTable(tbl: Element, ctx: Ctx, scope: Scope): Table {
  const tblPr = kid(tbl, "tblPr");
  const ts = tableStyle(ctx, val(kid(tblPr, "tblStyle")));
  const borders: TableBorders = { ...ts.borders, ...parseTableBorders(kid(tblPr, "tblBorders")) };
  const margins = { top: 0, bottom: 0, left: 5.4, right: 5.4, ...ts.cellMargins, ...parseMargins(kid(tblPr, "tblCellMar")) };
  const look = kid(tblPr, "tblLook");
  const lookVal = parseInt(val(look) ?? "0", 16) || 0;
  const flag = (name: string, bit: number) => {
    const a = attr(look, name);
    return a !== null ? a === "1" || a === "true" : (lookVal & bit) !== 0;
  };
  const lookFirstRow = look ? flag("firstRow", 0x20) : true;
  const lookLastRow = flag("lastRow", 0x40);
  const lookFirstCol = look ? flag("firstColumn", 0x80) : true;
  const noHBand = flag("noHBand", 0x200);

  const tblW = kid(tblPr, "tblW");
  const wType = attr(tblW, "type");
  const wRaw = attr(tblW, "w");
  let width: Table["width"] = null;
  if (wType === "pct" && wRaw) width = { value: wRaw.endsWith("%") ? Number(wRaw.slice(0, -1)) / 100 : Number(wRaw) / 5000, pct: true };
  else if ((wType === "dxa" || (!wType && wRaw)) && wRaw && Number(wRaw) > 0) width = { value: twip(wRaw) ?? 0, pct: false };

  const jc = val(kid(tblPr, "jc"));
  const grid = kids(kid(tbl, "tblGrid"), "gridCol").map((g) => twip(attr(g, "w")) ?? 0);

  // Rows, including those wrapped in content controls.
  const rowEls: Element[] = [];
  const collectRows = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.localName === "tr") rowEls.push(c);
      else if (c.localName === "sdt") collectRows(kid(c, "sdtContent") ?? c);
      else if (c.localName === "customXml") collectRows(c);
    }
  };
  collectRows(tbl);

  const rows: Row[] = [];
  const dataRows = rowEls.length - (lookFirstRow ? 1 : 0);
  rowEls.forEach((tr, ri) => {
    const trPr = kid(tr, "trPr");
    const cellEls: Element[] = [];
    const collectCells = (el: Element) => {
      for (const c of Array.from(el.children)) {
        if (c.localName === "tc") cellEls.push(c);
        else if (c.localName === "sdt") collectCells(kid(c, "sdtContent") ?? c);
        else if (c.localName === "customXml") collectCells(c);
      }
    };
    collectCells(tr);
    const trH = kid(trPr, "trHeight");
    const hRule = attr(trH, "hRule");
    const hVal = twip(val(trH));
    const gridBefore = num(val(kid(trPr, "gridBefore"))) ?? 0;
    const isFirst = ri === 0;
    const isLast = ri === rowEls.length - 1;
    const bandIndex = ri - (lookFirstRow ? 1 : 0);
    let col = gridBefore;
    const cells: Cell[] = cellEls.map((tc, ci) => {
      const tcPr = kid(tc, "tcPr");
      const span = num(val(kid(tcPr, "gridSpan"))) ?? 1;
      const vm = kid(tcPr, "vMerge");
      const conds: string[] = [];
      if (!noHBand && bandIndex >= 0 && !(lookFirstRow && isFirst) && !(lookLastRow && isLast) && dataRows > 0) conds.push(bandIndex % 2 === 0 ? "band1Horz" : "band2Horz");
      if (lookFirstCol && col === 0) conds.push("firstCol");
      if (lookLastRow && isLast) conds.push("lastRow");
      if (lookFirstRow && isFirst) conds.push("firstRow");
      let shading: string | null = ts.shading ?? null;
      let rp: RP = ts.rp;
      let pp: PP = ts.pp;
      let cb: TableBorders = {};
      for (const name of conds) {
        const c = ts.cond.get(name);
        if (!c) continue;
        if (c.shading !== undefined) shading = c.shading;
        rp = mergeR(rp, c.rp);
        pp = mergeP(pp, c.pp);
        cb = { ...cb, ...c.borders };
      }
      const shd = kid(tcPr, "shd");
      if (shd) shading = color(attr(shd, "fill")) ?? shading;
      const own = parseTableBorders(kid(tcPr, "tcBorders"));
      const pick = (side: keyof TableBorders, fallback: keyof TableBorders): Border | null => {
        if (own[side] !== undefined) return own[side] ?? null;
        if (cb[side] !== undefined) return cb[side] ?? null;
        return borders[fallback] ?? null;
      };
      const firstCell = ci === 0;
      const lastCell = ci === cellEls.length - 1;
      const cellBorders: CellBorders = {
        top: pick("top", isFirst ? "top" : "insideH"),
        bottom: pick("bottom", isLast ? "bottom" : "insideH"),
        left: pick("left", firstCell ? "left" : "insideV"),
        right: pick("right", lastCell ? "right" : "insideV"),
      };
      const va = val(kid(tcPr, "vAlign"));
      col += span;
      return {
        span,
        vMerge: vm ? (val(vm) === "restart" ? "restart" : "continue") : null,
        shading,
        borders: cellBorders,
        vAlign: va === "center" ? "center" : va === "bottom" ? "bottom" : "top",
        margins: { ...margins, ...parseMargins(kid(tcPr, "tcMar")) },
        blocks: blocksOf(tc, ctx, { part: scope.part, table: { rp, pp } }),
      };
    });
    rows.push({
      cells,
      gridBefore,
      header: onOff(kid(trPr, "tblHeader")) ?? false,
      cantSplit: onOff(kid(trPr, "cantSplit")) ?? false,
      height: hVal && hRule !== "auto" ? { value: hVal, rule: hRule === "exact" ? "exact" : "atLeast" } : null,
    });
  });

  // No grid in the file: derive one from the first row's cell widths.
  let cols = grid.filter((g) => g > 0);
  const needed = Math.max(0, ...rows.map((r) => r.gridBefore + r.cells.reduce((n, c) => n + c.span, 0)));
  if (cols.length < needed) {
    const first = rowEls[0];
    const widths = first ? kids(first, "tc").map((tc) => twip(attr(kid(kid(tc, "tcPr"), "tcW"), "w")) ?? 0) : [];
    cols = widths.length >= needed && widths.every((w) => w > 0) ? widths : Array.from({ length: needed }, () => 0);
  }

  if (scope.table === undefined && ctx.inBody) ctx.stats.tables++;
  return {
    kind: "table",
    grid: cols,
    width,
    align: jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : "left",
    indent: twip(attr(kid(tblPr, "tblInd"), "w")) ?? 0,
    rows,
  };
}

// ------------------------------------------------------------------ block containers

/** The blocks one body-level element produces (a paragraph can bring text-box content with it). */
function blocksFrom(c: Element, ctx: Ctx, scope: Scope): Block[] {
  switch (c.localName) {
    case "p": {
      const { para, extra } = buildParagraph(c, ctx, scope);
      return [para, ...extra];
    }
    case "tbl":
      return [buildTable(c, ctx, scope)];
    case "sdt":
      return blocksOf(kid(c, "sdtContent") ?? c, ctx, scope);
    case "customXml":
    case "ins":
    case "moveTo":
      return blocksOf(c, ctx, scope);
    default:
      return []; // bookmarks, deletions, section properties, proofing marks
  }
}

function blocksOf(container: Element, ctx: Ctx, scope: Scope): Block[] {
  return Array.from(container.children).flatMap((c) => blocksFrom(c, ctx, scope));
}

// ------------------------------------------------------------------ sections

async function readHeaderFooter(ctx: Ctx, part: Part, rid: string | null): Promise<Block[] | undefined> {
  if (!rid) return undefined;
  const rel = part.rels.get(rid);
  if (!rel || rel.external) return undefined;
  const f = ctx.zip.file(rel.target);
  if (!f) return undefined;
  const doc = ctx.xml.get(rel.target) ?? parseXml(await f.async("string"));
  ctx.xml.set(rel.target, doc);
  const hfPart = ctx.partRels.get(rel.target) ?? (await readRels(ctx.zip, rel.target));
  ctx.partRels.set(rel.target, hfPart);
  const wasBody = ctx.inBody;
  ctx.inBody = false;
  const blocks = blocksOf(doc.documentElement, ctx, { part: hfPart });
  ctx.inBody = wasBody;
  return blocks;
}

async function sectionProps(el: Element | null, ctx: Ctx, part: Part, prev: SectionProps | null): Promise<SectionProps> {
  const pgSz = kid(el, "pgSz");
  const pgMar = kid(el, "pgMar");
  const m = (n: string, d: number) => Math.abs(twip(attr(pgMar, n)) ?? d);
  const headers: HeaderFooterSet = { ...(prev?.headers ?? {}) };
  const footers: HeaderFooterSet = { ...(prev?.footers ?? {}) };
  for (const ref of kids(el, "headerReference")) {
    const type = (attr(ref, "type") ?? "default") as keyof HeaderFooterSet;
    headers[type] = await readHeaderFooter(ctx, part, attr(ref, "id"));
  }
  for (const ref of kids(el, "footerReference")) {
    const type = (attr(ref, "type") ?? "default") as keyof HeaderFooterSet;
    footers[type] = await readHeaderFooter(ctx, part, attr(ref, "id"));
  }
  const cols = kid(el, "cols");
  const pgNum = kid(el, "pgNumType");
  const type = val(kid(el, "type"));
  const gutter = twip(attr(pgMar, "gutter")) ?? 0;
  let width = twip(attr(pgSz, "w")) ?? prev?.pageWidth ?? 612;
  let height = twip(attr(pgSz, "h")) ?? prev?.pageHeight ?? 792;
  if (attr(pgSz, "orient") === "landscape" && width < height) [width, height] = [height, width];
  return {
    pageWidth: width,
    pageHeight: height,
    margins: { top: m("top", 72), right: m("right", 72), bottom: m("bottom", 72), left: m("left", 72) + gutter, header: m("header", 36), footer: m("footer", 36) },
    headers,
    footers,
    titlePage: onOff(kid(el, "titlePg")) ?? false,
    start: type === "continuous" ? "continuous" : type === "evenPage" ? "evenPage" : type === "oddPage" ? "oddPage" : "nextPage",
    columns: { count: Math.max(1, Math.min(6, num(attr(cols, "num")) ?? 1)), space: twip(attr(cols, "space")) ?? 36 },
    pageNumberStart: num(attr(pgNum, "start")) ?? null,
    pageNumberFormat: attr(pgNum, "fmt") ?? "decimal",
  };
}

// ------------------------------------------------------------------ entry points

function isOle(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 && bytes[4] === 0xa1 && bytes[5] === 0xb1;
}

function hasUtf16(bytes: Uint8Array, text: string): boolean {
  const pattern = Array.from(text).flatMap((c) => [c.charCodeAt(0), 0]);
  const limit = Math.min(bytes.length, 1 << 20) - pattern.length;
  outer: for (let i = 0; i < limit; i++) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return true;
  }
  return false;
}

/** Opens the package and finds the main document part, with a plain-words error for anything that isn't a readable .docx. */
export async function openDocx(bytes: Uint8Array, fileName: string): Promise<{ zip: JSZip; mainPath: string }> {
  if (!bytes.length) throw new WordToPdfError(MESSAGES.empty);
  if (isOle(bytes)) {
    // An OLE compound file is either an encrypted .docx or a Word 97–2003 .doc.
    if (hasUtf16(bytes, "EncryptionInfo") || hasUtf16(bytes, "EncryptedPackage")) throw new WordToPdfError(MESSAGES.encrypted);
    throw new WordToPdfError(MESSAGES.legacy);
  }
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    if (/\.doc$/i.test(fileName) || /^\{\\rtf/.test(new TextDecoder().decode(bytes.subarray(0, 8)))) throw new WordToPdfError(MESSAGES.legacy);
    throw new WordToPdfError(MESSAGES.notWord);
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    throw new WordToPdfError(MESSAGES.damaged);
  }
  let mainPath = "word/document.xml";
  const root = zip.file("_rels/.rels");
  if (root) {
    try {
      const doc = parseXml(await root.async("string"));
      const rel = Array.from(doc.getElementsByTagName("*")).find((e) => e.localName === "Relationship" && /\/officeDocument$/.test(e.getAttribute("Type") ?? ""));
      const target = rel?.getAttribute("Target");
      if (target) mainPath = resolveTarget("", target);
    } catch {
      throw new WordToPdfError(MESSAGES.damaged);
    }
  }
  const main = zip.file(mainPath);
  if (!main || !/document[^/]*\.xml$/.test(mainPath)) {
    if (zip.file("xl/workbook.xml") || zip.file("ppt/presentation.xml") || !Object.keys(zip.files).some((n) => n.startsWith("word/"))) throw new WordToPdfError(MESSAGES.notWord);
    throw new WordToPdfError(MESSAGES.damaged);
  }
  return { zip, mainPath };
}

function mediaType(path: string, bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d)) return "tiff";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "webp";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "emf" || ext === "wmf" || ext === "svg") return ext;
  return "unknown";
}

/** Reads a .docx into the document model. */
export async function parseDocx(bytes: Uint8Array, fileName = "document.docx"): Promise<DocModel> {
  const { zip, mainPath } = await openDocx(bytes, fileName);
  try {
    return await parsePackage(zip, mainPath);
  } catch (e) {
    if (e instanceof WordToPdfError) throw e;
    throw new WordToPdfError(MESSAGES.damaged);
  }
}

async function parsePackage(zip: JSZip, mainPath: string): Promise<DocModel> {
  const read = async (path: string | undefined) => {
    if (!path) return null;
    const f = zip.file(path);
    return f ? parseXml(await f.async("string")) : null;
  };
  const part = await readRels(zip, mainPath);
  const relOfType = (suffix: string) => [...part.rels.values()].find((r) => !r.external && r.target.endsWith(suffix))?.target;
  const byType = async (suffix: string, fallback: string) => (await read(relOfType(suffix))) ?? (await read(fallback));

  const ctx: Ctx = {
    zip,
    theme: readTheme(await byType("theme1.xml", "word/theme/theme1.xml")),
    styles: new Map(),
    defaultParaStyle: null,
    defaultTableStyle: null,
    defaults: { rp: {}, pp: {} },
    abstracts: new Map(),
    nums: new Map(),
    counters: new Map(),
    seenNums: new Set(),
    mediaPaths: new Set(),
    footnoteMarks: new Map(),
    stats: { paragraphs: 0, tables: 0, images: 0, textBoxes: 0, equations: 0, rtl: false },
    xml: new Map(),
    partRels: new Map(),
    inBody: true,
    noteMark: null,
  };
  readStyles(await byType("styles.xml", "word/styles.xml"), ctx);
  readNumbering(await byType("numbering.xml", "word/numbering.xml"), ctx);
  const settings = await byType("settings.xml", "word/settings.xml");
  const sroot = settings?.documentElement ?? null;
  const evenAndOddHeaders = onOff(kid(sroot, "evenAndOddHeaders")) ?? false;
  const defaultTab = twip(val(kid(sroot, "defaultTabStop"))) || 36;

  const main = (await read(mainPath))!;
  const body = kid(main.documentElement, "body");
  if (!body) throw new WordToPdfError(MESSAGES.damaged);

  // Body blocks, split into sections at each paragraph that carries a sectPr.
  const pending: { sectPr: Element | null; blocks: Block[] }[] = [];
  let current: Block[] = [];
  const topLevel = (container: Element) => {
    for (const c of Array.from(container.children)) {
      if (c.localName === "sdt" || c.localName === "customXml") {
        topLevel(kid(c, "sdtContent") ?? c);
        continue;
      }
      if (c.localName === "sectPr") continue;
      current.push(...blocksFrom(c, ctx, { part }));
      const sect = c.localName === "p" ? kid(kid(c, "pPr"), "sectPr") : null;
      if (sect) {
        pending.push({ sectPr: sect, blocks: current });
        current = [];
      }
    }
  };
  topLevel(body);
  pending.push({ sectPr: kid(body, "sectPr"), blocks: current });

  const sections: Section[] = [];
  let prev: SectionProps | null = null;
  for (const s of pending) {
    const props: SectionProps = await sectionProps(s.sectPr, ctx, part, prev);
    sections.push({ props, blocks: s.blocks });
    prev = props;
  }
  // Drop a trailing empty section that only held the final sectPr after an explicit section break.
  if (sections.length > 1 && sections[sections.length - 1].blocks.length === 0) sections.pop();

  // Footnotes and endnotes that the text refers to.
  const footnotes = new Map<string, Block[]>();
  if (ctx.footnoteMarks.size) {
    for (const [kind, suffix, fallback] of [
      ["f", "footnotes.xml", "word/footnotes.xml"],
      ["e", "endnotes.xml", "word/endnotes.xml"],
    ] as const) {
      const path = relOfType(suffix) ?? fallback;
      const doc = await read(path);
      if (!doc) continue;
      const notePart = await readRels(zip, path);
      ctx.inBody = false;
      for (const n of kids(doc.documentElement, kind === "f" ? "footnote" : "endnote")) {
        const key = `${kind}:${attr(n, "id")}`;
        const mark = ctx.footnoteMarks.get(key);
        if (!mark) continue;
        ctx.noteMark = mark;
        footnotes.set(key, blocksOf(n, ctx, { part: notePart }));
      }
      ctx.noteMark = null;
    }
  }

  // Pictures.
  const media = new Map<string, Media>();
  for (const path of ctx.mediaPaths) {
    const f = zip.file(path);
    if (!f) continue;
    const bytes = await f.async("uint8array");
    media.set(path, { bytes, type: mediaType(path, bytes) });
  }

  let title: string | null = null;
  const core = await read("docProps/core.xml");
  if (core) title = Array.from(core.getElementsByTagName("*")).find((e) => e.localName === "title")?.textContent?.trim() || null;

  return { sections, footnotes, media, evenAndOddHeaders, defaultTab, title, stats: ctx.stats };
}

/** Quick facts for the file card: Word's own page count (as last saved), pictures and tables. */
export async function analyzeDocx(bytes: Uint8Array, fileName: string): Promise<{ pages: number | null; words: number | null }> {
  const { zip } = await openDocx(bytes, fileName);
  const app = zip.file("docProps/app.xml");
  if (!app) return { pages: null, words: null };
  try {
    const doc = parseXml(await app.async("string"));
    const find = (n: string) => Array.from(doc.getElementsByTagName("*")).find((e) => e.localName === n)?.textContent;
    const pages = Number(find("Pages"));
    const words = Number(find("Words"));
    return { pages: pages > 0 ? pages : null, words: words > 0 ? words : null };
  } catch {
    return { pages: null, words: null };
  }
}
