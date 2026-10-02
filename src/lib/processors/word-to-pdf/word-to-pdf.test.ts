// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { convertWordToPdf, WordToPdfError } from "./index";
import { parseDocx } from "./parse";
import { padGlyphs, substitutedFonts, verticalMetrics, type FaceKey, type FontApi } from "./fonts";
import { decoratePages, layoutDocument } from "./layout";
import type { Block, Border, Cell, DocModel, Paragraph, Row, RunStyle, Table } from "./model";

// The parser uses the browser's DOMParser; pdf.js wants plain Node — so Node plus jsdom's parser.
beforeAll(() => {
  (globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM().window.DOMParser;
});

const FIX = "e2e/fixtures/docx";
const read = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIX, name)));
const fontLoader = async (key: FaceKey) => new Uint8Array(fs.readFileSync(path.join("public/fonts/word", `${key}.ttf`)));
const convert = (name: string) => convertWordToPdf({ name, bytes: read(name) }, { fontLoader });

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? " " : "") : "")).join("").replace(/\s+/g, " "));
  }
  return pages;
}

const paragraphs = (m: DocModel) => m.sections.flatMap((s) => s.blocks).filter((b): b is Paragraph => b.kind === "p");
const textOf = (p: Paragraph) => p.inlines.map((i) => (i.kind === "text" ? i.text : "")).join("");

describe("parseDocx (independently written python-docx files)", () => {
  it("resolves heading styles through the style chain to outline levels and larger type", async () => {
    const m = await parseDocx(read("WORD-02-headings.docx"));
    const byText = new Map(paragraphs(m).map((p) => [textOf(p), p]));
    expect(byText.get("Annual Report 2026")?.props.outline).toBe(1);
    expect(byText.get("Operations")?.props.outline).toBe(2);
    expect(byText.get("Staffing")?.props.outline).toBe(3);
    const body = paragraphs(m).find((p) => textOf(p).startsWith("Customer"))!;
    const h1 = byText.get("Annual Report 2026")!;
    const size = (p: Paragraph) => (p.inlines[0] as { style: RunStyle }).style.size;
    expect(size(h1)).toBeGreaterThan(size(body));
    expect(body.props.outline).toBeNull();
  });

  it("numbers lists the way Word does: bullets, 1–4, and nested levels", async () => {
    const m = await parseDocx(read("WORD-04-lists.docx"));
    const labels = paragraphs(m).map((p) => [textOf(p), p.label?.text ?? null, p.props.indLeft] as const);
    const get = (t: string) => labels.find((l) => l[0] === t)!;
    expect(get("Passport and tickets")[1]).toBe("•");
    expect(["Book the venue", "Send the invitations", "Order the food", "Confirm the numbers"].map((t) => get(t)[1])).toEqual(["1.", "2.", "3.", "4."]);
    expect(get("Spare socks")[1]).toBeTruthy();
    expect(get("Spare socks")[2]).toBeGreaterThan(get("Passport and tickets")[2]);
    expect(get("Packing list")[1]).toBeNull();
  });

  it("reads tables with their grid, borders and cell text", async () => {
    const m = await parseDocx(read("WORD-05-table.docx"));
    const table = m.sections[0].blocks.find((b) => b.kind === "table")!;
    expect(table.kind).toBe("table");
    if (table.kind !== "table") return;
    expect(table.rows).toHaveLength(5);
    expect(table.rows[0].cells).toHaveLength(4);
    expect(table.grid.every((g) => g > 0)).toBe(true);
    expect(table.rows[1].cells[0].borders.top).not.toBeNull();
    const cellText = (r: number, c: number) => table.rows[r].cells[c].blocks.map((b) => (b.kind === "p" ? textOf(b) : "")).join("");
    expect(cellText(0, 0)).toBe("Region");
    expect(cellText(4, 3)).toBe("$9,975");
  });

  it("finds headers, footers and PAGE / NUMPAGES fields", async () => {
    const m = await parseDocx(read("WORD-10-header-footer.docx"));
    const props = m.sections[0].props;
    expect(props.headers.default?.length).toBeGreaterThan(0);
    const footer = props.footers.default![0] as Paragraph;
    expect(footer.inlines.filter((i) => i.kind === "field").map((i) => (i as { field: string }).field)).toEqual(["PAGE", "NUMPAGES"]);
    expect(paragraphs(m).some((p) => p.inlines.some((i) => i.kind === "break" && i.type === "page"))).toBe(true);
  });

  it("keeps every special character as written", async () => {
    const m = await parseDocx(read("WORD-08-special-characters.docx"));
    const all = paragraphs(m).map(textOf).join(" ");
    for (const s of ["€120.50", "₹1,250", "✓", "™", "“double”", "‘single’", "niño", "Łódź", "Ελληνικά", "Русский", "½", "≤", "→"]) expect(all).toContain(s);
  });

  it("refuses damaged, legacy, encrypted, empty and fake files with plain words", async () => {
    const cases: [string, RegExp][] = [
      ["WORD-13-corrupt.docx", /couldn.t be read/],
      ["X-legacy.doc", /older \.doc/],
      ["X-encrypted.docx", /password-protected/],
      ["X-fake.docx", /isn.t a Word document/],
      ["X-zero-byte.docx", /empty/],
    ];
    for (const [name, message] of cases) {
      const err = await parseDocx(read(name), name).catch((e) => e);
      expect(err, name).toBeInstanceOf(WordToPdfError);
      expect(err.message, name).toMatch(message);
    }
  });
});

