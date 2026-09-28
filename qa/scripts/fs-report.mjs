// Builds qa/FULL_SCENARIO_ACCEPTANCE.md from the evidence JSON written by the fs-*/fl-* scenario scripts.
//   node qa/scripts/fs-report.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const EV = path.resolve("qa/evidence/fresh");
const load = (n) => (fs.existsSync(path.join(EV, `${n}.json`)) ? JSON.parse(fs.readFileSync(path.join(EV, `${n}.json`), "utf8")) : []);
const SETS = [
  ["Compress PDF", "fs-compress-pdf"],
  ["Compress Image", "fs-compress-image"],
  ["Image Converter", "fs-tools-convert"],
  ["PDF → Image", "fs-tools-p2i"],
  ["Image → PDF", "fs-tools-i2p"],
  ["Merge PDF", "fs-tools-merge"],
  ["Split PDF", "fs-tools-split"],
  ["Organize PDF", "fs-tools-organize"],
  ["PDF Editor", "editor-all"],
  ["OCR", "fs-ocr"],
  ["Error scenarios", "fs-tools-errors"],
  ["Repeat use / stale state", "fs-tools-repeat"],
  ["Mobile", "mobile"],
  ["Privacy", "privacy"],
  ["PDF to Word", "fs-word"],
  ["PDF to Word — mobile", "fs-word-mobile"],
  ["Word to PDF", "fs-docx"],
  ["Word to PDF — mobile", "fs-docx-mobile"],
  ["Journeys and round trips", "fs-journeys"],
];
const EXPECT = {
  "Compress PDF": "output ≤ target and valid with every page, or — only when unreachable — honest “Target not reached” with the closest valid file; under-target input returned byte-for-byte",
  "Compress Image": "output ≤ target, decodes, same aspect, alpha kept, EXIF location/camera data dropped, upright; or honest “Target not reached”",
  "Image Converter": "right format, same pixel size (upright), alpha kept (or white under JPG), no script run / no external request",
  "PDF → Image": "one valid image per selected page, in the page's displayed orientation and proportions",
  "Image → PDF": "one page per image, in order, right page size/orientation, transparent areas white",
  "Merge PDF": "all pages in order, sizes and rotations kept; unreadable/encrypted input refused, no output",
  "Split PDF": "exactly the chosen pages, in order",
  "Organize PDF": "order, rotation, deletions and duplicates exactly as arranged",
  "PDF Editor": "every edit present at its place in the exported file, nothing else changed, file valid",
  OCR: "≥ 90 % of the page's words recognised (PASS), valid export",
  "Error scenarios": "a clear message, nothing to download, the page still works with a good file next",
  "Repeat use / stale state": "the second output comes only from the second input",
  Mobile: "the same result as desktop through touch",
  Privacy: "no upload, no third-party request, nothing stored",
  "Journeys and round trips": "each step hands its file to the next through the product's own “Continue with” (or its link), every output valid, the end result meets the goal (size target, pages, rotation, edits, text); round trips keep text, order, pictures and page count",
};
const fixtures = JSON.parse(fs.readFileSync("qa/fresh-scenario-fixtures/fixtures.json", "utf8"));
const n = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : v ?? "");
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

