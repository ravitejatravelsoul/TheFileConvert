import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { EncryptedPdfError, loadPdfForEditing, normalizeGenerations } from "./load";

/** A PDF whose catalog was rewritten by an incremental update, so it lives at generation 1 — the shape
 * of the user's scan that came out of Compress PDF unopenable ("unable to find /Root"). */
function pdfWithGenerationOneCatalog(): Uint8Array {
  const body = [
    "%PDF-1.4",
    "1 0 obj << /Type /Pages /Kids [2 0 R] /Count 1 >> endobj",
    "2 0 obj << /Type /Page /Parent 1 0 R /MediaBox [0 0 200 200] >> endobj",
    "3 1 obj << /Type /Catalog /Pages 1 0 R >> endobj",
  ];
  let text = "";
  const offsets: number[] = [];
  for (const line of body) {
    if (/ obj /.test(line)) offsets.push(text.length);
    text += line + "\n";
  }
  const xref = text.length;
  text += "xref\n0 4\n0000000000 65535 f \n" + offsets.map((o, i) => `${String(o).padStart(10, "0")} ${i === 2 ? "00001" : "00000"} n \n`).join("");
  text += "trailer << /Size 4 /Root 3 1 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return new Uint8Array(Buffer.from(text, "latin1"));
}

describe("loadPdfForEditing (regression: corrupt output from generation-1 objects)", () => {
  it("renumbers generation-1 objects to generation 0 and rewrites the references", async () => {
    const doc = await loadPdfForEditing(pdfWithGenerationOneCatalog());
    const refs = [...doc.context.enumerateIndirectObjects()].map(([r]) => r);
    expect(refs.every((r) => r.generationNumber === 0)).toBe(true);
    const root = doc.context.trailerInfo.Root as PDFRef;
    expect(root.generationNumber).toBe(0);
    expect(doc.context.lookup(root)).toBe(doc.catalog);
  });

  it("the saved file reopens with its root and pages, with and without object streams", async () => {
    for (const useObjectStreams of [true, false]) {
      const doc = await loadPdfForEditing(pdfWithGenerationOneCatalog());
      const saved = await doc.save({ useObjectStreams });
      const text = new TextDecoder("latin1").decode(saved);
      expect(text).not.toMatch(/ 1 R/); // no dangling generation-1 references
      const reopened = await PDFDocument.load(new Uint8Array(saved));
      expect(reopened.getPageCount()).toBe(1);
      expect(reopened.catalog.get(PDFName.of("Type"))?.toString()).toBe("/Catalog");
    }
  });

  it("changes nothing in an ordinary PDF", async () => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, "../../../e2e/fixtures/multi-page.pdf")));
    const doc = await PDFDocument.load(bytes);
    expect(normalizeGenerations(doc.context)).toBe(0);
  });
});

describe("loadPdfForEditing refuses encrypted PDFs (regression: blank/corrupt output from owner-password files)", () => {
  const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, "../../../e2e/fixtures", name)));

  it("refuses a PDF that opens without a password but is encrypted (owner password only)", async () => {
    await expect(loadPdfForEditing(fixture("encrypted-owner-only.pdf"))).rejects.toBeInstanceOf(EncryptedPdfError);
  });

  it("refuses a PDF that needs a password to open", async () => {
    await expect(loadPdfForEditing(fixture("encrypted-user-password.pdf"))).rejects.toBeInstanceOf(EncryptedPdfError);
  });

  it("every PDF writer passes the clear reason on to the user", async () => {
    const { mergePdfs, extractPages } = await import("@/lib/processors/pdf");
    const { compressPdfToTarget } = await import("@/lib/processors/pdf-compress");
    const bytes = fixture("encrypted-owner-only.pdf");
    const file = new File([bytes as BlobPart], "statement.pdf", { type: "application/pdf" });
    const plain = new File([fixture("multi-page.pdf") as BlobPart], "plain.pdf", { type: "application/pdf" });
    await expect(mergePdfs([plain, file])).rejects.toThrow(/protected with a password or encryption/);
    await expect(extractPages(file, "1")).rejects.toThrow(/protected with a password or encryption/);
    await expect(compressPdfToTarget(bytes, 10)).rejects.toBeInstanceOf(EncryptedPdfError);
  });
});
