// REAL-USER PRODUCT AUDIT — every first-launch tool, driven through the real UI with realistic (fake) documents
// from qa/real-user-fixtures/ (qa/scripts/real-user-fixtures.py), the output downloaded, opened by an independent
// renderer and compared with the source. Writes qa/evidence/fresh/rup-<tag>.json; qa/scripts/rup-report.mjs turns
// it into qa/REAL_USER_PRODUCT_AUDIT.md.
//
//   LIBREOFFICE=…/soffice.exe BASE=http://localhost:3100 node qa/scripts/rup-audit.mjs [p2w|i2w|p2i|i2p|w2p|cpdf|cimg|merge|split|organize|editor|ocr|mobile|all] [--tag=x] [--only=text]
//
// What a verdict means (the product-owner test "would a normal user be surprised?" is the bar):
//   PASS     the output is what the user expects of that conversion, measured.
//   LIMITED  usable and honest, but visibly short of the expectation (the reason is in `difference`).
//   FAIL     a normal user would be surprised or lose something.
// Microsoft Word is not available for automated checks: the renderer for .docx files is LibreOffice only, so a
// .docx verdict here is never a claim about Word itself (see qa/manual-word-review/).
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { launch, open, addPaths, download, size, rec, save, records, fs, path, OUT, zipEntries, REAL_SCAN } from "./fl-lib.mjs";

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith("--")) ?? "all";
const tag = args.find((a) => a.startsWith("--tag="))?.slice(6) ?? "dev";
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const run = (n) => which === "all" || which === n;
const RUF = (n) => path.resolve("qa/real-user-fixtures", n);
const REF = (n) => path.resolve("qa/real-user-fixtures/refs", n);
const REVIEW = path.resolve("qa/fidelity/real-user");
const WORK = path.resolve("qa/fidelity/_work/rup");
const PRIVATE = path.resolve("qa/fidelity/real-user/_private");
for (const d of [REVIEW, WORK, PRIVATE]) fs.mkdirSync(d, { recursive: true });
const KB = 1000;

const py = (script, ...a) => JSON.parse(execFileSync("python", [script, ...a], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 900_000 }).trim().split("\n").pop());
const visdiff = (mode, src, out, a = []) => py("qa/validate/visdiff.py", mode, src, out, ...a);
const docxinfo = (f) => py("qa/validate/docxinfo.py", f);
const layoutdiff = (src, out, dir, name) => py("qa/validate/layoutdiff.py", src, out, "--images", dir, "--name", name);
const lo = (dir, file) => {
  execFileSync("python", ["qa/validate/lo.py", "pdf", dir, file], { stdio: "pipe", timeout: 900_000 });
  return path.join(dir, path.basename(file).replace(/\.docx$/, ".pdf"));
};
const sha1 = (f) => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
const band = (v, pass, limited) => (v === null || v === undefined ? "n/a" : v >= pass ? "PASS" : v >= limited ? "LIMITED" : "FAIL");
const worst = (...v) => (v.includes("FAIL") ? "FAIL" : v.includes("LIMITED") ? "LIMITED" : "PASS");
const flag = (ok, bad = "FAIL") => (ok ? "PASS" : bad);
const pngSize = (f) => JSON.parse(execFileSync("python", ["-c", `from PIL import Image;import json;print(json.dumps(Image.open(r"${f}").size))`], { encoding: "utf8" }));

// ---------------------------------------------------------------------------------------------- the documents
/** What each fixture stands for and what a normal user expects of it from PDF → Word. */
const DOC = {
  "DOCUMENT-01-passport-scan.pdf": { says: "a scanned travel-document page: portrait photo, labelled fields, handwriting-style fill-in, stamp, machine-readable lines", kind: "scan" },
  "DOCUMENT-02-filled-application.pdf": { says: "a scanned application form filled in by hand: field lines, ticked check boxes, signature and date", kind: "scan" },
  "DOCUMENT-03-certificate.pdf": { says: "a scanned landscape certificate with a decorative border, seal and signatures", kind: "scan" },
  "DOCUMENT-04-invoice.pdf": { says: "a scanned invoice: letterhead, line-item table, totals, a stamped PAID mark", kind: "scan" },
  "DOCUMENT-05-bank-statement.pdf": { says: "a two-page scanned bank statement: account box, transaction table, running balance", kind: "scan" },
  "DOCUMENT-07-scanned-letter.pdf": { says: "a scanned plain business letter — running text, no pictures, no form fields", kind: "letter" },
  "DOCUMENT-08-signed-contract.pdf": { says: "a two-page scanned agreement with clauses, a signature block and handwritten signatures", kind: "scan" },
  "DOCUMENT-04b-invoice-native.pdf": { says: "the same invoice as a native (born-digital) PDF with real text and a table", kind: "native", minTables: 0 },
  "DOCUMENT-06-resume-native.pdf": { says: "a native PDF résumé: headings, bullet lists, bold role titles", kind: "native" },
  "DOCUMENT-12-table-report.pdf": { says: "a native PDF report with a data table and a chart", kind: "native", minTables: 1 },
  "DOCUMENT-13-brochure.pdf": { says: "a native two-column brochure with headings, a picture and a call-out", kind: "native" },
};

