// Fixture set for the first-launch acceptance run.
//   node qa/scripts/fl-fixtures.mjs   ->  qa-fixtures/fresh/
// Deterministic (seeded PRNG); nothing here is a real document. The folder is git-ignored and regenerated on demand.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

const OUT = path.resolve("qa-fixtures/fresh");
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const write = (name, data, what) => {
  fs.writeFileSync(path.join(OUT, name), data);
  rows.push([name, fs.statSync(path.join(OUT, name)).size, what]);
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v) => Math.max(0, Math.min(255, v));

function photo(w, h, seed, { noise = 26, alpha = false } = {}) {
  const r = rng(seed);
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#1d4e89");
  grad.addColorStop(0.5, "#f2a541");
  grad.addColorStop(1, "#7a2e2e");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `hsla(${Math.floor(r() * 360)},60%,${30 + r() * 40}%,0.55)`;
    g.beginPath();
    g.arc(r() * w, r() * h, (0.02 + r() * 0.12) * Math.min(w, h), 0, Math.PI * 2);
    g.fill();
  }
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * noise * 2;
    d[i] = clamp(d[i] + n);
    d[i + 1] = clamp(d[i + 1] + n);
    d[i + 2] = clamp(d[i + 2] + n);
  }
  g.putImageData(img, 0, 0);
  if (alpha) {
    g.globalCompositeOperation = "destination-in";
    g.beginPath();
    g.ellipse(w / 2, h / 2, w * 0.45, h * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "source-over";
  }
  return c;
}

/** A scanned-looking page: paper tone, grain, slight skew, dense lines, a photo block. */
function scanPage(label, seed, { w, h, grain }) {
  const r = rng(seed);
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = "#f3f0e8";
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate((r() - 0.5) * 0.01);
  g.translate(-w / 2, -h / 2);
  g.fillStyle = "#222";
  g.font = `bold ${Math.round(w * 0.04)}px serif`;
  g.fillText(label, w * 0.08, h * 0.08);
  g.font = `${Math.round(w * 0.02)}px serif`;
  for (let i = 0; i < 44; i++) g.fillText(`Line ${i + 1}: The quick brown fox jumps over the lazy dog ${1000 + i * 7} — ref ${seed}-${i}.`, w * 0.08, h * 0.13 + i * (h * 0.0185));
  g.restore();
  g.drawImage(photo(Math.round(w * 0.3), Math.round(h * 0.16), seed + 500, { noise: 20 }), w * 0.6, h * 0.82);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * grain * 2;
    d[i] = clamp(d[i] + n);
    d[i + 1] = clamp(d[i + 1] + n);
    d[i + 2] = clamp(d[i + 2] + n);
  }
  g.putImageData(img, 0, 0);
  return c;
}

async function scanPdf(pages, { w, h, grain, q, seed }) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const jpg = await doc.embedJpg(scanPage(`SCANNED STATEMENT ${i + 1}`, seed + i, { w, h, grain }).toBuffer("image/jpeg", q));
    doc.addPage([612, 792]).drawImage(jpg, { x: 0, y: 0, width: 612, height: 792 });
  }
  return doc.save();
}

async function labelled(prefix, pages, { rotate = [] } = {}) {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`${prefix} — Page ${p + 1} of ${pages}`, { x: 60, y: 720, size: 26, font: bold });
    page.drawText(`Marker ${prefix}${p + 1}`, { x: 60, y: 680, size: 14, font });
    page.drawRectangle({ x: 60, y: 100, width: 492, height: 520, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 });
    page.drawText(String(p + 1), { x: 270, y: 330, size: 120, font: bold, color: rgb(0.8, 0.8, 0.8) });
    if (rotate[p]) page.setRotation(degrees(rotate[p]));
  }
  return doc.save();
}

