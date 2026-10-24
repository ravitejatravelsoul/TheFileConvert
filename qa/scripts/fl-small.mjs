// Small-file target-compression matrix through the real UI, for both compressors.
//   BASE=http://localhost:3000 node qa/scripts/fl-small.mjs [pdf|image|all] [tag]
import { launch, open, addFiles, download, size, pdfInfo, renderPage, imageInfo, rec, save, fx, fs } from "./fl-lib.mjs";

const which = process.argv[2] ?? "all";
const tag = process.argv[3] ?? "run";
const KB = 1000;

const MATRIX = [
  ["A", 300], ["A", 250], ["A", 200], ["A", 150], ["A", 50],
  ["B", 400], ["B", 300], ["B", 200],
  ["C", 200],
];
const FILES = {
  pdf: { A: "SMALL-A-report-324k.pdf", B: "SMALL-B-report-500k.pdf", C: "SMALL-C-report-180k.pdf" },
  image: { A: "SMALL-A-photo-324k.jpg", B: "SMALL-B-photo-500k.jpg", C: "SMALL-C-photo-180k.jpg" },
};

async function run(kind) {
  const { browser, page, errors } = await launch();
  const route = kind === "pdf" ? "/compress-pdf" : "/compress-image";
  const tool = kind === "pdf" ? "Compress PDF" : "Compress Image";
  // Plus one target that can't be reached without wrecking the file.
  for (const [fileKey, kb] of [...MATRIX, ["A", kind === "pdf" ? 20 : 3]]) {
    const fixture = FILES[kind][fileKey];
    const target = kb * KB;
    const test = `${fixture} → ${kb} KB`;
    try {
      await open(page, route);
      await addFiles(page, [fixture]);
      await page.getByText("How small do you need it?").waitFor();
      await page.getByRole("radio", { name: "Custom", exact: true }).click();
      await page.getByLabel("Custom target size").fill(String(kb));
      await page.getByRole("radio", { name: "KB", exact: true }).click();
      await page.getByRole("button", { name: `Compress to under ${kb} KB` }).click();
      const result = page.getByTestId("result");
      await result.waitFor({ timeout: 300_000 });
      const headline = (await result.getByRole("status").innerText()).trim();
      const sub = (await result.locator("p").nth(1).innerText()).trim();
      const out = await download(page, page.getByRole("button", { name: /^Download/ }), `small-${tag}-${kind}-${fileKey}-${kb}`);
      const input = size(fx(fixture));
      const output = size(out);
      const unchanged = fs.readFileSync(out).equals(fs.readFileSync(fx(fixture)));
      const achieved = output <= target;
      const claimsSuccess = /^Done|Already under/.test(headline);
      // Reopen independently and make sure the result is still a usable document/image.
      let quality;
      if (kind === "pdf") {
        const info = await pdfInfo(out);
        const img = await renderPage(info.doc, 1, 0.5);
        let dark = 0;
        for (let i = 0; i < img.d.length; i += 4 * 31) if (img.d[i] < 120) dark++;
        quality = `${info.pages} page(s), text ${/Quarterly site report/.test(info.texts[0]) ? "intact" : "MISSING"}, render ${dark > 30 ? "ok" : "BLANK"}`;
      } else {
        const i = await imageInfo(out);
        quality = `${i.format} ${i.w}x${i.h}`;
      }
      const details = (await page.getByTestId("image-details").innerText().catch(() => "")) || (await page.getByText(/^Quality setting:/).innerText().catch(() => ""));
      // The contract: success is claimed exactly when the output fits; an input over the target must not
      // come back unchanged while claiming success.
      const honest = claimsSuccess === achieved && !(input > target && unchanged && claimsSuccess);
      const verdict = !honest ? "FAIL" : achieved ? "PASS" : "LIMITED";
      rec(tool, test, verdict, { input, target, output, achieved, unchanged, headline, sub, quality, details: details.replace(/\s+/g, " ").trim() });
    } catch (e) {
      rec(tool, test, "FAIL", { error: String(e).slice(0, 300) });
    }
  }
  if (errors.length) rec(tool, "console errors", "FAIL", { errors });
  await browser.close();
}

if (which === "all" || which === "pdf") await run("pdf");
if (which === "all" || which === "image") await run("image");
save(`small-${tag}`);
