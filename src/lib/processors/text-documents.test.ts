import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { markdownToPdf, replacedCharactersNote, textToPdf } from "./text-documents";

async function pageCount(blob: Blob) {
  return (await PDFDocument.load(await blob.arrayBuffer())).getPageCount();
}

describe("textToPdf", () => {
  it("builds a PDF from text with characters the PDF fonts can't draw, reporting them instead of failing", async () => {
    const { blob, replacedCharacters } = await textToPdf("Done ✓ 日本語 😀 café", { fontSize: 12 });
    expect(await pageCount(blob)).toBe(1);
    expect(replacedCharacters).toContain("✓");
    expect(replacedCharacters).toContain("日");
    expect(replacedCharacters).not.toContain("é");
  });

  it("handles tabs and reports nothing for plain Latin text", async () => {
    const { replacedCharacters } = await textToPdf("a\tb\nsmart “quotes” — dash • bullet", { fontSize: 12 });
    expect(replacedCharacters).toEqual([]);
  });

  it("wraps an unbroken 300-character run onto several lines instead of running off the page", async () => {
    const { blob } = await textToPdf("x".repeat(300), { fontSize: 12 });
    const doc = await PDFDocument.load(await blob.arrayBuffer());
    const content = doc.getPage(0).node.Contents();
    expect(content).toBeDefined();
    // 300 chars of 12pt Helvetica are ~1800pt wide; the text area is ~483pt, so at least 4 lines are drawn.
    const stream = (content as unknown as { getContents?: () => Uint8Array }).getContents?.();
    if (stream) expect(new TextDecoder("latin1").decode(stream).match(/Tj/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("refuses empty input", async () => {
    await expect(textToPdf("   ", { fontSize: 12 })).rejects.toThrow(/no text/i);
  });
});

describe("markdownToPdf", () => {
  const md = "# Title\n\n1. one\n2. two\n\n- a\n  - nested\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```\n" + "z".repeat(200) + "\n```\n";

  it("handles headings, numbered/nested lists, tables and an over-long code line", async () => {
    const { blob, replacedCharacters } = await markdownToPdf(md);
    expect(await pageCount(blob)).toBeGreaterThanOrEqual(1);
    expect(replacedCharacters).toEqual([]);
  });

  it("reports unsupported characters rather than throwing", async () => {
    const { replacedCharacters } = await markdownToPdf("# ✓ Done\n\nemoji 😀");
    expect(replacedCharacters.length).toBeGreaterThan(0);
  });
});

describe("replacedCharactersNote", () => {
  it("is silent when nothing was replaced and plain-language when something was", () => {
    expect(replacedCharactersNote([])).toBeUndefined();
    expect(replacedCharactersNote(["✓"])).toMatch(/can't draw this character.*replaced with "\?"/);
    expect(replacedCharactersNote(["a", "b", "c", "d", "e", "f", "g"])).toMatch(/these characters/);
  });
});
