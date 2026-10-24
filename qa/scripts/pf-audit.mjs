// PROCESSING-FLOW AUDIT — "click once, then hands off", for every first-launch tool.
//
//   BASE=http://127.0.0.1:3100 node qa/scripts/pf-audit.mjs [tool|all] [--modes=normal,starved] [--only=text] [--tag=x]
//
// For each case the inputs are set up the way a person does (add the file, choose an option), the primary action is
// pressed ONCE, and then nothing at all is touched — no click, key, mouse move, focus change or resize — until the
// result appears or the time runs out. The result must appear by itself.
//
// Modes:
//   normal    an ordinary foreground tab.
//   starved   the browser stops delivering animation frames right after the click and does not resume until the
//             user interacts with the page — what a tab behind another tab / a covered or minimised window gets.
//             (This is the exact condition that made PDF → Word sit at "Recognizing page 1 of 1…" until a click.)
// Each case is run cold (a fresh browser context: empty HTTP cache, no warm OCR/pdf.js state) and warm (the same
// context again). The downloaded output is checked by the shared output validator.
//
// Writes qa/evidence/fresh/pf-audit-<tag>.json; qa/scripts/pf-report.mjs turns it into qa/PROCESSING_FLOW_AUDIT.md.
import { execFileSync } from "node:child_process";
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { validateFile } from "./validate-output.mjs";

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith("--")) ?? "all";
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const modes = opt("modes", "normal,starved").split(",");
const only = opt("only", "");
const tag = opt("tag", "final");
const base = process.env.BASE ?? "http://127.0.0.1:3100";
const RUF = (n) => path.resolve("qa/real-user-fixtures", n);
const REAL_SCAN = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf"; // the only permitted Downloads file
const OUTDIR = path.resolve("qa/evidence/fresh/out");
const WORK = path.resolve("qa/fidelity/_work/pf");
fs.mkdirSync(OUTDIR, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });
const KB = 1000;

// Multi-page scans for the OCR timing cases, built from the fake fixtures.
const FIVE_MIXED = path.join(WORK, "five-mixed-scan.pdf");
const FIVE_LETTERS = path.join(WORK, "five-letter-scan.pdf");
if (!fs.existsSync(FIVE_MIXED) || !fs.existsSync(FIVE_LETTERS)) {
  execFileSync("python", ["-c", `import pymupdf
R=r"${path.resolve("qa/real-user-fixtures")}/"
def build(out, parts):
    d=pymupdf.open()
    for f in parts:
        s=pymupdf.open(R+f); d.insert_pdf(s, from_page=0, to_page=0)
    d.save(out)
build(r"${FIVE_MIXED}", ["DOCUMENT-07-scanned-letter.pdf","DOCUMENT-02-filled-application.pdf","DOCUMENT-04-invoice.pdf","DOCUMENT-05-bank-statement.pdf","DOCUMENT-01-passport-scan.pdf"])
build(r"${FIVE_LETTERS}", ["DOCUMENT-07-scanned-letter.pdf"]*5)`]);
}

