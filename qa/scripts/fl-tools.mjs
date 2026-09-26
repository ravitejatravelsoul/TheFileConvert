// Acceptance for converter, PDF→image, images→PDF, merge, split and organize through the real UI.
//   node qa/scripts/fl-tools.mjs
import { launch, open, addFiles, download, size, pdfInfo, renderPage, imageInfo, zipEntries, rec, save, shot, fx, fs, path, OUT } from "./fl-lib.mjs";
import { PDFDocument } from "pdf-lib";

const { browser, page, errors } = await launch();

async function step(tool, test, fn) {
  try {
    await fn();
  } catch (e) {
    rec(tool, test, "FAIL", { error: String(e).slice(0, 400) });
  }
}

// ------------------------------------------------------------------ Image converter
const CONVERSIONS = [
  ["FL-IMG-08-portrait.jpg", "PNG", "png"],
  ["FL-IMG-08-portrait.jpg", "WebP", "webp"],
  ["FL-IMG-03-transparent.png", "JPG", "jpeg"],
  ["FL-IMG-03-transparent.png", "WebP", "webp"],
  ["FL-IMG-05-photo.webp", "JPG", "jpeg"],
  ["FL-IMG-05-photo.webp", "PNG", "png"],
  ["FL-IMG-06-vector.svg", "PNG", "png"],
];
for (const [fixture, label, format] of CONVERSIONS) {
  await step("Image Converter", `${fixture} → ${label}`, async () => {
    await open(page, "/convert-image");
    await addFiles(page, [fixture]);
    await page.getByRole("radio", { name: new RegExp(`^${label}`) }).click();
    if (fixture.endsWith(".svg")) await shot(page, "07-converter.png");
    await page.getByRole("button", { name: `Convert to ${label}` }).click();
    await page.getByTestId("result").waitFor({ timeout: 120_000 });
    const out = await download(page, page.getByRole("button", { name: `Download ${label}` }), `conv-${format}`);
    const src = fixture.endsWith(".svg") ? null : await imageInfo(fx(fixture));
    const img = await imageInfo(out);
    const dimsOk = src ? img.w === src.w && img.h === src.h : img.w === 1024 && img.h === 640;
    const alphaOk = format === "jpeg" ? !img.hasAlpha : src ? src.hasAlpha === img.hasAlpha : img.hasAlpha;
    const verdict = img.format === format && dimsOk && alphaOk ? "PASS" : "FAIL";
    rec("Image Converter", `${fixture} → ${label}`, verdict, { output: size(out), format: img.format, dims: `${img.w}x${img.h}`, alpha: img.hasAlpha, name: path.basename(out) });
  });
}
await step("Image Converter", "batch of 3 → ZIP", async () => {
  await open(page, "/convert-image");
  await addFiles(page, ["FL-IMG-08-portrait.jpg", "FL-IMG-05-photo.webp", "FL-IMG-03-transparent.png"]);
  await page.getByRole("radio", { name: /^PNG/ }).click();
  await page.getByRole("button", { name: "Convert to PNG" }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const out = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), "conv-batch");
  const entries = await zipEntries(out);
  // The PNG input is already PNG and must be skipped, not re-encoded.
  const skipped = await page.getByText(/Already PNG — skipped/).count();
  rec("Image Converter", "batch of 3 → ZIP", entries.length === 2 && skipped === 1 ? "PASS" : "FAIL", { entries: entries.map((e) => e.name), skipped });
});

// ------------------------------------------------------------------ PDF → Image
await step("PDF → Image", "all pages → JPG (ZIP)", async () => {
  await open(page, "/pdf-to-image");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  await page.getByRole("button", { name: "Convert all 12 pages" }).waitFor();
  await page.waitForTimeout(1500);
  await shot(page, "08-pdf-to-image-pages.png");
  await page.getByRole("button", { name: "Convert all 12 pages" }).click();
  await page.getByTestId("result").waitFor({ timeout: 180_000 });
  const out = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), "p2i-all");
  const entries = await zipEntries(out);
  fs.writeFileSync(path.join(OUT, "p2i-page-7.jpg"), entries.find((e) => e.name.endsWith("page-7.jpg")).bytes);
  const p7 = await imageInfo(path.join(OUT, "p2i-page-7.jpg"));
  rec("PDF → Image", "all pages → JPG (ZIP)", entries.length === 12 && p7.format === "jpeg" && p7.w === 1224 ? "PASS" : "FAIL", { entries: entries.length, page7: `${p7.w}x${p7.h} ${p7.format}` });
});
await step("PDF → Image", "selected pages 2 and 5 → PNG", async () => {
  await open(page, "/pdf-to-image");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("checkbox", { name: "Page 2", exact: true }).click();
  await page.getByRole("checkbox", { name: "Page 5", exact: true }).click();
  await page.getByRole("radio", { name: "PNG" }).click();
  await page.getByRole("button", { name: "Convert 2 pages" }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const out = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), "p2i-sel");
  const names = (await zipEntries(out)).map((e) => e.name).sort();
  rec("PDF → Image", "selected pages 2 and 5 → PNG", names.join(",") === "FL-PDF-05-multipage-page-2.png,FL-PDF-05-multipage-page-5.png" ? "PASS" : "FAIL", { names });
});

