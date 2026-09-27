import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, degrees } from "pdf-lib";
import { downloadFrom, fx } from "./helpers/tool";
import { renderPdfPage } from "./helpers/pdf-render";

// A scan stored sideways and flagged /Rotate 90 (common from office scanners) is shown upright. Text,
// pictures and signatures added to it must come out upright too — they used to turn with the page's
// stored frame and export sideways (text) or stretched on screen and sideways in the file (pictures).

async function sidewaysStoredPage(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]); // stored landscape…
  page.setRotation(degrees(90)); // …shown portrait
  return Buffer.from(await doc.save());
}

async function openRotated(page: Page) {
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles({ name: "sideways-scan.pdf", mimeType: "application/pdf", buffer: await sidewaysStoredPage() });
  const surface = page.getByTestId("page-surface").first();
  await expect(surface).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Actual size (100%)" }).click();
  return surface;
}

test("text added to a page shown rotated is upright on screen and in the exported PDF", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop pointer placement");
  const surface = await openRotated(page);
  const box = (await surface.boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width); // shown portrait
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.2);
  await page.keyboard.type("Upright words");
  await page.keyboard.press("Escape");
  const obj = (await page.locator('[data-object-type="added-text"]').first().boundingBox())!;
  expect(obj.width).toBeGreaterThan(obj.height * 2); // a line of text runs across, not down

  const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /Export PDF/i }));
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const p = await doc.getPage(1);
  const items = (await p.getTextContent()).items as { str: string; transform: number[] }[];
  const item = items.find((i) => i.str.includes("Upright"))!;
  expect(item).toBeTruthy();
  // In the page's stored frame the text must run along +y (rotated 90° counter-clockwise), which the
  // page's /Rotate 90 then turns to read left-to-right on screen.
  const [a, b] = item.transform;
  expect(Math.abs(a)).toBeLessThan(0.01);
  expect(b).toBeGreaterThan(0);
  // And where it shows: rendered upright, the ink is wider than it is tall.
  const r = await renderPdfPage(bytes, 1, 1);
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < r.height * 0.5; y++)
    for (let x = 0; x < r.width; x++) {
      const [pr, pg, pb] = r.getPixel(x, y);
      if (pr + pg + pb < 300) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  expect(x1 - x0).toBeGreaterThan((y1 - y0) * 3);
});

test("a picture placed on a page shown rotated keeps its shape and exports upright", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop pointer placement");
  const surface = await openRotated(page);
  const box = (await surface.boundingBox())!;
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Image", exact: true }).click()]);
  await chooser.setFiles(fx("qa", "img-landscape.jpg")); // a landscape (wider than tall) photo
  await page.getByText(/Tap the page where the image should go/).waitFor();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const obj = (await page.locator('[data-object-type="image"]').first().boundingBox())!;
  expect(obj.width).toBeGreaterThan(obj.height); // landscape on screen

  const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /Export PDF/i }));
  const r = await renderPdfPage(bytes, 1, 1);
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < r.height; y += 2)
    for (let x = 0; x < r.width; x += 2) {
      const [pr, pg, pb] = r.getPixel(x, y);
      if (Math.max(pr, pg, pb) - Math.min(pr, pg, pb) > 40 || pr + pg + pb < 600) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  // Landscape in the exported, displayed page too — the same proportions as on screen.
  expect((x1 - x0) / (y1 - y0)).toBeCloseTo(obj.width / obj.height, 0);
  expect(x1 - x0).toBeGreaterThan(y1 - y0);
  fs.writeFileSync(test.info().outputPath("exported.pdf"), bytes);
});
