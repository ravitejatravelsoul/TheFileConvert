// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyCorrections } from "./searchLayer";
import { exportEditorDocument } from "./export";
import type { EditorDocument, OcrTextReplacementObject } from "./types";
import type { OcrPageResult } from "@/lib/processors/ocr";

const box = { x: 100, y: 500, width: 300, height: 14 };
const correction = (originalText: string, newText: string, x: number, width = 40): OcrTextReplacementObject => ({
  id: `c-${originalText}-${x}`,
  pageId: "p1",
  type: "ocr-text-replacement",
  x,
  y: 500,
  width,
  height: 14,
  originalText,
  newText,
  confidence: 90,
  backgroundColor: { r: 1, g: 1, b: 1 },
  textColor: { r: 0, g: 0, b: 0 },
  backgroundComplex: false,
  overlayOnly: false,
});

describe("applyCorrections", () => {
  it("replaces the corrected word where it was corrected, and only inside its own line", () => {
    const line = "Paid by Smith to Smith Ltd";
    // The second "Smith" sits at about 70% of the line's width.
    const r = applyCorrections(line, box, [correction("Smith", "Smyth", 100 + 300 * 0.66, 30)]);
    expect(r.text).toBe("Paid by Smith to Smyth Ltd");
    expect(r.applied.size).toBe(1);
    const elsewhere = applyCorrections(line, { ...box, y: 300 }, [correction("Smith", "Smyth", 150)]);
    expect(elsewhere.text).toBe(line);
    expect(elsewhere.applied.size).toBe(0);
  });
});

async function textOf(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const out: { str: string; transform: number[] }[][] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push(((await (await doc.getPage(i)).getTextContent()).items as { str: string; transform: number[] }[]).filter((t) => t.str.trim()));
  return { pages: doc.numPages, items: out, text: out.map((p) => p.map((t) => t.str).join(" ")) };
}

/** A one-page "scan": a drawing, no text at all. */
async function scan(rotate = 0): Promise<File> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 90, y: 480, width: 330, height: 60, color: rgb(0.85, 0.85, 0.85) });
  if (rotate) page.setRotation(degrees(rotate));
  return new File([(await pdf.save()) as BlobPart], "scan.pdf", { type: "application/pdf" });
}

function editorDoc(file: File, rotate: 0 | 90, objects: OcrTextReplacementObject[] = []): EditorDocument {
  return {
    sourceFiles: { f1: file },
    pages: [{ id: "p1", sourceFileId: "f1", sourcePageIndex: 0, baseRotation: rotate, rotationDelta: 0, mediaBox: [0, 0, 612, 792] }],
    objects,
    formFields: [],
  };
}

const ocr = (rotation: number, lines: { text: string; pdfBox: typeof box }[]): OcrPageResult => ({
  pageIndex: 0,
  text: lines.map((l) => l.text).join("\n"),
  words: [],
  lines,
  meanConfidence: 90,
  lowConfidenceWordCount: 0,
  rotation,
});

describe("searchable OCR export", () => {
  it("puts recognised lines in the exported PDF as searchable text, with corrected words in their new form", async () => {
    const result = ocr(0, [
      { text: "Invoice for Jordan Smith", pdfBox: box },
      { text: "Total due: 1,250.00 dollars", pdfBox: { ...box, y: 480 } },
    ]);
    // The usual correction: a raster patch over the word (the scan's own look), not selectable text.
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const fixed = { ...correction("Smith", "Rivera", 100 + 300 * 0.85, 40), patchDataUrl: PNG };
    const out = new Uint8Array(await (await exportEditorDocument(editorDoc(await scan(), 0, [fixed]), { ocrResultsByPage: { p1: result }, nativeTextBoxes: async () => [] })).arrayBuffer());
    const t = await textOf(out);
    expect(t.pages).toBe(1);
    expect(t.text[0]).toContain("Invoice for Jordan Rivera"); // phrase search works across the corrected word
    expect(t.text[0]).toContain("Total due: 1,250.00 dollars");
    expect(t.text[0]).not.toContain("Smith"); // the old reading isn't searchable
    expect(t.text[0].match(/Rivera/g)).toHaveLength(1); // and the correction isn't there twice
  });

  it("a correction drawn as visible text is found once, and the old word not at all", async () => {
    const result = ocr(0, [{ text: "Invoice for Jordan Smith", pdfBox: box }]);
    const visible = correction("Smith", "Rivera", 100 + 300 * 0.85, 40); // no patch: drawn as vector text
    const out = new Uint8Array(await (await exportEditorDocument(editorDoc(await scan(), 0, [visible]), { ocrResultsByPage: { p1: result }, nativeTextBoxes: async () => [] })).arrayBuffer());
    const text = (await textOf(out)).text[0];
    expect(text).toContain("Invoice for Jordan");
    expect(text.match(/Rivera/g)).toHaveLength(1);
    expect(text).not.toContain("Smith");
  });

  it("on a mixed page, a line OCR read over the page's own text isn't added again", async () => {
    const header = { x: 72, y: 740, width: 150, height: 18 };
    const result = ocr(0, [
      { text: "NATIVE HEADER LINE", pdfBox: { ...header, x: 71, width: 152 } },
      { text: "Invoice for Jordan Smith", pdfBox: box },
    ]);
    const out = new Uint8Array(await (await exportEditorDocument(editorDoc(await scan(), 0), { ocrResultsByPage: { p1: result }, nativeTextBoxes: async () => [header] })).arrayBuffer());
    const text = (await textOf(out)).text[0];
    expect(text).toContain("Invoice for Jordan Smith");
    expect(text).not.toContain("NATIVE"); // the scan stub has no real header text; the layer must not add one
  });

  it("without recognised text the export is unchanged: no text layer", async () => {
    const out = new Uint8Array(await (await exportEditorDocument(editorDoc(await scan(), 0))).arrayBuffer());
    expect((await textOf(out)).text[0]).toBe("");
  });

  it("on a page shown rotated, the hidden text runs the way the scan reads", async () => {
    // Read at 90°: the line is a tall, narrow box in the page's own space.
    const result = ocr(90, [{ text: "Certificate of completion", pdfBox: { x: 300, y: 200, width: 14, height: 300 } }]);
    const out = new Uint8Array(await (await exportEditorDocument(editorDoc(await scan(90), 90), { ocrResultsByPage: { p1: result }, nativeTextBoxes: async () => [] })).arrayBuffer());
    const t = await textOf(out);
    expect(t.text[0]).toContain("Certificate of completion");
    const [a, b] = t.items[0][0].transform; // text direction in page space
    expect(Math.abs(a)).toBeLessThan(0.01); // not along x…
    expect(Math.abs(b)).toBeGreaterThan(1); // …but along y, like the line on the page
  });
});