// ------------------------------------------------------------------ Images → PDF
await step("Images → PDF", "3 images, reordered by drag, fit-to-image", async () => {
  await open(page, "/image-to-pdf");
  await addFiles(page, ["FL-IMG-08-portrait.jpg", "FL-IMG-05-photo.webp", "FL-IMG-03-transparent.png"]);
  const cards = page.locator("ol > li[data-sort-key]");
  await cards.first().waitFor();
  // Drag the third card onto the first position with a real mouse drag.
  const from = await cards.nth(2).boundingBox();
  const to = await cards.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 40);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 12 });
  await page.mouse.up();
  const order = await cards.evaluateAll((els) => els.map((e) => e.querySelector("img")?.getAttribute("alt")));
  await shot(page, "09-images-to-pdf.png");
  await page.getByRole("button", { name: /^Create PDF/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "i2p");
  const doc = await PDFDocument.load(fs.readFileSync(out));
  const sizes = doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`);
  // Fit-to-image: 0.75 pt per px. Expected order after drag: transparent PNG (2400x1800), portrait (1200x1800), WebP (2000x1500).
  const expected = ["1800x1350", "900x1350", "1500x1125"];
  rec("Images → PDF", "3 images, reordered by drag, fit-to-image", sizes.join() === expected.join() ? "PASS" : "FAIL", { order, pageSizes: sizes, output: size(out) });
});
await step("Images → PDF", "A4 with landscape auto-orientation", async () => {
  await open(page, "/image-to-pdf");
  await addFiles(page, ["FL-IMG-08-portrait.jpg", "FL-IMG-05-photo.webp"]);
  await page.getByRole("radio", { name: "A4" }).click();
  await page.getByRole("button", { name: /^Create PDF/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "i2p-a4");
  const doc = await PDFDocument.load(fs.readFileSync(out));
  const sizes = doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`);
  rec("Images → PDF", "A4 with landscape auto-orientation", sizes.join() === "595x842,842x595" ? "PASS" : "FAIL", { pageSizes: sizes });
});

