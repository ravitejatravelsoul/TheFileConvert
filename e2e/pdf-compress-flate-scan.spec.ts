import { deflateSync } from "node:zlib";
import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";

// Regression for the "I compressed a 3.8 MB scan and got the same size back" report: scanner apps and PDF
// generators store pages as lossless Flate (often ASCII85-wrapped) RGB images, which the JPEG-only compressor
// used to ignore. This builds such a PDF and drives the real Compress PDF page.

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

test("a Flate-encoded scan is preselected to Balanced and really shrinks, with exact byte counts shown", async ({ page }) => {
  const pdf = await flateScanPdf();
  await page.goto("/pdf/compress");
  await page.locator('input[type="file"]').setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(/embedded image/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("input[name=compress-level]:checked")).toHaveValue("balanced");

  await page.getByRole("button", { name: /^Compress scan.pdf/ }).click();
  await expect(page.getByText("Done!")).toBeVisible({ timeout: 60_000 });
  const exact = await page.getByTestId("exact-bytes").innerText();
  const m = exact.match(/([\d,]+) bytes → ([\d,]+) bytes/);
  expect(m).toBeTruthy();
  const before = Number(m![1].replace(/,/g, ""));
  const after = Number(m![2].replace(/,/g, ""));
  expect(before).toBe(pdf.length);
  expect(after).toBeLessThan(before * 0.4);

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).length).toBe(after);
});

test("Lossless mode on the same scan is honest: about the same size, no claimed saving", async ({ page }) => {
  const pdf = await flateScanPdf();
  await page.goto("/pdf/compress");
  await page.locator('input[type="file"]').setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(/embedded image/i).first()).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/^Lossless/).check();
  await page.getByRole("button", { name: /^Compress scan.pdf/ }).click();
  await expect(page.getByText("Done!")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("No significant change")).toBeVisible();
});
