// Review screenshots for the completeness pass: Word to PDF (desktop + mobile, ready and result),
// All tools, the Convert menu, and the homepage's smart upload with a Word document.
//   BASE=http://localhost:3000 node qa/scripts/w2p-shots.mjs
import path from "node:path";
import { chromium, devices } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.resolve("qa/review/fresh-launch-polish");
const DOCX = path.resolve("qa/fresh-scenario-fixtures/docx/WORD-12-complex.docx");
const browser = await chromium.launch();
const report = {};
for (const [name, opts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["mobile", devices["Pixel 7"]]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.goto(`${BASE}/word-to-pdf`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, `word-to-pdf-${name}-empty.png`) });
  await page.getByTestId("file-input").first().setInputFiles(DOCX);
  await page.getByRole("button", { name: "Convert to PDF" }).waitFor();
  await page.waitForTimeout(600);
  const cta = await page.getByRole("button", { name: "Convert to PDF" }).boundingBox();
  report[name] = { readyOverflow: await overflow(), ctaHeight: cta.height };
  await page.screenshot({ path: path.join(OUT, `word-to-pdf-${name}.png`) });
  await page.getByRole("button", { name: "Convert to PDF" }).click();
  await page.getByTestId("result").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(700);
  const dl = await page.getByRole("button", { name: "Download PDF" }).boundingBox();
  report[name].resultOverflow = await overflow();
  report[name].downloadHeight = dl.height;
  await page.screenshot({ path: path.join(OUT, `word-to-pdf-${name}-result.png`) });

  await page.goto(`${BASE}/tools`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, `all-tools-${name}.png`), fullPage: true });
  report[name].toolsOverflow = await overflow();

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.getByTestId("file-input").first().setInputFiles(DOCX);
  await page.getByText("What do you want to do?").waitFor();
  await page.locator("#start").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `homepage-word-drop-${name}.png`) });

  if (name === "desktop") {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Convert" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "nav-convert-dropdown.png"), clip: { x: 0, y: 0, width: 1440, height: 640 } });
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report));
