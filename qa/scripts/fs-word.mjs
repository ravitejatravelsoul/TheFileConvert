// PDF → Word scenarios through the real UI: upload, Convert to Word, download .docx, then reopen it
// independently (docxcheck.py: OOXML package + python-docx; mammoth.js: a second DOCX reader, also used
// to render the document for visual review) and score it against the fixture's ground truth.
//   BASE=http://localhost:3000 node qa/scripts/fs-word.mjs [mobile] [--only=PDF-WORD-05]
import { execFileSync, execSync } from "node:child_process";
import { launch, open, download, rec, save, fs, path, OUT, REAL_SCAN } from "./fl-lib.mjs";

const mobile = process.argv.includes("mobile");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const DIR = path.resolve("qa/fresh-scenario-fixtures/word");
const truth = JSON.parse(fs.readFileSync(path.join(DIR, "truth.json"), "utf8"));
const RENDER_DIR = path.resolve("qa/review/fresh-launch-polish/pdf-to-word-renders");
fs.mkdirSync(RENDER_DIR, { recursive: true });

const norm = (s) => s.normalize("NFC").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const words = (s) => norm(s).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}$€£¥₹]+|[^\p{L}\p{N}%]+$/gu, "")).filter(Boolean);

function lcs(a, b) {
  // O(n·m) with two rows; inputs are at most a few thousand words.
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

function metrics(t, docx) {
  const want = words(t.blocks.map((b) => b.text).join(" "));
  const got = words(docx.text ?? "");
  const pool = new Map();
  for (const w of got) pool.set(w, (pool.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want)
    if (pool.get(w)) {
      hit++;
      pool.set(w, pool.get(w) - 1);
    }
  const recall = want.length ? hit / want.length : 1;
  const order = want.length ? lcs(want, got) / want.length : 1;
  // Paragraph separation: each source block should sit in one Word paragraph, not merged with the next.
  const paras = (docx.paragraphs ?? []).map((p) => words(p.text).join(" "));
  const tableRows = (docx.tables ?? []).flat().map((r) => words(r.join(" ")).join(" "));
  const all = [...paras, ...tableRows];
  let intact = 0;
  let merged = 0;
  const owners = new Map();
  let from = 0;
  for (const b of t.blocks) {
    const bw = words(b.text).join(" ");
    if (!bw) continue;
    // Search forward from the last match, so repeated text on later pages matches later paragraphs.
    let idx = all.findIndex((p, k) => k >= from && p.includes(bw));
    if (idx < 0) idx = all.findIndex((p) => p.includes(bw));
    if (idx >= 0) from = idx;
    if (idx >= 0) {
      intact++;
      if (b.tag !== "tr" && owners.has(idx)) merged++;
      owners.set(idx, true);
    }
  }
  const blocks = t.blocks.filter((b) => words(b.text).length).length;
  return { recall: +(recall * 100).toFixed(1), order: +(order * 100).toFixed(1), paragraphsIntact: `${intact}/${blocks}`, merged, separation: +(((intact - merged) / Math.max(1, blocks)) * 100).toFixed(1) };
}

function structure(t, docx) {
  const checks = {};
  const paras = docx.paragraphs ?? [];
  const text = docx.text ?? "";
  if (t.headings) checks.headings = t.headings.every((h) => paras.some((p) => /^Heading/.test(p.style ?? "") && p.text.trim() === h));
  if (t.headingLevels) checks.headingLevels = Object.entries(t.headingLevels).every(([h, lvl]) => paras.some((p) => p.text.trim() === h && p.style === `Heading ${lvl}`));
  if (t.bold) checks.bold = t.bold.every((b) => paras.some((p) => p.bold.join("").includes(b)));
  if (t.italic) checks.italic = t.italic.every((b) => paras.some((p) => p.italic.join("").includes(b)));
  if (t.bullets) checks.bullets = JSON.stringify(paras.filter((p) => p.list === "bullet").map((p) => p.text.trim())) === JSON.stringify(t.bullets);
  if (t.numbered) checks.numbered = JSON.stringify(paras.filter((p) => p.list === "decimal").map((p) => p.text.trim())) === JSON.stringify(t.numbered);
  if (t.table) checks.table = (docx.tables ?? []).some((tb) => JSON.stringify(tb.map((r) => r.map((c) => c.trim()))) === JSON.stringify(t.table));
  if (t.images) {
    const pics = docx.pictures ?? [];
    checks.images = pics.length === t.images.length && t.images.every((im, i) => pics[i] && Math.abs(pics[i].w_pt / pics[i].h_pt - im.aspect) / im.aspect < 0.03);
  }
  if (t.mustContain) {
    const missing = t.mustContain.filter((s) => !text.includes(s));
    checks.mustContain = missing.length === 0;
    if (missing.length) checks.missing = missing;
  }
  // One page-starting section per PDF page (continuous sections only switch to columns inside a page).
  if (t.pages) checks.pageBreaks = (docx.sections ?? []).filter((sec, i) => i === 0 || sec.newPage !== false).length === t.pages;
  if (t.id === "PDF-WORD-08") {
    const order = ["Community Newsletter", ...[1, 2, 3, 4, 5].map((n) => `Left ${n}:`), ...[1, 2, 3, 4, 5].map((n) => `Right ${n}:`)].map((s) => text.indexOf(s));
    checks.readingOrder = order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]));
  }
  return checks;
}

