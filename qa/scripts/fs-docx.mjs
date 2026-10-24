// Word → PDF scenarios through the real UI: upload a .docx, Convert to PDF, download, then reopen the PDF
// independently — the shared validator (qpdf + MuPDF + pdf-lib + pdf.js, every page rendered and checked
// for blank pages) and qa/validate/pdfstruct.py (MuPDF text, fonts, sizes, pictures, links, lines,
// bookmarks) — and score it against what the fixture's author wrote (truth.json).
// For visual review, page 1 is shown next to an independent DOCX renderer (docx-preview in Chromium);
// LibreOffice isn't installed here.
//   BASE=http://localhost:3000 node qa/scripts/fs-docx.mjs [mobile] [--only=WORD-05]
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { launch, open, download, rec, save, fs, path, addPaths, createCanvas, loadImage } from "./fl-lib.mjs";

const mobile = process.argv.includes("mobile");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const DIR = path.resolve("qa/fresh-scenario-fixtures/docx");
const truth = JSON.parse(fs.readFileSync(path.join(DIR, "truth.json"), "utf8"));
const RENDER_DIR = path.resolve("qa/review/fresh-launch-polish/word-to-pdf-renders");
fs.mkdirSync(RENDER_DIR, { recursive: true });
const DOCX_PREVIEW = process.env.DOCX_PREVIEW; // path to docx-preview.min.js (QA only; not part of the product)

export const norm = (s) => s.normalize("NFC").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
export const words = (s) => norm(s).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}$€£¥₹]+|[^\p{L}\p{N}%]+$/gu, "")).filter(Boolean);

