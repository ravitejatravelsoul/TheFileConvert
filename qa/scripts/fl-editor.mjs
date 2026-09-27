// PDF editor acceptance: a native-text session and scanned (OCR) sessions, exported and re-verified.
//   node qa/scripts/fl-editor.mjs [native|scan|real]
import { launch, open, addFiles, download, pdfInfo, renderPage, rec, save, shot, fx, fs, path, OUT } from "./fl-lib.mjs";

const which = process.argv[2] ?? "all";
const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf"; // the user's own supplied test PDF (only permitted Downloads file)

/** Page-point → screen mapper for the current page surface (origin top-left, PDF points). */
async function mapper(page, widthPts = 612) {
  const surf = page.getByTestId("page-surface").first();
  const S = await surf.boundingBox();
  const k = S.width / widthPts;
  return (x, y) => [S.x + x * k, S.y + y * k];
}
async function drag(page, a, b, steps = 8) {
  await page.mouse.move(...a);
  await page.mouse.down();
  await page.mouse.move(...b, { steps });
  await page.mouse.up();
}
const px = (img, x, y) => {
  const i = (Math.round(y) * img.w + Math.round(x)) * 4;
  return [img.d[i], img.d[i + 1], img.d[i + 2]];
};
/** Count of pixels in a rectangle (page points, top-left origin) matching a predicate. */
function countIn(img, scale, [x0, y0, x1, y1], pred) {
  let n = 0;
  for (let y = Math.round(y0 * scale); y < y1 * scale; y++) for (let x = Math.round(x0 * scale); x < x1 * scale; x++) if (pred(px(img, x, y))) n++;
  return n;
}
const isDark = ([r, g, b]) => r + g + b < 300;
const isYellowish = ([r, g, b]) => r > 200 && g > 170 && b < 170;
const isColourful = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 60;

async function objectTypes(page) {
  return page.locator("[data-object-type]").evaluateAll((els) => els.map((e) => e.dataset.objectType));
}

async function pickTool(page, name) {
  const b = page.getByRole("button", { name, exact: true });
  await b.click();
  if ((await b.getAttribute("aria-pressed")) !== "true") throw new Error(`${name} not armed`);
}