describe("layout (fake metrics: every character 0.5 em wide)", () => {
  const fonts: FontApi = {
    measure: (t, s) => Array.from(t).length * s.size * 0.5,
    segments: (t, s) => [{ face: "carlito-r", text: t, width: Array.from(t).length * s.size * 0.5 }],
    metrics: (s) => (s.vm ? { ascent: s.vm.ascent * s.size, descent: s.vm.descent * s.size, height: (s.vm.ascent + s.vm.descent) * s.size } : { ascent: s.size * 0.8, descent: s.size * 0.2, height: s.size * 1.2 }),
    underline: (s) => ({ offset: s.size * 0.1, thickness: 0.5 }),
  };
  const style: RunStyle = { family: "carlito", fontName: "Calibri", size: 10, bold: false, italic: false, underline: false, strike: false, color: null, highlight: null, vert: null, caps: false, hidden: false };
  const para = (text: string, props: Partial<Paragraph["props"]> = {}): Paragraph => ({
    kind: "p",
    inlines: [{ kind: "text", text, style }],
    markStyle: style,
    label: null,
    floats: [],
    props: { align: "left", indLeft: 0, indRight: 0, indFirst: 0, spaceBefore: 0, spaceAfter: 0, line: { rule: "auto", value: 1 }, keepNext: false, keepLines: false, pageBreakBefore: false, contextualSpacing: false, widowControl: false, tabs: [], borders: {}, shading: null, styleId: "Normal", outline: null, ...props },
  });
  const model = (blocks: Block[], height = 792): DocModel => ({
    sections: [
      {
        blocks,
        props: { pageWidth: 300, pageHeight: height, margins: { top: 50, bottom: 50, left: 50, right: 50, header: 20, footer: 20 }, headers: {}, footers: {}, titlePage: false, start: "nextPage", columns: { count: 1, space: 36 }, pageNumberStart: null, pageNumberFormat: "decimal" },
      },
    ],
    footnotes: new Map(),
    media: new Map(),
    evenAndOddHeaders: false,
    defaultTab: 36,
    title: null,
    stats: { paragraphs: 0, tables: 0, images: 0, textBoxes: 0, equations: 0, rtl: false },
  });
  const env = { fonts, defaultTab: 36, field: () => "1", footnotes: new Map() };
  const texts = (m: DocModel) => layoutDocument(m, env).map((p) => p.ops.filter((o) => o.t === "text").map((o) => o as { text: string; x: number; y: number }));

  it("wraps at spaces inside the text width (200 pt = 40 characters at 10 pt)", () => {
    const [page] = texts(model([para("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj")]));
    const lines = new Map<number, string>();
    for (const t of page) lines.set(t.y, (lines.get(t.y) ?? "") + t.text);
    const widths = [...lines.values()].map((l) => l.trimEnd().length);
    expect(widths.every((w) => w <= 40)).toBe(true);
    expect([...lines.values()].join("").replace(/\s+/g, " ").trim()).toBe("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj");
  });

  it("centers and right-aligns within the margins", () => {
    const [page] = texts(model([para("abcd", { align: "center" }), para("abcd", { align: "right" })]));
    expect(page[0].x).toBeCloseTo(50 + (200 - 20) / 2);
    expect(page[1].x).toBeCloseTo(50 + 200 - 20);
  });

  it("starts a new page on a page break and keeps a heading with the paragraph after it", () => {
    const withBreak = para("before");
    withBreak.inlines.push({ kind: "break", type: "page", style }, { kind: "text", text: "after", style });
    expect(texts(model([withBreak])).map((p) => p.map((t) => t.text).join(""))).toEqual(["before", "after"]);

    // 7 lines fit on a 150 pt page (50 top + 50 bottom margins, 12 pt lines).
    const filler = Array.from({ length: 3 }, (_, i) => para(`line ${i}`));
    const heading = para("Heading", { keepNext: true });
    const pages = texts(model([...filler, heading, para("x ".repeat(60)), para("tail")], 134));
    const headingPage = pages.findIndex((p) => p.some((t) => t.text === "Heading"));
    const bodyPage = pages.findIndex((p) => p.some((t) => t.text.startsWith("x ")));
    expect(headingPage).toBe(bodyPage);
  });

  const baselines = (page: { y: number }[]) => [...new Set(page.map((t) => t.y))].sort((a, b) => a - b);

  it("collapses paragraph spacing to the larger of space after and space before, as Word does", () => {
    const [page] = texts(model([para("one", { spaceAfter: 12 }), para("two", { spaceBefore: 6 })]));
    const [a, b] = baselines(page);
    expect(b - a).toBeCloseTo(12 + 12, 5);
  });

  it("lays lines out in whole twips, rounding each line up", () => {
    const line = { rule: "auto" as const, value: 1.08 };
    const [page] = texts(model([para("one", { line }), para("two", { line })]));
    const [a, b] = baselines(page);
    expect(b - a).toBeCloseTo(13, 5); // 12 × 1.08 = 12.96 pt → 260 twips
  });

  it("a paragraph ending in a page break leaves neither an empty line nor space before on the next page", () => {
    const brk = para("before");
    brk.inlines.push({ kind: "break", type: "page", style });
    const pages = texts(model([brk, para("after", { spaceBefore: 24 })]));
    expect(pages.map((p) => p.map((t) => t.text).join(""))).toEqual(["before", "after"]);
    expect(pages[1][0].y).toBeCloseTo(pages[0][0].y, 5);
    // Two breaks in a row still give a blank page between.
    const only = () => ({ ...para(""), inlines: [{ kind: "break" as const, type: "page" as const, style }] });
    expect(texts(model([para("a"), only(), only(), para("z")])).map((p) => p.map((t) => t.text).join(""))).toEqual(["a", "", "z"]);
  });

  it("spaces lines by the requested font's own height when it is drawn with a substitute", () => {
    const cambria: RunStyle = { ...style, fontName: "Cambria", family: "serif" };
    const p = (t: string): Paragraph => ({ ...para(t), inlines: [{ kind: "text", text: t, style: cambria }], markStyle: cambria });
    const [a, b] = baselines(texts(model([p("one"), p("two")]))[0]);
    expect(b - a).toBeCloseTo(Math.ceil(((1900 + 500) / 2048) * 10 * 20) / 20, 5); // 11.72 pt → 11.75
    expect(verticalMetrics("Calibri")).toBeUndefined(); // metric-compatible substitute: its own metrics
  });

  it("names the fonts that are drawn with a similar but not identical font", () => {
    const run = (fontName: string, text: string): Paragraph => {
      const s: RunStyle = { ...style, fontName };
      return { ...para(text), inlines: [{ kind: "text", text, style: s }], markStyle: s };
    };
    expect(substitutedFonts(model([run("Calibri", "a".repeat(400)), run("Arial", "b".repeat(100))]))).toEqual([]);
    expect(substitutedFonts(model([run("Georgia", "a".repeat(400)), run("Cambria", "b".repeat(100)), run("Calibri", "c".repeat(100))]))).toEqual(["Georgia", "Cambria"]);
    // A font on a sliver of the text (a symbol, a logo word) isn't worth a notice; symbol fonts never are.
    expect(substitutedFonts(model([run("Calibri", "a".repeat(990)), run("Garamond", "b".repeat(10)), run("Wingdings", "c".repeat(200))]))).toEqual([]);
  });

  const cell = (text: string, borders: Partial<Cell["borders"]> = {}): Cell => ({ span: 1, vMerge: null, shading: null, borders: { top: null, bottom: null, left: null, right: null, ...borders }, vAlign: "top", margins: { top: 0, bottom: 0, left: 0, right: 0 }, blocks: [para(text)] });
  const row = (cells: Cell[], header = false): Row => ({ cells, gridBefore: 0, header, cantSplit: false, height: null });
  const table = (rows: Row[]): Table => ({ kind: "table", grid: [100, 100], width: null, align: "left", indent: 0, rows });

  it("gives each table row its bottom border's thickness on top of its content", () => {
    const bd: Border = { width: 2, color: "000000", space: 0 };
    const [page] = texts(model([table([row([cell("r1", { bottom: bd }), cell("a", { bottom: bd })]), row([cell("r2", { bottom: bd }), cell("b", { bottom: bd })])])]));
    const r1 = page.find((t) => t.text === "r1")!;
    const r2 = page.find((t) => t.text === "r2")!;
    expect(r2.y - r1.y).toBeCloseTo(12 + 2, 5);
  });

  it("repeats the header row above the rest of a row that breaks across pages", () => {
    const big = cell("l0");
    big.blocks = Array.from({ length: 14 }, (_, i) => para(`l${i}`));
    const pages = texts(model([table([row([cell("H"), cell("H2")], true), row([big, cell("v")])])], 200));
    const withRows = pages.filter((p) => p.some((t) => /^l\d+$/.test(t.text)));
    expect(withRows.length).toBeGreaterThan(1);
    for (const p of withRows) expect(p.some((t) => t.text === "H")).toBe(true);
    expect(new Set(pages.flat().filter((t) => /^l\d+$/.test(t.text)).map((t) => t.text)).size).toBe(14);
  });

  it("prints real page numbers in footers", () => {
    const m = model([para("one"), para("two", { pageBreakBefore: true })]);
    const footer = para("Page ");
    footer.inlines.push({ kind: "field", field: "PAGE", style }, { kind: "text", text: " of ", style }, { kind: "field", field: "NUMPAGES", style });
    m.sections[0].props.footers = { default: [footer] };
    const pages = layoutDocument(m, env);
    decoratePages(pages, m, env);
    const footerText = pages.map((p) =>
      p.ops
        .filter((o) => o.t === "text" && o.y > 700)
        .map((o) => (o as { text: string }).text)
        .join(""),
    );
    expect(footerText).toEqual(["Page 1 of 2", "Page 2 of 2"]);
  });
});

