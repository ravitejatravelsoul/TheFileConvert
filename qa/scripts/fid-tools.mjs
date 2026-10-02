// Visual fidelity for every tool other than PDF ↔ Word, through the real UI. Each output is compared with
// its source by qa/validate/visdiff.py (SSIM / PSNR / changed pixels / text on the page) against the
// tool's own thresholds below; source | output | difference images go to qa/fidelity/<tool>/.
//   BASE=http://localhost:3000 node qa/scripts/fid-tools.mjs [cpdf|cimg|convert|p2i|i2p|merge|split|organize|editor|ocr|all] [--tag=x]
import { execFileSync } from "node:child_process";
import { launch, open, addPaths, download, size, rec, save, sx, fx, REAL_SCAN, records, fs, path, OUT, zipEntries } from "./fl-lib.mjs";

const which = process.argv[2] ?? "all";
const tag = (process.argv.find((a) => a.startsWith("--tag=")) ?? "--tag=dev").slice(6);
const run = (name) => which === "all" || which === name;
const FID = path.resolve("qa/fidelity");
const KB = 1000, MB = 1_000_000;

function visdiff(mode, src, out, args = []) {
  const res = execFileSync("python", ["qa/validate/visdiff.py", mode, src, out, ...args], { encoding: "utf8", maxBuffer: 64 << 20, timeout: 600_000 });
  return JSON.parse(res.trim().split("\n").pop());
}
const band = (v, pass, limited) => (v === null || v === undefined ? "n/a" : v >= pass ? "PASS" : v >= limited ? "LIMITED" : "FAIL");
const worst = (...v) => (v.includes("FAIL") ? "FAIL" : v.includes("LIMITED") ? "LIMITED" : "PASS");
const dirOf = (sub) => path.join(FID, sub);

/**
 * Thresholds. SSIM is over 8×8 blocks of a 100-dpi grey render.
 * - lossless page operations (merge/split/organize, editor outside its patch): identical to the source.
 * - lossy recompression (compress, JPG/WebP): close to the source; text pages stricter than photos.
 * - re-rendering (PDF → Image) and placement (Images → PDF): renderer anti-aliasing allowed for.
 */
const T = {
  identity: { ssim: [0.999, 0.99], changed: [0.05, 0.5] },
  compressText: [0.97, 0.9],
  compressPhoto: [0.9, 0.8],
  // Compressed images: PSNR (dB) at the output's own size. Block SSIM punishes the noise-dominated test
  // photos (whose grain no lossy codec keeps at a 2-8x size cut) far more than a viewer would.
  compressImagePsnr: [30, 27],
  lossless: [0.995, 0.98],
  lossy: [0.95, 0.9],
  render: [0.93, 0.85],
  // Images → PDF: the picture stored in the PDF against the source (decoded pixels), plus where it sits.
  place: [0.98, 0.95],
  editOutside: [0.05, 0.5], // % of pixels changed outside the edited area: PASS ≤ 0.05 %, LIMITED ≤ 0.5 %
};
const identityGrade = (d) => worst(band(d.minSsim, ...T.identity.ssim), d.maxChangedPct <= T.identity.changed[0] ? "PASS" : d.maxChangedPct <= T.identity.changed[1] ? "LIMITED" : "FAIL", d.minTextRecall === null || d.minTextRecall >= 100 ? "PASS" : "FAIL", d.allSizesKept ? "PASS" : "FAIL");
const pageSummary = (d) => ({ pages: `${d.pagesOut}/${d.pagesExpected}`, minSsim: d.minSsim, meanSsim: d.meanSsim, minPsnr: d.minPsnr, maxChangedPct: d.maxChangedPct, sizesKept: d.allSizesKept, minTextRecall: d.minTextRecall });

const { browser, page, errors } = await launch();
page.on("dialog", (d) => d.accept());
const requests = [];
page.on("request", (r) => requests.push(r.url()));
const result = () => page.getByTestId("result").waitFor({ timeout: 600_000 });