export function lcs(a, b) {
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

export function accuracy(sourceTexts, gotText) {
  const want = words(sourceTexts.join(" "));
  const got = words(gotText);
  const pool = new Map();
  for (const w of got) pool.set(w, (pool.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want)
    if (pool.get(w)) {
      hit++;
      pool.set(w, pool.get(w) - 1);
    }
  return { recall: +((want.length ? hit / want.length : 1) * 100).toFixed(1), order: +((want.length ? lcs(want, got) / want.length : 1) * 100).toFixed(1) };
}

export const pdfStruct = (file) => JSON.parse(execFileSync("python", ["qa/validate/pdfstruct.py", file], { encoding: "utf8", maxBuffer: 1 << 28 }).trim().split("\n").pop());

function checks(e, s) {
  const c = {};
  const pages = s.pages;
  const all = pages.map((p) => p.text).join("\n");
  const spans = pages.flatMap((p, i) => p.spans.map((x) => ({ ...x, page: i })));
  const spanWith = (t) => spans.find((x) => x.text.includes(t));
  if (e.pages) c.pages = pages.length >= e.pages[0] && pages.length <= e.pages[1];
  if (e.headings) {
    const body = spans.map((x) => x.size).sort((a, b) => a - b)[Math.floor(spans.length / 2)];
    // Word's Heading 3 is body-sized but bold; higher levels are larger.
    c.headings = Object.keys(e.headings).every((h) => (spanWith(h)?.size ?? 0) > body || spanWith(h)?.bold === true);
    c.bookmarks = Object.keys(e.headings).every((h) => s.toc.some(([, title]) => title === h));
  }
  if (e.sizes) c.sizes = e.sizes.every((size) => spans.some((x) => x.text.includes(`set in ${size} point`) && Math.abs(x.size - size) < 0.3));
  if (e.fonts) c.fonts = e.fonts.every((f) => pages.some((p) => p.fonts.some((name) => name.includes(f))));
  if (e.bold) c.bold = spanWith(e.bold)?.bold === true;
  if (e.italic) c.italic = spanWith(e.italic)?.italic === true;
  if (e.underline) c.underline = pages[0].vectorLines > 0;
  if (e.color) c.color = spanWith(e.color)?.color === "c00000";
  if (e.bullets) c.bullets = (all.match(/•/g) ?? []).length >= e.bullets;
  if (e.numbers) c.numbers = e.numbers.every((n) => all.includes(n));
  if (e.nested) {
    const x = (t) => spanWith(t)?.bbox[0] ?? 0;
    c.nested = x("Spare socks") > x("Rain jacket") + 10 && x("Vegetarian options") > x("Order the food") + 10;
  }
  if (e.table) {
    const header = ["Region", "Q1", "Q2", "Q3"].map((t) => spans.find((x) => x.text.trim() === t));
    c.tableRow = header.every(Boolean) && header.every((h) => Math.abs(h.bbox[1] - header[0].bbox[1]) < 2) && header.every((h, i) => i === 0 || h.bbox[0] > header[i - 1].bbox[0]);
    c.tableBorders = pages[0].vectorLines >= (e.table.rows + 1) + (e.table.cols + 1);
  }
  if (e.images) {
    const imgs = pages.flatMap((p) => p.images);
    c.images = imgs.length === e.images;
    if (e.aspects) c.aspect = e.aspects.every((a, i) => imgs[i] && Math.abs((imgs[i].bbox[2] - imgs[i].bbox[0]) / (imgs[i].bbox[3] - imgs[i].bbox[1]) - a) / a < 0.03);
  }
  if (e.perPage) c.perPage = e.perPage.every((t, i) => norm(pages[i]?.text ?? "").includes(t));
  if (e.chars) {
    const missing = e.chars.filter((ch) => !all.includes(ch));
    c.chars = missing.length === 0;
    if (missing.length) c.missingChars = missing.join(" ");
  }
  if (e.align) {
    const W = pages[0].width;
    const [L, R] = e.margins ?? [72, 72];
    c.align = Object.entries(e.align).every(([t, a]) => {
      const b = spanWith(t)?.bbox;
      if (!b) return false;
      return a === "left" ? Math.abs(b[0] - L) < 3 : a === "right" ? Math.abs(b[2] - (W - R)) < 3 : Math.abs((b[0] + b[2]) / 2 - (L + (W - R)) / 2) < 3;
    });
  }
  if (e.justified) {
    const first = spanWith(e.justified);
    const W = pages[0].width;
    const sameLine = spans.filter((x) => first && Math.abs(x.bbox[1] - first.bbox[1]) < 1);
    c.justified = sameLine.length > 0 && Math.abs(Math.max(...sameLine.map((x) => x.bbox[2])) - (W - (e.margins?.[1] ?? 72))) < 3;
  }
  if (e.header) c.header = pages.every((p) => p.text.includes(e.header));
  if (e.footer) c.footer = pages.every((p, i) => p.text.includes(e.footer.replace("{n}", String(i + 1)).replace("{total}", String(pages.length))));
  if (e.bookmarks) c.bookmarkCount = s.toc.length === e.bookmarks;
  if (e.links) c.links = e.links.every((u) => pages.some((p) => p.links.some((l) => l.uri === u)));
  if (e.landscapeLast) c.landscape = pages[pages.length - 1].width > pages[pages.length - 1].height && pages[0].width < pages[0].height;
  if (e.leader) c.leader = /\.{10,}/.test(all);
  return c;
}

async function referenceRender(ctx, docxFile, id) {
  if (!DOCX_PREVIEW) return null;
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1000, height: 1300 });
  await p.setContent("<html><body style='margin:0;background:#ddd'><div id=c></div></body></html>");
  await p.addScriptTag({ path: path.resolve("node_modules/jszip/dist/jszip.min.js") });
  await p.addScriptTag({ path: DOCX_PREVIEW });
  const b64 = fs.readFileSync(docxFile).toString("base64");
  await p.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    await window.docx.renderAsync(new Blob([bytes]), document.getElementById("c"), null, { breakPages: true, ignoreLastRenderedPageBreak: true, inWrapper: true });
  }, b64);
  const first = p.locator("section.docx").first();
  const out = path.join(RENDER_DIR, `${id}-reference.png`);
  if (await first.count()) await first.screenshot({ path: out });
  await p.close();
  return fs.existsSync(out) ? out : null;
}

function ourRender(pdf, id) {
  const out = path.join(RENDER_DIR, `${id}-ours.png`);
  execFileSync("python", ["-c", `import pymupdf,sys; d=pymupdf.open(sys.argv[1]); d[0].get_pixmap(dpi=96).save(sys.argv[2])`, pdf, out]);
  return out;
}

