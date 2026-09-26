// Shared helpers for the first-launch real-browser acceptance scripts (fl-*.mjs).
// Outputs are downloaded through the real UI, saved under qa/evidence/fresh/out, then reopened independently here.
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

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
/** verdict: PASS | LIMITED | FAIL */
export function rec(tool, test, verdict, detail = {}) {
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
  return file;
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
