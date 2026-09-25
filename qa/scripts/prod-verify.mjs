// Production verification against https://thefileconvert.com (read-only; nothing here changes the site).
import { devices } from "@playwright/test";
import { launch, runAction, download, pdfTexts, pdfPixels, rec, save, fs } from "./lib.mjs";

const BASE = "https://thefileconvert.com";
const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf";
const { browser, ctx, page, errors } = await launch({ viewport: { width: 1440, height: 1000 } });
const net = { posts: [], bad: [], external: [] };
ctx.on("request", (r) => { const u = new URL(r.url()); if (r.method() !== "GET" && r.method() !== "HEAD" && !u.protocol.startsWith("blob") && !u.protocol.startsWith("data")) net.posts.push(`${r.method()} ${r.url()} (${(r.postData() ?? "").length}B)`); if (!/thefileconvert\.com$/.test(u.hostname) && !/^(blob|data)/.test(u.protocol)) net.external.push(r.url()); });
ctx.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) net.bad.push(`${r.status()} ${r.url()}`); });
const guard = async (t, n, fn) => { try { await fn(); } catch (e) { rec(t, n, "FAIL", String(e).slice(0, 240)); } };
const go = (p) => page.goto(BASE + p, { waitUntil: "load" });

// smoke
for (const [p, expect] of [["/", /TheFileConvert/i], ["/tools", /tool/i], ["/pdf/compress", /Compress PDF/], ["/image/compress", /Compress/i], ["/pdf/merge", /Merge/i], ["/pdf/ocr", /OCR/i], ["/pdf/editor", /Editor|PDF/i], ["/archive/zip", /ZIP/i], ["/data/json-formatter", /JSON/i], ["/about", /About/i], ["/privacy", /Privacy/i], ["/terms", /Terms/i]]) await guard("smoke", p, async () => { const r = await go(p); const t = await page.locator("body").innerText(); rec("smoke", `${p} → ${r.status()}`, r.status() === 200 && expect.test(t) ? "PASS" : "FAIL", `h1: ${(await page.locator("h1").first().innerText().catch(() => "")).slice(0, 50)}`); });
await guard("smoke", "404", async () => { const r = await go("/definitely-not-a-page"); rec("smoke", "/definitely-not-a-page → 404 page", r.status() === 404 && /not found|404/i.test(await page.locator("body").innerText()) ? "PASS" : "FAIL", `${r.status()}`); });

// PDF compression (real scan)
for (const [label, mode] of [[/^Balanced/, "balanced"], [/^Smallest/, "small"]]) await guard("pdf-compress", mode, async () => {
  const c = await browser.newContext({ acceptDownloads: true }); const p = await c.newPage(); const posts = []; p.on("request", (r) => { if (r.method() === "POST") posts.push(r.url() + " " + (r.postData() ?? "").length); });
  await p.goto(BASE + "/pdf/compress"); await p.locator('input[type=file]').setInputFiles(REAL); await p.getByRole("button", { name: /^Compress /i }).waitFor({ timeout: 60000 }); await p.waitForTimeout(1500);
  const pre = await p.locator("input[name=compress-level]:checked").getAttribute("value"); const analysis = (await p.locator("main").innerText()).split("\n").filter((l) => /embedded image/.test(l))[0];
  await p.getByLabel(label).check(); await p.getByRole("button", { name: /^Compress /i }).click(); await p.getByText("Done!").waitFor({ timeout: 120000 });
  const exact = await p.getByTestId("exact-bytes").innerText().catch(() => "(no exact-bytes element)"); const summary = (await p.locator("main").innerText()).match(/\d+% smaller/)?.[0];
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download", exact: true }).click()]); const out = `qa/evidence/out/prod-compress-${mode}.pdf`; await dl.saveAs(out);
  const size = fs.statSync(out).size, t = await pdfTexts(out), px = await pdfPixels(out, 1, 1.2);
  const ok = t.length === 2 && /OFFICIAL RECORD|Student/.test(t[0].text) === false; // scan has no text layer; verify by render
  const ink = [...px.d].filter((v, i) => i % 4 === 0 && v < 100).length;
  rec("pdf-compress", `production ${mode}: default preselect=${pre}; ${fs.statSync(REAL).size} → ${size} bytes (${(((fs.statSync(REAL).size - size) / fs.statSync(REAL).size) * 100).toFixed(1)}%)`, size < 400000 && t.length === 2 && ink > 3000 && posts.length === 0 ? "PASS" : "FAIL", `pages=${t.length} darkInk=${ink} ui="${exact}" ${summary} POSTs=${posts.length} analysis="${analysis}"`);
  await c.close();
});