async function sideBySide(ref, ours, id) {
  const a = await loadImage(fs.readFileSync(ref));
  const b = await loadImage(fs.readFileSync(ours));
  const h = Math.max(a.height, b.height) + 40;
  const c = createCanvas(a.width + b.width + 30, h);
  const g = c.getContext("2d");
  g.fillStyle = "#f3f3f3";
  g.fillRect(0, 0, c.width, h);
  g.fillStyle = "#222";
  g.font = "bold 18px sans-serif";
  g.fillText("Independent render (docx-preview)", 10, 26);
  g.fillText("TheFileConvert PDF (MuPDF render)", a.width + 40, 26);
  g.drawImage(a, 0, 40);
  g.drawImage(b, a.width + 30, 40);
  fs.writeFileSync(path.join(RENDER_DIR, `${id}.png`), c.toBuffer("image/png"));
  fs.rmSync(ref);
  fs.rmSync(ours);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { browser, page, errors, ctx } = await launch({ mobile });
  const requests = [];
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));

  for (const [file, t] of Object.entries(truth)) {
    const id = file.replace(/\.docx?$/, "");
    if (only && !id.startsWith(only)) continue;
    const input = path.join(DIR, file);
    const test = `${id}${mobile ? " [mobile]" : ""}`;
    const before = requests.length;
    try {
      await open(page, "/word-to-pdf");
      await addPaths(page, [input]);
      if (t.expect.error) {
        const alert = page.getByRole("alert").filter({ hasText: new RegExp(t.expect.error.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();
        await alert.waitFor({ timeout: 30_000 });
        const message = (await alert.innerText()).trim();
        const convert = await page.getByRole("button", { name: "Convert to PDF" }).count();
        rec("Word to PDF", test, convert === 0 ? "PASS" : "FAIL", { fixture: id, kind: "error", input: fs.statSync(input).size, message, convertOffered: convert > 0 });
        continue;
      }
      await page.getByRole("button", { name: "Convert to PDF" }).waitFor({ timeout: 60_000 });
      const meta = (await page.getByTestId("original-size").innerText()).trim();
      const t0 = Date.now();
      await page.getByRole("button", { name: "Convert to PDF" }).click();
      await Promise.race([page.getByTestId("result").waitFor({ timeout: 300_000 }), page.locator("main").getByRole("alert").first().waitFor({ timeout: 300_000 })]);
      if (!(await page.getByTestId("result").count())) throw new Error(`conversion failed: ${await page.locator("main").getByRole("alert").first().innerText()}`);
      const ms = Date.now() - t0;
      const notes = (await page.getByTestId("notes").allInnerTexts().catch(() => [])).join(" ");
      const out = await download(page, page.getByRole("button", { name: "Download PDF" }), `w2p-${id}${mobile ? "-m" : ""}`);
      const s = pdfStruct(out);
      const text = s.pages.map((p) => p.text).join("\n");
      const acc = t.texts.length ? accuracy(t.texts, text) : null;
      const c = checks(t.expect, s);
      if (!mobile) {
        const ref = await referenceRender(ctx, input, id);
        const ours = ourRender(out, id);
        if (ref) await sideBySide(ref, ours, id);
      }
      const uploads = requests.slice(before).filter((r) => !/^(blob|data):/.test(r.url) && (r.post > 0 || r.method !== "GET" || !r.url.startsWith(new URL(page.url()).origin)));
      const checksOk = Object.entries(c).filter(([k]) => k !== "missingChars").every(([, v]) => v === true);
      const textOk = !acc || (acc.recall >= 98 && acc.order >= 95);
      const verdict = uploads.length ? "FAIL" : checksOk && textOk ? "PASS" : "LIMITED";
      rec("Word to PDF", test, verdict, {
        fixture: id,
        kind: "docx",
        input: fs.statSync(input).size,
        meta,
        ms,
        output: fs.statSync(out).size,
        pages: s.pages.length,
        pictures: s.pages.reduce((n, p) => n + p.images.length, 0),
        links: s.pages.reduce((n, p) => n + p.links.length, 0),
        bookmarks: s.toc.length,
        fonts: [...new Set(s.pages.flatMap((p) => p.fonts.map((f) => f.replace(/^[A-Z]{6}\+/, ""))))],
        ...(acc ?? {}),
        checks: c,
        notes: notes || undefined,
        uploads: uploads.map((u) => `${u.method} ${u.url}`).slice(0, 3),
      });
    } catch (e) {
      rec("Word to PDF", test, "FAIL", { fixture: id, error: String(e).slice(0, 400) });
    }
  }
  rec("Word to PDF", `console errors${mobile ? " [mobile]" : ""}`, errors.length ? "FAIL" : "PASS", errors.length ? { errors: errors.slice(0, 5) } : {});
  await browser.close();
  save(`fs-docx${mobile ? "-mobile" : ""}${only ? "-" + only : ""}`);
}