async function step(tool, test, fn) {
  const before = errors.length;
  try {
    await fn();
  } catch (e) {
    rec(tool, test, "FAIL", { error: String(e).slice(0, 400) });
  }
  // Console errors are charged to the step that caused them.
  if (errors.length > before) rec(tool, `${test} — console`, "FAIL", { errors: errors.slice(before).map((e) => String(e).slice(0, 300)) });
}

// ================================================================== Compress PDF
if (run("cpdf")) {
  const C = [
    ["PDF-A-text-heavy-300k.pdf", 200 * KB, "text"],
    ["PDF-B-mixed-800k.pdf", 400 * KB, "mixed"],
    ["PDF-D-photo-heavy-5mb.pdf", 2 * MB, "photo"],
    ["PDF-H-multipage-text-image.pdf", 1 * MB, "mixed"],
    ["PDF-I-rotated.pdf", 300 * KB, "text"],
    ["PDF-J-mixed-page-sizes.pdf", 100 * KB, "text"],
    ["PDF-M-acroform.pdf", 100 * KB, "text"],
    ["PDF-C-scan-3.8mb-incremental.pdf", 1 * MB, "scan"],
    [REAL_SCAN, 1 * MB, "scan"],
  ];
  for (const [fixture, target, kind] of C) {
    const input = fixture.includes("/") ? fixture : sx(fixture);
    const id = fixture.includes("/") ? "REAL-user-scan" : fixture.slice(0, 5);
    await step("Compress PDF", `${id} (${kind}) → ${target / KB} KB`, async () => {
      await open(page, "/compress-pdf");
      await addPaths(page, [input]);
      await page.getByText("How small do you need it?").waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: "Custom", exact: true }).click();
      const mb = target >= MB;
      await page.getByLabel("Custom target size").fill(String(mb ? target / MB : target / KB));
      await page.getByRole("radio", { name: mb ? "MB" : "KB", exact: true }).click();
      await page.getByRole("button", { name: /^Compress to under/ }).click();
      await result();
      const headline = (await page.getByTestId("result").getByRole("status").innerText()).trim();
      const out = await download(page, page.getByRole("button", { name: /^Download/ }), `fid-cpdf-${id}`);
      // The user's own scan: metrics only, its renders stay out of the repository (gitignored _private).
      const d = visdiff("pdf", input, out, ["--dir", dirOf(id === "REAL-user-scan" ? "compress-pdf/_private" : "compress-pdf"), "--name", `${tag}-${id}`, "--max-images", "2"]);
      const th = kind === "text" ? T.compressText : T.compressPhoto;
      const visual = band(d.minSsim, ...th);
      const text = kind === "scan" ? "n/a" : d.minTextRecall === null ? "n/a" : d.minTextRecall >= 100 ? "PASS" : d.minTextRecall >= 98 ? "LIMITED" : "FAIL";
      const structure = d.pagesOut === d.pagesSrc && d.allSizesKept ? "PASS" : "FAIL";
      const targetMet = size(out) <= target;
      const grade = worst(visual, text === "n/a" ? "PASS" : text, structure, targetMet ? "PASS" : "LIMITED");
      rec("Compress PDF", `${id} (${kind}) → ${target / KB} KB`, grade, { visual, text, structure, targetMet, input: size(input), output: size(out), reduction: `${Math.round((1 - size(out) / size(input)) * 100)}%`, headline: headline.slice(0, 120), ...pageSummary(d) });
    });
  }
}

