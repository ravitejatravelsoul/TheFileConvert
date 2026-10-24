import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { EDITOR_FIXTURES, exportPdf, goToPage, openEditor, pdfText, typeInto, finishEdit } from "./helpers/native";
import { pickTool } from "./helpers/editor";

/** FINAL RELEASE GATE — editor features that the long session does not cover in depth. */
test.skip(({ isMobile }) => isMobile, "desktop pointer flow");
test.describe.configure({ timeout: 180_000 });

async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}
const surfaceBox = async (page: Page) => (await page.locator('[data-testid="page-surface"]').first().boundingBox())!;

test("signature: draw, place, move, resize, delete — and upload; it is labelled a visual signature", async ({ page }) => {
  await openEditor(page, path.join(EDITOR_FIXTURES, "EDITOR-03-business-letter.pdf"));
  await pickTool(page, "Sign");
  const dialog = page.getByRole("dialog", { name: "Add signature" });
  await expect(dialog).toContainText("visual signature");
  await expect(dialog).toContainText("not a cryptographic");
  const pad = (await dialog.getByRole("img", { name: "Signature drawing area" }).boundingBox())!;
  await drag(page, { x: pad.x + 10, y: pad.y + 10 }, { x: pad.x + pad.width - 10, y: pad.y + pad.height - 10 });
  await dialog.getByRole("button", { name: "Place signature" }).click();
  let b = await surfaceBox(page);
  await page.mouse.click(b.x + 150, b.y + 300);
  const sig = page.locator('[data-object-type="signature"]');
  await expect(sig).toHaveCount(1);
  const s0 = (await sig.boundingBox())!;
  await drag(page, { x: s0.x + s0.width / 2, y: s0.y + s0.height / 2 }, { x: s0.x + s0.width / 2 + 70, y: s0.y + s0.height / 2 + 30 });
  const s1 = (await sig.boundingBox())!;
  expect(Math.round(s1.x - s0.x)).toBeGreaterThan(50);
  // the corner handle sits just outside the box (its centre 6 px out)
  await drag(page, { x: s1.x + s1.width + 6, y: s1.y + s1.height + 6 }, { x: s1.x + s1.width + 46, y: s1.y + s1.height + 36 });
  expect((await sig.boundingBox())!.width).toBeGreaterThan(s1.width + 10);
  const out1 = await exportPdf(page, "sig1.pdf");
  expect(await pdfImages(out1)).toBeGreaterThanOrEqual(1);
  await sig.click();
  await page.keyboard.press("Delete");
  await expect(sig).toHaveCount(0);
  // upload route
  await pickTool(page, "Sign");
  await page.getByRole("radio", { name: "Upload image" }).click();
  await page.getByLabel("Upload signature image").setInputFiles(path.join(__dirname, "fixtures", "image-2x1.png"));
  await dialog.getByRole("button", { name: "Place signature" }).click();
  b = await surfaceBox(page);
  await page.mouse.click(b.x + 160, b.y + 320);
  await expect(sig).toHaveCount(1);
  const out2 = await exportPdf(page, "sig2.pdf");
  expect(await pdfImages(out2)).toBeGreaterThanOrEqual(1);
});