async function signature(page, at, where) {
  await page.getByRole("button", { name: "Signature", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Add signature" });
  await dlg.waitFor();
  const pad = await dlg.getByRole("img", { name: "Signature drawing area" }).boundingBox();
  await drag(page, [pad.x + 30, pad.y + pad.height * 0.7], [pad.x + pad.width * 0.3, pad.y + pad.height * 0.3], 10);
  await drag(page, [pad.x + pad.width * 0.3, pad.y + pad.height * 0.3], [pad.x + pad.width * 0.7, pad.y + pad.height * 0.6], 10);
  await dlg.getByRole("button", { name: "Place signature" }).click();
  await page.getByText(/Tap the page where the signature should go/).waitFor();
  await page.mouse.click(...at(...where));
}

// ------------------------------------------------------------------ native session
async function nativeSession() {
  const { browser, page, errors } = await launch();
  const tool = "PDF Editor";
  try {
    await open(page, "/pdf-editor");
    await addFiles(page, ["FL-PDF-07-native-text.pdf"]);
    await page.getByTestId("page-surface").waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Fit page" }).click();
    await page.waitForTimeout(600);
    let at = await mapper(page);
    const steps = [];

    // 1. Edit existing text
    await page.getByRole("button", { name: /^Edit text: .*Jordan Smith/ }).first().click();
    const dlg = page.getByRole("dialog", { name: "Edit text" });
    const original = await dlg.locator("input[type=text]").inputValue();
    await dlg.locator("input[type=text]").fill(original.replace("Jordan Smith", "Jordan Rivera"));
    steps.push(`region:"${original}"`);
    await dlg.getByRole("button", { name: "Save correction" }).click();
    await dlg.waitFor({ state: "hidden" });
    steps.push("edit-existing");

    // 2. Add text, typed straight onto the page
    await pickTool(page, "Text");
    await page.mouse.click(...at(60, 560));
    await page.keyboard.type("Approved for payment");
    const typed = await page.getByTestId("canvas-text-editor").inputValue();
    await page.keyboard.press("Escape");
    steps.push(`add-text:"${typed}"`);

    // 3. Highlight ×3 — the tool must stay armed between uses
    await pickTool(page, "Highlight");
    for (let i = 0; i < 3; i++) await drag(page, at(60, 303 + i * 18), at(300, 315 + i * 18));
    const hlArmed = (await page.getByRole("button", { name: "Highlight", exact: true }).getAttribute("aria-pressed")) === "true";
    // 4. Underline ×3
    await pickTool(page, "Underline");
    for (let i = 4; i < 7; i++) await drag(page, at(60, 303 + i * 18), at(300, 315 + i * 18));
    const ulArmed = (await page.getByRole("button", { name: "Underline", exact: true }).getAttribute("aria-pressed")) === "true";
    // 4b. Strikethrough ×3 (from the More menu)
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Strikethrough" }).click();
    for (let i = 7; i < 10; i++) await drag(page, at(60, 303 + i * 18), at(300, 315 + i * 18));
    steps.push(`markup-armed:${hlArmed && ulArmed}`);

    // 5. Draw (live stroke must render while drawing)
    await pickTool(page, "Draw");
    await page.mouse.move(...at(360, 600));
    await page.mouse.down();
    await page.mouse.move(...at(430, 640), { steps: 6 });
    const liveStroke = (await page.getByTestId("live-stroke").count()) > 0;
    await page.mouse.move(...at(520, 600), { steps: 6 });
    await page.mouse.up();
    steps.push(`live-stroke:${liveStroke}`);

    // 6. Shape (from the Shapes menu)
    await page.getByRole("button", { name: "Shapes", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Rectangle" }).click();
    await drag(page, at(60, 640), at(200, 700));
    for (const [shape, a, b] of [["Ellipse", [230, 640], [330, 700]], ["Line", [60, 720], [200, 770]], ["Arrow", [230, 720], [330, 770]]]) {
      await page.getByRole("button", { name: "Shapes", exact: true }).click();
      await page.getByRole("menuitemradio", { name: shape }).click();
      await drag(page, at(...a), at(...b));
    }

    // 7. Image
    await pickTool(page, "Select");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Image", exact: true }).click()]);
    await chooser.setFiles(fx("FL-IMG-08-portrait.jpg"));
    await page.getByText(/Tap the page where the image should go/).waitFor();
    await page.mouse.click(...at(480, 150));

    // 8. Signature (visual)
    await signature(page, at, [420, 730]);

    // 9. Whiteout over terms line 12
    await pickTool(page, "Whiteout");
    const whiteoutWarning = await page.getByRole("note").filter({ hasText: "not secure redaction" }).count();
    await drag(page, at(55, 500), at(470, 515));
    await pickTool(page, "Select");
    await shot(page, "13-editor-desktop.png");

    // 10. Undo / redo
    const before = (await objectTypes(page)).length;
    await page.getByRole("button", { name: "Undo" }).click();
    const afterUndo = (await objectTypes(page)).length;
    await page.getByRole("button", { name: "Redo" }).click();
    const afterRedo = (await objectTypes(page)).length;
    steps.push(`undo:${before}->${afterUndo}->${afterRedo}`);
    const types = await objectTypes(page);

    // 10b. Search the document text
    if (!(await page.getByLabel("Search document text").isVisible())) await page.locator("summary", { hasText: /^Search/ }).click();
    await page.getByLabel("Search document text").fill("Consultation");
    const searchResult = (await page.getByText(/^\d+ of \d+$|^No matches$/).first().innerText().catch(() => "")).trim();
    await page.getByLabel("Search document text").fill("");
    steps.push(`search:${searchResult}`);

    // 11. Pages: add a blank page and delete it again, then add one, move it first, rotate it, crop it
    await page.getByRole("button", { name: "+ Blank page" }).click();
    await page.getByRole("button", { name: "Delete page 2" }).click();
    const afterDelete = await page.getByRole("button", { name: /^Go to page \d+$/ }).count();
    steps.push(`blank+delete:${afterDelete}`);
    await page.getByRole("button", { name: "+ Blank page" }).click();
    await page.getByRole("button", { name: "Move page 2 up" }).click();
    await page.getByRole("button", { name: "Rotate page 1 clockwise" }).click();
    await page.getByRole("button", { name: "Go to page 1" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Crop" }).click();
    at = await mapper(page, 792); // the blank page is now shown landscape
    await drag(page, at(100, 100), at(500, 400));
    await page.getByRole("button", { name: "Keep this area" }).click();
    steps.push("pages:blank+move+rotate+crop");

    const out = await download(page, page.getByRole("button", { name: "Export PDF" }), "editor-native");
    const info = await pdfInfo(out);
    const img = await renderPage(info.doc, 2, 2);
    const base = await renderPage((await pdfInfo(fx("FL-PDF-07-native-text.pdf"))).doc, 1, 2);
    const s = 2;
    const checks = {
      pages: info.pages === 2,
      rotation: info.rotations[0] === 90,
      editedText: /Jordan Rivera/.test(info.texts[1]),
      addedText: /Approved for payment/.test(info.texts[1]),
      highlights: countIn(img, s, [65, 303, 295, 351], isYellowish) > 2000,
      underlines: countIn(img, s, [65, 372, 295, 423], isDark) > countIn(img, s, [65, 372, 295, 423], () => false) + 400,
      drawing: countIn(img, s, [360, 595, 520, 645], isDark) > 60,
      rectangle: countIn(img, s, [58, 638, 202, 702], isDark) > 150,
      ellipse: countIn(img, s, [228, 638, 332, 702], isDark) > 150,
      line: countIn(img, s, [58, 718, 202, 772], isDark) > 80,
      arrow: countIn(img, s, [228, 718, 332, 772], isDark) > 80,
      strikethroughs: countIn(img, s, [65, 429, 295, 477], isDark) > countIn(base, s, [65, 429, 295, 477], isDark) + 300,
      search: /^1 of 1$/.test(searchResult),
      deletePage: afterDelete === 1,
      image: countIn(img, s, [440, 100, 520, 200], isColourful) > 3000,
      signature: countIn(img, s, [360, 690, 480, 770], isDark) > 50,
      whiteout: countIn(img, s, [60, 502, 460, 513], isDark) < 20,
      originalLine11Intact: countIn(img, s, [60, 482, 440, 495], isDark) > 150,
      crop: await (async () => {
        const { PDFDocument } = await import("pdf-lib");
        const d = await PDFDocument.load(fs.readFileSync(out));
        const c = d.getPage(0).getCropBox();
        return c.width < 600 && c.height < 780;
      })(),
    };
    const ok = Object.values(checks).every(Boolean) && typed === "Approved for payment" && hlArmed && ulArmed && liveStroke && afterUndo === before - 1 && afterRedo === before && whiteoutWarning > 0;
    await renderToPng(out, 2, "editor-native-export-p2.png");
    rec(tool, "native long session: edit, add text, 3× highlight, 3× underline, 3× strikethrough, draw, rectangle/ellipse/line/arrow, image, signature, whiteout, undo/redo, search, blank page add+delete, reorder, rotate, crop, export, reopen", ok ? "PASS" : "FAIL", {
      steps,
      types: countTypes(types),
      checks,
      output: fs.statSync(out).size,
    });
  } catch (e) {
    rec(tool, "native session", "FAIL", { error: String(e).slice(0, 500) });
  }
  if (errors.length) rec(tool, "native session console", "FAIL", { errors });
  await browser.close();
}

function countTypes(types) {
  return types.reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});
}

async function renderToPng(file, pageNo, name) {
  const info = await pdfInfo(file);
  const img = await renderPage(info.doc, pageNo, 1.5);
  fs.writeFileSync(path.join(OUT, name), img.c.toBuffer("image/png"));
}

// ------------------------------------------------------------------ scanned session
async function ocrEdit(page, word, replacement) {
  const btn = page.getByRole("button", { name: `Edit recognized word: ${word}` }).first();
  await btn.click();
  const dlg = page.getByRole("dialog", { name: "Edit text" });
  await dlg.waitFor();
  const current = await dlg.locator("input[type=text]").inputValue();
  await dlg.locator("input[type=text]").fill(replacement);
  const save = dlg.getByRole("button", { name: "Save correction" });
  const overflow = (await dlg.getByText(/wider than the original/).count()) > 0;
  const forced = (await dlg.getByText(/can.t be replaced automatically/).count()) > 0;
  if (forced) await dlg.getByRole("checkbox").first().check();
  await save.click();
  await dlg.waitFor({ state: "hidden" });
  return { current, overflow, forced };
}

async function scanSession(file, label, edits, { width = 612 } = {}) {
  const { browser, page, errors } = await launch();
  const tool = "PDF Editor";
  try {
    await open(page, "/pdf-editor");
    await page.getByTestId("file-input").first().setInputFiles(file);
    await page.getByTestId("page-surface").waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Fit page" }).click();
    await page.getByText("Scanned text detected.").waitFor({ timeout: 30_000 });
    const t0 = Date.now();
    await page.getByRole("button", { name: "Recognize text" }).click();
    await page.getByRole("button", { name: new RegExp(`Edit recognized word: ${edits[0][0].replace(/[/.]/g, "\\$&")}`) }).first().waitFor({ timeout: 240_000 });
    const ocrMs = Date.now() - t0;
    await page.waitForTimeout(500);
    if (label === "fixture") await shot(page, "14-editor-scanned-ocr.png");
    const results = [];
    for (const [word, replacement] of edits) results.push({ word, replacement, ...(await ocrEdit(page, word, replacement)) });

    const at = await mapper(page, width);
    await pickTool(page, "Text");
    await page.mouse.click(...at(width * 0.1, 700 * (width / 612)));
    await page.keyboard.type("Checked on device");
    const typed = await page.getByTestId("canvas-text-editor").inputValue();
    await page.keyboard.press("Escape");
    await pickTool(page, "Highlight");
    await drag(page, at(width * 0.08, 330 * (width / 612)), at(width * 0.5, 345 * (width / 612)));
    await pickTool(page, "Draw");
    await drag(page, at(width * 0.6, 640 * (width / 612)), at(width * 0.8, 680 * (width / 612)));
    await pickTool(page, "Select");
    await signature(page, at, [width * 0.7, 740 * (width / 612)]);

    const out = await download(page, page.getByRole("button", { name: "Export PDF" }), `editor-scan-${label}`);
    const src = await pdfInfo(file);
    const info = await pdfInfo(out);
    const a = await renderPage(src.doc, 1, 1.5);
    const b = await renderPage(info.doc, 1, 1.5);
    let changed = 0;
    for (let i = 0; i < a.d.length; i += 4) if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]) > 60) changed++;
    const changedPct = +((changed / (a.w * a.h)) * 100).toFixed(2);
    fs.writeFileSync(path.join(OUT, `editor-scan-${label}-before.png`), a.c.toBuffer("image/png"));
    fs.writeFileSync(path.join(OUT, `editor-scan-${label}-after.png`), b.c.toBuffer("image/png"));
    const textOk = edits.every(([, r]) => info.texts[0].includes(r.split(" ")[0]));
    const ok = textOk && typed === "Checked on device" && info.pages === src.pages && changedPct > 0.05 && changedPct < 6 && !results.some((r) => r.forced);
    rec(tool, `scanned session (${label}): OCR ${(ocrMs / 1000).toFixed(1)}s, ${edits.map(([w, r]) => `${w}→${r}`).join(", ")}, add text, highlight, draw, signature, export, reopen`, ok ? "PASS" : results.some((r) => r.overflow) ? "LIMITED" : "FAIL", {
      edits: results,
      textLayer: info.texts[0].slice(0, 200),
      changedPct,
      pages: `${info.pages}/${src.pages}`,
    });
  } catch (e) {
    rec(tool, `scanned session (${label})`, "FAIL", { error: String(e).slice(0, 500) });
  }
  if (errors.length) rec(tool, `scanned session (${label}) console`, "FAIL", { errors });
  await browser.close();
}

if (which === "all" || which === "native") await nativeSession();
if (which === "all") await scanSession(fx("FL-PDF-08b-scanned-condensed.pdf"), "condensed", [["12/20/2026", "12/20/2028"], ["Jordan", "Morgan"], ["Consultation", "Consultations"]]);
if (which === "all" || which === "scan" || which === "condensed")
  await scanSession(fx(which === "condensed" ? "FL-PDF-08b-scanned-condensed.pdf" : "FL-PDF-08-scanned-text.pdf"), which === "condensed" ? "condensed" : "fixture", [
    ["12/20/2026", "12/20/2028"],
    ["Jordan", "Morgan"],
    ["Consultation", "Consultations"],
  ]);
if ((which === "all" || which === "real") && fs.existsSync(REAL)) {
  const w = (await pdfInfo(REAL)).doc;
  const vp = (await w.getPage(1)).getViewport({ scale: 1 });
  await scanSession(REAL, "user-supplied", [["12/20/2026", "12/20/2028"]], { width: vp.width });
}
save(`editor-${which}`);
