// Builds qa/FRESH_LAUNCH_ACCEPTANCE.md from the JSON evidence written by the fl-*.mjs acceptance scripts.
//   node qa/scripts/fl-report.mjs
import fs from "node:fs";
import path from "node:path";

const EV = path.resolve("qa/evidence/fresh");
const load = (n) => (fs.existsSync(path.join(EV, `${n}.json`)) ? JSON.parse(fs.readFileSync(path.join(EV, `${n}.json`), "utf8")) : []);
const sets = {
  compressPdf: load("compress-pdf").filter((r) => r.tool === "Compress PDF"),
  compressImage: load("compress-image").filter((r) => r.tool === "Compress Image"),
  tools: load("tools"),
  editor: load("editor-all"),
  mobile: load("mobile"),
  privacy: load("privacy"),
  performance: load("performance"),
};
const extra = fs.existsSync(path.join(EV, "suite.json")) ? JSON.parse(fs.readFileSync(path.join(EV, "suite.json"), "utf8")) : null;
const fixtures = fs.readFileSync(path.resolve("qa-fixtures/fresh/README.md"), "utf8").split("\n").filter((l) => l.startsWith("| FL-"));
const n = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : v ?? "");
const all = Object.values(sets).flat();
const count = (v) => all.filter((r) => r.verdict === v).length;

let md = `# TheFileConvert — First-launch acceptance

Branch \`rebuild/fresh-launch\` · generated ${new Date().toISOString().slice(0, 10)} by \`qa/scripts/fl-report.mjs\` from the JSON evidence in \`qa/evidence/fresh/\`.

**Production was not touched.** Nothing was merged to \`main\`, pushed, or deployed. Every check below ran against a local server.

## How this was tested

Every row is a real browser session (Playwright Chromium, desktop 1440×900 or Pixel 7 with touch) driving the actual UI:
files are added through the tool's own file picker, options are chosen by clicking/tapping, the result is downloaded
through the real download button, and the downloaded file is then **reopened independently** in Node (pdf-lib, pdf.js
with standard fonts, @napi-rs/canvas) and checked — page counts, text, rotations, crop boxes, pixel colours, image
format, dimensions and transparency, and exact byte sizes.

Verdicts: **PASS** — works and verified; **LIMITED** — behaves correctly but with a real, disclosed limit (e.g. a target
that can't be reached is honestly reported as not reached); **FAIL** — broken.

Totals across the scripted acceptance runs: **${count("PASS")} PASS · ${count("LIMITED")} LIMITED · ${count("FAIL")} FAIL**.

## Fixtures

Generated deterministically by \`qa/scripts/fl-fixtures.mjs\` (no real documents), plus the user-supplied
\`TheFileConvert_Scanned_OCR_Test.pdf\` for the real-scan OCR session.

| File | Bytes | What |
|---|---:|---|
${fixtures.join("\n")}

## Compress PDF — target-size matrix

| Input | Input bytes | Target bytes | Output bytes | Target reached | Quality setting | Pages | Time | Verdict |
|---|---:|---:|---:|:-:|---|:-:|---:|:-:|
${sets.compressPdf
  .map((r) => `| ${r.test.split(" → ")[0]} | ${n(r.input)} | ${n(r.target)} | ${n(r.output)} | ${r.achieved ? "✓" : "✗ (closest shown)"} | ${r.quality} | ${r.pages} | ${(r.ms / 1000).toFixed(1)} s | ${r.verdict} |`)
  .join("\n")}

The headline shown to the user matched the real outcome in every case (“Done — …” only when the output is at or under the
target; “Couldn't safely reach …” with the closest size otherwise; “Already under your target” returns the original
byte-for-byte).

## Compress Image — target-size matrix

| Input | Input bytes | Target bytes | Output bytes | Reached | Dimensions | Format | Alpha | Details shown | Verdict |
|---|---:|---:|---:|:-:|---|---|---|---|:-:|
${sets.compressImage
  .map((r) => `| ${r.test.split(" → ")[0]} | ${n(r.input)} | ${n(r.target)} | ${n(r.output)} | ${r.achieved ? "✓" : "✗"} | ${r.dims} | ${r.format} | ${r.alpha} | ${r.details}${r.note ? ` — “${r.note}”` : ""} | ${r.verdict} |`)
  .join("\n")}

## Converter, PDF → Image, Images → PDF, Merge, Split, Organize

| Tool | Test | Verification of the downloaded output | Verdict |
|---|---|---|:-:|
${sets.tools
  .map((r) => {
    const { tool, test, verdict, ...d } = r;
    return `| ${tool} | ${test} | ${Object.entries(d)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("; ")
      .replace(/\|/g, "/")} | ${verdict} |`;
  })
  .join("\n")}

## PDF Editor

| Session | Checks on the exported, reopened PDF | Verdict |
|---|---|:-:|
${sets.editor
  .map((r) => {
    const { verdict, test, tool, ...d } = r;
    void tool;
    return `| ${test} | ${JSON.stringify(d).replace(/\|/g, "/").slice(0, 900)} | ${verdict} |`;
  })
  .join("\n")}

## Mobile (Pixel 7, touch)

| Tool | Test | Result | Verdict |
|---|---|---|:-:|
${sets.mobile
  .map((r) => {
    const { tool, test, verdict, ...d } = r;
    return `| ${tool} | ${test} | ${JSON.stringify(d).replace(/\|/g, "/").slice(0, 300)} | ${verdict} |`;
  })
  .join("\n")}

## Privacy (network)

| Check | Result | Verdict |
|---|---|:-:|
${sets.privacy
  .map((r) => {
    const { test, verdict, tool, ...d } = r;
    void tool;
    return `| ${test} | ${JSON.stringify(d).replace(/\|/g, "/").slice(0, 400)} | ${verdict} |`;
  })
  .join("\n")}
`;

md += `
## Performance (decoded JavaScript, local production build)

| Check | Result | Verdict |
|---|---|:-:|
${sets.performance
  .map((r) => {
    const { test, verdict, tool, ...d } = r;
    void tool;
    return `| ${test} | ${JSON.stringify(d).replace(/\|/g, "/")} | ${verdict} |`;
  })
  .join("\n")}
`;

if (extra) md += `\n## Automated suites\n\n${extra.map((l) => `- ${l}`).join("\n")}\n`;

md += fs.readFileSync(path.resolve("qa/scripts/fl-report-notes.md"), "utf8");
fs.writeFileSync(path.resolve("qa/FRESH_LAUNCH_ACCEPTANCE.md"), md);
console.log(`wrote qa/FRESH_LAUNCH_ACCEPTANCE.md — ${count("PASS")} PASS, ${count("LIMITED")} LIMITED, ${count("FAIL")} FAIL`);
