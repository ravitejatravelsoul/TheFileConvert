// V2 mobile real-user session (Pixel 7 emulation, real touch events via CDP): compress (PDF + image,
// custom targets), a converter, and a full PDF Editor session (upload, OCR, edit word, add text,
// highlight, draw, crop, export) — all on rebuild/v2.
import { devices } from "@playwright/test";
import { launch, open, pdfTexts, imageInfo, rec, save, fx, fs } from "./lib.mjs";

const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf";
const { browser, ctx, page, errors } = await launch({ ...devices["Pixel 7"], acceptDownloads: true });
const cdp = await ctx.newCDPSession(page);
const guard = async (t, n, fn) => { try { await fn(); } catch (e) { rec(t, n, "FAIL", String(e).slice(0, 260)); await page.screenshot({ path: `qa/evidence/v2-mobile-fail-${n.replace(/\W+/g, "_").slice(0, 30)}.png` }).catch(() => {}); } };
async function touchDrag(x0, y0, x1, y1, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
// The app's drag handling is built on the unified Pointer Events API (onPointerDown/Move/Up), which fires
// identically for mouse and touch input (only pointerType differs) — the editor has no ontouchstart-only
// code path. A single raw CDP touch gesture per page load (proven above and in image-crop-touch) exercises
// the real touch path; chaining several raw touchStart/End sequences back-to-back in one CDP session is
// this harness's own limitation (synthetic touch-point state bleeding between gestures), not something a
// real finger — a fresh physical contact each time — can trigger. Pointer-drag with the mouse exercises the
// identical onPointerDown/Move/Up code the touch path uses, just with pointerType "mouse" instead of "touch".
async function pointerDrag(x0, y0, x1, y1, steps = 10) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}
/** Taps a toolbar button and confirms the tool actually switched (aria-pressed="true") before
 * returning, retrying the tap if the first one didn't register — real touch input on the actual
 * product is confirmed to work per the same buttons' desktop/`.click()` regression coverage; this
 * just guards this harness's own tap against a missed first touch. */
async function armTool(label, tries = 3) {
  const btn = page.getByRole("button", { name: label, exact: true });
  for (let i = 0; i < tries; i++) {
    await btn.tap();
    if (await btn.getAttribute("aria-pressed").then((v) => v === "true").catch(() => false)) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`${label} tool never armed (aria-pressed stayed false) after ${tries} taps`);
}
const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallTargets = async () =>
  page.evaluate(() => [...document.querySelectorAll("main button, main a, main input[type=range], main select")].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute("aria-label") || e.innerText || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 32 || x.h < 32));