function mammoth(docxFile, id) {
  const html = path.join(RENDER_DIR, `${id}.html`);
  try {
    execSync(`npx -y mammoth@1.8.0 "${docxFile}" "${html}"`, { stdio: "pipe" });
    const body = fs.readFileSync(html, "utf8");
    const text = body.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ");
    return { ok: true, html, text, headings: (body.match(/<h[1-6]/g) ?? []).length, lists: (body.match(/<(ul|ol)>/g) ?? []).length, tables: (body.match(/<table>/g) ?? []).length, images: (body.match(/<img /g) ?? []).length };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

const { browser, page, errors, ctx } = await launch({ mobile });
const requests = [];
page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
const renderPage = await ctx.newPage();

const cases = truth.filter((t) => !only || t.id === only);
if (!only || only === "REAL") cases.push({ id: "REAL user scan", file: REAL_SCAN, kind: "scanned", pages: 2, blocks: [], mustContain: ["12/20/2026"], abs: true });
for (const t of cases) {
  const input = t.abs ? t.file : path.join(DIR, t.file);
  const test = `${t.id} ${t.what ?? "user-supplied scan"}${mobile ? " [mobile]" : ""}`;
  const before = requests.length;
  try {
    await open(page, "/pdf-to-word");
    await page.getByTestId("file-input").first().setInputFiles(input);
    if (t.kind === "corrupt") {
      await page.getByRole("alert").filter({ hasText: /couldn.t be read|damaged/i }).first().waitFor({ timeout: 30_000 });
      const msg = await page.getByRole("alert").filter({ hasText: /couldn.t be read|damaged/i }).first().innerText();
      const convertShown = await page.getByRole("button", { name: "Convert to Word" }).count();
      rec("PDF to Word", test, convertShown === 0 ? "PASS" : "FAIL", { input: fs.statSync(input).size, message: msg, convertOffered: convertShown > 0 });
      continue;
    }
    await page.getByRole("button", { name: "Convert to Word" }).waitFor({ timeout: 60_000 });
    const meta = (await page.getByTestId("original-size").innerText()).trim();
    const ocrNote = await page.getByTestId("ocr-note").count();
    const labels = [];
    const t0 = Date.now();
    await page.getByRole("button", { name: "Convert to Word" }).click();
    // Record the progress labels a person would see.
    const poll = setInterval(async () => {
      const l = await page.locator('[role="status"] p').first().innerText().catch(() => "");
      if (l && labels[labels.length - 1] !== l) labels.push(l);
    }, 250);
    await Promise.race([page.getByTestId("result").waitFor({ timeout: 600_000 }), page.locator("main").getByRole("alert").first().waitFor({ timeout: 600_000 })]);
    clearInterval(poll);
    if (!(await page.getByTestId("result").count())) throw new Error(`conversion failed: ${await page.locator("main").getByRole("alert").first().innerText()}`);
    const ms = Date.now() - t0;
    const out = await download(page, page.getByRole("button", { name: "Download .docx" }), `word-${t.id.replace(/\W+/g, "")}${mobile ? "-m" : ""}`);
    const d = JSON.parse(execFileSync("python", ["qa/validate/docxcheck.py", out], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n").pop());
    const m = t.blocks.length ? metrics(t, d) : null;
    const s = structure(t, d);
    const mm = mammoth(out, `${t.id.replace(/\W+/g, "")}${mobile ? "-m" : ""}`);
    if (mm.ok && !mobile) {
      await renderPage.goto("file:///" + mm.html.replace(/\\/g, "/"));
      await renderPage.addStyleTag({ content: "body{font-family:Arial;max-width:760px;margin:40px auto;line-height:1.45} img{max-width:100%} table{border-collapse:collapse} td{border:1px solid #bbb;padding:4px 8px}" });
      await renderPage.screenshot({ path: path.join(RENDER_DIR, `${t.id.replace(/\W+/g, "")}.png`), fullPage: true });
    }
    const mammothRecall = mm.ok && t.blocks.length ? (() => {
      const want = words(t.blocks.map((b) => b.text).join(" "));
      const got = new Set(words(mm.text));
      return +((want.filter((w) => got.has(w)).length / want.length) * 100).toFixed(1);
    })() : null;
    const uploads = requests.slice(before).filter((r) => !/^(blob|data):/.test(r.url) && (r.post > 0 || r.method !== "GET" || !r.url.startsWith(new URL(page.url()).origin)));
    const structureOk = Object.entries(s).filter(([k]) => k !== "missing").every(([, v]) => v === true);
    const nativeGood = !m || t.kind !== "native" || (m.recall >= 98 && m.order >= 95);
    const ocrGood = !m || t.kind === "native" || m.recall >= 90;
    const separated = !m || m.separation >= 85;
    const verdict = !d.ok || !mm.ok || uploads.length ? "FAIL" : structureOk && nativeGood && ocrGood && separated ? "PASS" : "LIMITED";
    rec("PDF to Word", test, verdict, {
      fixture: t.id,
      kind: t.kind,
      inputPages: t.pages,
      input: fs.statSync(input).size,
      meta,
      ocrNote: ocrNote > 0,
      progress: labels.slice(0, 8),
      ms,
      output: fs.statSync(out).size,
      docxValid: d.ok,
      problems: d.problems.slice(0, 3),
      paragraphs: d.paragraphs?.length,
      tables: d.tables?.length,
      pictures: d.pictures?.length,
      sections: d.sections?.length,
      ...(m ?? {}),
      structure: s,
      mammoth: mm.ok ? { recall: mammothRecall, headings: mm.headings, lists: mm.lists, tables: mm.tables, images: mm.images } : mm,
      uploads: uploads.map((u) => `${u.method} ${u.url}`).slice(0, 3),
    });
  } catch (e) {
    rec("PDF to Word", test, "FAIL", { error: String(e).slice(0, 400) });
  }
}
rec("PDF to Word", `console errors${mobile ? " [mobile]" : ""}`, errors.length ? "FAIL" : "PASS", errors.length ? { errors: errors.slice(0, 5) } : {});
await browser.close();
save(`fs-word${mobile ? "-mobile" : ""}${only ? "-" + only : ""}`);
