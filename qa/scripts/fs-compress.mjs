// Full scenario matrices for Compress PDF and Compress Image, through the real UI, every output validated.
//   BASE=http://localhost:3000 node qa/scripts/fs-compress.mjs [pdf|image|all]
import { launch, open, addPaths, download, size, rec, save, sx, REAL_SCAN, fs, imageSimilarity, pdfPageSimilarity, imageInfo } from "./fl-lib.mjs";

const which = process.argv[2] ?? "all";
const KB = 1000, MB = 1_000_000;
const fmt = (b) => (b >= MB ? `${+(b / MB).toFixed(2)} MB` : `${+(b / KB).toFixed(1)} KB`);

async function setTarget(page, bytes) {
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  const mb = bytes >= MB && bytes % (MB / 10) === 0;
  await page.getByLabel("Custom target size").fill(String(mb ? bytes / MB : bytes / KB));
  await page.getByRole("radio", { name: mb ? "MB" : "KB", exact: true }).click();
}

async function runOne(page, tool, route, input, target, tag, { expectText = false } = {}) {
  await open(page, route);
  await addPaths(page, [input]);
  await page.getByText("How small do you need it?").waitFor({ timeout: 60_000 });
  await setTarget(page, target);
  const t0 = Date.now();
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  const result = page.getByTestId("result");
  await result.waitFor({ timeout: 600_000 });
  const ms = Date.now() - t0;
  const headline = (await result.getByRole("status").innerText()).trim();
  const quality = ((await page.getByText(/^Quality setting:/).innerText().catch(() => "")) || (await page.getByTestId("image-details").innerText().catch(() => ""))).replace(/\s+/g, " ").trim();
  const out = await download(page, page.getByRole("button", { name: /^Download/ }), tag);
  return { out, ms, headline, quality, expectText };
}

// ------------------------------------------------------------------ PDF
async function runPdf() {
  const { browser, page, errors } = await launch();
  const M = [
    ["PDF-A-text-heavy-300k.pdf", [250 * KB, 200 * KB, 150 * KB, 500 * KB], true],
    ["PDF-B-mixed-800k.pdf", [700 * KB, 500 * KB, 300 * KB], true],
    ["PDF-C-scan-3.8mb-incremental.pdf", [2 * MB, 1 * MB, 500 * KB], false],
    ["PDF-D-photo-heavy-5mb.pdf", [3 * MB, 2 * MB, 1 * MB], true],
    ["PDF-E-scan-10mb.pdf", [5 * MB, 2 * MB, 1 * MB], false],
    ["PDF-F-photo-heavy-20mb.pdf", [10 * MB, 5 * MB, 2 * MB], true],
    ["PDF-G-already-optimized.pdf", [200 * KB, 130 * KB, 15 * KB], true],
    ["PDF-H-multipage-text-image.pdf", [2 * MB, 1 * MB], true],
    ["PDF-L-image-only-scan-gray-a85.pdf", [2 * MB, 1 * MB], false],
    ["PDF-I-rotated.pdf", [300 * KB], true],
    ["PDF-M-acroform.pdf", [100 * KB], true],
    ["PDF-N-metadata-rich.pdf", [100 * KB], true],
    [REAL_SCAN, [1 * MB, 2 * MB, 500 * KB], false],
  ];
  for (const [fixture, targets, hasText] of M) {
    const input = fixture.includes("/") ? fixture : sx(fixture);
    const id = fixture.includes("/") ? "REAL user scan" : fixture.slice(0, 5);
    for (const target of targets) {
      const test = `${id} ${fmt(size(input))} → ${fmt(target)}`;
      try {
        const r = await runOne(page, "Compress PDF", "/compress-pdf", input, target, `fs-cpdf-${id.replace(/\W+/g, "")}-${target}`);
        const bytesIn = size(input), bytesOut = size(r.out);
        const { validateFile } = await import("./validate-output.mjs");
        const src = await validateFile(input);
        const v = await validateFile(r.out);
        const achieved = bytesOut <= target;
        const claimed = /^Done|Already under/.test(r.headline);
        const unchanged = fs.readFileSync(r.out).equals(fs.readFileSync(input));
        const pagesOk = v.pages === src.pages;
        const textOk = !hasText || v.textChars >= src.textChars * 0.98;
        // Worst page of the first six (page 1 is often text-only and would hide image damage).
        const sims = [];
        for (let pg = 1; pg <= Math.min(6, src.pages ?? 1); pg++) sims.push(await pdfPageSimilarity(input, r.out, pg, 0.5));
        const sim = { psnr: Math.min(...sims.map((x) => x.psnr ?? 99)), ssim: Math.min(...sims.map((x) => x.ssim ?? 1)) };
        const honest = claimed === achieved && !(bytesIn > target && unchanged && claimed) && (bytesIn > target || unchanged);
        const renderOk = v.ok && (v.pdfjs_blank?.length ?? 0) === 0 && (v.blank_pages?.length ?? 0) === 0;
        const verdict = !honest || !pagesOk || !textOk || !renderOk ? "FAIL" : achieved ? "PASS" : "LIMITED";
        rec("Compress PDF", test, verdict, {
          fixture: id,
          input: bytesIn,
          target,
          output: bytesOut,
          achieved,
          opened: v.ok,
          pages: `${v.pages}/${src.pages}`,
          allPagesRender: renderOk,
          text: hasText ? `${v.textChars}/${src.textChars} chars` : "n/a (scan)",
          psnr: sim.psnr,
          ssim: sim.ssim,
          quality: r.quality.slice(0, 80),
          headline: r.headline,
          ms: r.ms,
        });
      } catch (e) {
        rec("Compress PDF", test, "FAIL", { error: String(e).slice(0, 300) });
      }
    }
  }
  rec("Compress PDF", "console errors during matrix", errors.length ? "FAIL" : "PASS", errors.length ? { errors: errors.slice(0, 5) } : {});
  await browser.close();
}

