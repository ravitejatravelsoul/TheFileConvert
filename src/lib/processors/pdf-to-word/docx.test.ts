import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildDocx, verifyDocx, xmlText } from "./docx";
import type { Block, ParaFormat, PageLayout, Run, TableRow } from "./layout";

const run = (text: string, extra: Partial<Run> = {}): Run => ({ text, bold: false, italic: false, size: 11, ...extra });
const fmt = (extra: Partial<ParaFormat> = {}): ParaFormat => ({ align: "left", indLeft: 0, indRight: 0, indFirst: 0, spaceBefore: 0, line: null, tabs: [], ...extra });
// A 1×1 transparent PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const cell = (text: string, extra: Partial<TableRow["cells"][number]> = {}) => ({ paragraphs: [{ runs: [run(text)], align: "left" as const }], span: 1, ...extra });
const table = (rows: TableRow[], extra: Partial<Extract<Block, { kind: "table" }>> = {}): Block => ({
  kind: "table",
  columns: [100, 100],
  rows,
  bordered: true,
  border: { thickness: 0.5, color: "000000" },
  indent: 0,
  spaceBefore: 0,
  cellMargin: { left: 5.4, right: 5.4, top: 0 },
  ...extra,
});
const pageOf = (blocks: Block[], extra: Partial<PageLayout> = {}): PageLayout => ({
  width: 612,
  height: 792,
  margins: { left: 72, right: 72, top: 54, bottom: 54 },
  blocks,
  floating: [],
  header: null,
  footer: null,
  headerDistance: 36,
  footerDistance: 36,
  ...extra,
});

const pages: PageLayout[] = [
  pageOf(
    [
      { kind: "paragraph", style: "h1", align: "center", runs: [run("Report", { size: 24, bold: true })], fmt: fmt({ align: "center" }) },
      { kind: "paragraph", style: "normal", align: "left", runs: [run("Plain, "), run("bold", { bold: true }), run(" and "), run("italic", { italic: true }), run(" — niño €120 ✓ Ελληνικά")], fmt: fmt() },
      { kind: "list", ordered: false, start: 1, listKey: 1, runs: [run("A bullet")], bullet: "•", label: run("•"), fmt: fmt({ indLeft: 18, indFirst: -18 }) },
      { kind: "list", ordered: true, start: 3, listKey: 2, runs: [run("Step three")], bullet: "%1.", label: run("3."), fmt: fmt({ indLeft: 18, indFirst: -18 }) },
      table([
        { height: 18, cells: [cell("a"), cell("b")] },
        { height: 18, cells: [cell("c"), cell("d")] },
      ]),
      { kind: "image", image: { x: 0, y: 0, w: 100, h: 50, bytes: PNG, mime: "image/png", pxWidth: 1, pxHeight: 1 }, width: 100, height: 50, fmt: fmt() },
    ],
    {
      header: [{ runs: [run("Evergreen Community Bank", { bold: true, color: "385723" })], align: "left" }],
      footer: [{ runs: [run("Page "), run("1", { field: "PAGE" }), run(" of "), run("2", { field: "NUMPAGES" })], align: "center" }],
    },
  ),
  pageOf([{ kind: "paragraph", style: "normal", align: "left", runs: [run("Landscape page")], fmt: fmt() }], { width: 792, height: 612 }),
];

async function documentOf(p: PageLayout[], bodyFont = "Calibri") {
  const zip = await JSZip.loadAsync(await buildDocx(p, { title: "test", bodySize: 11, bodyFont }));
  const xml = await zip.file("word/document.xml")!.async("string");
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const q = (tag: string, root: Document | Element = dom) => Array.from(root.getElementsByTagNameNS(W, tag));
  const attr = (e: Element, name: string) => e.getAttributeNS(W, name);
  return { zip, xml, dom, q, attr };
}