// ---------------------------------------------------------------------------------------------- browsers
function track(page) {
  const log = [];
  page.on("request", (r) => log.push({ url: r.url(), method: r.method(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
  return log;
}
const ocrRequests = (log, from) => log.slice(from).filter((r) => /tesseract|traineddata|\.wasm/i.test(r.url) && !/pdf\.worker|pdfjs/i.test(r.url));
const uploads = (log, from, origin) => log.slice(from).filter((r) => !/^(blob|data):/.test(r.url) && (r.post > 0 || !r.url.startsWith(origin)));
const originOf = (page) => new URL(page.url()).origin;

async function pdfToWord(page, input, name) {
  await open(page, "/pdf-to-word");
  await addPaths(page, [input]);
  await page.getByRole("button", { name: "Convert to Word" }).waitFor({ timeout: 60_000 });
  const t0 = Date.now();
  await page.getByRole("button", { name: "Convert to Word" }).click();
  await Promise.race([page.getByTestId("result").waitFor({ timeout: 600_000 }), page.locator("main").getByRole("alert").first().waitFor({ timeout: 600_000 })]);
  if (!(await page.getByTestId("result").count())) throw new Error(await page.locator("main").getByRole("alert").first().innerText());
  const ms = Date.now() - t0;
  const res = page.getByTestId("result");
  const strategies = (await res.getAttribute("data-page-strategies")).split(",");
  const classes = (await res.getAttribute("data-page-classes")).split(",");
  const summary = (await res.innerText()).replace(/\s+/g, " ").slice(0, 240);
  const file = await download(page, page.getByRole("button", { name: "Download .docx" }), `rup-${name}`);
  return { file, strategies, classes, ms, summary };
}

// ---------------------------------------------------------------------------------------------- the grading of one PDF → Word result
const MIN_DPI = 140;
function gradeVisual(info, d, strategies, ocr, classes) {
  const pages = d.pagesSrc;
  const dpi = info.media.length ? Math.min(...info.media.map((m, i) => m.width / ((info.pageSizes[i]?.[0] ?? 612) / 72))) : 0;
  const checks = {
    strategy: flag(strategies.every((s) => s === "visual"), "FAIL"),
    pagesKept: flag(info.sections === pages && d.pagesOut === pages),
    pageSizes: flag(d.allSizesKept),
    noTextLayer: flag(info.textChars === 0),
    onePicturePerPage: flag(info.drawings === pages && info.media.length === pages),
    resolution: band(dpi, MIN_DPI, 110),
    weight: flag(info.bytes <= 1_200_000 * pages, "LIMITED"),
    look: band(d.minSsim, 0.95, 0.9),
    // OCR may run inside the converter only to judge a plain scan of text; nothing it reads reaches the page (noTextLayer).
    ocrOnlyToJudge: flag(ocr.length === 0 || classes.every((c) => c === "SCANNED_TEXT")),
  };
  return { checks, dpi: Math.round(dpi), grade: worst(...Object.values(checks)) };
}
/** Average grey of page 1 (0 black – 255 white) at 36 dpi: lost bands, fills and shading show up as a lighter page. */
const meanGrey = (f) => JSON.parse(execFileSync("python", ["-c", `import pymupdf,json,numpy as np
p=pymupdf.open(r"${f}")[0];pix=p.get_pixmap(matrix=pymupdf.Matrix(0.5,0.5),colorspace=pymupdf.csGRAY,alpha=False)
print(json.dumps(float(np.frombuffer(pix.samples,np.uint8).mean())))`], { encoding: "utf8" }));
function gradeEditable(info, d, lay, meta, strategies, minTables = 0, tone = 0) {
  const checks = {
    strategy: flag(strategies.every((s) => s === "editable")),
    pagesKept: flag(d.pagesOut === d.pagesSrc, d.pagesOut - d.pagesSrc === 1 ? "LIMITED" : "FAIL"),
    isText: flag(info.textChars > 100),
    textKept: band(lay.textRecall, 98, 90),
    looksLike: band(d.minSsim, 0.8, 0.6),
    positions: lay.within36pt === undefined ? "n/a" : band(lay.within36pt, 85, 60),
    readingOrder: lay.readingOrder === undefined ? "n/a" : band(lay.readingOrder, 80, 60),
    pictures: lay.imagesSrc ? (lay.imagesOut === lay.imagesSrc ? band(lay.imageIoU, 0.7, 0.4) : "FAIL") : "n/a",
    tables: minTables ? flag(info.tables >= minTables) : "n/a",
    // Shaded bands and fills: the page should be as dark overall as the original (±8 grey levels PASS, ±25 LIMITED).
    fillsKept: Math.abs(tone) <= 8 ? "PASS" : Math.abs(tone) <= 25 ? "LIMITED" : "FAIL",
  };
  return { checks, grade: worst(...Object.values(checks).filter((v) => v !== "n/a")) };
}

const seen = {}; // desktop strategies per fixture, compared on mobile

async function p2wCase(page, log, f, { mobile = false } = {}) {
  const isUser = f === REAL_SCAN;
  const name = isUser ? "REAL-user-scan" : path.basename(f).replace(/\.pdf$/, "");
  const meta = isUser ? { says: "your own scanned test PDF (kept private, nothing from it is committed)", kind: "scan" } : DOC[path.basename(f)];
  const label = `${name}${mobile ? " [mobile]" : ""}`;
  const mark = log.length;
  const JOURNEY = { "DOCUMENT-02-filled-application.pdf": "A", "DOCUMENT-01-passport-scan.pdf": "B", "DOCUMENT-06-resume-native.pdf": "C" };
  const base = { fixture: path.basename(f), represents: meta.says, journey: JOURNEY[path.basename(f)] };
  const before = errorsCount();
  try {
    const r = await pdfToWord(page, f, `${name}${mobile ? "-m" : ""}`);
    const docx = path.join(WORK, `${name}${mobile ? "-m" : ""}.docx`);
    fs.copyFileSync(r.file, docx);
    const info = docxinfo(docx);
    const pdf = lo(WORK, docx);
    const dir = isUser ? PRIVATE : REVIEW;
    const nm = `p2w-${tag}-${name}${mobile ? "-m" : ""}`;
    const ocr = ocrRequests(log, mark);
    const ups = uploads(log, mark, originOf(page));
    if (mobile) {
      const desk = seen[name];
      const same = desk && desk.join() === r.strategies.join();
      rec("PDF → Word [mobile]", label, same ? "PASS" : "FAIL", { ...base, expectation: "Phone gives the same result as desktop.", desktop: desk?.join(","), mobile: r.strategies.join(","), output: `${size(docx)} bytes`, difference: same ? "none" : "strategy differs between desktop and mobile" });
      return;
    }
    seen[name] = r.strategies;
    let verdict;
    let detail;
    const expectation = { scan: "VISUAL: the page looks like the scan (borders, fill-ins, signatures, stamps, photos) — no OCR retyping.", letter: "HYBRID only if text is reliably recognised; otherwise VISUAL.", native: "EDITABLE: real Word text, headings, tables and lists that look like the PDF." }[meta.kind];
    if (meta.kind === "scan" || (meta.kind === "letter" && r.strategies.every((s) => s === "visual"))) {
      const d = visdiff("pdf", f, pdf, ["--align", "1", "--dir", dir, "--name", nm, "--max-images", "2"]);
      const g = gradeVisual(info, d, r.strategies, ocr, r.classes);
      verdict = g.grade;
      detail = { visual: `render vs scan: SSIM ${d.minSsim} (min over pages), PSNR ${d.minPsnr} dB, ${d.maxChangedPct}% changed, aligned by ${JSON.stringify(d.pages.map((p) => p.alignedBy))}`, structural: `${info.sections} section(s) of ${d.pagesSrc} page(s), page sizes kept=${d.allSizesKept}, text characters=${info.textChars}, pictures=${info.drawings}, picture ${g.dpi} dpi, ${info.bytes} bytes`, difference: g.grade === "PASS" ? "none visible; not editable by design (the page is a picture)" : Object.entries(g.checks).filter(([, v]) => v !== "PASS").map(([k, v]) => `${k}=${v}`).join(", "), checks: g.checks, minSsim: d.minSsim, dpi: g.dpi };
    } else if (meta.kind === "letter") {
      // Hybrid: editable text from a scan is allowed only when it is reliable — the text must match the original letter and the page must still look like it.
      const ref = REF("DOCUMENT-07-scanned-letter-ref.pdf");
      const d = visdiff("pdf", f, pdf, ["--dir", dir, "--name", nm, "--max-images", "2"]);
      const t = visdiff("pdf", ref, pdf, []);
      const checks = { strategy: flag(r.strategies.every((s) => s === "hybrid")), textRight: band(t.minTextRecall, 97, 90), looksLike: band(d.minSsim, 0.85, 0.7), pagesKept: flag(d.pagesOut === d.pagesSrc) };
      verdict = worst(...Object.values(checks));
      detail = { visual: `render vs scan: SSIM ${d.minSsim}`, structural: `hybrid page: ${info.textChars} editable characters, ${info.paragraphs} paragraphs; text recall against the letter's own words ${t.minTextRecall}%`, difference: verdict === "PASS" ? "editable text matches the letter; the page looks like the scan" : Object.entries(checks).filter(([, v]) => v !== "PASS").map(([k, v]) => `${k}=${v}`).join(", "), checks };
    } else {
      const d = visdiff("pdf", f, pdf, ["--dir", dir, "--name", nm, "--max-images", "2"]);
      const lay = layoutdiff(f, pdf, dir, nm);
      const tone = meanGrey(pdf) - meanGrey(f);
      const g = gradeEditable(info, d, lay, meta, r.strategies, meta.minTables, tone);
      verdict = g.grade;
      detail = { visual: `render vs PDF: SSIM ${d.minSsim}, ${d.maxChangedPct}% changed`, structural: `${info.paragraphs} paragraphs, ${info.tables} table(s), ${info.drawings} picture(s), text recall ${lay.textRecall}%, ${lay.within36pt ?? "?"}% of words within 36 pt, reading order ${lay.readingOrder}%, pictures ${lay.imagesOut}/${lay.imagesSrc}, page tone ${tone >= 0 ? "+" : ""}${tone.toFixed(1)} grey levels vs the original`, difference: g.grade === "PASS" ? "text, tables and layout rebuilt as editable Word content; minor spacing differences only" : Object.entries(g.checks).filter(([, v]) => v !== "PASS" && v !== "n/a").map(([k, v]) => `${k}=${v}`).join(", "), checks: g.checks, textRecall: lay.textRecall, minSsim: d.minSsim };
    }
    if (ups.length) verdict = "FAIL";
    rec("PDF → Word", label, verdict, { ...base, expectation, steps: "open /pdf-to-word → add file → Convert to Word → Download .docx → open in LibreOffice (independent renderer) → compare with the source", output: `${path.basename(docx)} — classes ${r.classes.join(",")} · strategies ${r.strategies.join(",")} · ${r.ms} ms`, uploads: ups.length, ocrRequests: ocr.length, screen: r.summary, ...detail });
  } catch (e) {
    rec("PDF → Word", label, "FAIL", { ...base, error: String(e).slice(0, 400) });
  }
  void before;
}

let errorSource = () => 0;
const errorsCount = () => errorSource();

// ---------------------------------------------------------------------------------------------- Image → Word
const IMG = {
  "DOCUMENT-09-id-card-image.png": "a photo-style identity card (wide), portrait and fields, PNG",
  "DOCUMENT-10-filled-form.png": "a filled-in application form photographed/scanned to PNG, check boxes and signature",
  "DOCUMENT-11-receipt.jpg": "a long, narrow till receipt photo (JPG)",
  "DOCUMENT-14-photo-with-text.png": "a photograph with a sign / caption text in it (PNG)",
  "DOCUMENT-17-screenshot.png": "a wide desktop-style screenshot (PNG)",
  "DOCUMENT-18-table-image.png": "a picture of a table (PNG)",
};

async function imageToWord(page, log, files, pageSize, tagName, { mobile = false } = {}) {
  const mark = log.length;
  await open(page, "/image-to-word");
  await addPaths(page, files.map(RUF));
  await page.locator("ol > li[data-sort-key]").nth(files.length - 1).waitFor({ timeout: 60_000 });
  await page.getByRole("radio", { name: pageSize, exact: true }).click();
  await page.getByRole("button", { name: /^Create Word document/ }).click();
  await Promise.race([page.getByTestId("result").waitFor({ timeout: 300_000 }), page.locator("main").getByRole("alert").first().waitFor({ timeout: 300_000 })]);
  if (!(await page.getByTestId("result").count())) throw new Error(await page.locator("main").getByRole("alert").first().innerText());
  const file = await download(page, page.getByRole("button", { name: "Download .docx" }), `rup-${tagName}`);
  return { file, ocr: ocrRequests(log, mark), ups: uploads(log, mark, originOf(page)) };
}

async function i2wCase(page, log, files, pageSize, what, { mobile = false } = {}) {
  const label = `${what}${mobile ? " [mobile]" : ""}`;
  const tagName = `i2w-${what.replace(/\W+/g, "-").slice(0, 30)}${mobile ? "-m" : ""}`;
  const base = { fixture: files.join(" + "), represents: files.map((f) => IMG[f]).join("; "), journey: what === "filled form PNG" ? "D" : undefined };
  try {
    const r = await imageToWord(page, log, files, pageSize, tagName);
    const docx = path.join(WORK, `${tagName}.docx`);
    fs.copyFileSync(r.file, docx);
    const info = docxinfo(docx);
    const pdf = lo(WORK, docx);
    const srcHashes = files.map((f) => sha1(RUF(f)));
    const sizes = files.map((f) => pngSize(RUF(f)));
    const per = files.map((f, i) => visdiff("place", RUF(f), pdf, ["--page", String(i + 1), "--dir", REVIEW, "--name", `i2w-${tag}-${f.replace(/\.\w+$/, "")}${files.length > 1 ? "-seq" : ""}`]));
    const aspectOk = info.pageSizes.length === files.length && info.pageSizes.every(([w, h], i) => Math.abs(w / h / (sizes[i][0] / sizes[i][1]) - 1) < 0.005);
    const orderOk = info.media.length === files.length && srcHashes.every((h, i) => info.media[i]?.sha1 === h);
    const checks = {
      onePagePerImage: flag(info.sections === files.length),
      noText: flag(info.textChars === 0),
      noOcrRun: flag(r.ocr.length === 0),
      noUpload: flag(r.ups.length === 0),
      // "fit to image" makes the page the picture's shape; A4/Letter keep the picture's own shape inside a margin.
      pageShape: pageSize === "Fit to image" ? flag(aspectOk) : "n/a",
      untouchedBytes: flag(orderOk, "LIMITED"),
      // LibreOffice rounds some page sizes by up to a point; a picture within 1.5 pt of the page edge is not clipped to the eye.
      inPageNotClipped: flag(per.every((p) => p.box && p.pageSize && p.box[0] >= -1.5 && p.box[1] >= -1.5 && p.box[2] <= p.pageSize[0] + 1.5 && p.box[3] <= p.pageSize[1] + 1.5)),
      proportions: flag(per.every((p) => p.aspectKept)),
      // The .docx holds the source's own bytes (untouchedBytes); the render only confirms where they sit. Grainy photos
      // lose SSIM through the renderer's resampling alone, hence the wider bands.
      looksLike: band(Math.min(...per.map((p) => p.ssim)), 0.85, 0.75),
    };
    const verdict = worst(...Object.values(checks).filter((v) => v !== "n/a"));
    rec("Image → Word", label, verdict, {
      ...base,
      expectation: "The document looks like the image: right proportions, centred, nothing clipped or stretched, no recognised text.",
      steps: `open /image-to-word → add ${files.length} image(s) → ${pageSize} → Create Word document → Download .docx → LibreOffice render → compare`,
      output: `${path.basename(docx)} — ${info.sections} page(s), ${info.bytes} bytes, page(s) ${info.pageSizes.map((s) => s.map((v) => v.toFixed(0)).join("×")).join(" ")} pt`,
      visual: `render vs image: SSIM ${per.map((p) => p.ssim).join(" / ")}`,
      structural: `text characters=${info.textChars}, pictures=${info.drawings}, image bytes identical to the source=${orderOk}`,
      difference: verdict === "PASS" ? "none (the image is the page content; nothing was recognised or retyped)" : Object.entries(checks).filter(([, v]) => v !== "PASS" && v !== "n/a").map(([k, v]) => `${k}=${v}`).join(", "),
      checks,
    });
  } catch (e) {
    rec("Image → Word", label, "FAIL", { ...base, error: String(e).slice(0, 400) });
  }
}

// ================================================================================================== run
const { browser, page, errors } = await launch();
errorSource = () => errors.length;
page.on("dialog", (d) => d.accept());
const log = track(page);
const result = () => page.getByTestId("result").waitFor({ timeout: 600_000 });

async function step(tool, test, fn) {
  const before = errors.length;
  try {
    await fn();
  } catch (e) {
    rec(tool, test, "FAIL", { error: String(e).slice(0, 400) });
  }
  if (errors.length > before) rec(tool, `${test} — console`, "FAIL", { errors: errors.slice(before).map((e) => String(e).slice(0, 300)) });
}
const want = (n) => !only || n.includes(only);

// ---------------------------------------------------------------------------------------------- PDF → Word
if (run("p2w") || run("mobile")) {
  // (mobile compares with the desktop strategies seen in this process)
}
if (run("p2w")) {
  const order = ["DOCUMENT-01-passport-scan.pdf", "DOCUMENT-02-filled-application.pdf", "DOCUMENT-03-certificate.pdf", "DOCUMENT-04-invoice.pdf", "DOCUMENT-05-bank-statement.pdf", "DOCUMENT-08-signed-contract.pdf", "DOCUMENT-07-scanned-letter.pdf", "DOCUMENT-06-resume-native.pdf", "DOCUMENT-04b-invoice-native.pdf", "DOCUMENT-12-table-report.pdf", "DOCUMENT-13-brochure.pdf"];
  for (const f of order) if (want(f)) await p2wCase(page, log, RUF(f));
  if (want("REAL")) await p2wCase(page, log, REAL_SCAN);
}

// ---------------------------------------------------------------------------------------------- Image → Word
if (run("i2w")) {
  const C = [
    ["filled form PNG", ["DOCUMENT-10-filled-form.png"], "Fit to image"],
    ["ID card PNG (wide)", ["DOCUMENT-09-id-card-image.png"], "Fit to image"],
    ["receipt JPG (long, narrow)", ["DOCUMENT-11-receipt.jpg"], "Fit to image"],
    ["screenshot (wide)", ["DOCUMENT-17-screenshot.png"], "Fit to image"],
    ["photo with text", ["DOCUMENT-14-photo-with-text.png"], "Fit to image"],
    ["table image", ["DOCUMENT-18-table-image.png"], "Fit to image"],
    ["filled form on A4", ["DOCUMENT-10-filled-form.png"], "A4"],
    ["ID card on Letter", ["DOCUMENT-09-id-card-image.png"], "Letter"],
    ["four images in order, Letter", ["DOCUMENT-09-id-card-image.png", "DOCUMENT-10-filled-form.png", "DOCUMENT-11-receipt.jpg", "DOCUMENT-17-screenshot.png"], "Letter"],
  ];
  for (const [what, files, size_] of C) if (want(what)) await i2wCase(page, log, files, size_, what);
}

// ---------------------------------------------------------------------------------------------- PDF → Image (a render, never OCR)
if (run("p2i")) {
  const P = [
    ["DOCUMENT-01-passport-scan.pdf", "PNG", 1, "F"],
    ["DOCUMENT-02-filled-application.pdf", "JPG", 1, ""],
    ["DOCUMENT-03-certificate.pdf", "PNG", 1, ""],
    ["DOCUMENT-05-bank-statement.pdf", "PNG", 2, ""],
    ["DOCUMENT-06-resume-native.pdf", "PNG", 1, ""],
    ["DOCUMENT-12-table-report.pdf", "JPG", 1, ""],
  ];
  for (const [fixture, fmt, n, journey] of P) {
    await step("PDF → Image", `${fixture} → ${fmt}`, async () => {
      const mark = log.length;
      await open(page, "/pdf-to-image");
      await addPaths(page, [RUF(fixture)]);
      await page.getByRole("button", { name: /^Convert (all|page$)/ }).waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: fmt, exact: true }).click();
      await page.getByRole("button", { name: /^Convert (all|page$)/ }).click();
      await result();
      const files = [];
      const tg = `rup-p2i-${fixture.slice(9, 11)}`;
      if (n === 1) files.push(await download(page, page.getByRole("button", { name: `Download ${fmt}` }), tg));
      else {
        const zip = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), tg);
        for (const e of await zipEntries(zip)) {
          const f = path.join(OUT, `${tg}-${e.name}`);
          fs.writeFileSync(f, e.bytes);
          files.push(f);
        }
      }
      files.sort((a, b) => Number(a.match(/page-(\d+)/)?.[1] ?? 1) - Number(b.match(/page-(\d+)/)?.[1] ?? 1));
      const per = files.map((f, i) => visdiff("page", RUF(fixture), f, ["--page", String(i + 1), ...(i < 2 ? ["--dir", REVIEW, "--name", `p2i-${tag}-${fixture.slice(0, 11)}-p${i + 1}`] : [])]));
      const minSsim = Math.min(...per.map((p) => p.ssim));
      const checks = { look: band(minSsim, 0.93, 0.85), aspect: flag(per.every((p) => p.aspectKept)), count: flag(files.length === n), noOcr: flag(ocrRequests(log, mark).length === 0), resolution: flag((per[0]?.dpi ?? 0) >= 140, "LIMITED") };
      rec("PDF → Image", `${fixture} → ${fmt}`, worst(...Object.values(checks)), {
        fixture, journey, represents: DOC[fixture].says, expectation: "A picture of each page exactly as it looks, one image per page, readable at normal zoom; nothing recognised or rewritten.",
        steps: "open /pdf-to-image → add file → choose format → Convert → download → compare the picture with the page rendered independently",
        output: `${files.length} image(s) ${per.map((p) => p.imageSize.join("×")).join(" ")}`, visual: `SSIM ${minSsim}, ${per[0]?.dpi} dpi`, structural: `aspect kept=${checks.aspect}, images=${files.length}/${n}`, difference: Object.values(checks).every((v) => v === "PASS") ? "none (re-rendered; anti-aliasing only)" : Object.entries(checks).filter(([, v]) => v !== "PASS").map(([k, v]) => `${k}=${v}`).join(", "), checks,
      });
    });
  }
}

