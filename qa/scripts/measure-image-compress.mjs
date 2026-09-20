// Real UI run of Compress Image for every photo/logo fixture x quality, downloads outputs, then decodes
// input + output independently (napi canvas) and computes PSNR and block-SSIM.
//   BASE=http://localhost:3000 node qa/scripts/measure-image-compress.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { loadImage, createCanvas } from "@napi-rs/canvas";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.resolve("qa/evidence/image-out");
fs.mkdirSync(OUT, { recursive: true });
const fixtures = ["IMAGE-01-photo-large.jpg", "IMAGE-02-photo-huge.jpg", "IMAGE-03-photo.png", "IMAGE-04-transparent.png", "IMAGE-05-flat-logo.png", "IMAGE-06-small-optimized.jpg", "IMAGE-07-photo.webp"];
const qualities = [90, 75, 50, 30];
const formats = [["default", null], ["jpeg", "JPG (small; no transparency)"]];

async function pixels(file, w, h) {
  const img = await loadImage(fs.readFileSync(file));
  const c = createCanvas(w ?? img.width, h ?? img.height); const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return { w: img.width, h: img.height, d: g.getImageData(0, 0, c.width, c.height).data };
}
function metrics(a, b) {
  let se = 0; const n = a.length / 4;
  const ga = new Float32Array(n), gb = new Float32Array(n);
  for (let i = 0, p = 0; i < a.length; i += 4, p++) { for (let k = 0; k < 3; k++) { const d = a[i + k] - b[i + k]; se += d * d; } ga[p] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]; gb[p] = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]; }
  const mse = se / (n * 3); const psnr = mse === 0 ? 99 : 10 * Math.log10(65025 / mse);
  return { psnr: +psnr.toFixed(2), ssim: null, ga, gb };
}
function ssim(ga, gb, w, h) {
  const C1 = 6.5025, C2 = 58.5225; let sum = 0, cnt = 0; const B = 8;
  for (let y = 0; y + B <= h; y += B * 2) for (let x = 0; x + B <= w; x += B * 2) {
    let ma = 0, mb = 0; for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) { ma += ga[(y + j) * w + x + i]; mb += gb[(y + j) * w + x + i]; }
    ma /= B * B; mb /= B * B; let va = 0, vb = 0, cv = 0;
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) { const da = ga[(y + j) * w + x + i] - ma, db = gb[(y + j) * w + x + i] - mb; va += da * da; vb += db * db; cv += da * db; }
    va /= B * B - 1; vb /= B * B - 1; cv /= B * B - 1;
    sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); cnt++;
  }
  return +(sum / cnt).toFixed(4);
}

const rows = [];
const browser = await chromium.launch();
for (const f of fixtures) {
  const file = path.resolve("qa-fixtures", f); const input = fs.statSync(file).size;
  for (const [fmtName, fmtLabel] of formats) for (const q of qualities) {
    const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage(); const row = { fixture: f, format: fmtName, quality: q, input };
    try {
      await page.goto(`${BASE}/image/compress`);
      await page.locator('input[type="file"]').setInputFiles(file);
      await page.getByRole("button", { name: /^Compress/ }).waitFor();
      if (fmtLabel) await page.locator("select").selectOption({ label: fmtLabel });
      row.formatUsed = await page.locator("select").evaluate((s) => s.value);
      const range = page.locator('input[type="range"]');
      if (await range.count()) await range.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, q);
      await page.getByRole("button", { name: /^Compress/ }).click();
      await Promise.race([page.getByText("Done!").waitFor({ timeout: 240_000 }), page.getByRole("button", { name: "Try again" }).waitFor({ timeout: 240_000 })]);
      if (await page.getByText("Done!").count()) {
        row.ui = (await page.locator("main").innerText()).split("\n").map((l) => l.trim()).filter((l) => /smaller|No significant|larger|unchanged|Exact|transparen/i.test(l)).join(" | ");
        const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
        const dest = path.join(OUT, `${f.replace(/\.[^.]+$/, "")}.${fmtName}.q${q}${path.extname(dl.suggestedFilename())}`);
        await dl.saveAs(dest); row.output = fs.statSync(dest).size; row.file = dest; row.suggested = dl.suggestedFilename();
        const a = await pixels(file); const b = await pixels(dest);
        row.dimsIn = `${a.w}x${a.h}`; row.dimsOut = `${b.w}x${b.h}`;
        if (a.w === b.w && a.h === b.h) { const m = metrics(a.d, b.d); row.psnr = m.psnr; row.ssim = ssim(m.ga, m.gb, a.w, a.h); }
      } else row.error = (await page.locator("main").innerText()).slice(0, 160);
    } catch (e) { row.error = String(e).slice(0, 160); }
    rows.push(row); console.log(JSON.stringify({ f, fmt: row.formatUsed, q, input, out: row.output, pct: row.output ? +(((input - row.output) / input) * 100).toFixed(1) : null, dims: row.dimsOut, psnr: row.psnr, ssim: row.ssim, err: row.error, ui: row.ui }));
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync("qa/evidence/image-compress-results.json", JSON.stringify(rows, null, 1));
