// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { FallbackFonts } from "./fallback";
import { editBlock, planLines, wrapParagraph } from "./edit-block";
import { interpretPage } from "./interpreter";
import { buildBlocks, buildLines } from "./textmodel";

const STD_FONTS = path.resolve("node_modules/pdfjs-dist/standard_fonts").split(path.sep).join("/") + "/";
const loader = async (key: string) => new Uint8Array(fs.readFileSync(path.resolve("public/fonts/word", `${key}.ttf`)));
const FX = (n: string) => path.resolve("qa/editor-fixtures", n);

async function textOf(bytes: Uint8Array, n = 1): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, standardFontDataUrl: STD_FONTS }).promise;
  const tc = await (await doc.getPage(n)).getTextContent();
  return tc.items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ");
}

async function editPara(file: string, startsWith: string, change: (t: string) => string, pageNo = 0) {
  const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(FX(file))), { updateMetadata: false });
  const page = doc.getPage(pageNo);
  const content = interpretPage(page);
  const block = buildBlocks(buildLines(content.runs)).find((b) => b.text.startsWith(startsWith));
  if (!block) throw new Error(`no block starting “${startsWith}”`);
  const env = { doc, page, fonts: new FallbackFonts(doc, loader as never) };
  const res = await editBlock(env, content, block, change(block.text));
  const out = await doc.save();
  const after = interpretPage((await PDFDocument.load(out)).getPage(pageNo));
  return { res, out, block, blocksAfter: buildBlocks(buildLines(after.runs)) };
}

describe("wrapping", () => {
  const m = (t: string) => t.length * 5;
  it("breaks at spaces, never inside a word", () => {
    expect(wrapParagraph("aaa bbb ccc ddd", m, 40)).toEqual(["aaa bbb", "ccc ddd"]);
    expect(wrapParagraph("a", m, 40)).toEqual(["a"]);
    expect(wrapParagraph("averyveryverylongword x", m, 40)).toEqual(["averyveryverylongword", "x"]);
  });
});

describe("planLines", () => {
  it("leaves lines alone when the change is inside one line and the breaks don't move", async () => {
    const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(FX("EDITOR-01-simple-text.pdf"))));
    const block = buildBlocks(buildLines(interpretPage(doc.getPage(0)).runs)).find((b) => b.text.startsWith("The committee will recieve"))!;
    expect(block.softWrapped).toBe(true);
    const plan = planLines(block, block.text.replace("recieve", "receive"));
    expect(plan.length).toBe(block.lines.length);
    expect(plan.filter((l, i) => l !== block.lines[i].text).length).toBe(1);
  });
});

describe("editBlock", () => {
  it("a spelling fix changes one line and nothing else", async () => {
    const { res, out } = await editPara("EDITOR-01-simple-text.pdf", "The committee will recieve", (t) => t.replace("recieve", "receive"));
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    const text = await textOf(out);
    expect(text).toContain("receive");
    expect(text).not.toContain("recieve");
  });

  it("a longer sentence wraps its last word onto the next line, which keeps its place", async () => {
    const { res, out, blocksAfter } = await editPara("EDITOR-01-simple-text.pdf", "The committee will recieve", (t) => t.replace("The committee will recieve", "The extended committee of experts will receive"));
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    const b = blocksAfter.find((x) => x.text.startsWith("The extended committee"));
    expect(b?.lines.length).toBe(2);
    expect(await textOf(out)).toContain("The extended committee of experts will receive the final report");
  });

  it("a shorter paragraph pulls words back up", async () => {
    const { res, blocksAfter } = await editPara("EDITOR-01-simple-text.pdf", "A seperate budget", (t) => t.replace("A seperate budget was prepared for the northern office, ", "A budget "));
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    expect(blocksAfter.find((x) => x.text.startsWith("A budget"))).toBeTruthy();
  });

  it("adds a line below when there is room (the last paragraph on the page)", async () => {
    const extra = " Please also remember that the signed copy must reach the office before the first of the month, otherwise the application cannot be processed.";
    const { res, out, blocksAfter } = await editPara("EDITOR-01-simple-text.pdf", "Review the draft", (t) => t + extra);
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    const b = blocksAfter.find((x) => x.text.startsWith("Review the draft"));
    expect(b?.lines.length).toBeGreaterThanOrEqual(3);
    expect(await textOf(out)).toContain("cannot be processed.");
  });

  it("refuses to add a line where it would land on the next paragraph", async () => {
    const extra = " " + "padding words that make the paragraph a good deal longer than before ".repeat(4);
    const { res } = await editPara("EDITOR-01-simple-text.pdf", "The committee will recieve", (t) => t + extra);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("too-long");
  });

  it("a block of hard-break lines (an address) is edited line by line", async () => {
    const { res, out } = await editPara("EDITOR-03-business-letter.pdf", "Mr. Anthony Reyes", (t) => t.replace("Flat 4", "Flat 12"));
    expect(res.ok, res.ok ? "" : res.reason).toBe(true);
    expect(await textOf(out)).toContain("Flat 12, Willow Court");
  });
});
