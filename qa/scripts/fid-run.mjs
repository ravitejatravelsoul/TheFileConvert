// Fidelity audit for the document conversions, through the real UI.
//   PDF → Word: upload the PDF, download the .docx, render it with LibreOffice (independent), compare the
//               render with the original PDF word by word (qa/validate/layoutdiff.py) + structure checks.
//   Word → PDF: upload the .docx, download the PDF, compare it with LibreOffice's rendering of the same .docx.
//   Round trips: PDF → Word → PDF and Word → PDF → Word, each stage compared with the original.
//
//   LIBREOFFICE=…/soffice.exe BASE=http://localhost:3000 node qa/scripts/fid-run.mjs [p2w|w2p|rt|all] [mobile] [--only=name] [--tag=before]
import { execFileSync } from "node:child_process";
import { launch, open, download, rec, save, fs, path, addPaths } from "./fl-lib.mjs";
import { accuracy } from "./fs-docx.mjs";

const args = process.argv.slice(2);
const which = args.find((a) => ["p2w", "w2p", "rt", "all"].includes(a)) ?? "all";
const mobile = args.includes("mobile");
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const tag = args.find((a) => a.startsWith("--tag="))?.slice(6) ?? "";
const CORPUS = path.resolve("qa/fidelity/corpus");
const WORDFIX = path.resolve("qa/fresh-scenario-fixtures/word");
const OUTDIR = path.resolve("qa/fidelity");
const WORK = path.join(OUTDIR, "_work");
fs.mkdirSync(WORK, { recursive: true });

const py = (script, ...a) => JSON.parse(execFileSync("python", [script, ...a], { encoding: "utf8", maxBuffer: 1 << 28 }).trim().split("\n").pop());
const lo = (outdir, files) => execFileSync("python", ["qa/validate/lo.py", "pdf", outdir, ...files], { stdio: "pipe", timeout: 900_000 });
const layoutdiff = (src, out, dir, name) => py("qa/validate/layoutdiff.py", src, out, "--images", dir, "--name", name);
const docx = (f) => py("qa/validate/docxcheck.py", f);

// ---------------------------------------------------------------- verdicts (tool-specific thresholds)
const band = (v, pass, limited) => (v === null || v === undefined ? "n/a" : v >= pass ? "PASS" : v >= limited ? "LIMITED" : "FAIL");
const worst = (...vs) => (vs.includes("FAIL") ? "FAIL" : vs.includes("LIMITED") ? "LIMITED" : "PASS");

/** PDF → Word rebuilds an editable flow: positions may move a little, structure and look must hold. */
function gradeP2W(m, s) {
  const text = m.textRecall >= 98 ? "PASS" : m.textRecall >= 90 ? "LIMITED" : "FAIL";
  const layout = worst(m.srcPages === m.outPages ? "PASS" : Math.abs(m.srcPages - m.outPages) <= 1 ? "LIMITED" : "FAIL", band(m.samePage, 95, 85), band(m.within36pt, 85, 60), band(m.lineKept, 80, 60));
  const formatting = worst(band(m.sizeAbsKept, 90, 70), band(m.boldKept, 90, 70), band(m.italicKept, 90, 70), m.falseBold <= 5 ? "PASS" : m.falseBold <= 15 ? "LIMITED" : "FAIL", band(m.colorKept, 80, 50));
  const images = m.imagesSrc === 0 ? "n/a" : m.imagesOut !== m.imagesSrc ? "FAIL" : band(m.imageIoU, 0.6, 0.3);
  // Fewer tables than the source is LIMITED when everything still sits where it was (a table used only
  // to place pictures side by side became positioned pictures), FAIL when the layout suffered too.
  const tables = s.tablesSrc === undefined || s.tablesSrc === 0 ? "n/a" : s.tablesOut >= s.tablesSrc ? band(m.within36pt, 80, 50) : layout === "PASS" ? "LIMITED" : "FAIL";
  return { text, layout, formatting, images, tables, overall: worst(text, layout, formatting, images === "n/a" ? "PASS" : images, tables === "n/a" ? "PASS" : tables) };
}

/** Word → PDF should look like the document: judged against LibreOffice's rendering of the same file. */
function gradeW2P(m, lines) {
  const text = m.textRecall >= 99 ? "PASS" : m.textRecall >= 95 ? "LIMITED" : "FAIL";
  const layout = worst(m.srcPages === m.outPages ? "PASS" : Math.abs(m.srcPages - m.outPages) <= 1 ? "LIMITED" : "FAIL", band(m.samePage, 97, 85), band(m.within12pt, 85, 60), band(m.lineKept, 90, 75));
  const formatting = worst(band(m.sizeAbsKept, 97, 85), band(m.boldKept, 97, 85), band(m.italicKept, 97, 85), m.falseBold <= 2 ? "PASS" : m.falseBold <= 10 ? "LIMITED" : "FAIL", band(m.colorKept, 95, 75));
  const images = m.imagesSrc === 0 ? "n/a" : m.imagesOut !== m.imagesSrc ? "FAIL" : band(m.imageIoU, 0.75, 0.4);
  // Tables: the source's ruled lines drawn at the same place (whatever pieces they're cut into), and the
  // text inside them where it was.
  const tables = lines.ref === 0 || m.rulesKept === null ? "n/a" : worst(band(m.rulesKept, 90, 70), band(m.within12pt, 80, 55));
  return { text, layout, formatting, images, tables, overall: worst(text, layout, formatting, images === "n/a" ? "PASS" : images, tables === "n/a" ? "PASS" : tables) };
}

