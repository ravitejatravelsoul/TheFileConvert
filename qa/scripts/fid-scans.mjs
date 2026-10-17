// Scanned PDF → Word suite: SCAN-WORD-01 … 07 (qa/scripts/scan-fixtures.py) and SCAN-WORD-08, the user's
// own scan (read in place from Downloads, never copied; its renders go to the git-ignored user-scan folder).
//   LIBREOFFICE=…/soffice.exe BASE=http://localhost:3000 node qa/scripts/fid-scans.mjs [mobile] [--tag=x] [--only=01]
// Each fixture goes through the real /pdf-to-word page (fid-userscan.mjs), is rendered by LibreOffice and
// graded by qa/validate/scanform.py: text recall (against the native original), layout, rules, typography,
// garbage, and — for the user's scan — its structure checks. Writes qa/fidelity/scan-word/out/<name>/ and
// qa/evidence/fresh/fid-scans<-tag>.json.
import { execFileSync } from "node:child_process";
import { REAL_SCAN, fs, path } from "./fl-lib.mjs";

const args = process.argv.slice(2);
const mobile = args.includes("mobile");
const tag = args.find((a) => a.startsWith("--tag="))?.slice(6) ?? "";
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const DIR = path.resolve("qa/fidelity/scan-word");
const fixtures = fs
  .readdirSync(DIR)
  .filter((f) => /^SCAN-WORD-\d\d-.*\.pdf$/.test(f) && !f.endsWith("-ref.pdf"))
  .map((f) => ({ name: f.replace(/\.pdf$/, ""), file: path.join(DIR, f), ref: path.join(DIR, f.replace(/\.pdf$/, "-ref.pdf")), out: path.join(DIR, "out", f.replace(/\.pdf$/, "")) }));
fixtures.push({ name: "SCAN-WORD-08-user-real-scan", file: REAL_SCAN, ref: null, out: path.resolve("qa/fidelity/user-scan") });

const suffix = `${mobile ? "-mobile" : ""}${tag ? "-" + tag : ""}`;
const rows = [];
for (const f of fixtures.filter((x) => !only || x.name.includes(`-${only}-`))) {
  fs.mkdirSync(f.out, { recursive: true });
  const cli = ["qa/scripts/fid-userscan.mjs", `--file=${f.file}`, ...(mobile ? ["mobile"] : []), ...(tag ? [`--tag=${tag}`] : [])];
  if (f.ref) cli.push(`--out=${f.out}`, "--name=word", `--ref=${f.ref}`);
  const expect = path.join(DIR, "expect", `${f.name}.json`);
  if (f.ref && fs.existsSync(expect)) cli.push(`--expect=${expect}`);
  let line = "";
  try {
    line = execFileSync("node", cli, { encoding: "utf8", timeout: 900_000, maxBuffer: 32 << 20 });
  } catch (e) {
    line = String(e.stdout ?? e);
  }
  const ev = f.ref ? `fid-scan-word${suffix}` : `fid-userscan${suffix}`;
  const recs = JSON.parse(fs.readFileSync(path.resolve("qa/evidence/fresh", `${ev}.json`), "utf8"));
  const r = recs[0];
  const keep = ["verdict", "ms", "uploads", "pagesSrc", "pagesOut", "textRecallPct", "wordsInPlacePct", "rulesKeptPct", "typographyPct", "wordsWithoutInk", "tables", "dimensions", "text", "layout", "rules", "typography", "garbage", "structure", "checksFailed", "error"];
  const row = { fixture: f.name, ...Object.fromEntries(keep.filter((k) => r[k] !== undefined).map((k) => [k, r[k]])), consoleErrors: recs[1]?.verdict === "PASS" ? 0 : (recs[1]?.errors?.length ?? "?") };
  rows.push(row);
  console.log(`${row.verdict.padEnd(8)}${f.name} ${JSON.stringify({ ...row, fixture: undefined, verdict: undefined })}`);
  if (!line.includes("User scan") && !line.includes("Scan →")) console.log(line.slice(0, 400));
}
const counts = rows.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] ?? 0) + 1), m), {});
console.log(JSON.stringify(counts));
fs.writeFileSync(path.resolve("qa/evidence/fresh", `fid-scans${suffix}.json`), JSON.stringify({ counts, rows }, null, 2));
