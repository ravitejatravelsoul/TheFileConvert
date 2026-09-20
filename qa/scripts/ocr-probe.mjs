import { launch, open } from "./lib.mjs";
const { browser, page } = await launch();
for (const q of ["standard", "accurate"]) {
  await open(page, "/pdf/ocr", ["PDF-12-scanned-ocr.pdf"]); await page.getByRole("button", { name: /^Recognize/ }).waitFor();
  await page.getByLabel("Quality").selectOption(q); console.log(q, "select value:", await page.getByLabel("Quality").inputValue());
  await page.getByLabel("Page 2").uncheck();
  const t0 = Date.now(); await page.getByRole("button", { name: /^Recognize/ }).click(); await page.getByText("Recognition complete").waitFor({ timeout: 300000 });
  console.log(q, Date.now() - t0, "ms");
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download TXT" }).click()]); await d.saveAs(`qa/evidence/out/probe-${q}.txt`);
}
await browser.close();
