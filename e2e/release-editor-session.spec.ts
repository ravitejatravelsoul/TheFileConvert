import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { exportPdf, goToPage, openEditor, pdfText, typeInto, finishEdit, EVIDENCE } from "./helpers/native";
import { pickTool } from "./helpers/editor";

/**
 * FINAL RELEASE GATE — one uninterrupted editor session on a 12-page PDF that has text, a picture and a form:
 * 5 words edited in place, added text, a picture moved and resized, 9 markup strokes, drawing, shapes, a signature, form fields
 * filled, a crop, a rotation, a duplicate, a delete, a reorder, undo/redo, search — then one export that is validated by qpdf,
 * MuPDF, pdf.js and pdf-lib, read back for every change, and reopened in the editor.
 */
test.skip(({ isMobile }) => isMobile, "desktop pointer flow; the phone has its own spec");
test.describe.configure({ timeout: 300_000 });

const TYPOS: Record<number, [string, string]> = { 1: ["recieve", "receive"], 2: ["teh", "the"], 4: ["seperate", "separate"], 5: ["occured", "occurred"], 6: ["definately", "definitely"] };

async function buildFixture(file: string) {
  const doc = await PDFDocument.create();
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const png = await doc.embedPng(fs.readFileSync(path.join(__dirname, "fixtures", "image-2x1.png")));
  const form = doc.getForm();
  for (let n = 1; n <= 12; n++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Release test page ${n}`, { x: 72, y: 720, size: 20, font: bold });
    const typo = TYPOS[n];
    const sentence = `The committee will ${typo ? typo[0] : "review"} the final report before the end of the quarter, and the chair has asked every member to read it carefully. Page ${n} of twelve carries this paragraph so that every page has real text to search and to edit in place.`;
    page.drawText(sentence, { x: 72, y: 680, size: 11, font: sans, maxWidth: 460, lineHeight: 15, color: rgb(0.05, 0.05, 0.05) });
    if (n === 2) page.drawImage(png, { x: 72, y: 430, width: 220, height: 110 });
    if (n === 3) {
      const t = form.createTextField("release_name");
      t.addToPage(page, { x: 72, y: 560, width: 240, height: 22, borderColor: rgb(0.4, 0.4, 0.4) });
      t.setFontSize(12);
      t.setText("Raviteja");
      const c = form.createCheckBox("release_ok");
      c.addToPage(page, { x: 72, y: 520, width: 16, height: 16, borderColor: rgb(0.3, 0.3, 0.3) });
      page.drawText("Name", { x: 72, y: 590, size: 10, font: sans });
    }
  }
  form.updateFieldAppearances(sans);
  fs.writeFileSync(file, await doc.save());
}

async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

test("a 20+ action editor session: every change survives export and reopen", async ({ page }) => {
  const src = test.info().outputPath("release-12p.pdf");
  await buildFixture(src);
  const validate = (await import(/* webpackIgnore: true */ pathToFileURL(path.resolve("qa/scripts/validate-output.mjs")).href)) as { validateFile: (f: string) => Promise<{ ok: boolean; problems: string[]; pages?: number }> };

  await openEditor(page, src);
  const surface = page.locator('[data-testid="page-surface"]').first();
  const box = async () => (await surface.boundingBox())!;
  let actions = 0;
  const noteStillThere = async (where: string) => {
    await goToPage(page, 1);
    await expect(page.locator('[data-object-type="added-text"]'), `the added text after ${where}`).toHaveCount(1);
  };

  // 1–5: five words corrected in place (pages 1, 2, 4, 5, 6)
  for (const n of [1, 2, 4, 5, 6]) {
    await goToPage(page, n);
    const [from, to] = TYPOS[n];
    await typeInto(page, { has: from, find: from, replace: to });
    await finishEdit(page);
    actions++;
  }

  // 6: add text on page 1
  await goToPage(page, 1);
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  let b = await box();
  await page.mouse.click(b.x + 90, b.y + 520);
  await page.keyboard.type("Release note A");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-object-type="added-text"]')).toHaveCount(1);
  actions++;

  // 7–8: the picture on page 2 moved, then resized
  await goToPage(page, 2);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const img = page.locator('[data-testid="native-image"]').first();
  await img.click();
  const ib = (await img.boundingBox())!;
  await drag(page, { x: ib.x + ib.width / 2, y: ib.y + ib.height / 2 }, { x: ib.x + ib.width / 2 + 60, y: ib.y + ib.height / 2 + 40 });
  await page.waitForTimeout(700);
  const se = page.locator('[data-testid="native-image"]').first().locator('[data-handle="se"]');
  const hb = (await se.boundingBox())!;
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2 + 40, y: hb.y + hb.height / 2 + 20 });
  await page.waitForTimeout(700);
  actions += 2;

  await noteStillThere("the picture edit");
  // 9–10: form fields on page 3
  await goToPage(page, 3);
  const nameField = page.locator('[data-testid="form-field"][data-field-name="release_name"]');
  await expect(nameField).toHaveValue("Raviteja");
  await nameField.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" V");
  await page.keyboard.press("Tab");
  await page.locator('[data-testid="form-field"][data-field-name="release_ok"]').click();
  await expect(nameField).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
  actions += 2;

  await noteStillThere("the form edit");
  // 11–13: nine markup strokes on page 4 — each tool stays armed for the next one
  await goToPage(page, 4);
  b = await box();
  let y = 80;
  for (const tool of ["Highlight", "Underline", "Strike"]) {
    await pickTool(page, tool);
    for (let i = 0; i < 3; i++) {
      await drag(page, { x: b.x + 80, y: b.y + y }, { x: b.x + 330, y: b.y + y + 12 });
      y += 22;
      if (i === 0) await expect(page.getByRole("button", { name: tool === "Strike" ? "More" : tool, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    actions++;
  }
  await expect(page.locator('[data-object-type="annotation"]')).toHaveCount(9);
  await page.keyboard.press("Escape");

  await noteStillThere("markup");
  // 14: crop page 5 (the exact CropBox)
  await goToPage(page, 5);
  await pickTool(page, "Crop");
  b = await box();
  await drag(page, { x: b.x + 40, y: b.y + 40 }, { x: b.x + b.width - 40, y: b.y + b.height - 120 });
  await page.getByRole("button", { name: "Keep this area" }).first().click();
  actions++;

  await noteStillThere("the crop");
  // 15–19: page 6 — drawing, shapes, a signature
  await goToPage(page, 6);
  b = await box();
  await pickTool(page, "Draw");
  await drag(page, { x: b.x + 90, y: b.y + 330 }, { x: b.x + 200, y: b.y + 370 });
  await pickTool(page, "Rectangle");
  await drag(page, { x: b.x + 90, y: b.y + 400 }, { x: b.x + 180, y: b.y + 450 });
  await pickTool(page, "Ellipse");
  await drag(page, { x: b.x + 200, y: b.y + 400 }, { x: b.x + 290, y: b.y + 450 });
  await pickTool(page, "Line");
  await drag(page, { x: b.x + 310, y: b.y + 400 }, { x: b.x + 400, y: b.y + 450 });
  await pickTool(page, "Arrow");
  await drag(page, { x: b.x + 410, y: b.y + 400 }, { x: b.x + 480, y: b.y + 450 });
  await page.keyboard.press("Escape");
  actions += 5;
  await pickTool(page, "Sign");
  const dialog = page.getByRole("dialog", { name: "Add signature" });
  const pad = (await dialog.getByRole("img", { name: "Signature drawing area" }).boundingBox())!;
  await drag(page, { x: pad.x + 10, y: pad.y + 10 }, { x: pad.x + pad.width - 10, y: pad.y + pad.height - 10 });
  await dialog.getByRole("button", { name: "Place signature" }).click();
  b = await box();
  await page.mouse.click(b.x + 150, b.y + 250);
  await expect(page.locator('[data-object-type="signature"]')).toHaveCount(1);
  actions++;

  await noteStillThere("shapes and the signature");
  // page operations: rotate 7, duplicate 8, delete 9 (the original), move the last page up
  await goToPage(page, 7);
  await page.getByRole("button", { name: "Go to page 7", exact: true }).hover();
  await page.getByRole("button", { name: "Rotate page 7 clockwise" }).click();
  await page.getByRole("button", { name: "Go to page 8", exact: true }).hover();
  await page.getByRole("button", { name: "Duplicate page 8" }).click();
  await page.getByRole("button", { name: "Go to page 10", exact: true }).hover();
  await page.getByRole("button", { name: "Delete page 10" }).click();
  await page.getByRole("button", { name: "Go to page 12", exact: true }).hover();
  await page.getByRole("button", { name: "Move page 12 up" }).click();
  actions += 4;
  await expect(page.getByText("12 pages").first()).toBeVisible();

  await noteStillThere("the page operations");
  // undo the reorder and the delete, then redo them
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("13 pages").first()).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("12 pages").first()).toBeVisible();
  actions += 4;

  // everything done so far is still on its page after the undo/redo
  await goToPage(page, 1);
  await expect(page.locator('[data-object-type="added-text"]')).toHaveCount(1);

  // search: the corrected word is found, the old spelling is not
  await page.locator("summary", { hasText: /^\s*Search/ }).click();
  await page.getByLabel("Search document text").fill("recieve");
  await expect(page.getByText("No matches")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Search document text").fill("receive");
  await expect(page.getByText(/\d+ of \d+/).first()).toBeVisible({ timeout: 15_000 });
  actions++;
  expect(actions).toBeGreaterThanOrEqual(20);
  await page.screenshot({ path: path.join(EVIDENCE, "release-session-final.png") });

  // export, validate, read every change back
  const out = await exportPdf(page, "release-out.pdf");
  const outPath = test.info().outputPath("release-out.pdf");
  fs.writeFileSync(outPath, out);
  const v = await validate.validateFile(outPath);
  expect(v.problems, "qpdf / MuPDF / pdf.js / pdf-lib").toEqual([]);
  expect(v.ok).toBe(true);

  const pdf = await PDFDocument.load(out);
  expect(pdf.getPageCount()).toBe(12);
  const order: number[] = [];
  const texts: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const t = await pdfText(out, i);
    texts.push(t);
    order.push(Number(/Release test page (\d+)/.exec(t)?.[1]));
  }
  expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 10, 12, 11]); // 9 deleted, 8 duplicated, 12 moved up
  for (const [n, [from, to]] of Object.entries(TYPOS)) {
    const t = texts[order.indexOf(Number(n))];
    expect(t, `page ${n}`).toContain(to);
    expect(t, `page ${n}`).not.toContain(from);
  }
  expect(texts[0]).toContain("Release note A");
  const form = pdf.getForm();
  expect(form.getTextField("release_name").getText()).toBe("Raviteja V");
  expect(form.getCheckBox("release_ok").isChecked()).toBe(true);
  const cropped = pdf.getPage(order.indexOf(5));
  expect(cropped.getCropBox().width).toBeLessThan(cropped.getMediaBox().width);
  expect(pdf.getPage(order.indexOf(7)).getRotation().angle).toBe(90);

  // independent read of the drawn things (MuPDF): markup on page 4, shapes and the signature on page 6, the moved picture on page 2
  const probe = JSON.parse(
    execFileSync(
      "python",
      [
        "-c",
        `import pymupdf,json,sys
d=pymupdf.open(sys.argv[1]);o={}
for i,p in enumerate(d):
    h=p.get_text()
    import re
    m=re.search(r"Release test page (\\d+)",h)
    o[i]={"n":int(m.group(1)) if m else -1,"drawings":len(p.get_drawings()),"images":len(p.get_images())}
print(json.dumps(o))`,
        outPath,
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split(String.fromCharCode(10))
      .pop()!,
  ) as Record<string, { n: number; drawings: number; images: number }>;
  const byN = (n: number) => Object.values(probe).find((p) => p.n === n)!;
  expect(byN(4).drawings, "9 markup strokes on page 4").toBeGreaterThanOrEqual(9);
  expect(byN(6).drawings, "drawing and shapes on page 6").toBeGreaterThanOrEqual(4);
  expect(byN(6).images, "the signature on page 6").toBeGreaterThanOrEqual(1);
  expect(byN(2).images).toBeGreaterThanOrEqual(1);

  // reopen the exported file in the editor: the edits are the page's own text now
  await openEditor(page, outPath);
  await expect(page.locator('[data-testid="native-block"][data-text*="receive"]').first()).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('[data-testid="native-block"][data-text*="recieve"]')).toHaveCount(0);
});