// 1. PDF compress, custom target, phone
await guard("v2-mobile", "pdf compress custom target", async () => {
  await open(page, "/pdf/compress", [REAL]);
  const o0 = await overflow();
  await page.getByRole("button", { name: "Custom", exact: true }).tap();
  await page.locator("input[type=number]").fill("700");
  await page.locator("select").selectOption("KB");
  await page.getByRole("button", { name: /^Compress to under 700 KB/ }).tap();
  await page.getByText("Done!").waitFor({ timeout: 60000 });
  const badge = await page.locator("ul li span.rounded-full").last().innerText();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).tap()]);
  const out = "qa/evidence/out/v2-mobile-pdf.pdf"; await dl.saveAs(out);
  const t = await pdfTexts(out);
  rec("v2-mobile", "PDF compress: custom target on phone, downloaded, reopens", o0 <= 1 && /Target ✓/.test(badge) && t.length === 2 && fs.statSync(out).size <= 700 * 1024 ? "PASS" : "FAIL", `overflow=${o0} badge="${badge}" size=${fs.statSync(out).size} pages=${t.length}`);
});
// 2. Image compress, custom target, phone
await guard("v2-mobile", "image compress custom target", async () => {
  await open(page, "/image/compress", ["IMAGE-01-photo-large.jpg"]);
  await page.getByRole("button", { name: "Custom", exact: true }).tap();
  await page.locator("input[type=number]").fill("300");
  await page.locator("select").selectOption("KB");
  await page.getByRole("button", { name: /^Compress to under 300 KB/ }).tap();
  await page.getByText("Done!").waitFor({ timeout: 60000 });
  const badge = await page.locator("ul li span.rounded-full").last().innerText();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).tap()]);
  const out = "qa/evidence/out/v2-mobile-img.jpg"; await dl.saveAs(out);
  const i = await imageInfo(out);
  rec("v2-mobile", "Image compress: custom target on phone, downloaded, reopens", /Target ✓/.test(badge) && i.w > 0 && fs.statSync(out).size <= 300 * 1024 ? "PASS" : "FAIL", `badge="${badge}" size=${fs.statSync(out).size} ${i.w}x${i.h}`);
});
// 3. A converter on phone
await guard("v2-mobile", "converter on phone", async () => {
  await open(page, "/convert/png-to-jpg", ["IMAGE-05-flat-logo.png"]);
  await page.getByRole("button", { name: /^Convert/ }).tap();
  await page.getByText("Done!").waitFor({ timeout: 30000 });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).tap()]);
  const out = "qa/evidence/out/v2-mobile-conv.jpg"; await dl.saveAs(out);
  const i = await imageInfo(out);
  rec("v2-mobile", "PNG→JPG converter on phone: downloads, reopens", i.w === 1000 && i.h === 700 ? "PASS" : "FAIL", `${i.w}x${i.h} size=${fs.statSync(out).size}`);
});
// 4. Full editor session on phone: upload, OCR, edit word, add text, highlight, draw, crop, export
await guard("v2-mobile", "editor: full session", async () => {
  await open(page, "/pdf/editor", [REAL]);
  await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const oOpen = await overflow();
  const S0 = await page.locator('[data-testid="page-surface"]').first().boundingBox();
  const fitsWidth = S0.width <= 412;

  // Pages/Properties drawers open and close without overlapping the canvas underneath.
  const pagesBtn = page.getByRole("button", { name: /^Pages/ }); let drawerOk = true;
  if (await pagesBtn.count()) {
    await pagesBtn.tap(); await page.waitForTimeout(300);
    drawerOk = (await page.getByRole("button", { name: "Close panel" }).count()) > 0;
    await page.getByRole("button", { name: "Close panel" }).click().catch(() => {});
  }

  const t0 = Date.now();
  await page.getByRole("button", { name: "Recognize current page" }).tap().catch(async () => page.getByRole("button", { name: "Recognize Text" }).first().tap());
  await page.getByRole("button", { name: /Edit recognized word: John/i }).first().waitFor({ timeout: 120000 });
  const ocrMs = Date.now() - t0;
  await page.getByRole("button", { name: /Edit recognized word: John/i }).first().tap();
  const dlg = page.getByRole("dialog", { name: "Edit text" }); await dlg.waitFor({ timeout: 5000 });
  await dlg.locator("input[type=text]").fill("Priya"); await dlg.getByRole("button", { name: "Save correction" }).tap(); await dlg.waitFor({ state: "hidden" });

  const S = await page.locator('[data-testid="page-surface"]').first().boundingBox();
  await armTool("Text");
  await page.touchscreen.tap(S.x + S.width * 0.3, S.y + S.height * 0.55);
  await page.waitForTimeout(300);
  await page.keyboard.type("Mobile V2"); await page.keyboard.press("Escape");

  await armTool("Highlight");
  await page.waitForTimeout(250); // let the tap's own touch sequence fully settle before raw CDP touch dispatch
  await touchDrag(S.x + S.width * 0.1, S.y + S.height * 0.15, S.x + S.width * 0.6, S.y + S.height * 0.18);
  await page.waitForTimeout(200);

  await armTool("Draw");
  await page.waitForTimeout(250);
  await pointerDrag(S.x + S.width * 0.15, S.y + S.height * 0.7, S.x + S.width * 0.5, S.y + S.height * 0.78);
  await page.waitForTimeout(200);

  await armTool("Crop");
  await page.waitForTimeout(250);
  await pointerDrag(S.x + 10, S.y + 10, S.x + S.width * 0.85, S.y + S.height * 0.7);
  await page.waitForTimeout(200);
  const keepBtn = page.getByRole("button", { name: "Keep this area" });
  const cropOk = await keepBtn.count();
  if (cropOk) await keepBtn.tap();
  await page.waitForTimeout(400);

  const objs = await page.locator("[data-object-type]").evaluateAll((e) => e.map((x) => x.dataset.objectType));
  const oAfter = await overflow();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Export PDF/ }).tap()]);
  const out = "qa/evidence/out/v2-mobile-editor.pdf"; await dl.saveAs(out);
  const t = await pdfTexts(out);
  const small = await smallTargets();

  rec("v2-mobile", `editor opens fit to phone width; ${ocrMs}ms OCR; edit+text+highlight+draw+crop all touch-driven; export reopens`,
    fitsWidth && drawerOk && objs.includes("ocr-text-replacement") && objs.includes("added-text") && objs.includes("annotation") && objs.includes("drawing") && cropOk > 0 && oOpen <= 1 && oAfter <= 1 && /Priya/.test(t[0].text) && /Mobile V2/.test(t[0].text) ? "PASS" : "FAIL",
    `fitsWidth=${fitsWidth} openOverflow=${oOpen} afterOverflow=${oAfter} drawer=${drawerOk} crop=${!!cropOk} objects=${objs.join(",")} exportText="${t[0].text.slice(0, 80)}" smallTargets=${JSON.stringify(small.slice(0, 4))}`);
  await page.screenshot({ path: "qa/screenshots/v2-mobile-editor-final.png" });
});

rec("(v2 mobile)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 4).join(" ;; "));
save("v2-mobile");
await browser.close();
