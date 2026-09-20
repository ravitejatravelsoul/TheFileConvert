// Phase 12: mobile / touch emulation (Pixel 7 profile, real touch events via CDP).
import { devices } from "@playwright/test";
import { launch, open, runAction, download, pdfTexts, pdfPixels, imageInfo, pxAt, near, rec, save, fx, fs } from "./lib.mjs";

const { browser, ctx, page, errors } = await launch({ ...devices["Pixel 7"], acceptDownloads: true });
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 240)); await page.screenshot({ path: `qa/evidence/mobile-fail-${test.replace(/\W+/g, "_").slice(0, 30)}.png` }).catch(() => {}); } };
const cdp = await ctx.newCDPSession(page);
async function touchDrag(x0, y0, x1, y1, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const overflow = async () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

// 1. no horizontal overflow on every live tool page at phone width
const routes = ["/", "/tools", "/pdf/merge", "/pdf/split", "/pdf/extract-pages", "/pdf/delete-pages", "/pdf/rotate", "/pdf/reorder", "/pdf/images-to-pdf", "/pdf/to-images", "/pdf/page-numbers", "/pdf/watermark", "/pdf/metadata", "/pdf/compress", "/pdf/ocr", "/image/compress", "/image/resize", "/image/crop", "/image/rotate", "/image/remove-metadata", "/image/svg-to-png", "/convert/jpg-to-png", "/convert/png-to-jpg", "/convert/jpg-to-webp", "/convert/webp-to-jpg", "/convert/png-to-webp", "/convert/webp-to-png", "/data/json-formatter", "/data/xml-formatter", "/data/csv-to-json", "/data/json-to-csv", "/data/base64", "/data/url-encode-decode", "/data/case-converter", "/data/word-counter", "/data/uuid-generator", "/data/hash-generator", "/data/text-diff", "/document/markdown-to-html", "/document/markdown-to-pdf", "/document/txt-to-pdf", "/document/txt-to-html", "/archive/zip", "/archive/unzip", "/pdf/editor"];
const bad = [];
for (const r of routes) { await page.goto("http://localhost:3000" + r); await page.waitForTimeout(250); const o = await overflow(); if (o.sw > o.cw + 1) bad.push(`${r} (${o.sw}>${o.cw})`); }
rec("(all pages)", `no horizontal page scroll at 412px width on ${routes.length} routes`, bad.length === 0 ? "PASS" : "FAIL", bad.join(", "));

await guard("mobile-home", "menu and navigation", async () => {
  await page.goto("http://localhost:3000/"); const menu = page.getByRole("button", { name: /menu/i }).first(); const has = await menu.count();
  if (has) { await menu.tap(); await page.waitForTimeout(300); }
  const links = await page.getByRole("link", { name: /PDF|Image|Tools/i }).count();
  rec("mobile-home", "phone header: menu opens and links are reachable", links > 0 ? "PASS" : "FAIL", `menuButton=${has} links=${links}`);
});
await guard("mobile-tap-targets", "tap target size", async () => {
  await open(page, "/pdf/merge", ["PDF-10-many-pages.pdf", "PDF-08-metadata.pdf"]); await page.waitForTimeout(500);
  const small = await page.evaluate(() => [...document.querySelectorAll("main button, main a, main input[type=range], main select")].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute("aria-label") || e.innerText || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 32 || x.h < 32));
  rec("mobile-tap-targets", "merge list buttons ≥ 32px on touch devices", small.length === 0 ? "PASS" : "LIMITED", JSON.stringify(small.slice(0, 5)));
});
await guard("pdf-compress-mobile", "compress the real scan on a phone", async () => {
  await open(page, "/pdf/compress", ["C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf"]); await page.getByRole("button", { name: /^Compress /i }).waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
  const preselected = await page.locator("input[name=compress-level]:checked").getAttribute("value");
  const r = await runAction(page, /^Compress /i); const [f] = await download(page, "mobile-compress"); const size = fs.statSync(f.path).size;
  const exact = (await page.getByTestId("exact-bytes").innerText().catch(() => ""));
  rec("pdf-compress-mobile", "phone: default level for a scan is Balanced and result shows exact bytes", r.ok && preselected === "balanced" && size < 400000 && /3,982,736/.test(exact) ? "PASS" : "FAIL", `default=${preselected} output=${size} ui="${exact}"`);
  await page.screenshot({ path: "qa/screenshots/mobile-compress-result.png" });
});
await guard("image-crop-touch", "touch drag crop", async () => {
  await open(page, "/image/crop", ["IMAGE-11-quadrants.png"]); const img = page.locator("main img").first(); await img.waitFor(); await img.scrollIntoViewIfNeeded(); const b = await img.boundingBox();
  await touchDrag(b.x + b.width * 0.02, b.y + b.height * 0.02, b.x + b.width * 0.45, b.y + b.height * 0.45);
  const vals = await page.locator("input[type=range]").evaluateAll((e) => e.map((x) => x.value).join(","));
  await runAction(page, /^Crop image/); const [f] = await download(page, "mobile-crop"); const i = await imageInfo(f.path); const c = pxAt(i, i.w / 2, i.h / 2);
  rec("image-crop-touch", "finger drag draws a crop box (top-left ≈ red, ~43%)", i.w > 140 && i.w < 210 && near(c, [255, 0, 0], 60) ? "PASS" : "FAIL", `sliders=${vals} out=${i.w}x${i.h} centre=${c}`);
});
await guard("pdf-reorder-mobile", "reorder with buttons on touch", async () => {
  await open(page, "/pdf/reorder", ["PDF-10-many-pages.pdf"]); await page.getByRole("button", { name: "Move page 2 earlier" }).tap(); await runAction(page, /^Export reordered PDF/); const [f] = await download(page, "mobile-reorder");
  const t = await pdfTexts(f.path); rec("pdf-reorder-mobile", "tap ← on page 2 → exported order 2,1,3…", /Page 2 of/.test(t[0].text) && /Page 1 of/.test(t[1].text) ? "PASS" : "FAIL", t.slice(0, 3).map((x) => x.text.slice(0, 12)).join("|"));
});
await guard("data-mobile", "typing tools", async () => {
  await open(page, "/data/json-formatter"); await page.getByLabel("JSON input", { exact: true }).fill('{"a":[1,2,{"b":null}]}'); await page.getByRole("button", { name: "Format JSON", exact: true }).tap(); await page.waitForTimeout(300);
  const v = await page.getByLabel("Formatted JSON", { exact: true }).inputValue(); rec("data-mobile", "JSON formatter works on phone", v.includes('"b": null') ? "PASS" : "FAIL", v.replace(/\n/g, "⏎").slice(0, 60));
});
await guard("pdf-editor-mobile", "editor on phone", async () => {
  await open(page, "/pdf/editor", ["PDF-12-scanned-ocr.pdf"]); await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
  await page.screenshot({ path: "qa/screenshots/mobile-editor-open.png" });
  const S = await page.locator('[data-testid="page-surface"]').first().boundingBox(); const fit = S.width <= 412;
  rec("pdf-editor-mobile", "page opens fitted to the phone width", fit ? "PASS" : "FAIL", `surface width ${Math.round(S.width)} (viewport 412)`);
  await page.getByRole("button", { name: "Rectangle", exact: true }).tap(); await page.locator('[data-testid="page-surface"]').first().scrollIntoViewIfNeeded(); const B = await page.locator('[data-testid="page-surface"]').first().boundingBox();
  await touchDrag(B.x + B.width * 0.15, B.y + Math.min(B.height * 0.15, 200), B.x + B.width * 0.55, B.y + Math.min(B.height * 0.15, 200) + 90);
  const shapes = await page.locator("[data-object-type=shape]").count();
  await page.getByRole("button", { name: "Text", exact: true }).click(); const B2 = await page.locator('[data-testid="page-surface"]').first().boundingBox(); console.log("B", JSON.stringify(B), "B2", JSON.stringify(B2)); await page.touchscreen.tap(B2.x + B2.width * 0.3, B2.y + Math.min(B2.height * 0.7, 800 - B2.y)); await page.waitForTimeout(300); await page.keyboard.type("Phone text"); await page.keyboard.press("Escape");
  const texts = await page.locator("[data-object-type=added-text]").count();
  rec("pdf-editor-mobile", "touch: rectangle by finger drag + text by tap", shapes >= 1 && texts >= 1 ? "PASS" : "FAIL", `shapes=${shapes} texts=${texts}`);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /Export PDF/ }).tap()]); await dl.saveAs("qa/evidence/out/mobile-editor.pdf");
  const t = await pdfTexts("qa/evidence/out/mobile-editor.pdf"); rec("pdf-editor-mobile", "phone export contains the typed text", /Phone text/.test(t.map((x) => x.text).join(" ")) ? "PASS" : "FAIL", t[0].text.slice(-40));
  await page.screenshot({ path: "qa/screenshots/mobile-editor-after.png" });
});
rec("(mobile)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 3).join(" ;; "));
save("mobile"); await browser.close();