// ---------------------------------------------------------------------------------------------- Images → PDF (embed, never OCR)
if (run("i2p")) {
  const F = [
    ["ID card PNG, fit to image", ["DOCUMENT-09-id-card-image.png"], "Fit to image"],
    ["filled form PNG on A4", ["DOCUMENT-10-filled-form.png"], "A4"],
    ["receipt JPG, fit to image", ["DOCUMENT-11-receipt.jpg"], "Fit to image"],
    ["three images in order on Letter", ["DOCUMENT-11-receipt.jpg", "DOCUMENT-09-id-card-image.png", "DOCUMENT-17-screenshot.png"], "Letter"],
  ];
  for (const [what, files, sizeLabel] of F) {
    await step("Images → PDF", what, async () => {
      const mark = log.length;
      await open(page, "/image-to-pdf");
      await addPaths(page, files.map(RUF));
      await page.locator("ol > li[data-sort-key]").nth(files.length - 1).waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: sizeLabel, exact: true }).click();
      await page.getByRole("button", { name: /^Create PDF/ }).click();
      await result();
      const out = await download(page, page.getByRole("button", { name: "Download PDF" }), `rup-i2p-${what.slice(0, 8).replace(/\W/g, "")}`);
      const per = files.map((f, i) => visdiff("place", RUF(f), out, ["--page", String(i + 1), "--dir", REVIEW, "--name", `i2p-${tag}-${f.replace(/\.\w+$/, "")}`]));
      const text = JSON.parse(execFileSync("python", ["-c", `import pymupdf,json;print(json.dumps(sum(len(p.get_text().strip()) for p in pymupdf.open(r"${out}"))))`], { encoding: "utf8" }));
      const checks = {
        pages: flag(per.length === files.length && per.every((p) => !p.error)),
        embedded: band(Math.min(...per.map((p) => p.embeddedSsim ?? 0)), 0.98, 0.95),
        // A JPEG goes in byte for byte; a PNG can't (a PDF holds raw deflated pixels) but must come out lossless.
        bytesUntouched: flag(per.every((p, i) => (/\.jpe?g$/i.test(files[i]) ? p.embeddedBytesIdentical : (p.embeddedSsim ?? 0) >= 0.9999)), "LIMITED"),
        proportions: flag(per.every((p) => p.aspectKept)),
        inPage: flag(per.every((p) => p.insidePage)),
        noText: flag(text === 0),
        noOcrRun: flag(ocrRequests(log, mark).length === 0),
      };
      const verdict = worst(...Object.values(checks));
      rec("Images → PDF", what, verdict, {
        fixture: files.join(" + "), journey: files.length === 1 && what.startsWith("filled") ? "E" : undefined, represents: files.map((f) => IMG[f]).join("; "), expectation: "Each image becomes one page, looking exactly like the image; JPG/PNG are embedded, not recompressed; no text added.",
        steps: "open /image-to-pdf → add image(s) → page size → Create PDF → Download PDF → compare each page with its image",
        output: `${per.length} page(s) ${per.map((p) => p.pageSize?.map(Math.round).join("×")).join(" ")}`, visual: `rendered SSIM ${per.map((p) => p.ssim).join(" / ")}; embedded SSIM ${per.map((p) => p.embeddedSsim).join(" / ")}`,
        structural: `bytes identical=${per.map((p) => p.embeddedBytesIdentical).join("/")}, text characters in PDF=${text}`, difference: verdict === "PASS" ? "none" : Object.entries(checks).filter(([, v]) => v !== "PASS").map(([k, v]) => `${k}=${v}`).join(", "), checks,
      });
    });
  }
}