// ================================================================== Compress Image
if (run("cimg")) {
  const C = [
    ["IMAGE-B-photo-500k.jpg", 250 * KB],
    ["IMAGE-C-photo-3mb.jpg", 1 * MB],
    ["IMAGE-E-photo-15mb.jpg", 2 * MB],
    ["IMAGE-F-transparent.png", 300 * KB],
    ["IMAGE-G-large-photo.png", 1 * MB],
    ["IMAGE-H-photo.webp", 100 * KB],
    ["IMAGE-K-exif-rich.jpg", 150 * KB],
    ["X-transparent.webp", 20 * KB],
  ];
  for (const [fixture, target] of C) {
    await step("Compress Image", `${fixture} → ${target / KB} KB`, async () => {
      await open(page, "/compress-image");
      await addPaths(page, [sx(fixture)]);
      await page.getByText("How small do you need it?").waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: "Custom", exact: true }).click();
      const mb = target >= MB;
      await page.getByLabel("Custom target size").fill(String(mb ? target / MB : target / KB));
      await page.getByRole("radio", { name: mb ? "MB" : "KB", exact: true }).click();
      await page.getByRole("button", { name: /^Compress to under/ }).click();
      await result();
      const details = (await page.getByTestId("image-details").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const out = await download(page, page.getByRole("button", { name: /^Download/ }), `fid-cimg-${fixture.slice(0, 9)}`);
      const d = visdiff("img", sx(fixture), out, ["--dir", dirOf("compress-image"), "--name", `${tag}-${fixture.replace(/\.\w+$/, "")}`]);
      const visual = band(d.psnr, ...T.compressImagePsnr);
      const alpha = d.alphaSrc ? (d.alphaOut ? "PASS" : /jpe?g/i.test(out) ? "LIMITED" : "FAIL") : "n/a";
      // Resizing is allowed when the target needs it, but must be said (the details line names the size).
      const dims = d.sizeKept ? "PASS" : /×|x\s*\d/.test(details) ? "LIMITED" : "FAIL";
      const targetMet = size(out) <= target;
      rec("Compress Image", `${fixture} → ${target / KB} KB`, worst(visual, alpha === "n/a" ? "PASS" : alpha, dims, targetMet ? "PASS" : "LIMITED"), { visual, alpha, dims, targetMet, ssim: d.ssim, psnr: d.psnr, changedPct: d.changedPct, sizeSrc: d.sizeSrc.join("x"), sizeOut: d.sizeOut.join("x"), input: size(sx(fixture)), output: size(out), details: details.slice(0, 160) });
    });
  }
}

// ================================================================== Image Converter
if (run("convert")) {
  const C = [
    ["IMAGE-B-photo-500k.jpg", "PNG", "lossless"],
    ["IMAGE-B-photo-500k.jpg", "WebP", "lossy"],
    ["X-portrait-1200x1800.jpg", "WebP", "lossy"],
    ["IMAGE-F-transparent.png", "JPG", "lossy"],
    ["IMAGE-F-transparent.png", "WebP", "lossy"],
    ["X-odd-1001x777.png", "JPG", "lossy"],
    ["IMAGE-H-photo.webp", "JPG", "lossy"],
    ["IMAGE-H-photo.webp", "PNG", "lossless"],
    ["X-transparent.webp", "PNG", "lossless"],
    ["IMAGE-K-exif-rich.jpg", "PNG", "lossless"],
    ["IMAGE-G-large-photo.png", "JPG", "lossy"],
  ];
  for (const [fixture, label, kind] of C) {
    await step("Image Converter", `${fixture} → ${label}`, async () => {
      await open(page, "/convert-image");
      await addPaths(page, [sx(fixture)]);
      await page.getByRole("radio", { name: new RegExp(`^${label}`) }).click();
      await page.getByRole("button", { name: `Convert to ${label}` }).click();
      await result();
      const out = await download(page, page.getByRole("button", { name: `Download ${label}` }), `fid-conv-${fixture.slice(0, 9)}-${label}`);
      const d = visdiff("img", sx(fixture), out, ["--dir", dirOf("converters"), "--name", `${tag}-${fixture.replace(/\.\w+$/, "")}-to-${label}`]);
      const visual = band(d.ssim, ...(kind === "lossless" ? T.lossless : T.lossy));
      const alpha = d.alphaSrc ? (label === "JPG" ? "PASS (flattened on white, by design)" : d.alphaOut && (d.alphaMeanDiff ?? 0) < 2 ? "PASS" : "FAIL") : "n/a";
      const dims = d.sizeKept ? "PASS" : "FAIL";
      rec("Image Converter", `${fixture} → ${label}`, worst(visual, alpha.startsWith("PASS") || alpha === "n/a" ? "PASS" : "FAIL", dims), { visual, alpha, dims, ssim: d.ssim, psnr: d.psnr, changedPct: d.changedPct, alphaMeanDiff: d.alphaMeanDiff, size: `${d.sizeSrc.join("x")}→${d.sizeOut.join("x")}` });
    });
  }
}