let totals = { scenarios: 0, pass: 0, limited: 0, fail: 0, outputs: 0, reopened: 0, corrupt: 0 };
const sections = [];
const summary = [];
for (const [title, file] of SETS) {
  const rows = load(file);
  if (!rows.length) {
    summary.push(`| ${title} | — | — | — | — | not run |`);
    continue;
  }
  const c = { pass: 0, limited: 0, fail: 0, outputs: 0, ok: 0 };
  const lines = [];
  for (const r of rows) {
    c[r.verdict.toLowerCase()]++;
    const outs = r.integrity ?? [];
    c.outputs += outs.length;
    c.ok += outs.filter((o) => o.ok).length;
    const opened = outs.length ? (outs.every((o) => o.ok) ? "YES" : "**NO**") : "—";
    const parser = outs.length
      ? outs
          .map((o) => (o.kind === "pdf" ? `pdf ${o.pages}p` : o.kind === "zip" ? `zip ${o.entries} files` : `${o.kind} ${o.w}x${o.h}${o.alpha ? " α" : ""}`) + (o.problems ? ` ✗ ${o.problems.join("; ")}` : ""))
          .join("; ")
      : "";
    const input = r.input ?? "";
    const opts = r.target ? `target ${n(r.target)} B` : r.fixture ?? "";
    const output = r.output ?? (outs.length === 1 ? outs[0].bytes : outs.length ? outs.map((o) => o.bytes).join("+") : "");
    const visual = [
      r.psnr !== undefined && r.psnr !== null ? `PSNR ${r.psnr} dB` : "",
      r.ssim !== undefined && r.ssim !== null ? `SSIM ${r.ssim}` : "",
      r.pages ? `pages ${r.pages}` : "",
      r.dims ? r.dims : "",
      r.alpha ? `alpha ${r.alpha}` : "",
      r.accuracy ? `accuracy ${r.accuracy}` : "",
      r.checks ? Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => `✗${k}`).join(" ") || "all visual checks ✓" : "",
    ]
      .filter(Boolean)
      .join(", ");
    const actual = [r.headline, r.message, r.error, r.gate, r.labels && `order ${r.labels}`, r.rotations && `rot ${r.rotations}`, r.ms && `${(r.ms / 1000).toFixed(1)} s`].filter(Boolean).join(" · ");
    lines.push(`| ${esc(r.test)} | ${n(input)} | ${esc(opts)} | ${n(output)} | ${opened} | ${esc(parser)} | ${esc(visual)} | ${esc(actual).slice(0, 220)} | **${r.verdict}** |`);
  }
  totals.scenarios += rows.length;
  totals.pass += c.pass;
  totals.limited += c.limited;
  totals.fail += c.fail;
  totals.outputs += c.outputs;
  totals.reopened += c.ok;
  totals.corrupt += c.outputs - c.ok;
  summary.push(`| ${title} | ${rows.length} | ${c.pass} | ${c.limited} | ${c.fail} | ${c.outputs} downloaded, ${c.ok} reopened |`);
  if (file.startsWith("fs-word") || file.startsWith("fs-docx")) continue; // have their own sections above
  sections.push(`## ${title}\n\nExpected: ${EXPECT[title] ?? ""}.\n\n| Scenario | Input bytes | Options | Output bytes | Opened | Parser result (qpdf + MuPDF + pdf-lib + pdf.js / image decode / ZIP) | Visual / quality | Actual | Verdict |\n|---|---:|---|---:|---|---|---|---|---|\n${lines.join("\n")}\n`);
}

const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const before = load("repro-before-1000")[0];
const after = load("fs-compress-pdf").find((r) => /REAL user scan .* → 1 MB/.test(r.test));
// PDF → Word: its own table with the columns that matter for a document conversion.
const wordRows = [...load("fs-word"), ...load("fs-word-mobile")].filter((r) => r.fixture || r.message);
const wordSection = `## PDF → Word

Every scenario ran through /pdf-to-word in real Chromium (desktop, then Pixel 7 touch emulation): upload → Convert to Word → download the .docx. Each .docx was then reopened independently three ways: \`qa/validate/docxcheck.py\` (ZIP/OOXML package — required parts, well-formed XML, content types, relationship targets, image decode — plus python-docx), the shared validator gate, and mammoth.js (a second DOCX reader; its HTML renders are in \`qa/review/fresh-launch-polish/pdf-to-word-renders/\`). LibreOffice isn't installed on this machine, so it wasn't used.

Text accuracy is measured against the fixture's ground truth (\`qa/fresh-scenario-fixtures/word/truth.json\`): **recall** = share of source words present, **order** = longest common word subsequence ÷ source words, **separation** = source paragraphs/headings/list items that land in their own Word paragraph (not merged with a neighbour, not split). For scanned pages the same numbers are the OCR accuracy.

| Fixture | Kind | Input pages | Input bytes | Time | DOCX bytes | Recall / order | Paragraph separation | Structure checks | Images | DOCX valid | Verdict |
|---|---|---:|---:|---:|---:|---|---|---|---|---|---|
${wordRows
  .map((r) => {
    const test = String(r.test);
    const mobile = test.includes("[mobile]") ? " (mobile)" : "";
    if (r.message) return `| ${test.split(" ")[0]}${mobile} | corrupt | — | ${n(r.input)} | — | — | — | — | refused: “${esc(r.message)}” | — | no file offered | **${r.verdict}** |`;
    const checks = r.structure ? Object.entries(r.structure).filter(([k]) => k !== "missing").map(([k, v]) => `${k} ${v ? "✓" : "✗"}`).join(", ") : "";
    const images = r.structure && "images" in r.structure ? `${r.pictures} embedded, aspect kept ${r.structure.images ? "✓" : "✗"}` : r.pictures ? `${r.pictures}` : "—";
    const acc = r.recall !== undefined ? `${r.recall}% / ${r.order}%` : "n/a (no ground truth)";
    const sep = r.separation !== undefined ? `${r.separation}% (${r.paragraphsIntact})` : `${r.paragraphs} paragraphs, ${r.tables} table`;
    return `| ${r.fixture}${mobile} | ${r.kind} | ${r.inputPages} | ${n(r.input)} | ${(r.ms / 1000).toFixed(1)} s | ${n(r.output)} | ${acc} | ${sep} | ${esc(checks)} | ${images} | ${r.docxValid ? "YES" : "**NO**"} | **${r.verdict}** |`;
  })
  .join("\n")}

The user-supplied scan (2 pages, 3,982,736 bytes) has no ground truth; its recognised text contains the name, the dates (02/08/2026, 12/20/2026), the account number, the amount ($182.50), the registrar and the certificate text in page order. Label/value pairs came out as a borderless two-column table, and one line of OCR noise (“= ee CCCSTR”) comes from a stamp.

Automated regressions: \`src/lib/processors/pdf-to-word/layout.test.ts\` (paragraphs, headings, lists, tables, columns, images, characters), \`docx.test.ts\` (package validity, structure, verifier), \`e2e/pdf-to-word.spec.ts\` (native, lists, images, special characters, corrupt, password; desktop + mobile) and \`e2e/pdf-to-word-ocr.spec.ts\` (scanned, mixed, no upload; desktop + mobile).
`;

