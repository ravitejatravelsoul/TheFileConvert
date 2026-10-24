// Review screenshots of the PDF to Word page (desktop and mobile): the file-ready state and the result.
//   BASE=http://localhost:3000 node qa/scripts/word-shots.mjs
import path from "node:path";
import { chromium, devices } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = path.resolve("qa/review/fresh-launch-polish");
const PDF = path.resolve("qa/fresh-scenario-fixtures/word/PDF-WORD-10-mixed.pdf");
const browser = await chromium.launch();
for (const [name, opts] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["mobile", devices["Pixel 7"]]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pdf-to-word`, { waitUntil: "networkidle" });
  await page.getByTestId("file-input").first().setInputFiles(PDF);
  await page.getByRole("button", { name: "Convert to Word" }).waitFor();
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: path.join(OUT, `pdf-to-word-${name}.png`) });
  await page.getByRole("button", { name: "Convert to Word" }).click();
  await page.getByTestId("result").waitFor({ timeout: 180_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `pdf-to-word-${name}-result.png`) });
  console.log(name, "overflow", overflow);
  await ctx.close();
}
await browser.close();
