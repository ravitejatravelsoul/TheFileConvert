// Shared helpers for the first-launch real-browser acceptance scripts (fl-*.mjs).
// Outputs are downloaded through the real UI, saved under qa/evidence/fresh/out, then reopened independently here.
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { validateFile } from "./validate-output.mjs";

export const BASE = process.env.BASE ?? "http://localhost:3000";
export const FIX = path.resolve("qa-fixtures/fresh");
export const EVIDENCE = path.resolve("qa/evidence/fresh");
export const OUT = path.join(EVIDENCE, "out");
export const SHOTS = path.resolve("qa/review/fresh-launch");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
export const fx = (n) => path.join(FIX, n);
const STD_FONTS = path.resolve("node_modules/pdfjs-dist/standard_fonts").split(path.sep).join("/") + "/";

export const records = [];
/** Integrity results of every download since the last rec() — the gate below consumes them. */
let pendingOutputs = [];
/** verdict: PASS | LIMITED | FAIL. Every file downloaded for this scenario has already been through the
 * shared output validator; if any failed, the scenario is FAIL whatever the caller decided. */
export function rec(tool, test, verdict, detail = {}) {
  const outputs = pendingOutputs;
  pendingOutputs = [];
  if (outputs.length) {
    detail = { ...detail, integrity: outputs.map((o) => ({ file: o.file, bytes: o.bytes, ok: o.ok, kind: o.kind, pages: o.pages, w: o.w, h: o.h, alpha: o.alpha, entries: o.entries?.length, problems: o.problems.length ? o.problems.slice(0, 4) : undefined })) };
    if (outputs.some((o) => !o.ok) && verdict !== "FAIL") {
      detail.gate = `output failed integrity validation (was ${verdict})`;
      verdict = "FAIL";
    }
  }
  records.push({ tool, test, verdict, ...detail });
  const d = Object.entries(detail)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" ");
  console.log(`${verdict.padEnd(7)} ${tool} :: ${test}${d ? " — " + d : ""}`);
}
export function save(name) {
  fs.writeFileSync(path.join(EVIDENCE, `${name}.json`), JSON.stringify(records, null, 1));
}

export async function launch({ mobile = false } = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    acceptDownloads: true,
    ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  return { browser, ctx, page, errors };
}

export async function open(page, route) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
}

/** Adds files through the tool's own file input (the same element the visible "Choose" button opens). */
export async function addFiles(page, names) {
  await page.getByTestId("file-input").first().setInputFiles(names.map(fx));
}

