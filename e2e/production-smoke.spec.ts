import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { EDITOR_FIXTURES, exportPdf, finishEdit, openEditor, pdfText, typeInto } from "./helpers/native";
import { field, form, openForm, settled, expectNoOverlayGhost, HIDE_OVERLAYS } from "./helpers/forms";
import { clipOf, ink, shot } from "./helpers/pixels";

/**
 * PRODUCTION SMOKE (run with playwright.prod.config.ts against https://thefileconvert.com): one real flow per feature through the
 * live UI; every download is validated by the shared output validator (qpdf, MuPDF, pdf.js, pdf-lib / OOXML / image decode);
 * the whole run is watched for uploads, third-party requests, console errors and failing responses.
 */
const REAL = path.resolve("qa/real-user-fixtures");
const FRESH = path.resolve("qa/fresh-scenario-fixtures");
const REAL_SCAN = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf"; // the only permitted Downloads file
const MB = 1_000_000;

type Validate = { validateFile: (f: string) => Promise<{ ok: boolean; problems: string[]; pages?: number; kind?: string }> };
let validator: Validate;
const issues: string[] = [];

test.beforeAll(async () => {
  validator = (await import(/* webpackIgnore: true */ pathToFileURL(path.resolve("qa/scripts/validate-output.mjs")).href)) as Validate;
});

test.beforeEach(async ({ page, baseURL }) => {
  issues.length = 0;
  const origin = new URL(baseURL!).origin;
  page.on("pageerror", (e) => issues.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") issues.push(`console error: ${m.text().slice(0, 200)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) issues.push(`HTTP ${r.status()} ${r.url().slice(0, 160)}`);
  });
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("blob:") || u.startsWith("data:")) return;
    if (!u.startsWith(origin)) issues.push(`third-party request ${u.slice(0, 160)}`);
    if (!["GET", "HEAD"].includes(r.method()) || (r.postData() ?? "").length > 0) issues.push(`request with a body: ${r.method()} ${u.slice(0, 160)}`);
  });
});

test.afterEach(async () => {
  expect(issues, "console errors, failing responses, uploads or third-party requests").toEqual([]);
});

async function download(page: Page, button: ReturnType<Page["getByRole"]>, name: string): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), button.click()]);
  const out = test.info().outputPath(name + "-" + dl.suggestedFilename());
  await dl.saveAs(out);
  return out;
}
async function checked(file: string) {
  const v = await validator.validateFile(file);
  expect(v.problems, `${path.basename(file)} integrity`).toEqual([]);
  expect(v.ok).toBe(true);
  return v;
}

test("fingerprint: the polished fresh-launch site is what is live", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/TheFileConvert — Every file\. One simple place\./);
  if (!isMobile) {
    for (const name of ["Compress", "Convert", "PDF Tools"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "PDF Editor" }).first()).toBeVisible();
  }
  // no old yellow highlight behind the hero headline
  const yellow = await page.evaluate(() => {
    const h = document.querySelector("h1");
    if (!h) return ["no h1"];
    return [h, ...h.querySelectorAll("*")].map((e) => getComputedStyle(e).backgroundColor).filter((c) => /rgb\(2[2-5]\d, 2[0-5]\d, \d{1,2}\)/.test(c));
  });
  expect(yellow).toEqual([]);
  for (const [route, text] of [["/compress-pdf", "Compress PDF"], ["/pdf-to-word", "PDF to Word"], ["/word-to-pdf", "Word to PDF"], ["/image-to-word", "Image"], ["/pdf-editor", "Edit PDF"]] as const) {
    const r = await page.request.get(route);
    expect(r.status(), route).toBe(200);
    expect(await r.text()).toContain(text);
  }
});

test("Compress PDF: the real scanned PDF (3.98 MB) → under 1 MB, valid, same pages", async ({ page }) => {
  expect(fs.statSync(REAL_SCAN).size).toBe(3_982_736);
  await page.goto("/compress-pdf");
  await page.getByTestId("file-input").first().setInputFiles(REAL_SCAN);
  await page.getByText("How small do you need it?").waitFor({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  await page.getByLabel("Custom target size").fill("1");
  await page.getByRole("radio", { name: "MB", exact: true }).click();
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 240_000 });
  const out = await download(page, page.getByRole("button", { name: /^Download/ }).first(), "scan");
  const v = await checked(out);
  expect(fs.statSync(out).size).toBeLessThanOrEqual(MB);
  expect(v.pages).toBe((await PDFDocument.load(fs.readFileSync(REAL_SCAN))).getPageCount());
});