// ================================================================== PDF → Image
if (run("p2i")) {
  const P = [
    ["PDF-K-native-text.pdf", "PNG", 2],
    ["PDF-H-multipage-text-image.pdf", "JPG", 10],
    ["PDF-I-rotated.pdf", "PNG", 4],
    ["PDF-J-mixed-page-sizes.pdf", "JPG", 6],
    ["OCR-A-clean-300dpi.pdf", "PNG", 1],
  ];
  for (const [fixture, fmt, n] of P) {
    await step("PDF → Image", `${fixture} → ${fmt}`, async () => {
      await open(page, "/pdf-to-image");
      await addPaths(page, [sx(fixture)]);
      await page.getByRole("button", { name: /^Convert (all|page$)/ }).waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: fmt, exact: true }).click();
      await page.getByRole("button", { name: /^Convert (all|page$)/ }).click();
      await result();
      const files = [];
      if (n === 1) files.push(await download(page, page.getByRole("button", { name: `Download ${fmt}` }), `fid-p2i-${fixture.slice(0, 5)}`));
      else {
        const zip = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), `fid-p2i-${fixture.slice(0, 5)}`);
        for (const e of await zipEntries(zip)) {
          const f = path.join(OUT, `fid-p2i-${fixture.slice(0, 5)}-${e.name}`);
          fs.writeFileSync(f, e.bytes);
          files.push(f);
        }
      }
      files.sort((a, b) => Number(a.match(/page-(\d+)/)?.[1] ?? 1) - Number(b.match(/page-(\d+)/)?.[1] ?? 1));
      const per = files.map((f, i) => visdiff("page", sx(fixture), f, ["--page", String(i + 1), ...(i < 3 ? ["--dir", dirOf("converters"), "--name", `${tag}-p2i-${fixture.slice(0, 5)}-p${i + 1}`] : [])]));
      const minSsim = Math.min(...per.map((p) => p.ssim));
      const aspect = per.every((p) => p.aspectKept) ? "PASS" : "FAIL";
      const count = files.length === n ? "PASS" : "FAIL";
      rec("PDF → Image", `${fixture} → ${fmt}`, worst(band(minSsim, ...T.render), aspect, count), { images: files.length, minSsim, meanSsim: +(per.reduce((s, p) => s + p.ssim, 0) / per.length).toFixed(4), minPsnr: Math.min(...per.map((p) => p.psnr)), dpi: per[0]?.dpi, aspect, sizes: per.map((p) => p.imageSize.join("x")).join(" ") });
    });
  }
}

// ================================================================== Images → PDF
if (run("i2p")) {
  const F = [
    ["fit to image", ["IMAGE-B-photo-500k.jpg", "X-portrait-1200x1800.jpg"], "Fit to image"],
    ["A4 (auto-orientation)", ["X-portrait-1200x1800.jpg", "IMAGE-B-photo-500k.jpg"], "A4"],
    ["transparent PNG on Letter", ["IMAGE-F-transparent.png"], "Letter"],
    ["EXIF-rotated photo", ["IMAGE-K-exif-rich.jpg"], "Fit to image"],
    ["odd size + tiny + WebP", ["X-odd-1001x777.png", "X-tiny-64x48.png", "IMAGE-H-photo.webp"], "A4"],
  ];
  for (const [what, files, sizeLabel] of F) {
    await step("Images → PDF", what, async () => {
      await open(page, "/image-to-pdf");
      await addPaths(page, files.map(sx));
      await page.locator("ol > li[data-sort-key]").nth(files.length - 1).waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: sizeLabel, exact: true }).click();
      await page.getByRole("button", { name: /^Create PDF/ }).click();
      await result();
      const out = await download(page, page.getByRole("button", { name: "Download PDF" }), `fid-i2p-${what.slice(0, 8).replace(/\W/g, "")}`);
      const per = files.map((f, i) => visdiff("place", sx(f), out, ["--page", String(i + 1), "--dir", dirOf("converters"), "--name", `${tag}-i2p-${f.replace(/\.\w+$/, "")}`]));
      const minEmbedded = Math.min(...per.map((p) => p.embeddedSsim ?? 0));
      const aspect = per.every((p) => p.aspectKept) ? "PASS" : "FAIL";
      const inside = per.every((p) => p.insidePage) ? "PASS" : "FAIL";
      const alpha = files.some((f) => /transparent/.test(f)) ? (per.every((p, i) => !/transparent/.test(files[i]) || p.embeddedSmask) ? "PASS" : "FAIL") : "n/a";
      rec("Images → PDF", what, worst(band(minEmbedded, ...T.place), aspect, inside, alpha === "n/a" ? "PASS" : alpha), {
        pages: per.length,
        embeddedSsim: per.map((p) => p.embeddedSsim),
        bytesIdentical: per.map((p) => p.embeddedBytesIdentical),
        renderedSsim: per.map((p) => p.ssim),
        aspect,
        inside,
        alpha,
        placed: per.map((p) => `${p.pageSize?.join("x")}:${p.box?.map(Math.round).join(",")}`).join(" "),
      });
    });
  }
}

