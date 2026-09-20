// Fresh deterministic fixture library for the from-scratch product audit.
//   node qa/scripts/make-fixtures.mjs   ->  qa-fixtures/   (documented in qa/fixtures/README.md)
// Seeded PRNG only; nothing here is a real user document. Files > 1 MB are git-ignored and regenerated on demand.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, rgb, degrees, PDFArray } from "pdf-lib";
import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";

const OUT = path.resolve("qa-fixtures");
fs.mkdirSync(OUT, { recursive: true });
const write = (name, data) => { fs.writeFileSync(path.join(OUT, name), data); return path.join(OUT, name); };
const manifest = [];
const note = (file, what) => manifest.push([file, what]);

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (v) => Math.max(0, Math.min(255, v));

function photo(w, h, seed = 1, { noise = 26, alpha = false } = {}) {
  const r = rng(seed); const c = createCanvas(w, h); const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, "#1d4e89"); grad.addColorStop(0.5, "#f2a541"); grad.addColorStop(1, "#7a2e2e");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) { g.fillStyle = `hsla(${Math.floor(r() * 360)},60%,${30 + r() * 40}%,0.55)`; g.beginPath(); g.arc(r() * w, r() * h, (0.02 + r() * 0.12) * Math.min(w, h), 0, Math.PI * 2); g.fill(); }
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * noise * 2; d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n); }
  g.putImageData(img, 0, 0);
  if (alpha) { g.globalCompositeOperation = "destination-in"; g.fillStyle = "#000"; g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.45, h * 0.45, 0, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = "source-over"; }
  return c;
}
function logo(w, h, transparent = false) {
  const c = createCanvas(w, h); const g = c.getContext("2d"); if (!transparent) { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); }
  g.fillStyle = "#ea580c"; g.beginPath(); g.roundRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8, w * 0.1); g.fill();
  g.fillStyle = "#fff"; g.fillRect(w * 0.25, h * 0.3, w * 0.5, h * 0.12); g.fillRect(w * 0.25, h * 0.55, w * 0.35, h * 0.12);
  g.fillStyle = "#0f172a"; g.font = `bold ${Math.round(h * 0.12)}px sans-serif`; g.fillText("LOGO", w * 0.3, h * 0.88); return c;
}
// A realistic "scanned page": paper grain, slightly skewed text lines, a photo block, stamp — at 200 dpi Letter (1700x2200).
function scanPage(label, seed, { w = 1700, h = 2200, grain = 12 } = {}) {
  const r = rng(seed); const c = createCanvas(w, h); const g = c.getContext("2d");
  g.fillStyle = "#f3f0e8"; g.fillRect(0, 0, w, h);
  g.save(); g.translate(w / 2, h / 2); g.rotate((r() - 0.5) * 0.01); g.translate(-w / 2, -h / 2);
  g.fillStyle = "#222"; g.font = `bold ${Math.round(w * 0.04)}px serif`; g.fillText(label, w * 0.08, h * 0.08);
  g.font = `${Math.round(w * 0.02)}px serif`; for (let i = 0; i < 44; i++) g.fillText(`Line ${i + 1}: The quick brown fox jumps over the lazy dog ${1000 + i * 7} — invoice ref ${seed}-${i}.`, w * 0.08, h * 0.13 + i * (h * 0.0185));
  g.restore();
  const p = photo(Math.round(w * 0.3), Math.round(h * 0.16), seed + 500, { noise: 20 }); g.drawImage(p, w * 0.6, h * 0.82);
  const img = g.getImageData(0, 0, w, h); const d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * grain * 2; d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + n); d[i + 2] = clamp(d[i + 2] + n); } g.putImageData(img, 0, 0);
  return c;
}
const lorem = (seed, n) => { const r = rng(seed); const W = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud exercitation ullamco laboris nisi aliquip commodo consequat".split(" "); return Array.from({ length: n }, () => W[Math.floor(r() * W.length)]).join(" "); };

// ASCII85 encode (as produced by ReportLab-style generators)
function ascii85(buf) { let out = ""; for (let i = 0; i < buf.length; i += 4) { const n = Math.min(4, buf.length - i); let v = 0; for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? buf[i + k] : 0); if (n === 4 && v === 0) { out += "z"; continue; } const c = []; for (let k = 4; k >= 0; k--) { c[k] = String.fromCharCode((v % 85) + 33); v = Math.floor(v / 85); } out += c.slice(0, n + 1).join(""); } return out + "~>"; }