test("Compress Image: a 3 MB photo → under 500 KB, decodes", async ({ page }) => {
  await page.goto("/compress-image");
  await page.getByTestId("file-input").first().setInputFiles(path.join(FRESH, "IMAGE-C-photo-3mb.jpg"));
  await page.getByText(/How small/i).first().waitFor({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  await page.getByLabel("Custom target size").fill("500");
  await page.getByRole("radio", { name: "KB", exact: true }).click();
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const out = await download(page, page.getByRole("button", { name: /^Download/ }).first(), "photo");
  await checked(out);
  expect(fs.statSync(out).size).toBeLessThanOrEqual(500_000);
});

async function docxParts(file: string) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml")!.async("string");
  const media = Object.keys(zip.files).filter((n) => n.startsWith("word/media/"));
  const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return { xml, media, text };
}

test("PDF → Word: a scanned form keeps its look (picture, no retyped text)", async ({ page }) => {
  await page.goto("/pdf-to-word");
  await page.getByTestId("file-input").first().setInputFiles(path.join(REAL, "DOCUMENT-02-filled-application.pdf"));
  await page.getByRole("button", { name: "Convert to Word" }).click();
  await page.getByTestId("result").waitFor({ timeout: 240_000 });
  const out = await download(page, page.getByRole("button", { name: "Download .docx" }), "form");
  await checked(out);
  const d = await docxParts(out);
  expect(d.media.length, "the page picture").toBeGreaterThanOrEqual(1);
  expect(d.text.replace(/[^A-Za-z]/g, "").length, "no recognized text laid over the picture").toBeLessThan(40);
});

test("PDF → Word: a native résumé becomes editable Word text", async ({ page }) => {
  const src = path.join(REAL, "DOCUMENT-06-resume-native.pdf");
  await page.goto("/pdf-to-word");
  await page.getByTestId("file-input").first().setInputFiles(src);
  await page.getByRole("button", { name: "Convert to Word" }).click();
  await page.getByTestId("result").waitFor({ timeout: 240_000 });
  const out = await download(page, page.getByRole("button", { name: "Download .docx" }), "resume");
  await checked(out);
  const d = await docxParts(out);
  const words = [...new Set((await pdfText(fs.readFileSync(src))).split(/\s+/).filter((w) => /^[A-Za-z]{7,}$/.test(w)))].slice(0, 12);
  expect(words.length).toBeGreaterThan(5);
  for (const w of words) expect(d.text, `word "${w}" is real text in the document`).toContain(w);
  expect((d.xml.match(/<w:p[ >]/g) ?? []).length).toBeGreaterThanOrEqual(8);
});

test("Word → PDF: a complex report renders to a valid PDF with its text", async ({ page }) => {
  const src = path.join(REAL, "DOCUMENT-16-complex-word-report.docx");
  await page.goto("/word-to-pdf");
  await page.getByTestId("file-input").first().setInputFiles(src);
  await page.getByRole("button", { name: "Convert to PDF" }).click();
  await page.getByTestId("result").waitFor({ timeout: 240_000 });
  const out = await download(page, page.getByRole("button", { name: "Download PDF" }), "report");
  const v = await checked(out);
  expect(v.pages).toBeGreaterThanOrEqual(1);
  const d = await docxParts(src);
  // the words of the document as it reads (deleted tracked-change text is not part of it)
  const live = [...d.xml.matchAll(/<w:t[ >][^<]*|<w:t>[^<]*/g)].map((m) => m[0].replace(/^<w:t[^>]*>/, "")).join(" ");
  const words = [...new Set(live.split(/\s+/).filter((w) => /^[A-Za-z]{8,}$/.test(w)))].slice(0, 10);
  const outBytes = fs.readFileSync(out);
  let t = "";
  for (let i = 1; i <= v.pages!; i++) t += " " + (await pdfText(outBytes, i));
  for (const w of words) expect(t, `word "${w}"`).toContain(w);
});

test("Image → Word: a filled-form PNG keeps its look", async ({ page }) => {
  await page.goto("/image-to-word");
  await page.getByTestId("file-input").first().setInputFiles(path.join(REAL, "DOCUMENT-10-filled-form.png"));
  await page.getByRole("button", { name: /^Create Word document/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const out = await download(page, page.getByRole("button", { name: "Download .docx" }), "i2w");
  await checked(out);
  expect((await docxParts(out)).media.length).toBeGreaterThanOrEqual(1);
});

test("PDF → Image, Image → PDF, Image converter, Merge, Split, Organize", async ({ page }) => {
  // PDF → Image
  await page.goto("/pdf-to-image");
  await page.getByTestId("file-input").first().setInputFiles(path.join(REAL, "DOCUMENT-05-bank-statement.pdf"));
  await page.getByRole("button", { name: /^Convert (all|page)/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  await checked(await download(page, page.getByRole("button", { name: /^Download/ }).first(), "p2i"));
  // Image → PDF
  await page.goto("/image-to-pdf");
  await page.getByTestId("file-input").first().setInputFiles([path.join(REAL, "DOCUMENT-09-id-card-image.png"), path.join(REAL, "DOCUMENT-10-filled-form.png"), path.join(REAL, "DOCUMENT-11-receipt.jpg")].filter(fs.existsSync));
  await page.getByRole("button", { name: /^Create PDF/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const i2p = await checked(await download(page, page.getByRole("button", { name: "Download PDF" }), "i2p"));
  expect(i2p.pages).toBeGreaterThanOrEqual(1);
  // Image converter
  await page.goto("/convert-image");
  await page.getByTestId("file-input").first().setInputFiles(path.join(REAL, "DOCUMENT-10-filled-form.png"));
  await page.getByRole("radio", { name: /^JPG/ }).click();
  await page.getByRole("button", { name: "Convert to JPG" }).click();
  await page.getByTestId("result").waitFor({ timeout: 60_000 });
  await checked(await download(page, page.getByRole("button", { name: "Download JPG" }), "jpg"));
  // Merge
  await page.goto("/merge-pdf");
  const a = path.join(REAL, "DOCUMENT-06-resume-native.pdf");
  const b = path.join(REAL, "DOCUMENT-05-bank-statement.pdf");
  await page.getByTestId("file-input").first().setInputFiles([a, b]);
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const merged = await checked(await download(page, page.getByRole("button", { name: "Download merged PDF" }), "merge"));
  expect(merged.pages).toBe((await PDFDocument.load(fs.readFileSync(a))).getPageCount() + (await PDFDocument.load(fs.readFileSync(b))).getPageCount());
  // Split (page 2 of the statement)
  await page.goto("/split-pdf");
  await page.getByTestId("file-input").first().setInputFiles(b);
  await page.getByRole("checkbox", { name: "Page 2", exact: true }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Extract \d+ pages?$/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const split = await checked(await download(page, page.getByRole("button", { name: "Download PDF" }), "split"));
  expect(split.pages).toBe(1);
  // Organize (rotate page 2)
  await page.goto("/organize-pdf");
  await page.getByTestId("file-input").first().setInputFiles(b);
  await page.getByRole("button", { name: "Rotate Page 2 right", exact: true }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Save PDF" }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
  const org = await checked(await download(page, page.getByRole("button", { name: "Download PDF" }), "organize"));
  expect(org.pages).toBe(2);
  expect((await PDFDocument.load(fs.readFileSync(path.join(test.info().outputDir, fs.readdirSync(test.info().outputDir).find((n) => n.startsWith("organize-"))!)))).getPage(1).getRotation().angle).toBe(90);
});

test("PDF Editor E — pre-filled form: Raviteja once at rest, while editing, after export and reopen", async ({ page, isMobile }) => {
  test.skip(isMobile, "pixel geometry is checked on desktop; the phone has its own test");
  const src = form("FORM-01-given-name.pdf");
  await openForm(page, src);
  const rest = await expectNoOverlayGhost(page, "given_name");
  const restInk = ink(rest);
  expect(restInk.empty).toBe(false);
  await field(page, "given_name").click();
  await expect(field(page, "given_name")).toHaveAttribute("data-state", "editing");
  await page.waitForTimeout(300);
  const clip = await clipOf(field(page, "given_name"), 0);
  const withBoth = await shot(page, clip);
  const boxOnly = await shot(page, clip, '[data-testid="page-surface"] canvas{visibility:hidden !important}');
  let differing = 0;
  for (let i = 0; i < withBoth.data.length; i += 4) if (Math.abs(withBoth.data[i] - boxOnly.data[i]) > 110) differing++;
  expect(differing, "the original appearance does not show through the edit box").toBe(0);
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await page.keyboard.press("Tab");
  await settled(page, "given_name");
  await field(page, "given_name").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Tab");
  await settled(page, "given_name");
  await expectNoOverlayGhost(page, "given_name");
  const out = await exportPdf(page, "raviteja.pdf");
  const file = test.info().outputPath("raviteja-out.pdf");
  fs.writeFileSync(file, out);
  await checked(file);
  expect((await PDFDocument.load(out)).getForm().getTextField("given_name").getText()).toBe("Raviteja");
  await openForm(page, file);
  const reopened = ink(await expectNoOverlayGhost(page, "given_name"));
  for (const k of ["x0", "y0", "x1", "y1"] as const) expect(Math.abs(reopened[k] - restInk[k])).toBeLessThanOrEqual(2);
});

test("PDF Editor F — native typo: teh → the, search sees the new text, export valid", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow; the phone has its own test");
  await openEditor(page, path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"));
  await typeInto(page, { has: "teh chair", find: "teh", replace: "the" });
  await finishEdit(page);
  await page.locator("summary", { hasText: /^\s*Search/ }).click();
  await page.getByLabel("Search document text").fill("the chair");
  await expect(page.getByText(/\d+ of \d+/).first()).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Search document text").fill("teh chair");
  await expect(page.getByText("No matches")).toBeVisible({ timeout: 15_000 });
  const out = await exportPdf(page, "typo.pdf");
  const file = test.info().outputPath("typo-out.pdf");
  fs.writeFileSync(file, out);
  await checked(file);
  const t = await pdfText(out);
  expect(t).toContain("the chair");
  expect(t).not.toContain("teh chair");
});

test("PDF Editor on a phone: tap text → Edit text → type → Done → export; form field tap", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"));
  const block = page.locator('[data-testid="native-block"][data-text*="recieve"]').first();
  await block.waitFor({ state: "attached", timeout: 60_000 });
  const text = (await block.getAttribute("data-text")) ?? "";
  await block.scrollIntoViewIfNeeded();
  await block.tap();
  await page.getByTestId("native-edit-button").tap();
  const editor = page.getByTestId("native-text-editor");
  await editor.waitFor({ timeout: 30_000 });
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < text.indexOf("recieve"); i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.type("receive");
  await finishEdit(page);
  const out = await exportPdf(page, "phone.pdf");
  const file = test.info().outputPath("phone-out.pdf");
  fs.writeFileSync(file, out);
  await checked(file);
  expect(await pdfText(out)).toContain("receive");
  // a pre-filled field on the phone
  await page.goto("/pdf-editor");
  await page.getByTestId("file-input").first().setInputFiles(form("FORM-01-given-name.pdf"));
  const f = field(page, "given_name");
  await expect(f).toBeAttached({ timeout: 30_000 });
  await f.scrollIntoViewIfNeeded();
  await f.tap();
  await expect(f).toHaveAttribute("data-state", "editing");
  await page.keyboard.type("x");
  await page.keyboard.press("Tab");
  await expect(f).toHaveAttribute("data-state", "idle", { timeout: 15_000 });
});

test("mobile: Compress PDF, PDF → Word and the image converter work on a phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await page.goto("/compress-pdf");
  await page.getByTestId("file-input").first().setInputFiles(path.join(FRESH, "PDF-C-scan-3.8mb-incremental.pdf"));
  await page.getByText("How small do you need it?").waitFor({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Custom", exact: true }).tap();
  await page.getByLabel("Custom target size").fill("1");
  await page.getByRole("radio", { name: "MB", exact: true }).tap();
  await page.getByRole("button", { name: /^Compress to under/ }).tap();
  await page.getByTestId("result").waitFor({ timeout: 240_000 });
  const c = await download(page, page.getByRole("button", { name: /^Download/ }).first(), "m-compress");
  await checked(c);
  expect(fs.statSync(c).size).toBeLessThanOrEqual(MB);
  await page.goto("/pdf-to-word");
  await page.getByTestId("file-input").first().setInputFiles(path.join(REAL, "DOCUMENT-06-resume-native.pdf"));
  await page.getByRole("button", { name: "Convert to Word" }).tap();
  await page.getByTestId("result").waitFor({ timeout: 240_000 });
  await checked(await download(page, page.getByRole("button", { name: "Download .docx" }), "m-p2w"));
  await page.goto("/convert-image");
  await page.getByTestId("file-input").first().setInputFiles(path.join(REAL, "DOCUMENT-10-filled-form.png"));
  await page.getByRole("radio", { name: /^JPG/ }).tap();
  await page.getByRole("button", { name: "Convert to JPG" }).tap();
  await page.getByTestId("result").waitFor({ timeout: 60_000 });
  await checked(await download(page, page.getByRole("button", { name: "Download JPG" }), "m-jpg"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
});

void HIDE_OVERLAYS;
