// The user's own scanned PDF through /pdf-to-word, for side-by-side review — QA only.
//   LIBREOFFICE=…/soffice.exe BASE=http://localhost:3000 node qa/scripts/fid-userscan.mjs [mobile] [--tag=x] [--file=path.pdf]
//     [--out=dir --name=n --ref=native.pdf]   (used by fid-scans.mjs for the SCAN-WORD fixtures)
// Writes qa/fidelity/user-scan/ (git-ignored — the user's document never enters the repository):
//   word<-tag>.docx, word<-tag>.pdf (LibreOffice render), original-page-N.png, word-page-N.png, diff-page-N.png
// and prints the structural checks from qa/validate/scanform.py.
import { execFileSync } from "node:child_process";
import { launch, open, addPaths, download, rec, save, REAL_SCAN, fs, path } from "./fl-lib.mjs";

const mobile = process.argv.includes("mobile");
const tag = (process.argv.find((a) => a.startsWith("--tag=")) ?? "--tag=").slice(6);
const input = (process.argv.find((a) => a.startsWith("--file=")) ?? `--file=${REAL_SCAN}`).slice(7);
const opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DIR = path.resolve(opt("out") ?? "qa/fidelity/user-scan");
const NAME = opt("name") ?? "word";
const REF = opt("ref");
fs.mkdirSync(DIR, { recursive: true });
const suffix = `${mobile ? "-mobile" : ""}${tag ? "-" + tag : ""}`;

const { browser, page, errors } = await launch({ mobile });
const requests = [];
page.on("request", (r) => requests.push({ url: r.url(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
const stages = [];
try {
  await open(page, "/pdf-to-word");
  await addPaths(page, [input]);
  await page.getByRole("button", { name: "Convert to Word" }).waitFor({ timeout: 60_000 });
  // Record the progress messages the user sees while converting.
  const watch = setInterval(async () => {
    const t = (await page.getByRole("status").allInnerTexts().catch(() => [])).join(" | ").trim();
    if (t && stages[stages.length - 1] !== t) stages.push(t);
  }, 250);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Convert to Word" }).click();
  await Promise.race([page.getByTestId("result").waitFor({ timeout: 600_000 }), page.locator("main").getByRole("alert").first().waitFor({ timeout: 600_000 })]);
  clearInterval(watch);
  const ms = Date.now() - t0;
  if (!(await page.getByTestId("result").count())) throw new Error(await page.locator("main").getByRole("alert").first().innerText());
  const got = await download(page, page.getByRole("button", { name: "Download .docx" }), `userscan${suffix}`);
  const docx = path.join(DIR, `${NAME}${suffix}.docx`);
  fs.copyFileSync(got, docx);
  execFileSync("python", ["qa/validate/lo.py", "pdf", DIR, docx], { stdio: "pipe", timeout: 600_000 });
  const pdf = docx.replace(/\.docx$/, ".pdf");
  const report = JSON.parse(execFileSync("python", ["qa/validate/scanform.py", input, pdf, docx, "--dir", DIR, `--suffix=${suffix}`, ...(REF ? ["--ref", REF] : []), ...(input === REAL_SCAN && fs.existsSync(path.join(DIR, "expect.json")) ? ["--expect", path.join(DIR, "expect.json")] : [])], { encoding: "utf8", maxBuffer: 32 << 20 }).trim().split("\n").pop());
  const origin = new URL(page.url()).origin;
  const uploads = requests.filter((q) => q.post > 0 || !(q.url.startsWith(origin) || /^(blob|data):/.test(q.url)));
  rec(REF ? "Scan → Word" : "User scan → Word", `${path.basename(input)}${mobile ? " [mobile]" : ""}`, uploads.length ? "FAIL" : report.overall, { ms, stages, uploads: uploads.length, ...report });
} catch (e) {
  rec("User scan → Word", `${path.basename(input)}${mobile ? " [mobile]" : ""}`, "FAIL", { error: String(e).slice(0, 400) });
}
rec("User scan → Word", "console errors", errors.length ? "FAIL" : "PASS", { errors: errors.slice(0, 3) });
await browser.close();
save(opt("name") ? `fid-scan-${NAME}${suffix}` : `fid-userscan${suffix}`);