// ---------------------------------------------------------------------------------------------- Word → PDF (our own layout engine renders the .docx; LibreOffice is the reference)
if (run("w2p")) {
  for (const f of ["DOCUMENT-15-native-business-letter.docx", "DOCUMENT-16-complex-word-report.docx"]) {
    await step("Word → PDF", f, async () => {
      await open(page, "/word-to-pdf");
      await addPaths(page, [RUF(f)]);
      await page.getByRole("button", { name: "Convert to PDF" }).waitFor({ timeout: 60_000 });
      await page.getByRole("button", { name: "Convert to PDF" }).click();
      await result();
      const out = await download(page, page.getByRole("button", { name: "Download PDF" }), `rup-w2p-${f.slice(9, 11)}`);
      const ref = lo(WORK, RUF(f));
      const d = visdiff("pdf", ref, out, ["--dir", REVIEW, "--name", `w2p-${tag}-${f.replace(/\.docx$/, "")}`, "--max-images", "3"]);
      const checks = { pagesKept: flag(d.pagesOut === d.pagesSrc, Math.abs(d.pagesOut - d.pagesSrc) === 1 ? "LIMITED" : "FAIL"), sizes: flag(d.allSizesKept), text: band(d.minTextRecall, 99, 95), look: band(d.minSsim, 0.85, 0.7) };
      const verdict = worst(...Object.values(checks));
      rec("Word → PDF", f, verdict, {
        fixture: f, journey: f.includes("15") ? "G" : undefined, represents: f.includes("15") ? "a native business letter (letterhead, justified paragraphs, signature block)" : "a complex report: headings, tables, a list, a picture, header/footer, page numbers",
        expectation: "The PDF looks like the document in a word processor: same pages, fonts, tables and pictures; text stays selectable.",
        steps: "open /word-to-pdf → add .docx → Convert to PDF → Download PDF → compare with LibreOffice's own rendering of the same file",
        output: `${d.pagesOut} page(s) vs ${d.pagesSrc} in the reference`, visual: `SSIM ${d.minSsim} (min over pages) vs the LibreOffice rendering`, structural: `selectable text recall ${d.minTextRecall}%, page sizes kept=${d.allSizesKept}`,
        difference: verdict === "PASS" ? "layout engine differences only (line breaks within a few points)" : Object.entries(checks).filter(([, v]) => v !== "PASS").map(([k, v]) => `${k}=${v}`).join(", "), checks,
      });
    });
  }
}

