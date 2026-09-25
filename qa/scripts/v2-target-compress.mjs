// V2 acceptance: target-size PDF and image compression through the real browser UI.
import { launch, open, pdfTexts, pdfPixels, imageInfo, rec, save, fx, fs } from "./lib.mjs";

const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf";
const { browser, page, errors } = await launch({ acceptDownloads: true });
const guard = async (tool, test, fn) => { try { await fn(); } catch (e) { rec(tool, test, "FAIL", String(e).slice(0, 260)); } };

async function pdfTargetRun(file, presetLabel, timeout = 180000) {
  await open(page, "/pdf/compress", [file]);
  await page.getByRole("button", { name: presetLabel, exact: true }).click();
  const btn = page.getByRole("button", { name: /^Compress to under/ });
  const label = await btn.innerText();
  const t0 = Date.now();
  await btn.click();
  await Promise.race([page.getByText("Done!").waitFor({ timeout }), page.getByRole("button", { name: "Try again" }).waitFor({ timeout })]);
  const ms = Date.now() - t0;
  const ok = (await page.getByText("Done!").count()) > 0;
  if (!ok) return { ok: false, ms, error: await page.locator("main [role=alert]").first().innerText().catch(() => "") };
  const badge = (await page.locator("ul li span.rounded-full").last().innerText().catch(() => ""));
  const note = (await page.locator("main").innerText()).split("\n").find((l) => /Reached your target|Couldn.t reach/.test(l)) ?? "";
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const out = `qa/evidence/out/v2-pdf-${Date.now()}.pdf`;
  await dl.saveAs(out);
  return { ok: true, ms, label, badge, note, out, size: fs.statSync(out).size };
}

// ---- PDF target-size acceptance matrix ----
const pdfMatrix = [
  ["PDF-01-text-heavy.pdf", "Under 500 KB"],
  ["PDF-03-large-scan.pdf", "Under 5 MB"],
  ["PDF-03-large-scan.pdf", "Under 2 MB"],
  ["PDF-03-large-scan.pdf", "Under 1 MB"],
  ["PDF-12-scanned-ocr.pdf", "Under 500 KB"],
];
for (const [file, preset] of pdfMatrix) await guard("pdf-compress-v2", `${file} → ${preset}`, async () => {
  const input = fs.statSync(fx(file)).size;
  const r = await pdfTargetRun(file, preset);
  if (!r.ok) { rec("pdf-compress-v2", `${file} → ${preset}`, "FAIL", r.error); return; }
  const t = await pdfTexts(r.out);
  const px = await pdfPixels(r.out, 1, 1);
  const ink = [...px.d].filter((v, i) => i % 4 === 0 && v < 150).length;
  const targetBytes = { "Under 500 KB": 500 * 1024, "Under 1 MB": 1024 * 1024, "Under 2 MB": 2 * 1024 * 1024, "Under 5 MB": 5 * 1024 * 1024 }[preset];
  const achieved = r.size <= targetBytes;
  const badgeSaysAchieved = /Target ✓/.test(r.badge);
  rec("pdf-compress-v2", `${file} (${input}B) → ${preset} in ${(r.ms / 1000).toFixed(1)}s`, badgeSaysAchieved === achieved && t.length > 0 && ink > 200 ? "PASS" : "FAIL", `output=${r.size}B badge="${r.badge}" note="${r.note}" pages=${t.length} ink=${ink}`);
});
await guard("pdf-compress-v2", "custom tiny target on a large scan", async () => {
  await open(page, "/pdf/compress", ["PDF-03-large-scan.pdf"]);
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.locator("input[type=number]").fill("50");
  await page.locator("select").selectOption("KB");
  const btn = page.getByRole("button", { name: /^Compress to under 50 KB/ });
  await btn.click();
  await page.getByText("Done!").waitFor({ timeout: 180000 });
  const badge = await page.locator("ul li span.rounded-full").last().innerText();
  const note = (await page.locator("main").innerText()).split("\n").find((l) => /Couldn.t reach|Reached your target/.test(l)) ?? "";
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const out = "qa/evidence/out/v2-pdf-impossible.pdf";
  await dl.saveAs(out);
  const t = await pdfTexts(out);
  rec("pdf-compress-v2", "50 KB target on a heavy scan is honestly reported as closest-safe, file still opens with all pages", /Closest safe result/.test(badge) && /Couldn.t reach/.test(note) && t.length === 4 ? "PASS" : "FAIL", `badge="${badge}" note="${note}" size=${fs.statSync(out).size} pages=${t.length}`);
});
await guard("pdf-compress-v2", "user's real scan, Under 1 MB", async () => {
  const input = fs.statSync(REAL).size;
  const r = await pdfTargetRun(REAL, "Under 1 MB");
  const t = await pdfTexts(r.out);
  rec("pdf-compress-v2", `real scan ${input}B → Under 1 MB in ${(r.ms / 1000).toFixed(1)}s`, r.ok && r.size <= 1024 * 1024 && t.length === 2 ? "PASS" : "FAIL", `output=${r.size}B badge="${r.badge}" note="${r.note}"`);
});
await guard("pdf-compress-v2", "already-small PDF stays honest (no fake compression)", async () => {
  const r = await pdfTargetRun("PDF-06-optimized.pdf", "Under 5 MB");
  rec("pdf-compress-v2", "PDF-06 already under target: badge still says Target ✓ (trivially true), no inflated claim", /Target ✓/.test(r.badge) ? "PASS" : "FAIL", `badge="${r.badge}" note="${r.note}"`);
});