/** Clicks a button that starts a download and saves the file under OUT/<tag>-<suggested name>. */
export async function download(page, locator, tag) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), locator.click()]);
  const file = path.join(OUT, `${tag}-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  pendingOutputs.push(await validateFile(file));
  return file;
}

/** For outputs produced some other way (e.g. a file extracted from a ZIP the script already checked). */
export async function validateOutput(file) {
  const r = await validateFile(file);
  pendingOutputs.push(r);
  return r;
}

export const size = (f) => fs.statSync(f).size;

export async function pdfInfo(file) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const lib = await PDFDocument.load(bytes, { updateMetadata: false });
  const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, standardFontDataUrl: STD_FONTS }).promise;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    texts.push(tc.items.map((it) => it.str).join(" "));
  }
  return { pages: lib.getPageCount(), rotations: lib.getPages().map((p) => p.getRotation().angle), texts, doc };
}

/** Renders a PDF page to RGBA pixels (node-side, independent of the app). */
export async function renderPage(doc, pageNo = 1, scale = 1) {
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp, canvas: c }).promise;
  return { w: c.width, h: c.height, c, d: c.getContext("2d").getImageData(0, 0, c.width, c.height).data };
}

export async function imageInfo(file) {
  const img = await loadImage(fs.readFileSync(file));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  let transparent = 0;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) transparent++;
  const head = fs.readFileSync(file).subarray(0, 12);
  const format = head[0] === 0xff && head[1] === 0xd8 ? "jpeg" : head[0] === 0x89 && head[1] === 0x50 ? "png" : head.subarray(8, 12).toString() === "WEBP" ? "webp" : "unknown";
  return { w: img.width, h: img.height, format, hasAlpha: transparent > 0, d };
}

export async function zipEntries(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const out = [];
  for (const [name, entry] of Object.entries(zip.files)) if (!entry.dir) out.push({ name, bytes: await entry.async("uint8array") });
  return out;
}

export async function shot(page, name, { full = false } = {}) {
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: full });
}

export { fs, path, PDFDocument, createCanvas, loadImage };

// ------------------------------------------------------------------ fresh scenario library helpers
export const SFIX = path.resolve("qa/fresh-scenario-fixtures");
export const sx = (n) => path.join(SFIX, n);
export const REAL_SCAN = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf"; // the only permitted Downloads file

/** Adds files by absolute path through the tool's own file input. */
export async function addPaths(page, paths) {
  await page.getByTestId("file-input").first().setInputFiles(paths);
}

/** Composites RGBA over white and returns grey + RGB planes. */
function planes(d, n) {
  const rgbA = new Float64Array(n * 3);
  const grey = new Float64Array(n);
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const a = d[i + 3] / 255;
    const r = d[i] * a + 255 * (1 - a), g = d[i + 1] * a + 255 * (1 - a), b = d[i + 2] * a + 255 * (1 - a);
    rgbA[p * 3] = r;
    rgbA[p * 3 + 1] = g;
    rgbA[p * 3 + 2] = b;
    grey[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { rgbA, grey };
}

/** PSNR (dB, RGB) and mean SSIM (8×8 windows, grey) between two same-size RGBA buffers. */
export function similarity(a, b, w, h) {
  const n = w * h;
  const A = planes(a, n), B = planes(b, n);
  let se = 0;
  for (let i = 0; i < n * 3; i++) se += (A.rgbA[i] - B.rgbA[i]) ** 2;
  const mse = se / (n * 3);
  const psnr = mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let total = 0, windows = 0;
  for (let y = 0; y + 8 <= h; y += 8)
    for (let x = 0; x + 8 <= w; x += 8) {
      let ma = 0, mb = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        ma += A.grey[(y + j) * w + x + i];
        mb += B.grey[(y + j) * w + x + i];
      }
      ma /= 64;
      mb /= 64;
      let va = 0, vb = 0, cov = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const da = A.grey[(y + j) * w + x + i] - ma, db = B.grey[(y + j) * w + x + i] - mb;
        va += da * da;
        vb += db * db;
        cov += da * db;
      }
      va /= 63;
      vb /= 63;
      cov /= 63;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      windows++;
    }
  return { psnr: +psnr.toFixed(2), ssim: +(total / Math.max(1, windows)).toFixed(4) };
}

/** Compares an output image with its source (resized to the output's size first). */
export async function imageSimilarity(srcFile, outFile) {
  const [s, o] = [await loadImage(fs.readFileSync(srcFile)), await loadImage(fs.readFileSync(outFile))];
  const w = Math.min(o.width, 1600), h = Math.round((o.height * w) / o.width);
  const draw = (img) => {
    const c = createCanvas(w, h);
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.getContext("2d").getImageData(0, 0, w, h).data;
  };
  return similarity(draw(s), draw(o), w, h);
}

/** Compares page `pageNo` of two PDFs rendered at the same scale. */
export async function pdfPageSimilarity(srcFile, outFile, pageNo = 1, scale = 0.75) {
  const a = await renderPage((await pdfInfo(srcFile)).doc, pageNo, scale);
  const b = await renderPage((await pdfInfo(outFile)).doc, pageNo, scale);
  if (a.w !== b.w || a.h !== b.h) return { psnr: null, ssim: null, note: `size ${a.w}x${a.h} vs ${b.w}x${b.h}` };
  return similarity(a.d, b.d, a.w, a.h);
}