// ----------------------------------------------------------------------------------------------- the cases
/** Each: how to set the tool up (everything except the primary action), the primary action, and what "done" is. */
const customTarget = async (page, kb) => {
  await page.getByText("How small do you need it?").waitFor({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  const mb = kb >= 1000;
  await page.getByLabel("Custom target size").fill(String(mb ? kb / 1000 : kb));
  await page.getByRole("radio", { name: mb ? "MB" : "KB", exact: true }).click();
};
const add = (page, files) => page.getByTestId("file-input").first().setInputFiles(files);
const cards = (page) => page.locator("ol > li[data-sort-key]");

const CASES = [
  { id: "compress-pdf", tool: "Compress PDF", fixture: "DOCUMENT-02-filled-application.pdf", route: "/compress-pdf", button: /^Compress to under/, download: /^Download/,
    setup: async (page) => { await add(page, [RUF("DOCUMENT-02-filled-application.pdf")]); await customTarget(page, 250); } },
  { id: "compress-image", tool: "Compress Image", fixture: "DOCUMENT-10-filled-form.png", route: "/compress-image", button: /^Compress to under/, download: /^Download/,
    setup: async (page) => { await add(page, [RUF("DOCUMENT-10-filled-form.png")]); await customTarget(page, 600); } },
  { id: "pdf-to-word:form", tool: "PDF → Word", fixture: "DOCUMENT-02-filled-application.pdf (scanned form, 1 page)", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: false,
    setup: async (page) => { await add(page, [RUF("DOCUMENT-02-filled-application.pdf")]); } },
  { id: "pdf-to-word:passport", tool: "PDF → Word", fixture: "DOCUMENT-01-passport-scan.pdf (passport-like scan)", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: false,
    setup: async (page) => { await add(page, [RUF("DOCUMENT-01-passport-scan.pdf")]); } },
  { id: "pdf-to-word:certificate", tool: "PDF → Word", fixture: "DOCUMENT-03-certificate.pdf", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: false,
    setup: async (page) => { await add(page, [RUF("DOCUMENT-03-certificate.pdf")]); } },
  { id: "pdf-to-word:native", tool: "PDF → Word", fixture: "DOCUMENT-06-resume-native.pdf (native text)", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: false,
    setup: async (page) => { await add(page, [RUF("DOCUMENT-06-resume-native.pdf")]); } },
  { id: "pdf-to-word:letter", tool: "PDF → Word", fixture: "DOCUMENT-07-scanned-letter.pdf (plain scanned letter, 1 page)", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: true, timeout: 240_000,
    setup: async (page) => { await add(page, [RUF("DOCUMENT-07-scanned-letter.pdf")]); } },
  { id: "pdf-to-word:two-pages", tool: "PDF → Word", fixture: "DOCUMENT-08-signed-contract.pdf (scanned, 2 pages)", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: true, timeout: 240_000,
    setup: async (page) => { await add(page, [RUF("DOCUMENT-08-signed-contract.pdf")]); } },
  { id: "pdf-to-word:five-mixed", tool: "PDF → Word", fixture: "five-mixed-scan.pdf (letter + form + invoice + statement + passport, 5 pages)", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: false, timeout: 300_000,
    setup: async (page) => { await add(page, [FIVE_MIXED]); } },
  { id: "pdf-to-word:five-letters", tool: "PDF → Word", fixture: "five-letter-scan.pdf (5 plain scanned letters)", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: true, timeout: 420_000,
    setup: async (page) => { await add(page, [FIVE_LETTERS]); } },
  { id: "pdf-to-word:user", tool: "PDF → Word", fixture: "the user's own scanned PDF (2 pages)", route: "/pdf-to-word", button: "Convert to Word", download: "Download .docx", ocrExpected: false, private: true,
    setup: async (page) => { await add(page, [REAL_SCAN]); } },
  { id: "word-to-pdf", tool: "Word → PDF", fixture: "DOCUMENT-16-complex-word-report.docx", route: "/word-to-pdf", button: "Convert to PDF", download: "Download PDF",
    setup: async (page) => { await add(page, [RUF("DOCUMENT-16-complex-word-report.docx")]); } },
  { id: "image-to-word", tool: "Image → Word", fixture: "DOCUMENT-10-filled-form.png", route: "/image-to-word", button: /^Create Word document/, download: "Download .docx",
    setup: async (page) => { await add(page, [RUF("DOCUMENT-10-filled-form.png")]); await cards(page).nth(0).waitFor(); } },
  { id: "pdf-to-image", tool: "PDF → Image", fixture: "DOCUMENT-05-bank-statement.pdf (scanned, 2 pages) → PNG", route: "/pdf-to-image", button: /^Convert (all|page$)/, download: "Download all (ZIP)",
    setup: async (page) => { await add(page, [RUF("DOCUMENT-05-bank-statement.pdf")]); await page.getByRole("button", { name: /^Convert (all|page$)/ }).waitFor({ timeout: 60_000 }); await page.getByRole("radio", { name: "PNG", exact: true }).click(); } },
  { id: "image-to-pdf", tool: "Image → PDF", fixture: "DOCUMENT-09 + 10 + 11 (ID PNG, form PNG, receipt JPG)", route: "/image-to-pdf", button: /^Create PDF/, download: "Download PDF",
    setup: async (page) => { await add(page, [RUF("DOCUMENT-09-id-card-image.png"), RUF("DOCUMENT-10-filled-form.png"), RUF("DOCUMENT-11-receipt.jpg")]); await cards(page).nth(2).waitFor(); await page.getByRole("radio", { name: "Letter", exact: true }).click(); } },
  { id: "convert-image", tool: "Image Converter", fixture: "DOCUMENT-10-filled-form.png → JPG", route: "/convert-image", button: "Convert to JPG", download: "Download JPG",
    setup: async (page) => { await add(page, [RUF("DOCUMENT-10-filled-form.png")]); await page.getByRole("radio", { name: /^JPG/ }).click(); } },
  { id: "merge-pdf", tool: "Merge PDF", fixture: "DOCUMENT-06 + 12 + 02 + 05 (native + scanned, 5 pages)", route: "/merge-pdf", button: "Merge 4 PDFs", download: "Download merged PDF",
    setup: async (page) => { await add(page, [RUF("DOCUMENT-06-resume-native.pdf"), RUF("DOCUMENT-12-table-report.pdf"), RUF("DOCUMENT-02-filled-application.pdf"), RUF("DOCUMENT-05-bank-statement.pdf")]); await page.getByText("5 pages in total", { exact: false }).waitFor({ timeout: 60_000 }); } },
  { id: "split-pdf", tool: "Split PDF", fixture: "DOCUMENT-05-bank-statement.pdf, page 2", route: "/split-pdf", button: /^Extract \d+ pages?$/, download: "Download PDF",
    setup: async (page) => { await add(page, [RUF("DOCUMENT-05-bank-statement.pdf")]); await page.getByRole("checkbox", { name: "Page 2", exact: true }).waitFor({ timeout: 60_000 }); await page.getByRole("checkbox", { name: "Page 2", exact: true }).click(); } },
  { id: "organize-pdf", tool: "Organize PDF", fixture: "DOCUMENT-08-signed-contract.pdf, rotate page 2", route: "/organize-pdf", button: "Save PDF", download: "Download PDF",
    setup: async (page) => { await add(page, [RUF("DOCUMENT-08-signed-contract.pdf")]); await cards(page).nth(1).waitFor({ timeout: 60_000 }); await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click(); } },
  { id: "pdf-editor", tool: "PDF Editor export", fixture: "DOCUMENT-02-filled-application.pdf + a highlight", route: "/pdf-editor", button: "Export PDF", exportDownload: true,
    setup: async (page) => {
      await add(page, [RUF("DOCUMENT-02-filled-application.pdf")]);
      await page.getByTestId("page-surface").waitFor({ timeout: 60_000 });
      await page.getByRole("button", { name: "Fit page" }).click();
      await page.waitForTimeout(500);
      const s = await page.getByTestId("page-surface").first().boundingBox();
      const k = s.width / 612;
      await page.getByRole("button", { name: "Highlight", exact: true }).click();
      await page.mouse.move(s.x + 60 * k, s.y + 308 * k);
      await page.mouse.down();
      await page.mouse.move(s.x + 300 * k, s.y + 322 * k, { steps: 8 });
      await page.mouse.up();
      await page.getByRole("button", { name: "Select", exact: true }).click().catch(() => {});
    } },
];

// ----------------------------------------------------------------------------------------------- the browser
async function newContext(browser, { mobile }) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }) });
  // A switch for "no animation frames are delivered": off during set-up, on from just before the primary click.
  await ctx.addInitScript(() => {
    const real = window.requestAnimationFrame.bind(window);
    const queue = [];
    let starved = false;
    window.__starve = (on) => { starved = on; window.__rafWaiting = 0; };
    window.__interacted = 0;
    window.requestAnimationFrame = (cb) => {
      if (!starved) return real(cb);
      queue.push(cb);
      window.__rafWaiting = queue.length;
      return queue.length;
    };
    // Only genuine (trusted) input counts as the user doing something; the primary click is sent as an untrusted event.
    const release = (e) => {
      if (!e.isTrusted) return;
      window.__interacted++;
      if (!starved) return;
      starved = false;
      for (const cb of queue.splice(0)) real(cb);
    };
    for (const t of ["pointerdown", "mousedown", "click", "keydown", "touchstart"]) addEventListener(t, release, { capture: true });
  });
  return ctx;
}