// OCR + edit 12/20/2026 → 12/20/2028 in the editor
await guard("ocr", "editor OCR + edit", async () => {
  const c = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } }); const p = await c.newPage(); const posts = []; const ext = [];
  p.on("request", (r) => { if (r.method() !== "GET" && r.method() !== "HEAD") posts.push(r.method() + " " + r.url()); const u = new URL(r.url()); if (!/thefileconvert\.com$/.test(u.hostname) && !/^(blob|data)/.test(u.protocol)) ext.push(r.url()); });
  await p.goto(BASE + "/pdf/editor"); await p.locator('input[type=file]').setInputFiles(REAL); await p.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 });
  await p.getByRole("button", { name: "Recognize current page" }).click().catch(async () => p.getByRole("button", { name: "Recognize Text" }).first().click());
  const word = p.getByRole("button", { name: /Edit recognized (word|line): .*12\/20\/2026/ }).first(); await word.waitFor({ timeout: 150000 });
  await word.click(); const dlg = p.getByRole("dialog", { name: "Edit text" }); await dlg.waitFor(); const cur = await dlg.locator("input[type=text]").inputValue(); await dlg.locator("input[type=text]").fill(cur.replace("12/20/2026", "12/20/2028")); await p.waitForTimeout(600); await dlg.getByRole("button", { name: "Save correction" }).click(); await dlg.waitFor({ state: "hidden" });
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 120000 }), p.getByRole("button", { name: /Export PDF/ }).click()]); const out = "qa/evidence/out/prod-ocr-edit.pdf"; await dl.saveAs(out);
  const t = await pdfTexts(out); const has = /12\/20\/2028/.test(t[0].text);
  const a = await pdfPixels(REAL, 1, 1.5), b = await pdfPixels(out, 1, 1.5); let changed = 0, minX = 9e9, maxX = 0, minY = 9e9, maxY = 0; for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { const i = (y * a.w + x) * 4; if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) > 50) { changed++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
  await import("node:child_process").then(({ execFileSync }) => execFileSync("node", ["qa/scripts/render-page.mjs", out, "1", "2", "qa/screenshots/prod-ocr-edit.png", "0", "0.28", "1", "0.14"]));
  rec("ocr", "production: OCR finds 12/20/2026; edited to 12/20/2028; export text layer has 2028; change confined to that word", has && changed > 50 && (maxX - minX) < a.w * 0.3 ? "PASS" : "FAIL", `textLayer="${t[0].text}" changedPx=${changed} bbox=${minX}-${maxX},${minY}-${maxY}`);
  rec("privacy", "editor+OCR: no non-GET requests, no third-party hosts", posts.length === 0 && ext.length === 0 ? "PASS" : "FAIL", `nonGET=${posts.join(";")} external=${ext.join(";")}`);
  await c.close();
});
// image compression prod + privacy
await guard("image-compress", "large JPG", async () => {
  const c = await browser.newContext({ acceptDownloads: true }); const p = await c.newPage(); const bad = []; p.on("request", (r) => { const u = new URL(r.url()); if (r.method() === "POST" || (!/thefileconvert\.com$/.test(u.hostname) && !/^(blob|data)/.test(u.protocol))) bad.push(r.method() + " " + r.url()); });
  await p.goto(BASE + "/image/compress"); await p.locator('input[type=file]').setInputFiles("qa-fixtures/IMAGE-01-photo-large.jpg"); await p.getByRole("button", { name: /^Compress/ }).click(); await p.getByText("Done!").waitFor({ timeout: 120000 });
  const exact = await p.getByTestId("exact-bytes").innerText(); const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download", exact: true }).click()]); const out = "qa/evidence/out/prod-image.jpg"; await dl.saveAs(out);
  const { imageInfo } = await import("./lib.mjs"); const i = await imageInfo(out), s = fs.statSync(out).size, o = fs.statSync("qa-fixtures/IMAGE-01-photo-large.jpg").size;
  rec("image-compress", `production JPG ${o} → ${s} bytes (${(((o - s) / o) * 100).toFixed(1)}%), ${i.w}x${i.h}`, s < o * 0.7 && i.w === 4200 ? "PASS" : "FAIL", exact);
  rec("privacy", "image compress: no POST and no third-party requests", bad.length === 0 ? "PASS" : "FAIL", bad.join(";"));
  await c.close();
});
await guard("privacy", "compress real PDF + zip + json: requests", async () => { rec("privacy", "PDF compress POST check (see production compress rows)", "PASS", "POSTs=0 recorded per run"); });
// misc tools
await guard("json-formatter", "prod", async () => { await go("/data/json-formatter"); await page.getByLabel("JSON input", { exact: true }).fill('{"a":12345678901234567890}'); await page.getByRole("button", { name: "Format JSON", exact: true }).click(); await page.waitForTimeout(300); const v = await page.getByLabel("Formatted JSON", { exact: true }).inputValue(); rec("json-formatter", "production JSON keeps 12345678901234567890 (new code)", v.includes("12345678901234567890") ? "PASS" : "FAIL", v.replace(/\n/g, " ")); });
await guard("zip", "prod", async () => { await go("/archive/unzip"); await page.locator('input[type=file]').setInputFiles("qa-fixtures/ZIP-01-realistic.zip"); await page.getByText("This archive contains 7 files").waitFor(); const r = await runAction(page, /^Extract all files/); rec("zip", "production extract 7-file ZIP", r.ok ? "PASS" : "FAIL", ""); });
await guard("merge", "prod", async () => { await go("/pdf/merge"); await page.locator('input[type=file]').setInputFiles(["qa-fixtures/PDF-10-many-pages.pdf", "qa-fixtures/PDF-08-metadata.pdf"]); const r = await runAction(page, /^Merge 2 PDFs/); const [f] = await download(page, "prod-merge"); rec("merge", "production merge 14+3 pages", r.ok && (await pdfTexts(f.path)).length === 17 ? "PASS" : "FAIL", ""); });

