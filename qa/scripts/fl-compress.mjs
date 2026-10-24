// Compression acceptance: PDF and image target-size matrices through the real UI.
//   node qa/scripts/fl-compress.mjs [pdf|image]
import { launch, open, addFiles, download, size, pdfInfo, renderPage, imageInfo, rec, save, shot, fx } from "./fl-lib.mjs";

const which = process.argv[2] ?? "all";
const MBd = 1_000_000;
const KBd = 1_000;

async function chooseTarget(page, bytes, presets) {
  const label = bytes >= MBd ? `${+(bytes / MBd).toFixed(2)} MB` : `${+(bytes / KBd).toFixed(1)} KB`;
  if (presets.includes(label)) {
    await page.getByRole("radio", { name: label, exact: true }).click();
  } else {
    await page.getByRole("radio", { name: "Custom", exact: true }).click();
    const unit = bytes >= MBd ? "MB" : "KB";
    await page.getByLabel("Custom target size").fill(String(bytes >= MBd ? bytes / MBd : bytes / KBd));
    await page.getByRole("radio", { name: unit, exact: true }).click();
  }
  return label;
}

function nonBlank(img) {
  let dark = 0;
  for (let i = 0; i < img.d.length; i += 4 * 53) if (img.d[i] + img.d[i + 1] + img.d[i + 2] < 400) dark++;
  return dark > 50;
}

async function runPdf() {
  const { browser, page, errors } = await launch();
  const cases = [
    ["FL-PDF-02-scan-4mb.pdf", 2 * MBd],
    ["FL-PDF-02-scan-4mb.pdf", 1 * MBd],
    ["FL-PDF-02-scan-4mb.pdf", 500 * KBd],
    ["FL-PDF-03-scan-10mb.pdf", 5 * MBd],
    ["FL-PDF-03-scan-10mb.pdf", 2 * MBd],
    ["FL-PDF-03-scan-10mb.pdf", 1 * MBd],
    ["FL-PDF-02-scan-4mb.pdf", 40 * KBd], // not reachable: must report closest, never fake success
    ["FL-PDF-01-small-text.pdf", 500 * KBd], // already under target: original back unchanged
  ];
  const presets = ["500 KB", "1 MB", "2 MB", "5 MB"];
  let first = true;
  for (const [fixture, target] of cases) {
    const test = `${fixture} → ${target.toLocaleString("en-US")} B`;
    try {
      await open(page, "/compress-pdf");
      if (first) await shot(page, "03-compress-pdf-upload.png");
      await addFiles(page, [fixture]);
      await page.getByText("How small do you need it?").waitFor();
      const label = await chooseTarget(page, target, presets);
      if (first) await shot(page, "04-compress-pdf-target.png");
      const t0 = Date.now();
      await page.getByRole("button", { name: /^Compress to under/ }).click();
      await page.getByTestId("result").waitFor({ timeout: 300_000 });
      const ms = Date.now() - t0;
      const headline = (await page.getByTestId("result").getByRole("status").innerText()).trim();
      const quality = (await page.getByText(/^Quality setting:/).innerText()).replace(/·.*$/, "").replace("Quality setting:", "").trim();
      if (first || target === 40 * KBd) await shot(page, target === 40 * KBd ? "05b-compress-pdf-closest.png" : "05-compress-pdf-result.png");
      first = false;
      const out = await download(page, page.getByRole("button", { name: /^Download/ }), `cpdf-${label.replace(" ", "")}`);
      const bytesIn = size(fx(fixture));
      const bytesOut = size(out);
      const info = await pdfInfo(out);
      const src = await pdfInfo(fx(fixture));
      const img = await renderPage(info.doc, 1, 0.5);
      const achieved = bytesOut <= target;
      const claimed = /^Done|Already under/.test(headline);
      const honest = claimed === achieved;
      const pagesOk = info.pages === src.pages;
      const verdict = honest && pagesOk && nonBlank(img) ? (achieved ? "PASS" : "LIMITED") : "FAIL";
      rec("Compress PDF", test, verdict, { input: bytesIn, target, output: bytesOut, achieved, headline, quality, pages: `${info.pages}/${src.pages}`, ms });
    } catch (e) {
      rec("Compress PDF", test, "FAIL", { error: String(e).slice(0, 300) });
    }
  }
  if (errors.length) rec("Compress PDF", "console errors", "FAIL", { errors });
  await browser.close();
}

async function runImage() {
  const { browser, page, errors } = await launch();
  const cases = [
    ["FL-IMG-01-large.jpg", 2 * MBd],
    ["FL-IMG-01-large.jpg", 1 * MBd],
    ["FL-IMG-01-large.jpg", 500 * KBd],
    ["FL-IMG-01-large.jpg", 250 * KBd],
    ["FL-IMG-02-huge.jpg", 5 * MBd],
    ["FL-IMG-02-huge.jpg", 2 * MBd],
    ["FL-IMG-02-huge.jpg", 1 * MBd],
    ["FL-IMG-03-transparent.png", 1 * MBd],
    ["FL-IMG-03-transparent.png", 500 * KBd],
  ];
  const presets = ["100 KB", "250 KB", "500 KB", "1 MB"];
  let first = true;
  for (const [fixture, target] of cases) {
    const test = `${fixture} → ${target.toLocaleString("en-US")} B`;
    try {
      await open(page, "/compress-image");
      await addFiles(page, [fixture]);
      await page.getByText("How small do you need it?").waitFor();
      const label = await chooseTarget(page, target, presets);
      const t0 = Date.now();
      await page.getByRole("button", { name: /^Compress to under/ }).click();
      await page.getByTestId("result").waitFor({ timeout: 600_000 });
      const ms = Date.now() - t0;
      const headline = (await page.getByTestId("result").getByRole("status").innerText()).trim();
      const details = (await page.getByTestId("image-details").innerText().catch(() => "")).trim();
      const formatNote = (await page.getByText(/^Converted to WebP/).innerText().catch(() => "")).trim();
      if (first || fixture.includes("transparent")) await shot(page, fixture.includes("transparent") ? "06b-compress-image-transparent.png" : "06-compress-image-result.png");
      first = false;
      const out = await download(page, page.getByRole("button", { name: /^Download/ }), `cimg-${label.replace(" ", "")}`);
      const src = await imageInfo(fx(fixture));
      const img = await imageInfo(out);
      const bytesOut = size(out);
      const achieved = bytesOut <= target;
      const claimed = /^Done|Already under/.test(headline);
      const alphaKept = !src.hasAlpha || img.hasAlpha;
      const formatOk = src.hasAlpha ? img.format === "webp" && /transparency/.test(formatNote) : img.format === src.format;
      const verdict = claimed === achieved && alphaKept && formatOk ? (achieved ? "PASS" : "LIMITED") : "FAIL";
      rec("Compress Image", test, verdict, {
        input: size(fx(fixture)),
        target,
        output: bytesOut,
        achieved,
        dims: `${src.w}x${src.h}→${img.w}x${img.h}`,
        format: `${src.format}→${img.format}`,
        alpha: `${src.hasAlpha}→${img.hasAlpha}`,
        details,
        note: formatNote,
        ms,
      });
    } catch (e) {
      rec("Compress Image", test, "FAIL", { error: String(e).slice(0, 300) });
    }
  }
  if (errors.length) rec("Compress Image", "console errors", "FAIL", { errors });
  await browser.close();
}

if (which === "all" || which === "pdf") await runPdf();
if (which === "all" || which === "image") await runImage();
save(`compress-${which}`);
