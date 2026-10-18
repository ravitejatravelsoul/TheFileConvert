// Builds the PDF Editor's synthetic fixture library: qa/editor-fixtures/EDITOR-01 … 20 (all fake content, no PII).
//
//   LIBREOFFICE=…/soffice.exe node qa/scripts/editor-fixtures.mjs
//
// Producers are varied on purpose, because a content-stream editor meets whatever the user's PDF came from:
//   Chromium/Skia (Type 3-free, Identity-H subset TrueType), LibreOffice (simple-font TrueType subsets),
//   MuPDF (base-14 and embedded), pdf-lib (standard fonts) — plus public-domain government PDFs in public/.
// Every text fixture carries deliberate spelling mistakes (teh, recieve, seperate, occured, definately, wich, adress)
// the real-user matrix corrects through the UI. The manifest lists them.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("qa/editor-fixtures");
fs.mkdirSync(OUT, { recursive: true });
const manifest = {};
const note = (file, producer, what, targets = []) => (manifest[file] = { producer, what, targets });

const css = `
  @page { size: Letter; margin: 0.8in 0.9in; }
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #1d1d1b; margin: 0; }
  h1 { font-size: 24pt; margin: 0 0 6pt; } h2 { font-size: 15pt; margin: 14pt 0 4pt; } h3 { font-size: 12pt; margin: 10pt 0 2pt; }
  p { margin: 0 0 8pt; } table { border-collapse: collapse; width: 100%; } td, th { border: 1px solid #888; padding: 4pt 6pt; text-align: left; }
  th { background: #e8edf5; } .small { font-size: 8.5pt; color: #555; } .right { text-align: right; } .center { text-align: center; }
`;

