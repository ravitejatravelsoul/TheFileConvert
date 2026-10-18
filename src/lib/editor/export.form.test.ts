// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { loadEditorDocument } from "./document";
import { exportEditorDocument } from "./export";

const loader = async (key: string) => new Uint8Array(fs.readFileSync(path.resolve("public/fonts/word", `${key}.ttf`)));
const fileOf = (p: string) => new File([fs.readFileSync(p)], path.basename(p), { type: "application/pdf" });

describe("export of documents with links and fields", () => {
  it("a real-world form (IRS 1040-ES: many fields, link annotations) exports and reopens", async () => {
    const doc = await loadEditorDocument(fileOf("qa/editor-fixtures/public/f1040es.pdf"));
    const blob = await exportEditorDocument(doc, { loadFont: loader as never, nativeTextBoxes: async () => [] });
    const out = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    expect(out.getPageCount()).toBe(16);
    expect(out.getForm().getFields().length).toBeGreaterThan(50);
  });
  it("only a field whose value changed is rewritten", async () => {
    const doc = await loadEditorDocument(fileOf("qa/editor-fixtures/EDITOR-05-form-acroform.pdf"));
    const same = await exportEditorDocument(doc, { loadFont: loader as never, nativeTextBoxes: async () => [] });
    const o = await PDFDocument.load(new Uint8Array(await same.arrayBuffer()));
    expect(o.getForm().getTextField("full_name").getText()).toBe("Alex Morgan");
    doc.formFields = doc.formFields.map((f) => (f.name === "full_name" ? { ...f, value: "Riley" } : f));
    const changed = await exportEditorDocument(doc, { loadFont: loader as never, nativeTextBoxes: async () => [] });
    const c = await PDFDocument.load(new Uint8Array(await changed.arrayBuffer()));
    expect(c.getForm().getTextField("full_name").getText()).toBe("Riley");
  });
});