async function pdfImages(bytes: Buffer): Promise<number> {
  const tmp = test.info().outputPath(`probe-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, bytes);
  const out = execFileSync("python", ["-c", "import pymupdf,sys,json;d=pymupdf.open(sys.argv[1]);print(sum(len(p.get_images()) for p in d))", tmp], { encoding: "utf8" });
  return Number(out.trim());
}

test("whiteout is labelled 'not secure redaction' and no redaction is offered", async ({ page }) => {
  await openEditor(page, path.join(EDITOR_FIXTURES, "EDITOR-03-business-letter.pdf"));
  await pickTool(page, "Whiteout");
  await expect(page.getByText(/not secure redaction/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /redact/i })).toHaveCount(0);
  const b = await surfaceBox(page);
  await drag(page, { x: b.x + 90, y: b.y + 150 }, { x: b.x + 300, y: b.y + 190 });
  await expect(page.locator('[data-object-type="whiteout"]')).toHaveCount(1);
});

test("crop: exact CropBox on a rotated page and on a page of a different size; other pages are untouched", async ({ page }) => {
  for (const [file, pageNo, label] of [["EDITOR-09-rotated-pages.pdf", 2, "rotated"], ["EDITOR-10-mixed-page-sizes.pdf", 3, "A5"]] as const) {
    const src = path.join(EDITOR_FIXTURES, file);
    await openEditor(page, src);
    await goToPage(page, pageNo);
    await pickTool(page, "Crop");
    const b = await surfaceBox(page);
    const a = { x: b.x + b.width * 0.15, y: b.y + b.height * 0.2 };
    const z = { x: b.x + b.width * 0.8, y: b.y + b.height * 0.6 };
    await drag(page, a, z);
    await page.getByRole("button", { name: "Keep this area" }).first().click();
    const out = await exportPdf(page, `crop-${label}.pdf`);
    const outPath = test.info().outputPath(`crop-${label}.pdf`);
    fs.writeFileSync(outPath, out);
    const info = JSON.parse(
      execFileSync(
        "python",
        [
          "-c",
          `import pymupdf,json,sys
d=pymupdf.open(sys.argv[1]);o=pymupdf.open(sys.argv[2]);n=int(sys.argv[3])-1
res=[]
for i,p in enumerate(d):
    q=o[i]
    res.append({"crop":[round(v,2) for v in p.cropbox],"origCrop":[round(v,2) for v in q.cropbox],"w":p.rect.width,"h":p.rect.height,"ow":q.rect.width,"oh":q.rect.height})
print(json.dumps(res))`,
          outPath,
          src,
          String(pageNo),
        ],
        { encoding: "utf8" },
      )
        .trim()
        .split(String.fromCharCode(10))
        .pop()!,
    ) as { crop: number[]; origCrop: number[]; w: number; h: number; ow: number; oh: number }[];
    const edited = info[pageNo - 1];
    // the page as it is shown now has the shape of the rectangle that was drawn (rotation included)
    const drawn = (z.x - a.x) / (z.y - a.y);
    expect(edited.w / edited.h).toBeCloseTo(drawn, 1);
    expect(edited.w).toBeLessThan(edited.ow);
    info.forEach((p, i) => {
      if (i !== pageNo - 1) expect(p.crop, `page ${i + 1} untouched`).toEqual(p.origCrop);
    });
    const doc = await PDFDocument.load(out);
    const box = doc.getPage(pageNo - 1).getCropBox();
    const media = doc.getPage(pageNo - 1).getMediaBox();
    expect(box.x).toBeGreaterThanOrEqual(media.x - 0.01);
    expect(box.x + box.width).toBeLessThanOrEqual(media.x + media.width + 0.01);
  }
});

test("page organization in one session: insert blank, insert from another PDF, rotate, duplicate, reorder, delete", async ({ page }) => {
  const a = path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"); // 1 page
  const c = path.join(EDITOR_FIXTURES, "EDITOR-09-rotated-pages.pdf"); // 4 pages
  await openEditor(page, a);
  await page.getByRole("button", { name: "Go to page 1", exact: true }).hover();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Insert pages after page 1" }).click()]);
  await chooser.setFiles(c);
  await expect(page.getByText("5 pages").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "+ Blank page" }).click();
  await expect(page.getByText("6 pages").first()).toBeVisible();
  await page.getByRole("button", { name: "Go to page 2", exact: true }).hover();
  await page.getByRole("button", { name: "Rotate page 2 clockwise" }).click();
  await page.getByRole("button", { name: "Go to page 3", exact: true }).hover();
  await page.getByRole("button", { name: "Duplicate page 3" }).click();
  await page.getByRole("button", { name: "Go to page 6", exact: true }).hover();
  await page.getByRole("button", { name: "Move page 6 up" }).click();
  await page.getByRole("button", { name: "Go to page 5", exact: true }).hover();
  await page.getByRole("button", { name: "Delete page 5" }).click();
  await expect(page.getByText("6 pages").first()).toBeVisible();
  const out = await exportPdf(page, "pages.pdf");
  const doc = await PDFDocument.load(out);
  expect(doc.getPageCount()).toBe(6);
  const heads: string[] = [];
  for (let i = 1; i <= 6; i++) heads.push((await pdfText(out, i)).slice(0, 18));
  expect(heads[0]).toContain("Quarterly Update");
  expect(heads.filter((h) => h.trim() === "").length).toBe(1); // the blank page is still there
  expect(doc.getPage(1).getRotation().angle).toBe(90 + 0); // page 2 (inserted, rotated by us)
});

test("undo and redo across text, picture, drawing, crop and page edits", async ({ page }) => {
  const src = path.join(EDITOR_FIXTURES, "EDITOR-08-images.pdf");
  await openEditor(page, src);
  const dirty = page.getByTestId("dirty-indicator");
  await typeInto(page, { has: "teh north", find: "teh", replace: "the" });
  await finishEdit(page);
  const img = page.locator('[data-testid="native-image"]').first();
  await img.click();
  const ib = (await img.boundingBox())!;
  await drag(page, { x: ib.x + ib.width / 2, y: ib.y + ib.height / 2 }, { x: ib.x + ib.width / 2 + 50, y: ib.y + ib.height / 2 + 30 });
  await page.waitForTimeout(800);
  await pickTool(page, "Draw");
  let b = await surfaceBox(page);
  await drag(page, { x: b.x + 100, y: b.y + 480 }, { x: b.x + 250, y: b.y + 520 });
  await page.keyboard.press("Escape");
  await pickTool(page, "Crop");
  b = await surfaceBox(page);
  await drag(page, { x: b.x + 20, y: b.y + 20 }, { x: b.x + b.width - 20, y: b.y + b.height - 80 });
  await page.getByRole("button", { name: "Keep this area" }).first().click();
  await page.getByRole("button", { name: "Go to page 1", exact: true }).hover();
  await page.getByRole("button", { name: "Rotate page 1 clockwise" }).click();
  await page.waitForTimeout(800);

  const state = async (name: string) => {
    const out = await exportPdf(page, `${name}.pdf`);
    const doc = await PDFDocument.load(out);
    const p = doc.getPage(0);
    return { text: await pdfText(out), crop: p.getCropBox().height < p.getMediaBox().height - 1, rot: p.getRotation().angle };
  };
  const full = await state("full");
  expect(full.text).toContain("the north");
  expect(full.crop).toBe(true);
  expect(full.rot).toBe(90);
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(500);
  }
  await expect(dirty).toHaveCount(0);
  const none = await state("none");
  expect(none.text).toContain("teh north");
  expect(none.crop).toBe(false);
  expect(none.rot).toBe(0);
  for (let i = 0; i < 5; i++) {
    await page.getByRole("button", { name: "Redo" }).click();
    await page.waitForTimeout(500);
  }
  const again = await state("again");
  expect(again).toEqual(full);
});