// ================================================================== Merge / Split / Organize — lossless page operations
async function pagesOf(file) {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true, updateMetadata: false })).getPageCount();
}
if (run("merge")) {
  const M = [
    ["3 PDFs: text, metadata, mixed sizes", ["PDF-K-native-text.pdf", "PDF-N-metadata-rich.pdf", "PDF-J-mixed-page-sizes.pdf"]],
    ["rotated + form + scan", ["PDF-I-rotated.pdf", "PDF-M-acroform.pdf", "PDF-C-scan-3.8mb-incremental.pdf"]],
    ["photo-heavy + multipage", ["PDF-D-photo-heavy-5mb.pdf", "PDF-H-multipage-text-image.pdf"]],
  ];
  for (const [what, files] of M) {
    await step("Merge PDF", what, async () => {
      await open(page, "/merge-pdf");
      await addPaths(page, files.map(sx));
      let total = 0;
      for (const f of files) total += await pagesOf(sx(f));
      await page.getByText(`${total} pages in total`, { exact: false }).waitFor({ timeout: 60_000 });
      await page.getByRole("button", { name: `Merge ${files.length} PDFs` }).click();
      await result();
      const out = await download(page, page.getByRole("button", { name: "Download merged PDF" }), `fid-merge-${what.slice(0, 6).replace(/\W/g, "")}`);
      let offset = 0;
      const parts = [];
      for (const f of files) {
        const d = visdiff("pdf", sx(f), out, ["--offset", String(offset), "--dir", dirOf("merge-split-organize"), "--name", `${tag}-merge-${f.slice(0, 5)}`, "--max-images", "1"]);
        parts.push({ file: f, grade: identityGrade(d), ...pageSummary(d) });
        offset += d.pagesExpected;
      }
      const count = (await pagesOf(out)) === total ? "PASS" : "FAIL";
      rec("Merge PDF", what, worst(count, ...parts.map((p) => p.grade)), { pages: `${await pagesOf(out)}/${total}`, parts });
    });
  }
}
if (run("split")) {
  const H = "PDF-H-multipage-text-image.pdf";
  for (const [what, nums] of [["pages 2, 5, 9", [2, 5, 9]], ["first and last", [1, 10]]]) {
    await step("Split PDF", what, async () => {
      await open(page, "/split-pdf");
      await addPaths(page, [sx(H)]);
      await page.getByRole("checkbox", { name: "Page 10", exact: true }).waitFor({ timeout: 60_000 });
      for (const n of nums) await page.getByRole("checkbox", { name: `Page ${n}`, exact: true }).click();
      await page.getByRole("button", { name: /^Extract \d+ pages?$/ }).click();
      await result();
      const out = await download(page, page.getByRole("button", { name: "Download PDF" }), `fid-split-${nums.join("_")}`);
      const d = visdiff("pdf", sx(H), out, ["--map", nums.join(","), "--dir", dirOf("merge-split-organize"), "--name", `${tag}-split-${nums.join("_")}`]);
      rec("Split PDF", what, worst(identityGrade(d), d.pagesOut === nums.length ? "PASS" : "FAIL"), pageSummary(d));
    });
  }
  await step("Split PDF", "every page of the rotated PDF → ZIP", async () => {
    await open(page, "/split-pdf");
    await addPaths(page, [sx("PDF-I-rotated.pdf")]);
    await page.getByRole("radio", { name: /Split every page/ }).click();
    await page.getByRole("button", { name: "Split into 4 PDFs" }).click();
    await result();
    const zip = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), "fid-split-every");
    const entries = (await zipEntries(zip)).sort((a, b) => Number(a.name.match(/(\d+)\.pdf$/)?.[1]) - Number(b.name.match(/(\d+)\.pdf$/)?.[1]));
    const grades = [];
    for (const [i, e] of entries.entries()) {
      const f = path.join(OUT, `fid-split-every-${e.name}`);
      fs.writeFileSync(f, e.bytes);
      const d = visdiff("pdf", sx("PDF-I-rotated.pdf"), f, ["--map", String(i + 1)]);
      grades.push({ page: i + 1, grade: identityGrade(d), ssim: d.minSsim, rotation: d.pages[0].rotationOut, sizeKept: d.allSizesKept });
    }
    rec("Split PDF", "every page of the rotated PDF → ZIP", worst(entries.length === 4 ? "PASS" : "FAIL", ...grades.map((g) => g.grade)), { files: entries.length, grades });
  });
}
if (run("organize")) {
  const H = "PDF-H-multipage-text-image.pdf";
  const cards = () => page.locator("ol > li[data-sort-key]");
  await step("Organize PDF", "move page 4 first, rotate page 2 right, delete page 10", async () => {
    await open(page, "/organize-pdf");
    await addPaths(page, [sx(H)]);
    await cards().nth(9).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click();
    await page.getByRole("button", { name: "Delete Page 10", exact: true }).click();
    // Deleting page 10 scrolled the page down to it; drag the cards where a person would, on screen.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const a = await cards().nth(3).boundingBox();
    const b = await cards().nth(0).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 60);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 14 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Save PDF" }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "fid-org");
    const d = visdiff("pdf", sx(H), out, ["--map", "4,1,2,3,5,6,7,8,9", "--rot", "0,0,90,0,0,0,0,0,0", "--dir", dirOf("merge-split-organize"), "--name", `${tag}-organize`]);
    rec("Organize PDF", "move page 4 first, rotate page 2 right, delete page 10", worst(identityGrade(d), d.pagesOut === 9 ? "PASS" : "FAIL"), pageSummary(d));
  });
  await step("Organize PDF", "already-rotated source: rotate pages 2 and 4 right", async () => {
    await open(page, "/organize-pdf");
    await addPaths(page, [sx("PDF-I-rotated.pdf")]);
    await cards().nth(3).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click();
    await page.getByRole("button", { name: "Rotate Page 4 right", exact: true }).click();
    await page.getByRole("button", { name: "Save PDF" }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "fid-org-rot");
    const d = visdiff("pdf", sx("PDF-I-rotated.pdf"), out, ["--map", "1,2,3,4", "--rot", "0,90,0,90", "--dir", dirOf("merge-split-organize"), "--name", `${tag}-organize-rotated`]);
    rec("Organize PDF", "already-rotated source: rotate pages 2 and 4 right", identityGrade(d), pageSummary(d));
  });
}

