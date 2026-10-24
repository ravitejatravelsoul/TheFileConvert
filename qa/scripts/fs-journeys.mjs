// Complete user journeys and round trips through the real UI, using the product's own "Continue with"
// hand-offs wherever they exist (no re-picking files). Every download goes through the shared validator.
//   BASE=http://localhost:3000 node qa/scripts/fs-journeys.mjs [journeys|roundtrip|all]
import { execFileSync } from "node:child_process";
import { launch, open, download, rec, save, fs, path, addPaths, sx, pdfInfo, imageInfo } from "./fl-lib.mjs";
import { accuracy, pdfStruct } from "./fs-docx.mjs";

const which = process.argv[2] ?? "all";
const DOCX = (n) => path.resolve("qa/fresh-scenario-fixtures/docx", n);
const WORD = (n) => path.resolve("qa/fresh-scenario-fixtures/word", n);
const docxTruth = JSON.parse(fs.readFileSync(DOCX("truth.json"), "utf8"));
const pdfTruth = JSON.parse(fs.readFileSync(WORD("truth.json"), "utf8"));
const docxCheck = (file) => JSON.parse(execFileSync("python", ["qa/validate/docxcheck.py", file], { encoding: "utf8", maxBuffer: 1 << 26 }).trim().split("\n").pop());
const KB = 1000;
const MB = 1_000_000;

const { browser, page, errors } = await launch();
page.on("dialog", (d) => d.accept());
const requests = [];
page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), post: (r.postDataBuffer() ?? Buffer.alloc(0)).length }));
const uploadsSince = (n) => requests.slice(n).filter((r) => !/^(blob|data):/.test(r.url) && (r.post > 0 || r.method !== "GET" || !r.url.startsWith(new URL(page.url()).origin)));
const result = () => page.getByTestId("result").waitFor({ timeout: 300_000 });
const cont = async (name, url) => {
  await page.getByRole("button", { name, exact: true }).click();
  await page.waitForURL(url, { timeout: 30_000 });
};

