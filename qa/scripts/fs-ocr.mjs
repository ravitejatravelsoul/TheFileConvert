// OCR scenarios in the PDF editor: clean, low-res, low contrast, rotated, Spanish, mixed, multi-page.
// Word accuracy = share of ground-truth words found among the recognised words (case/punctuation-insensitive).
//   BASE=http://localhost:3000 node qa/scripts/fs-ocr.mjs [mobile]
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
      if (!(await page.getByLabel("Language").isVisible())) await page.locator("summary", { hasText: "Recognize Text (OCR)" }).click();
      await page.getByLabel("Language").selectOption(t.lang);
      if (mobile) await page.getByRole("button", { name: "Close panel" }).click().catch(() => {});
    }
    const banner = page.getByRole("button", { name: "Recognize text" });
    await banner.waitFor({ timeout: 30_000 });
    const t0 = Date.now();
    await banner.click();
    await page.getByRole("button", { name: /^Edit recognized word: / }).first().waitFor({ timeout: 300_000 });
    await page.getByRole("button", { name: "Cancel" }).waitFor({ state: "hidden", timeout: 300_000 }).catch(() => {});
    const ms = Date.now() - t0;
    const pages = await page.getByRole("button", { name: /^Go to page \d+$/ }).count();
    const found = [];
    for (let p = 1; p <= Math.max(1, pages); p++) {
      if (pages > 1) {
        await page.getByRole("button", { name: `Go to page ${p}`, exact: true }).click();
        await page.waitForTimeout(600);
      }
      const labels = await page.getByRole("button", { name: /^Edit recognized word: / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").replace(/^Edit recognized word: /, "")));
      found.push(...labels);
    }
    const want = words(t.truth);
    const pool = new Map();
    for (const w of found.map(norm).filter(Boolean)) pool.set(w, (pool.get(w) ?? 0) + 1);
    let hit = 0;
    const missed = [];
    for (const w of want) {
      if (pool.get(w)) {
        hit++;
        pool.set(w, pool.get(w) - 1);
      } else missed.push(w);
    }
    const accuracy = +((hit / want.length) * 100).toFixed(1);
    // The export must still be a valid PDF with the recognised words searchable.
    const out = await download(page, page.getByRole("button", { name: "Export PDF" }), `fs-ocr-${t.id}${mobile ? "-m" : ""}`);
    const info = await pdfInfo(out);
    const exported = words(info.texts);
    const searchable = want.filter((w) => exported.includes(w)).length / want.length;
    const verdict = accuracy >= 90 ? "PASS" : accuracy >= 60 ? "LIMITED" : "FAIL";
    rec("OCR", test + (mobile ? " [mobile]" : ""), verdict, { ms, wordsRecognized: found.length, truthWords: want.length, accuracy: `${accuracy}%`, missed: missed.slice(0, 12), exportedSearchable: `${Math.round(searchable * 100)}%`, pages: info.pages });
  } catch (e) {
    rec("OCR", test, "FAIL", { error: String(e).slice(0, 300) });
  }
}
rec("OCR", "console errors", errors.length ? "FAIL" : "PASS", errors.length ? { errors: errors.slice(0, 4) } : {});
await browser.close();
save(`fs-ocr${mobile ? "-mobile" : ""}`);