// Word → PDF: structure checks from MuPDF (qa/validate/pdfstruct.py) against what the fixture's author wrote.
const docxRows = [...load("fs-docx"), ...load("fs-docx-mobile")].filter((r) => r.fixture);
const docxSection = `## Word → PDF

Every scenario ran through /word-to-pdf in real Chromium (desktop, then Pixel 7 touch emulation): upload the .docx → Convert to PDF → Download PDF. The fixtures were written by python-docx (\`qa/scripts/fs-docx-fixtures.py\`), not by our code. Each PDF went through the shared validator (qpdf, MuPDF, pdf-lib, pdf.js — every page rendered, blank pages flagged) and then \`qa/validate/pdfstruct.py\` (MuPDF: text, fonts, sizes, bold/italic, colours, pictures, links, vector lines, bookmarks), checked against \`qa/fresh-scenario-fixtures/docx/truth.json\`. **Recall / order** compare the PDF's text with the document's text. For visual review, page 1 of each document is shown next to an independent DOCX renderer (docx-preview) in \`qa/review/fresh-launch-polish/word-to-pdf-renders/\`; LibreOffice isn't installed here.

| Fixture | Input bytes | Time | PDF bytes | Pages | Pictures | Links | Bookmarks | Recall / order | Checks | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
${docxRows
  .map((r) => {
    const mobile = String(r.test).includes("[mobile]") ? " (mobile)" : "";
    if (r.kind === "error") return `| ${r.fixture}${mobile} | ${n(r.input)} | — | — | — | — | — | — | — | refused: “${esc(r.message)}”, nothing to download | **${r.verdict}** |`;
    if (r.error) return `| ${r.fixture}${mobile} | | | | | | | | | ${esc(r.error).slice(0, 160)} | **${r.verdict}** |`;
    const checks = Object.entries(r.checks ?? {}).filter(([k]) => k !== "missingChars").map(([k, v]) => `${k} ${v ? "✓" : "✗"}`).join(", ");
    return `| ${r.fixture}${mobile} | ${n(r.input)} | ${(r.ms / 1000).toFixed(1)} s | ${n(r.output)} | ${r.pages} | ${r.pictures} | ${r.links} | ${r.bookmarks} | ${r.recall ?? "—"}% / ${r.order ?? "—"}% | ${esc(checks)} | **${r.verdict}** |`;
  })
  .join("\n")}

Automated regressions: \`src/lib/processors/word-to-pdf/word-to-pdf.test.ts\` (style chain, list numbering, tables, headers/footers and fields, special characters, error files, line breaking, alignment, page breaks, keep-with-next, footer page numbers, font glyph padding, end-to-end PDFs checked with pdf.js) and \`e2e/word-to-pdf.spec.ts\` (copy, header/footer page numbers, text, pictures, continue-to-compress, error files, no upload; desktop + mobile).
`;

