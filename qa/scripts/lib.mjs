// Shared helpers for the real-browser acceptance scripts.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export const BASE = process.env.BASE ?? "http://localhost:3000";
export const FIX = path.resolve("qa-fixtures");
export const OUT = path.resolve("qa/evidence/out");
fs.mkdirSync(OUT, { recursive: true });
export const fx = (n) => path.join(FIX, n);

export const records = [];
export function rec(tool, test, verdict, detail = "") {
  records.push({ tool, test, verdict, detail });
  console.log(`${verdict.padEnd(7)} ${tool} :: ${test}${detail ? " — " + detail : ""}`);
}
export function save(name) { fs.writeFileSync(`qa/evidence/${name}.json`, JSON.stringify(records, null, 1)); }

export async function launch(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  return { browser, ctx, page, errors };
}

export async function open(page, route, files = []) {
  await page.goto(BASE + route);
  if (files.length) await page.locator('input[type="file"]').first().setInputFiles(files.map((f) => (path.isAbsolute(f) ? f : fx(f))));
}

export async function setRange(page, labelText, value) {
  const input = page.locator(`label:has-text("${labelText}") input[type=range]`).first();
  await input.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, value);
}

/** Clicks the action button, waits for Done or Try again; returns {ok, text}. */
export async function runAction(page, buttonName, timeout = 120_000) {
  await page.getByRole("button", { name: buttonName }).click();
  await Promise.race([page.getByText("Done!").waitFor({ timeout }), page.getByRole("button", { name: "Try again" }).waitFor({ timeout })]);
  const ok = (await page.getByText("Done!").count()) > 0;
  return { ok, text: ok ? "" : (await page.locator("main [role=alert]").last().innerText().catch(() => "")) };
}

/** Downloads the result; returns list of {name, path}. ZIP results are extracted. */
export async function download(page, tag) {
  const dir = path.join(OUT, tag); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const zipBtn = page.getByRole("button", { name: /Download all as ZIP/ });
  const single = page.getByRole("button", { name: "Download", exact: true });
  const [dl] = await Promise.all([page.waitForEvent("download"), (await zipBtn.count() ? zipBtn : single).first().click()]);
  const dest = path.join(dir, dl.suggestedFilename()); await dl.saveAs(dest);
  const files = [];
  if (/\.zip$/i.test(dest) && (await zipBtn.count())) {
    const zip = await JSZip.loadAsync(fs.readFileSync(dest));
    for (const [n, e] of Object.entries(zip.files)) { if (e.dir) continue; const p = path.join(dir, path.basename(n)); fs.writeFileSync(p, await e.async("nodebuffer")); files.push({ name: n, path: p }); }
  } else files.push({ name: dl.suggestedFilename(), path: dest });
  return files;
}

export async function pdfTexts(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); const t = await p.getTextContent(); out.push({ text: t.items.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim(), w: p.view[2] - p.view[0], h: p.view[3] - p.view[1], rotate: p.rotate }); }
  return out;
}
export async function pdfPixels(file, pageNo = 1, scale = 1) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo); const vp = page.getViewport({ scale });
  const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp, canvas: c }).promise;
  return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data, canvas: c };
}
export const pxAt = (img, x, y) => { const i = (Math.floor(y) * img.w + Math.floor(x)) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2], img.d[i + 3]]; };
export const near = (a, b, t = 40) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= t);
export const pdfLibLoad = async (f) => PDFDocument.load(fs.readFileSync(f), { updateMetadata: false });
export async function imageInfo(file) { const img = await loadImage(fs.readFileSync(file)); const c = createCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0); return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data, c }; }
export const pageLabel = (s) => (s.match(/Page (\d+) of (\d+)/) ?? []).slice(1).join("/");
export { fs, path, JSZip, PDFDocument, createCanvas, loadImage };
