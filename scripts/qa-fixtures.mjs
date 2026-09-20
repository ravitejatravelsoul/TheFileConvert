// Deterministic QA fixture generator for the full product-acceptance pass.
//   node scripts/qa-fixtures.mjs        -> writes e2e/fixtures/qa/ (see e2e/fixtures/qa/README.md)
// Everything is derived from a seeded PRNG, so re-running produces identical files. Nothing here is
// a real user document. Large outputs (> ~1 MB) are git-ignored and regenerated on demand.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";

const OUT = path.resolve("e2e/fixtures/qa");
fs.mkdirSync(OUT, { recursive: true });
const write = (name, data) => { const p = path.join(OUT, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };

// ---- seeded PRNG (mulberry32)
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- image builders
function photo(w, h, seed = 1, { noise = 26, alpha = false } = {}) {
  const r = rng(seed); const c = createCanvas(w, h); const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, "#1d4e89"); grad.addColorStop(0.5, "#f2a541"); grad.addColorStop(1, "#7a2e2e");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) { g.fillStyle = `hsla(${Math.floor(r() * 360)},60%,${30 + r() * 40}%,0.55)`; g.beginPath(); g.arc(r() * w, r() * h, (0.03 + r() * 0.12) * Math.min(w, h), 0, Math.PI * 2); g.fill(); }
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * noise * 2; d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n)); }
  g.putImageData(img, 0, 0);
  if (alpha) { g.globalCompositeOperation = "destination-in"; g.fillStyle = "#000"; g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.45, h * 0.45, 0, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = "source-over"; }
  return c;
}
function logo(w, h, transparent = false) {
  const c = createCanvas(w, h); const g = c.getContext("2d");
  if (!transparent) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); }
  g.fillStyle = "#ea580c"; g.beginPath(); g.roundRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8, w * 0.1); g.fill();
  g.fillStyle = "#ffffff"; g.fillRect(w * 0.25, h * 0.3, w * 0.5, h * 0.12); g.fillRect(w * 0.25, h * 0.55, w * 0.35, h * 0.12);
  g.fillStyle = "#0f172a"; g.font = `bold ${Math.round(h * 0.12)}px sans-serif`; g.fillText("LOGO", w * 0.3, h * 0.88);
  return c;
}
function scanPage(label, seed) {
  // an A4-ish "scanned" page: paper texture + text lines rendered to pixels, JPEG-compressed
  const w = 1240, h = 1754; const r = rng(seed); const c = createCanvas(w, h); const g = c.getContext("2d");
  g.fillStyle = "#f3f0e8"; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h); for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 14; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; } g.putImageData(img, 0, 0);
  g.fillStyle = "#222"; g.font = "bold 64px serif"; g.fillText(label, 120, 200);
  g.font = "34px serif"; for (let i = 0; i < 30; i++) g.fillText(`Line ${i + 1}: The quick brown fox jumps over the lazy dog ${1000 + i * 7}.`, 120, 300 + i * 46);
  return c;
}

const lorem = (seed, n) => { const r = rng(seed); const W = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud exercitation ullamco laboris nisi aliquip commodo consequat".split(" "); return Array.from({ length: n }, () => W[Math.floor(r() * W.length)]).join(" "); };

async function textPdf(pages, { title, author, rotate = [] } = {}) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]); page.drawText(`Page ${p + 1} of ${pages}`, { x: 60, y: 730, size: 26, font: bold });
    let y = 690; const words = lorem(100 + p, 300).split(" ");
    for (let l = 0; l < 44; l++) { page.drawText(words.slice(l * 7, l * 7 + 7).join(" "), { x: 60, y, size: 11, font }); y -= 15; }
    if (rotate[p]) page.setRotation(degrees(rotate[p]));
  }
  if (title) { doc.setTitle(title); }
  if (author) doc.setAuthor(author);
  return doc;
}

const manifest = [];
const note = (file, what) => manifest.push([file, what]);