describe("padGlyphs", () => {
  it("re-aligns Carlito's odd-length glyphs without changing a single outline", () => {
    const original = new Uint8Array(fs.readFileSync("public/fonts/word/carlito-r.ttf"));
    const padded = padGlyphs(original);
    expect(padded).not.toBe(original);
    const a = fontkit.create(original);
    const b = fontkit.create(padded);
    expect(b.numGlyphs).toBe(a.numGlyphs);
    for (const ch of "Project Falcon ₹✓") {
      const cp = ch.codePointAt(0)!;
      if (!a.hasGlyphForCodePoint(cp)) continue;
      expect(b.glyphForCodePoint(cp).path.toSVG()).toBe(a.glyphForCodePoint(cp).path.toSVG());
    }
    // Fonts that are already aligned are passed through untouched.
    const sans = new Uint8Array(fs.readFileSync("public/fonts/word/sans-r.ttf"));
    expect(padGlyphs(sans)).toBe(sans);
  });
});

/** A minimal hand-written package: footnotes, a two-column section and a table taller than a page. */
async function handMadeDocx(): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const cols = Array.from({ length: 40 }, (_, i) => p(`Column text ${i + 1} with enough words to wrap inside a narrow column.`)).join("");
  const rows = Array.from({ length: 70 }, (_, i) => `<w:tr><w:tc>${p(`Row ${i + 1}`)}</w:tc><w:tc>${p(`Value ${i + 1}`)}</w:tc></w:tr>`).join("");
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>
    <w:p><w:r><w:t xml:space="preserve">A sentence with a note</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r><w:r><w:t>.</w:t></w:r></w:p>
    <w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:pPr></w:p>
    ${cols}
    <w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/><w:cols w:num="2" w:space="720"/></w:sectPr></w:pPr></w:p>
    <w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${p("Name")}</w:tc><w:tc>${p("Amount")}</w:tc></w:tr>${rows}</w:tbl>
    <w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p("Merged across")}</w:tc><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p("Merged down")}</w:tc></w:tr>
      <w:tr><w:tc>${p("A")}</w:tc><w:tc>${p("B")}</w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>
    <w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>
  </w:body></w:document>`;
  const notes = `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote><w:footnote w:id="1"><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The footnote text.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>`);
  zip.file("word/document.xml", doc);
  zip.file("word/footnotes.xml", notes);
  return zip.generateAsync({ type: "uint8array" });
}

describe("footnotes, columns and long tables (hand-made package)", () => {
  it("puts the footnote at the bottom of its page, flows two columns, and repeats the header row", async () => {
    const r = await convertWordToPdf({ name: "hand.docx", bytes: await handMadeDocx() }, { fontLoader });
    const doc = await pdfjs.getDocument({ data: r.bytes.slice(), verbosity: 0 }).promise;
    const items = async (n: number) => ((await (await doc.getPage(n)).getTextContent()).items as { str: string; transform: number[] }[]).filter((i) => i.str.trim());
    const first = await items(1);
    const note = first.find((i) => i.str.includes("The footnote text"))!;
    const body = first.find((i) => i.str.includes("A sentence with a note"))!;
    expect(note).toBeTruthy();
    expect(note.transform[5]).toBeLessThan(150); // near the bottom margin (PDF y grows upwards)
    expect(body.transform[5]).toBeGreaterThan(600);
    // Two columns: column text starts at two different x positions on the page.
    const colX = new Set(first.filter((i) => i.str.startsWith("Column text")).map((i) => Math.round(i.transform[4])));
    expect(colX.size).toBe(2);
    // The table starts on a new page and runs over more than one; "Name" heads every table page.
    const all = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => items(i + 1)));
    const tablePages = all.filter((p) => p.some((i) => /^Row \d+$/.test(i.str)));
    expect(tablePages.length).toBeGreaterThan(1);
    for (const p of tablePages) expect(p.some((i) => i.str === "Name")).toBe(true);
    const rowsSeen = new Set(all.flat().filter((i) => /^Row \d+$/.test(i.str)).map((i) => i.str));
    expect(rowsSeen.size).toBe(70);
    // Merged cells: text appears once; "Merged across" spans two grid columns, so B starts right of it.
    const flat = all.flat();
    expect(flat.filter((i) => i.str === "Merged down")).toHaveLength(1);
    const across = flat.find((i) => i.str === "Merged across")!;
    const b = flat.find((i) => i.str === "B")!;
    const down = flat.find((i) => i.str === "Merged down")!;
    expect(down.transform[4]).toBeGreaterThan(b.transform[4]);
    expect(across.transform[4]).toBeLessThan(b.transform[4]);
  }, 60_000);
});

describe("convertWordToPdf end to end", () => {
  it("produces a valid PDF with the header on every page and correct page numbers", async () => {
    const r = await convert("WORD-10-header-footer.docx");
    expect(r.pages).toBe(3);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(3);
    const pages = await pdfText(r.bytes);
    pages.forEach((t, i) => {
      expect(t).toContain("ACME Corporation — Confidential");
      expect(t).toContain(`Page ${i + 1} of 3`);
      expect(t).toContain(`Chapter ${i + 1}`);
    });
  }, 60_000);

  it("draws every special character with a real glyph (text extracts unchanged)", async () => {
    const r = await convert("WORD-08-special-characters.docx");
    const text = (await pdfText(r.bytes)).join(" ");
    for (const s of ["€120.50", "£99.99", "₹1,250", "✓ done", "™", "“double”", "‘single’", "niño", "Zürich", "Łódź", "Ελληνικά", "Русский", "½", "≈", "→"]) expect(text).toContain(s);
    // No missing glyphs; the only note is the honest one about the headings' theme font (Cambria).
    expect(r.notes).toEqual(["Cambria isn't available here, so it's drawn with a similar font. Lines may break in slightly different places than in Word."]);
  }, 60_000);

  it("embeds the pictures and keeps lists and tables as text", async () => {
    const images = await convert("WORD-06-images.docx");
    expect(images.pictures).toBe(2);
    const lists = (await pdfText((await convert("WORD-04-lists.docx")).bytes)).join(" ");
    expect(lists).toMatch(/1\.\s*Book the venue/);
    expect(lists).toMatch(/4\.\s*Confirm the numbers/);
    expect(lists).toContain("•");
    const table = (await pdfText((await convert("WORD-05-table.docx")).bytes)).join(" ");
    for (const s of ["Region", "North", "$12,400", "$9,975"]) expect(table).toContain(s);
  }, 60_000);

  it("keeps links, landscape sections and heading bookmarks", async () => {
    const r = await convert("WORD-12-complex.docx");
    const doc = await pdfjs.getDocument({ data: r.bytes.slice(), verbosity: 0 }).promise;
    const outline = await doc.getOutline();
    expect(outline?.map((o) => o.title)).toContain("1. Highlights");
    const first = await doc.getPage(1);
    const links = (await first.getAnnotations()).filter((a) => a.subtype === "Link").map((a) => a.url);
    expect(links).toContain("https://example.com/falcon");
    const last = await doc.getPage(doc.numPages);
    const [, , w, h] = last.view;
    expect(w).toBeGreaterThan(h);
  }, 60_000);
});
