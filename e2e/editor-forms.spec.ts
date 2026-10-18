import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { EDITOR_FIXTURES, exportPdf, openEditor, pdfText } from "./helpers/native";

test.describe.configure({ timeout: 120_000 });

const FORM = path.join(EDITOR_FIXTURES, "EDITOR-05-form-acroform.pdf");

async function values(bytes: Buffer) {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  return {
    name: form.getTextField("full_name").getText(),
    email: form.getTextField("email").getText(),
    news: form.getCheckBox("newsletter").isChecked(),
    member: form.getRadioGroup("member_type").getSelected(),
    country: form.getDropdown("country").getSelected()[0],
  };
}

test("form fields are filled on the page, survive export and reopen, and untouched fields stay as they were", async ({ page, isMobile }, info) => {
  test.skip(isMobile, "desktop layout");
  const orig = fs.readFileSync(FORM);
  await openEditor(page, FORM);
  await page.screenshot({ path: info.outputPath("form-before.png") });

  const name = page.locator('[data-testid="form-field"][data-field-name="full_name"]');
  const email = page.locator('[data-testid="form-field"][data-field-name="email"]');
  await expect(name).toHaveValue("Alex Morgan");
  await name.fill("Riley Chen");
  await email.click();
  await page.keyboard.type("riley@example.test");
  await page.locator('[data-testid="form-field"][data-field-name="newsletter"]').click();
  await page.locator('[data-testid="form-field"][data-field-name="member_type"][data-option="Family"]').click();
  await page.locator('[data-testid="form-field"][data-field-name="country"]').selectOption({ index: 2 });
  const countryChosen = await page.locator('[data-testid="form-field"][data-field-name="country"]').inputValue();
  await page.screenshot({ path: info.outputPath("form-after.png") });

  const out = await exportPdf(page, "filled.pdf");
  const v = await values(out);
  expect(v.name).toBe("Riley Chen");
  expect(v.email).toBe("riley@example.test");
  expect(v.news).toBe(true);
  expect(v.member).toBe("Family");
  expect(v.country).toBe(countryChosen);
  const before = await values(orig);
  expect(before.name).toBe("Alex Morgan");

  // reopen the exported file in the editor: the values are there
  const outPath = info.outputPath("filled.pdf");
  await openEditor(page, outPath);
  await expect(page.locator('[data-testid="form-field"][data-field-name="full_name"]')).toHaveValue("Riley Chen");
  await expect(page.locator('[data-testid="form-field"][data-field-name="newsletter"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-testid="form-field"][data-field-name="member_type"][data-option="Family"]')).toHaveAttribute("aria-checked", "true");
  expect(await pdfText(out)).toContain("Membership application");
});

test("typing in a field is one undo step; undo restores the value", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop layout");
  await openEditor(page, FORM);
  const name = page.locator('[data-testid="form-field"][data-field-name="full_name"]');
  await name.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Someone Else", { delay: 10 });
  await expect(name).toHaveValue("Someone Else");
  await page.locator("main, body").first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => undefined);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(name).toHaveValue("Alex Morgan");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(name).toHaveValue("Someone Else");
});