async function chromePdf(browser, name, html, opts = {}) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}${opts.css ?? ""}</style></head><body>${html}</body></html>`);
  await page.pdf({ path: path.join(OUT, name), format: opts.format ?? "Letter", printBackground: true, preferCSSPageSize: !opts.format, displayHeaderFooter: Boolean(opts.header), headerTemplate: opts.header ?? "", footerTemplate: opts.footer ?? "", margin: opts.margin });
  await page.close();
}

const LOREM = [
  "The committee will recieve the final report before the end of the quarter, and teh chair has asked every member to review it carefully.",
  "A seperate budget was prepared for the northern office, wich had occured as a late addition to the plan.",
  "We definately expect the new process to reduce waiting times, although the exact figures are still being checked.",
  "Please send your adress and a phone number so that the team can confirm the appointment as soon as possible.",
];

// A tiny 1×1-colour PNG/JPEG builder is not needed: pymupdf draws the images; Chromium gets generated SVG-free data URIs.
const png = (w, h, rgb) => {
  // Solid-colour PNG via the browser canvas is simpler, but the generator runs in Node: build a raw PNG.
  const zlib = require("node:zlib");
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const shade = Math.round(40 * Math.sin((x + y) / 18));
      raw[o] = Math.max(0, Math.min(255, rgb[0] + shade));
      raw[o + 1] = Math.max(0, Math.min(255, rgb[1] + shade));
      raw[o + 2] = Math.max(0, Math.min(255, rgb[2] + shade));
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dataUrl = (w, h, rgb) => `data:image/png;base64,${png(w, h, rgb).toString("base64")}`;

const browser = await chromium.launch();

// ------------------------------------------------------------------ 01 simple text
await chromePdf(browser, "EDITOR-01-simple-text.pdf", `
  <h1>Quarterly Update</h1>
  <p class="small">Prepared for the planning committee · all names and figures invented for testing</p>
  <h2>Summary</h2>${LOREM.map((t) => `<p>${t}</p>`).join("")}
  <h2>Next steps</h2><p>Review the draft, confirm the dates and return the signed form. Thank you for your patience.</p>`);
note("EDITOR-01-simple-text.pdf", "Chromium/Skia, Arial, one page", "plain paragraphs with spelling mistakes", [["recieve", "receive"], ["teh", "the"], ["seperate", "separate"], ["occured", "occurred"], ["definately", "definitely"], ["adress", "address"]]);

// ------------------------------------------------------------------ 02 résumé (headings, bold, colours, dark band)
await chromePdf(browser, "EDITOR-02-resume.pdf", `
  <div style="background:#2b3d59;color:#fff;padding:0.5in 0.9in 0.3in"><h1 style="margin:0">Jordan A. Whitfield</h1>
  <div style="font-size:10pt">Senior Data Analyst · jordan.whitfield@example.test · (555) 018-9921 · Utopia City</div></div>
  <div style="padding:0.2in 0.9in">
  <h2 style="border-bottom:1px solid #2b3d59;color:#2b3d59">SUMMARY</h2><p>Analyst with 8 years of experiance turning messy operational data into decisions. Led a team of four.</p>
  <h2 style="border-bottom:1px solid #2b3d59;color:#2b3d59">EXPERIENCE</h2>
  <p><b>Senior Data Analyst</b> · Contoso Retail (fictional) <span style="float:right"><i>2022 – present</i></span></p>
  <ul><li>Built the weekly sales dashboard used by 120 managers.</li><li>Automated stock forecasting; stock-outs fell 18%.</li><li>Mentored three junior analysts.</li></ul>
  <p><b>Data Analyst</b> · Fabrikam Logistics (fictional) <span style="float:right"><i>2018 – 2022</i></span></p>
  <ul><li>Cleaned and joined 14 source systems into one warehouse.</li><li>Presented quarterly findings to the board.</li></ul>
  <h2 style="border-bottom:1px solid #2b3d59;color:#2b3d59">SKILLS</h2><p style="color:#b03030">SQL · Python · Power BI · Forecasting</p></div>`, { css: "@page { margin: 0 }" });
note("EDITOR-02-resume.pdf", "Chromium/Skia, bold + italic + colour + dark band", "résumé", [["experiance", "experience"]]);

// ------------------------------------------------------------------ 04 invoice (table)
await chromePdf(browser, "EDITOR-04-invoice.pdf", `
  <h1>INVOICE</h1><p class="small">Invoice no. 2026-0147 · Issued 10 Oct 2026 · Due 9 Nov 2026</p>
  <table><tr><th>Item</th><th>Qty</th><th class="right">Unit</th><th class="right">Amount</th></tr>
  ${[["Consulting — discovery workshop", 2, 480], ["Dashboard development", 12, 95], ["Data cleaning (seperate batch)", 5, 60], ["Training session", 1, 350]].map(([a, q, u]) => `<tr><td>${a}</td><td>${q}</td><td class="right">${u}.00</td><td class="right">${(q * u).toFixed(2)}</td></tr>`).join("")}
  <tr><td colspan="3" class="right"><b>Total due</b></td><td class="right"><b>2,790.00</b></td></tr></table>
  <p style="margin-top:14pt">Payment is due within 30 days. Late payments incur a 2% monthly fee. Thank you for your buisness.</p>`);
note("EDITOR-04-invoice.pdf", "Chromium/Skia, table", "invoice with a table", [["seperate", "separate"], ["buisness", "business"]]);

// ------------------------------------------------------------------ 06 mixed fonts / styles / colours
const fam = ["Arial", "Times New Roman", "Courier New", "Georgia", "Calibri", "Verdana", "Cambria", "Segoe UI"];
await chromePdf(browser, "EDITOR-06-mixed-fonts.pdf", `
  <h1>Typeface specimen</h1>
  ${fam.map((f) => `<p style="font-family:'${f}'"><b>${f}</b> — The quick brown fox jumps over the lazy dog, definately a recieved pangram. <i>Italic line in ${f}.</i> <b><i>Bold italic.</i></b></p>`).join("")}
  <p style="color:#c0392b">Red paragraph with a mistaken wich in the middle.</p><p style="color:#1e6bb8;font-size:16pt">Large blue text occured here.</p>
  <p style="font-size:8pt">Small print: teh fine detail of the agreement is set out below.</p>`);
note("EDITOR-06-mixed-fonts.pdf", "Chromium/Skia, 8 families, bold/italic/colour/size", "font and style variety", [["definately", "definitely"], ["recieved", "received"], ["wich", "which"], ["occured", "occurred"], ["teh", "the"]]);

// ------------------------------------------------------------------ 07 multi-column
await chromePdf(browser, "EDITOR-07-multi-column.pdf", `
  <h1>Newsletter</h1><div style="column-count:2;column-gap:0.35in;text-align:justify">
  ${Array.from({ length: 6 }, (_, i) => `<h3>Item ${i + 1}</h3>${LOREM.map((t) => `<p>${t}</p>`).join("")}`).join("")}</div>`, { css: "p { orphans: 2; widows: 2 }" });
note("EDITOR-07-multi-column.pdf", "Chromium/Skia, two justified columns", "columns", [["recieve", "receive"], ["teh", "the"]]);

// ------------------------------------------------------------------ 08 / 20 images
const img = (w, h, c) => `<img src="${dataUrl(w, h, c)}" width="${w}" height="${h}">`;
await chromePdf(browser, "EDITOR-08-images.pdf", `
  <h1>Site photos</h1><p>Figure one shows teh north wall; figure two the roof.</p>
  <div style="display:flex;gap:18pt;align-items:flex-start">${img(220, 150, [60, 120, 190])}${img(160, 160, [200, 90, 60])}</div>
  <p style="margin-top:14pt">Both pictures were taken in September.</p>`);
note("EDITOR-08-images.pdf", "Chromium/Skia, two raster images", "images with captions", [["teh", "the"]]);
await chromePdf(browser, "EDITOR-20-multi-image.pdf", `
  <h1>Gallery</h1><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10pt">
  ${[[90, 160, 90], [190, 80, 120], [70, 70, 170], [210, 170, 60], [60, 160, 160], [150, 60, 60]].map((c) => img(150, 110, c)).join("")}</div>
  <p style="margin-top:12pt">Six pictures on one page, plus a caption with a seperate typo.</p>
  <div style="page-break-before:always"></div><h2>Second page</h2>${img(300, 180, [110, 140, 90])}<p>One more picture.</p>`);
note("EDITOR-20-multi-image.pdf", "Chromium/Skia, 7 images over 2 pages", "many images", [["seperate", "separate"]]);

// ------------------------------------------------------------------ 11 long document
await chromePdf(browser, "EDITOR-11-long-document-25-pages.pdf", Array.from({ length: 25 }, (_, i) => `<div ${i ? 'style="page-break-before:always"' : ""}><h1>Section ${i + 1}</h1>${LOREM.map((t) => `<p>${t}</p>`).join("")}<p>This page number is ${i + 1} of 25.</p></div>`).join(""));
note("EDITOR-11-long-document-25-pages.pdf", "Chromium/Skia, 25 pages", "long document", [["recieve", "receive"]]);

// ------------------------------------------------------------------ 14 table heavy
await chromePdf(browser, "EDITOR-14-table-heavy.pdf", `
  <h1>Regional figures</h1><table><tr><th>Region</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Notes</th></tr>
  ${Array.from({ length: 28 }, (_, i) => `<tr><td>Region ${i + 1}</td><td>${(i * 13) % 97}</td><td>${(i * 7) % 89}</td><td>${(i * 11) % 83}</td><td>${(i * 5) % 79}</td><td>${i % 5 === 0 ? "teh review is pending" : "ok"}</td></tr>`).join("")}</table>`);
note("EDITOR-14-table-heavy.pdf", "Chromium/Skia, 28-row table", "table-heavy", [["teh", "the"]]);

// ------------------------------------------------------------------ 15 special characters
await chromePdf(browser, "EDITOR-15-special-characters.pdf", `
  <h1>Caractères spéciaux</h1>
  <p>Café, naïve, Zürich, Łódź, señor, Ångström, œuvre — recieve the façade.</p>
  <p>Currency: €120.50 · £99.99 · ¥5,000 · ₹1,250 · ¢45 · $3.20</p>
  <p>Greek: Ελληνικά αβγδε · Cyrillic: Русский текст · symbols: © ® ™ § ¶ † ‡ • … – — “quoted” ‘single’ ½ ¼ ± × ÷ ≤ ≥ ≠</p>
  <p>Ligatures: office, fluffy, affinity, difficult, flow. Fractions and (parentheses) with \\backslash and #hash.</p>`);