// ---------------------------------------------------------------------------------------------- Compress PDF / Image
async function compressTarget(kind, input, target) {
  await open(page, kind === "pdf" ? "/compress-pdf" : "/compress-image");
  await addPaths(page, [input]);
  await page.getByText("How small do you need it?").waitFor({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  const mb = target >= 1_000_000;
  await page.getByLabel("Custom target size").fill(String(mb ? target / 1_000_000 : target / KB));
  await page.getByRole("radio", { name: mb ? "MB" : "KB", exact: true }).click();
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  await result();
}
if (run("cpdf")) {
  for (const [fixture, target] of [["DOCUMENT-01-passport-scan.pdf", 250 * KB], ["DOCUMENT-02-filled-application.pdf", 250 * KB], ["DOCUMENT-08-signed-contract.pdf", 300 * KB], ["DOCUMENT-05-bank-statement.pdf", 400 * KB]]) {
    await step("Compress PDF", `${fixture} → ${target / KB} KB`, async () => {
      await compressTarget("pdf", RUF(fixture), target);
      const headline = (await page.getByTestId("result").getByRole("status").innerText()).trim();
      const out = await download(page, page.getByRole("button", { name: /^Download/ }), `rup-cpdf-${fixture.slice(9, 11)}`);
      const d = visdiff("pdf", RUF(fixture), out, ["--dir", REVIEW, "--name", `cpdf-${tag}-${fixture.slice(0, 11)}`, "--max-images", "2"]);
      const checks = { look: band(d.minSsim, 0.9, 0.8), pages: flag(d.pagesOut === d.pagesSrc && d.allSizesKept), smaller: flag(size(out) < size(RUF(fixture))), target: flag(size(out) <= target, "LIMITED") };
      const verdict = worst(...Object.values(checks));
      rec("Compress PDF", `${fixture} → ${target / KB} KB`, verdict, { fixture, represents: DOC[fixture].says, expectation: "Smaller file, same pages, still looks like the original (text, stamps and signatures readable), no surprise conversions.", steps: "open /compress-pdf → add → Custom target → Compress → Download → compare", output: `${size(RUF(fixture))} → ${size(out)} bytes (${Math.round((1 - size(out) / size(RUF(fixture))) * 100)}% smaller)`, visual: `SSIM ${d.minSsim}, PSNR ${d.minPsnr}`, structural: `pages ${d.pagesOut}/${d.pagesSrc}, sizes kept=${d.allSizesKept}`, difference: verdict === "PASS" ? "image re-encoding only" : Object.entries(checks).filter(([, v]) => v !== "PASS").map(([k, v]) => `${k}=${v}`).join(", "), screen: headline.slice(0, 120), checks });
    });
  }
}
if (run("cimg")) {
  for (const [fixture, target] of [["DOCUMENT-10-filled-form.png", 600 * KB], ["DOCUMENT-14-photo-with-text.png", 400 * KB], ["DOCUMENT-11-receipt.jpg", 80 * KB], ["DOCUMENT-09-id-card-image.png", 250 * KB]]) {
    await step("Compress Image", `${fixture} → ${target / KB} KB`, async () => {
      await compressTarget("img", RUF(fixture), target);
      const details = (await page.getByTestId("image-details").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const out = await download(page, page.getByRole("button", { name: /^Download/ }), `rup-cimg-${fixture.slice(9, 11)}`);
      const d = visdiff("img", RUF(fixture), out, ["--dir", REVIEW, "--name", `cimg-${tag}-${fixture.replace(/\.\w+$/, "")}`]);
      const checks = { look: band(d.psnr, 30, 27), dimensions: d.sizeKept ? "PASS" : /×|x\s*\d/.test(details) ? "LIMITED" : "FAIL", target: flag(size(out) <= target, "LIMITED") };
      const verdict = worst(...Object.values(checks));
      rec("Compress Image", `${fixture} → ${target / KB} KB`, verdict, { fixture, represents: IMG[fixture], expectation: "Smaller image that looks the same at normal size; text in it stays readable; any resizing is stated.", steps: "open /compress-image → add → Custom target → Compress → Download → compare", output: `${size(RUF(fixture))} → ${size(out)} bytes, ${d.sizeSrc.join("×")} → ${d.sizeOut.join("×")}`, visual: `PSNR ${d.psnr} dB, SSIM ${d.ssim}`, structural: `dimensions kept=${d.sizeKept}`, difference: verdict === "PASS" ? "lossy re-encode within tolerance" : Object.entries(checks).filter(([, v]) => v !== "PASS").map(([k, v]) => `${k}=${v}`).join(", "), screen: details.slice(0, 160), checks });
    });
  }
}

// ---------------------------------------------------------------------------------------------- Merge / Split / Organize
async function pagesOf(file) {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true, updateMetadata: false })).getPageCount();
}
const identity = (d) => worst(band(d.minSsim, 0.999, 0.99), d.maxChangedPct <= 0.05 ? "PASS" : d.maxChangedPct <= 0.5 ? "LIMITED" : "FAIL", d.minTextRecall === null || d.minTextRecall >= 100 ? "PASS" : "FAIL", flag(d.allSizesKept));
if (run("merge")) {
  const files = ["DOCUMENT-06-resume-native.pdf", "DOCUMENT-12-table-report.pdf", "DOCUMENT-02-filled-application.pdf", "DOCUMENT-05-bank-statement.pdf"];
  await step("Merge PDF", "résumé + report + scanned application + scanned statement", async () => {
    await open(page, "/merge-pdf");
    await addPaths(page, files.map(RUF));
    let total = 0;
    for (const f of files) total += await pagesOf(RUF(f));
    await page.getByText(`${total} pages in total`, { exact: false }).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: `Merge ${files.length} PDFs` }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download merged PDF" }), "rup-merge");
    let offset = 0;
    const parts = [];
    for (const f of files) {
      const d = visdiff("pdf", RUF(f), out, ["--offset", String(offset), "--dir", REVIEW, "--name", `merge-${tag}-${f.slice(0, 11)}`, "--max-images", "1"]);
      parts.push({ file: f.slice(0, 11), grade: identity(d), minSsim: d.minSsim, recall: d.minTextRecall });
      offset += d.pagesExpected;
    }
    const count = (await pagesOf(out)) === total ? "PASS" : "FAIL";
    const verdict = worst(count, ...parts.map((p) => p.grade));
    rec("Merge PDF", "four documents, in order", verdict, { fixture: files.join(" + "), represents: "native and scanned documents of different kinds joined into one file", expectation: "All pages in the chosen order, each identical to its source — nothing re-rendered, rotated or compressed.", steps: "open /merge-pdf → add four PDFs → Merge → Download → compare every page with its source", output: `${await pagesOf(out)} pages (expected ${total})`, visual: parts.map((p) => `${p.file} SSIM ${p.minSsim}`).join("; "), structural: `order and page sizes kept; text recall ${parts.map((p) => p.recall).join("/")}`, difference: verdict === "PASS" ? "none (identical pages)" : JSON.stringify(parts.filter((p) => p.grade !== "PASS")), checks: { count, parts: parts.map((p) => p.grade) } });
  });
}
if (run("split")) {
  const F = "DOCUMENT-05-bank-statement.pdf";
  await step("Split PDF", "page 2 of the scanned statement", async () => {
    await open(page, "/split-pdf");
    await addPaths(page, [RUF(F)]);
    await page.getByRole("checkbox", { name: "Page 2", exact: true }).waitFor({ timeout: 60_000 });
    await page.getByRole("checkbox", { name: "Page 2", exact: true }).click();
    await page.getByRole("button", { name: /^Extract \d+ pages?$/ }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "rup-split");
    const d = visdiff("pdf", RUF(F), out, ["--map", "2", "--dir", REVIEW, "--name", `split-${tag}-p2`]);
    const verdict = worst(identity(d), flag(d.pagesOut === 1));
    rec("Split PDF", "page 2 of the scanned statement", verdict, { fixture: F, represents: DOC[F].says, expectation: "A PDF with just the chosen page, identical to it in the original.", steps: "open /split-pdf → add → tick Page 2 → Extract → Download → compare with the original page 2", output: `${d.pagesOut} page(s)`, visual: `SSIM ${d.minSsim}, ${d.maxChangedPct}% changed`, structural: `page size kept=${d.allSizesKept}`, difference: verdict === "PASS" ? "none" : "see checks", checks: { identity: identity(d) } });
  });
  await step("Split PDF", "every page of the signed contract → ZIP", async () => {
    await open(page, "/split-pdf");
    await addPaths(page, [RUF("DOCUMENT-08-signed-contract.pdf")]);
    await page.getByRole("radio", { name: /Split every page/ }).click();
    await page.getByRole("button", { name: "Split into 2 PDFs" }).click();
    await result();
    const zip = await download(page, page.getByRole("button", { name: "Download all (ZIP)" }), "rup-split-every");
    const entries = (await zipEntries(zip)).sort((a, b) => Number(a.name.match(/(\d+)\.pdf$/)?.[1]) - Number(b.name.match(/(\d+)\.pdf$/)?.[1]));
    const grades = [];
    for (const [i, e] of entries.entries()) {
      const f = path.join(OUT, `rup-split-every-${e.name}`);
      fs.writeFileSync(f, e.bytes);
      grades.push(identity(visdiff("pdf", RUF("DOCUMENT-08-signed-contract.pdf"), f, ["--map", String(i + 1)])));
    }
    const verdict = worst(flag(entries.length === 2), ...grades);
    rec("Split PDF", "every page of the signed contract → ZIP", verdict, { fixture: "DOCUMENT-08-signed-contract.pdf", represents: DOC["DOCUMENT-08-signed-contract.pdf"].says, expectation: "One single-page PDF per page, each identical to its page.", steps: "open /split-pdf → Split every page → Split into 2 PDFs → Download all (ZIP) → compare each file", output: `${entries.length} files`, visual: grades.join("/"), structural: "page sizes kept", difference: verdict === "PASS" ? "none" : "see grades", checks: { grades } });
  });
}
if (run("organize")) {
  const F = "DOCUMENT-08-signed-contract.pdf";
  const cards = () => page.locator("ol > li[data-sort-key]");
  await step("Organize PDF", "reverse the contract and turn the first page", async () => {
    await open(page, "/organize-pdf");
    await addPaths(page, [RUF(F)]);
    await cards().nth(1).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const a = await cards().nth(1).boundingBox();
    const b = await cards().nth(0).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 60);
    await page.mouse.down();
    await page.mouse.move(b.x + 20, b.y + 60, { steps: 14 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Save PDF" }).click();
    await result();
    const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "rup-org");
    const d = visdiff("pdf", RUF(F), out, ["--map", "2,1", "--rot", "90,0", "--dir", REVIEW, "--name", `organize-${tag}`]);
    const verdict = worst(identity(d), flag(d.pagesOut === 2));
    rec("Organize PDF", "reverse the contract and turn the first page", verdict, { fixture: F, represents: DOC[F].says, expectation: "Pages in the new order, the rotated one turned, everything else untouched.", steps: "open /organize-pdf → add → rotate page 2 right → drag page 2 first → Save PDF → Download → compare", output: `${d.pagesOut} pages`, visual: `SSIM ${d.minSsim}, ${d.maxChangedPct}% changed`, structural: "order and rotation checked against the source", difference: verdict === "PASS" ? "none" : "see SSIM", checks: { identity: identity(d) } });
  });
}

