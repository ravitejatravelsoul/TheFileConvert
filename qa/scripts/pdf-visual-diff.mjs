// Independent check of compressed PDFs: render every page of input and output with pdfjs (Node canvas),
// compare pixel-wise (PSNR + mean abs diff on a 1/2-scale render) and compare extracted text.
//   node qa/scripts/pdf-visual-diff.mjs [results.json]  -> qa/evidence/compress-quality.json
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const results = JSON.parse(fs.readFileSync(process.argv[2] ?? "qa/evidence/compress-results.json", "utf8"));
const fixtureDir = path.resolve("qa-fixtures");
const inputPath = (r) => (r.fixture.startsWith("PDF-") ? path.join(fixtureDir, r.fixture) : path.resolve(process.env.EXTRA_DIR ?? "C:/Users/ravit/Downloads", r.fixture));
const cache = new Map();

async function open(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  return pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
}
async function render(doc, n, scale) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas: c }).promise;
  return { c, data: ctx.getImageData(0, 0, c.width, c.height).data };
}
async function text(doc, n) {
  const t = await (await doc.getPage(n)).getTextContent();
  return t.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
}
function psnr(a, b) {
  if (a.length !== b.length) return null;
  let se = 0, abs = 0;
  for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { const d = a[i + k] - b[i + k]; se += d * d; abs += Math.abs(d); }
  const n = (a.length / 4) * 3; const mse = se / n;
  return { psnr: mse === 0 ? 99 : +(10 * Math.log10(255 * 255 / mse)).toFixed(2), mad: +(abs / n).toFixed(3) };
}
const out = [];
for (const r of results) {
  if (!r.file) { out.push({ ...r }); continue; }
  const key = r.fixture; const scale = 0.75; const maxPages = 6;
  try {
    const din = cache.get(key) ?? (cache.set(key, await open(inputPath(r))), cache.get(key));
    const dout = await open(r.file);
    const pages = Math.min(din.numPages, maxPages);
    let worst = 100, sumMad = 0, textMatch = 0;
    for (let p = 1; p <= pages; p++) {
      const a = await render(din, p, scale), b = await render(dout, p, scale);
      const m = psnr(a.data, b.data); if (m) { worst = Math.min(worst, m.psnr); sumMad += m.mad; }
      if ((await text(din, p)) === (await text(dout, p))) textMatch++;
    }
    out.push({ fixture: r.fixture, mode: r.mode, input: r.input, output: r.output, pagesIn: din.numPages, pagesOut: dout.numPages, pagesChecked: pages, worstPsnr: worst, meanAbsDiff: +(sumMad / pages).toFixed(3), textIdenticalPages: `${textMatch}/${pages}` });
  } catch (e) { out.push({ fixture: r.fixture, mode: r.mode, error: String(e).slice(0, 160) }); }
  console.log(JSON.stringify(out[out.length - 1]));
}
fs.writeFileSync("qa/evidence/compress-quality.json", JSON.stringify(out, null, 1));
