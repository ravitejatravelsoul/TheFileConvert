import fs from "node:fs";
import { deflateSync } from "node:zlib";
import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { addFiles, downloadFrom, expectNoHorizontalOverflow, fx, trackPageErrors } from "./helpers/tool";

// Scanner apps store pages as lossless Flate RGB images; a JPEG-only compressor used to hand these back
// unchanged. This builds such a PDF and drives the real Compress PDF page.
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

async function customTarget(page: import("@playwright/test").Page, kb: number) {
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  await page.getByLabel("Custom target size").fill(String(kb));
  await page.getByRole("radio", { name: "KB", exact: true }).click();
}

test("a Flate-encoded scan really shrinks under a real target, with exact byte counts shown", async ({ page }) => {
  const errors = trackPageErrors(page);
  const pdf = await flateScanPdf();
  await page.goto("/compress-pdf");
  await addFiles(page, { name: "scan.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText(/there is real room to shrink it/)).toBeVisible({ timeout: 20_000 });
  const target = Math.round((pdf.length / 1000) * 0.4);
  await customTarget(page, target);
  await page.getByRole("button", { name: `Compress to under ${target} KB` }).click();
  const result = page.getByTestId("result");
  await expect(result.getByRole("status")).toContainText("Done", { timeout: 60_000 });
  await expect(result.getByText("Best quality we could preserve for your target.")).toBeVisible();
  const exact = await result.getByTestId("exact-bytes").nth(1).innerText();
  const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /^Download/ }));
  expect(exact).toBe(`${bytes.length.toLocaleString("en-US")} bytes`);
  expect(bytes.length).toBeLessThanOrEqual(target * 1000);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("an unreachable target is reported honestly, with the closest result offered", async ({ page }) => {
  await page.goto("/compress-pdf");
  await addFiles(page, [fx("with-image.pdf")]);
  await customTarget(page, 1);
  await page.getByRole("button", { name: "Compress to under 1 KB" }).click();
  const result = page.getByTestId("result");
  await expect(result.getByRole("status")).toHaveText("Target not reached", { timeout: 60_000 });
  await expect(result.getByText("Couldn’t reach 1 KB without unacceptable quality loss.")).toBeVisible();
  await expect(result.getByText(/^Closest safe result:/)).toBeVisible();
  await expect(result.getByText("1 KB ✗")).toBeVisible();
  await expect(result.getByText(/^Done/)).toHaveCount(0);
  const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /^Download/ }));
  expect(bytes.length).toBeGreaterThan(1000);
});

test("a PDF already under the target is returned byte-for-byte unchanged", async ({ page }) => {
  await page.goto("/compress-pdf");
  await addFiles(page, [fx("sample-a.pdf")]);
  await expect(page.getByText(/already under 1 MB/)).toBeVisible();
  await page.getByRole("button", { name: "Compress to under 1 MB" }).click();
  await expect(page.getByTestId("result").getByRole("status")).toHaveText("Already under your target");
  const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /^Download/ }));
  expect(bytes.equals(fs.readFileSync(fx("sample-a.pdf")))).toBe(true);
});

test("Continue with hands the result to the next tool without picking it again", async ({ page }) => {
  await page.goto("/compress-pdf");
  await addFiles(page, [fx("sample-a.pdf")]);
  await page.getByRole("button", { name: "Compress to under 1 MB" }).click();
  await page.getByRole("button", { name: "Split PDF" }).click();
  await expect(page).toHaveURL(/\/split-pdf$/);
  await expect(page.getByText("sample-a.pdf")).toBeVisible();
});

// Regression: a real-world ~320 KB PDF (Chrome's own print-to-PDF: a photo stored as a JPEG with an ICC
// profile colour space) asked to go under 200 KB used to come back at its original size, because images
// with ICC colour spaces were never re-encoded.
test("a ~320 KB Chrome-printed PDF really goes under a 200 KB target", async ({ page, browser }) => {
  const maker = await browser.newPage();
  const photo = fs.readFileSync(fx("qa", "img-landscape.jpg")).toString("base64");
  await maker.setContent(`<html><body style="font-family:Arial;margin:40px"><h1>Site report</h1><p>${"Inspection notes for the north building. ".repeat(20)}</p><img src="data:image/jpeg;base64,${photo}" style="width:100%"></body></html>`);
  const pdf = await maker.pdf({ format: "A4", printBackground: true });
  await maker.close();
  expect(pdf.length).toBeGreaterThan(200_000); // the input really is over the target

  await page.goto("/compress-pdf");
  await addFiles(page, { name: "report.pdf", mimeType: "application/pdf", buffer: pdf });
  await customTarget(page, 200);
  await page.getByRole("button", { name: "Compress to under 200 KB" }).click();
  const result = page.getByTestId("result");
  await expect(result.getByRole("status")).toContainText("Done", { timeout: 60_000 });
  const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /^Download/ }));
  expect(bytes.length).toBeLessThanOrEqual(200_000);
  expect(bytes.equals(pdf)).toBe(false);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe((await PDFDocument.load(pdf)).getPageCount());
});

test("a file already under the target is returned unchanged by the image compressor too", async ({ page }) => {
  await page.goto("/compress-image");
  await addFiles(page, [fx("qa", "img-photo-small-optimized.jpg")]);
  await customTarget(page, 200);
  await page.getByRole("button", { name: "Compress to under 200 KB" }).click();
  await expect(page.getByTestId("result").getByRole("status")).toHaveText("Already under your target");
  const { bytes } = await downloadFrom(page, page.getByRole("button", { name: /^Download/ }));
  expect(bytes.equals(fs.readFileSync(fx("qa", "img-photo-small-optimized.jpg")))).toBe(true);
});
