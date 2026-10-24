import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, PDFTextField, StandardFonts } from "pdf-lib";
import { exportPdf, EDITOR_FIXTURES, goToPage } from "./helpers/native";
import { field, form, openForm, settled } from "./helpers/forms";

/**
 * Exports of filled-in forms for qa/validate/formcheck.py: qpdf, MuPDF and a pixel diff read what the editor wrote.
 *   edited/<name>.pdf + .orig.pdf + .json — the fields we changed and the values, sizes and alignment they must have
 *   same/<name>.pdf   + .orig.pdf         — opened and exported without a change: every pixel must be as it was
 */
test.describe.configure({ timeout: 180_000 });
test.skip(({ isMobile }) => isMobile, "desktop flow");

const OUT = path.join(__dirname, "..", "qa", "fidelity", "_work", "form-out");
const save = (kind: "edited" | "same", name: string, out: Buffer, orig: Buffer, meta?: object) => {
  fs.mkdirSync(path.join(OUT, kind), { recursive: true });
  fs.writeFileSync(path.join(OUT, kind, `${name}.pdf`), out);
  fs.writeFileSync(path.join(OUT, kind, `${name}.orig.pdf`), orig);
  if (meta) fs.writeFileSync(path.join(OUT, kind, `${name}.json`), JSON.stringify(meta));
};

async function setText(page: Page, name: string, value: string) {
  await field(page, name).click();
  await page.keyboard.press("Control+A");
  if (value) await page.keyboard.type(value);
  else await page.keyboard.press("Delete");
  await page.keyboard.press("Tab");
  await settled(page, name);
}

type Want = { value?: string; size?: number; align?: "left" | "center" | "right"; checked?: boolean; selected?: string };
const EDITED: { file: string; text?: Record<string, string>; toggle?: string[]; radio?: [string, string]; pick?: [string, string]; expect: Record<string, Want> }[] = [
  { file: "FORM-01-given-name.pdf", text: { given_name: "Ravi Teja" }, expect: { given_name: { value: "Ravi Teja", size: 12, align: "left" } } },
  {
    file: "FORM-02-sizes.pdf",
    text: { size_8: "Raviteja V", size_10: "Raviteja V", size_12: "Raviteja V", size_14: "Raviteja V", size_18: "Raviteja V", size_auto: "Raviteja V" },
    expect: { size_8: { value: "Raviteja V", size: 8 }, size_10: { value: "Raviteja V", size: 10 }, size_12: { value: "Raviteja V", size: 12 }, size_14: { value: "Raviteja V", size: 14 }, size_18: { value: "Raviteja V", size: 18 }, size_auto: { value: "Raviteja V" } },
  },
  {
    file: "FORM-03-alignment.pdf",
    text: { align_left: "Raviteja V", align_center: "Raviteja V", align_right: "Raviteja V" },
    expect: { align_left: { value: "Raviteja V", align: "left" }, align_center: { value: "Raviteja V", align: "center" }, align_right: { value: "Raviteja V", align: "right" } },
  },
  {
    file: "FORM-04-multiline.pdf",
    text: { comments: "Short.", notes_auto: "Replaced notes that still have to fit in the box, wrapped over a few lines of the auto sized field." },
    expect: { comments: { value: "Short.", size: 10 }, notes_auto: { value: "Replaced notes that still have to fit in the box, wrapped over a few lines of the auto sized field." } },
  },
  { file: "FORM-05-choices.pdf", toggle: ["subscribe"], radio: ["membership", "Family"], pick: ["country", "Utopia"], expect: { subscribe: { checked: false }, membership: { selected: "Family" }, country: { value: "Utopia" } } },
  {
    file: "FORM-10-fonts-colours.pdf",
    text: { times_blue: "Raviteja V", courier_gray: "Raviteja V", no_border: "Raviteja V" },
    expect: { times_blue: { value: "Raviteja V", size: 14 }, courier_gray: { value: "Raviteja V", size: 12 }, no_border: { value: "Raviteja V", size: 12 } },
  },
  { file: "FORM-11-rotated-page.pdf", text: { given_name: "Raviteja V" }, expect: { given_name: { value: "Raviteja V", size: 12 } } },
];