async function wordToPdf(docx, tag) {
  await page.getByRole("button", { name: "Convert to PDF" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Convert to PDF" }).click();
  await result();
  return download(page, page.getByRole("button", { name: "Download PDF" }), tag);
}
async function pdfToWord(tag) {
  await page.getByRole("button", { name: "Convert to Word" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Convert to Word" }).click();
  await result();
  return download(page, page.getByRole("button", { name: "Download .docx" }), tag);
}
async function compressTo(bytes, tag) {
  await page.getByText("How small do you need it?").waitFor({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  const mb = bytes >= MB;
  await page.getByLabel("Custom target size").fill(String(mb ? bytes / MB : bytes / KB));
  await page.getByRole("radio", { name: mb ? "MB" : "KB", exact: true }).click();
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  await result();
  return download(page, page.getByRole("button", { name: /^Download/ }).first(), tag);
}

async function journey(name, fn) {
  const before = requests.length;
  const t0 = Date.now();
  try {
    const detail = await fn();
    const uploads = uploadsSince(before);
    rec("Journey", name, uploads.length ? "FAIL" : detail.ok ? "PASS" : "FAIL", { ...detail, ms: Date.now() - t0, uploads: uploads.map((u) => `${u.method} ${u.url}`).slice(0, 3) });
  } catch (e) {
    rec("Journey", name, "FAIL", { error: String(e).slice(0, 400) });
  }
}

if (which === "all" || which === "journeys") {
  await journey("A: Word → PDF → compress under 1 MB → download", async () => {
    await open(page, "/word-to-pdf");
    await addPaths(page, [DOCX("WORD-15-photos.docx")]);
    const pdf = await wordToPdf(DOCX("WORD-15-photos.docx"), "journeyA-1");
    const pdfBytes = fs.statSync(pdf).size;
    await cont("Compress PDF", /\/compress-pdf$/);
    const small = await compressTo(1 * MB, "journeyA-2");
    const s = pdfStruct(small);
    const text = s.pages.map((p) => p.text).join(" ");
    return { ok: pdfBytes > MB && fs.statSync(small).size <= MB && s.pages.reduce((n, p) => n + p.images.length, 0) === 3 && text.includes("Photo 3: north wall"), wordPdf: pdfBytes, compressed: fs.statSync(small).size, pages: s.pages.length };
  });

  await journey("B: PDF → Word → Word to PDF", async () => {
    const t = pdfTruth.find((x) => x.id === "PDF-WORD-03");
    await open(page, "/pdf-to-word");
    await addPaths(page, [WORD(t.file)]);
    const docx = await pdfToWord("journeyB-1");
    await page.getByRole("link", { name: "Word to PDF", exact: true }).first().click();
    await page.waitForURL(/\/word-to-pdf$/);
    await addPaths(page, [docx]);
    const pdf = await wordToPdf(docx, "journeyB-2");
    const s = pdfStruct(pdf);
    const acc = accuracy(t.blocks.map((b) => b.text), s.pages.map((p) => p.text).join("\n"));
    return { ok: acc.recall >= 98 && acc.order >= 95 && s.pages.length === t.pages, ...acc, pages: s.pages.length };
  });

  await journey("C: JPG → PDF → merge with another PDF → compress", async () => {
    await open(page, "/image-to-pdf");
    await addPaths(page, [sx("IMAGE-C-photo-3mb.jpg")]);
    await page.getByRole("button", { name: /^Create PDF/ }).click();
    await result();
    const one = await download(page, page.getByRole("button", { name: "Download PDF" }), "journeyC-1");
    await cont("Merge PDF", /\/merge-pdf$/);
    await page.getByText("IMAGE-C-photo-3mb.pdf").first().waitFor({ timeout: 30_000 });
    await page.getByTestId("file-input").last().setInputFiles([sx("PDF-K-native-text.pdf")]);
    await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
    await result();
    const merged = await download(page, page.getByRole("button", { name: "Download merged PDF" }), "journeyC-2");
    const mergedPages = (await pdfInfo(merged)).pages;
    const kPages = (await pdfInfo(sx("PDF-K-native-text.pdf"))).pages;
    await cont("Compress PDF", /\/compress-pdf$/);
    const small = await compressTo(1 * MB, "journeyC-3");
    const final = await pdfInfo(small);
    return { ok: mergedPages === 1 + kPages && final.pages === mergedPages && fs.statSync(small).size <= MB, imagePdf: fs.statSync(one).size, mergedPages, merged: fs.statSync(merged).size, compressed: fs.statSync(small).size };
  });

  await journey("D: PDF → organize → edit → compress", async () => {
    await open(page, "/organize-pdf");
    await addPaths(page, [sx("PDF-H-multipage-text-image.pdf")]);
    await page.getByRole("button", { name: "Rotate Page 1 right", exact: true }).click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Delete Page 10", exact: true }).click();
    await page.getByRole("button", { name: "Save PDF" }).click();
    await result();
    const organized = await download(page, page.getByRole("button", { name: "Download PDF" }), "journeyD-1");
    await cont("PDF Editor", /\/pdf-editor$/);
    await page.getByTestId("page-surface").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1000);
    const b = await page.getByTestId("page-surface").first().boundingBox();
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await page.mouse.click(b.x + b.width * 0.2, b.y + Math.min(b.height * 0.9, 380));
    await page.keyboard.type("Approved 09/28/2026");
    await page.keyboard.press("Escape");
    const edited = await download(page, page.getByRole("button", { name: "Export PDF" }), "journeyD-2");
    await page.getByTestId("editor-continue").getByRole("button", { name: "Compress PDF" }).click();
    await page.waitForURL(/\/compress-pdf$/);
    const small = await compressTo(500 * KB, "journeyD-3");
    const [o, e, c] = [await pdfInfo(organized), await pdfInfo(edited), await pdfInfo(small)];
    const ok = o.pages === 9 && o.rotations[0] === 90 && e.pages === 9 && e.texts.join(" ").includes("Approved 09/28/2026") && c.pages === 9 && c.rotations[0] === 90 && c.texts.join(" ").includes("Approved 09/28/2026");
    return { ok, organizedPages: o.pages, rotation: c.rotations[0], editedHasText: e.texts.join(" ").includes("Approved"), compressed: fs.statSync(small).size };
  });

  await journey("E: scanned PDF → Word → download (a plain scan becomes editable only when the reading is reliable; otherwise it keeps its look)", async () => {
    // Current semantics (qa/CONVERSION_SEMANTICS.md): a plain scanned letter may become editable paragraphs when the on-device
    // reading is extremely reliable; every other scan keeps the picture of the page. Either way nothing unreliable is retyped.
    const t = pdfTruth.find((x) => x.id === "PDF-WORD-09");
    await open(page, "/pdf-to-word");
    await addPaths(page, [WORD(t.file)]);
    await page.getByRole("button", { name: /Convert to Word/ }).waitFor({ timeout: 60_000 });
    const docx = await pdfToWord("journeyE");
    const d = docxCheck(docx);
    const acc = accuracy(t.blocks.map((b) => b.text), d.text);
    const editable = acc.recall >= 90;
    const picture = fs.statSync(docx).size > 10_000;
    return { ok: d.ok && (editable || picture), docxValid: d.ok, outcome: editable ? "editable text" : picture ? "page kept as a picture" : "neither", ...acc };
  });

  await journey("F: PNG → WebP → compress", async () => {
    await open(page, "/convert-image");
    await addPaths(page, [sx("IMAGE-G-large-photo.png")]);
    await page.getByRole("radio", { name: /^WebP/ }).click();
    await page.getByRole("button", { name: "Convert to WebP" }).click();
    await result();
    const webp = await download(page, page.getByRole("button", { name: "Download WebP" }), "journeyF-1");
    await cont("Compress Image", /\/compress-image$/);
    const small = await compressTo(100 * KB, "journeyF-2");
    const [a, b] = [await imageInfo(webp), await imageInfo(small)];
    return { ok: a.format === "webp" && fs.statSync(small).size <= 100 * KB && ["webp", "jpeg"].includes(b.format), webp: fs.statSync(webp).size, compressed: fs.statSync(small).size, format: b.format };
  });
}

if (which === "all" || which === "roundtrip") {
  // PDF → Word → PDF: the text, its order, the pictures and the page count survive both conversions.
  for (const id of ["PDF-WORD-01", "PDF-WORD-03", "PDF-WORD-04", "PDF-WORD-05", "PDF-WORD-06", "PDF-WORD-07", "PDF-WORD-08", "PDF-WORD-12", "PDF-WORD-13"]) {
    const t = pdfTruth.find((x) => x.id === id);
    const before = requests.length;
    try {
      await open(page, "/pdf-to-word");
      await addPaths(page, [WORD(t.file)]);
      const docx = await pdfToWord(`rt1-${id}`);
      await open(page, "/word-to-pdf");
      await addPaths(page, [docx]);
      const pdf = await wordToPdf(docx, `rt1-${id}`);
      const src = pdfStruct(WORD(t.file));
      const s = pdfStruct(pdf);
      const acc = accuracy(t.blocks.map((b) => b.text), s.pages.map((p) => p.text).join("\n"));
      const imgsIn = src.pages.reduce((n, p) => n + p.images.length, 0);
      const imgsOut = s.pages.reduce((n, p) => n + p.images.length, 0);
      const boldIn = src.pages.some((p) => p.spans.some((x) => x.bold));
      const boldOut = s.pages.some((p) => p.spans.some((x) => x.bold));
      const ok = acc.recall >= 98 && acc.order >= 95 && imgsOut >= imgsIn && s.pages.length === t.pages && (!boldIn || boldOut);
      rec("Round trip PDF → Word → PDF", `${id} ${t.what}`, uploadsSince(before).length ? "FAIL" : ok ? "PASS" : "LIMITED", { ...acc, pagesIn: t.pages, pagesOut: s.pages.length, imagesIn: imgsIn, imagesOut: imgsOut, boldKept: !boldIn || boldOut });
    } catch (e) {
      rec("Round trip PDF → Word → PDF", `${id}`, "FAIL", { error: String(e).slice(0, 300) });
    }
  }
  // Word → PDF → Word: text, order, headings, bold, lists, tables and pictures survive.
  for (const f of ["WORD-02-headings.docx", "WORD-03-formatting.docx", "WORD-04-lists.docx", "WORD-05-table.docx", "WORD-06-images.docx", "WORD-08-special-characters.docx", "WORD-10-header-footer.docx", "WORD-12-complex.docx"]) {
    const t = docxTruth[f];
    const before = requests.length;
    try {
      await open(page, "/word-to-pdf");
      await addPaths(page, [DOCX(f)]);
      const pdf = await wordToPdf(DOCX(f), `rt2-${f.slice(0, 7)}`);
      await open(page, "/pdf-to-word");
      await addPaths(page, [pdf]);
      const docx = await pdfToWord(`rt2-${f.slice(0, 7)}`);
      const d = docxCheck(docx);
      // Headers and footers become body text in the reconstructed document; score the body text.
      const acc = accuracy(t.texts, d.text);
      const c = {};
      if (t.expect.headings) c.headings = Object.keys(t.expect.headings).every((h) => d.paragraphs.some((p) => p.text.trim() === h && /^(Heading|Title)/.test(p.style ?? "")));
      if (t.expect.bold) c.bold = d.paragraphs.some((p) => p.bold.join("").includes(t.expect.bold));
      if (t.expect.italic) c.italic = d.paragraphs.some((p) => (p.italic ?? []).join("").includes(t.expect.italic));
      if (t.expect.bullets) c.bullets = d.paragraphs.filter((p) => p.list === "bullet").length >= 3;
      if (t.expect.numbers) c.numbered = d.paragraphs.filter((p) => p.list === "decimal").length >= 4;
      if (t.expect.table) c.table = (d.tables ?? []).some((tb) => tb.length === t.expect.table.rows && tb[0].length === t.expect.table.cols);
      if (t.expect.images) c.images = (d.pictures ?? []).length === t.expect.images;
      const ok = d.ok && acc.recall >= 97 && acc.order >= 93 && Object.values(c).every(Boolean);
      rec("Round trip Word → PDF → Word", f.replace(/\.docx$/, ""), uploadsSince(before).length ? "FAIL" : ok ? "PASS" : "LIMITED", { docxValid: d.ok, ...acc, checks: c, paragraphs: d.paragraphs.length, tables: d.tables?.length, pictures: d.pictures?.length });
    } catch (e) {
      rec("Round trip Word → PDF → Word", f, "FAIL", { error: String(e).slice(0, 300) });
    }
  }
}

rec("Journeys", "console errors", errors.length ? "FAIL" : "PASS", errors.length ? { errors: errors.slice(0, 5) } : {});
await browser.close();
save(`fs-journeys${which === "all" ? "" : "-" + which}`);
