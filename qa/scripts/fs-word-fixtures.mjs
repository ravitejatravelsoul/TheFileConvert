// PDF → Word fixtures (PDF-WORD-01 … 14) with ground truth, into qa/fresh-scenario-fixtures/word/.
//   node qa/scripts/fs-word-fixtures.mjs
// Native PDFs are printed from HTML by Chromium ("Save as PDF": real embedded fonts and a proper text
// layer, including Unicode); scans are HTML rendered to an image; rotated/mixed/corrupt variants are
// derived with pdf-lib. Nothing here is a real document. Binaries are git-ignored; README + truth.json
// are committed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";
import { PDFDocument, degrees } from "pdf-lib";

const OUT = path.resolve("qa/fresh-scenario-fixtures/word");
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const truth = [];

const CSS = `
  @page { size: Letter; margin: 0.9in 0.85in; }
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.4; color: #111; }
  h1 { font-size: 24pt; margin: 0 0 10pt; } h2 { font-size: 16pt; margin: 16pt 0 6pt; } h3 { font-size: 13pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 9pt; } ul, ol { margin: 0 0 9pt; }
  table { border-collapse: collapse; margin: 8pt 0 12pt; } td, th { border: 1px solid #999; padding: 4pt 10pt; text-align: left; }
  .page { page-break-after: always; } .page:last-child { page-break-after: auto; }
`;
const LOREM = [
  "The regional office completed the quarterly review on schedule, and every site submitted its figures before the deadline.",
  "Customer response times improved after the new intake process, which routes each request to the right team on the first day.",
  "Supplier costs increased slightly because of freight surcharges, but renegotiated packaging contracts offset most of the change.",
  "The audit committee examined purchase approvals across all departments and found no exceptions that required further action.",
  "Next quarter the team will pilot the scheduling tool in two locations and report the results at the planning meeting.",
];

async function printHtml(body, file, { landscape = false } = {}) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`, { waitUntil: "load" });
  const pdf = await page.pdf({ format: "Letter", landscape, printBackground: true, preferCSSPageSize: false, margin: { top: "0.9in", bottom: "0.9in", left: "0.85in", right: "0.85in" } });
  fs.writeFileSync(path.join(OUT, file), pdf);
  return pdf;
}

/** Visible text of the rendered HTML, one entry per block (paragraph, heading, list item, table row). */
async function blocksOf() {
  return page.evaluate(() =>
    [...document.querySelectorAll("h1,h2,h3,p,li,tr")].map((e) => ({ tag: e.tagName.toLowerCase(), text: (e.innerText || "").replace(/\s+/g, " ").trim() })).filter((b) => b.text)
  );
}

function record(id, file, what, kind, extra = {}) {
  const bytes = fs.readFileSync(path.join(OUT, file));
  truth.push({ id, file, bytes: bytes.length, sha: crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12), what, kind, ...extra });
  console.log(`${id.padEnd(12)} ${file.padEnd(40)} ${bytes.length.toLocaleString("en-US").padStart(10)}  ${what}`);
}

const photo = (w, h, hue) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${hue + 60},70%,70%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.3}" cy="${h * 0.4}" r="${h * 0.25}" fill="rgba(255,255,255,.55)"/><rect x="${w * 0.55}" y="${h * 0.5}" width="${w * 0.3}" height="${h * 0.35}" fill="rgba(0,0,0,.25)"/></svg>`;
const pngOf = async (svg, w, h) => {
  const p2 = await browser.newPage({ viewport: { width: w, height: h } });
  await p2.setContent(`<body style="margin:0">${svg}</body>`);
  const buf = await p2.screenshot({ type: "png" });
  await p2.close();
  return buf;
};