async function runCase(ctx, c, { mode, run, mobile }) {
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => requests.push({ url: r.url(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
  const rec = { tool: c.tool, case: c.id, fixture: c.fixture, mode: `${mode}${mobile ? "+mobile" : ""}`, run: run === 1 ? "cold" : "warm", private: Boolean(c.private) };
  try {
    await page.goto(base + c.route, { waitUntil: "networkidle" });
    await c.setup(page);
    const button = page.getByRole("button", { name: c.button }).first();
    await button.waitFor({ timeout: 60_000 });
    // ---- from here on: one click, nothing else.
    const interactedBefore = await page.evaluate(() => window.__interacted);
    if (mode === "starved") await page.evaluate(() => window.__starve(true));
    const timeout = c.timeout ?? 120_000;
    const t0 = Date.now();
    const downloadWaiter = c.exportDownload ? page.waitForEvent("download", { timeout }) : null;
    await button.dispatchEvent("click"); // the one action (untrusted, so it is not counted as an interaction)
    const interactedAfterClick = await page.evaluate(() => window.__interacted);
    const stages = [];
    let last = "";
    let done = null;
    let download = null;
    while (Date.now() - t0 < timeout) {
      if (downloadWaiter) {
        const d = await Promise.race([downloadWaiter, new Promise((r) => setTimeout(() => r(null), 250))]);
        if (d) { download = d; done = Date.now(); break; }
      } else {
        if (await page.getByTestId("result").count()) { done = Date.now(); break; }
        if (await page.locator("main").getByRole("alert").count()) { rec.error = (await page.locator("main").getByRole("alert").first().innerText()).slice(0, 160); break; }
        await new Promise((r) => setTimeout(r, 150));
      }
      const s = (await page.getByRole("status").allInnerTexts().catch(() => [])).join(" | ").replace(/\s+/g, " ").trim().slice(0, 46);
      if (s && s !== last) { stages.push([+((Date.now() - t0) / 1000).toFixed(1), s]); last = s; }
    }
    const interactionsAfter = (await page.evaluate(() => window.__interacted).catch(() => interactedAfterClick)) - interactedAfterClick;
    rec.resultSec = done ? +((done - t0) / 1000).toFixed(1) : null;
    rec.extraInteraction = interactionsAfter > 0 ? "YES" : "NO";
    rec.stages = stages.slice(0, 8);
    rec.ocrRequests = requests.filter((r) => /tesseract|traineddata/i.test(r.url) && !/pdf\.worker/.test(r.url)).length;
    const origin = new URL(page.url()).origin;
    rec.uploads = requests.filter((r) => !/^(blob|data):/.test(r.url) && (r.post > 0 || !r.url.startsWith(origin))).length;
    if (done) {
      // Output validity: take the download (a second click is just the download, the conversion is already finished).
      const dl = download ?? (await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: c.download }).first().click()]))[0];
      const file = path.join(OUTDIR, `pf-${c.id.replace(/\W+/g, "-")}-${mode}-${run}-${dl.suggestedFilename()}`);
      await dl.saveAs(file);
      const v = await validateFile(file);
      rec.outputValid = v.ok ? "YES" : "NO";
      rec.output = `${path.basename(dl.suggestedFilename())} (${fs.statSync(file).size} bytes)`;
      if (!v.ok) rec.problems = v.problems.slice(0, 2);
      if (c.private) fs.rmSync(file, { force: true }); // nothing derived from the user's document stays in the repository
      if (c.tool === "PDF → Word") {
        const card = page.getByTestId("result");
        rec.classes = (await card.getAttribute("data-page-classes").catch(() => null)) ?? undefined;
        rec.strategies = (await card.getAttribute("data-page-strategies").catch(() => null)) ?? undefined;
      }
    }
    rec.errors = errors.slice(0, 2);
    rec.verdict = rec.resultSec !== null && rec.extraInteraction === "NO" && rec.outputValid === "YES" && !errors.length && !rec.uploads ? "PASS" : "FAIL";
    if (c.ocrExpected === false && rec.ocrRequests > 0 && c.tool === "PDF → Word") rec.verdict = "FAIL";
    if (rec.resultSec === null) rec.problem = rec.error ?? `no result within ${timeout / 1000} s with nothing touched (last status: ${last || "none"})`;
    void interactedBefore;
  } catch (e) {
    rec.verdict = "FAIL";
    rec.problem = String(e).slice(0, 220);
  }
  await page.close();
  return rec;
}