const vectorLines = (pdf) => py("qa/validate/pdfstruct.py", pdf).pages.reduce((n, p) => n + p.vectorLines, 0);

// ---------------------------------------------------------------- the files
const corpus = fs.readdirSync(CORPUS).filter((f) => f.endsWith(".docx")).map((f) => f.replace(/\.docx$/, ""));
const pdfCases = [
  ...corpus.map((n) => ({ name: n, pdf: path.join(CORPUS, `${n}.pdf`), docx: path.join(CORPUS, `${n}.docx`), source: "LibreOffice PDF of the realistic .docx" })),
  ...fs
    .readdirSync(WORDFIX)
    .filter((f) => /^PDF-WORD-(0[1-9]|1[0-3]).*\.pdf$/.test(f))
    .map((f) => ({ name: f.replace(/\.pdf$/, ""), pdf: path.join(WORDFIX, f), docx: null, source: "Chromium-printed / scanned fixture" })),
].filter((c) => !only || c.name.startsWith(only));
const docxCases = corpus.filter((n) => !only || n.startsWith(only)).map((n) => ({ name: n, docx: path.join(CORPUS, `${n}.docx`), ref: path.join(CORPUS, `${n}.pdf`) }));

const { browser, page, errors } = await launch({ mobile });
page.on("dialog", (d) => d.accept());
const requests = [];
page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
const uploadsSince = (n) => requests.slice(n).filter((r) => !/^(blob|data):/.test(r.url) && (r.post > 0 || r.method !== "GET" || !r.url.startsWith(new URL(page.url()).origin)));
const suffix = `${mobile ? "-m" : ""}${tag ? "-" + tag : ""}`;