// ---- Image target-size acceptance matrix ----
async function imgTargetRun(file, presetLabel) {
  await open(page, "/image/compress", [file]);
  await page.getByRole("button", { name: presetLabel, exact: true }).click();
  const btn = page.getByRole("button", { name: /^Compress to under/ });
  const t0 = Date.now();
  await btn.click();
  await Promise.race([page.getByText("Done!").waitFor({ timeout: 180000 }), page.getByRole("button", { name: "Try again" }).waitFor({ timeout: 180000 })]);
  const ms = Date.now() - t0;
  if (!(await page.getByText("Done!").count())) return { ok: false, error: await page.locator("main [role=alert]").first().innerText().catch(() => "") };
  const badge = await page.locator("ul li span.rounded-full").last().innerText().catch(() => "");
  const note = (await page.locator("main").innerText()).split("\n").find((l) => /Reached your target|Couldn.t reach/.test(l)) ?? "";
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const out = `qa/evidence/out/v2-img-${Date.now()}.jpg`;
  await dl.saveAs(out);
  return { ok: true, ms, badge, note, out, size: fs.statSync(out).size };
}
const imgMatrix = [
  ["IMAGE-01-photo-large.jpg", "Under 1 MB"],
  ["IMAGE-01-photo-large.jpg", "Under 500 KB"],
  ["IMAGE-01-photo-large.jpg", "Under 250 KB"],
  ["IMAGE-01-photo-large.jpg", "Under 100 KB"],
  ["IMAGE-02-photo-huge.jpg", "Under 1 MB"],
  ["IMAGE-04-transparent.png", "Under 500 KB"],
];
for (const [file, preset] of imgMatrix) await guard("image-compress-v2", `${file} → ${preset}`, async () => {
  const input = fs.statSync(fx(file)).size;
  const r = await imgTargetRun(file, preset);
  if (!r.ok) { rec("image-compress-v2", `${file} → ${preset}`, "FAIL", r.error); return; }
  const targetBytes = { "Under 100 KB": 100 * 1024, "Under 250 KB": 250 * 1024, "Under 500 KB": 500 * 1024, "Under 1 MB": 1024 * 1024 }[preset];
  const i = await imageInfo(r.out);
  const achieved = r.size <= targetBytes;
  const badgeSaysAchieved = /Target ✓/.test(r.badge);
  rec("image-compress-v2", `${file} (${input}B) → ${preset} in ${(r.ms / 1000).toFixed(1)}s`, badgeSaysAchieved === achieved && i.w > 0 ? "PASS" : "FAIL", `output=${r.size}B ${i.w}x${i.h} badge="${r.badge}" note="${r.note}"`);
});
await guard("image-compress-v2", "transparent PNG keeps alpha after target compression", async () => {
  const r = await imgTargetRun("IMAGE-04-transparent.png", "Under 100 KB");
  const i = await imageInfo(r.out);
  const corner = [i.d[3]]; // top-left alpha
  rec("image-compress-v2", "transparent PNG → target compression keeps transparency (WebP), format-change disclosed", /Converted to WEBP/.test(r.note) && i.d[3] === 0 ? "PASS" : "FAIL", `note="${r.note}" cornerAlpha=${i.d[3]}`);
});
await guard("image-compress-v2", "impossible tiny target on a huge photo", async () => {
  await open(page, "/image/compress", ["IMAGE-02-photo-huge.jpg"]);
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.locator("input[type=number]").fill("5");
  await page.locator("select").selectOption("KB");
  const btn = page.getByRole("button", { name: /^Compress to under 5 KB/ });
  await btn.click();
  await Promise.race([page.getByText("Done!").waitFor({ timeout: 180000 }), page.getByRole("button", { name: "Try again" }).waitFor({ timeout: 180000 })]);
  const ok = (await page.getByText("Done!").count()) > 0;
  const badge = ok ? await page.locator("ul li span.rounded-full").last().innerText() : "";
  rec("image-compress-v2", "5 KB target on a 7000x5000 photo: honest closest-safe result, not a fake 5 KB claim", ok && /Closest safe result/.test(badge) ? "PASS" : "FAIL", `badge="${badge}"`);
});

rec("(v2 target compress)", "browser console/page errors", errors.length ? "FAIL" : "PASS", errors.slice(0, 4).join(" ;; "));
save("v2-target-compress");
await browser.close();