describe("buildDocx", () => {
  it("writes a valid Word package with every part and relationship in place", async () => {
    const bytes = await buildDocx(pages, { title: "test", bodySize: 11, bodyFont: "Calibri" });
    expect(await verifyDocx(bytes)).toEqual([]);
    const zip = await JSZip.loadAsync(bytes);
    // No folder entries (Word writes parts only).
    expect(Object.values(zip.files).some((f) => f.dir)).toBe(false);
    expect(zip.file("word/media/image1.png")).toBeTruthy();
  });

  it("keeps structure: heading style, bold/italic runs, list numbering, table, picture, one section per page", async () => {
    const { zip, xml, dom, q, attr } = await documentOf(pages);
    expect(q("pStyle").map((e) => attr(e, "val"))).toEqual(["Heading1", "ListParagraph", "ListParagraph"]);
    expect(q("b").length).toBeGreaterThanOrEqual(2);
    expect(q("i").length).toBeGreaterThanOrEqual(1);
    expect(q("tbl")).toHaveLength(1);
    expect(q("tr")).toHaveLength(2);
    expect(dom.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "inline")).toHaveLength(1);
    const sections = q("sectPr");
    expect(sections).toHaveLength(2);
    expect(attr(q("pgSz", sections[1])[0], "orient")).toBe("landscape");
    expect(xml).toContain("niño €120 ✓ Ελληνικά");
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>');
    expect(numbering).toContain('<w:startOverride w:val="3"/>');
  });

  it("writes the running header and footer once, with live page-number fields", async () => {
    const { zip, q, attr } = await documentOf(pages);
    const refs = q("headerReference");
    expect(refs.length).toBeGreaterThan(0);
    const header = await zip.file("word/header1.xml")!.async("string");
    expect(header).toContain("Evergreen Community Bank");
    expect(header).toContain('<w:color w:val="385723"/>');
    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(footer).toMatch(/<w:instrText[^>]*> PAGE <\/w:instrText>/);
    expect(footer).toMatch(/<w:instrText[^>]*> NUMPAGES <\/w:instrText>/);
    // The landscape page has no header of its own.
    expect(zip.file("word/header2.xml")).toBeNull();
    expect(attr(q("pgMar")[0], "header")).toBe("720");
  });

  it("keeps fonts other than the body font, colours, underline and exact line spacing", async () => {
    const p = [
      pageOf([
        {
          kind: "paragraph",
          style: "normal",
          align: "justify",
          runs: [run("Body "), run("Mono", { font: "Courier New" }), run(" red", { color: "c00000", underline: true })],
          fmt: fmt({ align: "justify", line: 14.5, spaceBefore: 6, indLeft: 36, indRight: 18.25, indFirst: 12 }),
        },
      ]),
    ];
    const { q, attr, zip } = await documentOf(p);
    const fonts = q("rFonts").map((e) => attr(e, "ascii"));
    expect(fonts).toEqual(["Courier New"]); // the body font comes from the document defaults
    expect((await zip.file("word/styles.xml")!.async("string")).includes('w:ascii="Calibri"')).toBe(true);
    expect(attr(q("color")[0], "val")).toBe("C00000");
    expect(attr(q("u")[0], "val")).toBe("single");
    const spacing = q("spacing")[0];
    expect([attr(spacing, "before"), attr(spacing, "line"), attr(spacing, "lineRule")]).toEqual(["120", "290", "exact"]);
    const ind = q("ind")[0];
    expect([attr(ind, "left"), attr(ind, "right"), attr(ind, "firstLine")]).toEqual(["720", "365", "240"]);
    expect(attr(q("jc")[0], "val")).toBe("both");
  });

  it("writes right tabs with dot leaders and a rule under a paragraph", async () => {
    const p = [
      pageOf([
        {
          kind: "paragraph",
          style: "normal",
          align: "left",
          runs: [run("Introduction\t3")],
          fmt: fmt({ tabs: [{ pos: 468, align: "right", leader: "dot" }], borderBottom: { thickness: 0.75, color: "2f5496", space: 1 } }),
        },
      ]),
    ];
    const { q, attr, xml } = await documentOf(p);
    const tab = q("tab").find((t) => t.parentElement?.localName === "tabs")!;
    expect([attr(tab, "val"), attr(tab, "pos"), attr(tab, "leader")]).toEqual(["right", "9360", "dot"]);
    expect(xml).toMatch(/<w:pBdr><w:bottom w:val="single" w:sz="6"[^>]*w:color="2F5496"/);
  });

  it("pins a table with text beside it to the page, and merges cells", async () => {
    const p = [
      pageOf([
        table(
          [
            { height: 20, cells: [cell("Wide", { span: 2, shading: "e2efda" })] },
            { height: 20, cells: [cell("Tall", { vMerge: "restart" }), cell("x")] },
            { height: 20, cells: [cell("", { vMerge: "continue" }), cell("y")] },
          ],
          { float: { x: 320, y: 90 } },
        ),
      ]),
    ];
    const { q, attr } = await documentOf(p);
    const pos = q("tblpPr")[0];
    expect([attr(pos, "horzAnchor"), attr(pos, "vertAnchor"), attr(pos, "tblpX"), attr(pos, "tblpY")]).toEqual(["page", "page", "6400", "1800"]);
    expect(q("tblInd")).toHaveLength(0);
    expect(attr(q("gridSpan")[0], "val")).toBe("2");
    expect(q("vMerge").map((e) => attr(e, "val"))).toEqual(["restart", null]);
    expect(attr(q("shd")[0], "fill")).toBe("E2EFDA");
    expect(attr(q("trHeight")[0], "hRule")).toBe("atLeast");
  });

  it("the verifier rejects a broken package", async () => {
    const zip = await JSZip.loadAsync(await buildDocx(pages, { title: "test", bodySize: 11, bodyFont: "Calibri" }));
    zip.file("word/document.xml", "<w:document><unclosed>");
    expect((await verifyDocx(await zip.generateAsync({ type: "uint8array" }))).length).toBeGreaterThan(0);
    zip.remove("word/media/image1.png");
    expect((await verifyDocx(await zip.generateAsync({ type: "uint8array" }))).some((p) => p.includes("missing word/media/image1.png"))).toBe(true);
  });
});