// ---------------------------------------------------------------------------------------------- PDF Editor — nothing changes outside the edit
if (run("editor")) {
  async function mapper() {
    const s = await page.getByTestId("page-surface").first().boundingBox();
    const k = s.width / 612;
    return (x, y) => [s.x + x * k, s.y + y * k];
  }
  async function drag(a, b) {
    await page.mouse.move(...a);
    await page.mouse.down();
    await page.mouse.move(...b, { steps: 8 });
    await page.mouse.up();
  }
  async function pick(name, menu) {
    if (menu) {
      await page.getByRole("button", { name: menu, exact: true }).click();
      await page.getByRole("menuitemradio", { name }).click();
    } else await page.getByRole("button", { name, exact: true }).click();
  }
  const APP = "DOCUMENT-02-filled-application.pdf";
  const RES = "DOCUMENT-06-resume-native.pdf";
  // The résumé's name line: white text on a dark band. The editor corrects a whole text line, so that line is the edited area.
  const probe = JSON.parse(execFileSync("python", ["-c", `import pymupdf,json;p=pymupdf.open(r"${RUF(RES)}")[0];w=[w for w in p.get_text("words") if w[4].isalpha() and len(w[4])>=6][0];ls=[l for b in p.get_text("dict")["blocks"] for l in b.get("lines",[]) if l["bbox"][0]<=w[0]+1 and l["bbox"][2]>=w[2]-1 and abs(l["bbox"][1]-w[1])<6][0];x0,y0,x1,y1=ls["bbox"];print(json.dumps({"word":w[4],"box":[x0-4,y0-4,x1+60,y1+4]}))`], { encoding: "utf8" }));
  /** Does the edit's cover match what was behind the old text? Mean grey just inside the box's corners, source vs output. */
  const coverBlends = (src, out, box) => JSON.parse(execFileSync("python", ["-c", `import pymupdf,json,numpy as np
def g(f):
    p=pymupdf.open(f)[0];pix=p.get_pixmap(matrix=pymupdf.Matrix(2,2),colorspace=pymupdf.csGRAY,alpha=False);return np.frombuffer(pix.samples,np.uint8).reshape(pix.height,pix.width).astype(float)
a,b=g(r"${src}"),g(r"${out}");x0,y0,x1,y1=[v*2 for v in ${JSON.stringify(box)}];x0+=10;y0+=10;x1-=10;y1-=10
pts=[(int(x0),int(y0)),(int(x1),int(y0)),(int(x0),int(y1)),(int(x1),int(y1))]
print(json.dumps(max(abs(a[y-2:y+2,x-2:x+2].mean()-b[y-2:y+2,x-2:x+2].mean()) for x,y in pts)))`], { encoding: "utf8" }));
  const OPS = [
    [APP, "export with no edits", async () => {}, null],
    [APP, "add a typed note on the form", async (at) => { await pick("Add text"); await page.mouse.click(...at(60, 610)); await page.keyboard.type("Received 10 Oct 2026"); await page.keyboard.press("Escape"); }, [50, 590, 300, 630]],
    [APP, "highlight a line on the form", async (at) => { await pick("Highlight"); await drag(at(60, 308), at(300, 322)); }, [55, 303, 305, 327]],
    [RES, "correct a word in the native résumé", async () => {
      // the page's own text, edited in place: double-click the paragraph, type the new word over the old one
      const block = page.locator(`[data-testid="native-block"][data-text*="${probe.word}"]`).first();
      await block.waitFor({ state: "attached", timeout: 60_000 });
      const text = (await block.getAttribute("data-text")) ?? "";
      await block.dblclick();
      const editor = page.getByTestId("native-text-editor");
      await editor.waitFor({ timeout: 30_000 });
      await page.keyboard.press("Control+Home");
      for (let i = 0; i < text.indexOf(probe.word); i++) await page.keyboard.press("ArrowRight");
      for (let i = 0; i < probe.word.length; i++) await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.type("Replaced");
      await page.getByRole("button", { name: "Apply this text edit" }).click();
      await editor.waitFor({ state: "detached", timeout: 30_000 });
    }, probe.box],
  ];
  for (const [fixture, what, act, box] of OPS) {
    await step("PDF Editor", `${what} (${fixture.slice(0, 11)})`, async () => {
      await open(page, "/pdf-editor");
      await addPaths(page, [RUF(fixture)]);
      await page.getByTestId("page-surface").waitFor({ timeout: 60_000 });
      await page.getByRole("button", { name: "Fit page" }).click();
      await page.waitForTimeout(500);
      await act(await mapper());
      await page.getByRole("button", { name: "Select", exact: true }).click().catch(() => {});
      const out = await download(page, page.getByRole("button", { name: "Export PDF" }), `rup-edit-${what.replace(/\W+/g, "-").slice(0, 24)}`);
      const a = ["--dir", REVIEW, "--name", `editor-${tag}-${fixture.slice(9, 11)}-${what.replace(/\W+/g, "-").slice(0, 20)}`, "--max-images", "1"];
      if (box) a.push("--mask", `1:${box.join(",")}`);
      const d = visdiff("pdf", RUF(fixture), out, a);
      const p1 = d.pages[0];
      let verdict;
      let visual;
      if (!box) {
        verdict = identity(d);
        visual = `identical to the source: SSIM ${d.minSsim}, ${d.maxChangedPct}% changed`;
      } else {
        const blend = fixture === RES ? coverBlends(RUF(fixture), out, box) : null;
        verdict = worst(p1.changedOutsidePct <= 0.05 ? "PASS" : p1.changedOutsidePct <= 0.5 ? "LIMITED" : "FAIL", p1.changedInsidePct > 0.5 ? "PASS" : "FAIL", flag(d.allSizesKept), blend === null ? "PASS" : blend <= 30 ? "PASS" : "FAIL");
        visual = `${p1.changedInsidePct}% changed inside the edit, ${p1.changedOutsidePct}% outside${blend === null ? "" : `; the cover differs from the background it sits on by ${blend.toFixed(0)}/255 grey`}`;
      }
      rec("PDF Editor", `${what} (${fixture.slice(0, 11)})`, verdict, { fixture, represents: DOC[fixture].says, expectation: "The edit appears; the rest of the page is untouched (no re-rendering of a scan, no lost text).", steps: "open /pdf-editor → add → make the edit → Export PDF → compare with the original", output: `${d.pagesOut} page(s)`, visual, structural: `page size kept=${d.allSizesKept}, text recall ${p1.textRecall ?? "n/a"}`, difference: verdict === "PASS" ? "only the edit differs" : "see percentages", checks: { verdict } });
    });
  }
}