// ---------------------------------------------------------------- PDFs
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Meeting notes, page ${p + 1}`, { x: 60, y: 720, size: 20, font });
    for (let l = 0; l < 30; l++) page.drawText(`Item ${l + 1}: review the quarterly figures and confirm the next steps with the team.`, { x: 60, y: 680 - l * 18, size: 11, font });
  }
  write("FL-PDF-01-small-text.pdf", await doc.save(), "2-page native-text PDF (small)");
}
write("FL-PDF-02-scan-4mb.pdf", await scanPdf(3, { w: 1700, h: 2200, grain: 16, q: 90, seed: 210 }), "3 JPEG scan pages (1700x2200) — ~4 MB class");
write("FL-PDF-03-scan-10mb.pdf", await scanPdf(3, { w: 2550, h: 3300, grain: 20, q: 91, seed: 310 }), "3 JPEG scan pages (2550x3300, 300 dpi) — ~10 MB class");
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 4; i++) {
    const jpg = await doc.embedJpg(photo(3000, 2000, 400 + i, { noise: 30 }).toBuffer("image/jpeg", 94));
    const page = doc.addPage([612, 792]);
    page.drawText(`Photo spread ${i + 1}`, { x: 60, y: 730, size: 22, font });
    page.drawImage(jpg, { x: 40, y: 260, width: 532, height: 355 });
  }
  write("FL-PDF-04-photo-heavy.pdf", await doc.save(), "4 pages, each a distinct 3000x2000 photo");
}
write("FL-PDF-05-multipage.pdf", await labelled("DOC", 12), "12 labelled pages ('DOC — Page N of 12', marker DOCn)");
write("FL-PDF-06-rotated.pdf", await labelled("ROT", 4, { rotate: [0, 90, 180, 270] }), "4 pages stored with /Rotate 0, 90, 180, 270");
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText("INVOICE", { x: 60, y: 720, size: 28, font: bold });
  const lines = [
    ["Billed to:", "Jordan Smith"],
    ["Invoice date:", "12/20/2026"],
    ["Service:", "Consultation"],
    ["Total due:", "$1,250.00"],
  ];
  lines.forEach(([k, v], i) => {
    page.drawText(k, { x: 60, y: 660 - i * 34, size: 14, font });
    page.drawText(v, { x: 200, y: 660 - i * 34, size: 14, font });
  });
  for (let l = 0; l < 12; l++) page.drawText(`Terms line ${l + 1}: payment is due within thirty days of the invoice date.`, { x: 60, y: 480 - l * 18, size: 11, font });
  write("FL-PDF-07-native-text.pdf", await doc.save(), "Native-text invoice: 'Jordan Smith', '12/20/2026', 'Consultation', '$1,250.00'");
}
for (const [name, face, what] of [
  ["FL-PDF-08-scanned-text.pdf", "Arial", "Image-only receipt scan set in Arial: 'Jordan Smith', '12/20/2026', 'Consultation' (no native text)"],
  ["FL-PDF-08b-scanned-condensed.pdf", "Bahnschrift SemiCondensed", "Hard case: the same receipt set in a condensed face (as many till receipts are)"],
]) {
  // A printed-then-scanned page: dark text on paper, grain, image-only.
  const w = 1700, h = 2200;
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = "#f4f1ea";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#1c1c1c";
  g.font = `bold 72px "${face}"`;
  g.fillText("SERVICE RECEIPT", 150, 250);
  g.font = `48px "${face}"`;
  const rows2 = [
    ["Name:", "Jordan Smith"],
    ["Date:", "12/20/2026"],
    ["Service:", "Consultation"],
    ["Amount:", "1250.00"],
  ];
  rows2.forEach(([k, v], i) => {
    g.fillText(k, 150, 420 + i * 110);
    g.fillText(v, 520, 420 + i * 110);
  });
  g.font = `36px "${face}"`;
  for (let l = 0; l < 10; l++) g.fillText(`Thank you for your visit. Reference number ${4410 + l * 3}.`, 150, 1000 + l * 70);
  const r = rng(808);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 16;
    img.data[i] = clamp(img.data[i] + n);
    img.data[i + 1] = clamp(img.data[i + 1] + n);
    img.data[i + 2] = clamp(img.data[i + 2] + n);
  }
  g.putImageData(img, 0, 0);
  const doc = await PDFDocument.create();
  const jpg = await doc.embedJpg(c.toBuffer("image/jpeg", 88));
  doc.addPage([612, 792]).drawImage(jpg, { x: 0, y: 0, width: 612, height: 792 });
  write(name, await doc.save(), what);
}
write("FL-PDF-09a-merge.pdf", await labelled("ALPHA", 3), "Merge set A: 3 pages");
write("FL-PDF-09b-merge.pdf", await labelled("BRAVO", 2), "Merge set B: 2 pages");
write("FL-PDF-09c-merge.pdf", await labelled("CHARLIE", 4), "Merge set C: 4 pages");

// ---------------------------------------------------------------- Images
write("FL-IMG-01-large.jpg", photo(4200, 3000, 501, { noise: 30 }).toBuffer("image/jpeg", 95), "4200x3000 photo JPEG q95 (large)");
write("FL-IMG-02-huge.jpg", photo(7000, 5000, 502, { noise: 36 }).toBuffer("image/jpeg", 97), "7000x5000 photo JPEG q97 (huge)");
write("FL-IMG-03-transparent.png", photo(2400, 1800, 503, { noise: 12, alpha: true }).toBuffer("image/png"), "2400x1800 PNG with elliptical transparency");
write("FL-IMG-04-photo.png", photo(2600, 1800, 504, { noise: 18 }).toBuffer("image/png"), "2600x1800 opaque photographic PNG");
write("FL-IMG-05-photo.webp", photo(2000, 1500, 505, { noise: 20 }).toBuffer("image/webp", 85), "2000x1500 WebP photo");
write(
  "FL-IMG-06-vector.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect x="10" y="10" width="130" height="80" rx="12" fill="#2456d6"/><circle cx="240" cy="60" r="44" fill="#ffd43b"/><path d="M10 170 Q160 110 310 170" stroke="#127a55" stroke-width="8" fill="none"/></svg>`,
  "320x200 SVG, transparent background"
);
write("FL-IMG-07-transparent.webp", photo(1600, 1200, 507, { noise: 10, alpha: true }).toBuffer("image/webp", 90), "1600x1200 WebP with transparency");
write("FL-IMG-08-portrait.jpg", photo(1200, 1800, 508, { noise: 14 }).toBuffer("image/jpeg", 88), "1200x1800 portrait JPEG");

fs.writeFileSync(
  path.join(OUT, "README.md"),
  "# First-launch fixtures\n\nGenerated by `node qa/scripts/fl-fixtures.mjs` (deterministic, seeded). Not real documents.\n\n| File | Bytes | What |\n|---|---:|---|\n" +
    rows.map(([n, b, w]) => `| ${n} | ${b.toLocaleString("en-US")} | ${w} |`).join("\n") +
    "\n"
);
for (const [n, b] of rows) console.log(n.padEnd(30), b.toLocaleString("en-US"));
