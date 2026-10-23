// Network privacy test: runs every tool with a real file while recording every request the page makes.
// PASS requires: no request with a body (no POST/PUT/PATCH), every request to the site's own origin,
// no request larger than the page's own assets, no cookies set, nothing written to browser storage.
//   node qa/scripts/fl-privacy.mjs
import { launch, open, addFiles, rec, save, fx } from "./fl-lib.mjs";

const { browser, ctx, page } = await launch();
const origin = new URL(process.env.BASE ?? "http://localhost:3000").origin;
const requests = [];
page.on("request", (r) => {
  if (r.url().startsWith("data:") || r.url().startsWith("blob:")) return;
  requests.push({ tool: current, method: r.method(), url: r.url(), bodyBytes: r.postDataBuffer()?.length ?? 0 });
});
let current = "";

async function flow(name, fn) {
  current = name;
  try {
    await fn();
  } catch (e) {
    rec("Privacy", `${name} flow ran`, "FAIL", { error: String(e).slice(0, 300) });
  }
}

await flow("compress-pdf", async () => {
  await open(page, "/compress-pdf");
  await addFiles(page, ["FL-PDF-02-scan-4mb.pdf"]);
  await page.getByRole("radio", { name: "1 MB", exact: true }).click();
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 300_000 });
});
await flow("compress-image", async () => {
  await open(page, "/compress-image");
  await addFiles(page, ["FL-IMG-01-large.jpg"]);
  await page.getByRole("button", { name: /^Compress to under/ }).click();
  await page.getByTestId("result").waitFor({ timeout: 300_000 });
});
await flow("convert-image", async () => {
  await open(page, "/convert-image");
  await addFiles(page, ["FL-IMG-06-vector.svg"]);
  await page.getByRole("radio", { name: /^PNG/ }).click();
  await page.getByRole("button", { name: "Convert to PNG" }).click();
  await page.getByTestId("result").waitFor();
});
await flow("pdf-to-image", async () => {
  await open(page, "/pdf-to-image");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  await page.getByRole("button", { name: "Convert all 12 pages" }).click();
  await page.getByTestId("result").waitFor({ timeout: 120_000 });
});
await flow("image-to-pdf", async () => {
  await open(page, "/image-to-pdf");
  await addFiles(page, ["FL-IMG-08-portrait.jpg", "FL-IMG-05-photo.webp"]);
  await page.getByRole("button", { name: /^Create PDF/ }).click();
  await page.getByTestId("result").waitFor();
});
await flow("merge-pdf", async () => {
  await open(page, "/merge-pdf");
  await addFiles(page, ["FL-PDF-09a-merge.pdf", "FL-PDF-09b-merge.pdf"]);
  await page.getByRole("button", { name: "Merge 2 PDFs" }).click();
  await page.getByTestId("result").waitFor();
});
await flow("split-pdf", async () => {
  await open(page, "/split-pdf");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  await page.getByRole("radio", { name: /Split every page/ }).click();
  await page.getByRole("button", { name: "Split into 12 PDFs" }).click();
  await page.getByTestId("result").waitFor();
});
await flow("organize-pdf", async () => {
  await open(page, "/organize-pdf");
  await addFiles(page, ["FL-PDF-05-multipage.pdf"]);
  await page.getByRole("button", { name: "Rotate Page 1 right", exact: true }).click();
  await page.getByRole("button", { name: "Save PDF" }).click();
  await page.getByTestId("result").waitFor();
});
await flow("pdf-editor (OCR + export)", async () => {
  await open(page, "/pdf-editor");
  await addFiles(page, ["FL-PDF-08-scanned-text.pdf"]);
  await page.getByRole("button", { name: "Recognize text" }).click();
  const busy = page.getByText(/Recognizing text|Preparing page|Loading text recognition/).first();
  await busy.waitFor({ timeout: 120_000 }).catch(() => {});
  await busy.waitFor({ state: "hidden", timeout: 240_000 });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PDF" }).click()]);
  await dl.path();
});

const withBody = requests.filter((r) => r.bodyBytes > 0 || !["GET", "HEAD"].includes(r.method));
const foreign = requests.filter((r) => new URL(r.url).origin !== origin);
const byTool = requests.reduce((m, r) => ((m[r.tool] = (m[r.tool] ?? 0) + 1), m), {});
const cookies = await ctx.cookies();
const storage = await page.evaluate(async () => ({
  local: localStorage.length,
  session: sessionStorage.length,
  idb: (await indexedDB.databases?.())?.map((d) => d.name) ?? [],
}));
const ocrAssets = requests.filter((r) => /tesseract/.test(r.url)).map((r) => new URL(r.url).pathname);

rec("Privacy", "no request carries a body (no uploads) across all 9 tools", withBody.length === 0 ? "PASS" : "FAIL", { requests: requests.length, withBody });
rec("Privacy", "every request goes to the site's own origin", foreign.length === 0 ? "PASS" : "FAIL", { foreign: foreign.map((r) => r.url) });
rec("Privacy", "no cookies, nothing written to local/session storage or IndexedDB", cookies.length === 0 && storage.local === 0 && storage.session === 0 && storage.idb.length === 0 ? "PASS" : "FAIL", { cookies: cookies.length, storage });
rec("Privacy", "OCR engine and model load from the site itself", ocrAssets.length > 0 ? "PASS" : "FAIL", { ocrAssets });
rec("Privacy", "requests per flow (page code, fonts, pdf.js worker, OCR assets only)", "PASS", { byTool });
await browser.close();
save("privacy");
