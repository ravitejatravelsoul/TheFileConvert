import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { EDITOR_FIXTURES } from "./helpers/native";

/**
 * FINAL RELEASE GATE — performance / lazy loading. Heavy engines (pdf.js, OCR, the editor) must not load until the user asks.
 */
test.describe.configure({ timeout: 120_000 });

const HEAVY = /tesseract|\.traineddata|pdf\.worker|pdfjs|ocr-worker|\/fonts\/word\//i;

async function load(page: Page, route: string) {
  const reqs: { url: string; type: string; size: number }[] = [];
  page.on("response", async (r) => {
    const t = r.request().resourceType();
    const len = Number(r.headers()["content-length"] ?? 0) || (await r.body().then((b) => b.length).catch(() => 0));
    reqs.push({ url: r.url(), type: t, size: len });
  });
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  return reqs;
}

const jsBytes = (r: { type: string; size: number }[]) => r.filter((x) => x.type === "script").reduce((n, x) => n + x.size, 0);

for (const route of ["/", "/compress-pdf", "/pdf-to-word", "/word-to-pdf", "/pdf-editor"]) {
  test(`${route}: loads no OCR, pdf.js worker or font files before a file is chosen`, async ({ page }) => {
    const reqs = await load(page, route);
    const heavy = reqs.filter((r) => HEAVY.test(r.url));
    expect(heavy.map((r) => r.url)).toEqual([]);
    // the page itself stays light (uncompressed script bytes as served)
    expect(jsBytes(reqs), `${route} JS bytes`).toBeLessThan(1_800_000);
  });
}

test("/pdf-editor: the editor's code and pdf.js arrive when a PDF is chosen, not before", async ({ page }) => {
  const reqs = await load(page, "/pdf-editor");
  const before = jsBytes(reqs);
  const n0 = reqs.length;
  await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"));
  await expect(page.locator('[data-testid="page-surface"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  const after = jsBytes(reqs);
  expect(reqs.length).toBeGreaterThan(n0);
  expect(after - before, "script bytes that arrived after choosing the file").toBeGreaterThan(150_000);
  // and still nothing was recognised or uploaded: OCR assets only load on request
  expect(reqs.filter((r) => /tesseract|\.traineddata/i.test(r.url))).toEqual([]);
});

test("/pdf-to-word: pdf.js and the converter load on demand; OCR assets only if a scan needs them", async ({ page }) => {
  const reqs = await load(page, "/pdf-to-word");
  const n0 = reqs.length;
  await page.getByTestId("file-input").first().setInputFiles(path.join(EDITOR_FIXTURES, "EDITOR-01-simple-text.pdf"));
  await page.getByRole("button", { name: /Convert to Word/ }).waitFor({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  expect(reqs.length).toBeGreaterThan(n0);
  expect(reqs.filter((r) => /tesseract|\.traineddata/i.test(r.url)), "a text PDF needs no OCR").toEqual([]);
});