// ================================================================== PDF Editor — nothing changes outside the edit
if (run("editor")) {
  const SRC = fx("FL-PDF-07-native-text.pdf");
  async function mapper() {
    const s = await page.getByTestId("page-surface").first().boundingBox();
    const k = s.width / 612;
    return (x, y) => [s.x + x * k, s.y + y * k];
  }
  async function drag(a, b) {
    await page.mouse.move(...a);
    await page.mouse.down();
    await page.mouse.move(...b, { steps: 8 });
    await page.mouse.up();
  }
  async function pick(name, menu) {
    if (menu) {
      await page.getByRole("button", { name: menu, exact: true }).click();
      await page.getByRole("menuitemradio", { name }).click();
    } else await page.getByRole("button", { name, exact: true }).click();
  }
  // [name, action(at), edited area (points, top-left origin) — generous: handles and anti-aliasing]
  const OPS = [
    ["export with no edits", async () => {}, null],
    ["add text", async (at) => { await pick("Text"); await page.mouse.click(...at(60, 560)); await page.keyboard.type("Approved for payment"); await page.keyboard.press("Escape"); }, [50, 540, 260, 575]],
    ["highlight", async (at) => { await pick("Highlight"); await drag(at(60, 303), at(300, 315)); }, [55, 298, 305, 320]],
    ["underline", async (at) => { await pick("Underline"); await drag(at(60, 303), at(300, 315)); }, [55, 298, 305, 322]],
    ["strikethrough", async (at) => { await pick("Strikethrough", "More"); await drag(at(60, 303), at(300, 315)); }, [55, 298, 305, 320]],
    ["draw", async (at) => { await pick("Draw"); await page.mouse.move(...at(360, 600)); await page.mouse.down(); await page.mouse.move(...at(430, 640), { steps: 6 }); await page.mouse.move(...at(520, 600), { steps: 6 }); await page.mouse.up(); }, [350, 590, 530, 650]],
    ["rectangle", async (at) => { await pick("Rectangle", "Shapes"); await drag(at(60, 640), at(200, 700)); }, [54, 634, 206, 706]],
    ["arrow", async (at) => { await pick("Arrow", "Shapes"); await drag(at(230, 720), at(330, 770)); }, [222, 712, 338, 778]],
    ["whiteout", async (at) => { await pick("Whiteout"); await drag(at(55, 500), at(470, 515)); }, [52, 497, 473, 518]],
    ["edit existing text", async () => {
      await page.getByRole("button", { name: /^Edit text: .*Jordan Smith/ }).first().click();
      const dlg = page.getByRole("dialog", { name: "Edit text" });
      const v = await dlg.locator("input[type=text]").inputValue();
      await dlg.locator("input[type=text]").fill(v.replace("Jordan Smith", "Jordan Rivera"));
      await dlg.getByRole("button", { name: "Save correction" }).click();
      await dlg.waitFor({ state: "hidden" });
    }, "auto"],
  ];
  for (const [what, act, area] of OPS) {
    await step("PDF Editor", what, async () => {
      await open(page, "/pdf-editor");
      await addPaths(page, [SRC]);
      await page.getByTestId("page-surface").waitFor({ timeout: 60_000 });
      await page.getByRole("button", { name: "Fit page" }).click();
      await page.waitForTimeout(500);
      await act(await mapper());
      await page.getByRole("button", { name: "Select", exact: true }).click().catch(() => {});
      const out = await download(page, page.getByRole("button", { name: "Export PDF" }), `fid-edit-${what.replace(/\W+/g, "-")}`);
      let box = area;
      if (area === "auto") {
        // The corrected line: wherever the old words were (plus the new words' width).
        const probe = JSON.parse(execFileSync("python", ["-c", `import pymupdf,json;p=pymupdf.open(r"${SRC}")[0];r=[w for w in p.get_text("words") if w[4] in ("Jordan","Smith")][:2];print(json.dumps([min(w[0] for w in r),min(w[1] for w in r),max(w[2] for w in r),max(w[3] for w in r)]))`], { encoding: "utf8" }));
        box = [probe[0] - 4, probe[1] - 4, probe[2] + 40, probe[3] + 4];
      }
      const args = ["--dir", dirOf("pdf-editor"), "--name", `${tag}-${what.replace(/\W+/g, "-")}`, "--max-images", "1"];
      if (box) args.push("--mask", `1:${box.join(",")}`);
      const d = visdiff("pdf", SRC, out, args);
      const p1 = d.pages[0];
      if (!box) {
        rec("PDF Editor", what, identityGrade(d), pageSummary(d));
        return;
      }
      const outside = p1.changedOutsidePct;
      const outsideGrade = outside <= T.editOutside[0] ? "PASS" : outside <= T.editOutside[1] ? "LIMITED" : "FAIL";
      const visible = p1.changedInsidePct > 0.5 ? "PASS" : "FAIL";
      const others = d.pages.slice(1).every((p) => p.changedPct <= 0.05) ? "PASS" : "FAIL";
      rec("PDF Editor", what, worst(outsideGrade, visible, others, d.allSizesKept ? "PASS" : "FAIL"), { changedOutsidePct: outside, maxDiffOutside: p1.maxDiffOutside, changedInsidePct: p1.changedInsidePct, otherPagesUnchanged: others, area: box, textRecallP1: p1.textRecall });
    });
  }
}