// ------------------------------------------------------------------ Image
async function runImage() {
  const { browser, page, errors } = await launch();
  const M = [
    ["IMAGE-A-optimized-250k.jpg", [200 * KB, 150 * KB, 100 * KB]],
    ["IMAGE-B-photo-500k.jpg", [400 * KB, 250 * KB, 150 * KB]],
    ["IMAGE-C-photo-3mb.jpg", [2 * MB, 1 * MB, 500 * KB, 250 * KB]],
    ["IMAGE-D-photo-8mb.jpg", [5 * MB, 2 * MB, 1 * MB, 500 * KB]],
    ["IMAGE-E-photo-15mb.jpg", [5 * MB, 2 * MB, 1 * MB]],
    ["IMAGE-F-transparent.png", [1 * MB, 500 * KB, 250 * KB]],
    ["IMAGE-G-large-photo.png", [2 * MB, 1 * MB, 500 * KB]],
    ["IMAGE-L-tiny-optimized.jpg", [50 * KB, 20 * KB, 2 * KB]],
    ["IMAGE-H-photo.webp", [500 * KB]],
    ["IMAGE-K-exif-rich.jpg", [300 * KB]],
  ];
  for (const [fixture, targets] of M) {
    const input = sx(fixture);
    for (const target of targets) {
      const test = `${fixture.slice(0, 7)} ${fmt(size(input))} → ${fmt(target)}`;
      try {
        const r = await runOne(page, "Compress Image", "/compress-image", input, target, `fs-cimg-${fixture.slice(0, 7)}-${target}`);
        const bytesIn = size(input), bytesOut = size(r.out);
        const src = await imageInfo(input);
        const o = await imageInfo(r.out);
        const achieved = bytesOut <= target;
        const claimed = /^Done|Already under/.test(r.headline);
        const unchanged = fs.readFileSync(r.out).equals(fs.readFileSync(input));
        const honest = claimed === achieved && !(bytesIn > target && unchanged && claimed) && (bytesIn > target || unchanged);
        const alphaKept = !src.hasAlpha || o.hasAlpha;
        const aspect = Math.abs(src.w / src.h - o.w / o.h) < 0.02 || Math.abs(src.w / src.h - o.h / o.w) < 0.02;
        const sim = await imageSimilarity(input, r.out).catch(() => ({}));
        // EXIF: the GPS/camera block must not survive, and the photo must come out upright (portrait).
        const exif = fixture.startsWith("IMAGE-K") ? { gpsStripped: !fs.readFileSync(r.out).includes(Buffer.from("QA Camera Co")), upright: o.h > o.w } : undefined;
        const exifOk = !exif || (exif.gpsStripped && exif.upright);
        const verdict = !honest || !alphaKept || !aspect || !exifOk ? "FAIL" : achieved ? "PASS" : "LIMITED";
        rec("Compress Image", test, verdict, {
          fixture: fixture.slice(0, 7),
          input: bytesIn,
          target,
          output: bytesOut,
          achieved,
          dims: `${src.w}x${src.h}→${o.w}x${o.h}`,
          format: `${src.format}→${o.format}`,
          alpha: `${src.hasAlpha}→${o.hasAlpha}`,
          psnr: sim.psnr,
          ssim: sim.ssim,
          exif,
          details: r.quality.slice(0, 120),
          headline: r.headline,
          ms: r.ms,
        });
      } catch (e) {
        rec("Compress Image", test, "FAIL", { error: String(e).slice(0, 300) });
      }
    }
  }
  rec("Compress Image", "console errors during matrix", errors.length ? "FAIL" : "PASS", errors.length ? { errors: errors.slice(0, 5) } : {});
  await browser.close();
}

if (which === "all" || which === "pdf") await runPdf();
if (which === "all" || which === "image") await runImage();
save(`fs-compress-${which}`);