// ---------------------------------------------------------------------------------------------- OCR as its own, explicit feature
if (run("ocr")) {
  const norm = (w) => w.normalize("NFC").toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const tokens = (file) => JSON.parse(execFileSync("python", ["-c", `import pymupdf,json;print(json.dumps([w[4] for p in pymupdf.open(r"${file}") for w in p.get_text("words")]))`], { encoding: "utf8" })).map(norm).filter(Boolean);
  const share = (want_, have) => {
    const pool = new Map();
    for (const w of have) pool.set(w, (pool.get(w) ?? 0) + 1);
    let hit = 0;
    for (const w of want_) if ((pool.get(w) ?? 0) > 0) { pool.set(w, pool.get(w) - 1); hit++; }
    return +((hit / Math.max(1, want_.length)) * 100).toFixed(1);
  };
  const CASES = [
    ["DOCUMENT-07-scanned-letter.pdf", "DOCUMENT-07-scanned-letter-ref.pdf", "H"],
    ["DOCUMENT-02-filled-application.pdf", "DOCUMENT-02-filled-application-ref.pdf", ""],
    ["DOCUMENT-04-invoice.pdf", "DOCUMENT-04-invoice-ref.pdf", ""],
  ];
  for (const [fixture, ref, journey] of CASES) {
    await step("OCR (Recognize text)", fixture, async () => {
      const mark = log.length;
      await open(page, "/pdf-editor");
      await addPaths(page, [RUF(fixture)]);
      await page.getByTestId("page-surface").first().waitFor({ timeout: 60_000 });
      await page.getByRole("button", { name: "Fit page" }).click();
      await page.getByRole("button", { name: "Recognize text" }).click();
      const busy = page.getByText(/Recognizing text|Preparing page|Loading text recognition/).first();
      await busy.waitFor({ timeout: 120_000 }).catch(() => {});
      await busy.waitFor({ state: "hidden", timeout: 300_000 });
      // recognized text is for search and copy: its words are not an editing surface
      const editTargets = await page.getByRole("button", { name: /^Edit recognized (word|line): / }).count();
      const out = await download(page, page.getByRole("button", { name: "Export PDF" }), `rup-ocr-${fixture.slice(9, 11)}`);
      const d = visdiff("pdf", RUF(fixture), out, ["--dir", REVIEW, "--name", `ocr-${tag}-${fixture.slice(0, 11)}`, "--max-images", "1"]);
      const truth = tokens(REF(ref));
      const have = tokens(out);
      const searchable = share(truth, have);
      const ocrRan = ocrRequests(log, mark).length > 0;
      const checks = { ranOnlyBecauseAsked: flag(ocrRan), looksUnchanged: worst(band(d.minSsim, 0.999, 0.99), d.maxChangedPct <= 0.05 ? "PASS" : d.maxChangedPct <= 0.5 ? "LIMITED" : "FAIL"), pagesKept: flag(d.pagesOut === d.pagesSrc && d.allSizesKept), searchable: band(searchable, 90, 75), noEditSurface: flag(editTargets === 0) };
      const verdict = worst(...Object.values(checks));
      rec("OCR (Recognize text)", fixture, verdict, { fixture, journey, represents: DOC[fixture].says, expectation: "Only when asked: the scan looks exactly as before and gains an invisible text layer — searchable and selectable. The scan itself is not edited as text.", steps: "open /pdf-editor → add the scan → Recognize text → Export PDF → compare, then read the PDF's text", output: `${tokens(out).length} words in the PDF text layer; ${editTargets} words offered for editing`, visual: `unchanged: SSIM ${d.minSsim}, ${d.maxChangedPct}% changed`, structural: `searchable ${searchable}% of the document's words`, difference: verdict === "PASS" ? "text layer added, pixels unchanged" : Object.entries(checks).filter(([, v]) => v !== "PASS").map(([k, v]) => `${k}=${v}`).join(", "), checks });
    });
  }
}