const md = `# Full scenario acceptance — fresh launch

Branch \`rebuild/fresh-launch\` (base commit \`${sha}\` + this change). Local production build (\`next build && next start\`), real Chromium through Playwright, every file added through the tool's own file input and every result downloaded through the tool's own Download button.
Generated by \`node qa/scripts/fs-report.mjs\` from \`qa/evidence/fresh/*.json\`.

## The rule for PASS

Every downloaded file goes through the shared output-integrity validator (\`qa/scripts/validate-output.mjs\`) **before** a verdict is recorded, and \`rec()\` in \`qa/scripts/fl-lib.mjs\` turns any verdict into FAIL if a file fails it:

- **PDF**: qpdf structural check + decode of every stream (\`qa/validate/pdfcheck.py\`, pikepdf ${"10.14"} / qpdf 12), MuPDF open without repair + render of every page (blank-page detection) + its warnings, pdf-lib parse, pdf.js parse + text extraction + render of every page; all four engines must agree on the page count.
- **Image**: magic bytes match the extension, file complete (JPEG EOI / PNG IEND / WebP RIFF length), full decode (Skia), dimensions, alpha.
- **ZIP**: opens, every entry extracts, every entry validated by its own type.
- **DOCX**: ZIP/OOXML package (required parts, well-formed XML, content types, relationship targets, picture decode) and python-docx (\`qa/validate/docxcheck.py\`).

Verdicts: **PASS** — worked and every output valid. **LIMITED** — honest, valid outcome that isn't the ideal (e.g. a target that can't be reached without wrecking the file, reported as "Target not reached" with the closest valid result). **FAIL** — wrong, dishonest, or any output invalid.

## The reported bug — real user scan, ~3.8 MB → under 1 MB

| | Input bytes | Target bytes | Output bytes | Opens (Acrobat-class strict readers) | Pages | Render | Target achieved |
|---|---:|---:|---:|---|---|---|---|
| OLD (commit 3eaae3e) | ${n(before?.input)} | ${n(before?.target)} | ${n(before?.output)} | **NO** — qpdf: "unable to find /Root dictionary"; MuPDF: "invalid reference to an objstm that does not exist", file needs repair | — | lenient viewers only | claimed "${before?.headline ?? ""}" |
| NEW | ${n(after?.input)} | ${n(after?.target)} | ${n(after?.output)} | ${after?.opened ? "YES — qpdf, MuPDF (no repair), pdf-lib, pdf.js" : "see table"} | ${after?.pages ?? ""} | ${after?.allPagesRender ? "all pages render, none blank" : ""}${after?.psnr ? ` · PSNR ${after.psnr} dB / SSIM ${after.ssim} vs original` : ""} | ${after?.achieved ? "YES" : "NO"} |

Root cause and fix: see \`qa/SCENARIO_DEFECTS.md\` (D1).

## Totals

| Area | Scenarios | PASS | LIMITED | FAIL | Outputs |
|---|---:|---:|---:|---:|---|
${summary.join("\n")}
| **All** | **${totals.scenarios}** | **${totals.pass}** | **${totals.limited}** | **${totals.fail}** | **${totals.outputs} downloaded, ${totals.reopened} reopened, ${totals.corrupt} corrupt** |

## Reading the quality numbers

PSNR/SSIM compare the output with the original — PDFs as the worst of their first six pages rendered at 50 %, images after scaling the original to the output's size. The synthetic photos carry heavy per-pixel noise (like a high-ISO sensor) so that they compress like real photos; removing that noise lowers PSNR/SSIM a lot while the picture looks the same, so values in the mid-20s dB for the noisiest fixtures (IMAGE-D/E, the scan pages) are expected and are not a visual failure. Text-only pages score 99 dB (identical render). The real user scan scores 50.8 dB / SSIM 0.9985 at 1 MB.

${wordSection}
${docxSection}
## Fixtures

\`qa/fresh-scenario-fixtures/\` (built by \`node qa/scripts/fs-fixtures.mjs\`, described in its README). Plus the user-supplied scan \`TheFileConvert_Scanned_OCR_Test.pdf\` (3,982,736 bytes), read in place; the editor/mobile/privacy scripts also use the first-launch set in \`qa-fixtures/fresh/\`.

| ID | File | Bytes | What |
|---|---|---:|---|
${fixtures.map((f) => `| ${f.id} | ${f.name} | ${n(f.bytes)} | ${esc(f.what)} |`).join("\n")}

${sections.join("\n")}
`;
fs.writeFileSync("qa/FULL_SCENARIO_ACCEPTANCE.md", md);
fs.writeFileSync(path.join(EV, "fs-totals.json"), JSON.stringify(totals, null, 1));
console.log(totals);
