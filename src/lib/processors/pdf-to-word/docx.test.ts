import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildDocx, verifyDocx, xmlText } from "./docx";
import type { PageLayout, Run } from "./layout";

const run = (text: string, extra: Partial<Run> = {}): Run => ({ text, bold: false, italic: false, size: 11, ...extra });
// A 1×1 transparent PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

const pages: PageLayout[] = [
  {
    width: 612,
    height: 792,
    margins: { left: 72, right: 72, top: 54, bottom: 54 },
    blocks: [
      { kind: "paragraph", style: "h1", align: "center", runs: [run("Report", { size: 24, bold: true })] },
      { kind: "paragraph", style: "normal", align: "left", runs: [run("Plain, "), run("bold", { bold: true }), run(" and "), run("italic", { italic: true }), run(" — niño €120 ✓ Ελληνικά")] },
      { kind: "list", ordered: false, start: 1, listKey: 1, runs: [run("A bullet")] },
      { kind: "list", ordered: true, start: 3, listKey: 2, runs: [run("Step three")] },
      { kind: "table", columns: [100, 100], rows: [[[run("a")], [run("b")]], [[run("c")], [run("d")]]], bordered: true },
      { kind: "image", image: { x: 0, y: 0, w: 100, h: 50, bytes: PNG, mime: "image/png", pxWidth: 1, pxHeight: 1 }, width: 100, height: 50 },
    ],
  },
  { width: 792, height: 612, margins: { left: 72, right: 72, top: 54, bottom: 54 }, blocks: [{ kind: "paragraph", style: "normal", align: "left", runs: [run("Landscape page")] }] },
];

describe("buildDocx", () => {
  it("writes a valid Word package with every part and relationship in place", async () => {
    const bytes = await buildDocx(pages, { title: "test", bodySize: 11 });
    expect(await verifyDocx(bytes)).toEqual([]);
    const zip = await JSZip.loadAsync(bytes);
    // No folder entries (Word writes parts only).
    expect(Object.values(zip.files).some((f) => f.dir)).toBe(false);
    expect(zip.file("word/media/image1.png")).toBeTruthy();
  });

  it("keeps structure: heading style, bold/italic runs, list numbering, table, picture, one section per page", async () => {
    const zip = await JSZip.loadAsync(await buildDocx(pages, { title: "test", bodySize: 11 }));
    const xml = await zip.file("word/document.xml")!.async("string");
    const dom = new DOMParser().parseFromString(xml, "application/xml");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const q = (tag: string) => Array.from(dom.getElementsByTagNameNS(W, tag));
    expect(q("pStyle").map((e) => e.getAttributeNS(W, "val"))).toEqual(["Heading1", "ListParagraph", "ListParagraph"]);
    expect(q("b").length).toBeGreaterThanOrEqual(2);
    expect(q("i").length).toBeGreaterThanOrEqual(1);
    expect(q("tbl")).toHaveLength(1);
    expect(q("tr")).toHaveLength(2);
    expect(dom.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "inline")).toHaveLength(1);
    const sections = q("sectPr");
    expect(sections).toHaveLength(2);
    expect(sections[1].getElementsByTagNameNS(W, "pgSz")[0].getAttributeNS(W, "orient")).toBe("landscape");
    expect(xml).toContain("niño €120 ✓ Ελληνικά");
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>');
    expect(numbering).toContain('<w:startOverride w:val="3"/>');
  });

  it("the verifier rejects a broken package", async () => {
    const zip = await JSZip.loadAsync(await buildDocx(pages, { title: "test", bodySize: 11 }));
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
