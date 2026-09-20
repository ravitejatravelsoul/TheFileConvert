// node qa/scripts/dump-ui.mjs /route fixture[;fixture2]  -> prints controls visible after loading the file(s)
import path from "node:path";
import { chromium } from "@playwright/test";
const [route, fx] = process.argv.slice(2);
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await p.goto(`http://localhost:3000${route}`);
if (fx) { await p.locator('input[type="file"]').first().setInputFiles(fx.split(";").map((f) => path.resolve("qa-fixtures", f))); await p.waitForTimeout(2500); }
const info = await p.evaluate(() => {
  const main = document.querySelector("main");
  const q = (s) => [...main.querySelectorAll(s)];
  return {
    buttons: q("button").map((e) => (e.getAttribute("aria-label") || e.innerText).trim().slice(0, 50)).filter(Boolean),
    inputs: q("input,select,textarea").map((e) => `${e.tagName.toLowerCase()}[${e.type ?? ""}] name=${e.name} aria=${e.getAttribute("aria-label") ?? ""} label=${(e.closest("label")?.innerText ?? document.querySelector(`label[for="${e.id}"]`)?.innerText ?? "").trim().slice(0, 40)} value=${String(e.value).slice(0, 20)}`),
    text: main.innerText.slice(0, 600),
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
