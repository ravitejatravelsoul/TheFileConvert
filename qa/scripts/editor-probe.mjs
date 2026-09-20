import { launch, open } from "./lib.mjs";
const { browser, page } = await launch();
await open(page, "/pdf/editor", [process.argv[2] ?? "PDF-09-form.pdf"]); await page.waitForTimeout(4000);
const info = await page.evaluate(() => [...document.querySelectorAll("button,[role=tab],[role=menuitem],input,select")].filter((e) => e.offsetParent).map((e) => `${e.tagName.toLowerCase()}|${e.getAttribute("aria-label") ?? ""}|${(e.innerText || e.title || e.getAttribute("placeholder") || "").trim().slice(0, 30)}`));
console.log(info.join("\n"));
await page.screenshot({ path: "qa/evidence/editor-probe.png" });
await browser.close();