note("EDITOR-15-special-characters.pdf", "Chromium/Skia, accents/symbols/Greek/Cyrillic", "special characters", [["recieve", "receive"]]);

// ------------------------------------------------------------------ 16 header/footer
await chromePdf(browser, "EDITOR-16-header-footer.pdf", Array.from({ length: 3 }, (_, i) => `<div ${i ? 'style="page-break-before:always"' : ""}><h1>Chapter ${i + 1}</h1>${LOREM.map((t) => `<p>${t}</p>`).join("")}</div>`).join(""), {
  format: "Letter", margin: { top: "0.9in", bottom: "0.9in", left: "0.9in", right: "0.9in" },
  header: `<div style="font-size:9px;width:100%;padding:0 0.9in;color:#555">Annual Operations Review — Confidential (fictional)</div>`,
  footer: `<div style="font-size:9px;width:100%;padding:0 0.9in;color:#555;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
});
note("EDITOR-16-header-footer.pdf", "Chromium/Skia, running header + page-number footer", "header/footer", [["recieve", "receive"]]);

await browser.close();

// ------------------------------------------------------------------ the rest: MuPDF / LibreOffice / copies
const SP = path.resolve("qa/scripts/editor-fixtures-mupdf.py");
execFileSync("python", [SP, OUT], { stdio: "inherit" });
// 03 business letter: python-docx → LibreOffice
if (process.env.LIBREOFFICE) {
  const docx = path.join(OUT, "_letter.docx");
  execFileSync("python", ["-c", `
import docx
from docx.shared import Pt
d = docx.Document()
s = d.styles['Normal']; s.font.name = 'Calibri'; s.font.size = Pt(11)
d.add_paragraph('Margaret L. Hollis\\nChair, Residents Committee\\nWillow Court, Utopia City')
d.add_paragraph('3 October 2026')
d.add_paragraph('Mr. Anthony Reyes\\nFlat 4, Willow Court')
d.add_paragraph('Dear Mr. Reyes,')
d.add_paragraph('Thank you for your letter of 12 September regarding the planned maintenance of the shared garden. The committee will recieve your suggestions on Tuesday and teh work should start in November.')
p = d.add_paragraph(); r = p.add_run('We will write to every household'); r.bold = True; p.add_run(' at least ten days before the work begins. Access to the garden will be limited for about two weeks, and a seperate path will be marked along the north fence.')
d.add_paragraph('If you have questions in the meantime, please contact me on the number above. It occured to us that a short meeting might also help.')
d.add_paragraph('Yours sincerely,')
d.add_paragraph('Margaret L. Hollis')
d.save(r"${docx}")`]);
  execFileSync("python", ["qa/validate/lo.py", "pdf", OUT, docx], { stdio: "pipe" });
  fs.renameSync(path.join(OUT, "_letter.pdf"), path.join(OUT, "EDITOR-03-business-letter.pdf"));
  fs.rmSync(docx);
  note("EDITOR-03-business-letter.pdf", "LibreOffice (Calibri→Carlito), simple-font TrueType subsets", "business letter", [["recieve", "receive"], ["teh", "the"], ["seperate", "separate"], ["occured", "occurred"]]);
} else console.warn("LIBREOFFICE not set: EDITOR-03 skipped");
fs.copyFileSync("qa/real-user-fixtures/DOCUMENT-02-filled-application.pdf", path.join(OUT, "EDITOR-12-scanned-form.pdf"));
note("EDITOR-12-scanned-form.pdf", "fake scan (JPEG page image)", "scanned form — must stay a picture", []);
fs.copyFileSync("qa/real-user-fixtures/DOCUMENT-07-scanned-letter.pdf", path.join(OUT, "EDITOR-13-scanned-letter.pdf"));
note("EDITOR-13-scanned-letter.pdf", "fake scan (JPEG page image)", "scanned letter — must stay a picture", []);
for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(OUT, "_manifest-mupdf.json"), "utf8")))) manifest[k] = v;
fs.rmSync(path.join(OUT, "_manifest-mupdf.json"));
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`${Object.keys(manifest).length} fixtures in ${OUT}`);