// ------------------------------------------------------------------ Merge
await step("Merge PDF", "3 PDFs, reordered, merged", async () => {
  await open(page, "/merge-pdf");
  await addFiles(page, ["FL-PDF-09a-merge.pdf", "FL-PDF-09b-merge.pdf", "FL-PDF-09c-merge.pdf"]);
  await page.getByText("9 pages in total", { exact: false }).waitFor();
  await page.waitForTimeout(800);
  await shot(page, "10-merge.png");
  // C before A: move C up twice with the buttons (keyboard-accessible path)
  await page.getByRole("button", { name: "Move FL-PDF-09c-merge.pdf up" }).click();
  await page.getByRole("button", { name: "Move FL-PDF-09c-merge.pdf up" }).click();
  await page.getByRole("button", { name: "Merge 3 PDFs" }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const out = await download(page, page.getByRole("button", { name: "Download merged PDF" }), "merge");
  const info = await pdfInfo(out);
  const firstLines = info.texts.map((t) => (t.match(/(ALPHA|BRAVO|CHARLIE) — Page \d of \d/) ?? [""])[0]);
  const expected = ["CHARLIE — Page 1 of 4", "CHARLIE — Page 2 of 4", "CHARLIE — Page 3 of 4", "CHARLIE — Page 4 of 4", "ALPHA — Page 1 of 3", "ALPHA — Page 2 of 3", "ALPHA — Page 3 of 3", "BRAVO — Page 1 of 2", "BRAVO — Page 2 of 2"];
  rec("Merge PDF", "3 PDFs, reordered, merged", info.pages === 9 && firstLines.join("|") === expected.join("|") ? "PASS" : "FAIL", { pages: info.pages, order: firstLines });
});

// ------------------------------------------------------------------ Split
await step("Split PDF", "extract selected pages 2, 3, 7 (click + shift-click)", async () => {
  await open(page, "/split-pdf");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  await page.getByRole("checkbox", { name: "Page 2", exact: true }).click();
  await page.getByRole("checkbox", { name: "Page 3", exact: true }).click({ modifiers: ["Shift"] });
  await page.getByRole("checkbox", { name: "Page 7", exact: true }).click();
  await page.waitForTimeout(800);
  await shot(page, "11-split.png");
  await page.getByRole("button", { name: "Extract 3 pages" }).click();
  await page.getByTestId("result").waitFor();
  const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "split-sel");
  const info = await pdfInfo(out);
  const labels = info.texts.map((t) => (t.match(/Page (\d+) of 12/) ?? [])[1]);
  rec("Split PDF", "extract selected pages 2, 3, 7", labels.join(",") === "2,3,7" ? "PASS" : "FAIL", { pages: info.pages, labels, name: path.basename(out) });
});
await step("Split PDF", "typed range 10-12", async () => {
  await open(page, "/split-pdf");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  await page.getByLabel("Or type pages").fill("10-12");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Extract 3 pages" }).click();
  await page.getByTestId("result").waitFor();
  const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "split-range");
  const labels = (await pdfInfo(out)).texts.map((t) => (t.match(/Page (\d+) of 12/) ?? [])[1]);
  rec("Split PDF", "typed range 10-12", labels.join(",") === "10,11,12" ? "PASS" : "FAIL", { labels });
});
await step("Split PDF", "split every page → ZIP", async () => {
  await open(page, "/split-pdf");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  await page.getByRole("radio", { name: /Split every page/ }).click();
  await page.getByRole("button", { name: "Split into 12 PDFs" }).click();
  await page.getByTestId("result").waitFor();
  const out = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), "split-all");
  const entries = await zipEntries(out);
  let ok = entries.length === 12;
  for (const e of entries) {
    const d = await PDFDocument.load(e.bytes);
    if (d.getPageCount() !== 1) ok = false;
  }
  rec("Split PDF", "split every page → ZIP", ok ? "PASS" : "FAIL", { files: entries.length, first: entries[0]?.name });
});

// ------------------------------------------------------------------ Organize
await step("Organize PDF", "reorder (drag), rotate, delete, duplicate, save", async () => {
  await open(page, "/organize-pdf");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  const cards = page.locator("ol > li[data-sort-key]");
  await cards.nth(11).waitFor();
  // drag page 4 before page 1
  const from = await cards.nth(3).boundingBox();
  const to = await cards.nth(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + 60);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 14 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click();
  await page.getByRole("button", { name: "Delete Page 12", exact: true }).click();
  await page.getByRole("button", { name: "Duplicate Page 1", exact: true }).click();
  await page.waitForTimeout(1000);
  await shot(page, "12-organize.png");
  await page.getByRole("button", { name: "Save PDF" }).click();
  await page.getByTestId("result").waitFor();
  const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "organize");
  const info = await pdfInfo(out);
  const labels = info.texts.map((t) => (t.match(/Page (\d+) of 12/) ?? [])[1]);
  const expected = "4,1,1,2,3,5,6,7,8,9,10,11";
  const rot = info.rotations;
  const ok = labels.join(",") === expected && rot[3] === 90 && rot.filter((r) => r !== 0).length === 1;
  const img = await renderPage(info.doc, 4, 0.4); // rotated page renders landscape
  rec("Organize PDF", "reorder (drag), rotate, delete, duplicate, save", ok && img.w > img.h ? "PASS" : "FAIL", { labels: labels.join(","), rotations: rot.join(","), page4: `${img.w}x${img.h}` });
});
await step("Organize PDF", "rotated source keeps its own rotation and adds to it", async () => {
  await open(page, "/organize-pdf");
  await addFiles(page, ["FL-PDF-06-rotated.pdf"]);
  await page.locator("ol > li[data-sort-key]").nth(3).waitFor();
  await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click();
  await page.getByRole("button", { name: "Save PDF" }).click();
  await page.getByTestId("result").waitFor();
  const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "organize-rot");
  const info = await pdfInfo(out);
  rec("Organize PDF", "rotated source keeps its own rotation and adds to it", info.rotations.join(",") === "0,180,180,270" ? "PASS" : "FAIL", { rotations: info.rotations.join(",") });
});

if (errors.length) rec("All tools", "console errors", "FAIL", { errors });
else rec("All tools", "console errors", "PASS", {});
await browser.close();
save("tools");
