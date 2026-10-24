import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { interpretPage } from "../src/lib/pdf-engine/interpreter";
import { EDITOR_FIXTURES, EVIDENCE, exportPdf, openEditor, pdfText } from "./helpers/native";

test.describe.configure({ timeout: 120_000 });
test.skip(({ isMobile }) => isMobile, "desktop pointer flow; touch handles are covered in the mobile spec");

const GALLERY = path.join(EDITOR_FIXTURES, "EDITOR-08-images.pdf");

async function placements(bytes: Buffer | Uint8Array, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes);
  return interpretPage(doc.getPage(pageIndex)).images.map((i) => ({ ...i.bbox, matrix: i.matrix, px: [i.pixelWidth, i.pixelHeight] }));
}

async function pick(page: Page, n = 0) {
  const img = page.locator('[data-testid="native-image"]').nth(n);
  await img.click();
  await expect(page.getByTestId("native-image-properties")).toBeVisible();
  return img;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function settle(page: Page) {
  // the page is rebuilt after an image edit; wait for the working copy to be applied (the dirty marker appears with the edit)
  await expect(page.getByTestId("dirty-indicator")).toBeVisible();
  await page.waitForTimeout(600);
}

test("an existing picture can be selected, moved, resized (proportions kept), turned, replaced and deleted — and each is undoable", async ({ page }) => {
  const orig = fs.readFileSync(GALLERY);
  const before = await placements(orig);
  expect(before.length).toBe(2);

  await openEditor(page, GALLERY);
  const first = await pick(page, 0);
  await page.screenshot({ path: path.join(EVIDENCE, "image-edit-before.png") });

  // move
  const box = (await first.boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 60, y: box.y + box.height / 2 + 40 });
  await settle(page);
  let out = await exportPdf(page, "moved.pdf");
  let now = await placements(out);
  const scale = box.width / before[0].width;
  expect(now.length).toBe(2);
  expect(now[0].x - before[0].x).toBeCloseTo(60 / scale, 0);
  expect(before[0].y - now[0].y).toBeCloseTo(40 / scale, 0); // page y runs up
  expect(now[0].width).toBeCloseTo(before[0].width, 1);
  expect(now[1].x).toBeCloseTo(before[1].x, 1);
  expect(await pdfText(out)).toContain("Site photos");

  // undo puts it back; redo moves it again
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(500);
  out = await exportPdf(page, "undone.pdf");
  now = await placements(out);
  expect(now[0].x).toBeCloseTo(before[0].x, 1);
  await page.getByRole("button", { name: "Redo" }).click();
  await page.waitForTimeout(500);
  out = await exportPdf(page, "redone.pdf");
  now = await placements(out);
  expect(now[0].x - before[0].x).toBeCloseTo(60 / scale, 0);

  // resize from the bottom-right corner: the proportions stay
  const sel = await pick(page, 0);
  const b2 = (await sel.boundingBox())!;
  const handle = sel.locator('[data-handle="se"]');
  const hb = (await handle.boundingBox())!;
  await drag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2 + 50, y: hb.y + hb.height / 2 + 5 });
  await settle(page);
  out = await exportPdf(page, "resized.pdf");
  now = await placements(out);
  const ratioBefore = before[0].width / before[0].height;
  expect(now[0].width / now[0].height).toBeCloseTo(ratioBefore, 1);
  expect(now[0].width).toBeGreaterThan(before[0].width + 20);
  expect(b2.width).toBeGreaterThan(0);

  // delete with the keyboard
  await pick(page, 1);
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-testid="native-image"]')).toHaveCount(1, { timeout: 15_000 });
  out = await exportPdf(page, "deleted.pdf");
  expect((await placements(out)).length).toBe(1);
  expect(await pdfText(out)).toContain("Site photos");
  await page.screenshot({ path: path.join(EVIDENCE, "image-edit-after.png") });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator('[data-testid="native-image"]')).toHaveCount(2, { timeout: 15_000 });
});

test("a picture can be replaced from the panel and turned with the handle", async ({ page }) => {
  await openEditor(page, GALLERY);
  await pick(page, 0);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Replace picture…" }).click();
  (await chooser).setFiles(path.join(__dirname, "fixtures", "image-2x1.png"));
  await page.waitForTimeout(1500);
  let out = await exportPdf(page, "replaced.pdf");
  let now = await placements(out);
  expect(now.length).toBe(2);
  expect(now[0].px).toEqual([300, 150]); // the new picture's own pixels (image-2x1.png)
  expect(now[0].px).not.toEqual((await placements(fs.readFileSync(GALLERY)))[0].px);

  const sel = await pick(page, 0);
  const b = (await sel.boundingBox())!;
  const rot = sel.locator('[data-handle="rotate"]');
  const rb = (await rot.boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  // drag the round handle to the right of the centre: a quarter turn clockwise
  await drag(page, { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 }, { x: cx + 200, y: cy });
  await page.waitForTimeout(1200);
  out = await exportPdf(page, "turned.pdf");
  const turned = await placements(out);
  // a quarter turn swaps the picture's width and height on the page
  expect(turned[0].width / turned[0].height).toBeCloseTo(now[0].height / now[0].width, 1);
  now = turned;
  expect(now.length).toBe(2);
});

test("images in a six-picture gallery: only the one that was touched moves", async ({ page }) => {
  const file = path.join(EDITOR_FIXTURES, "EDITOR-20-multi-image.pdf");
  const before = await placements(fs.readFileSync(file));
  expect(before.length).toBe(6);
  await openEditor(page, file);
  const img = await pick(page, 2);
  const b = (await img.boundingBox())!;
  await drag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: b.x + b.width / 2 + 30, y: b.y + b.height / 2 });
  await settle(page);
  const out = await exportPdf(page, "gallery.pdf");
  const now = await placements(out);
  expect(now.length).toBe(6);
  let moved = 0;
  now.forEach((n, i) => {
    if (Math.abs(n.x - before[i].x) > 0.5) moved++;
  });
  expect(moved).toBe(1);
});