describe("xmlText", () => {
  it("escapes markup and drops only characters XML can't hold", () => {
    expect(xmlText('a < b & "c" > d')).toBe("a &lt; b &amp; &quot;c&quot; &gt; d");
    expect(xmlText("tab\u0001bell\u0007")).toBe("tabbell");
    expect(xmlText("café ✓ €5 “q” 中文")).toBe("café ✓ €5 “q” 中文");
  });
});

describe("buildDocx — scanned-form structure", () => {
  it("writes a page border, a rule paragraph, cell tabs and space before, at Word's border widths", async () => {
    const rows: TableRow[] = [{ height: 24, cells: [{ paragraphs: [{ runs: [run("VALID FROM\t02/08/2026")], align: "left", tabs: [{ pos: 91, align: "left" }], spaceBefore: 6 }], span: 1 }] }];
    const p = pageOf(
      [
        { kind: "rule", indLeft: 0, width: 300, thickness: 1, color: "6e6e6d", spaceBefore: 4 },
        table(rows, { columns: [468], border: { thickness: 1.1, color: "6e6e6d" } }),
      ],
      { pageBorder: { style: "double", thickness: 0.75, color: "333333", space: { top: 18, left: 18, bottom: 18, right: 18 } } },
    );
    const zip = await JSZip.loadAsync(await buildDocx([p], { title: "t", bodySize: 11, bodyFont: "" }));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:pgBorders w:offsetFrom="page"><w:top w:val="double" w:sz="6" w:space="18"/);
    expect(xml).toMatch(/<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="0" w:color="6E6E6D"\/><\/w:pBdr><w:spacing w:before="80" w:after="0" w:line="20" w:lineRule="exact"\/>/);
    // 1.1 pt is drawn as Word's 1 pt (sz 8), not an in-between width Word rounds on its own.
    expect(xml).toMatch(/<w:insideH w:val="single" w:sz="8"/);
    expect(xml).toContain('<w:tab w:val="left" w:pos="1820"/>');
    expect(xml).toMatch(/<w:spacing w:before="120"/);
    expect(await verifyDocx(await buildDocx([p], { title: "t", bodySize: 11, bodyFont: "" }))).toEqual([]);
  });

  it("makes text invisible over a page image kept behind it (visual fallback)", async () => {
    const bg = { x: 0, y: 0, w: 612, h: 792, bytes: PNG, mime: "image/png" as const, pxWidth: 1, pxHeight: 1 };
    const p = pageOf([{ kind: "paragraph", style: "normal", align: "left", runs: [run("Searchable text")], fmt: fmt() }], {
      floating: [{ image: bg, x: 0, y: 0, width: 612, height: 792, behind: true }],
      transparentText: true,
    });
    const zip = await JSZip.loadAsync(await buildDocx([p], { title: "t", bodySize: 11, bodyFont: "" }));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('behindDoc="1"');
    expect(xml).toMatch(/<w14:textFill><w14:solidFill><w14:srgbClr w14:val="[0-9A-F]{6}"><w14:alpha w14:val="100000"\/>/);
    expect(xml).toContain('mc:Ignorable="w14"');
  });
});

describe("buildDocx — two columns", () => {
  it("starts the right column as far down as it was: its own spacing plus the section's", async () => {
    const para = (t: string, sb = 0): Block => ({ kind: "paragraph", style: "normal", align: "left", runs: [run(t)], fmt: fmt({ spaceBefore: sb }) });
    const p = pageOf([para("Title"), { kind: "columns", gap: 24, spaceBefore: 9, left: [para("Left column text")], right: [para("Right column text", 25)] }]);
    const zip = await JSZip.loadAsync(await buildDocx([p], { title: "t", bodySize: 11, bodyFont: "" }));
    const xml = await zip.file("word/document.xml")!.async("string");
    // The column break sits in a paragraph of its own (else its space-before would stay in the left column)…
    expect(xml).toMatch(/<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"\/><\/w:pPr><w:r><w:br w:type="column"\/><\/w:r><\/w:p>/);
    // …and the right column's first paragraph carries 25 + 9 − 1 pt.
    const right = xml.slice(xml.indexOf('w:type="column"'));
    expect(right).toMatch(/<w:spacing w:before="660"/);
  });
});