// ================= IMAGES =================
{
  const big = photo(4000, 3000, 11, { noise: 30 });
  write("img-photo-large.jpg", big.toBuffer("image/jpeg", 95)); note("img-photo-large.jpg", "4000x3000 noisy photo-like JPEG at q95 (several MB) — compression target");
  write("img-photo-highres.png", photo(3000, 2000, 12, { noise: 18 }).toBuffer("image/png")); note("img-photo-highres.png", "3000x2000 photographic PNG (large, lossless)");
  write("img-photo-noisy.jpg", photo(1600, 1200, 13, { noise: 60 }).toBuffer("image/jpeg", 92)); note("img-photo-noisy.jpg", "heavy-noise photo JPEG (hard to compress)");
  write("img-photo-small-optimized.jpg", photo(640, 480, 14, { noise: 4 }).toBuffer("image/jpeg", 60)); note("img-photo-small-optimized.jpg", "small, already q60 JPEG (little headroom)");
  write("img-photo-transparent.png", photo(1200, 900, 15, { noise: 10, alpha: true }).toBuffer("image/png")); note("img-photo-transparent.png", "PNG photo with an elliptical alpha cut-out (transparency test)");
  write("img-photo-opaque.png", photo(1200, 900, 16, { noise: 10 }).toBuffer("image/png")); note("img-photo-opaque.png", "opaque PNG photo");
  write("img-logo-flat.png", logo(800, 600).toBuffer("image/png")); note("img-logo-flat.png", "flat opaque logo graphic PNG");
  write("img-logo-transparent.png", logo(800, 600, true).toBuffer("image/png")); note("img-logo-transparent.png", "flat logo with transparent background PNG");
  write("img-photo.webp", photo(1600, 1200, 17, { noise: 20 }).toBuffer("image/webp", 85)); note("img-photo.webp", "WebP photo (opaque)");
  write("img-transparent.webp", photo(1200, 900, 18, { noise: 10, alpha: true }).toBuffer("image/webp", 90)); note("img-transparent.webp", "WebP photo with alpha");
  write("img-landscape.jpg", photo(1600, 900, 19, { noise: 12 }).toBuffer("image/jpeg", 88)); note("img-landscape.jpg", "1600x900 landscape JPEG");
  write("img-portrait.jpg", photo(900, 1600, 20, { noise: 12 }).toBuffer("image/jpeg", 88)); note("img-portrait.jpg", "900x1600 portrait JPEG");
  // orientation/pixel-exact test image: distinct colored quadrants + arrow so flips/rotations are checkable
  const q = createCanvas(400, 300); const g = q.getContext("2d");
  g.fillStyle = "#ff0000"; g.fillRect(0, 0, 200, 150); g.fillStyle = "#00ff00"; g.fillRect(200, 0, 200, 150); g.fillStyle = "#0000ff"; g.fillRect(0, 150, 200, 150); g.fillStyle = "#ffff00"; g.fillRect(200, 150, 200, 150);
  write("img-quadrants.png", q.toBuffer("image/png")); note("img-quadrants.png", "400x300: TL red, TR green, BL blue, BR yellow — exact pixel checks for rotate/flip/crop/resize");
  // JPEG with EXIF (camera make/model/software + date)
  const base = photo(800, 600, 21, { noise: 10 }).toBuffer("image/jpeg", 90);
  const ascii = (s) => Buffer.from(s + "\0", "latin1");
  const entries = [[0x010f, "QAcam Make"], [0x0110, "QAcam Model-9000"], [0x0131, "QASoftware 1.2"], [0x0132, "2026:01:02 03:04:05"]];
  const cnt = entries.length, ifdSize = 2 + cnt * 12 + 4; let off = 8 + ifdSize; const blobs = []; const ifd = Buffer.alloc(ifdSize); ifd.writeUInt16LE(cnt, 0);
  entries.forEach(([tag, s], i) => { const b = ascii(s); const o = 2 + i * 12; ifd.writeUInt16LE(tag, o); ifd.writeUInt16LE(2, o + 2); ifd.writeUInt32LE(b.length, o + 4); ifd.writeUInt32LE(off, o + 8); blobs.push(b); off += b.length; });
  const tiff = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), ifd, ...blobs]); const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255]), exif]);
  write("img-with-exif.jpg", Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)])); note("img-with-exif.jpg", "800x600 JPEG carrying EXIF strings QAcam Make / QAcam Model-9000 / QASoftware 1.2");
  write("img-vector.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="none"/><rect x="20" y="20" width="200" height="120" rx="16" fill="#ea580c"/><circle cx="340" cy="90" r="60" fill="#0ea5e9" fill-opacity="0.7"/><text x="30" y="230" font-family="sans-serif" font-size="40" fill="#111">SVG Test</text><path d="M20 290 Q240 200 460 290" stroke="#16a34a" stroke-width="8" fill="none"/></svg>`); note("img-vector.svg", "480x320 SVG with shapes, text, transparency");
  write("img-malicious.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" onload="alert(1)"><script>alert('xss')</script><rect width="200" height="100" fill="#f00"/><image href="http://example.invalid/x.png" width="10" height="10"/></svg>`); note("img-malicious.svg", "SVG with <script>, onload and an external image reference (must be neutralised)");
}

// ================= PDFs =================
{
  write("pdf-text-heavy.pdf", await (await textPdf(20, { title: "Text heavy" })).save()); note("pdf-text-heavy.pdf", "20 pages of real text, no images");
  write("pdf-multipage.pdf", await (await textPdf(6, { title: "Six pages" })).save()); note("pdf-multipage.pdf", "6 pages labelled 'Page N of 6' — page-order/extract/delete/split checks");
  write("pdf-rotations.pdf", await (await textPdf(4, { rotate: [0, 90, 180, 270] })).save()); note("pdf-rotations.pdf", "4 pages with /Rotate 0,90,180,270");
  write("pdf-metadata.pdf", await (async () => { const d = await textPdf(2); d.setTitle("QA Title"); d.setAuthor("QA Author"); d.setSubject("QA Subject"); d.setKeywords(["alpha", "beta"]); d.setCreator("QA Creator"); d.setProducer("QA Producer"); return d.save(); })()); note("pdf-metadata.pdf", "2 pages, known metadata: Title/Author/Subject/Keywords/Creator/Producer = QA …");
  write("pdf-watermarked.pdf", await (async () => { const d = await textPdf(2); const f = await d.embedFont(StandardFonts.HelveticaBold); for (const p of d.getPages()) p.drawText("CONFIDENTIAL", { x: 120, y: 300, size: 70, font: f, color: rgb(0.8, 0.1, 0.1), opacity: 0.25, rotate: degrees(40) }); return d.save(); })()); note("pdf-watermarked.pdf", "2 pages with a pre-applied diagonal CONFIDENTIAL watermark");
  write("pdf-optimized.pdf", await (await textPdf(3)).save({ useObjectStreams: true })); note("pdf-optimized.pdf", "3 text pages already saved with object streams (nothing left to squeeze)");
  // scanned / image-heavy: full-page JPEG scans
  const scanDoc = await PDFDocument.create();
  for (let i = 0; i < 4; i++) { const jpg = await scanDoc.embedJpg(scanPage(`SCANNED PAGE ${i + 1}`, 40 + i).toBuffer("image/jpeg", 88)); const p = scanDoc.addPage([595, 842]); p.drawImage(jpg, { x: 0, y: 0, width: 595, height: 842 }); }
  write("pdf-scanned.pdf", await scanDoc.save()); note("pdf-scanned.pdf", "4 full-page JPEG scans (image-only pages, no text layer)");
  // mixed: text + embedded photos
  const mixed = await textPdf(3); const mp = await mixed.embedJpg(photo(1800, 1200, 50, { noise: 28 }).toBuffer("image/jpeg", 92));
  for (const p of mixed.getPages()) p.drawImage(mp, { x: 60, y: 60, width: 480, height: 320 });
  write("pdf-mixed.pdf", await mixed.save()); note("pdf-mixed.pdf", "3 text pages each with a 1800x1200 embedded photo");
  // intentionally bloated: the same very large photo embedded 6× as separate objects, plus unused objects
  const bloat = await PDFDocument.create(); const raw = photo(3200, 2400, 60, { noise: 34 }).toBuffer("image/jpeg", 97);
  for (let i = 0; i < 6; i++) { const im = await bloat.embedJpg(raw); const p = bloat.addPage([612, 792]); p.drawImage(im, { x: 30, y: 200, width: 552, height: 414 }); p.drawText(`Bloated page ${i + 1}`, { x: 60, y: 700, size: 20 }); }
  write("pdf-bloated.pdf", await bloat.save()); note("pdf-bloated.pdf", "6 pages, each embedding an oversized q97 3200x2400 JPEG shown at ~552pt wide (heavily over-resolved)");
  // small fixtures for the regular e2e suite (committed)
  const dup = await PDFDocument.create(); const dupJpg = photo(900, 700, 70, { noise: 30 }).toBuffer("image/jpeg", 92);
  for (let i = 0; i < 4; i++) { const im = await dup.embedJpg(dupJpg); const p = dup.addPage([400, 300]); p.drawImage(im, { x: 10, y: 10, width: 380, height: 280 }); }
  write("pdf-dup-images.pdf", await dup.save()); note("pdf-dup-images.pdf", "4 pages each embedding the SAME 900x700 q92 JPEG as separate objects (duplicate-image merge, lossy recompression)");
  const smallScan = await PDFDocument.create();
  for (let i = 0; i < 2; i++) { const im = await smallScan.embedJpg(scanPage("SMALL SCAN " + (i + 1), 80 + i).toBuffer("image/jpeg", 90)); const p = smallScan.addPage([300, 424]); p.drawImage(im, { x: 0, y: 0, width: 300, height: 424 }); }
  write("pdf-scanned-small.pdf", await smallScan.save()); note("pdf-scanned-small.pdf", "2 image-only scanned pages (JPEG) — image-heavy compression case");
  write("pdf-corrupted.pdf", (await (await textPdf(2)).save()).subarray(0, 900)); note("pdf-corrupted.pdf", "truncated PDF (negative test)");
  write("pdf-not-a-pdf.pdf", Buffer.from("This is plain text with a .pdf extension.")); note("pdf-not-a-pdf.pdf", "text file renamed .pdf (negative test)");
  // form
  write("pdf-form.pdf", await (async () => { const d = await PDFDocument.create(); const p = d.addPage([612, 792]); const f = d.getForm(); const t = f.createTextField("full_name"); t.addToPage(p, { x: 60, y: 700, width: 240, height: 22 }); const cb = f.createCheckBox("agree"); cb.addToPage(p, { x: 60, y: 650, width: 18, height: 18 }); const dd = f.createDropdown("plan"); dd.addOptions(["free", "pro", "team"]); dd.addToPage(p, { x: 60, y: 600, width: 140, height: 22 }); return d.save(); })()); note("pdf-form.pdf", "AcroForm: text field full_name, checkbox agree, dropdown plan");
}

// ================= TEXT / DOCUMENT / DATA =================
write("doc-realistic.txt", ["Quarterly Report — Q3", "", "Prepared by: Ana Núñez & José Müller", "", "Summary", "Revenue grew 12% year over year; costs stayed flat. \"Customer delight\" scores rose to 4.6/5.", "", "Line with a <tag> & an ampersand.", "", ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}: ${lorem(200 + i, 40)}.`), "", "A very long unbroken line: " + "x".repeat(300), "", "Unicode: café, naïve, 日本語, Ελληνικά, ✓ — “quotes”"].join("\n")); note("doc-realistic.txt", "multi-paragraph TXT with unicode, angle brackets, ampersands, quotes, a 300-char line");
write("doc-realistic.md", `# Project Title\n\nIntro paragraph with **bold**, *italic*, \`inline code\` and a [link](https://example.com/page?x=1&y=2).\n\n## Features\n\n- First item\n- Second item with **bold**\n  - Nested item\n- Third item\n\n1. Ordered one\n2. Ordered two\n\n### Code\n\n\`\`\`js\nfunction add(a, b) {\n  return a + b; // <ok>\n}\n\`\`\`\n\n> A blockquote line.\n\n| Name | Qty |\n| ---- | --- |\n| Apple | 3 |\n| Pear | 5 |\n\nSpecial chars: < > & " ' and a <script>alert(1)</script> tag.\n`); note("doc-realistic.md", "Markdown: H1-H3, bold/italic/code/link, nested+ordered lists, fenced code, blockquote, table, raw <script>");
write("data-nested.json", JSON.stringify({ id: 7, name: "Ünïcode ✓", tags: ["a", "b"], nested: { deep: { list: [1, 2, { x: null }], flag: true } }, empty: {}, arr: [] })); note("data-nested.json", "minified nested JSON with unicode, null, empty containers");
write("data-malformed.json", '{"a": 1, "b": [1, 2,, ]'); note("data-malformed.json", "invalid JSON");
write("data-large.json", JSON.stringify(Array.from({ length: 3000 }, (_, i) => ({ id: i, name: `Item ${i}`, price: +(i * 1.25).toFixed(2), tags: ["x", "y"], meta: { ok: i % 2 === 0 } })))); note("data-large.json", "3000-record JSON array (~350 KB)");
write("data-realistic.csv", 'id,name,notes,amount\n1,"Smith, Jane","said ""hello""",10.50\n2,Ünal,"multi\nline note",\n3,"",,0\n4,Zoë,plain,-3\n'); note("data-realistic.csv", "CSV with quoted commas, doubled quotes, multiline cell, empty cells, unicode, negative number");
write("data-flat-records.json", JSON.stringify([{ id: 1, name: "Ann", note: 'has, comma and "quote"' }, { id: 2, name: "Bo" }, { id: 3, note: "line1\nline2", name: "Cy" }])); note("data-flat-records.json", "flat JSON records with missing fields, commas, quotes, newline");
write("data-realistic.xml", '<?xml version="1.0" encoding="UTF-8"?><catalog><book id="1"><title>Café &amp; Co</title><price currency="USD">9.99</price></book><book id="2"><title><![CDATA[Raw <b>text</b>]]></title><price currency="EUR">12.50</price></book><empty/></catalog>'); note("data-realistic.xml", "XML with attributes, entities, CDATA, empty element, unicode");
write("data-malformed.xml", "<a><b>text</a>"); note("data-malformed.xml", "mismatched-tag XML");
write("data-sample.b64", Buffer.from("Hello, wörld ✓\nSecond line 日本語").toString("base64")); note("data-sample.b64", "Base64 of a multiline unicode string");
write("data-urlencoded.txt", "q=caf%C3%A9%20au%20lait&x=1%2B1%3D2&path=%2Fa%2Fb%3Fc%3Dd%26e"); note("data-urlencoded.txt", "URL-encoded sample (unicode, reserved characters)");