async function addRawImagePage(doc, canvas, { encoding, pageW, pageH }) {
  const w = canvas.width, h = canvas.height; const rgba = canvas.getContext("2d").getImageData(0, 0, w, h).data; const rgb3 = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb3[j++] = rgba[i]; rgb3[j++] = rgba[i + 1]; rgb3[j++] = rgba[i + 2]; }
  const ctx = doc.context; const dict = ctx.obj({ Type: "XObject", Subtype: "Image", Width: w, Height: h, ColorSpace: "DeviceRGB", BitsPerComponent: 8 });
  let bytes;
  if (encoding === "flate") { bytes = zlib.deflateSync(rgb3, { level: 6 }); dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode")); }
  else if (encoding === "a85flate") { bytes = Buffer.from(ascii85(zlib.deflateSync(rgb3, { level: 6 })), "latin1"); dict.set(PDFName.of("Filter"), ctx.obj([PDFName.of("ASCII85Decode"), PDFName.of("FlateDecode")])); }
  else if (encoding === "flate-png-predictor") { // PNG "Up" predictor rows, Colors 3
    const rowLen = w * 3; const out = Buffer.alloc((rowLen + 1) * h); for (let y = 0; y < h; y++) { out[y * (rowLen + 1)] = 2; for (let x = 0; x < rowLen; x++) { const up = y ? rgb3[(y - 1) * rowLen + x] : 0; out[y * (rowLen + 1) + 1 + x] = (rgb3[y * rowLen + x] - up) & 255; } }
    bytes = zlib.deflateSync(out, { level: 6 }); dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode")); dict.set(PDFName.of("DecodeParms"), ctx.obj({ Predictor: 15, Colors: 3, BitsPerComponent: 8, Columns: w }));
  } else throw new Error("encoding " + encoding);
  dict.set(PDFName.of("Length"), PDFNumber.of(bytes.length));
  const ref = ctx.register(PDFRawStream.of(dict, bytes)); const page = doc.addPage([pageW, pageH]);
  const name = PDFName.of("Im" + doc.getPageCount()); const res = page.node.Resources() ?? ctx.obj({}); const xo = ctx.obj({}); xo.set(name, ref); res.set(PDFName.of("XObject"), xo); page.node.set(PDFName.of("Resources"), res);
  page.pushOperators(...[]); // ensure Contents exists
  page.node.addContentStream(ctx.register(ctx.stream(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im${doc.getPageCount()} Do Q`)));
}

// ================= PDFs =================
async function textDoc(pages, { rotate = [], title, author, compressContent = false } = {}) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]); page.drawText(`Page ${p + 1} of ${pages}`, { x: 60, y: 730, size: 22, font: bold });
    const words = lorem(1000 + p, 480).split(" "); let y = 700;
    for (let l = 0; l < 46; l++) { page.drawText(words.slice(l * 10, l * 10 + 10).join(" "), { x: 60, y, size: 10.5, font }); y -= 14.5; }
    if (rotate[p]) page.setRotation(degrees(rotate[p]));
  }
  if (title) doc.setTitle(title); if (author) doc.setAuthor(author);
  return doc;
}
{
  write("PDF-01-text-heavy.pdf", await (await textDoc(700, { title: "Text heavy" })).save()); note("PDF-01-text-heavy.pdf", "700 pages of real text (1.5 MB). Already Flate-compressed with object streams, so there is nothing left to squeeze losslessly");
  const jpgScan = await PDFDocument.create();
  for (let i = 0; i < 3; i++) { const jpg = await jpgScan.embedJpg(scanPage("SCAN PHOTO PAGE " + (i + 1), 10 + i, { grain: 16 }).toBuffer("image/jpeg", 92)); const p = jpgScan.addPage([612, 792]); p.drawImage(jpg, { x: 0, y: 0, width: 612, height: 792 }); }
  write("PDF-02-scan-photo.pdf", await jpgScan.save()); note("PDF-02-scan-photo.pdf", "3 full-page JPEG scans (1700x2200, q92) — image-heavy, JPEG-encoded");
  const bigScan = await PDFDocument.create();
  for (let i = 0; i < 4; i++) { const jpg = await bigScan.embedJpg(scanPage("LARGE SCAN " + (i + 1), 20 + i, { w: 2550, h: 3300, grain: 26 }).toBuffer("image/jpeg", 97)); const p = bigScan.addPage([612, 792]); p.drawImage(jpg, { x: 0, y: 0, width: 612, height: 792 }); }
  write("PDF-03-large-scan.pdf", await bigScan.save()); note("PDF-03-large-scan.pdf", "4 pages of 2550x3300 (300 dpi) JPEG scans at q97, heavy grain — 8–15 MB class");
  const mixed = await textDoc(6); const mj = await mixed.embedJpg(photo(2400, 1600, 30, { noise: 30 }).toBuffer("image/jpeg", 93));
  for (const p of mixed.getPages()) { p.drawImage(mj, { x: 60, y: 60, width: 480, height: 320 }); p.drawRectangle({ x: 60, y: 400, width: 200, height: 40, color: rgb(0.9, 0.4, 0.1) }); }
  write("PDF-04-mixed.pdf", await mixed.save()); note("PDF-04-mixed.pdf", "6 text pages, each with the SAME 2400x1600 photo (separate objects), vector graphics");
  const bloat = await PDFDocument.create(); const bloatJpg = photo(3600, 2400, 40, { noise: 34 }).toBuffer("image/jpeg", 97);
  for (let i = 0; i < 6; i++) { const im = await bloat.embedJpg(bloatJpg); const p = bloat.addPage([612, 792]); p.drawImage(im, { x: 30, y: 200, width: 552, height: 368 }); p.drawText(`Bloated page ${i + 1}`, { x: 60, y: 700, size: 20 }); }
  for (let i = 0; i < 300; i++) bloat.context.register(bloat.context.stream("unused object ".repeat(200)));
  write("PDF-05-bloated.pdf", await bloat.save()); note("PDF-05-bloated.pdf", "deliberately inefficient: same 3600x2400 q97 JPEG embedded 6x, 300 unreferenced objects, uncompressed streams");
  write("PDF-06-optimized.pdf", await (await textDoc(4)).save({ useObjectStreams: true })); note("PDF-06-optimized.pdf", "4 small text pages saved with object streams (little left to squeeze)");
  write("PDF-07-rotated.pdf", await (await textDoc(6, { rotate: [0, 90, 180, 270, 90, 0] })).save()); note("PDF-07-rotated.pdf", "6 pages with stored /Rotate 0,90,180,270,90,0");
  write("PDF-08-metadata.pdf", await (async () => { const d = await textDoc(3); d.setTitle("Audit Title"); d.setAuthor("Audit Author"); d.setSubject("Audit Subject"); d.setKeywords(["alpha", "beta"]); d.setCreator("Audit Creator"); d.setProducer("Audit Producer"); d.setCreationDate(new Date("2024-01-02T03:04:05Z")); d.setModificationDate(new Date("2024-02-03T04:05:06Z")); return d.save({ useObjectStreams: false }); })()); note("PDF-08-metadata.pdf", "3 pages, Info dictionary: Title/Author/Subject/Keywords/Creator/Producer/CreationDate/ModDate = Audit …");
  write("PDF-09-form.pdf", await (async () => { const d = await PDFDocument.create(); const p = d.addPage([612, 792]); const hf = await d.embedFont(StandardFonts.Helvetica); p.drawText("Registration form", { x: 60, y: 750, size: 20, font: hf }); for (const [t, y] of [["Full name", 725], ["I agree to the terms", 675], ["Plan", 625], ["Size (small / large)", 575]]) p.drawText(t, { x: 60, y, size: 10, font: hf }); const f = d.getForm(); f.createTextField("full_name").addToPage(p, { x: 60, y: 695, width: 240, height: 22 }); f.createCheckBox("agree").addToPage(p, { x: 60, y: 650, width: 18, height: 18 }); const dd = f.createDropdown("plan"); dd.addOptions(["free", "pro", "team"]); dd.addToPage(p, { x: 60, y: 600, width: 140, height: 22 }); const rg = f.createRadioGroup("size"); rg.addOptionToPage("small", p, { x: 60, y: 550, width: 16, height: 16 }); rg.addOptionToPage("large", p, { x: 120, y: 550, width: 16, height: 16 }); return d.save(); })()); note("PDF-09-form.pdf", "AcroForm: text full_name, checkbox agree, dropdown plan (free/pro/team), radio size (small/large)");
  write("PDF-10-many-pages.pdf", await (await textDoc(14)).save()); note("PDF-10-many-pages.pdf", "14 labelled pages 'Page N of 14'");
  write("PDF-11-corrupt.pdf", (await (await textDoc(3)).save()).subarray(0, 1200)); note("PDF-11-corrupt.pdf", "truncated PDF");
  const ocr = await PDFDocument.create(); for (let i = 0; i < 2; i++) { const jpg = await ocr.embedJpg(scanPage(["INVOICE INV-2024-0158", "PURCHASE ORDER PO-77120"][i], 50 + i, { grain: 8 }).toBuffer("image/jpeg", 90)); const p = ocr.addPage([612, 792]); p.drawImage(jpg, { x: 0, y: 0, width: 612, height: 792 }); }
  write("PDF-12-scanned-ocr.pdf", await ocr.save()); note("PDF-12-scanned-ocr.pdf", "2 image-only pages with printed lines for OCR");
  // Flate / ASCII85 image encodings — what real generators (ReportLab, PIL, etc.) actually emit
  for (const [enc, n] of [["flate", "PDF-13-scan-flate.pdf"], ["a85flate", "PDF-14-scan-ascii85-flate.pdf"], ["flate-png-predictor", "PDF-15-scan-flate-predictor.pdf"]]) {
    const d = await PDFDocument.create(); for (let i = 0; i < 2; i++) await addRawImagePage(d, scanPage("FLATE SCAN " + (i + 1), 60 + i, { w: 1700, h: 2200, grain: 14 }), { encoding: enc, pageW: 612, pageH: 792 });
    write(n, await d.save()); note(n, `2 full-page RGB scans (1700x2200) stored as ${enc === "a85flate" ? "[/ASCII85Decode /FlateDecode] (ReportLab style)" : enc === "flate" ? "raw /FlateDecode" : "/FlateDecode with PNG predictor 15"}`);
  }
}

// ================= IMAGES =================
{
  write("IMAGE-01-photo-large.jpg", photo(4200, 3000, 101, { noise: 30 }).toBuffer("image/jpeg", 96)); note("IMAGE-01-photo-large.jpg", "4200x3000 noisy photo-like JPEG q96 (3–6 MB class)");
  write("IMAGE-02-photo-huge.jpg", photo(7000, 5000, 102, { noise: 36 }).toBuffer("image/jpeg", 97)); note("IMAGE-02-photo-huge.jpg", "7000x5000 photo JPEG q97 (8–15 MB class)");
  write("IMAGE-03-photo.png", photo(2600, 1800, 103, { noise: 18 }).toBuffer("image/png")); note("IMAGE-03-photo.png", "2600x1800 photographic PNG (lossless, large)");
  write("IMAGE-04-transparent.png", photo(2400, 1800, 104, { noise: 12, alpha: true }).toBuffer("image/png")); note("IMAGE-04-transparent.png", "2400x1800 photo PNG with elliptical alpha cut-out");
  write("IMAGE-05-flat-logo.png", logo(1000, 700).toBuffer("image/png")); note("IMAGE-05-flat-logo.png", "flat opaque logo PNG");
  write("IMAGE-06-small-optimized.jpg", photo(800, 600, 106, { noise: 3 }).toBuffer("image/jpeg", 55)); note("IMAGE-06-small-optimized.jpg", "800x600 q55 JPEG — already optimized");
  write("IMAGE-07-photo.webp", photo(2000, 1500, 107, { noise: 20 }).toBuffer("image/webp", 85)); note("IMAGE-07-photo.webp", "2000x1500 WebP photo q85");
  write("IMAGE-08-vector.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect x="20" y="20" width="260" height="150" rx="18" fill="#ea580c"/><circle cx="470" cy="110" r="80" fill="#0ea5e9" fill-opacity="0.7"/><text x="30" y="290" font-family="sans-serif" font-size="52" fill="#111">Vector Test</text><path d="M20 380 Q320 260 620 380" stroke="#16a34a" stroke-width="10" fill="none"/></svg>`); note("IMAGE-08-vector.svg", "640x420 SVG with shapes, text, opacity, transparent background");
  write("IMAGE-09-malicious.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" onload="alert(1)"><script>alert('xss')</script><rect width="300" height="150" fill="#f00"/><image href="http://example.invalid/x.png" width="20" height="20"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`); note("IMAGE-09-malicious.svg", "SVG with <script>, onload, external image, foreignObject");
  const base = photo(1200, 800, 110, { noise: 10 }).toBuffer("image/jpeg", 90); const ascii = (s) => Buffer.from(s + "\0", "latin1");
  const entries = [[0x010f, "AuditCam Make"], [0x0110, "AuditCam Model-9000"], [0x0131, "AuditSoftware 1.2"], [0x0132, "2026:01:02 03:04:05"]];
  const cnt = entries.length, ifdSize = 2 + cnt * 12 + 4; let off = 8 + ifdSize; const blobs = []; const ifd = Buffer.alloc(ifdSize); ifd.writeUInt16LE(cnt, 0);
  entries.forEach(([tag, s], i) => { const b = ascii(s); const o = 2 + i * 12; ifd.writeUInt16LE(tag, o); ifd.writeUInt16LE(2, o + 2); ifd.writeUInt32LE(b.length, o + 4); ifd.writeUInt32LE(off, o + 8); blobs.push(b); off += b.length; });
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), ifd, ...blobs])]);
  write("IMAGE-10-exif.jpg", Buffer.concat([base.subarray(0, 2), Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]), base.subarray(2)])); note("IMAGE-10-exif.jpg", "1200x800 JPEG with EXIF Make/Model/Software/DateTime = AuditCam … / AuditSoftware / 2026:01:02");
  const q = createCanvas(400, 300); const g = q.getContext("2d"); g.fillStyle = "#f00"; g.fillRect(0, 0, 200, 150); g.fillStyle = "#0f0"; g.fillRect(200, 0, 200, 150); g.fillStyle = "#00f"; g.fillRect(0, 150, 200, 150); g.fillStyle = "#ff0"; g.fillRect(200, 150, 200, 150);
  write("IMAGE-11-quadrants.png", q.toBuffer("image/png")); note("IMAGE-11-quadrants.png", "400x300 TL red, TR green, BL blue, BR yellow — exact pixel checks for rotate/flip/crop/resize");
  write("IMAGE-12-portrait.jpg", photo(1000, 1600, 112, { noise: 12 }).toBuffer("image/jpeg", 88)); note("IMAGE-12-portrait.jpg", "1000x1600 portrait JPEG");
  write("IMAGE-13-landscape.jpg", photo(1800, 1000, 113, { noise: 12 }).toBuffer("image/jpeg", 88)); note("IMAGE-13-landscape.jpg", "1800x1000 landscape JPEG");
  write("IMAGE-14-transparent.webp", photo(1600, 1200, 114, { noise: 10, alpha: true }).toBuffer("image/webp", 90)); note("IMAGE-14-transparent.webp", "1600x1200 WebP with alpha");
}

// ================= TEXT / DOCS / DATA =================
{
  const para = (i) => `Section ${i}. ${lorem(200 + i, 80)}. Customers wrote “great service” and café-style feedback; totals: ${(i * 137.5).toFixed(2)} USD & €${(i * 12.25).toFixed(2)} — see <appendix ${i}>.`;
  write("DOC-01-large.txt", Array.from({ length: 2600 }, (_, i) => para(i + 1) + (i % 5 === 4 ? "\n" : "")).join("\n")); note("DOC-01-large.txt", "large realistic TXT (~1.5 MB): paragraphs with quotes, unicode punctuation, angle brackets, ampersands");
  write("DOC-02-markdown.md", `# Audit Document\n\nAn intro paragraph with **bold**, *italic*, ***both***, \`inline code\`, ~~strike~~ and a [link](https://example.com/a?b=1&c=2). Snake_case_identifier stays intact.\n\n## Lists\n\n- Item one\n- Item two with **bold**\n  - Nested A\n    - Nested deeper\n  - Nested B\n- Item three\n\n1. First\n2. Second\n3. Third\n   1. Third-one\n\n### Table\n\n| Name | Qty | Price |\n| :--- | ---: | :---: |\n| Apple | 3 | 1.20 |\n| Pear | 12 | 0.75 |\n\n### Code\n\n\`\`\`python\ndef add(a, b):\n    return a + b  # <adds>\n\`\`\`\n\n> A quoted line\n> continues here.\n\n---\n\nUnicode: café, naïve, 日本語, Ελληνικά, ✓, 😀. Raw HTML: <script>alert(1)</script> and a bad link [x](javascript:alert(1)).\n\nUnbroken: ${"x".repeat(220)}\n\nAn image reference: ![alt](https://example.com/i.png)\n`); note("DOC-02-markdown.md", "Markdown covering headings, emphasis, links, nested/numbered lists, aligned table, code, quote, hr, unicode, raw script, unsafe link, 220-char unbroken string");
  write("DATA-01-nested.json", JSON.stringify({ id: 7, name: "Ünïcode ✓ 日本語", tags: ["a", "b"], nested: { deep: { list: [1, 2.5, { x: null, y: true }] } }, empty: {}, arr: [], big: 12345678901234567890, esc: "line1\nline2\t\"q\"" }).replace("12345678901234567000", "12345678901234567890")); note("DATA-01-nested.json", "minified nested JSON: unicode, null, bool, empty containers, escapes");
  write("DATA-02-array-large.json", JSON.stringify(Array.from({ length: 6000 }, (_, i) => ({ id: i, name: `Item ${i}`, price: +(i * 1.25).toFixed(2), tags: ["x", "y"], meta: { ok: i % 2 === 0, note: i % 7 === 0 ? "multi\nline, \"quoted\"" : "" } })))); note("DATA-02-array-large.json", "6000-record JSON array (~700 KB)");
  write("DATA-03-malformed.json", '{"a": 1, "b": [1, 2,, ], "c": }'); note("DATA-03-malformed.json", "invalid JSON");
  write("DATA-04-quoted.csv", 'id,name,notes,amount\n1,"Smith, Jane","said ""hello""",10.50\n2,Ünal,"multi\nline note",\n3,"",,0\n4,Zoë,plain,-3\n5,"日本語","tab\there",1e3\n'); note("DATA-04-quoted.csv", "CSV: quoted commas, doubled quotes, quoted newlines, missing cells, unicode, tab");
  write("DATA-05-malformed.csv", 'a,b,c\n1,"unterminated,3\n4,5,6\n'); note("DATA-05-malformed.csv", "CSV with an unclosed quote");
  write("DATA-06-flat.json", JSON.stringify([{ id: 1, name: "Ann", note: 'has, comma and "quote"' }, { id: 2, name: "Bo" }, { id: 3, note: "line1\nline2", name: "Cy" }, { id: 4, name: "Di", nested: { a: 1 }, list: [1, 2] }])); note("DATA-06-flat.json", "records with missing fields, commas, quotes, newline, nested values");
  write("DATA-07-namespaces.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<!-- catalog -->\n<c:catalog xmlns:c="urn:example:catalog" xmlns:x="urn:example:extra"><c:book id="1" x:flag="yes"><c:title>Café &amp; Co</c:title><c:price currency="USD">9.99</c:price></c:book><c:book id="2"><c:title><![CDATA[Raw <b>text</b>]]></c:title><c:empty/></c:book></c:catalog>'); note("DATA-07-namespaces.xml", "XML with declaration, comment, namespaces, attributes, entities, CDATA, empty element");
  write("DATA-08-malformed.xml", "<a><b>text</a></b>"); note("DATA-08-malformed.xml", "mis-nested XML");
  write("DATA-09.b64", Buffer.from("Hello, wörld ✓\nSecond line 日本語\n").toString("base64")); note("DATA-09.b64", "Base64 of a multiline unicode string");
  write("DATA-10-urlencoded.txt", "q=caf%C3%A9%20au%20lait&x=1%2B1%3D2&path=%2Fa%2Fb%3Fc%3Dd%26e"); note("DATA-10-urlencoded.txt", "percent-encoded query string");
}

// ================= ARCHIVES =================
{
  const z = new JSZip(); const r = rng(77); const bin = Buffer.alloc(200000); for (let i = 0; i < bin.length; i++) bin[i] = Math.floor(r() * 256);
  z.file("readme.txt", "top level\n"); z.file("docs/notes with spaces.txt", "spaces\n"); z.file("docs/deep/er/ünï-cödé-日本語.txt", "unicode\n"); z.file("data/blob.bin", bin); z.file("data/table.csv", "a,b\n1,2\n"); z.file("images/logo.png", logo(200, 140).toBuffer("image/png")); z.file("images/photo.jpg", photo(600, 400, 78).toBuffer("image/jpeg", 85)); z.folder("empty-dir");
  write("ZIP-01-realistic.zip", await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })); note("ZIP-01-realistic.zip", "folders, nested folders, text, PNG/JPG, 200 KB random binary, spaces, unicode names, an empty dir");
  write("ZIP-02-malformed.zip", Buffer.from("PK not a real zip archive")); note("ZIP-02-malformed.zip", "corrupt ZIP");
  const evil = new JSZip(); evil.file("../../evil.txt", "traversal"); evil.file("/abs/evil2.txt", "absolute"); evil.file("ok/fine.txt", "fine");
  write("ZIP-03-traversal.zip", await evil.generateAsync({ type: "nodebuffer" })); note("ZIP-03-traversal.zip", "entries ../../evil.txt and /abs/evil2.txt");
}

const lines = ["# QA fixture library", "", "Generated by `node qa/scripts/make-fixtures.mjs` into `qa-fixtures/` (seeded, deterministic, no real user data). Files over ~1 MB are git-ignored and regenerated on demand.", "", "| File | Bytes | What it is for |", "| --- | ---: | --- |", ...manifest.map(([f, w]) => `| \`${f}\` | ${fs.statSync(path.join(OUT, f)).size.toLocaleString("en-US")} | ${w} |`), ""];
fs.mkdirSync("qa/fixtures", { recursive: true });
fs.writeFileSync("qa/fixtures/README.md", lines.join("\n"));
const big = manifest.map(([f]) => f).filter((f) => fs.statSync(path.join(OUT, f)).size > 1024 * 1024);
fs.writeFileSync(path.join(OUT, ".gitignore"), big.join("\n") + "\n");
console.log(`${manifest.length} fixtures; ${big.length} large ignored`);
