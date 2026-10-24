// Page weight: JavaScript each page downloads before any file is chosen, and whether heavy engines
// (pdf.js, its worker, Tesseract OCR) are held back until they're needed.
//   BASE=http://127.0.0.1:3100 node qa/scripts/fl-weight.mjs
import { launch, open, addFiles, rec, save } from "./fl-lib.mjs";

const { browser, page } = await launch();
let log = [];
page.on("response", async (r) => {
  const url = r.url();
  if (!/\.(js|mjs|wasm)(\?|$)|traineddata/.test(url)) return;
  const len = Number(r.headers()["content-length"] ?? 0) || (await r.body().catch(() => Buffer.alloc(0))).length;
  log.push({ url, bytes: len });
});
const heavy = (entries) => entries.filter((e) => /pdf\.worker|tesseract|traineddata/.test(e.url)).map((e) => e.url.split("/").pop());
const kb = (entries) => Math.round(entries.reduce((n, e) => n + e.bytes, 0) / 1000);

for (const route of ["/", "/tools", "/compress-pdf", "/pdf-editor"]) {
  log = [];
  await open(page, route);
  rec("Performance", `${route}: JavaScript before a file is chosen`, heavy(log).length === 0 ? "PASS" : "FAIL", { jsKB: kb(log), files: log.length, heavyEngines: heavy(log) });
}

log = [];
await open(page, "/pdf-editor");
const before = log.length;
await addFiles(page, ["FL-PDF-08-scanned-text.pdf"]);
await page.getByTestId("page-surface").waitFor({ timeout: 60_000 });
const editorLoad = log.slice(before);
rec("Performance", "editor code and pdf.js load only after a PDF is chosen", editorLoad.some((e) => /pdf\.worker/.test(e.url)) && !editorLoad.some((e) => /tesseract/.test(e.url)) ? "PASS" : "FAIL", { jsKBLoadedOnOpen: kb(editorLoad) });
await page.getByRole("button", { name: "Recognize text" }).click();
await page.getByRole("button", { name: /Edit recognized word/ }).first().waitFor({ timeout: 240_000 });
rec("Performance", "OCR engine loads only when Recognize text is pressed", log.some((e) => /tesseract/.test(e.url)) ? "PASS" : "FAIL", { ocrAssets: heavy(log).filter((n) => !/pdf\.worker/.test(n)) });
await browser.close();
save("performance");