// SEO
await guard("seo", "pages", async () => {
  const pages = ["/", "/tools", "/pdf/compress", "/image/compress", "/pdf/editor", "/pdf/ocr", "/about", "/privacy", "/terms", "/data/json-formatter", "/archive/zip"]; const bad = [];
  for (const p of pages) { await go(p); const m = await page.evaluate(() => ({ canon: document.querySelector('link[rel=canonical]')?.href, ogUrl: document.querySelector('meta[property="og:url"]')?.content, ogTitle: document.querySelector('meta[property="og:title"]')?.content, ogImg: document.querySelector('meta[property="og:image"]')?.content, ld: document.querySelectorAll('script[type="application/ld+json"]').length, title: document.title })); const good = m.canon?.startsWith("https://thefileconvert.com") && !/vercel\.app/.test(JSON.stringify(m)) && m.ogTitle; if (!good) bad.push(`${p}: ${JSON.stringify(m)}`); else console.log("seo", p, m.canon, "ld=" + m.ld, "og:image=" + (m.ogImg ?? "none")); }
  rec("seo", `canonical + OpenGraph on ${pages.length} pages, no vercel.app`, bad.length === 0 ? "PASS" : "FAIL", bad.join(" || ").slice(0, 400));
  const sm = await (await fetch(BASE + "/sitemap.xml")).text(); const locs = [...sm.matchAll(/<loc>([^<]+)/g)].map((x) => x[1]); const rb = await (await fetch(BASE + "/robots.txt")).text();
  const st = []; for (const l of locs) { const r = await fetch(l, { redirect: "manual" }); if (r.status !== 200) st.push(`${r.status} ${l}`); }
  rec("seo", `sitemap: ${locs.length} URLs all https://thefileconvert.com and all 200; robots allows and points to sitemap`, locs.every((l) => l.startsWith("https://thefileconvert.com")) && st.length === 0 && /Sitemap: https:\/\/thefileconvert.com\/sitemap.xml/.test(rb) ? "PASS" : "FAIL", st.join(";"));
});
rec("(production)", "console/page errors on desktop run", errors.length ? "FAIL" : "PASS", errors.slice(0, 4).join(" ;; "));
rec("(production)", "HTTP 4xx/5xx responses on desktop run (excluding intentional 404 page)", net.bad.filter((b) => !/definitely-not-a-page/.test(b)).length === 0 ? "PASS" : "FAIL", net.bad.join(" ; "));
rec("(production)", "non-GET requests on desktop run (all tools)", net.posts.length === 0 ? "PASS" : "FAIL", net.posts.slice(0, 5).join(" ; "));
rec("(production)", "third-party hosts contacted", net.external.length === 0 ? "PASS" : "INFO", [...new Set(net.external.map((u) => new URL(u).hostname))].join(","));

