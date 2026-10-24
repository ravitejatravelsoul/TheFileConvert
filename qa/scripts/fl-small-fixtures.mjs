// Realistic small (~180–500 KB) files for the small-file target-compression tests.
// PDFs are made the way many real ones are: Chrome's own print-to-PDF of a page with photos.
//   node qa/scripts/fl-small-fixtures.mjs   ->  qa-fixtures/fresh/SMALL-*
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";

const OUT = path.resolve("qa-fixtures/fresh");
fs.mkdirSync(OUT, { recursive: true });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function photo(w, h, seed, noise) {
  const r = rng(seed);
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#35607a");
  grad.addColorStop(1, "#d99a4e");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `hsla(${Math.floor(r() * 360)},55%,${35 + r() * 35}%,0.5)`;
    g.beginPath();
    g.arc(r() * w, r() * h, (0.03 + r() * 0.15) * Math.min(w, h), 0, Math.PI * 2);
    g.fill();
  }
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * noise * 2;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Tunes a generator parameter until the output lands near the wanted size. */
async function tune(make, want, lo, hi) {
  let best = null;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const buf = await make(mid);
    if (!best || Math.abs(buf.length - want) < Math.abs(best.length - want)) best = buf;
    if (buf.length > want) hi = mid;
    else lo = mid;
  }
  return best;
}

const browser = await chromium.launch();
const page = await browser.newPage();
async function printedPdf(photoPx, seed) {
  const jpg = photo(Math.round(photoPx), Math.round(photoPx * 0.66), seed, 22).toBuffer("image/jpeg", 88).toString("base64");
  await page.setContent(`<html><body style="font-family:Arial;margin:40px">
    <h1>Quarterly site report</h1>
    <p>${"Inspection notes for the north building, including the roof, drainage and the loading bay. ".repeat(6)}</p>
    <img src="data:image/jpeg;base64,${jpg}" style="width:100%">
    <p>${"All findings were reviewed with the facilities team and scheduled for follow-up. ".repeat(5)}</p>
  </body></html>`);
  return page.pdf({ format: "A4", printBackground: true });
}

const files = [
  ["SMALL-A-report-324k.pdf", () => tune((px) => printedPdf(px, 11), 324_000, 400, 2400)],
  ["SMALL-B-report-500k.pdf", () => tune((px) => printedPdf(px, 12), 500_000, 400, 3000)],
  ["SMALL-C-report-180k.pdf", () => tune((px) => printedPdf(px, 13), 180_000, 200, 2000)],
  ["SMALL-A-photo-324k.jpg", () => tune(async (px) => photo(Math.round(px), Math.round(px * 0.75), 21, 18).toBuffer("image/jpeg", 85), 324_000, 300, 3000)],
  ["SMALL-B-photo-500k.jpg", () => tune(async (px) => photo(Math.round(px), Math.round(px * 0.75), 22, 18).toBuffer("image/jpeg", 85), 500_000, 300, 3500)],
  ["SMALL-C-photo-180k.jpg", () => tune(async (px) => photo(Math.round(px), Math.round(px * 0.75), 23, 18).toBuffer("image/jpeg", 85), 180_000, 200, 2500)],
];
for (const [name, make] of files) {
  const buf = await make();
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(name.padEnd(28), buf.length.toLocaleString("en-US"));
}
await browser.close();