for (const e of EDITED) {
  test(`export after editing — ${e.file}`, async ({ page }) => {
    const orig = fs.readFileSync(form(e.file));
    await openForm(page, form(e.file));
    for (const [n, v] of Object.entries(e.text ?? {})) await setText(page, n, v);
    for (const n of e.toggle ?? []) {
      await field(page, n).click();
      await settled(page, n);
    }
    if (e.radio) {
      await field(page, e.radio[0], e.radio[1]).click();
      await settled(page, e.radio[0], e.radio[1]);
    }
    if (e.pick) {
      await field(page, e.pick[0]).selectOption(e.pick[1]);
      await settled(page, e.pick[0]);
    }
    const out = await exportPdf(page, "edited.pdf");
    save("edited", e.file.replace(/\.pdf$/, ""), out, orig, { fields: e.expect });
    expect((await PDFDocument.load(out)).getPageCount()).toBeGreaterThan(0);
  });
}

const SAME = ["FORM-01-given-name.pdf", "FORM-02-sizes.pdf", "FORM-03-alignment.pdf", "FORM-04-multiline.pdf", "FORM-05-choices.pdf", "FORM-08-flattened.pdf", "FORM-09-long.pdf", "FORM-10-fonts-colours.pdf", "FORM-11-rotated-page.pdf"];
for (const file of SAME) {
  test(`opening and exporting changes nothing — ${file}`, async ({ page }) => {
    const orig = fs.readFileSync(form(file));
    await openForm(page, form(file), file !== "FORM-08-flattened.pdf");
    await page.waitForTimeout(500);
    const out = await exportPdf(page, "same.pdf");
    save("same", file.replace(/\.pdf$/, ""), out, orig);
  });
}

// real-world forms: public forms from other producers, pre-filled here the way a person would have
async function prefilled(src: string, count: number, name: string) {
  const doc = await PDFDocument.load(fs.readFileSync(path.join(EDITOR_FIXTURES, "public", src)));
  const f = doc.getForm();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const texts = f.getFields().filter((x): x is PDFTextField => x instanceof PDFTextField && !x.isReadOnly() && (x.getMaxLength() ?? 99) >= 20 && !x.isMultiline() && !x.isCombed() && !x.isPassword());
  const values = ["Raviteja", "Vemulapelli", "12 Willow Court", "Utopia City", "10101", "555 0142"];
  const chosen = texts.slice(0, count);
  chosen.forEach((t, i) => t.setText(values[i % values.length]));
  f.updateFieldAppearances(helv);
  const p = test.info().outputPath(name);
  fs.writeFileSync(p, await doc.save());
  const pages = doc.getPages();
  const pageOf = (t: PDFTextField) => pages.findIndex((pg) => pg.ref === t.acroField.getWidgets()[0].P());
  return { file: p, names: chosen.map((t) => t.getName()), pageNumber: Math.max(1, pageOf(chosen[0]) + 1) };
}

for (const src of ["fw9.pdf", "f1040es.pdf"]) {
  test(`${src} (public form, pre-filled): untouched export is identical; editing one field changes only that field`, async ({ page }) => {
    const { file, names, pageNumber } = await prefilled(src, 6, `${src}-prefilled.pdf`);
    expect(names.length).toBeGreaterThan(3);
    const orig = fs.readFileSync(file);
    await openForm(page, file, false);
    await goToPage(page, pageNumber);
    await expect(page.locator('[data-testid="form-field"]').first()).toBeAttached({ timeout: 20_000 });
    await page.waitForTimeout(700);
    const out0 = await exportPdf(page, "same.pdf");
    save("same", `public-${src.replace(/\.pdf$/, "")}-prefilled`, out0, orig);
    const first = names[0];
    const el = page.locator(`[data-testid="form-field"][data-field-name="${first}"]`).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Ravi Teja");
    await page.keyboard.press("Tab");
    await expect(el).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
    const out1 = await exportPdf(page, "edited.pdf");
    save("edited", `public-${src.replace(/\.pdf$/, "")}-prefilled`, out1, orig, { fields: { [first]: { value: "Ravi Teja" } } });
  });
}