async function toWord(pdf, name) {
  await open(page, "/pdf-to-word");
  await addPaths(page, [pdf]);
  await page.getByRole("button", { name: "Convert to Word" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Convert to Word" }).click();
  await Promise.race([page.getByTestId("result").waitFor({ timeout: 600_000 }), page.locator("main").getByRole("alert").first().waitFor({ timeout: 600_000 })]);
  if (!(await page.getByTestId("result").count())) throw new Error(await page.locator("main").getByRole("alert").first().innerText());
  return download(page, page.getByRole("button", { name: "Download .docx" }), `fid-${name}${suffix}`);
}
async function toPdf(docxFile, name) {
  await open(page, "/word-to-pdf");
  await addPaths(page, [docxFile]);
  await page.getByRole("button", { name: "Convert to PDF" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Convert to PDF" }).click();
  await Promise.race([page.getByTestId("result").waitFor({ timeout: 300_000 }), page.locator("main").getByRole("alert").first().waitFor({ timeout: 300_000 })]);
  if (!(await page.getByTestId("result").count())) throw new Error(await page.locator("main").getByRole("alert").first().innerText());
  return download(page, page.getByRole("button", { name: "Download PDF" }), `fid-${name}${suffix}`);
}
/** LibreOffice renders a .docx; the file keeps the .docx's base name. */
function render(docxFile, dir) {
  lo(dir, [docxFile]);
  return path.join(dir, path.basename(docxFile).replace(/\.docx$/, ".pdf"));
}

function structure(srcDocx, outDocx) {
  const o = docx(outDocx);
  const s = srcDocx ? docx(srcDocx) : null;
  const out = { tablesOut: o.tables?.length ?? 0, picturesOut: o.pictures?.length ?? 0, headingsOut: o.paragraphs.filter((p) => /^(Heading|Title)/.test(p.style ?? "")).length, listItemsOut: o.paragraphs.filter((p) => p.list).length, docxValid: o.ok };
  if (s) {
    const heads = s.paragraphs.filter((p) => /^(Heading|Title)/.test(p.style ?? "")).map((p) => p.text.trim());
    Object.assign(out, {
      tablesSrc: s.tables?.length ?? 0,
      headingsSrc: heads.length,
      headingsKept: heads.filter((h) => o.paragraphs.some((p) => p.text.trim() === h && /^(Heading|Title)/.test(p.style ?? ""))).length,
      listItemsSrc: s.paragraphs.filter((p) => p.list).length,
    });
  }
  return out;
}

if (which === "p2w" || which === "all") {
  const dir = path.join(OUTDIR, "pdf-to-word");
  for (const c of pdfCases) {
    const before = requests.length;
    try {
      const t0 = Date.now();
      const out = await toWord(c.pdf, c.name);
      const ms = Date.now() - t0;
      const rendered = render(out, path.join(WORK, `p2w${suffix}`));
      const m = layoutdiff(c.pdf, rendered, dir, `${c.name}${suffix}`);
      const s = structure(c.docx, out);
      let g = gradeP2W(m, s);
      if (m.srcWords < 5) {
        // A scan has no text layer to compare positions with: grade the recognised text against the
        // fixture's ground truth; layout can't be measured word by word.
        const truth = JSON.parse(fs.readFileSync(path.join(WORDFIX, "truth.json"), "utf8")).find((t) => c.pdf.endsWith(t.file));
        const got = py("qa/validate/pdfstruct.py", rendered).pages.map((p) => p.text).join(" ");
        const acc = truth ? accuracy(truth.blocks.map((b) => b.text), got) : null;
        m.ocrRecall = acc?.recall;
        m.ocrOrder = acc?.order;
        const text = !acc ? "n/a" : acc.recall >= 90 ? "PASS" : acc.recall >= 75 ? "LIMITED" : "FAIL";
        g = { text, layout: "n/a", formatting: "n/a", images: "n/a", tables: "n/a", overall: text === "n/a" ? "LIMITED" : text };
      }
      const uploads = uploadsSince(before);
      rec("PDF → Word fidelity", `${c.name}${mobile ? " [mobile]" : ""}`, uploads.length ? "FAIL" : g.overall, { source: c.source, ms, ...g, metrics: m, structure: s, uploads: uploads.length });
    } catch (e) {
      rec("PDF → Word fidelity", c.name, "FAIL", { error: String(e).slice(0, 300) });
    }
  }
}

if (which === "w2p" || which === "all") {
  const dir = path.join(OUTDIR, "word-to-pdf");
  for (const c of docxCases) {
    const before = requests.length;
    try {
      const t0 = Date.now();
      const out = await toPdf(c.docx, c.name);
      const ms = Date.now() - t0;
      const m = layoutdiff(c.ref, out, dir, `${c.name}${suffix}`);
      const lines = { ref: vectorLines(c.ref), out: vectorLines(out) };
      const g = gradeW2P(m, lines);
      const uploads = uploadsSince(before);
      rec("Word → PDF fidelity", `${c.name}${mobile ? " [mobile]" : ""}`, uploads.length ? "FAIL" : g.overall, { ms, ...g, metrics: m, lines, uploads: uploads.length });
    } catch (e) {
      rec("Word → PDF fidelity", c.name, "FAIL", { error: String(e).slice(0, 300) });
    }
  }
}

if (which === "rt" || which === "all") {
  const dir = path.join(OUTDIR, "round-trip");
  const set = ["resume", "invoice", "letter", "table-report", "image-heavy"].filter((n) => !only || n.startsWith(only));
  for (const n of set) {
    try {
      // PDF → Word → PDF: the realistic PDF, to Word, back to PDF with our own Word to PDF.
      const docxOut = await toWord(path.join(CORPUS, `${n}.pdf`), `rt1-${n}`);
      const pdfBack = await toPdf(docxOut, `rt1-${n}`);
      const m1 = layoutdiff(path.join(CORPUS, `${n}.pdf`), pdfBack, dir, `pdf-word-pdf-${n}${suffix}`);
      rec("Round trip PDF → Word → PDF", n, gradeP2W(m1, {}).overall, { ...gradeP2W(m1, {}), metrics: m1 });
      // Word → PDF → Word: our PDF, back to Word, rendered by LibreOffice, compared with the original .docx's rendering.
      const pdfOut = await toPdf(path.join(CORPUS, `${n}.docx`), `rt2-${n}`);
      const docxBack = await toWord(pdfOut, `rt2-${n}`);
      const rendered = render(docxBack, path.join(WORK, `rt2${suffix}`));
      const m2 = layoutdiff(path.join(CORPUS, `${n}.pdf`), rendered, dir, `word-pdf-word-${n}${suffix}`);
      const s2 = structure(path.join(CORPUS, `${n}.docx`), docxBack);
      rec("Round trip Word → PDF → Word", n, gradeP2W(m2, s2).overall, { ...gradeP2W(m2, s2), metrics: m2, structure: s2 });
    } catch (e) {
      rec("Round trip", n, "FAIL", { error: String(e).slice(0, 300) });
    }
  }
}

rec("Fidelity run", `console errors${mobile ? " [mobile]" : ""}`, errors.length ? "FAIL" : "PASS", errors.length ? { errors: errors.slice(0, 5) } : {});
await browser.close();
save(`fid-${which}${suffix}${only ? "-" + only : ""}`);
