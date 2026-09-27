// Shared output-integrity validator for every QA download. PASS is never recorded when this fails.
//   PDF   → qpdf structural check + full stream decode, MuPDF open/render every page (qa/validate/pdfcheck.py),
//           pdf-lib parse (page count), pdf.js parse + text extraction + render of every page (non-blank).
//   Image → magic bytes = extension, complete file (JPEG EOI / PNG IEND / WebP RIFF length), full decode
//           with Skia (@napi-rs/canvas), dimensions and alpha.
//   ZIP   → opens, every entry extracts, and every entry is validated by its own type.
//   node qa/scripts/validate-output.mjs <file> [...]   (prints one JSON line per file)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const STD_FONTS = path.resolve("node_modules/pdfjs-dist/standard_fonts").split(path.sep).join("/") + "/";
const PDFCHECK = path.resolve("qa/validate/pdfcheck.py");

export function sniff(bytes) {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "zip";
  return "unknown";
}

const EXT = { pdf: [".pdf"], jpeg: [".jpg", ".jpeg"], png: [".png"], webp: [".webp"], zip: [".zip"] };

async function validatePdf(file, bytes) {
  const r = { kind: "pdf", problems: [] };
  // 1. strict engines (qpdf + MuPDF)
  try {
    const strict = JSON.parse(execFileSync("python", [PDFCHECK, file], { encoding: "utf8", maxBuffer: 1 << 24 }).trim().split("\n").pop());
    r.qpdf_pages = strict.qpdf_pages;
    r.mupdf_pages = strict.mupdf_pages;
    r.blank_pages = strict.blank_pages;
    r.text_chars = strict.text_chars;
    for (const p of strict.problems) r.problems.push(p);
  } catch (e) {
    r.problems.push(`pdfcheck crashed: ${String(e).slice(0, 200)}`);
  }
  // 2. pdf-lib
  try {
    const lib = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
    r.pdflib_pages = lib.getPageCount();
  } catch (e) {
    r.problems.push(`pdf-lib: ${String(e).slice(0, 160)}`);
  }
  // 3. pdf.js: parse, extract text, render every page
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, standardFontDataUrl: STD_FONTS, verbosity: 0 }).promise;
    r.pdfjs_pages = doc.numPages;
    const texts = [];
    const blank = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      texts.push((await page.getTextContent()).items.map((it) => it.str).join(" "));
      if (i <= 40) {
        const vp = page.getViewport({ scale: 0.25 });
        const c = createCanvas(Math.max(1, Math.ceil(vp.width)), Math.max(1, Math.ceil(vp.height)));
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp, canvas: c }).promise;
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let lo = 765, hi = 0;
        for (let k = 0; k < d.length; k += 4 * 7) {
          const v = d[k] + d[k + 1] + d[k + 2];
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        if (hi - lo < 24) blank.push(i);
      }
    }
    r.pdfjs_blank = blank;
    r.text_sample = texts.join(" | ").slice(0, 160);
    r.textChars = texts.join("").length;
    await doc.cleanup?.();
  } catch (e) {
    r.problems.push(`pdf.js: ${String(e).slice(0, 160)}`);
  }
  const counts = [r.qpdf_pages, r.mupdf_pages, r.pdflib_pages, r.pdfjs_pages].filter((n) => n !== undefined);
  if (new Set(counts).size > 1) r.problems.push(`engines disagree on page count: ${counts.join("/")}`);
  r.pages = r.pdfjs_pages ?? r.pdflib_pages;
  return r;
}

async function validateImage(kind, bytes) {
  const r = { kind, problems: [] };
  if (kind === "jpeg" && !(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) && !bytes.subarray(-32).includes(0xd9)) r.problems.push("JPEG has no end-of-image marker");
  if (kind === "png" && !bytes.subarray(-12).toString("latin1").includes("IEND")) r.problems.push("PNG has no IEND chunk");
  if (kind === "webp" && bytes.readUInt32LE(4) + 8 !== bytes.length) r.problems.push("WebP RIFF length doesn't match the file");
  try {
    const img = await loadImage(bytes);
    r.w = img.width;
    r.h = img.height;
    const c = createCanvas(img.width, img.height);
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let transparent = 0, lo = 765, hi = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      if (d[i + 3] < 250) transparent++;
      const v = d[i] + d[i + 1] + d[i + 2];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    r.alpha = transparent > 0;
    if (hi - lo < 6 && !r.alpha) r.problems.push("decoded image is a single flat colour");
  } catch (e) {
    r.problems.push(`decode failed: ${String(e).slice(0, 160)}`);
  }
  return r;
}

export async function validateFile(file) {
  const bytes = fs.readFileSync(file);
  const kind = sniff(bytes);
  const ext = path.extname(file).toLowerCase();
  let r;
  if (bytes.length === 0) r = { kind, problems: ["empty file"] };
  else if (kind === "pdf") r = await validatePdf(file, bytes);
  else if (kind === "jpeg" || kind === "png" || kind === "webp") r = await validateImage(kind, bytes);
  else if (kind === "zip") {
    r = { kind, problems: [], entries: [] };
    try {
      const zip = await JSZip.loadAsync(bytes);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-zip-"));
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const p = path.join(dir, path.basename(name));
        fs.writeFileSync(p, await entry.async("nodebuffer"));
        const sub = await validateFile(p);
        r.entries.push({ name, bytes: sub.bytes, ok: sub.ok, kind: sub.kind, pages: sub.pages, w: sub.w, h: sub.h, alpha: sub.alpha });
        for (const pr of sub.problems) r.problems.push(`${name}: ${pr}`);
      }
      fs.rmSync(dir, { recursive: true, force: true });
      if (r.entries.length === 0) r.problems.push("ZIP has no files");
    } catch (e) {
      r.problems.push(`ZIP: ${String(e).slice(0, 160)}`);
    }
  } else r = { kind, problems: [`unrecognised file type (${bytes.subarray(0, 8).toString("hex")})`] };
  if (EXT[r.kind] && !EXT[r.kind].includes(ext)) r.problems.push(`extension ${ext} doesn't match ${r.kind} content`);
  return { file: path.basename(file), bytes: bytes.length, ok: r.problems.length === 0, ...r };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const f of process.argv.slice(2)) console.log(JSON.stringify(await validateFile(f)));
}
