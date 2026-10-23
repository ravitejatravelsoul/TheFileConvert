// Scenario matrices for converters, PDF → Image, Images → PDF, Merge, Split, Organize, error cases and
// repeat use, through the real UI. Every download goes through the shared output validator (fl-lib gate).
//   BASE=http://localhost:3000 node qa/scripts/fs-tools.mjs [convert|p2i|i2p|merge|split|organize|errors|repeat|all]
import { launch, open, addPaths, download, size, rec, save, sx, fs, path, OUT, imageInfo, imageSimilarity, pdfInfo, renderPage, zipEntries } from "./fl-lib.mjs";
import { PDFDocument } from "pdf-lib";

const which = process.argv[2] ?? "all";
const run = (name) => which === "all" || which === name;
const { browser, page, errors } = await launch();
const requests = [];
page.on("request", (r) => requests.push(r.url()));
const dialogs = [];
/** Set by a step that expects exactly one confirm (the editor's "Leave the editor?"). */
let expectedDialog = null;
page.on("dialog", (d) => {
  if (expectedDialog && expectedDialog.test(d.message())) {
    expectedDialog = null;
    void d.accept();
    return;
  }
  dialogs.push(d.message());
  void d.dismiss();
});

async function step(tool, test, fn) {
  try {
    await fn();
  } catch (e) {
    rec(tool, test, "FAIL", { error: String(e).slice(0, 400) });
  }
}
const result = () => page.getByTestId("result").waitFor({ timeout: 300_000 });
const alerts = async () => (await page.getByRole("alert").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
const pdfPages = async (file) => (await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false })).getPages();
const sizesOf = (pages) => pages.map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`);
const markers = (texts, re) => texts.map((t) => (t.match(re) ?? [])[1]);

// ================================================================== Image Converter
if (run("convert")) {
  const C = [
    ["IMAGE-B-photo-500k.jpg", "PNG", "png", "landscape JPG → PNG"],
    ["X-portrait-1200x1800.jpg", "WebP", "webp", "portrait JPG → WebP"],
    ["IMAGE-F-transparent.png", "JPG", "jpeg", "transparent PNG → JPG (transparency becomes white)"],
    ["IMAGE-F-transparent.png", "WebP", "webp", "transparent PNG → WebP (alpha kept)"],
    ["X-odd-1001x777.png", "JPG", "jpeg", "odd-size PNG 1001x777 → JPG"],
    ["X-tiny-64x48.png", "WebP", "webp", "tiny 64x48 transparent PNG → WebP"],
    ["IMAGE-H-photo.webp", "JPG", "jpeg", "WebP → JPG"],
    ["X-transparent.webp", "PNG", "png", "transparent WebP → PNG (alpha kept)"],
    ["IMAGE-I-vector.svg", "PNG", "png", "SVG → PNG"],
    ["IMAGE-I-vector.svg", "JPG", "jpeg", "SVG → JPG"],
    ["IMAGE-I-vector.svg", "WebP", "webp", "SVG → WebP"],
    ["IMAGE-J-unsafe.svg", "PNG", "png", "unsafe SVG (script, onload, external refs) → PNG"],
    ["IMAGE-K-exif-rich.jpg", "PNG", "png", "EXIF Orientation 6 JPG → PNG (upright, metadata dropped)"],
    ["IMAGE-E-photo-15mb.jpg", "WebP", "webp", "15 MB 48 MP JPG → WebP"],
    ["IMAGE-G-large-photo.png", "JPG", "jpeg", "8 MB photographic PNG → JPG"],
    ["X-jpeg-named.png", "WebP", "webp", "JPEG mislabelled .png → WebP"],
  ];
  for (const [fixture, label, format, what] of C) {
    await step("Image Converter", what, async () => {
      const before = requests.length;
      await open(page, "/convert-image");
      await addPaths(page, [sx(fixture)]);
      await page.getByRole("radio", { name: new RegExp(`^${label}`) }).click();
      const t0 = Date.now();
      await page.getByRole("button", { name: `Convert to ${label}` }).click();
      await result();
      const ms = Date.now() - t0;
      const out = await download(page, page.getByRole("button", { name: `Download ${label}` }), `fs-conv-${fixture.slice(0, 9)}-${format}`);
      const o = await imageInfo(out);
      const svg = fixture.endsWith(".svg");
      const src = svg ? null : await imageInfo(sx(fixture));
      const exif = fixture.startsWith("IMAGE-K");
      // Expected pixel size: same as source (EXIF-rotated sources come out upright, so w/h swap).
      // (imageInfo decodes with EXIF orientation applied, so an upright result has the same size as `src`.)
      const svgAspect = fixture.startsWith("IMAGE-J") ? 600 / 400 : 800 / 500;
      const dimsOk = svg ? o.w > 0 && Math.abs(o.w / o.h - svgAspect) < 0.01 : o.w === src.w && o.h === src.h && (!exif || o.h > o.w);
      const srcAlpha = svg ? false : src.hasAlpha;
      const alphaOk = format === "jpeg" ? !o.hasAlpha : srcAlpha ? o.hasAlpha : true;
      // Transparent → JPG: the clear corner must be white, not black.
      let corner = null;
      if (format === "jpeg" && srcAlpha) {
        const i = (5 * o.w + 5) * 4;
        corner = [o.d[i], o.d[i + 1], o.d[i + 2]];
      }
      const cornerOk = !corner || corner.every((v) => v >= 240);
      const exifGone = !exif || !fs.readFileSync(out).includes(Buffer.from("QA Camera Co"));
      const leaked = requests.slice(before).filter((u) => u.includes("attacker.invalid"));
      const sim = svg ? {} : await imageSimilarity(sx(fixture), out).catch(() => ({}));
      const ok = o.format === format && dimsOk && alphaOk && cornerOk && exifGone && leaked.length === 0 && dialogs.length === 0;
      rec("Image Converter", what, ok ? "PASS" : "FAIL", { fixture, input: size(sx(fixture)), output: size(out), format: o.format, dims: `${src ? `${src.w}x${src.h}` : "svg"}→${o.w}x${o.h}`, alpha: `${srcAlpha}→${o.hasAlpha}`, corner, exifGone, leakedRequests: leaked, psnr: sim.psnr, ssim: sim.ssim, ms });
    });
  }
  await step("Image Converter", "batch of 4 (JPG, WebP, transparent PNG, PNG) → PNG ZIP", async () => {
    await open(page, "/convert-image");
    await addPaths(page, [sx("IMAGE-B-photo-500k.jpg"), sx("IMAGE-H-photo.webp"), sx("IMAGE-F-transparent.png"), sx("X-odd-1001x777.png")]);
    await page.getByRole("radio", { name: /^PNG/ }).click();
    await page.getByRole("button", { name: "Convert to PNG" }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), "fs-conv-batch");
    const entries = await zipEntries(out);
    const skipped = await page.getByText(/Already PNG — skipped/).count();
    rec("Image Converter", "batch of 4 → PNG ZIP", entries.length === 2 && skipped === 2 ? "PASS" : "FAIL", { entries: entries.map((e) => e.name), skipped });
  });
}

// ================================================================== PDF → Image
if (run("p2i")) {
  const P = [
    ["OCR-A-clean-300dpi.pdf", "PNG", 1, "1-page scan → PNG"],
    ["PDF-H-multipage-text-image.pdf", "JPG", 10, "10-page text+image → JPG ZIP"],
    ["PDF-I-rotated.pdf", "PNG", 4, "rotated pages (0/90/180/270) → PNG"],
    ["PDF-J-mixed-page-sizes.pdf", "JPG", 6, "mixed page sizes → JPG"],
    ["PDF-C-scan-3.8mb-incremental.pdf", "JPG", 2, "scanned (incremental update) → JPG"],
    ["PDF-K-native-text.pdf", "PNG", 2, "native text → PNG"],
    ["PDF-Q-owner-password-only.pdf", "JPG", 6, "owner-password-only encrypted → JPG (pdf.js can decrypt)"],
  ];
  for (const [fixture, fmt, pages, what] of P) {
    await step("PDF → Image", what, async () => {
      await open(page, "/pdf-to-image");
      await addPaths(page, [sx(fixture)]);
      await page.getByRole("button", { name: /^Convert (all|page$)/ }).waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: fmt, exact: true }).click();
      const t0 = Date.now();
      await page.getByRole("button", { name: /^Convert (all|page$)/ }).click();
      await result();
      const ms = Date.now() - t0;
      const files = [];
      if (pages === 1) files.push(await download(page, page.getByRole("button", { name: `Download ${fmt}` }), `fs-p2i-${fixture.slice(0, 5)}`));
      else {
        const zip = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), `fs-p2i-${fixture.slice(0, 5)}`);
        for (const e of await zipEntries(zip)) {
          const f = path.join(OUT, `fs-p2i-${fixture.slice(0, 5)}-${e.name}`);
          fs.writeFileSync(f, e.bytes);
          files.push(f);
        }
      }
      files.sort((a, b) => Number(a.match(/page-(\d+)/)?.[1] ?? 0) - Number(b.match(/page-(\d+)/)?.[1] ?? 0));
      const infos = [];
      for (const f of files) infos.push(await imageInfo(f));
      // Each image must match its page's displayed aspect ratio (rotation applied).
      const src = await pdfPages(sx(fixture).replace("PDF-Q-owner-password-only", "PDF-B-mixed-800k"));
      const expectAspect = src.map((p) => {
        const r = p.getRotation().angle % 180 === 90;
        return r ? p.getHeight() / p.getWidth() : p.getWidth() / p.getHeight();
      });
      const aspectOk = infos.every((im, i) => Math.abs(im.w / im.h - expectAspect[i]) < 0.02);
      const formatOk = infos.every((im) => im.format === (fmt === "JPG" ? "jpeg" : "png"));
      let nonBlank = true;
      for (const im of infos) {
        let dark = 0;
        for (let i = 0; i < im.d.length; i += 4 * 101) if (im.d[i] + im.d[i + 1] + im.d[i + 2] < 450) dark++;
        if (dark < 5) nonBlank = false;
      }
      const ok = files.length === pages && aspectOk && formatOk && nonBlank;
      rec("PDF → Image", what, ok ? "PASS" : "FAIL", { fixture, images: files.length, dims: infos.map((i) => `${i.w}x${i.h}`).join(" "), aspectOk, nonBlank, ms });
    });
  }
  await step("PDF → Image", "selected pages 2 and 9 of 10 → PNG", async () => {
    await open(page, "/pdf-to-image");
    await addPaths(page, [sx("PDF-H-multipage-text-image.pdf")]);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("checkbox", { name: "Page 2", exact: true }).click();
    await page.getByRole("checkbox", { name: "Page 9", exact: true }).click();
    await page.getByRole("radio", { name: "PNG", exact: true }).click();
    await page.getByRole("button", { name: "Convert 2 pages" }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), "fs-p2i-sel");
    const names = (await zipEntries(out)).map((e) => e.name).sort();
    rec("PDF → Image", "selected pages 2 and 9 of 10 → PNG", names.join(",") === "PDF-H-multipage-text-image-page-2.png,PDF-H-multipage-text-image-page-9.png" ? "PASS" : "FAIL", { names });
  });
  await step("PDF → Image", "password-protected PDF → clear message", async () => {
    await open(page, "/pdf-to-image");
    await addPaths(page, [sx("PDF-P-encrypted.pdf")]);
    await page.waitForTimeout(2500);
    const text = (await alerts()).join(" | ") || (await page.locator("main").innerText()).slice(0, 300);
    rec("PDF → Image", "password-protected PDF → clear message", /password|protected|encrypted/i.test(text) ? "PASS" : "FAIL", { message: text.slice(0, 200) });
  });
}

// ================================================================== Images → PDF
if (run("i2p")) {
  const flows = [
    ["2 images (landscape + portrait), fit to image", ["IMAGE-B-photo-500k.jpg", "X-portrait-1200x1800.jpg"], "Fit to image", ["1800x1200", "900x1350"]],
    ["portrait + landscape on A4 (auto-orientation)", ["X-portrait-1200x1800.jpg", "IMAGE-B-photo-500k.jpg"], "A4", ["595x842", "842x595"]],
    ["transparent PNG on Letter (renders on white)", ["IMAGE-F-transparent.png"], "Letter", ["792x612"]],
    ["large images (15 MB + 8 MB JPG)", ["IMAGE-E-photo-15mb.jpg", "IMAGE-D-photo-8mb.jpg"], "A4", ["842x595", "842x595"]],
    ["EXIF Orientation 6 photo comes out upright", ["IMAGE-K-exif-rich.jpg"], "Fit to image", ["900x1200"]],
    [
      "10 mixed images (JPG, PNG, WebP, transparent, odd, tiny)",
      ["IMAGE-A-optimized-250k.jpg", "IMAGE-B-photo-500k.jpg", "IMAGE-C-photo-3mb.jpg", "IMAGE-H-photo.webp", "IMAGE-K-exif-rich.jpg", "IMAGE-L-tiny-optimized.jpg", "X-portrait-1200x1800.jpg", "X-odd-1001x777.png", "X-tiny-64x48.png", "IMAGE-F-transparent.png"],
      "A4",
      null,
    ],
  ];
  for (const [what, files, sizeLabel, expected] of flows) {
    await step("Images → PDF", what, async () => {
      await open(page, "/image-to-pdf");
      await addPaths(page, files.map(sx));
      await page.locator("ol > li[data-sort-key]").nth(files.length - 1).waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: sizeLabel, exact: true }).click();
      const t0 = Date.now();
      await page.getByRole("button", { name: /^Create PDF/ }).click();
      await result();
      const ms = Date.now() - t0;
      const out = await download(page, page.getByRole("button", { name: "Download PDF" }), `fs-i2p-${files.length}-${sizeLabel.replace(/\W/g, "")}`);
      const pages = await pdfPages(out);
      const sizes = sizesOf(pages);
      let corner = null;
      if (files[0] === "IMAGE-F-transparent.png") {
        const img = await renderPage((await pdfInfo(out)).doc, 1, 0.5);
        const cx = Math.round(img.w * 0.5 - (img.h * 0.5 * 1800) / 1400 / 2 + 6); // left edge of the image area, top row
        const i = (Math.round(img.h * 0.1) * img.w + cx) * 4;
        corner = [img.d[i], img.d[i + 1], img.d[i + 2]];
      }
      const ok = pages.length === files.length && (!expected || sizes.join() === expected.join()) && (!corner || corner.every((v) => v >= 235));
      rec("Images → PDF", what, ok ? "PASS" : "FAIL", { pages: pages.length, sizes: sizes.join(" "), corner, output: size(out), ms });
    });
  }
  await step("Images → PDF", "reordered with Move buttons (3 images)", async () => {
    await open(page, "/image-to-pdf");
    await addPaths(page, [sx("IMAGE-B-photo-500k.jpg"), sx("X-portrait-1200x1800.jpg"), sx("X-odd-1001x777.png")]);
    await page.getByRole("button", { name: "Move X-odd-1001x777.png earlier" }).click();
    await page.getByRole("button", { name: "Move X-odd-1001x777.png earlier" }).click();
    await page.getByRole("radio", { name: "Fit to image", exact: true }).click();
    await page.getByRole("button", { name: /^Create PDF/ }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "fs-i2p-reorder");
    const sizes = sizesOf(await pdfPages(out));
    rec("Images → PDF", "reordered with Move buttons (3 images)", sizes.join() === "751x583,1800x1200,900x1350" ? "PASS" : "FAIL", { sizes: sizes.join(" ") });
  });
}

// ================================================================== Merge
if (run("merge")) {
  const M = [
    ["2 PDFs", ["PDF-K-native-text.pdf", "PDF-N-metadata-rich.pdf"]],
    ["3 PDFs", ["PDF-K-native-text.pdf", "PDF-N-metadata-rich.pdf", "PDF-J-mixed-page-sizes.pdf"]],
    ["10 PDFs (scan, photo, forms, rotated, sizes, text)", ["PDF-K-native-text.pdf", "PDF-N-metadata-rich.pdf", "PDF-J-mixed-page-sizes.pdf", "PDF-I-rotated.pdf", "PDF-M-acroform.pdf", "PDF-G-already-optimized.pdf", "PDF-H-multipage-text-image.pdf", "PDF-L-image-only-scan-gray-a85.pdf", "PDF-C-scan-3.8mb-incremental.pdf", "PDF-B-mixed-800k.pdf"]],
    ["mixed: incremental scan + native text + form", ["PDF-C-scan-3.8mb-incremental.pdf", "PDF-K-native-text.pdf", "PDF-M-acroform.pdf"]],
    ["rotated pages keep their rotation", ["PDF-I-rotated.pdf", "PDF-K-native-text.pdf"]],
    ["mixed page sizes keep their sizes", ["PDF-J-mixed-page-sizes.pdf", "PDF-K-native-text.pdf"]],
  ];
  for (const [what, files] of M) {
    await step("Merge PDF", what, async () => {
      await open(page, "/merge-pdf");
      await addPaths(page, files.map(sx));
      const src = [];
      for (const f of files) src.push(...(await pdfPages(sx(f))));
      await page.getByText(`${src.length} pages in total`, { exact: false }).waitFor({ timeout: 60_000 });
      const t0 = Date.now();
      await page.getByRole("button", { name: `Merge ${files.length} PDFs` }).click();
      await result();
      const ms = Date.now() - t0;
      const out = await download(page, page.getByRole("button", { name: "Download merged PDF" }), `fs-merge-${files.length}-${what.slice(0, 6).replace(/\W/g, "")}`);
      const pages = await pdfPages(out);
      const sizesOk = sizesOf(pages).join() === sizesOf(src).join();
      const rotOk = pages.map((p) => p.getRotation().angle).join() === src.map((p) => p.getRotation().angle).join();
      let formNote;
      if (files.includes("PDF-M-acroform.pdf")) {
        const fields = (await PDFDocument.load(fs.readFileSync(out))).getForm().getFields().map((f) => f.getName());
        formNote = fields.length ? `form fields kept: ${fields.join(", ")}` : "form fields flattened/dropped (visual appearance kept)";
      }
      const ok = pages.length === src.length && sizesOk && rotOk;
      rec("Merge PDF", what, ok ? "PASS" : "FAIL", { files: files.length, pages: `${pages.length}/${src.length}`, sizesOk, rotOk, formNote, output: size(out), ms });
    });
  }
  await step("Merge PDF", "reordered (third file moved first)", async () => {
    await open(page, "/merge-pdf");
    await addPaths(page, [sx("PDF-K-native-text.pdf"), sx("PDF-N-metadata-rich.pdf"), sx("PDF-J-mixed-page-sizes.pdf")]);
    await page.getByText("11 pages in total", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Move PDF-J-mixed-page-sizes.pdf up" }).click();
    await page.getByRole("button", { name: "Move PDF-J-mixed-page-sizes.pdf up" }).click();
    await page.getByRole("button", { name: "Merge 3 PDFs" }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download merged PDF" }), "fs-merge-reorder");
    const first = (await pdfInfo(out)).texts[0];
    rec("Merge PDF", "reordered (third file moved first)", /SIZE 1: Letter/.test(first) ? "PASS" : "FAIL", { firstPage: first.slice(0, 60) });
  });
  await step("Merge PDF", "corrupt file in the mix → blocked with a clear message, then merges after removing it", async () => {
    await open(page, "/merge-pdf");
    await addPaths(page, [sx("PDF-K-native-text.pdf"), sx("PDF-O-corrupted.pdf"), sx("PDF-N-metadata-rich.pdf")]);
    await page.waitForTimeout(2500);
    const msg = (await alerts()).join(" | ");
    const blocked = await page.getByRole("button", { name: "Merge 3 PDFs" }).isDisabled().catch(() => true);
    await page.getByRole("button", { name: "Remove PDF-O-corrupted.pdf" }).click();
    await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download merged PDF" }), "fs-merge-after-corrupt");
    const n = (await pdfPages(out)).length;
    rec("Merge PDF", "corrupt file in the mix", /can.t be read/i.test(msg) && blocked && n === 5 ? "PASS" : "FAIL", { message: msg.slice(0, 160), mergeBlocked: blocked, pagesAfterRemoval: n });
  });
  await step("Merge PDF", "owner-password-only encrypted file in the mix → refused, no corrupt output", async () => {
    await open(page, "/merge-pdf");
    await addPaths(page, [sx("PDF-K-native-text.pdf"), sx("PDF-Q-owner-password-only.pdf")]);
    await page.waitForTimeout(2500);
    const btn = page.getByRole("button", { name: "Merge 2 PDFs" });
    if (await btn.isEnabled()) await btn.click();
    await page.waitForTimeout(3000);
    const msg = (await alerts()).join(" | ");
    const produced = await page.getByTestId("result").count();
    rec("Merge PDF", "owner-password-only encrypted file in the mix", produced === 0 && /protected|password|encrypt/i.test(msg) ? "PASS" : "FAIL", { message: msg.slice(0, 200), producedOutput: produced > 0 });
  });
}

// ================================================================== Split
if (run("split")) {
  const H = "PDF-H-multipage-text-image.pdf";
  const pick = async (nums) => {
    for (const n of nums) await page.getByRole("checkbox", { name: `Page ${n}`, exact: true }).click();
  };
  const S = [
    ["selected pages 2, 5, 9", async () => pick([2, 5, 9]), "2,5,9"],
    ["first page only", async () => pick([1]), "1"],
    ["middle page only (5)", async () => pick([5]), "5"],
    ["last page only (10)", async () => pick([10]), "10"],
    [
      "multiple typed ranges 1-2,5,9-10",
      async () => {
        await page.getByRole("textbox").first().fill("1-2,5,9-10");
        await page.getByRole("button", { name: "Select", exact: true }).click();
      },
      "1,2,5,9,10",
    ],
  ];
  for (const [what, choose, expected] of S) {
    await step("Split PDF", what, async () => {
      await open(page, "/split-pdf");
      await addPaths(page, [sx(H)]);
      await page.getByRole("checkbox", { name: "Page 10", exact: true }).waitFor({ timeout: 60_000 });
      await choose();
      await page.getByRole("button", { name: /^Extract \d+ pages?$/ }).click();
      await result();
      const out = await download(page, page.getByRole("button", { name: "Download PDF" }), `fs-split-${expected.replace(/,/g, "_")}`);
      const got = markers((await pdfInfo(out)).texts, /Page (\d+) of 10/).join(",");
      rec("Split PDF", what, got === expected ? "PASS" : "FAIL", { pages: got, output: size(out) });
    });
  }
  for (const [fixture, n] of [[H, 10], ["PDF-C-scan-3.8mb-incremental.pdf", 2]]) {
    await step("Split PDF", `split every page (${fixture.slice(0, 5)}, ${n} pages) → ZIP`, async () => {
      await open(page, "/split-pdf");
      await addPaths(page, [sx(fixture)]);
      await page.getByRole("radio", { name: /Split every page/ }).click();
      await page.getByRole("button", { name: `Split into ${n} PDFs` }).click();
      await result();
      const out = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), `fs-split-every-${fixture.slice(0, 5)}`);
      const entries = await zipEntries(out);
      let ok = entries.length === n;
      for (const e of entries) if ((await PDFDocument.load(e.bytes)).getPageCount() !== 1) ok = false;
      rec("Split PDF", `split every page (${fixture.slice(0, 5)}) → ZIP`, ok ? "PASS" : "FAIL", { files: entries.length, names: entries.slice(0, 3).map((e) => e.name) });
    });
  }
}

// ================================================================== Organize
if (run("organize")) {
  const H = "PDF-H-multipage-text-image.pdf";
  const cards = () => page.locator("ol > li[data-sort-key]");
  async function dragCard(from, to) {
    const a = await cards().nth(from).boundingBox();
    const b = await cards().nth(to).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 60);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 14 });
    await page.mouse.up();
  }
  async function saveAndCheck(tag) {
    await page.getByRole("button", { name: "Save PDF" }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download PDF" }), `fs-org-${tag}`);
    const info = await pdfInfo(out);
    return { out, labels: markers(info.texts, /Page (\d+) of 10/).join(","), rotations: info.rotations.join(","), info };
  }
  const O = [
    ["drag page 4 to the front", async () => dragCard(3, 0), (r) => r.labels === "4,1,2,3,5,6,7,8,9,10"],
    ["rotate page 2 right", async () => page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click(), (r) => r.rotations === "0,90,0,0,0,0,0,0,0,0"],
    ["delete page 10", async () => page.getByRole("button", { name: "Delete Page 10", exact: true }).click(), (r) => r.labels === "1,2,3,4,5,6,7,8,9"],
    [
      "combined: drag, rotate left, delete, duplicate",
      async () => {
        await dragCard(3, 0);
        await page.getByRole("button", { name: "Rotate Page 2 left", exact: true }).click();
        await page.getByRole("button", { name: "Delete Page 9", exact: true }).click();
        await page.getByRole("button", { name: "Duplicate Page 1", exact: true }).click();
      },
      (r) => r.labels === "4,1,1,2,3,5,6,7,8,10" && r.rotations.split(",").filter((x) => x !== "0").length === 1,
    ],
  ];
  for (const [what, act, check] of O) {
    await step("Organize PDF", what, async () => {
      await open(page, "/organize-pdf");
      await addPaths(page, [sx(H)]);
      await cards().nth(9).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(500);
      await act();
      const r = await saveAndCheck(what.slice(0, 8).replace(/\W/g, ""));
      rec("Organize PDF", what, check(r) ? "PASS" : "FAIL", { labels: r.labels, rotations: r.rotations, output: size(r.out) });
    });
  }
  await step("Organize PDF", "incremental-update scan (gen-1 catalog): rotate + save", async () => {
    await open(page, "/organize-pdf");
    await addPaths(page, [sx("PDF-C-scan-3.8mb-incremental.pdf")]);
    await cards().nth(1).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Rotate Page 1 right", exact: true }).click();
    const r = await saveAndCheck("genone");
    rec("Organize PDF", "incremental-update scan: rotate + save", r.rotations === "90,0" ? "PASS" : "FAIL", { rotations: r.rotations, output: size(r.out) });
  });
  await step("Organize PDF", "already-rotated source: rotations add up", async () => {
    await open(page, "/organize-pdf");
    await addPaths(page, [sx("PDF-I-rotated.pdf")]);
    await cards().nth(3).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click();
    await page.getByRole("button", { name: "Rotate Page 4 right", exact: true }).click();
    const r = await saveAndCheck("rotsrc");
    rec("Organize PDF", "already-rotated source: rotations add up", r.rotations === "0,180,180,0" ? "PASS" : "FAIL", { rotations: r.rotations });
  });
}

// Merge and the editor have no single "start again" button; repeat use there is: back to the list /
// open another file in the same tab, then check the second output only contains the second input.
if (run("repeat")) {
  await step("Merge PDF", "repeat use: second merge after the first (no stale state)", async () => {
    await open(page, "/merge-pdf");
    await addPaths(page, [sx("PDF-K-native-text.pdf"), sx("PDF-N-metadata-rich.pdf")]);
    await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
    await result();
    const outA = await download(page, page.getByRole("button", { name: "Download merged PDF" }), "fs-repeat-merge-1");
    await page.getByRole("button", { name: "Change order" }).click();
    await page.getByRole("button", { name: "Remove PDF-K-native-text.pdf" }).click();
    await page.getByRole("button", { name: "Remove PDF-N-metadata-rich.pdf" }).click();
    await addPaths(page, [sx("PDF-J-mixed-page-sizes.pdf"), sx("PDF-I-rotated.pdf")]);
    await page.getByText("10 pages in total", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
    await result();
    const outB = await download(page, page.getByRole("button", { name: "Download merged PDF" }), "fs-repeat-merge-2");
    const a = (await pdfPages(outA)).length, b = await pdfPages(outB);
    const ok = a === 5 && b.length === 10 && sizesOf(b).slice(0, 6).join() === sizesOf(await pdfPages(sx("PDF-J-mixed-page-sizes.pdf"))).join();
    rec("Merge PDF", "repeat use: second merge after the first (no stale state)", ok ? "PASS" : "FAIL", { firstPages: a, secondPages: b.length });
  });
  await step("PDF Editor", "repeat use: second document in the same tab (no stale state)", async () => {
    const session = async (fixture, tag, textToAdd) => {
      await addPaths(page, [sx(fixture)]);
      await page.getByTestId("page-surface").first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1000); // let the fit-to-page zoom settle, as a person would
      const b = await page.getByTestId("page-surface").first().boundingBox();
      await page.getByRole("button", { name: "Add text", exact: true }).click();
      await page.mouse.click(b.x + b.width * 0.2, b.y + Math.min(b.height * 0.9, 380));
      await page.keyboard.type(textToAdd);
      await page.keyboard.press("Escape");
      return download(page, page.getByRole("button", { name: "Export PDF" }), tag);
    };
    await open(page, "/pdf-editor");
    const outA = await session("PDF-K-native-text.pdf", "fs-repeat-editor-1", "First document");
    // Leave through the app itself (client-side navigation, so module caches survive) and come back.
    expectedDialog = /Leave the editor/;
    await page.getByRole("link", { name: "Back to TheFileConvert" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/pdf-editor"));
    await page.getByRole("link", { name: /PDF Editor/ }).first().click();
    await page.waitForURL(/\/pdf-editor/);
    await page.getByTestId("file-input").first().waitFor({ state: "attached" });
    const outB = await session("PDF-N-metadata-rich.pdf", "fs-repeat-editor-2", "Second document");
    const ia = await pdfInfo(outA), ib = await pdfInfo(outB);
    const ok = ia.pages === 2 && ib.pages === 3 && /Second document/.test(ib.texts.join(" ")) && !/First document|INVOICE/.test(ib.texts.join(" ")) && /Annual Summary/.test(ib.texts[0]);
    rec("PDF Editor", "repeat use: second document in the same tab (no stale state)", ok ? "PASS" : "FAIL", { firstPages: ia.pages, secondPages: ib.pages, secondText: ib.texts[0].slice(0, 60) });
    // The editor guards unsaved edits with a "leave page?" prompt; the next step navigates away on purpose.
    expectedDialog = /^$/;
  });
}

// ================================================================== Error scenarios
if (run("errors")) {
  // A sparse 525 MB file: over the 500 MB hard limit, costs no disk space to speak of.
  const big = path.join(OUT, "fs-oversized-525mb.pdf");
  const bigJpg = path.join(OUT, "fs-oversized-525mb.jpg");
  for (const f of [big, bigJpg]) {
    const fd = fs.openSync(f, "w");
    fs.writeSync(fd, Buffer.from(f.endsWith(".pdf") ? "%PDF-1.7\n" : "\xff\xd8\xff\xe0", "latin1"));
    fs.ftruncateSync(fd, 525 * 1024 * 1024);
    fs.closeSync(fd);
  }
  const PDF_TOOLS = ["/compress-pdf", "/pdf-to-image", "/merge-pdf", "/split-pdf", "/organize-pdf", "/pdf-editor"];
  const IMG_TOOLS = ["/compress-image", "/convert-image", "/image-to-pdf"];
  const cases = [];
  for (const t of PDF_TOOLS) {
    cases.push([t, "wrong type (.txt)", sx("X-notes.txt"), /isn.t supported/i]);
    cases.push([t, "zero-byte PDF", sx("X-zero-byte.pdf"), /is empty/i]);
    cases.push([t, "text file named .pdf", sx("X-fake.pdf"), /isn.t supported|can.t be read|couldn.t read|damaged/i]);
    cases.push([t, "corrupted PDF", sx("PDF-O-corrupted.pdf"), /can.t be read|couldn.t (be )?read|damaged/i]);
    cases.push([t, "password-protected PDF", sx("PDF-P-encrypted.pdf"), /password|protected|encrypt/i]);
    if (t !== "/pdf-to-image") cases.push([t, "owner-password-only encrypted PDF", sx("PDF-Q-owner-password-only.pdf"), /password|protected|encrypt/i]);
  }
  cases.push(["/compress-pdf", "oversized (525 MB)", big, /larger than 500 MB/i]);
  for (const t of IMG_TOOLS) {
    cases.push([t, "wrong type (PDF)", sx("PDF-K-native-text.pdf"), /isn.t supported/i]);
    cases.push([t, "zero-byte image", sx("X-zero-byte.jpg"), /is empty/i]);
    cases.push([t, "unsupported format (GIF)", sx("X-animation.gif"), /isn.t supported/i]);
    cases.push([t, "corrupt JPEG", sx("X-corrupt.jpg"), /couldn.t|can.t|damaged|decode|read/i]);
    cases.push([t, "JPEG cut off halfway", sx("X-truncated-half.jpg"), /couldn.t|can.t|damaged|decode|read/i]);
  }
  cases.push(["/compress-image", "oversized (525 MB)", bigJpg, /larger than 500 MB/i]);

  /** Tries to get the tool to process whatever it accepted, so errors that only show on processing appear. */
  async function poke(route) {
    const tryClick = async (name) => {
      const b = page.getByRole("button", { name }).first();
      if ((await b.count()) && (await b.isEnabled().catch(() => false))) await b.click().catch(() => {});
    };
    if (route === "/compress-pdf" || route === "/compress-image") await tryClick(/^Compress to under/);
    if (route === "/convert-image") {
      await page.getByRole("radio", { name: /^PNG/ }).click().catch(() => {});
      await tryClick(/^Convert to PNG/);
    }
    if (route === "/pdf-to-image") await tryClick(/^Convert (all|page$)/);
    if (route === "/image-to-pdf") await tryClick(/^Create PDF/);
    if (route === "/split-pdf") await tryClick(/^Extract/);
    if (route === "/organize-pdf") await tryClick(/^Rotate Page 1 right/);
    if (route === "/organize-pdf") await tryClick(/^Save PDF/);
    await page.waitForTimeout(4000);
  }

  for (const [route, what, file, expect] of cases) {
    await step("Errors", `${route} — ${what}`, async () => {
      const errBefore = errors.length;
      await open(page, route);
      await addPaths(page, [file]);
      await page.waitForTimeout(2000);
      let msg = (await alerts()).join(" | ");
      if (!expect.test(msg)) {
        await poke(route);
        msg = (await alerts()).join(" | ") || (await page.getByText(expect).first().innerText().catch(() => ""));
      }
      // "Produced output" = something the user could download (a result screen that only reports the error is fine).
      const produced = (await page.getByTestId("result").count()) ? await page.getByRole("button", { name: /^Download/ }).count() : 0;
      const hung = await page.getByText(/Working|Loading|Opening your PDF/).count();
      // Recovery: the same page must then accept a good file and finish normally (no stale error state).
      const good = route.includes("image") && route !== "/pdf-to-image" ? sx("IMAGE-L-tiny-optimized.jpg") : sx("PDF-K-native-text.pdf");
      let recovered = "n/a";
      if (!["/pdf-editor", "/merge-pdf"].includes(route)) {
        const change = page.getByRole("button", { name: /^(Change file|Clear|Clear all|New file|New image|New images)$/ }).first();
        if (await change.count()) await change.click().catch(() => {});
        await addPaths(page, [good]);
        await page.waitForTimeout(1500);
        recovered = (await alerts()).some((a) => expect.test(a)) ? "stale error still shown" : "ok";
      }
      const ok = expect.test(msg) && produced === 0 && errors.length === errBefore && recovered !== "stale error still shown";
      rec("Errors", `${route} — ${what}`, ok ? "PASS" : "FAIL", { message: msg.slice(0, 200), producedOutput: produced > 0, spinnerLeft: hung > 0, recovered, consoleErrors: errors.slice(errBefore).slice(0, 2) });
    });
  }
  fs.rmSync(big, { force: true });
  fs.rmSync(bigJpg, { force: true });
}

// ================================================================== Repeat use / stale state
if (run("repeat")) {
  const R = [
    ["Compress PDF", "/compress-pdf", "PDF-B-mixed-800k.pdf", "PDF-K-native-text.pdf", "New file", async () => page.getByRole("button", { name: /^Compress to under/ }).click(), "Download PDF"],
    ["Compress Image", "/compress-image", "IMAGE-B-photo-500k.jpg", "IMAGE-L-tiny-optimized.jpg", "New image", async () => page.getByRole("button", { name: /^Compress to under/ }).click(), /^Download/],
    [
      "Image Converter",
      "/convert-image",
      "IMAGE-B-photo-500k.jpg",
      "X-odd-1001x777.png",
      "New images",
      async () => {
        await page.getByRole("radio", { name: /^WebP/ }).click();
        await page.getByRole("button", { name: "Convert to WebP" }).click();
      },
      "Download WebP",
    ],
    ["Images → PDF", "/image-to-pdf", "IMAGE-B-photo-500k.jpg", "X-portrait-1200x1800.jpg", "New images", async () => page.getByRole("button", { name: /^Create PDF/ }).click(), "Download PDF"],
    ["PDF → Image", "/pdf-to-image", "OCR-A-clean-300dpi.pdf", "OCR-B-low-res-100dpi.pdf", "Back to pages", async () => page.getByRole("button", { name: /^Convert (all|page$)/ }).click(), /^Download (JPG|PNG)$/],
    [
      "Split PDF",
      "/split-pdf",
      "PDF-H-multipage-text-image.pdf",
      "PDF-K-native-text.pdf",
      "Back to pages",
      async () => {
        await page.getByRole("checkbox", { name: "Page 2", exact: true }).click();
        await page.getByRole("button", { name: /^Extract/ }).click();
      },
      "Download PDF",
    ],
    [
      "Organize PDF",
      "/organize-pdf",
      "PDF-H-multipage-text-image.pdf",
      "PDF-K-native-text.pdf",
      null,
      async () => {
        await page.getByRole("button", { name: "Rotate Page 1 right", exact: true }).click();
        await page.getByRole("button", { name: "Save PDF" }).click();
      },
      "Download PDF",
    ],
  ];
  for (const [tool, route, a, b, resetLabel, act, dl] of R) {
    await step(tool, "repeat use: second file after the first (no stale state)", async () => {
      await open(page, route);
      await addPaths(page, [sx(a)]);
      await page.waitForTimeout(1500);
      await act();
      await result();
      const outA = await download(page, page.getByRole("button", { name: dl }).first(), `fs-repeat-${tool.replace(/\W/g, "")}-1`);
      // Start again the way a user would: the result screen's own control, then "Change file" if offered.
      if (resetLabel) await page.getByRole("button", { name: resetLabel, exact: true }).click();
      const change = page.getByRole("button", { name: /^(Change file|Clear|Clear all)$/ }).first();
      if (await change.count()) await change.click();
      else if (!resetLabel) await open(page, route);
      await addPaths(page, [sx(b)]);
      await page.waitForTimeout(1500);
      await act();
      await result();
      const outB = await download(page, page.getByRole("button", { name: dl }).first(), `fs-repeat-${tool.replace(/\W/g, "")}-2`);
      const differ = !fs.readFileSync(outA).equals(fs.readFileSync(outB));
      let fromB = true;
      if (outB.endsWith(".pdf")) {
        const n = (await pdfPages(outB)).length;
        const expect = { "Split PDF": 1, "Organize PDF": 2, "Compress PDF": 2, "Images → PDF": 1 }[tool];
        fromB = n === expect;
      } else {
        const ib = await imageInfo(outB);
        if (tool === "PDF → Image") fromB = ib.w === 1224 && ib.h === 1584; // OCR-B is one Letter page
        else {
          const sb = await imageInfo(sx(b));
          fromB = Math.abs(ib.w / ib.h - sb.w / sb.h) < 0.02;
        }
      }
      const nameB = path.basename(outB);
      const nameOk = !nameB.includes(a.replace(/\.\w+$/, ""));
      rec(tool, "repeat use: second file after the first (no stale state)", differ && fromB && nameOk ? "PASS" : "FAIL", { first: path.basename(outA), second: nameB, differ, secondFromSecondInput: fromB });
    });
  }
}

rec("All tools", "console errors / unexpected dialogs", errors.length || dialogs.length ? "FAIL" : "PASS", errors.length || dialogs.length ? { errors: errors.slice(0, 6), dialogs } : {});
await browser.close();
save(`fs-tools-${which}`);