// 01 simple text
{
  const html = `<h1>Meeting Notes</h1>${LOREM.slice(0, 3).map((t) => `<p>${t}</p>`).join("")}`;
  await printHtml(html, "PDF-WORD-01-simple-text.pdf");
  record("PDF-WORD-01", "PDF-WORD-01-simple-text.pdf", "One page: a title and three paragraphs", "native", { pages: 1, blocks: await blocksOf(), headings: ["Meeting Notes"] });
}
// 02 multi-page
{
  const html = [1, 2, 3, 4].map((n) => `<div class="page"><h2>Chapter ${n}</h2>${LOREM.map((t) => `<p>${t} (Chapter ${n}.)</p>`).join("")}</div>`).join("");
  await printHtml(html, "PDF-WORD-02-multipage.pdf");
  record("PDF-WORD-02", "PDF-WORD-02-multipage.pdf", "Four pages, one chapter per page", "native", { pages: 4, blocks: await blocksOf(), headings: ["Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"] });
}
// 03 headings + paragraphs
{
  const html = `<h1>Annual Report 2026</h1><p>${LOREM[0]}</p><h2>Operations</h2><p>${LOREM[1]}</p><h3>Staffing</h3><p>${LOREM[2]}</p><h2>Finance</h2><p>${LOREM[3]}</p><h3>Outlook</h3><p>${LOREM[4]}</p>`;
  await printHtml(html, "PDF-WORD-03-headings.pdf");
  record("PDF-WORD-03", "PDF-WORD-03-headings.pdf", "Heading levels 1–3 with paragraphs between", "native", {
    pages: 1,
    blocks: await blocksOf(),
    headings: ["Annual Report 2026", "Operations", "Staffing", "Finance", "Outlook"],
    headingLevels: { "Annual Report 2026": 1, Operations: 2, Staffing: 3, Finance: 2, Outlook: 3 },
  });
}
// 04 bold + italic
{
  const html = `<h2>Formatting</h2><p>This sentence has a <b>bold phrase</b> in the middle.</p><p>This one has an <i>italic phrase</i> instead.</p><p>And this one has <b><i>bold italic words</i></b> together.</p><p>Plain text ends the page.</p>`;
  await printHtml(html, "PDF-WORD-04-bold-italic.pdf");
  record("PDF-WORD-04", "PDF-WORD-04-bold-italic.pdf", "Bold, italic and bold-italic phrases inside paragraphs", "native", { pages: 1, blocks: await blocksOf(), bold: ["bold phrase", "bold italic words"], italic: ["italic phrase", "bold italic words"] });
}
// 05 lists
{
  const html = `<h2>Packing list</h2><ul><li>Passport and tickets</li><li>Phone charger</li><li>Rain jacket</li></ul><h2>Steps</h2><ol><li>Book the venue</li><li>Send the invitations</li><li>Order the food</li><li>Confirm the numbers</li></ol><p>That is everything for now.</p>`;
  await printHtml(html, "PDF-WORD-05-lists.pdf");
  record("PDF-WORD-05", "PDF-WORD-05-lists.pdf", "A bulleted list (3 items) and a numbered list (4 items)", "native", {
    pages: 1,
    blocks: await blocksOf(),
    bullets: ["Passport and tickets", "Phone charger", "Rain jacket"],
    numbered: ["Book the venue", "Send the invitations", "Order the food", "Confirm the numbers"],
  });
}
// 06 table
{
  const rows = [
    ["Item", "Quantity", "Price"],
    ["Notebooks", "12", "$36.00"],
    ["Pens", "40", "$18.50"],
    ["Folders", "8", "$9.60"],
    ["Total", "60", "$64.10"],
  ];
  const html = `<h2>Order summary</h2><p>The table below lists the items in this order.</p><table>${rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`).join("")}</table><p>Thank you for your order.</p>`;
  await printHtml(html, "PDF-WORD-06-table.pdf");
  record("PDF-WORD-06", "PDF-WORD-06-table.pdf", "A 3-column, 5-row bordered table between paragraphs", "native", { pages: 1, blocks: await blocksOf(), table: rows });
}
// 07 images + text
{
  const a = (await pngOf(photo(600, 360, 200), 600, 360)).toString("base64");
  const b = (await pngOf(photo(360, 480, 20), 360, 480)).toString("base64");
  const html = `<h2>Site visit</h2><p>${LOREM[0]}</p><img src="data:image/png;base64,${a}" style="width:4in;height:2.4in"><p>${LOREM[1]}</p><img src="data:image/png;base64,${b}" style="width:2in;height:2.667in"><p>${LOREM[2]}</p>`;
  await printHtml(html, "PDF-WORD-07-images.pdf");
  record("PDF-WORD-07", "PDF-WORD-07-images.pdf", "Text with two pictures between paragraphs (landscape 5:3 and portrait 3:4)", "native", { pages: 1, blocks: await blocksOf(), images: [{ aspect: 600 / 360 }, { aspect: 360 / 480 }] });
}
// 08 two columns
{
  const left = LOREM.map((t, i) => `<p>Left ${i + 1}: ${t}</p>`).join("");
  const right = LOREM.map((t, i) => `<p>Right ${i + 1}: ${t}</p>`).join("");
  const html = `<h1>Community Newsletter</h1><div style="column-count:2;column-gap:0.4in">${left}${right}</div>`;
  await printHtml(html, "PDF-WORD-08-two-column.pdf");
  record("PDF-WORD-08", "PDF-WORD-08-two-column.pdf", "Two-column newsletter: a full-width title, then left column then right column", "native", { pages: 1, blocks: await blocksOf() });
}
// 12 special characters
{
  const lines = [
    "English: The quick brown fox jumps over the lazy dog.",
    "Español: El niño comió jalapeños en la montaña; ¿qué pasó? ¡Olé!",
    "Currency: €120.50, £99.99, ¥2,000, $45.00 and ₹1,250",
    "Quotes: “double”, ‘single’ and an apostrophe’s curl — plus an en dash – too",
    "Symbols: • bullet, ✓ check, ✔ heavy check, © 2026, ® and ™",
    "Unicode: naïve café, Zürich, Ærøskøbing, Łódź, Ελληνικά, Русский",
  ];
  const html = `<h2>Special characters</h2>${lines.map((l) => `<p>${l}</p>`).join("")}`;
  await printHtml(html, "PDF-WORD-12-special-chars.pdf");
  record("PDF-WORD-12", "PDF-WORD-12-special-chars.pdf", "Accents, currency, smart quotes, bullets, check marks, Greek and Cyrillic", "native", { pages: 1, blocks: await blocksOf(), mustContain: ["niño", "jalapeños", "¿qué pasó?", "€120.50", "£99.99", "¥2,000", "₹1,250", "“double”", "‘single’", "—", "✓", "✔", "©", "™", "naïve", "Zürich", "Ærøskøbing", "Łódź", "Ελληνικά", "Русский"] });
}
// 13 large (24 pages)
{
  const html = Array.from({ length: 24 }, (_, n) => `<div class="page"><h2>Section ${n + 1}</h2>${LOREM.map((t, i) => `<p>${n + 1}.${i + 1} ${t}</p>`).join("")}<ul><li>Point A of section ${n + 1}</li><li>Point B of section ${n + 1}</li></ul></div>`).join("");
  await printHtml(html, "PDF-WORD-13-large-24-pages.pdf");
  record("PDF-WORD-13", "PDF-WORD-13-large-24-pages.pdf", "24 pages, a section per page with paragraphs and a list", "native", { pages: 24, blocks: await blocksOf() });
}
// 11 rotated page: copy 01's content into a doc whose second page is stored with /Rotate 90
{
  const src = await PDFDocument.load(fs.readFileSync(path.join(OUT, "PDF-WORD-03-headings.pdf")));
  const doc = await PDFDocument.create();
  const [p1, p2] = await doc.copyPages(src, [0, 0]);
  doc.addPage(p1);
  p2.setRotation(degrees(90));
  doc.addPage(p2);
  fs.writeFileSync(path.join(OUT, "PDF-WORD-11-rotated.pdf"), await doc.save());
  const t3 = truth.find((t) => t.id === "PDF-WORD-03");
  record("PDF-WORD-11", "PDF-WORD-11-rotated.pdf", "Two copies of PDF-WORD-03; page 2 stored with /Rotate 90 (sideways in viewers)", "native", { pages: 2, blocks: [...t3.blocks, ...t3.blocks] });
}
// 09 scanned: HTML rendered to a 200 dpi image, placed as the only content of the page
async function scanOf(html, file) {
  const p2 = await browser.newPage({ viewport: { width: 1700, height: 2200 } });
  await p2.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f6f4ee;font-family:Arial,sans-serif;color:#1a1a1a} .sheet{padding:170px 150px;font-size:34px;line-height:1.45} h1{font-size:62px;margin:0 0 30px} h2{font-size:44px;margin:40px 0 16px} p{margin:0 0 24px}</style></head><body><div class="sheet">${html}</div></body></html>`);
  const blocks = await p2.evaluate(() => [...document.querySelectorAll("h1,h2,p")].map((e) => ({ tag: e.tagName.toLowerCase(), text: e.innerText.replace(/\s+/g, " ").trim() })));
  const jpg = await p2.screenshot({ type: "jpeg", quality: 82 });
  await p2.close();
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpg);
  doc.addPage([612, 792]).drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  fs.writeFileSync(path.join(OUT, file), await doc.save());
  return blocks;
}
{
  const blocks = await scanOf(
    `<h1>Service Receipt</h1><p>Name: Jordan Smith</p><p>Date: 12/20/2026</p><p>Amount: $1,250.00</p><h2>Notes</h2><p>${LOREM[0]}</p><p>${LOREM[1]}</p>`,
    "PDF-WORD-09-scanned.pdf"
  );
  record("PDF-WORD-09", "PDF-WORD-09-scanned.pdf", "Image-only scan (200 dpi JPEG): receipt with name, date, amount and two paragraphs", "scanned", { pages: 1, blocks, mustContain: ["Jordan Smith", "12/20/2026", "$1,250.00"] });
}
// 10 mixed: native page, scanned page, native page
{
  const scanBlocks = await scanOf(`<h2>Scanned Appendix</h2><p>Reference number 48213 was approved on 03/14/2026.</p><p>${LOREM[3]}</p>`, "_scan-part.pdf");
  const native = await PDFDocument.load(fs.readFileSync(path.join(OUT, "PDF-WORD-02-multipage.pdf")));
  const scan = await PDFDocument.load(fs.readFileSync(path.join(OUT, "_scan-part.pdf")));
  const doc = await PDFDocument.create();
  const [n1] = await doc.copyPages(native, [0]);
  const [s1] = await doc.copyPages(scan, [0]);
  const [n2] = await doc.copyPages(native, [1]);
  doc.addPage(n1);
  doc.addPage(s1);
  doc.addPage(n2);
  fs.writeFileSync(path.join(OUT, "PDF-WORD-10-mixed.pdf"), await doc.save());
  fs.rmSync(path.join(OUT, "_scan-part.pdf"));
  const t2 = truth.find((t) => t.id === "PDF-WORD-02").blocks;
  const ch = (n) => t2.filter((b) => b.text.includes(`Chapter ${n}`));
  record("PDF-WORD-10", "PDF-WORD-10-mixed.pdf", "3 pages: native (Chapter 1), scanned appendix, native (Chapter 2)", "mixed", { pages: 3, blocks: [...ch(1), ...scanBlocks, ...ch(2)], scannedPages: [2], mustContain: ["48213", "03/14/2026", "Chapter 1", "Chapter 2"] });
}
// 14 corrupt
{
  const b = fs.readFileSync(path.join(OUT, "PDF-WORD-03-headings.pdf"));
  fs.writeFileSync(path.join(OUT, "PDF-WORD-14-corrupt.pdf"), Buffer.concat([b.subarray(0, Math.floor(b.length * 0.35)), Buffer.from("\n%% truncated garbage \x00\x01\x02")]));
  record("PDF-WORD-14", "PDF-WORD-14-corrupt.pdf", "First 35% of PDF-WORD-03 then garbage — must be refused", "corrupt", { pages: 0 });
}

await browser.close();
truth.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, "truth.json"), JSON.stringify(truth, null, 1));
fs.writeFileSync(
  path.join(OUT, "README.md"),
  [
    "# PDF → Word fixtures",
    "",
    "Generated by `node qa/scripts/fs-word-fixtures.mjs`. Native PDFs are printed from HTML by Chromium (real embedded fonts and text layer); scans are rendered HTML placed as a JPEG; rotated, mixed and corrupt files are derived with pdf-lib. **None of these are real documents.** Ground truth (every heading, paragraph, list item and table row) is in `truth.json`. The real user scan `TheFileConvert_Scanned_OCR_Test.pdf` is used in place from Downloads.",
    "",
    "| ID | File | Bytes | Kind | What |",
    "|---|---|---:|---|---|",
    ...truth.map((t) => `| ${t.id} | ${t.file} | ${t.bytes.toLocaleString("en-US")} | ${t.kind} | ${t.what} |`),
    "",
  ].join("\n")
);
