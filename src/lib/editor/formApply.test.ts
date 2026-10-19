// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyFormState } from "./formApply";
import { loadEditorDocument } from "./document";
import { appearanceText, radioLabel, widgetsOnPage } from "./formPdf";

const fileOf = (p: string) => new File([fs.readFileSync(p)], p.split("/").pop()!, { type: "application/pdf" });
const F = (n: string) => `qa/form-fixtures/${n}`;

async function loaded(name: string) {
  const doc = await loadEditorDocument(fileOf(F(name)));
  const pdf = await PDFDocument.load(fs.readFileSync(F(name)));
  return { doc, pdf };
}

describe("form state written into a page", () => {
  it("a filled field gets a new appearance that shows its value once", async () => {
    const { doc, pdf } = await loaded("FORM-01-given-name.pdf");
    const fields = doc.formFields.map((f) => (f.name === "given_name" ? { ...f, value: "Ravi Teja" } : f));
    await applyFormState(pdf, pdf.getPage(0), fields);
    const w = widgetsOnPage(pdf.getPage(0)).find((x) => appearanceText(x) !== null && appearanceText(x) !== "")!;
    expect(appearanceText(w)).toBe("Ravi Teja");
    expect(pdf.getForm().getTextField("given_name").getText()).toBe("Ravi Teja");
  });
  it("an untouched field keeps the file's own appearance object", async () => {
    const { doc, pdf } = await loaded("FORM-01-given-name.pdf");
    const apBefore = widgetsOnPage(pdf.getPage(0)).map((w) => String(w.context.lookup(w.get(pdf.context.obj("AP") as never))));
    await applyFormState(pdf, pdf.getPage(0), doc.formFields);
    const apAfter = widgetsOnPage(pdf.getPage(0)).map((w) => String(w.context.lookup(w.get(pdf.context.obj("AP") as never))));
    expect(apAfter).toEqual(apBefore);
  });
  it("an appearance that shows an old value is found stale and redrawn from /V", async () => {
    const { doc, pdf } = await loaded("FORM-07-stale-appearance.pdf");
    const f = doc.formFields.find((x) => x.name === "given_name")!;
    expect(f.regen).toBe(true);
    expect(f.value).toBe("Raviteja");
    await applyFormState(pdf, pdf.getPage(0), doc.formFields);
    expect(appearanceText(widgetsOnPage(pdf.getPage(0))[0])).toBe("Raviteja");
  });
  it("a missing appearance with /NeedAppearances is drawn from /V; an untouched, trusted one is not", async () => {
    const { doc } = await loaded("FORM-06-needappearances.pdf");
    expect(doc.formFields.find((x) => x.name === "given_name")!.regen).toBe(true);
    const { doc: ok } = await loaded("FORM-01-given-name.pdf");
    expect(ok.formFields.every((x) => !x.regen)).toBe(true);
  });
  it("radio buttons: /Opt gives the labels, and only the chosen one is on", async () => {
    const { doc, pdf } = await loaded("FORM-05-choices.pdf");
    const m = doc.formFields.find((x) => x.name === "membership")!;
    expect(m.value).toBe("Individual");
    expect(m.widgets.map((w) => w.onValue)).toEqual(["Student", "Individual", "Family"]);
    await applyFormState(pdf, pdf.getPage(0), doc.formFields.map((f) => (f.name === "membership" ? { ...f, value: "Family" } : f)));
    const states = widgetsOnPage(pdf.getPage(0)).filter((w) => radioLabel(w, "0") !== undefined && String(w.get(pdf.context.obj("AS") as never)) !== "undefined").map((w) => String(w.context.lookup(w.get(pdf.context.obj("AS") as never))));
    expect(states.filter((s) => s !== "/Off")).toEqual(expect.arrayContaining(["/2"]));
    expect(pdf.getForm().getRadioGroup("membership").getSelected()).toBe("Family");
  });
});
