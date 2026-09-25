import { deflateSync } from "node:zlib";
import { statSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";

// Regression for the "I compressed a 3.8 MB scan and got the same size back" report: scanner apps and PDF
// generators store pages as lossless Flate (often ASCII85-wrapped) RGB images, which the JPEG-only compressor
// used to ignore. This builds such a PDF and drives the real (V2, target-size) Compress PDF page.

async function flateScanPdf(): Promise<Buffer> {
  const w = 900;
  const h = 1200;
  const rgb = Buffer.alloc(w * h * 3);
  let seed = 7;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const paper = 240 + ((seed >>> 24) % 9) - 4;
      const ink = y % 40 < 6 && x > 60 && x < 800 ? 40 : paper;
      const i = (y * w + x) * 3;
      rgb[i] = rgb[i + 1] = rgb[i + 2] = ink;
    }
  }
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const dict = ctx.obj({ Type: "XObject", Subtype: "Image", Width: w, Height: h, ColorSpace: "DeviceRGB", BitsPerComponent: 8 });
  const bytes = deflateSync(rgb);
  dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
  dict.set(PDFName.of("Length"), PDFNumber.of(bytes.length));
  const ref = ctx.register(PDFRawStream.of(dict, bytes));
  const page = doc.addPage([612, 792]);
  const res = page.node.Resources() ?? ctx.obj({});
  const xo = ctx.obj({});
  xo.set(PDFName.of("Im1"), ref);
  res.set(PDFName.of("XObject"), xo);
  page.node.set(PDFName.of("Resources"), res);
  page.node.addContentStream(ctx.register(ctx.stream("q 612 0 0 792 0 0 cm /Im1 Do Q")));
  return Buffer.from(await doc.save());
}

async function setCustomTarget(page: import("@playwright/test").Page, kb: number) {
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.locator("input[type=number]").fill(String(Math.max(1, Math.round(kb))));
  await page.locator("select").selectOption("KB");
}

test("a Flate-encoded scan really shrinks toward a real target, with exact byte counts shown", async ({ page }) => {
  const pdf = await flateScanPdf();
  await page.goto("/pdf/compress");
  await page.locator('input[type="file"]').setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(/embedded image/i).first()).toBeVisible({ timeout: 20_000 });

  // A target well below the original forces the quality ladder to actually walk down and recompress
  // the Flate image — this is exactly the case that used to come back unchanged.
  await setCustomTarget(page, (pdf.length / 1024) * 0.4);
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  await expect(page.getByText("Done!")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Target ✓/)).toBeVisible();

  const exact = await page.getByTestId("exact-bytes").innerText();
  const m = exact.match(/([\d,]+) bytes → ([\d,]+) bytes/);
  expect(m).toBeTruthy();
  const before = Number(m![1].replace(/,/g, ""));
  const after = Number(m![2].replace(/,/g, ""));
  expect(before).toBe(pdf.length);
  expect(after).toBeLessThan(before * 0.4 * 1.02); // matches (or beats) the requested target, not just "smaller"

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).length).toBe(after);
});

test("a target already met by the free lossless pass is honest: no inflated saving is claimed", async ({ page }) => {
  const pdf = await flateScanPdf();
  await page.goto("/pdf/compress");
  await page.locator('input[type="file"]').setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(/embedded image/i).first()).toBeVisible({ timeout: 20_000 });

  // A target above the original size never needs the quality ladder — only the free structural pass,
  // which barely changes a single-image PDF with nothing to deduplicate.
  await setCustomTarget(page, (pdf.length / 1024) * 1.5);
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  await expect(page.getByText("Done!")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Target ✓/)).toBeVisible();
  await expect(page.getByText(/lossless \(no quality loss\)/)).toBeVisible();

  // No exaggerated claim: if a percentage is shown, it must be true of the real downloaded bytes.
  const originalSize = pdf.length;
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("no download path");
  const newSize = statSync(downloadPath).size;
  const smallerText = await page.getByText(/smaller$/).count();
  if (smallerText > 0) expect(newSize).toBeLessThan(originalSize);
});
