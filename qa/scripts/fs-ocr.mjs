// OCR scenarios in the PDF editor: clean, low-res, low contrast, rotated, Spanish, mixed, multi-page.
// Word accuracy = share of ground-truth words found among the recognised words (case/punctuation-insensitive).
//   BASE=http://localhost:3000 node qa/scripts/fs-ocr.mjs [mobile]
import { execFileSync } from "node:child_process";
import { launch, open, addPaths, download, rec, save, sx, SFIX, fs, path, pdfInfo } from "./fl-lib.mjs";

const mobile = process.argv[2] === "mobile";
const truth = JSON.parse(fs.readFileSync(path.join(SFIX, "ocr-truth.json"), "utf8"));
const norm = (w) => w.normalize("NFC").toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const words = (lines) => lines.join(" ").split(/\s+/).map(norm).filter(Boolean);

const { browser, page, errors } = await launch({ mobile });
for (const t of truth) {
  const test = `${t.id} ${t.name.replace(/^OCR-\w-|\.pdf$/g, "")} (${t.lang})`;
  try {
    await open(page, "/pdf-editor");
    await addPaths(page, [sx(t.name)]);
    await page.getByTestId("page-surface").first().waitFor({ timeout: 60_000 });
    if (t.lang !== "eng") {
      if (mobile) await page.getByRole("button", { name: "Properties", exact: true }).click().catch(() => {});
      if (!(await page.getByLabel("Language").isVisible())) await page.locator("summary", { hasText: "Recognize text" }).click();
      await page.getByLabel("Language").selectOption(t.lang);
      if (mobile) await page.getByRole("button", { name: "Close panel" }).click().catch(() => {});
    }
    const banner = page.getByRole("button", { name: "Recognize text" });
    await banner.waitFor({ timeout: 30_000 });
    const t0 = Date.now();
    await banner.click();
    // recognition runs on this device with a progress strip; it ends by itself
    const busy = page.getByText(/Recognizing text|Preparing page|Loading text recognition/).first();
    await busy.waitFor({ timeout: 120_000 }).catch(() => {});
    await busy.waitFor({ state: "hidden", timeout: 300_000 });
    const ms = Date.now() - t0;
    // Recognized text is for search, copy and accessibility: its words are NOT an editing surface.
    const editTargets = await page.getByRole("button", { name: /^Edit recognized (word|line): / }).count();
    // the recognized words are found by the editor's own search
    const want = words(t.truth);
    const probe = want.find((w) => w.length >= 5) ?? want[0];
    await page.locator("summary", { hasText: /^\s*Search/ }).click();
    await page.getByLabel("Search document text").fill(probe);
    const searchHit = !(await page.getByText("No matches").isVisible().catch(() => false)) && (await page.getByText(/\d+ of \d+/).first().isVisible().catch(() => false));
    // the export keeps the scan exactly as it looks, with the recognized words as an invisible, searchable layer
    const out = await download(page, page.getByRole("button", { name: "Export PDF" }), `fs-ocr-${t.id}${mobile ? "-m" : ""}`);
    const info = await pdfInfo(out);
    const exported = words(info.texts);
    const pool = new Map();
    for (const w of exported) pool.set(w, (pool.get(w) ?? 0) + 1);
    let hit = 0;
    const missed = [];
    for (const w of want) {
      if (pool.get(w)) {
        hit++;
        pool.set(w, pool.get(w) - 1);
      } else missed.push(w);
    }
    const accuracy = +((hit / want.length) * 100).toFixed(1);
    const diff = JSON.parse(execFileSync("python", ["qa/validate/pagediff.py", sx(t.name), out], { encoding: "utf8" }).trim().split(String.fromCharCode(10)).pop());
    const visuallyUnchanged = diff.maxDiffPct !== undefined && diff.maxDiffPct < 0.05;
    const base = accuracy >= 90 ? "PASS" : accuracy >= 60 ? "LIMITED" : "FAIL";
    const verdict = editTargets === 0 && visuallyUnchanged && searchHit ? base : "FAIL";
    rec("OCR", test + (mobile ? " [mobile]" : ""), verdict, { ms, truthWords: want.length, searchableAccuracy: `${accuracy}%`, missed: missed.slice(0, 12), editTargets, searchHit, pixelDiffPct: diff.maxDiffPct, pages: info.pages });
  } catch (e) {
    rec("OCR", test, "FAIL", { error: String(e).slice(0, 300) });
  }
}
rec("OCR", "console errors", errors.length ? "FAIL" : "PASS", errors.length ? { errors: errors.slice(0, 4) } : {});
await browser.close();
save(`fs-ocr${mobile ? "-mobile" : ""}`);