// ================= ARCHIVE =================
{
  const z = new JSZip(); const bin = Buffer.alloc(4096); const r = rng(99); for (let i = 0; i < bin.length; i++) bin[i] = Math.floor(r() * 256);
  z.file("readme.txt", "top level readme\n"); z.file("docs/notes with spaces.txt", "spaces in a name\n"); z.file("docs/deep/er/ünï-cödé-日本語.txt", "unicode name\n"); z.file("data/blob.bin", bin); z.file("data/table.csv", "a,b\n1,2\n"); z.folder("empty-dir");
  write("zip-realistic.zip", await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })); note("zip-realistic.zip", "nested folders, spaces, unicode names, binary file (seeded bytes), an empty dir");
  write("zip-malformed.zip", Buffer.from("PK this is not a real zip archive at all")); note("zip-malformed.zip", "corrupt ZIP (negative test)");
  const evil = new JSZip(); evil.file("../../evil.txt", "traversal"); evil.file("/abs/evil2.txt", "absolute"); evil.file("ok/fine.txt", "fine");
  write("zip-traversal.zip", await evil.generateAsync({ type: "nodebuffer" })); note("zip-traversal.zip", "entries named ../../evil.txt and /abs/evil2.txt (path-traversal check)");
}

// README + gitignore for large generated files
const lines = ["# QA fixtures", "", "Generated deterministically by `node scripts/qa-fixtures.mjs` (seeded PRNG; no real user data).", "Files over ~1 MB are git-ignored and regenerated on demand.", "", "| File | Purpose |", "| --- | --- |", ...manifest.map(([f, w]) => `| \`${f}\` | ${w} |`), ""];
fs.writeFileSync(path.join(OUT, "README.md"), lines.join("\n"));
const big = manifest.map(([f]) => f).filter((f) => fs.statSync(path.join(OUT, f)).size > 1024 * 1024);
fs.writeFileSync(path.join(OUT, ".gitignore"), big.join("\n") + "\n");
console.log(`wrote ${manifest.length} fixtures to ${OUT}; ignoring ${big.length} large ones:`, big.join(", "));