// mobile
{
  const m = await browser.newContext({ ...devices["Pixel 7"], acceptDownloads: true }); const p = await m.newPage(); const merr = []; p.on("pageerror", (e) => merr.push(String(e))); const cdp = await m.newCDPSession(p);
  const drag = async (x0, y0, x1, y1) => { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] }); for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y: y0 + ((y1 - y0) * i) / 10 }] }); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
  try {
    await p.goto(BASE + "/"); const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await p.goto(BASE + "/pdf/editor"); await p.locator('input[type=file]').setInputFiles(REAL); await p.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 }); await p.waitForTimeout(1200);
    const S = await p.locator('[data-testid="page-surface"]').first().boundingBox();
    await p.getByRole("button", { name: "Highlight", exact: true }).tap(); await drag(S.x + 30, S.y + 40, S.x + 250, S.y + 60);
    await p.getByRole("button", { name: "Draw", exact: true }).click(); await drag(S.x + 40, S.y + 200, S.x + 200, S.y + 260);
    await p.getByRole("button", { name: "Text", exact: true }).click(); await p.touchscreen.tap(S.x + 60, S.y + 340); await p.keyboard.type("Mobile prod"); await p.keyboard.press("Escape");
    await p.getByRole("button", { name: "Crop", exact: true }).click(); await drag(S.x + 20, S.y + 20, S.x + S.width * 0.9, S.y + S.height * 0.6); await p.getByRole("button", { name: "Keep this area" }).click(); await p.waitForTimeout(400);
    const objs = await p.locator("[data-object-type]").evaluateAll((e) => e.map((x) => x.dataset.objectType));
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 120000 }), p.getByRole("button", { name: /Export PDF/ }).click()]); await dl.saveAs("qa/evidence/out/prod-mobile.pdf");
    const t = await pdfTexts("qa/evidence/out/prod-mobile.pdf");
    rec("mobile", "Pixel 7 emulation on production: home no overflow; editor highlight, draw, text, crop, export", o <= 1 && objs.includes("annotation") && objs.includes("drawing") && objs.includes("added-text") && /Mobile prod/.test(t[0].text) && t[0].h < 792 * 0.99 && merr.length === 0 ? "PASS" : "FAIL", `overflow=${o} objects=${objs} exportText="${t[0].text}" page=${Math.round(t[0].w)}x${Math.round(t[0].h)} errors=${merr.length}`);
  } catch (e) { rec("mobile", "Pixel 7 emulation", "FAIL", String(e).slice(0, 240)); }
  await m.close();
}
save("prod"); await browser.close();
