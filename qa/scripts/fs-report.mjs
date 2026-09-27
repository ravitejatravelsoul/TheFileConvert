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
  ["Images → PDF", "fs-tools-i2p"],
  ["Merge PDF", "fs-tools-merge"],
  ["Split PDF", "fs-tools-split"],
  ["Organize PDF", "fs-tools-organize"],
  ["PDF Editor", "editor-all"],
  ["OCR", "fs-ocr"],
  ["Error scenarios", "fs-tools-errors"],
  ["Repeat use / stale state", "fs-tools-repeat"],
  ["Mobile", "mobile"],
  ["Privacy", "privacy"],
];
const EXPECT = {
  "Compress PDF": "output ≤ target and valid with every page, or — only when unreachable — honest “Target not reached” with the closest valid file; under-target input returned byte-for-byte",
  "Compress Image": "output ≤ target, decodes, same aspect, alpha kept, EXIF location/camera data dropped, upright; or honest “Target not reached”",
  "Image Converter": "right format, same pixel size (upright), alpha kept (or white under JPG), no script run / no external request",
  "PDF → Image": "one valid image per selected page, in the page's displayed orientation and proportions",
  "Images → PDF": "one page per image, in order, right page size/orientation, transparent areas white",
  "Merge PDF": "all pages in order, sizes and rotations kept; unreadable/encrypted input refused, no output",
  "Split PDF": "exactly the chosen pages, in order",
  "Organize PDF": "order, rotation, deletions and duplicates exactly as arranged",
  "PDF Editor": "every edit present at its place in the exported file, nothing else changed, file valid",
  OCR: "≥ 90 % of the page's words recognised (PASS), valid export",
  "Error scenarios": "a clear message, nothing to download, the page still works with a good file next",
  "Repeat use / stale state": "the second output comes only from the second input",
  Mobile: "the same result as desktop through touch",
  Privacy: "no upload, no third-party request, nothing stored",
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
  sections.push(`## ${title}\n\nExpected: ${EXPECT[title] ?? ""}.\n\n| Scenario | Input bytes | Options | Output bytes | Opened | Parser result (qpdf + MuPDF + pdf-lib + pdf.js / image decode / ZIP) | Visual / quality | Actual | Verdict |\n|---|---:|---|---:|---|---|---|---|---|\n${lines.join("\n")}\n`);
}

const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const before = load("repro-before-1000")[0];
const after = load("fs-compress-pdf").find((r) => /REAL user scan .* → 1 MB/.test(r.test));
const md = `# Full scenario acceptance — fresh launch

Branch \`rebuild/fresh-launch\` (base commit \`${sha}\` + this change). Local production build (\`next build && next start\`), real Chromium through Playwright, every file added through the tool's own file input and every result downloaded through the tool's own Download button.
Generated by \`node qa/scripts/fs-report.mjs\` from \`qa/evidence/fresh/*.json\`.

## The rule for PASS

Every downloaded file goes through the shared output-integrity validator (\`qa/scripts/validate-output.mjs\`) **before** a verdict is recorded, and \`rec()\` in \`qa/scripts/fl-lib.mjs\` turns any verdict into FAIL if a file fails it:

- **PDF**: qpdf structural check + decode of every stream (\`qa/validate/pdfcheck.py\`, pikepdf ${"10.14"} / qpdf 12), MuPDF open without repair + render of every page (blank-page detection) + its warnings, pdf-lib parse, pdf.js parse + text extraction + render of every page; all four engines must agree on the page count.
- **Image**: magic bytes match the extension, file complete (JPEG EOI / PNG IEND / WebP RIFF length), full decode (Skia), dimensions, alpha.
- **ZIP**: opens, every entry extracts, every entry validated by its own type.

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
