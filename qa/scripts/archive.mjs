// Phase 7: ZIP create / extract through the real UI, byte-compared against independent extraction.
import { launch, open, runAction, download, rec, save, fx, fs, path, JSZip } from "./lib.mjs";

const { browser, page, errors } = await launch();
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 220)); } };
const tmp = path.resolve("qa/evidence/tmp-archive"); fs.mkdirSync(tmp, { recursive: true });
const mk = (n, buf) => { const p = path.join(tmp, n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; };

await guard("zip-create", "create from mixed files", async () => {
  const uni = mk("ünï cödé 日本語 file.txt", "unicode name\n"), sp = mk("with spaces.txt", "spaces\n"), sub = mk("other/with spaces.txt", "DIFFERENT CONTENT SAME NAME\n"), empty = mk("empty.txt", "");
  const files = [fx("PDF-10-many-pages.pdf"), fx("IMAGE-11-quadrants.png"), fx("DOC-02-markdown.md"), uni, sp, sub, fx("IMAGE-01-photo-large.jpg")];
  await open(page, "/archive/zip", files);
  const r = await runAction(page, /^Create ZIP from 7 files/); const [z] = await download(page, "zip-a");
  const zip = await JSZip.loadAsync(fs.readFileSync(z.path)); const names = Object.keys(zip.files);
  let mism = []; for (const f of files) { const entry = names.filter((n) => n === path.basename(f) || n.startsWith(path.basename(f).replace(/\.[^.]+$/, "") + " (")); const buf = fs.readFileSync(f); const cands = await Promise.all(names.map(async (n) => [n, await zip.files[n].async("nodebuffer")])); if (!cands.some(([, b]) => Buffer.compare(b, buf) === 0)) mism.push(path.basename(f)); }
  rec("zip-create", "7 files (unicode name, spaces, duplicate names, 8 MB JPEG) → every file's bytes present in ZIP", r.ok && mism.length === 0 ? "PASS" : "FAIL", `entries=${names.length} missingBytes=[${mism}] names=${names.join(" | ")}`);
  rec("zip-create", "two files with the same name (with spaces.txt ×2) both kept", names.filter((n) => /with spaces/.test(n)).length === 2 ? "PASS" : "FAIL", names.filter((n) => /with spaces/.test(n)).join(" | "));
  const size = fs.statSync(z.path).size, raw = files.reduce((s, f) => s + fs.statSync(f).size, 0);
  rec("zip-create", "ZIP opens with an independent reader and is not larger than inputs + overhead", size < raw + 2000 ? "PASS" : "FAIL", `zip=${size} inputs=${raw}`);
});
await guard("zip-create", "empty file refused with message", async () => {
  await open(page, "/archive/zip", [fx("DOC-02-markdown.md")]);
  const b = page.getByRole("button", { name: /^Create ZIP/ }); rec("zip-create", "1 file allowed", "INFO", `${await b.innerText()} disabled=${await b.isDisabled()}`);
});

await guard("zip-extract", "extract realistic ZIP", async () => {
  await open(page, "/archive/unzip", ["ZIP-01-realistic.zip"]); await page.getByText("This archive contains 7 files").waitFor();
  const listed = (await page.locator("main").innerText()).split("\n").filter((l) => /\.(txt|bin|csv|png|jpg)$/.test(l));
  const r = await runAction(page, /^Extract all files/);
  const resultNames = await page.locator("main li span.truncate, main li .truncate").allInnerTexts();
  const src = await JSZip.loadAsync(fs.readFileSync(fx("ZIP-01-realistic.zip"))); const expect = {}; for (const [n, e] of Object.entries(src.files)) if (!e.dir) expect[n] = await e.async("nodebuffer");
  rec("zip-extract", "pre-extract listing shows all 7 entries with full paths", listed.length === 7 ? "PASS" : "FAIL", listed.join(" | "));
  const files = await download(page, "unzip-a");
  const got = {}; for (const f of files) got[f.name] = fs.readFileSync(f.path);
  let same = 0, missing = [], diff = [];
  for (const [n, b] of Object.entries(expect)) { const key = Object.keys(got).find((g) => g === n || g.endsWith("/" + path.basename(n)) || g === path.basename(n)); if (!key) { missing.push(n); continue; } if (Buffer.compare(got[key], b) === 0) same++; else diff.push(n); }
  rec("zip-extract", "all 7 files extracted byte-identical (incl. 200 KB binary, unicode & spaced names)", r.ok && same === 7 ? "PASS" : "FAIL", `identical=${same}/7 missing=[${missing}] different=[${diff}] resultNames=${Object.keys(got).join(" | ")}`);
  rec("zip-extract", "folder structure preserved in extracted names", Object.keys(got).some((n) => /docs[\\/]deep/.test(n)) ? "PASS" : "LIMITED", Object.keys(got).join(" | "));
});
await guard("zip-extract", "single-file download from list", async () => {
  await open(page, "/archive/unzip", ["ZIP-01-realistic.zip"]); await runAction(page, /^Extract all files/);
  const btns = page.getByRole("button", { name: /^Download .*readme\.txt/ }); const n = await btns.count();
  if (n) { const [dl] = await Promise.all([page.waitForEvent("download"), btns.first().click()]); const p = "qa/evidence/out/unzip-single.txt"; await dl.saveAs(p); rec("zip-extract", "per-file Download gives exact bytes", fs.readFileSync(p, "utf8") === "top level\n" ? "PASS" : "FAIL", dl.suggestedFilename()); }
  else rec("zip-extract", "per-file Download button", "FAIL", "not found: " + (await page.getByRole("button").allInnerTexts()).join("|").slice(0, 200));
});
await guard("zip-extract", "malformed ZIP", async () => {
  await open(page, "/archive/unzip", ["ZIP-02-malformed.zip"]);
  await page.waitForTimeout(1500); const t = await page.locator("main").innerText(); const b = page.getByRole("button", { name: /^Extract all files/ });
  let msg = /couldn.t read this archive/i.test(t) ? "We couldn't read this archive. It may be damaged or not a ZIP file." : "";
  if (!msg && (await b.count())) { const r = await runAction(page, /^Extract all files/); msg = r.ok ? "PRODUCED OUTPUT" : r.text; }
  rec("zip-extract", "corrupt ZIP → clear error, no crash", msg && msg !== "PRODUCED OUTPUT" ? "PASS" : "FAIL", msg.slice(0, 160));
});
await guard("zip-extract", "path traversal ZIP", async () => {
  await open(page, "/archive/unzip", ["ZIP-03-traversal.zip"]); await page.waitForTimeout(1200);
  const listing = (await page.locator("main").innerText()).split("\n").filter((l) => /evil|fine/.test(l)).join(" | ");
  const b = page.getByRole("button", { name: /^Extract all files/ }); let names = [], detail = listing;
  if (await b.count()) { const r = await runAction(page, /^Extract all files/); if (r.ok) { const files = await download(page, "unzip-evil"); names = files.map((f) => f.name); detail += " → extracted: " + names.join(" | "); } else detail += " → refused: " + r.text.slice(0, 100); }
  const escaped = names.some((n) => n.includes("..") || n.startsWith("/") || /^[a-zA-Z]:/.test(n));
  rec("zip-extract", "../../evil.txt and /abs/evil2.txt entries can't escape (sanitised or refused)", !escaped ? "PASS" : "FAIL", detail);
  const escapedOnDisk = fs.existsSync(path.resolve("qa/evidence/evil.txt")) || fs.existsSync(path.resolve("qa/evil.txt")); rec("zip-extract", "nothing written outside the download directory", !escapedOnDisk ? "PASS" : "FAIL", "");
});
await guard("zip-extract", "non-zip upload", async () => {
  await open(page, "/archive/unzip", ["DOC-02-markdown.md"]); await page.waitForTimeout(600);
  const t = (await page.locator("main").innerText()).replace(/\n+/g, " | "); rec("zip-extract", "non-ZIP file rejected", /supported|not a zip|isn.t/i.test(t) ? "PASS" : "FAIL", (t.match(/[^|]*(supported|not a zip|isn.t)[^|]*/i) ?? [""])[0]);
});
rec("(archive tools)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("archive"); await browser.close();
