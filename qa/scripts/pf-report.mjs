// Writes qa/PROCESSING_FLOW_AUDIT.md from qa/scripts/pf-audit.mjs evidence.
//   node qa/scripts/pf-report.mjs qa/evidence/fresh/pf-audit-final.json [qa/evidence/fresh/pf-audit-p2w.json]
import fs from "node:fs";
import path from "node:path";

const files = process.argv.slice(2);
const records = files.flatMap((f) => JSON.parse(fs.readFileSync(path.resolve(f), "utf8")));
const head = JSON.parse(fs.readFileSync(path.resolve("qa/scripts/pf-report-header.json"), "utf8"));
const main = records.filter((r) => !r.detail);
const tally = (rs) => rs.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] ?? 0) + 1), m), { PASS: 0, FAIL: 0 });
const t = tally(main);
const out = [];
out.push("# Processing-flow audit — one click, then hands off", "");
out.push(`**Verdict: ${t.FAIL ? "FAIL" : "PASS"}** — ${main.length} runs · ${t.PASS} PASS · ${t.FAIL} FAIL · extra interaction required: **${main.some((r) => r.extraInteraction === "YES") ? "YES" : "NO"}**`, "");
for (const l of head.intro) out.push(l, "");
out.push("## The bug, and why a click fixed it", "");
for (const l of head.rootCause) out.push(l, "");
out.push("## Method", "");
for (const l of head.method) out.push(`- ${l}`);
out.push("", "## Results", "", "Times are seconds from the one click to the result appearing. **Cold** = a fresh browser context (empty HTTP cache, no warm OCR/pdf.js state); **warm** = the same context, second run. **Starved** = the browser delivers no animation frames after the click until the user interacts (a tab behind another tab / a covered window).", "");
out.push("| Tool | Fixture | Mode | Cold/warm | Start → finish (s) | OCR requests | Extra click required | Result valid | Verdict |", "|---|---|---|---|---:|---:|---|---|---|");
for (const r of main) out.push(`| ${r.tool} | ${r.private ? "the user's own scan" : r.fixture} | ${r.mode} | ${r.run} | 0 → ${r.resultSec ?? "**no result**"} | ${r.ocrRequests ?? "—"} | ${r.extraInteraction ?? "—"} | ${r.outputValid ?? "—"} | **${r.verdict}** |`);
const detail = records.filter((r) => r.classes);
if (detail.length) {
  out.push("", "## PDF → Word: what each document was, and whether OCR ran", "", "| Document | Page classes | Strategy | OCR used | Why | Time (s, foreground) |", "|---|---|---|---|---|---:|");
  const seen = new Set();
  for (const r of detail.filter((x) => x.mode === "normal" && x.run === "warm")) {
    if (seen.has(r.case)) continue;
    seen.add(r.case);
    const ocr = r.ocrRequests > 0;
    const why = ocr ? "a plain scan of running text: read once to decide whether it is reliable enough to become editable text (otherwise it keeps its look)" : /NATIVE|MIXED/.test(r.classes) ? "real text — nothing to read" : "a form / ID / certificate / table / photo: kept as it looks, decided from pixels — no OCR needed";
    out.push(`| ${r.private ? "the user's own scan" : r.fixture} | ${r.classes} | ${r.strategies} | ${ocr ? "YES" : "NO"} | ${why} | ${r.resultSec} |`);
  }
}
const bad = main.filter((r) => r.verdict !== "PASS");
out.push("", "## Failures", "");
if (!bad.length) out.push("None."); else for (const r of bad) out.push(`- ${r.tool} · ${r.case} · ${r.mode} · ${r.run}: ${r.problem ?? "see table"}`);
out.push("", "## Honest notes", "");
for (const l of head.notes) out.push(`- ${l}`);
out.push("");
fs.writeFileSync(path.resolve("qa/PROCESSING_FLOW_AUDIT.md"), out.join("\n"));
console.log(`wrote qa/PROCESSING_FLOW_AUDIT.md — ${main.length} runs`, JSON.stringify(t));