// ================================================================== OCR — the searchable PDF looks exactly like the scan
if (run("ocr")) {
  const truth = JSON.parse(fs.readFileSync(path.join(path.dirname(sx("x")), "ocr-truth.json"), "utf8"));
  const norm = (w) => w.normalize("NFC").toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  for (const t of truth.filter((x) => /OCR-[ABDG]/.test(x.name))) {
    await step("OCR", t.name, async () => {
      await open(page, "/pdf-editor");
      await addPaths(page, [sx(t.name)]);
      await page.getByTestId("page-surface").first().waitFor({ timeout: 60_000 });
      await page.getByRole("button", { name: "Recognize text" }).click();
      await page.getByRole("button", { name: /^Edit recognized word: / }).first().waitFor({ timeout: 300_000 });
      await page.getByRole("button", { name: "Cancel" }).waitFor({ state: "hidden", timeout: 300_000 }).catch(() => {});
      // What the editor recognised (its clickable words), page by page.
      const pages = await page.getByRole("button", { name: /^Go to page \d+$/ }).count();
      const found = [];
      for (let p = 1; p <= Math.max(1, pages); p++) {
        if (pages > 1) {
          await page.getByRole("button", { name: `Go to page ${p}`, exact: true }).click();
          await page.waitForTimeout(600);
        }
        found.push(...(await page.getByRole("button", { name: /^Edit recognized word: / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Edit recognized word: /, "")))));
      }
      const out = await download(page, page.getByRole("button", { name: "Export PDF" }), `fid-ocr-${t.id}`);
      const d = visdiff("pdf", sx(t.name), out, ["--dir", dirOf("ocr"), "--name", `${tag}-${t.name.replace(/\.pdf$/, "")}`, "--max-images", "1"]);
      const want = (Array.isArray(t.truth) ? t.truth.join(" ") : t.truth).split(/\s+/).map(norm).filter(Boolean);
      const share = (words) => {
        const pool = new Map();
        for (const w of words.map(norm).filter(Boolean)) pool.set(w, (pool.get(w) ?? 0) + 1);
        let hit = 0;
        for (const w of want) if ((pool.get(w) ?? 0) > 0) { pool.set(w, pool.get(w) - 1); hit++; }
        return +((hit / want.length) * 100).toFixed(1);
      };
      const accuracy = share(found);
      const exported = JSON.parse(execFileSync("python", ["-c", `import pymupdf,json;print(json.dumps([w[4] for p in pymupdf.open(r"${out}") for w in p.get_text("words")]))`], { encoding: "utf8" }));
      const searchable = share(exported);
      // The exported scan must look exactly like the input (OCR adds nothing visible).
      const look = worst(band(d.minSsim, ...T.identity.ssim), d.maxChangedPct <= T.identity.changed[0] ? "PASS" : d.maxChangedPct <= T.identity.changed[1] ? "LIMITED" : "FAIL");
      rec("OCR", t.name, worst(look, band(accuracy, 95, 85)), { look, recognitionAccuracy: accuracy, exportSearchable: searchable, ...pageSummary(d) });
    });
  }
}

const leaked = requests.filter((u) => !u.startsWith(new URL(process.env.BASE ?? "http://localhost:3000").origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
rec("Fidelity tools", "no third-party requests", leaked.length ? "FAIL" : "PASS", { leaked: leaked.slice(0, 5) });
rec("Fidelity tools", "console errors (all steps)", errors.length ? "FAIL" : "PASS", { count: errors.length });
await browser.close();
save(`fid-tools-${which}-${tag}`);
const tally = {};
for (const r of records) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
console.log(JSON.stringify(tally));
