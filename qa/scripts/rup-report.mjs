// Writes qa/REAL_USER_PRODUCT_AUDIT.md from the evidence of qa/scripts/rup-audit.mjs.
//   node qa/scripts/rup-report.mjs qa/evidence/fresh/rup-all-final.json
import fs from "node:fs";
import path from "node:path";

const evidence = path.resolve(process.argv[2] ?? "qa/evidence/fresh/rup-all-final.json");
const records = JSON.parse(fs.readFileSync(evidence, "utf8"));
const notes = JSON.parse(fs.readFileSync(path.resolve("qa/real-user-fixtures/inspection-notes.json"), "utf8"));
const header = JSON.parse(fs.readFileSync(path.resolve("qa/real-user-fixtures/audit-header.json"), "utf8"));

const scenarios = records.filter((r) => r.fixture && r.fixture !== "(whole run)" && r.fixture !== "(all mobile steps)");
const counts = (rs) => rs.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] ?? 0) + 1), m), { PASS: 0, LIMITED: 0, FAIL: 0 });
const total = counts(scenarios);
const tools = [...new Set(scenarios.map((r) => r.tool))];
const noteFor = (r) => notes.find((n) => r.tool === n.tool && (r.test.includes(n.match) || (r.fixture ?? "").includes(n.match)))?.note;
const esc = (s) => String(s ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");

const out = [];
out.push("# Real-user product audit", "");
out.push(`**Verdict: ${total.FAIL ? "FAIL" : total.LIMITED ? "PASS with documented LIMITED cases" : "PASS"}** — ${scenarios.length} scenarios · ${total.PASS} PASS · ${total.LIMITED} LIMITED · ${total.FAIL} FAIL`, "");
out.push(header.intro, "");
out.push("## What was tested, and how", "");
for (const l of header.method) out.push(`- ${l}`);
out.push("", "## Results by tool", "", "| Tool | Scenarios | PASS | LIMITED | FAIL |", "|---|---:|---:|---:|---:|");
for (const t of tools) {
  const c = counts(scenarios.filter((r) => r.tool === t));
  out.push(`| ${t} | ${c.PASS + c.LIMITED + c.FAIL} | ${c.PASS} | ${c.LIMITED} | ${c.FAIL} |`);
}
out.push(`| **All** | **${scenarios.length}** | **${total.PASS}** | **${total.LIMITED}** | **${total.FAIL}** |`, "");

out.push("## Journeys A–H", "", "| Journey | Scenario | Verdict |", "|---|---|---|");
const J = { A: "Filled application PDF → Word", B: "Passport-like scan → Word", C: "Native résumé PDF → Word (editable)", D: "Filled application PNG → Word", E: "Image → PDF", F: "PDF → PNG", G: "DOCX → PDF", H: "Scanned PDF → OCR (searchable / editable)" };
for (const [k, label] of Object.entries(J)) {
  const rs = scenarios.filter((r) => r.journey === k);
  out.push(`| ${k} | ${label} — ${rs.map((r) => r.fixture).join(", ") || "n/a"} | ${rs.length ? (rs.some((r) => r.verdict === "FAIL") ? "FAIL" : rs.some((r) => r.verdict === "LIMITED") ? "LIMITED" : "PASS") : "n/a"} |`);
}

const open = scenarios.filter((r) => r.verdict !== "PASS");
out.push("", "## LIMITED and FAIL — nothing hidden", "");
if (!open.length) out.push("None.");
for (const r of open) out.push(`- **${r.verdict}** — ${r.tool}: ${r.test} — ${esc(r.difference)}${noteFor(r) ? ` — ${noteFor(r)}` : ""}`);

out.push("", "## Fixed during this audit", "");
for (const f of header.fixed) out.push(`- **${f.title}** — ${f.detail}`);

out.push("", "## Scenarios", "");
for (const r of scenarios) {
  out.push(`### ${r.verdict} — ${r.tool}: ${r.test}`, "");
  out.push("| | |", "|---|---|");
  out.push(`| Tool | ${esc(r.tool)} |`);
  out.push(`| Input fixture | \`${esc(r.fixture)}\` |`);
  out.push(`| What the fixture represents | ${esc(r.represents)} |`);
  out.push(`| User expectation | ${esc(r.expectation)} |`);
  out.push(`| Steps | ${esc(r.steps)} |`);
  out.push(`| Output | ${esc(r.output)} |`);
  out.push(`| Visual result | ${esc(r.visual)} |`);
  out.push(`| Structural result | ${esc(r.structural)} |`);
  out.push(`| Difference from source | ${esc(r.difference)} |`);
  if (noteFor(r)) out.push(`| Reviewer note (by eye, on the saved comparison image) | ${esc(noteFor(r))} |`);
  out.push(`| Verdict | **${r.verdict}** |`, "");
}

out.push("## Not covered by this audit", "");
for (const l of header.notCovered) out.push(`- ${l}`);
out.push("");
fs.writeFileSync(path.resolve("qa/REAL_USER_PRODUCT_AUDIT.md"), out.join("\n"));
console.log(`wrote qa/REAL_USER_PRODUCT_AUDIT.md — ${scenarios.length} scenarios`, JSON.stringify(total));