// ---------------------------------------------------------------------------------------------- the same on a phone
if (run("mobile")) {
  const m = await launch({ mobile: true });
  m.page.on("dialog", (d) => d.accept());
  const mlog = track(m.page);
  errorSource = () => m.errors.length;
  if (which === "mobile") {
    // Strategies seen on desktop are needed for the comparison: run the desktop pass quietly first.
    const quiet = records.length;
    for (const f of ["DOCUMENT-01-passport-scan.pdf", "DOCUMENT-02-filled-application.pdf", "DOCUMENT-06-resume-native.pdf"]) await p2wCase(page, log, RUF(f));
    records.splice(quiet);
  }
  for (const f of ["DOCUMENT-01-passport-scan.pdf", "DOCUMENT-02-filled-application.pdf", "DOCUMENT-06-resume-native.pdf"]) await p2wCase(m.page, mlog, RUF(f), { mobile: true });
  await i2wCase(m.page, mlog, ["DOCUMENT-10-filled-form.png"], "Fit to image", "filled form PNG", { mobile: true });
  rec("PDF → Word [mobile]", "console errors", m.errors.length ? "FAIL" : "PASS", { errors: m.errors.slice(0, 3), fixture: "(all mobile steps)", represents: "-", expectation: "No console errors on a phone." });
  await m.browser.close();
}

const leaked = log.filter((r) => !/^(blob|data):/.test(r.url) && !r.url.startsWith(new URL(process.env.BASE ?? "http://localhost:3000").origin));
rec("All tools", "no third-party requests, no uploads", leaked.length || log.some((r) => r.post > 0) ? "FAIL" : "PASS", { leaked: leaked.slice(0, 5).map((r) => r.url), fixture: "(whole run)", represents: "-", expectation: "Everything happens in the browser." });
rec("All tools", "console errors (desktop)", errors.length ? "FAIL" : "PASS", { count: errors.length, errors: errors.slice(0, 3), fixture: "(whole run)", represents: "-", expectation: "No console errors." });
await browser.close();
save(`rup-${which}-${tag}`);
const tally = {};
for (const r of records) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
console.log(JSON.stringify(tally));
