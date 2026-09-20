// Drives the REAL Compress PDF UI (Chromium) for every PDF fixture x every mode, downloads each output,
// and records exact bytes. Visual diff is computed by qa/scripts/pdf-visual-diff.mjs.
//   BASE=http://localhost:3000 node qa/scripts/measure-pdf-compress.mjs [fixture-substring ...]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.resolve("qa/evidence/compress-out");
fs.mkdirSync(OUT, { recursive: true });
const filters = process.argv.slice(2);
const files = [
  ...fs.readdirSync("qa-fixtures").filter((f) => /^PDF-.*\.pdf$/.test(f)).map((f) => path.resolve("qa-fixtures", f)),
  ...(process.env.EXTRA ? process.env.EXTRA.split(";") : []),
].filter((f) => !filters.length || filters.some((s) => f.includes(s)));
const modes = [["lossless", /^Lossless/], ["balanced", /^Balanced/], ["small", /^Smallest/]];
const rows = [];
const browser = await chromium.launch();
for (const file of files) {
  const name = path.basename(file);
  const input = fs.statSync(file).size;
  for (const [mode, label] of modes) {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    const row = { fixture: name, mode, input };
    try {
      await page.goto(`${BASE}/pdf/compress`);
      await page.locator('input[type="file"]').setInputFiles(file);
      await page.getByRole("button", { name: /^Compress /i }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      row.analysis = (await page.locator("main").innerText()).split("\n").filter((l) => /embedded image|no embedded|text and vector|Mostly text|Lossless optimization|Balanced or Smallest/i.test(l)).slice(0, 3).join(" | ");
      await page.getByLabel(label).check();
      const t0 = Date.now();
      await page.getByRole("button", { name: /^Compress /i }).click();
      await Promise.race([page.getByText("Done!").waitFor({ timeout: 300_000 }), page.getByRole("button", { name: "Try again" }).waitFor({ timeout: 300_000 })]);
      row.ms = Date.now() - t0;
      if (await page.getByText("Done!").count()) {
        const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
        const dest = path.join(OUT, `${name.replace(/\.pdf$/, "")}.${mode}.pdf`);
        await dl.saveAs(dest);
        row.output = fs.statSync(dest).size;
        row.file = dest;
        row.ui = (await page.locator("main").innerText()).split("\n").map((l) => l.trim()).filter((l) => /smaller|No significant|MB|KB|bytes|re-encoded|merged|optimized|kept/i.test(l)).slice(0, 6).join(" | ");
      } else row.error = (await page.locator("main").innerText()).slice(0, 200);
    } catch (e) {
      row.error = String(e).slice(0, 200);
    }
    rows.push(row);
    console.log(JSON.stringify({ fixture: row.fixture, mode, input, output: row.output, pct: row.output ? +(((input - row.output) / input) * 100).toFixed(1) : null, ms: row.ms, error: row.error }));
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(process.env.RESULTS ?? "qa/evidence/compress-results.json", JSON.stringify(rows, null, 1));