const browser = await chromium.launch();
const records = [];
const chosen = CASES.filter((c) => (which === "all" || c.id === which || c.id.startsWith(which + ":") || c.tool.toLowerCase().includes(which.toLowerCase())) && (!only || c.id.includes(only)));
for (const mode of modes) {
  for (const c of chosen) {
    for (const mobile of c.tool === "PDF → Word" || c.id === "image-to-word" ? [false, true] : [false]) {
      if (mobile && mode === "starved") continue;
      if (mobile && !/form|letter|native|image-to-word/.test(c.id)) continue;
      // cold: a fresh context; warm: the same context, second run
      const ctx = await newContext(browser, { mobile });
      for (const run of [1, 2]) {
        const r = await runCase(ctx, c, { mode, run, mobile });
        records.push(r);
        console.log(`${r.verdict.padEnd(5)} ${r.tool.padEnd(16)} ${r.case.padEnd(24)} ${r.mode.padEnd(16)} ${r.run.padEnd(4)} ${String(r.resultSec ?? "—").padStart(6)} s  extra-click:${r.extraInteraction ?? "?"} valid:${r.outputValid ?? "?"} ocr:${r.ocrRequests ?? "?"}${r.problem ? "  " + r.problem : ""}`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
fs.writeFileSync(path.resolve("qa/evidence/fresh", `pf-audit-${tag}.json`), JSON.stringify(records, null, 1));
const tally = records.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] ?? 0) + 1), m), {});
console.log(JSON.stringify(tally));
