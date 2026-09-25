// V2 privacy/network re-check: PDF compress, image compress, a converter, OCR, and the PDF editor —
// every non-GET request and every third-party host is recorded; document bytes must never appear off-origin.
import { launch, open, fx, rec, save } from "./lib.mjs";

const REAL = "C:/Users/ravit/Downloads/TheFileConvert_Scanned_OCR_Test.pdf";

async function watch(fn) {
  const { browser, ctx, page } = await launch({ acceptDownloads: true });
  const nonGet = [];
  const thirdParty = [];
  ctx.on("request", (r) => {
    const u = new URL(r.url());
    if (r.method() !== "GET" && r.method() !== "HEAD" && !/^(blob|data)/.test(u.protocol)) nonGet.push(`${r.method()} ${r.url()} (${(r.postData() ?? "").length}B body)`);
    if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname) && !/^(blob|data)/.test(u.protocol)) thirdParty.push(r.url());
  });
  await fn(page);
  await browser.close();
  return { nonGet, thirdParty };
}
const guard = async (t, n, fn) => { try { await fn(); } catch (e) { rec(t, n, "FAIL", String(e).slice(0, 240)); } };

await guard("privacy-v2", "PDF compress (target-size, custom + preset)", async () => {
  const { nonGet, thirdParty } = await watch(async (page) => {
    await open(page, "/pdf/compress", [REAL]);
    await page.getByRole("button", { name: "Under 1 MB", exact: true }).click();
    await page.getByRole("button", { name: /^Compress to under/ }).click();
    await page.getByText("Done!").waitFor({ timeout: 30000 });
  });
  rec("privacy-v2", "PDF compress: no non-GET requests, no third-party hosts", nonGet.length === 0 && thirdParty.length === 0 ? "PASS" : "FAIL", `nonGET=${nonGet.join(";")} thirdParty=${thirdParty.join(";")}`);
});
await guard("privacy-v2", "Image compress (target-size)", async () => {
  const { nonGet, thirdParty } = await watch(async (page) => {
    await open(page, "/image/compress", [fx("IMAGE-01-photo-large.jpg")]);
    await page.getByRole("button", { name: "Under 250 KB", exact: true }).click();
    await page.getByRole("button", { name: /^Compress to under/ }).click();
    await page.getByText("Done!").waitFor({ timeout: 30000 });
  });
  rec("privacy-v2", "Image compress: no non-GET requests, no third-party hosts", nonGet.length === 0 && thirdParty.length === 0 ? "PASS" : "FAIL", `nonGET=${nonGet.join(";")} thirdParty=${thirdParty.join(";")}`);
});
await guard("privacy-v2", "converter (jpg-to-webp)", async () => {
  const { nonGet, thirdParty } = await watch(async (page) => {
    await open(page, "/convert/jpg-to-webp", [fx("IMAGE-12-portrait.jpg")]);
    await page.getByRole("button", { name: /^Convert/ }).click();
    await page.getByText("Done!").waitFor({ timeout: 30000 });
  });
  rec("privacy-v2", "converter: no non-GET requests, no third-party hosts", nonGet.length === 0 && thirdParty.length === 0 ? "PASS" : "FAIL", `nonGET=${nonGet.join(";")} thirdParty=${thirdParty.join(";")}`);
});
await guard("privacy-v2", "OCR (editor, real scan)", async () => {
  const { nonGet, thirdParty } = await watch(async (page) => {
    await open(page, "/pdf/editor", [REAL]);
    await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Recognize current page" }).click().catch(async () => page.getByRole("button", { name: "Recognize Text" }).first().click());
    await page.getByRole("button", { name: /Edit recognized word/ }).first().waitFor({ timeout: 90000 });
  });
  // Tesseract's own static engine/model files are same-origin GETs (expected: /tesseract/*).
  const bad = nonGet.filter((r) => true);
  rec("privacy-v2", "OCR: only same-origin GETs (tesseract assets ok), no scan pixels/content POSTed, no third-party host", bad.length === 0 && thirdParty.length === 0 ? "PASS" : "FAIL", `nonGET=${bad.join(";")} thirdParty=${thirdParty.join(";")}`);
});
await guard("privacy-v2", "PDF editor (annotate + export)", async () => {
  const { nonGet, thirdParty } = await watch(async (page) => {
    await open(page, "/pdf/editor", ["PDF-10-many-pages.pdf"]);
    await page.locator('[data-testid="page-surface"]').first().waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Highlight", exact: true }).click();
    const S = await page.locator('[data-testid="page-surface"]').first().boundingBox();
    await page.mouse.move(S.x + 60, S.y + 100); await page.mouse.down(); await page.mouse.move(S.x + 200, S.y + 110, { steps: 5 }); await page.mouse.up();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: /Export PDF/ }).click()]);
    await dl.path();
  });
  rec("privacy-v2", "PDF editor: no non-GET requests, no third-party hosts", nonGet.length === 0 && thirdParty.length === 0 ? "PASS" : "FAIL", `nonGET=${nonGet.join(";")} thirdParty=${thirdParty.join(";")}`);
});
save("v2-privacy");
